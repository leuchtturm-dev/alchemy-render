import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { paginate, poll, RenderApi, RenderApiError } from "./Api/Api.js";
import type { components } from "./Api/schema.js";
import type { Providers } from "./Providers.js";
import type { Region } from "./Services.js";
import {
  resourceClass,
  digest,
  restProvider,
  reveal,
  unwrapEntity,
  unwrapRows,
  type CommonAttributes,
} from "./RestResource.js";

export interface DedicatedIpProps {
  readonly name?: string;
  readonly description?: string;
  readonly region: Region;
  readonly environmentIds?: readonly string[];
}
export interface DedicatedIpAttributes extends CommonAttributes {
  readonly dedicatedIpId: string;
  readonly description?: string;
  readonly region?: Region;
  readonly environmentIds: readonly string[];
  readonly ips: readonly string[];
}
export interface RegistryCredentialProps {
  readonly name?: string;
  readonly registry:
    | "GITHUB"
    | "GITLAB"
    | "DOCKER"
    | "GOOGLE_ARTIFACT"
    | "AWS_ECR";
  readonly username: string;
  readonly authToken: Redacted.Redacted<string>;
}
export interface RegistryCredentialAttributes extends CommonAttributes {
  readonly registryCredentialId: string;
  readonly registry?: RegistryCredentialProps["registry"];
  readonly username?: string;
  readonly authTokenDigest?: string;
}
export type WebhookEvent =
  components["schemas"]["webhookEventWithCursor"]["webhookEvent"]["eventType"];

export interface WebhookProps {
  readonly name?: string;
  readonly url: string;
  readonly enabled?: boolean;
  /** An empty list subscribes the webhook to every event type. */
  readonly eventFilter?: readonly WebhookEvent[];
}
export interface WebhookAttributes extends CommonAttributes {
  readonly webhookId: string;
  readonly url?: string;
  readonly enabled?: boolean;
  readonly eventFilter?: readonly string[];
  readonly signingSecret?: Redacted.Redacted<string>;
}
export interface LogStreamProps {
  readonly endpoint?: string;
  /** Set null to clear a configured token. */
  readonly token?: Redacted.Redacted<string> | null;
  readonly preview: "send" | "drop";
}
export interface OwnerLogStreamAttributes extends CommonAttributes {
  readonly ownerId: string;
  readonly endpoint?: string;
  readonly preview?: "send" | "drop";
  readonly tokenDigest?: string;
}
export interface ResourceLogStreamProps {
  readonly resourceId: string;
  readonly endpoint?: string;
  /** Set null to clear a configured token. */
  readonly token?: Redacted.Redacted<string> | null;
  readonly setting: "send" | "drop";
}
export interface ResourceLogStreamAttributes extends CommonAttributes {
  readonly resourceId: string;
  readonly endpoint?: string;
  readonly setting?: "send" | "drop";
  readonly tokenDigest?: string;
}
export interface MetricsStreamProps {
  readonly provider:
    | "BETTER_STACK"
    | "GRAFANA"
    | "DATADOG"
    | "NEW_RELIC"
    | "HONEYCOMB"
    | "SIGNOZ"
    | "GROUNDCOVER"
    | "LOGFIRE"
    | "CUSTOM";
  readonly url: string;
  /** Set null to clear a configured token. */
  readonly token?: Redacted.Redacted<string> | null;
}
export interface MetricsStreamAttributes extends CommonAttributes {
  readonly ownerId: string;
  readonly provider?: MetricsStreamProps["provider"];
  readonly url?: string;
  readonly tokenDigest?: string;
}
export interface ServiceNotificationOverrideProps {
  readonly serviceId: string;
  readonly previewNotificationsEnabled?: boolean;
  readonly notificationsToSend?: "none" | "failure" | "all";
}
export interface ServiceNotificationOverrideAttributes
  extends CommonAttributes {
  readonly serviceId: string;
  readonly previewNotificationsEnabled: "default" | "false" | "true";
  readonly notificationsToSend: "default" | "none" | "failure" | "all";
}
export interface WorkflowBuildConfig {
  readonly branch?: string;
  readonly buildCommand: string;
  readonly repo: string;
  readonly rootDir?: string;
  readonly runtime: "elixir" | "go" | "node" | "python" | "ruby";
}
export interface WorkflowProps {
  readonly name?: string;
  readonly buildConfig: WorkflowBuildConfig;
  readonly runCommand: string;
  readonly region: "frankfurt" | "oregon" | "ohio" | "singapore" | "virginia";
  readonly autoDeployTrigger?: "commit" | "off" | "checksPass";
  readonly envVars?: readonly {
    readonly key: string;
    readonly value: Redacted.Redacted<string>;
  }[];
}
export interface WorkflowAttributes extends CommonAttributes {
  readonly workflowId: string;
  readonly region?: string;
  readonly environmentId?: string;
  readonly autoDeployTrigger?: string;
  readonly envVarsDigest?: string;
}

