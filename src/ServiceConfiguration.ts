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
  restProvider,
  reveal,
  unwrapEntity,
  type CommonAttributes,
} from "./RestResource.js";

export interface ServiceEnvVarProps {
  readonly serviceId: string;
  readonly key: string;
  readonly value?: Redacted.Redacted<string>;
  readonly generateValue?: true;
}
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
export interface DiskAttributes extends ServiceChildAttributes {
  readonly diskId: string;
  readonly mountPath?: string;
  readonly sizeGB?: number;
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
export type Route = Managed<"Render.Route", RouteProps, ServiceChildAttributes>;
export const Route = Resource.Resource<Route>("Render.Route");
/** Autoscaling configuration managed separately from the service. @resource */
export type Autoscaling = Managed<
  "Render.Autoscaling",
  AutoscalingProps,
  AutoscalingAttributes
>;
export const Autoscaling = Resource.Resource<Autoscaling>("Render.Autoscaling");

const secretAttrs = (
  e: Record<string, unknown>,
  f: { id: string; previous?: SecretValueAttributes; props?: unknown },
): SecretValueAttributes => {
  const generateValue =
    typeof f.props === "object" &&
    f.props !== null &&
    (f.props as { readonly generateValue?: unknown }).generateValue === true;
  return {
    id: f.id,
    generated: f.previous?.generated ?? generateValue,
    ...(typeof e.key === "string"
      ? { name: e.key }
      : typeof e.name === "string"
        ? { name: e.name }
        : {}),
    ...(f.previous?.valueDigest ? { valueDigest: f.previous.valueDigest } : {}),
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
    createPath: (key, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/env-vars/${encodeURIComponent(key)}`,
    updateMethod: "PUT",
    remoteDiff: false,
    existingSatisfies: (_entity, props) =>
      props.generateValue === true && props.value === undefined,
    sensitiveChanged: (_olds, news, output) =>
      news.value === undefined
        ? !output.generated
        : output.valueDigest !== digest(news.value),
    body: (p) => {
      if (p.value && p.generateValue)
        throw new Error(
          "ServiceEnvVar accepts either value or generateValue, not both",
        );
      if (!p.value && !p.generateValue)
        throw new Error("ServiceEnvVar requires value or generateValue: true");
      return p.value ? { value: reveal(p.value) } : { generateValue: true };
    },
    attributes: secretAttrs,
    afterWrite: (a, p) => {
      const { valueDigest: _oldDigest, ...rest } = a;
      return {
        ...rest,
        generated: p.value === undefined,
        ...(p.value ? { valueDigest: digest(p.value) } : {}),
      };
    },
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
    attributes: childAttrs,
    afterWrite: (a, p) => ({ ...a, serviceId: p.serviceId }),
  });
export const DiskProvider = () =>
  restProvider(Disk, {
    collection: "/disks",
    item: (id) => `/disks/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["diskId", "serviceId"],
    immutable: ["serviceId"],
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
      };
    },
  });
export const HeaderProvider = () =>
  restProvider(Header, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/headers`,
    item: (id, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/headers/${encodeURIComponent(id)}`,
    listable: false,
    nukeSkip: true,
    stables: ["serviceId"],
    lookupByList: true,
    remoteMismatchAction: "replace",
    immutable: ["serviceId", "name", "path", "value"],
    matches: (e, _id, p) => e.name === p.name && e.path === p.path,
    body: (p, name) => ({ name, path: p.path, value: p.value }),
    attributes: childAttrs,
    afterWrite: (a, p) => ({ ...a, serviceId: p.serviceId }),
  });
export const RouteProvider = () =>
  restProvider(Route, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/routes`,
    item: (id, p) =>
      `/services/${encodeURIComponent(p.serviceId)}/routes/${encodeURIComponent(id)}`,
    listable: false,
    nukeSkip: true,
    stables: ["serviceId"],
    lookupByList: true,
    remoteMismatchAction: "replace",
    immutable: ["serviceId", "source", "destination", "type"],
    resolveIdentity: (id) => Effect.succeed(id),
    matches: (e, _id, p) => e.source === p.source && e.type === p.type,
    body: (p) => ({
      source: p.source,
      destination: p.destination,
      type: p.type,
    }),
    attributes: childAttrs,
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
        diff: ({ olds, news, output }) =>
          Effect.succeed(
            !isResolved(news)
              ? undefined
              : olds.serviceId !== news.serviceId
                ? { action: "replace" as const }
                : !output ||
                    output.min !== news.min ||
                    output.max !== news.max ||
                    JSON.stringify(output.criteria) !==
                      JSON.stringify(
                        normalizeAutoscalingCriteria(news.criteria),
                      )
                  ? { action: "update" as const }
                  : undefined,
          ),
        reconcile: Effect.fn(function* ({ news }) {
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
