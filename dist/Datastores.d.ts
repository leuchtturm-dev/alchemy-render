import * as Resource from "alchemy/Resource";
import * as Redacted from "effect/Redacted";
import type { Providers } from "./Providers.js";
import { type CommonAttributes } from "./RestResource.js";
import type { Region } from "./Services.js";
export interface DatastoreIpRule {
    readonly cidrBlock: string;
    readonly description: string;
}
export type PostgresPlan = "free" | "starter" | "standard" | "pro" | "pro_plus" | "custom" | "basic_256mb" | "basic_1gb" | "basic_4gb" | "pro_4gb" | "pro_8gb" | "pro_16gb" | "pro_32gb" | "pro_64gb" | "pro_128gb" | "pro_192gb" | "pro_256gb" | "pro_384gb" | "pro_512gb" | "accelerated_16gb" | "accelerated_32gb" | "accelerated_64gb" | "accelerated_128gb" | "accelerated_256gb" | "accelerated_384gb" | "accelerated_512gb" | "accelerated_768gb" | "accelerated_1024gb";
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
export type KeyValuePlan = "free" | "starter" | "standard" | "pro" | "pro_plus" | "custom";
export interface KeyValueProps {
    readonly name?: string;
    readonly plan: KeyValuePlan;
    readonly region?: Region;
    readonly environmentId?: string;
    readonly maxmemoryPolicy: "noeviction" | "allkeys_lfu" | "allkeys_lru" | "allkeys_random" | "volatile_lfu" | "volatile_lru" | "volatile_random" | "volatile_ttl";
    readonly persistenceMode?: "journal_snapshot" | "snapshot" | "off";
    readonly ipAllowList?: readonly DatastoreIpRule[];
}
export interface RedisProps extends KeyValueProps {
}
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
    readonly diskSizeGB?: number;
    readonly databaseName?: string;
    readonly databaseUser?: string;
    readonly environmentId?: string;
    readonly connectionInfo?: DatastoreConnectionInfo;
    readonly datadogApiKeyDigest?: string;
    readonly datadogSite?: string;
}
type Store<T extends string, P extends object> = Resource.Resource<T, P, DatastoreAttributes, never, Providers>;
/** A managed Render Postgres database. Connection values are Redacted. @resource */
export type Postgres = Store<"Render.Postgres", PostgresProps>;
export declare const Postgres: Resource.ResourceClass<Postgres>;
/** A managed Render Key Value instance. @resource */
export type KeyValue = Store<"Render.KeyValue", KeyValueProps>;
export declare const KeyValue: Resource.ResourceClass<KeyValue>;
/** @deprecated Render Redis is superseded by Key Value. @resource */
export type Redis = Store<"Render.Redis", RedisProps>;
export declare const Redis: Resource.ResourceClass<Redis>;
export declare const PostgresProvider: () => import("effect/Layer").Layer<import("alchemy/Provider").Provider<Postgres>, never, import("./Api/Api.js").RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const KeyValueProvider: () => import("effect/Layer").Layer<import("alchemy/Provider").Provider<KeyValue>, never, import("./Api/Api.js").RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const RedisProvider: () => import("effect/Layer").Layer<import("alchemy/Provider").Provider<Redis>, never, import("./Api/Api.js").RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export {};
//# sourceMappingURL=Datastores.d.ts.map