type Managed<
  T extends string,
  P extends object,
  A extends object,
> = Resource.Resource<T, P, A, never, Providers>;
export type DedicatedIp = Managed<
  "Render.DedicatedIp",
  DedicatedIpProps,
  DedicatedIpAttributes
>;
export const DedicatedIp = Resource.Resource<DedicatedIp>("Render.DedicatedIp");
export type RegistryCredential = Managed<
  "Render.RegistryCredential",
  RegistryCredentialProps,
  RegistryCredentialAttributes
>;
export const RegistryCredential = Resource.Resource<RegistryCredential>(
  "Render.RegistryCredential",
);
export type Webhook = Managed<
  "Render.Webhook",
  WebhookProps,
  WebhookAttributes
>;
export const Webhook = Resource.Resource<Webhook>("Render.Webhook");
export type OwnerLogStream = Managed<
  "Render.OwnerLogStream",
  LogStreamProps,
  OwnerLogStreamAttributes
>;
export const OwnerLogStream = Resource.Resource<OwnerLogStream>(
  "Render.OwnerLogStream",
);
export type ResourceLogStream = Managed<
  "Render.ResourceLogStream",
  ResourceLogStreamProps,
  ResourceLogStreamAttributes
>;
export const ResourceLogStream = Resource.Resource<ResourceLogStream>(
  "Render.ResourceLogStream",
);
export type MetricsStream = Managed<
  "Render.MetricsStream",
  MetricsStreamProps,
  MetricsStreamAttributes
>;
export const MetricsStream = Resource.Resource<MetricsStream>(
  "Render.MetricsStream",
);
export type Workflow = Managed<
  "Render.Workflow",
  WorkflowProps,
  WorkflowAttributes
>;
export const Workflow = Resource.Resource<Workflow>("Render.Workflow");
/** Per-service notification settings. Delete restores both values to workspace defaults. @resource */
export type ServiceNotificationOverride = Managed<
  "Render.ServiceNotificationOverride",
  ServiceNotificationOverrideProps,
  ServiceNotificationOverrideAttributes
>;
export const ServiceNotificationOverride =
  Resource.Resource<ServiceNotificationOverride>(
    "Render.ServiceNotificationOverride",
  );

const string = (e: Record<string, unknown>, key: string) =>
  typeof e[key] === "string" ? (e[key] as string) : undefined;
