import { createHash } from "node:crypto";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import {
  RenderApi,
  RenderApiError,
  type RenderApiClient,
} from "./Api/Api.js";
import type { Providers } from "./Providers.js";
import {
  resourceClass,
  digest,
  restProvider,
  reveal,
  unwrapEntity,
  type CommonAttributes,
} from "./RestResource.js";

interface ServiceEnvVarBaseProps {
  readonly serviceId: string;
  readonly key: string;
}

export type ServiceEnvVarProps = ServiceEnvVarBaseProps &
  (
    | {
        readonly value: Redacted.Redacted<string>;
        readonly generateValue?: never;
      }
    | {
        readonly value?: never;
        readonly generateValue: true;
      }
  );
export interface ServiceSecretFileProps {
  readonly serviceId: string;
  readonly name: string;
  readonly content: Redacted.Redacted<string>;
}
export interface CustomDomainProps {
  readonly serviceId: string;
  readonly name: string;
}
export interface DiskProps {
  readonly serviceId: string;
  readonly name?: string;
  readonly mountPath: string;
  readonly sizeGB: number;
}
export interface HeaderProps {
  readonly serviceId: string;
  readonly name: string;
  readonly path: string;
  readonly value: string;
}
export interface RouteProps {
  readonly serviceId: string;
  readonly source: string;
  readonly destination: string;
  readonly type: "redirect" | "rewrite";
  /** Zero-based rule order. Omit on create to append; omission on update leaves the current priority unchanged. */
  readonly priority?: number;
}
export interface AutoscalingProps {
  readonly serviceId: string;
  readonly enabled?: true;
  readonly min: number;
  readonly max: number;
  readonly criteria: {
    readonly cpu?: { readonly enabled: boolean; readonly percentage: number };
    readonly memory?: {
      readonly enabled: boolean;
      readonly percentage: number;
    };
  };
}
export interface SecretValueAttributes extends CommonAttributes {
  readonly valueDigest?: string;
  readonly generated: boolean;
}
export interface ServiceChildAttributes extends CommonAttributes {
  readonly serviceId: string;
}
export interface RouteAttributes extends ServiceChildAttributes {
  readonly source: string;
  readonly destination: string;
  readonly type: RouteProps["type"];
  readonly priority?: number;
}
export interface DiskAttributes extends ServiceChildAttributes {
  readonly diskId: string;
  readonly mountPath?: string;
  readonly sizeGB?: number;
  readonly configurationDigest?: string;
}
export interface AutoscalingAttributes extends CommonAttributes {
  readonly serviceId: string;
  readonly enabled: true;
  readonly min: number;
  readonly max: number;
  readonly criteria: Required<AutoscalingProps["criteria"]>;
}
type Managed<
  T extends string,
  P extends object,
  A extends object,
> = Resource.Resource<T, P, A, never, Providers>;
/** A service environment variable. Secret values are stored as digests. @resource */
export type ServiceEnvVar = Managed<
  "Render.ServiceEnvVar",
  ServiceEnvVarProps,
  SecretValueAttributes
>;
export const ServiceEnvVar = Resource.Resource<ServiceEnvVar>(
  "Render.ServiceEnvVar",
);
/** A service secret file. Secret values are stored as digests. @resource */
export type ServiceSecretFile = Managed<
  "Render.ServiceSecretFile",
  ServiceSecretFileProps,
  SecretValueAttributes
>;
export const ServiceSecretFile = Resource.Resource<ServiceSecretFile>(
  "Render.ServiceSecretFile",
);
/** A custom domain attached to a service. @resource */
export type CustomDomain = Managed<
  "Render.CustomDomain",
  CustomDomainProps,
  ServiceChildAttributes
>;
export const CustomDomain = Resource.Resource<CustomDomain>(
  "Render.CustomDomain",
);
/** A persistent disk attached to a service. @resource */
export type Disk = Managed<"Render.Disk", DiskProps, DiskAttributes>;
export const Disk = Resource.Resource<Disk>("Render.Disk");
/** A static-site response header rule. @resource */
export type Header = Managed<
  "Render.Header",
  HeaderProps,
  ServiceChildAttributes
