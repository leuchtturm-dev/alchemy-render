import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { poll, RenderApiError, type RenderApiClient } from "./Api/Api.js";
import type { Providers } from "./Providers.js";
import {
  digest,
  restProvider,
  unwrapEntity,
  type CommonAttributes,
} from "./RestResource.js";
import type { Region } from "./Services.js";

export interface DatastoreIpRule {
  readonly cidrBlock: string;
  readonly description?: string;
}

export type PostgresPlan =
  | "free"
  | "starter"
  | "standard"
  | "pro"
  | "pro_plus"
  | "custom"
  | "basic_256mb"
  | "basic_1gb"
  | "basic_4gb"
  | "pro_4gb"
  | "pro_8gb"
  | "pro_16gb"
  | "pro_32gb"
  | "pro_64gb"
  | "pro_128gb"
  | "pro_192gb"
  | "pro_256gb"
  | "pro_384gb"
  | "pro_512gb"
  | "accelerated_16gb"
  | "accelerated_32gb"
  | "accelerated_64gb"
  | "accelerated_128gb"
  | "accelerated_256gb"
  | "accelerated_384gb"
  | "accelerated_512gb"
  | "accelerated_768gb"
  | "accelerated_1024gb";

export interface PostgresProps {
  readonly name?: string;
  readonly databaseName?: string;
  readonly databaseUser?: string;
  readonly plan: PostgresPlan;
  readonly region?: Region;
  readonly version: "11" | "12" | "13" | "14" | "15" | "16" | "17" | "18";
  readonly diskSizeGB?: number;
  readonly enableHighAvailability?: boolean;
  readonly enableDiskAutoscaling?: boolean;
  readonly connectionPool?: "none" | "pgbouncer";
  readonly environmentId?: string;
  readonly ipAllowList?: readonly DatastoreIpRule[];
  readonly parameterOverrides?: Readonly<Record<string, string>>;
  readonly readReplicas?: readonly {
    readonly name: string;
    readonly parameterOverrides?: Readonly<Record<string, string>>;
  }[];
  readonly datadogApiKey?: Redacted.Redacted<string>;
  readonly datadogSite?: string;
}

export type KeyValuePlan =
  | "free"
  | "starter"
  | "standard"
  | "pro"
  | "pro_plus"
  | "custom";

export interface KeyValueProps {
  readonly name?: string;
  readonly plan: KeyValuePlan;
  readonly region?: Region;
  readonly environmentId?: string;
  readonly maxmemoryPolicy:
    | "noeviction"
    | "allkeys_lfu"
    | "allkeys_lru"
    | "allkeys_random"
    | "volatile_lfu"
    | "volatile_lru"
    | "volatile_random"
    | "volatile_ttl";
  readonly persistenceMode?: "journal_snapshot" | "snapshot" | "off";
  readonly ipAllowList?: readonly DatastoreIpRule[];
}

export interface RedisProps extends KeyValueProps {}

export interface DatastoreConnectionInfo {
  readonly internalConnectionString?: Redacted.Redacted<string>;
  readonly externalConnectionString?: Redacted.Redacted<string>;
  readonly internalConnectionPoolString?: Redacted.Redacted<string>;
  readonly externalConnectionPoolString?: Redacted.Redacted<string>;
  readonly password?: Redacted.Redacted<string>;
  readonly command?: Redacted.Redacted<string>;
}

export interface DatastoreAttributes extends CommonAttributes {
  readonly datastoreId: string;
  readonly plan?: string;
  readonly region?: Region;
  readonly dashboardUrl?: string;
  readonly version?: string;
  readonly databaseName?: string;
  readonly databaseUser?: string;
  readonly environmentId?: string;
  readonly connectionInfo?: DatastoreConnectionInfo;
  readonly datadogApiKeyDigest?: string;
  readonly datadogSite?: string;
}

type Store<T extends string, P extends object> = Resource.Resource<
  T,
  P,
  DatastoreAttributes,
  never,
  Providers
>;

/** A managed Render Postgres database. Connection values are Redacted. @resource */
export type Postgres = Store<"Render.Postgres", PostgresProps>;
export const Postgres = Resource.Resource<Postgres>("Render.Postgres");
/** A managed Render Key Value instance. @resource */
export type KeyValue = Store<"Render.KeyValue", KeyValueProps>;
export const KeyValue = Resource.Resource<KeyValue>("Render.KeyValue");
/** @deprecated Render Redis is superseded by Key Value. @resource */
export type Redis = Store<"Render.Redis", RedisProps>;
export const Redis = Resource.Resource<Redis>("Render.Redis");