const dedicatedAttrs = (
  e: Record<string, unknown>,
  f: { id: string; ownerId: string },
): DedicatedIpAttributes => {
  const id = string(e, "id") ?? f.id;
  const region =
    string(e, "region") ??
    (typeof e.region === "object" && e.region !== null
      ? string(e.region as Record<string, unknown>, "name")
      : undefined);
  return {
    id,
    dedicatedIpId: id,
    ownerId: f.ownerId,
    environmentIds: Array.isArray(e.environmentIds)
      ? e.environmentIds.filter((v): v is string => typeof v === "string")
      : [],
    ips: Array.isArray(e.ips)
      ? e.ips.filter((v): v is string => typeof v === "string")
      : [],
    ...(string(e, "name") ? { name: string(e, "name")! } : {}),
    ...(string(e, "description")
      ? { description: string(e, "description")! }
      : {}),
    ...(region ? { region: region as Region } : {}),
    ...(string(e, "status") ? { status: string(e, "status")! } : {}),
  };
};
export const DedicatedIpProvider = () =>
  restProvider(DedicatedIp, {
    collection: "/dedicated-ips",
    item: (id) => `/dedicated-ips/${encodeURIComponent(id)}`,
    ownerScoped: true,
    paginated: false,
    nameFilter: false,
    stables: ["dedicatedIpId"],
    immutable: ["region"],
    attributes: dedicatedAttrs,
    body: (p, name, ownerId) => ({
      name,
      ownerId,
      region: p.region,
      description: p.description ?? "",
      environmentIds: p.environmentIds ?? [],
    }),
    updateBody: (p, name) => ({
      name,
      description: p.description ?? "",
      environmentIds: p.environmentIds ?? [],
    }),
    finalize: (attributes, _props, api) =>
      attributes.status !== "CREATING" && attributes.status !== "PENDING"
        ? Effect.succeed(attributes)
        : poll(
            api
              .request({
                method: "GET",
                path: `/dedicated-ips/${encodeURIComponent(attributes.dedicatedIpId)}`,
              })
              .pipe(
                Effect.map((value) =>
                  dedicatedAttrs(unwrapEntity(value), {
                    id: attributes.dedicatedIpId,
                    ownerId: api.ownerId,
                  }),
                ),
              ),
            {
              timeoutMs: 15 * 60 * 1_000,
              while: (value) =>
                value.status === "CREATING" || value.status === "PENDING",
            },
          ).pipe(
            Effect.flatMap((value) =>
              value.status === "FAILED" ||
              value.status === "DELETING" ||
              value.status === "DELETED"
                ? Effect.fail(
                    new RenderApiError(
                      `Dedicated IP provisioning ended in ${value.status}`,
                    ),
                  )
                : Effect.succeed(value),
            ),
          ),
  });

