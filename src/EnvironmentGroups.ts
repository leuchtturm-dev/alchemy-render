import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { RenderApi, type RenderApiError } from "./Api/Api.js";
import type { Providers } from "./Providers.js";
import {
  resourceClass,
  digest,
  moveEnvironmentResource,
  restProvider,
  reveal,
  unwrapEntity,
  type CommonAttributes,
} from "./RestResource.js";

export interface EnvironmentGroupProps {
  readonly name?: string;
  readonly environmentId?: string;
}
export interface EnvironmentGroupLinkProps {
  readonly environmentGroupId: string;
  readonly serviceId: string;
}
export interface EnvironmentGroupEnvVarProps {
  readonly environmentGroupId: string;
  readonly key: string;
  readonly value: Redacted.Redacted<string>;
}
export interface EnvironmentGroupSecretFileProps {
  readonly environmentGroupId: string;
  readonly name: string;
  readonly content: Redacted.Redacted<string>;
}
export interface EnvironmentGroupAttributes extends CommonAttributes {
  readonly environmentGroupId: string;
  readonly environmentId?: string;
}
export interface EnvironmentGroupLinkAttributes extends CommonAttributes {
  readonly environmentGroupId: string;
  readonly serviceId: string;
}
export interface SecretAttributes extends CommonAttributes {
  readonly valueDigest?: string;
}

type Managed<
  T extends string,
  P extends object,
  A extends object,
> = Resource.Resource<T, P, A, never, Providers>;
/** A shared Render environment group. @resource */
export type EnvironmentGroup = Managed<
  "Render.EnvironmentGroup",
  EnvironmentGroupProps,
  EnvironmentGroupAttributes
>;
export const EnvironmentGroup = Resource.Resource<EnvironmentGroup>(
  "Render.EnvironmentGroup",
);
/** Links a service to an environment group. @resource */
export type EnvironmentGroupLink = Managed<
  "Render.EnvironmentGroupLink",
  EnvironmentGroupLinkProps,
  EnvironmentGroupLinkAttributes
>;
export const EnvironmentGroupLink = Resource.Resource<EnvironmentGroupLink>(
  "Render.EnvironmentGroupLink",
);
/** An environment-group variable. Secret values are stored as digests. @resource */
export type EnvironmentGroupEnvVar = Managed<
  "Render.EnvironmentGroupEnvVar",
  EnvironmentGroupEnvVarProps,
  SecretAttributes
>;
export const EnvironmentGroupEnvVar = Resource.Resource<EnvironmentGroupEnvVar>(
  "Render.EnvironmentGroupEnvVar",
);
/** An environment-group secret file. Secret values are stored as digests. @resource */
export type EnvironmentGroupSecretFile = Managed<
  "Render.EnvironmentGroupSecretFile",
  EnvironmentGroupSecretFileProps,
  SecretAttributes
>;
export const EnvironmentGroupSecretFile =
  Resource.Resource<EnvironmentGroupSecretFile>(
    "Render.EnvironmentGroupSecretFile",
  );