const string = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const attrs = (
  entity: Record<string, unknown>,
  fallback: { id: string; ownerId: string; previous?: DatastoreAttributes },
): DatastoreAttributes => {
  const id = string(entity.id) ?? fallback.id;
  const region =
    string(entity.region) ??
    (typeof entity.region === "object" && entity.region !== null
      ? string((entity.region as Record<string, unknown>).name)
      : undefined);
  return {
    id,
    datastoreId: id,
    ownerId: fallback.ownerId,
    ...(string(entity.name) ? { name: string(entity.name)! } : {}),
    ...(string(entity.status) ? { status: string(entity.status)! } : {}),
    ...(string(entity.plan) ? { plan: string(entity.plan)! } : {}),
    ...(region ? { region: region as Region } : {}),
    ...(string(entity.dashboardUrl)
      ? { dashboardUrl: string(entity.dashboardUrl)! }
      : {}),
    ...(string(entity.version) ? { version: string(entity.version)! } : {}),
    ...(string(entity.databaseName)
      ? { databaseName: string(entity.databaseName)! }
      : {}),
    ...(string(entity.databaseUser)
      ? { databaseUser: string(entity.databaseUser)! }
      : {}),
    ...(string(entity.environmentId)
      ? { environmentId: string(entity.environmentId)! }
      : {}),
    ...(string(entity.createdAt)
      ? { createdAt: string(entity.createdAt)! }
      : {}),
    ...(string(entity.updatedAt)
      ? { updatedAt: string(entity.updatedAt)! }
      : {}),
    ...(fallback.previous?.connectionInfo
      ? { connectionInfo: fallback.previous.connectionInfo }
      : {}),
    ...(fallback.previous?.datadogApiKeyDigest
      ? { datadogApiKeyDigest: fallback.previous.datadogApiKeyDigest }
      : {}),
    ...(fallback.previous?.datadogSite
      ? { datadogSite: fallback.previous.datadogSite }
      : {}),
  };
};

const redactConnectionInfo = (value: unknown): DatastoreConnectionInfo => {
  const entity = unwrapEntity(value);
  const redact = (key: string) =>
    typeof entity[key] === "string"
      ? Redacted.make(entity[key] as string)
      : undefined;
  const command =
    redact("psqlCommand") ?? redact("cliCommand") ?? redact("redisCLICommand");
  return {
    ...(redact("internalConnectionString")
      ? { internalConnectionString: redact("internalConnectionString")! }
      : {}),
    ...(redact("externalConnectionString")
      ? { externalConnectionString: redact("externalConnectionString")! }
      : {}),
    ...(redact("internalConnectionPoolString")
      ? {
          internalConnectionPoolString: redact("internalConnectionPoolString")!,
        }
      : {}),
    ...(redact("externalConnectionPoolString")
      ? {
          externalConnectionPoolString: redact("externalConnectionPoolString")!,
        }
      : {}),
    ...(redact("password") ? { password: redact("password")! } : {}),
    ...(command ? { command } : {}),
  };
};

const hydrateConnection = (
  kind: "postgres" | "key-value" | "redis",
  attributes: DatastoreAttributes,
  api: RenderApiClient,
) =>
  Effect.gen(function* () {
    let current = attributes;
    const transient = new Set([
      "creating",
      "config_restart",
      "recovery_in_progress",
      "updating_instance",
    ]);
    if (current.status && transient.has(current.status)) {
      const entity = yield* poll(
        api
          .request({
            method: "GET",
            path: `/${kind}/${encodeURIComponent(current.datastoreId)}`,
          })
          .pipe(Effect.map(unwrapEntity)),
        {
          timeoutMs: 15 * 60 * 1_000,
          while: (row) => transient.has(String(row.status ?? "")),
        },
      );
      current = attrs(entity, {
        id: current.datastoreId,
        ownerId: current.ownerId ?? api.ownerId,
        previous: current,
      });
    }
    if (
      current.status === "unavailable" ||
      current.status === "recovery_failed"
    ) {
      return yield* Effect.fail(
        new RenderApiError(
          `Render ${kind} ${current.datastoreId} ended provisioning in ${current.status}`,
        ),
      );
    }
    const info = yield* api.request({
      method: "GET",
      path: `/${kind}/${encodeURIComponent(current.datastoreId)}/connection-info`,
    });
    return { ...current, connectionInfo: redactConnectionInfo(info) };
  });

const keyValueBody = (
  props: KeyValueProps,
  name: string,
  ownerId: string,
  create: boolean,
) => ({
  name,
  ...(create
    ? { ownerId, region: props.region, environmentId: props.environmentId }
    : {}),
  plan: props.plan,
  maxmemoryPolicy: props.maxmemoryPolicy,
  persistenceMode: props.persistenceMode,
  ipAllowList: props.ipAllowList ?? [],
});