const registryAttrs = (
  e: Record<string, unknown>,
  f: { id: string; ownerId: string; previous?: RegistryCredentialAttributes },
): RegistryCredentialAttributes => {
  const id = string(e, "id") ?? f.id;
  return {
    id,
    registryCredentialId: id,
    ownerId: f.ownerId,
    ...(string(e, "name") ? { name: string(e, "name")! } : {}),
    ...(string(e, "registry")
      ? {
          registry: string(
            e,
            "registry",
          ) as RegistryCredentialProps["registry"],
        }
      : {}),
    ...(string(e, "username") ? { username: string(e, "username")! } : {}),
    ...(f.previous?.authTokenDigest
      ? { authTokenDigest: f.previous.authTokenDigest }
      : {}),
  };
};
export const RegistryCredentialProvider = () =>
  restProvider(RegistryCredential, {
    collection: "/registrycredentials",
    item: (id) => `/registrycredentials/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["registryCredentialId"],
    attributes: registryAttrs,
    remoteDiff: false,
    sensitiveChanged: (_olds, p, o) =>
      (p.name !== undefined && o.name !== p.name) ||
      o.registry !== p.registry ||
      o.username !== p.username ||
      o.authTokenDigest !== digest(p.authToken),
    body: (p, name, ownerId) => ({
      registry: p.registry,
      name,
      username: p.username,
      authToken: reveal(p.authToken),
      ownerId,
    }),
    updateBody: (p, name) => ({
      registry: p.registry,
      name,
      username: p.username,
      authToken: reveal(p.authToken),
    }),
    afterWrite: (a, p) => ({ ...a, authTokenDigest: digest(p.authToken) }),
  });

const webhookAttrs = (
  e: Record<string, unknown>,
  f: { id: string; ownerId: string; previous?: WebhookAttributes },
): WebhookAttributes => {
  const id = string(e, "id") ?? f.id;
  const signingSecret =
    typeof e.secret === "string"
      ? Redacted.make(e.secret)
      : f.previous?.signingSecret;
  return {
    id,
    webhookId: id,
    ownerId: f.ownerId,
    ...(string(e, "name") ? { name: string(e, "name")! } : {}),
    ...(string(e, "url") ? { url: string(e, "url")! } : {}),
    ...(typeof e.enabled === "boolean" ? { enabled: e.enabled } : {}),
    ...(Array.isArray(e.eventFilter)
      ? {
          eventFilter: e.eventFilter.filter(
            (v): v is string => typeof v === "string",
          ),
        }
      : {}),
    ...(signingSecret ? { signingSecret } : {}),
  };
};
export const WebhookProvider = () =>
  restProvider(Webhook, {
    collection: "/webhooks",
    item: (id) => `/webhooks/${encodeURIComponent(id)}`,
    ownerScoped: true,
    nameFilter: false,
    stables: ["webhookId"],
    attributes: webhookAttrs,
    body: (p, name, ownerId) => ({
      ownerId,
      name,
      url: p.url,
      enabled: p.enabled ?? true,
      eventFilter: p.eventFilter ?? [],
    }),
    updateBody: (p, name) => ({
      name,
      url: p.url,
      enabled: p.enabled ?? true,
      eventFilter: p.eventFilter ?? [],
    }),
  });

const resourceLogAttrs = (
  e: Record<string, unknown>,
  f: { id: string; previous?: ResourceLogStreamAttributes },
): ResourceLogStreamAttributes => ({
  id: string(e, "resourceId") ?? f.id,
  resourceId: string(e, "resourceId") ?? f.id,
  ...(string(e, "endpoint") ? { endpoint: string(e, "endpoint")! } : {}),
  ...(string(e, "setting")
    ? { setting: string(e, "setting") as "send" | "drop" }
    : {}),
  ...(f.previous?.tokenDigest ? { tokenDigest: f.previous.tokenDigest } : {}),
});
export const ResourceLogStreamProvider = () =>
  restProvider(ResourceLogStream, {
    collection: "/logs/streams/resource",
    item: (id) => `/logs/streams/resource/${encodeURIComponent(id)}`,
    ownerScoped: true,
    identity: "id",
    stables: ["resourceId"],
    resolveIdentity: (_id, p) => Effect.succeed(p.resourceId),
    immutable: ["resourceId"],
    createMethod: "PUT",
    updateMethod: "PUT",
    createPath: (id) => `/logs/streams/resource/${encodeURIComponent(id)}`,
    attributes: resourceLogAttrs,
    remoteDiff: false,
    sensitiveChanged: (_olds, p, o) =>
      o.endpoint !== p.endpoint ||
      o.setting !== p.setting ||
      (p.token === null
        ? o.tokenDigest !== undefined
        : p.token !== undefined && o.tokenDigest !== digest(p.token)),
    body: (p) => ({
      endpoint: p.endpoint,
      setting: p.setting,
      ...(p.token === null
        ? { token: "" }
        : p.token
          ? { token: reveal(p.token) }
          : {}),
    }),
    afterWrite: (a, p) => {
      const { tokenDigest: oldDigest, ...rest } = a;
      const nextDigest =
        p.token === undefined
          ? oldDigest
          : p.token === null
            ? undefined
            : digest(p.token);
      return {
        ...rest,
        resourceId: p.resourceId,
        ...(nextDigest ? { tokenDigest: nextDigest } : {}),
      };
    },
  });

const workflowEnvDigest = (envVars: WorkflowProps["envVars"]) =>
  envVars === undefined
    ? undefined
    : digest(
        Redacted.make(
          JSON.stringify(
            [...envVars]
              .sort((left, right) => left.key.localeCompare(right.key))
              .map(({ key, value }) => ({
                key,
                value: Redacted.value(value),
              })),
          ),
        ),
      );
const workflowAttrs = (
  e: Record<string, unknown>,
  f: { id: string; ownerId: string; previous?: WorkflowAttributes },
): WorkflowAttributes => {
  const id = string(e, "id") ?? f.id;
  return {
    id,
    workflowId: id,
    ownerId: f.ownerId,
    ...(string(e, "name") ? { name: string(e, "name")! } : {}),
    ...(string(e, "region") ? { region: string(e, "region")! } : {}),
    ...(string(e, "environmentId")
      ? { environmentId: string(e, "environmentId")! }
      : {}),
    ...(string(e, "autoDeployTrigger")
      ? { autoDeployTrigger: string(e, "autoDeployTrigger")! }
      : {}),
    ...(f.previous?.envVarsDigest
      ? { envVarsDigest: f.previous.envVarsDigest }
      : {}),
    ...(string(e, "createdAt") ? { createdAt: string(e, "createdAt")! } : {}),
    ...(string(e, "updatedAt") ? { updatedAt: string(e, "updatedAt")! } : {}),
  };
};
export const WorkflowProvider = () =>
  restProvider(Workflow, {
    collection: "/workflows",
    item: (id) => `/workflows/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["workflowId"],
    immutable: ["region"],
    attributes: workflowAttrs,
    observe: (entity) => ({
      ...entity,
      autoDeployTrigger: entity.autoDeployTrigger ?? "commit",
    }),
    replaceWhen: (_olds, props, output) =>
      output.envVarsDigest !== workflowEnvDigest(props.envVars),
    body: (p, name, ownerId) => ({
      name,
      ownerId,
      buildConfig: p.buildConfig,
      runCommand: p.runCommand,
      region: p.region,
      autoDeployTrigger: p.autoDeployTrigger ?? "commit",
      envVars: p.envVars?.map((entry) => ({
        key: entry.key,
        value: Redacted.value(entry.value),
      })),
    }),
    updateBody: (p, name) => ({
      name,
      buildConfig: p.buildConfig,
      runCommand: p.runCommand,
      autoDeployTrigger: p.autoDeployTrigger ?? "commit",
    }),
    afterWrite: (attributes, props) => {
      const { envVarsDigest: _oldDigest, ...rest } = attributes;
      const nextDigest = workflowEnvDigest(props.envVars);
      return { ...rest, ...(nextDigest ? { envVarsDigest: nextDigest } : {}) };
    },
  });