>;
export const Header = Resource.Resource<Header>("Render.Header");
/** A static-site redirect or rewrite rule. @resource */
export type Route = Managed<"Render.Route", RouteProps, RouteAttributes>;
export const Route = Resource.Resource<Route>("Render.Route");
/** Autoscaling configuration managed separately from the service. @resource */
export type Autoscaling = Managed<
  "Render.Autoscaling",
  AutoscalingProps,
  AutoscalingAttributes
>;
export const Autoscaling = Resource.Resource<Autoscaling>("Render.Autoscaling");

const deployServiceConfiguration = (
  api: RenderApiClient,
  serviceId: string,
  ignoreNotFound = false,
) =>
  api
    .request({
      method: "POST",
      path: `/services/${encodeURIComponent(serviceId)}/deploys`,
      body: {},
    })
    .pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        ignoreNotFound && error.isNotFound
          ? Effect.void
          : Effect.fail(error),
      ),
    );

const secretAttrs = (
  e: Record<string, unknown>,
  f: { id: string; previous?: SecretValueAttributes; props?: unknown },
): SecretValueAttributes => {
  const generateValue =
    typeof f.props === "object" &&
    f.props !== null &&
    (f.props as { readonly generateValue?: unknown }).generateValue === true;
  const remoteValue =
    typeof e.value === "string"
      ? e.value
      : typeof e.content === "string"
        ? e.content
        : undefined;
  const valueDigest =
    remoteValue === undefined
      ? f.previous?.valueDigest
      : digest(Redacted.make(remoteValue));
  return {
    id: f.id,
    generated: f.previous?.generated ?? generateValue,
    ...(typeof e.key === "string"
      ? { name: e.key }
      : typeof e.name === "string"
        ? { name: e.name }
        : {}),
    ...(valueDigest === undefined ? {} : { valueDigest }),
  };
};
export const ServiceEnvVarProvider = () =>
  restProvider(ServiceEnvVar, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/env-vars`,
    item: (key, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/env-vars/${encodeURIComponent(key)}`,
    listable: false,
    nukeSkip: true,
    identity: "key",
    immutable: ["serviceId", "key"],
    createMethod: "PUT",
    recoverPut: true,
    createPath: (key, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/env-vars/${encodeURIComponent(key)}`,
    updateMethod: "PUT",
    remoteDiff: false,
    existingSatisfies: (_entity, props) =>
      props.generateValue === true && props.value === undefined,
    validate: (props) => {
      const hasValue = props.value !== undefined;
      const generatesValue = props.generateValue === true;
      return hasValue === generatesValue
        ? Effect.fail(
            new RenderApiError(
              "ServiceEnvVar requires exactly one of value or generateValue: true",
            ),
          )
        : Effect.void;
    },
    sensitiveChanged: (_olds, news, output) =>
      news.value === undefined
        ? !output.generated
        : output.valueDigest !== digest(news.value),
    body: (p) =>
      p.value === undefined
        ? { generateValue: true }
        : { value: reveal(p.value) },
    attributes: secretAttrs,
    afterWrite: (a, p) => {
      const { valueDigest: _oldDigest, ...rest } = a;
      return {
        ...rest,
        generated: p.value === undefined,
        ...(p.value ? { valueDigest: digest(p.value) } : {}),
      };
    },
    finalize: (attributes, props, api, phase) =>
      phase === "create" || phase === "update"
        ? deployServiceConfiguration(api, props.serviceId).pipe(
            Effect.as(attributes),
          )
        : Effect.succeed(attributes),
    afterDelete: (_attributes, props, api) =>
      deployServiceConfiguration(api, props.serviceId, true),
  });
export const ServiceSecretFileProvider = () =>
  restProvider(ServiceSecretFile, {
    collection: (p) =>
      `/services/${encodeURIComponent(p.serviceId)}/secret-files`,
    item: (name, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/secret-files/${encodeURIComponent(name)}`,
    listable: false,
    nukeSkip: true,
    identity: "key",
    immutable: ["serviceId", "name"],
    createMethod: "PUT",
    recoverPut: true,
    createPath: (name, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/secret-files/${encodeURIComponent(name)}`,
    updateMethod: "PUT",
    remoteDiff: false,
    sensitiveChanged: (_olds, news, output) =>
      output.valueDigest !== digest(news.content),
    body: (p) => ({ content: reveal(p.content) }),
    attributes: secretAttrs,
    afterWrite: (a, p) => ({
      ...a,
      generated: false,
      valueDigest: digest(p.content),
    }),
    finalize: (attributes, props, api, phase) =>
      phase === "create" || phase === "update"
        ? deployServiceConfiguration(api, props.serviceId).pipe(
            Effect.as(attributes),
          )
        : Effect.succeed(attributes),
    afterDelete: (_attributes, props, api) =>
      deployServiceConfiguration(api, props.serviceId, true),
  });
const childAttrs = (
  e: Record<string, unknown>,
  f: {
    id: string;
    props?: { serviceId: string };
    previous?: ServiceChildAttributes;
  },
): ServiceChildAttributes => ({
  id: typeof e.id === "string" ? e.id : f.id,
  serviceId: f.props?.serviceId ?? f.previous?.serviceId ?? "",
  ...(typeof e.name === "string"
    ? { name: e.name }
    : typeof e.domain === "string"
      ? { name: e.domain }
      : {}),
});
export const CustomDomainProvider = () =>
  restProvider(CustomDomain, {
    collection: (p) =>
      `/services/${encodeURIComponent(p.serviceId)}/custom-domains`,
    item: (id, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/custom-domains/${encodeURIComponent(id)}`,
    listable: false,
    nukeSkip: true,
    stables: ["serviceId"],
    immutable: ["serviceId", "name"],
    body: (_p, name) => ({ name }),
    updateBody: () => ({}),
    writeEntity: (value, props) => {
      if (!Array.isArray(value)) return unwrapEntity(value);
      const match = value.find(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" &&
          entry !== null &&
          !Array.isArray(entry) &&
          (entry as Record<string, unknown>).name === props.name,
      );
      return match ?? unwrapEntity(value);
    },
    attributes: childAttrs,
    afterWrite: (a, p) => ({ ...a, serviceId: p.serviceId }),
  });
const diskConfigurationDigest = (
  props: DiskProps,
  attributes: Pick<DiskAttributes, "id" | "name">,
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        name: props.name ?? attributes.name ?? attributes.id,
        mountPath: props.mountPath,
        sizeGB: props.sizeGB,
      }),
    )
    .digest("hex");

