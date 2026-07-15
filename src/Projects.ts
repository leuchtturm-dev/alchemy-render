import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import {
  paginate,
  RenderApi,
  type RenderApiClient,
  type RenderApiError,
} from "./Api/Api.js";
import type { Providers } from "./Providers.js";
import {
  resourceClass,
  restProvider,
  unwrapEntity,
  unwrapRows,
  type CommonAttributes,
} from "./RestResource.js";

export interface EnvironmentIpRule {
  readonly cidrBlock: string;
  readonly description: string;
}

export interface ProjectProps {
  readonly name?: string;
}

export interface EnvironmentProps {
  readonly name?: string;
  readonly projectId: string;
  readonly protectedStatus?: "protected" | "unprotected";
  readonly networkIsolationEnabled?: boolean;
  readonly ipAllowList?: readonly EnvironmentIpRule[];
}

export interface EnvironmentResourceProps {
  readonly environmentId: string;
  readonly resourceId: string;
}

export interface ProjectAttributes extends CommonAttributes {
  readonly projectId: string;
  readonly environmentIds: readonly string[];
}

const ALLOW_ALL_IPS = [
  { cidrBlock: "0.0.0.0/0", description: "everywhere" },
] as const;

export interface EnvironmentAttributes extends CommonAttributes {
  readonly environmentId: string;
  readonly projectId: string;
  readonly protectedStatus: "protected" | "unprotected";
  readonly networkIsolationEnabled: boolean;
}

export interface EnvironmentResourceAttributes extends CommonAttributes {
  readonly environmentId: string;
  readonly resourceId: string;
}

type Managed<
  T extends string,
  P extends object,
  A extends object,
> = Resource.Resource<T, P, A, never, Providers>;

/** A Render project used to organize environments. @resource */
export type Project = Managed<
  "Render.Project",
  ProjectProps,
  ProjectAttributes
>;
export const Project = Resource.Resource<Project>("Render.Project");

/** A Render project environment. @resource */
export type Environment = Managed<
  "Render.Environment",
  EnvironmentProps,
  EnvironmentAttributes
>;
export const Environment = Resource.Resource<Environment>("Render.Environment");

/** Membership of a service or datastore in an environment. @resource */
export type EnvironmentResource = Managed<
  "Render.EnvironmentResource",
  EnvironmentResourceProps,
  EnvironmentResourceAttributes
>;
export const EnvironmentResource = Resource.Resource<EnvironmentResource>(
  "Render.EnvironmentResource",
);