const ignore404 = <A>(effect: Effect.Effect<A, RenderApiError>) =>
  effect.pipe(
    Effect.catch((e) =>
      e.isNotFound ? Effect.succeed(undefined) : Effect.fail(e),
    ),
  );
export const OwnerLogStreamProvider = () =>
  Provider.effect(
    resourceClass(OwnerLogStream),
    Effect.gen(function* () {
      const getApi = yield* RenderApi;
      const read = (previous?: OwnerLogStreamAttributes) =>
        Effect.gen(function* () {
          const api = yield* getApi;
          const e = unwrapEntity(
            yield* api.request({
              method: "GET",
              path: `/logs/streams/owner/${encodeURIComponent(api.ownerId)}`,
            }),
          );
          return {
            id: api.ownerId,
            ownerId: api.ownerId,
            ...(string(e, "endpoint")
              ? { endpoint: string(e, "endpoint")! }
              : {}),
            ...(string(e, "preview")
              ? { preview: string(e, "preview") as "send" | "drop" }
              : {}),
            ...(previous?.tokenDigest
              ? { tokenDigest: previous.tokenDigest }
              : {}),
          } satisfies OwnerLogStreamAttributes;
        }).pipe(ignore404);
      return OwnerLogStream.Provider.of({
        stables: ["id", "ownerId"],
        list: () => read().pipe(Effect.map((v) => (v ? [v] : []))),
        read: ({ output }) =>
          read(output).pipe(Effect.map((v) => (!v || output ? v : Unowned(v)))),
        diff: ({ news, output }) =>
          Effect.succeed(
            !isResolved(news) || !output
              ? undefined
              : output.endpoint !== news.endpoint ||
                  output.preview !== news.preview ||
                  (news.token === null
                    ? output.tokenDigest !== undefined
                    : news.token !== undefined &&
                      output.tokenDigest !== digest(news.token))
                ? { action: "update" as const }
                : undefined,
          ),
        reconcile: Effect.fn(function* ({ news, output }) {
          const api = yield* getApi;
          const e = unwrapEntity(
            yield* api.request({
              method: "PUT",
              path: `/logs/streams/owner/${encodeURIComponent(api.ownerId)}`,
              body: {
                endpoint: news.endpoint,
                preview: news.preview,
                ...(news.token === null
                  ? { token: "" }
                  : news.token
                    ? { token: reveal(news.token) }
                    : {}),
              },
            }),
          );
          return {
            id: api.ownerId,
            ownerId: api.ownerId,
            ...(string(e, "endpoint")
              ? { endpoint: string(e, "endpoint")! }
              : {}),
            preview: news.preview,
            ...(news.token
              ? { tokenDigest: digest(news.token) }
              : news.token === undefined && output?.tokenDigest
                ? { tokenDigest: output.tokenDigest }
                : {}),
          };
        }),
        delete: Effect.fn(function* () {
          const api = yield* getApi;
          yield* ignore404(
            api.request({
              method: "DELETE",
              path: `/logs/streams/owner/${encodeURIComponent(api.ownerId)}`,
            }),
          ).pipe(Effect.asVoid);
        }),
      });
    }),
  );