export const DiskProvider = () =>
  restProvider(Disk, {
    collection: "/disks",
    item: (id) => `/disks/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["diskId", "serviceId"],
    filter: (entity, props) =>
      props === undefined || entity.serviceId === props.serviceId,
    immutable: ["serviceId"],
    reconcileOnNoop: true,
    sensitiveChanged: (_olds, props, output) =>
      output.configurationDigest !== diskConfigurationDigest(props, output),
    validate: (props, observed) => {
      if (!Number.isInteger(props.sizeGB) || props.sizeGB < 1) {
        return Effect.fail(
          new RenderApiError("Render disk sizeGB must be a positive integer"),
        );
      }
      if (
        observed?.sizeGB !== undefined &&
        props.sizeGB < observed.sizeGB
      ) {
        return Effect.fail(
          new RenderApiError(
            `Render disks can only grow (current ${observed.sizeGB} GB, requested ${props.sizeGB} GB)`,
          ),
        );
      }
      return Effect.void;
    },
    body: (p, name) => ({
      name,
      serviceId: p.serviceId,
      mountPath: p.mountPath,
      sizeGB: p.sizeGB,
    }),
    updateBody: (p, name) => ({
      name,
      mountPath: p.mountPath,
      sizeGB: p.sizeGB,
    }),
    attributes: (e, f) => {
      const id = typeof e.id === "string" ? e.id : f.id;
      return {
        id,
        diskId: id,
        serviceId:
          typeof e.serviceId === "string"
            ? e.serviceId
            : (f.props?.serviceId ?? ""),
        ...(typeof e.name === "string" ? { name: e.name } : {}),
        ...(typeof e.mountPath === "string" ? { mountPath: e.mountPath } : {}),
        ...(typeof e.sizeGB === "number" ? { sizeGB: e.sizeGB } : {}),
        ...(f.previous?.configurationDigest
          ? { configurationDigest: f.previous.configurationDigest }
          : {}),
      };
    },
    finalize: (attributes, props, api, phase) => {
      const configurationDigest = diskConfigurationDigest(props, attributes);
      const needsDeploy =
        phase === "create" ||
        phase === "update" ||
        (phase === "reconcile" &&
          attributes.configurationDigest !== configurationDigest);
      return needsDeploy
        ? deployServiceConfiguration(api, props.serviceId).pipe(
            Effect.as({ ...attributes, configurationDigest }),
          )
        : Effect.succeed(attributes);
    },
  });
export const HeaderProvider = () =>
  restProvider(Header, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/headers`,
    item: (id, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/headers/${encodeURIComponent(id)}`,
    listable: false,
    nukeSkip: true,
    ownerScoped: false,
    stables: ["serviceId"],
    lookupByList: true,
    lookupQuery: (p) => ({
      name: [p.name],
      path: [p.path],
    }),
    remoteMismatchAction: "replace",
    immutable: ["serviceId", "name", "path", "value"],
    matches: (e, _id, p) => e.name === p.name && e.path === p.path,
    body: (p, name) => ({ name, path: p.path, value: p.value }),
    attributes: childAttrs,
    afterWrite: (a, p) => ({ ...a, serviceId: p.serviceId }),
  });
const routeAttrs = (
  e: Record<string, unknown>,
  f: { id: string; props?: RouteProps; previous?: RouteAttributes },
): RouteAttributes => ({
  ...childAttrs(e, f),
  source:
    typeof e.source === "string"
      ? e.source
      : (f.props?.source ?? f.previous?.source ?? ""),
  destination:
    typeof e.destination === "string"
      ? e.destination
      : (f.props?.destination ?? f.previous?.destination ?? ""),
  type:
    e.type === "redirect" || e.type === "rewrite"
      ? e.type
      : (f.props?.type ?? f.previous?.type ?? "rewrite"),
  ...(typeof e.priority === "number"
    ? { priority: e.priority }
    : f.previous?.priority === undefined
      ? {}
      : { priority: f.previous.priority }),
});

export const RouteProvider = () =>
  restProvider(Route, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/routes`,
    item: (id, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/routes/${encodeURIComponent(id)}`,
    listable: false,
    nukeSkip: true,
    ownerScoped: false,
    nameFilter: false,
    stables: ["serviceId"],
    lookupByList: true,
    lookupQuery: (p) => ({
      type: [p.type],
      source: [p.source],
    }),
    immutable: ["serviceId", "source", "destination", "type"],
    validate: (props) =>
      props.priority !== undefined &&
      (!Number.isInteger(props.priority) || props.priority < 0)
        ? Effect.fail(
            new RenderApiError("Route priority must be a non-negative integer"),
          )
        : Effect.void,
    replaceWhen: (_olds, props, output) => {
      // Outputs persisted before RouteAttributes tracked the immutable rule
      // fields must be refreshed from Render before deciding to replace.
      const hasIdentitySnapshot =
        typeof output.source === "string" &&
        typeof output.destination === "string" &&
        (output.type === "redirect" || output.type === "rewrite");
      return (
        hasIdentitySnapshot &&
        (output.source !== props.source ||
          output.destination !== props.destination ||
          output.type !== props.type)
      );
    },
    resolveIdentity: (id) => Effect.succeed(id),
    matches: (e, _id, p) => e.source === p.source && e.type === p.type,
    body: (p) => ({
      source: p.source,
      destination: p.destination,
      type: p.type,
      priority: p.priority,
    }),
    updateBody: (p) => ({ priority: p.priority }),
    attributes: routeAttrs,
    afterWrite: (a, p) => ({ ...a, serviceId: p.serviceId }),
  });

const normalizeAutoscalingCriteria = (
  criteria: AutoscalingProps["criteria"],
): Required<AutoscalingProps["criteria"]> => ({
  cpu: criteria.cpu ?? { enabled: false, percentage: 0 },
  memory: criteria.memory ?? { enabled: false, percentage: 0 },
});
const autoAttrs = (p: AutoscalingProps): AutoscalingAttributes => ({
  id: p.serviceId,
  serviceId: p.serviceId,
  enabled: true,
  min: p.min,
  max: p.max,
  criteria: normalizeAutoscalingCriteria(p.criteria),
});

const validateAutoscaling = (props: AutoscalingProps) => {
  if (
    !Number.isInteger(props.min) ||
    !Number.isInteger(props.max) ||
    props.min < 1 ||
    props.max > 100 ||
    props.min > props.max
  ) {
    return Effect.fail(
      new RenderApiError(
        "Render autoscaling requires integer bounds with 1 <= min <= max <= 100",
      ),
    );
  }
  for (const [name, criterion] of Object.entries(props.criteria)) {
    if (
      criterion !== undefined &&
      (!Number.isInteger(criterion.percentage) ||
        criterion.percentage < (criterion.enabled ? 1 : 0) ||
        criterion.percentage > 100)
    ) {
      return Effect.fail(
        new RenderApiError(
          `Render autoscaling ${name} percentage must be an integer between ${criterion.enabled ? 1 : 0} and 100`,
        ),
      );
    }
  }
  return Effect.void;
};

export const AutoscalingProvider = () =>
  Provider.effect(
    resourceClass(Autoscaling),
    Effect.gen(function* () {
      const getApi = yield* RenderApi;
      const observe = (p: AutoscalingProps, owned: boolean) =>
        Effect.gen(function* () {
          const api = yield* getApi;
          const data = unwrapEntity(
            yield* api.request({
              method: "GET",
              path: `/services/${encodeURIComponent(p.serviceId)}`,
            }),
          );
          const details =
            typeof data.serviceDetails === "object" &&
            data.serviceDetails !== null
              ? (data.serviceDetails as {
                  readonly autoscaling?: {
                    readonly enabled?: boolean;
                    readonly min?: number;
                    readonly max?: number;
                    readonly criteria?: AutoscalingProps["criteria"];
                  };
                })
              : {};
          if (!details.autoscaling || details.autoscaling.enabled !== true)
            return undefined;
          const value = {
            id: p.serviceId,
            serviceId: p.serviceId,
            enabled: true,
            min: details.autoscaling.min,
            max: details.autoscaling.max,
            criteria: normalizeAutoscalingCriteria(
              details.autoscaling.criteria ?? {},
            ),
          } as AutoscalingAttributes;
          return owned ? value : Unowned(value);
        }).pipe(
          Effect.catch((e: RenderApiError) =>
            e.isNotFound ? Effect.succeed(undefined) : Effect.fail(e),
          ),
        );
      return Autoscaling.Provider.of({
        stables: ["id", "serviceId"],
        nuke: { skip: true },
        list: () => Effect.succeed([]),
        read: ({ olds, output }) => observe(olds, !!output),
        diff: Effect.fn(function* ({ olds, news, output }) {
          if (!isResolved(news)) return undefined;
          yield* validateAutoscaling(news);
          return olds.serviceId !== news.serviceId
            ? { action: "replace" as const }
            : !output ||
                output.min !== news.min ||
                output.max !== news.max ||
                JSON.stringify(output.criteria) !==
                  JSON.stringify(normalizeAutoscalingCriteria(news.criteria))
              ? { action: "update" as const }
              : undefined;
        }),
        reconcile: Effect.fn(function* ({ news }) {
          yield* validateAutoscaling(news);
          const api = yield* getApi;
          yield* api.request({
            method: "PUT",
            path: `/services/${encodeURIComponent(news.serviceId)}/autoscaling`,
            body: {
              enabled: news.enabled ?? true,
              min: news.min,
              max: news.max,
              criteria: normalizeAutoscalingCriteria(news.criteria),
            },
          });
          return autoAttrs(news);
        }),
        delete: Effect.fn(function* ({ output }) {
          const api = yield* getApi;
          yield* api
            .request({
              method: "DELETE",
              path: `/services/${encodeURIComponent(output.serviceId)}/autoscaling`,
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