const keyValueObserve = (entity: Record<string, unknown>) => {
  const options =
    typeof entity.options === "object" && entity.options !== null
      ? (entity.options as Record<string, unknown>)
      : {};
  return {
    name: entity.name,
    plan: entity.plan,
    maxmemoryPolicy: options.maxmemoryPolicy,
    persistenceMode: options.persistenceMode,
    ipAllowList: entity.ipAllowList,
  };
};

export const PostgresProvider = () =>
  restProvider(Postgres, {
    collection: "/postgres",
    item: (id) => `/postgres/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["datastoreId"],
    immutable: [
      "region",
      "version",
      "databaseName",
      "databaseUser",
      "environmentId",
    ],
    attributes: attrs,
    observe: (entity) => ({
      name: entity.name,
      plan: entity.plan,
      diskSizeGB: entity.diskSizeGB,
      enableHighAvailability: entity.highAvailabilityEnabled,
      enableDiskAutoscaling: entity.diskAutoscalingEnabled,
      connectionPool: entity.connectionPool,
      ipAllowList: entity.ipAllowList,
      parameterOverrides: entity.parameterOverrides,
      readReplicas: entity.readReplicas,
    }),
    body: (props, name, ownerId) => ({
      name,
      ownerId,
      databaseName: props.databaseName,
      databaseUser: props.databaseUser,
      plan: props.plan,
      region: props.region,
      version: props.version,
      diskSizeGB: props.diskSizeGB,
      enableHighAvailability: props.enableHighAvailability ?? false,
      enableDiskAutoscaling: props.enableDiskAutoscaling ?? false,
      connectionPool: props.connectionPool ?? "none",
      environmentId: props.environmentId,
      ipAllowList: props.ipAllowList,
      parameterOverrides: props.parameterOverrides,
      readReplicas: props.readReplicas,
      datadogAPIKey:
        props.datadogApiKey === undefined
          ? undefined
          : Redacted.value(props.datadogApiKey),
      datadogSite: props.datadogSite,
    }),
    updateBody: (props, name) => ({
      name,
      plan: props.plan,
      diskSizeGB: props.diskSizeGB,
      enableHighAvailability: props.enableHighAvailability ?? false,
      enableDiskAutoscaling: props.enableDiskAutoscaling ?? false,
      connectionPool: props.connectionPool ?? "none",
      ipAllowList: props.ipAllowList ?? [],
      parameterOverrides: props.parameterOverrides ?? {},
      readReplicas: props.readReplicas ?? [],
      datadogAPIKey:
        props.datadogApiKey === undefined
          ? ""
          : Redacted.value(props.datadogApiKey),
      datadogSite: props.datadogSite ?? "",
    }),
    compareBody: (props, name) => ({
      name,
      plan: props.plan,
      diskSizeGB: props.diskSizeGB,
      enableHighAvailability: props.enableHighAvailability ?? false,
      enableDiskAutoscaling: props.enableDiskAutoscaling ?? false,
      connectionPool: props.connectionPool ?? "none",
      ipAllowList: props.ipAllowList ?? [],
      parameterOverrides: props.parameterOverrides ?? {},
      readReplicas: props.readReplicas ?? [],
    }),
    sensitiveChanged: (_olds, props, output) =>
      output.datadogApiKeyDigest !==
        (props.datadogApiKey ? digest(props.datadogApiKey) : undefined) ||
      output.datadogSite !== props.datadogSite,
    afterWrite: (attributes, props) => {
      const {
        datadogApiKeyDigest: _oldDigest,
        datadogSite: _oldSite,
        ...rest
      } = attributes;
      return {
        ...rest,
        ...(props.datadogApiKey
          ? { datadogApiKeyDigest: digest(props.datadogApiKey) }
          : {}),
        ...(props.datadogSite ? { datadogSite: props.datadogSite } : {}),
      };
    },
    finalize: (attributes, _props, api) =>
      hydrateConnection("postgres", attributes, api),
  });

export const KeyValueProvider = () =>
  restProvider(KeyValue, {
    collection: "/key-value",
    item: (id) => `/key-value/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["datastoreId"],
    immutable: ["region", "environmentId"],
    attributes: attrs,
    observe: keyValueObserve,
    body: (props, name, ownerId) => keyValueBody(props, name, ownerId, true),
    updateBody: (props, name, ownerId) =>
      keyValueBody(props, name, ownerId, false),
    finalize: (attributes, _props, api) =>
      hydrateConnection("key-value", attributes, api),
  });

export const RedisProvider = () =>
  restProvider(Redis, {
    collection: "/redis",
    item: (id) => `/redis/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["datastoreId"],
    immutable: ["region", "environmentId"],
    attributes: attrs,
    observe: keyValueObserve,
    body: (props, name, ownerId) => keyValueBody(props, name, ownerId, true),
    updateBody: (props, name, ownerId) =>
      keyValueBody(props, name, ownerId, false),
    finalize: (attributes, _props, api) =>
      hydrateConnection("redis", attributes, api),
  });