export const MetricsStreamProvider = () =>
  Provider.effect(
    resourceClass(MetricsStream),
    Effect.gen(function* () {
      const getApi = yield* RenderApi;
      const read = (previous?: MetricsStreamAttributes) =>
        Effect.gen(function* () {
          const api = yield* getApi;
          const e = unwrapEntity(
            yield* api.request({
              method: "GET",
              path: `/metrics-stream/${encodeURIComponent(api.ownerId)}`,
            }),
          );
          return {
            id: api.ownerId,
            ownerId: api.ownerId,
            ...(string(e, "provider")
              ? {
                  provider: string(
                    e,
                    "provider",
                  ) as MetricsStreamProps["provider"],
                }
              : {}),
            ...(string(e, "url") ? { url: string(e, "url")! } : {}),
            ...(previous?.tokenDigest
              ? { tokenDigest: previous.tokenDigest }
              : {}),
          } satisfies MetricsStreamAttributes;
        }).pipe(ignore404);
      return MetricsStream.Provider.of({
        stables: ["id", "ownerId"],
        list: () => read().pipe(Effect.map((v) => (v ? [v] : []))),
        read: ({ output }) =>
          read(output).pipe(Effect.map((v) => (!v || output ? v : Unowned(v)))),
        diff: ({ news, output }) =>
          Effect.succeed(
            !isResolved(news) || !output
              ? undefined
              : output.provider !== news.provider ||
                  output.url !== news.url ||
                  (news.token === null
                    ? output.tokenDigest !== undefined
                    : news.token !== undefined &&
                      output.tokenDigest !== digest(news.token))
                ? { action: "update" as const }
                : undefined,
          ),
        reconcile: Effect.fn(function* ({ news, output }) {
          const api = yield* getApi;
          const e = unwrapEntity(
            yield* api.request({
              method: "PUT",
              path: `/metrics-stream/${encodeURIComponent(api.ownerId)}`,
              body: {
                provider: news.provider,
                url: news.url,
                ...(news.token === null
                  ? { token: "" }
                  : news.token
                    ? { token: reveal(news.token) }
                    : {}),
              },
            }),
          );
          return {
            id: api.ownerId,
            ownerId: api.ownerId,
            ...(string(e, "provider")
              ? {
                  provider: string(
                    e,
                    "provider",
                  ) as MetricsStreamProps["provider"],
                }
              : {}),
            ...(string(e, "url") ? { url: string(e, "url")! } : {}),
            ...(news.token
              ? { tokenDigest: digest(news.token) }
              : news.token === undefined && output?.tokenDigest
                ? { tokenDigest: output.tokenDigest }
                : {}),
          };
        }),
        delete: Effect.fn(function* () {
          const api = yield* getApi;
          yield* ignore404(
            api.request({
              method: "DELETE",
              path: `/metrics-stream/${encodeURIComponent(api.ownerId)}`,
            }),
          ).pipe(Effect.asVoid);
        }),
      });
    }),
  );