export const EnvironmentGroupProvider = () =>
  restProvider(EnvironmentGroup, {
    collection: "/env-groups",
    item: (id) => `/env-groups/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["environmentGroupId"],
    body: (p, name, ownerId) => ({
      name,
      ownerId,
      environmentId: p.environmentId,
      envVars: [],
    }),
    updateBody: (_p, name) => ({ name }),
    sensitiveChanged: (_olds, props, output) =>
      output.environmentId !== props.environmentId,
    attributes: (e, f) => {
      const id = typeof e.id === "string" ? e.id : f.id;
      return {
        id,
        environmentGroupId: id,
        ownerId: f.ownerId,
        ...(typeof e.name === "string" ? { name: e.name } : {}),
        ...(typeof e.environmentId === "string"
          ? { environmentId: e.environmentId }
          : {}),
      };
    },
    finalize: (attributes, props, api, phase) =>
      Effect.gen(function* () {
        if (phase === "read") return attributes;
        if (phase === "create") {
          return props.environmentId === undefined
            ? attributes
            : { ...attributes, environmentId: props.environmentId };
        }
        if (attributes.environmentId === props.environmentId) return attributes;
        yield* moveEnvironmentResource(
          api,
          attributes.environmentGroupId,
          attributes.environmentId,
          props.environmentId,
        );
        const { environmentId: _previousEnvironment, ...withoutEnvironment } =
          attributes;
        return props.environmentId === undefined
          ? withoutEnvironment
          : { ...withoutEnvironment, environmentId: props.environmentId };
      }),
  });

export const EnvironmentGroupLinkProvider = () =>
  Provider.effect(
    resourceClass(EnvironmentGroupLink),
    Effect.gen(function* () {
      const getApi = yield* RenderApi;
      const read = (p: EnvironmentGroupLinkProps, owned: boolean) =>
        Effect.gen(function* () {
          const api = yield* getApi;
          const data = yield* api.request({
            method: "GET",
            path: `/env-groups/${encodeURIComponent(p.environmentGroupId)}`,
          });
          const links = unwrapEntity(data).serviceLinks;
          const found =
            Array.isArray(links) &&
            links.some(
              (v) =>
                typeof v === "object" &&
                v !== null &&
                (v as { readonly id?: unknown }).id === p.serviceId,
            );
          if (!found) return undefined;
          const attrs: EnvironmentGroupLinkAttributes = {
            id: p.serviceId,
            serviceId: p.serviceId,
            environmentGroupId: p.environmentGroupId,
          };
          return owned ? attrs : Unowned(attrs);
        }).pipe(
          Effect.catch((e: RenderApiError) =>
            e.isNotFound ? Effect.succeed(undefined) : Effect.fail(e),
          ),
        );
      return EnvironmentGroupLink.Provider.of({
        stables: ["id", "environmentGroupId", "serviceId"],
        nuke: { skip: true },
        list: () => Effect.succeed([]),
        read: ({ olds, output }) => read(olds, output !== undefined),
        diff: ({ olds, news }) =>
          Effect.succeed(
            !isResolved(news)
              ? undefined
              : olds.environmentGroupId !== news.environmentGroupId ||
                  olds.serviceId !== news.serviceId
                ? { action: "replace" as const }
                : undefined,
          ),
        reconcile: Effect.fn(function* ({ news }) {
          const existing = yield* read(news, true);
          if (existing) return existing;
          const api = yield* getApi;
          yield* api.request({
            method: "POST",
            path: `/env-groups/${encodeURIComponent(news.environmentGroupId)}/services/${encodeURIComponent(news.serviceId)}`,
          });
          return {
            id: news.serviceId,
            serviceId: news.serviceId,
            environmentGroupId: news.environmentGroupId,
          };
        }),
        delete: Effect.fn(function* ({ output }) {
          const api = yield* getApi;
          yield* api
            .request({
              method: "DELETE",
              path: `/env-groups/${encodeURIComponent(output.environmentGroupId)}/services/${encodeURIComponent(output.serviceId)}`,
            })
            .pipe(
              Effect.asVoid,
              Effect.catch((e: RenderApiError) =>
                e.isNotFound ? Effect.void : Effect.fail(e),
              ),
            );
        }),
      });
    }),
  );

const secretAttrs = (
  e: Record<string, unknown>,
  f: { id: string; previous?: SecretAttributes },
): SecretAttributes => ({
  id: f.id,
  ...(typeof e.key === "string"
    ? { name: e.key }
    : typeof e.name === "string"
      ? { name: e.name }
      : {}),
  ...(f.previous?.valueDigest ? { valueDigest: f.previous.valueDigest } : {}),
});
export const EnvironmentGroupEnvVarProvider = () =>
  restProvider(EnvironmentGroupEnvVar, {
    collection: (p) =>
      `/env-groups/${encodeURIComponent(p.environmentGroupId)}/env-vars`,
    item: (key, p) =>
      `/env-groups/${encodeURIComponent(p.environmentGroupId)}/env-vars/${encodeURIComponent(key)}`,
    listable: false,
    nukeSkip: true,
    identity: "key",
    immutable: ["environmentGroupId", "key"],
    createMethod: "PUT",
    createPath: (key, p) =>
      `/env-groups/${encodeURIComponent(p.environmentGroupId)}/env-vars/${encodeURIComponent(key)}`,
    updateMethod: "PUT",
    remoteDiff: false,
    sensitiveChanged: (_olds, news, output) =>
      output.valueDigest !== digest(news.value),
    body: (p) => ({ value: reveal(p.value) }),
    attributes: secretAttrs,
    afterWrite: (a, p) => ({ ...a, valueDigest: digest(p.value) }),
  });
export const EnvironmentGroupSecretFileProvider = () =>
  restProvider(EnvironmentGroupSecretFile, {
    collection: (p) =>
      `/env-groups/${encodeURIComponent(p.environmentGroupId)}/secret-files`,
    item: (name, p) =>
      `/env-groups/${encodeURIComponent(p.environmentGroupId)}/secret-files/${encodeURIComponent(name)}`,
    listable: false,
    nukeSkip: true,
    identity: "key",
    immutable: ["environmentGroupId", "name"],
    createMethod: "PUT",
    createPath: (name, p) =>
      `/env-groups/${encodeURIComponent(p.environmentGroupId)}/secret-files/${encodeURIComponent(name)}`,
    updateMethod: "PUT",
    remoteDiff: false,
    sensitiveChanged: (_olds, news, output) =>
      output.valueDigest !== digest(news.content),
    body: (p) => ({ content: reveal(p.content) }),
    attributes: secretAttrs,
    afterWrite: (a, p) => ({ ...a, valueDigest: digest(p.content) }),
  });
