import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Redacted from "effect/Redacted";
import { RenderApi } from "./Api/Api.js";
import type { components } from "./Api/schema.js";
import type { Providers } from "./Providers.js";
import type { Region } from "./Services.js";
import { type CommonAttributes } from "./RestResource.js";
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
    readonly registry: "GITHUB" | "GITLAB" | "DOCKER" | "GOOGLE_ARTIFACT" | "AWS_ECR";
    readonly username: string;
    readonly authToken: Redacted.Redacted<string>;
}
export interface RegistryCredentialAttributes extends CommonAttributes {
    readonly registryCredentialId: string;
    readonly registry?: RegistryCredentialProps["registry"];
    readonly username?: string;
    readonly authTokenDigest?: string;
}
export type WebhookEvent = components["schemas"]["webhookEventWithCursor"]["webhookEvent"]["eventType"];
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
    readonly eventFilter?: readonly WebhookEvent[];
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
    /** Equality marker distinguishing a managed clear from an unknown token. */
    readonly tokenCleared?: true;
}
interface ResourceLogStreamBaseProps {
    readonly resourceId: string;
    /** Set null to clear a configured token. */
    readonly token?: Redacted.Redacted<string> | null;
}
export type ResourceLogStreamProps = ResourceLogStreamBaseProps & ({
    readonly setting: "send";
    readonly endpoint: string;
} | {
    readonly setting: "drop";
    readonly endpoint?: never;
});
export interface ResourceLogStreamAttributes extends CommonAttributes {
    readonly resourceId: string;
    readonly endpoint?: string;
    readonly setting?: "send" | "drop";
    readonly tokenDigest?: string;
    /** Equality marker distinguishing a managed clear from an unknown token. */
    readonly tokenCleared?: true;
}
export interface MetricsStreamProps {
    readonly provider: "BETTER_STACK" | "GRAFANA" | "DATADOG" | "NEW_RELIC" | "HONEYCOMB" | "SIGNOZ" | "GROUNDCOVER" | "LOGFIRE" | "CUSTOM";
    readonly url: string;
    /** Set null to clear a configured token. */
    readonly token?: Redacted.Redacted<string> | null;
}
export interface MetricsStreamAttributes extends CommonAttributes {
    readonly ownerId: string;
    readonly provider?: MetricsStreamProps["provider"];
    readonly url?: string;
    readonly tokenDigest?: string;
    /** Equality marker distinguishing a managed clear from an unknown token. */
    readonly tokenCleared?: true;
}
export interface ServiceNotificationOverrideProps {
    readonly serviceId: string;
    readonly previewNotificationsEnabled?: boolean;
    readonly notificationsToSend?: "none" | "failure" | "all";
}
export interface ServiceNotificationOverrideAttributes extends CommonAttributes {
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
export type WorkflowEnvVar = {
    readonly key: string;
    readonly value: Redacted.Redacted<string>;
    readonly generateValue?: never;
} | {
    readonly key: string;
    readonly value?: never;
    readonly generateValue: true;
};
export interface WorkflowProps {
    readonly name?: string;
    readonly buildConfig: WorkflowBuildConfig;
    readonly runCommand: string;
    readonly region: "frankfurt" | "oregon" | "ohio" | "singapore" | "virginia";
    readonly autoDeployTrigger?: "commit" | "off" | "checksPass";
    readonly envVars?: readonly WorkflowEnvVar[];
}
export interface WorkflowAttributes extends CommonAttributes {
    readonly workflowId: string;
    readonly region?: string;
    readonly environmentId?: string;
    readonly autoDeployTrigger?: string;
    readonly envVarsDigest?: string;
}
type Managed<T extends string, P extends object, A extends object> = Resource.Resource<T, P, A, never, Providers>;
/** A workspace- or environment-scoped dedicated egress IP. @resource */
export type DedicatedIp = Managed<"Render.DedicatedIp", DedicatedIpProps, DedicatedIpAttributes>;
export declare const DedicatedIp: Resource.ResourceClass<DedicatedIp>;
/** Credentials for pulling private container images. The token is stored only as a digest. @resource */
export type RegistryCredential = Managed<"Render.RegistryCredential", RegistryCredentialProps, RegistryCredentialAttributes>;
export declare const RegistryCredential: Resource.ResourceClass<RegistryCredential>;
/** A workspace webhook. The one-time signing secret is returned as Redacted. @resource */
export type Webhook = Managed<"Render.Webhook", WebhookProps, WebhookAttributes>;
export declare const Webhook: Resource.ResourceClass<Webhook>;
/** Workspace-wide log streaming settings. @resource */
export type OwnerLogStream = Managed<"Render.OwnerLogStream", LogStreamProps, OwnerLogStreamAttributes>;
export declare const OwnerLogStream: Resource.ResourceClass<OwnerLogStream>;
/** Per-resource log streaming override. @resource */
export type ResourceLogStream = Managed<"Render.ResourceLogStream", ResourceLogStreamProps, ResourceLogStreamAttributes>;
export declare const ResourceLogStream: Resource.ResourceClass<ResourceLogStream>;
/** Workspace metrics streaming settings. @resource */
export type MetricsStream = Managed<"Render.MetricsStream", MetricsStreamProps, MetricsStreamAttributes>;
export declare const MetricsStream: Resource.ResourceClass<MetricsStream>;
/** A Render workflow definition. Environment changes replace the workflow. @resource */
export type Workflow = Managed<"Render.Workflow", WorkflowProps, WorkflowAttributes>;
export declare const Workflow: Resource.ResourceClass<Workflow>;
/** Per-service notification settings. Delete restores both values to workspace defaults. @resource */
export type ServiceNotificationOverride = Managed<"Render.ServiceNotificationOverride", ServiceNotificationOverrideProps, ServiceNotificationOverrideAttributes>;
export declare const ServiceNotificationOverride: Resource.ResourceClass<ServiceNotificationOverride>;
export declare const DedicatedIpProvider: () => import("effect/Layer").Layer<Provider.Provider<DedicatedIp>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const RegistryCredentialProvider: () => import("effect/Layer").Layer<Provider.Provider<RegistryCredential>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const WebhookProvider: () => import("effect/Layer").Layer<Provider.Provider<Webhook>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const ResourceLogStreamProvider: () => import("effect/Layer").Layer<Provider.Provider<ResourceLogStream>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const WorkflowProvider: () => import("effect/Layer").Layer<Provider.Provider<Workflow>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const OwnerLogStreamProvider: () => import("effect/Layer").Layer<Provider.Provider<OwnerLogStream>, never, RenderApi>;
export declare const MetricsStreamProvider: () => import("effect/Layer").Layer<Provider.Provider<MetricsStream>, never, RenderApi>;
export declare const ServiceNotificationOverrideProvider: () => import("effect/Layer").Layer<Provider.Provider<ServiceNotificationOverride>, never, RenderApi>;
export {};
//# sourceMappingURL=AccountResources.d.ts.map