const notificationAttributes = (
  entity: Record<string, unknown>,
  serviceId: string,
): ServiceNotificationOverrideAttributes => ({
  id: serviceId,
  serviceId,
  previewNotificationsEnabled:
    entity.previewNotificationsEnabled === "true" ||
    entity.previewNotificationsEnabled === "false"
      ? entity.previewNotificationsEnabled
      : "default",
  notificationsToSend:
    entity.notificationsToSend === "none" ||
    entity.notificationsToSend === "failure" ||
    entity.notificationsToSend === "all"
      ? entity.notificationsToSend
      : "default",
});

export const ServiceNotificationOverrideProvider = () =>
  Provider.effect(
    resourceClass(ServiceNotificationOverride),
    Effect.gen(function* () {
      const getApi = yield* RenderApi;
      const read = (serviceId: string, owned: boolean) =>
        Effect.gen(function* () {
          const api = yield* getApi;
          const attributes = notificationAttributes(
            unwrapEntity(
              yield* api.request({
                method: "GET",
                path: `/notification-settings/overrides/services/${encodeURIComponent(serviceId)}`,
              }),
            ),
            serviceId,
          );
          if (
            !owned &&
            attributes.previewNotificationsEnabled === "default" &&
            attributes.notificationsToSend === "default"
          ) {
            return undefined;
          }
          return owned ? attributes : Unowned(attributes);
        }).pipe(ignore404);

      return ServiceNotificationOverride.Provider.of({
        stables: ["id", "serviceId"],
        list: Effect.fn(function* () {
          const api = yield* getApi;
          const rows = yield* paginate(
            (cursor) =>
              api
                .request({
                  method: "GET",
                  path: "/notification-settings/overrides",
                  query: {
                    ownerId: [api.ownerId],
                    limit: 100,
                    ...(cursor === undefined ? {} : { cursor }),
                  },
                })
                .pipe(Effect.map(unwrapRows)),
            { cursor: (row) => row.cursor },
          );
          return rows.flatMap(({ entity }) => {
            const serviceId = string(entity, "serviceId");
            return serviceId ? [notificationAttributes(entity, serviceId)] : [];
          });
        }),
        read: ({ olds, output }) => read(olds.serviceId, output !== undefined),
        diff: ({ olds, news, output }) =>
          Effect.succeed(
            !isResolved(news)
              ? undefined
              : olds.serviceId !== news.serviceId
                ? ({ action: "replace" } as const)
                : output &&
                    (output.previewNotificationsEnabled !==
                      String(news.previewNotificationsEnabled ?? "default") ||
                      output.notificationsToSend !==
                        (news.notificationsToSend ?? "default"))
                  ? ({ action: "update" } as const)
                  : undefined,
          ),
        reconcile: Effect.fn(function* ({ news }) {
          const api = yield* getApi;
          const entity = unwrapEntity(
            yield* api.request({
              method: "PATCH",
              path: `/notification-settings/overrides/services/${encodeURIComponent(news.serviceId)}`,
              body: {
                previewNotificationsEnabled: String(
                  news.previewNotificationsEnabled ?? "default",
                ),
                notificationsToSend: news.notificationsToSend ?? "default",
              },
            }),
          );
          return notificationAttributes(entity, news.serviceId);
        }),
        delete: Effect.fn(function* ({ output }) {
          const api = yield* getApi;
          yield* ignore404(
            api.request({
              method: "PATCH",
              path: `/notification-settings/overrides/services/${encodeURIComponent(output.serviceId)}`,
              body: {
                previewNotificationsEnabled: "default",
                notificationsToSend: "default",
              },
            }),
          ).pipe(Effect.asVoid);
        }),
      });
    }),
  );