export const ProjectProvider = () =>
  restProvider(Project, {
    collection: "/projects",
    item: (id) => `/projects/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["projectId"],
    body: (_props, name, ownerId) => ({ name, ownerId, environments: [] }),
    updateBody: (_props, name) => ({ name }),
    attributes: (entity, fallback) => {
      const id = typeof entity.id === "string" ? entity.id : fallback.id;
      return {
        id,
        projectId: id,
        ownerId: fallback.ownerId,
        environmentIds: Array.isArray(entity.environmentIds)
          ? entity.environmentIds.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
        ...(typeof entity.name === "string" ? { name: entity.name } : {}),
      };
    },
  });

const environmentAttributes = (
  entity: Record<string, unknown>,
  fallback: { id: string; ownerId: string; props?: EnvironmentProps },
): EnvironmentAttributes => {
  const id = typeof entity.id === "string" ? entity.id : fallback.id;
  return {
    id,
    environmentId: id,
    projectId:
      typeof entity.projectId === "string"
        ? entity.projectId
        : (fallback.props?.projectId ?? ""),
    protectedStatus:
      entity.protectedStatus === "protected" ? "protected" : "unprotected",
    networkIsolationEnabled: entity.networkIsolationEnabled === true,
    ...(typeof entity.name === "string" ? { name: entity.name } : {}),
  };
};

const listEnvironments = (api: RenderApiClient) =>
  Effect.gen(function* () {
    const projects = yield* paginate(
      (cursor) =>
        api
          .request({
            method: "GET",
            path: "/projects",
            query: {
              ownerId: [api.ownerId],
              limit: 100,
              ...(cursor === undefined ? {} : { cursor }),
            },
          })
          .pipe(Effect.map(unwrapRows)),
      { cursor: (row) => row.cursor, pageSize: 100 },
    );
    const nested = yield* Effect.forEach(
      projects,
      ({ entity: project }) => {
        const projectId =
          typeof project.id === "string" ? project.id : undefined;
        if (!projectId) return Effect.succeed([] as EnvironmentAttributes[]);
        return paginate(
          (cursor) =>
            api
              .request({
                method: "GET",
                path: "/environments",
                query: {
                  projectId: [projectId],
                  limit: 100,
                  ...(cursor === undefined ? {} : { cursor }),
                },
              })
              .pipe(Effect.map(unwrapRows)),
          { cursor: (row) => row.cursor, pageSize: 100 },
        ).pipe(
          Effect.map((rows) =>
            rows.map(({ entity }) =>
              environmentAttributes(entity, {
                id: typeof entity.id === "string" ? entity.id : projectId,
                ownerId: api.ownerId,
                props: { projectId },
              }),
            ),
          ),
        );
      },
      { concurrency: 5 },
    );
    return nested.flat();
  });

export const EnvironmentProvider = () =>
  restProvider(Environment, {
    collection: "/environments",
    item: (id) => `/environments/${encodeURIComponent(id)}`,
    ownerScoped: false,
    stables: ["environmentId", "projectId"],
    lookupQuery: (props) => ({ projectId: [props.projectId] }),
    list: listEnvironments,
    immutable: ["projectId"],
    body: (props, name) => ({
      name,
      projectId: props.projectId,
      protectedStatus: props.protectedStatus ?? "unprotected",
      networkIsolationEnabled: props.networkIsolationEnabled ?? false,
      ipAllowList: props.ipAllowList,
    }),
    updateBody: (props, name) => ({
      name,
      protectedStatus: props.protectedStatus ?? "unprotected",
      networkIsolationEnabled: props.networkIsolationEnabled ?? false,
      ipAllowList: props.ipAllowList ?? ALLOW_ALL_IPS,
    }),
    observe: (entity) => ({
      ...entity,
      ipAllowList: entity.ipAllowList ?? ALLOW_ALL_IPS,
    }),
    attributes: environmentAttributes,
  });

const environmentContains = (
  entity: Record<string, unknown>,
  resourceId: string,
): boolean =>
  ["serviceIds", "databasesIds", "redisIds", "envGroupIds"].some(
    (key) => Array.isArray(entity[key]) && entity[key].includes(resourceId),
  );

export const EnvironmentResourceProvider = () =>
  Provider.effect(
    resourceClass(EnvironmentResource),
    Effect.gen(function* () {
      const getApi = yield* RenderApi;
      const readMembership = (
        props: EnvironmentResourceProps,
        owned: boolean,
      ) =>
        Effect.gen(function* () {
          const api = yield* getApi;
          const entity = unwrapEntity(
            yield* api.request({
              method: "GET",
              path: `/environments/${encodeURIComponent(props.environmentId)}`,
            }),
          );
          if (!environmentContains(entity, props.resourceId)) return undefined;
          const attributes: EnvironmentResourceAttributes = {
            id: props.resourceId,
            environmentId: props.environmentId,
            resourceId: props.resourceId,
          };
          return owned ? attributes : Unowned(attributes);
        }).pipe(
          Effect.catch((error: RenderApiError) =>
            error.isNotFound ? Effect.succeed(undefined) : Effect.fail(error),
          ),
        );

      return EnvironmentResource.Provider.of({
        stables: ["id", "environmentId", "resourceId"],
        nuke: { skip: true },
        list: () => Effect.succeed([]),
        read: ({ olds, output }) => readMembership(olds, output !== undefined),
        diff: ({ olds, news }) =>
          Effect.succeed(
            !isResolved(news)
              ? undefined
              : olds.environmentId !== news.environmentId ||
                  olds.resourceId !== news.resourceId
                ? ({ action: "replace" } as const)
                : undefined,
          ),
        reconcile: Effect.fn(function* ({ news }) {
          const existing = yield* readMembership(news, true);
          if (!existing) {
            const api = yield* getApi;
            yield* api.request({
              method: "POST",
              path: `/environments/${encodeURIComponent(news.environmentId)}/resources`,
              body: { resourceIds: [news.resourceId] },
            });
          }
          return {
            id: news.resourceId,
            environmentId: news.environmentId,
            resourceId: news.resourceId,
          };
        }),
        delete: Effect.fn(function* ({ output }) {
          const api = yield* getApi;
          yield* api
            .request({
              method: "DELETE",
              path: `/environments/${encodeURIComponent(output.environmentId)}/resources`,
              query: { resourceIds: [output.resourceId] },
            })
            .pipe(
              Effect.asVoid,
              Effect.catch((error: RenderApiError) =>
                error.isNotFound ? Effect.void : Effect.fail(error),
              ),
            );
        }),
      });
    }),
  );
