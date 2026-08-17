import * as Resource from "alchemy/Resource";
import * as Redacted from "effect/Redacted";
import type { Providers } from "./Providers.js";
import { type CommonAttributes } from "./RestResource.js";
export type Region = "frankfurt" | "oregon" | "ohio" | "singapore" | "virginia";
export type ServiceRuntime = "docker" | "elixir" | "go" | "node" | "python" | "ruby" | "rust" | "image";
export type NativeRuntime = Exclude<ServiceRuntime, "docker" | "image">;
export type AutoDeploy = "yes" | "no";
export type ServicePlan = "free" | "starter" | "starter_plus" | "standard" | "standard_plus" | "pro" | "pro_plus" | "pro_max" | "pro_ultra" | "custom" | "starter_legacy" | "standard_legacy" | "standard_plus_legacy" | "pro_legacy" | "pro_plus_legacy";
export type PaidServicePlan = "starter" | "standard" | "pro" | "pro_plus" | "pro_max" | "pro_ultra";
export interface BuildFilter {
    readonly paths: readonly string[];
    readonly ignoredPaths: readonly string[];
}
export interface ServiceIpRule {
    readonly cidrBlock: string;
    readonly description: string;
}
export interface NativeSource {
    readonly runtime: NativeRuntime;
    readonly repo: string;
    /** Omit on create to use the repository default; omission on update leaves the current branch unchanged. */
    readonly branch?: string;
    readonly buildCommand: string;
    readonly startCommand: string;
    readonly image?: never;
    readonly dockerCommand?: never;
    readonly dockerContext?: never;
    readonly dockerfilePath?: never;
    readonly registryCredentialId?: never;
}
export interface DockerSource {
    readonly runtime: "docker";
    readonly repo: string;
    /** Omit on create to use the repository default; omission on update leaves the current branch unchanged. */
    readonly branch?: string;
    readonly dockerCommand?: string;
    readonly dockerContext?: string;
    readonly dockerfilePath?: string;
    readonly registryCredentialId?: string;
    readonly image?: never;
    readonly buildCommand?: never;
    readonly startCommand?: never;
}
export interface ImageSource {
    readonly runtime: "image";
    readonly image: {
        readonly imagePath: string;
        readonly registryCredentialId?: string;
    };
    /** Override the image's default command. */
    readonly dockerCommand?: string;
    readonly repo?: never;
    readonly branch?: never;
    readonly buildCommand?: never;
    readonly startCommand?: never;
    readonly dockerContext?: never;
    readonly dockerfilePath?: never;
    readonly registryCredentialId?: never;
}
/** Source configuration shared by repository- and image-backed services. */
export type ServiceSourceProps = NativeSource | DockerSource | ImageSource;
export type ServiceEnvironment = Readonly<Record<string, Redacted.Redacted<string>>>;
export interface ServiceDeploymentProps {
    /**
     * Complete environment owned by this service. Omit to leave environment
     * variables unmanaged; use an empty object to remove all managed variables.
     */
    readonly env?: ServiceEnvironment;
    /** Wait for the deployment created by reconciliation to reach `live`. */
    readonly waitForDeploy?: boolean;
    /** @default 10800000 (3 hours) */
    readonly deployTimeoutMs?: number;
}
export interface ServiceCoreProps extends ServiceDeploymentProps {
    /** Physical name. Alchemy generates one when omitted. */
    readonly name?: string;
    readonly autoDeploy?: AutoDeploy;
    readonly rootDir?: string;
    readonly environmentId?: string;
    readonly buildFilter?: BuildFilter;
    readonly preDeployCommand?: string;
    readonly previews?: {
        readonly generation?: "off" | "manual" | "automatic";
    };
    readonly maxShutdownDelaySeconds?: number;
    /** Fixed/manual instance count. Do not combine with Autoscaling. */
    readonly numInstances?: number;
}
interface WebServiceConfiguration extends ServiceCoreProps {
    readonly plan?: ServicePlan;
    readonly region?: Region;
    readonly healthCheckPath?: string;
    readonly maintenanceMode?: {
        readonly enabled: boolean;
        readonly uri: string;
    };
    readonly renderSubdomainPolicy?: "enabled" | "disabled";
    readonly ipAllowList?: readonly ServiceIpRule[];
    readonly cache?: {
        readonly profile: "no-cache" | "origin-controlled" | "origin-controlled-all";
    };
}
export type WebServiceProps = WebServiceConfiguration & ServiceSourceProps;
interface PrivateServiceConfiguration extends ServiceCoreProps {
    readonly plan?: PaidServicePlan;
    readonly region?: Region;
}
export type PrivateServiceProps = PrivateServiceConfiguration & ServiceSourceProps;
interface BackgroundWorkerConfiguration extends ServiceCoreProps {
    readonly plan?: PaidServicePlan;
    readonly region?: Region;
}
export type BackgroundWorkerProps = BackgroundWorkerConfiguration & ServiceSourceProps;
interface CronJobConfiguration extends ServiceDeploymentProps {
    readonly name?: string;
    readonly autoDeploy?: AutoDeploy;
    readonly rootDir?: string;
    readonly environmentId?: string;
    readonly buildFilter?: BuildFilter;
    readonly plan?: PaidServicePlan;
    readonly region?: Region;
    readonly schedule: string;
}
export type CronJobProps = CronJobConfiguration & ServiceSourceProps;
export interface StaticSiteProps extends ServiceDeploymentProps {
    readonly name?: string;
    readonly repo: string;
    /** Omit on create to use the repository default; omission on update leaves the current branch unchanged. */
    readonly branch?: string;
    readonly autoDeploy?: AutoDeploy;
    readonly rootDir?: string;
    readonly environmentId?: string;
    readonly buildFilter?: BuildFilter;
    readonly buildCommand?: string;
    readonly publishPath?: string;
    readonly previews?: {
        readonly generation?: "off" | "manual" | "automatic";
    };
    readonly renderSubdomainPolicy?: "enabled" | "disabled";
    readonly ipAllowList?: readonly ServiceIpRule[];
}
export interface ServiceAttributes extends CommonAttributes {
    readonly serviceId: string;
    readonly type: "web_service" | "private_service" | "background_worker" | "cron_job" | "static_site";
    readonly slug?: string;
    readonly url?: string;
    readonly dashboardUrl?: string;
    readonly suspended?: "suspended" | "not_suspended";
    readonly runtime?: ServiceRuntime;
    readonly plan?: string;
    readonly region?: Region;
    readonly environmentId?: string;
    readonly deployId?: string;
    /** Equality-only digest of the service-owned environment. */
    readonly envDigest?: string;
    /** Equality-only marker for the core configuration's deployed transition. */
    readonly coreDigest?: string;
    /** Observed fixed/manual instance count. */
    readonly numInstances?: number;
}
type ServiceResource<T extends string, P extends object, K extends ServiceAttributes["type"]> = Resource.Resource<T, P, ServiceAttributes & {
    readonly type: K;
}, never, Providers>;
/** A Render public web service. @resource */
export type WebService = ServiceResource<"Render.WebService", WebServiceProps, "web_service">;
export declare const WebService: Resource.ResourceClass<WebService>;
/** A private Render service. @resource */
export type PrivateService = ServiceResource<"Render.PrivateService", PrivateServiceProps, "private_service">;
export declare const PrivateService: Resource.ResourceClass<PrivateService>;
/** A continuously running background worker. @resource */
export type BackgroundWorker = ServiceResource<"Render.BackgroundWorker", BackgroundWorkerProps, "background_worker">;
export declare const BackgroundWorker: Resource.ResourceClass<BackgroundWorker>;
/** A scheduled Render cron service. @resource */
export type CronJob = ServiceResource<"Render.CronJob", CronJobProps, "cron_job">;
export declare const CronJob: Resource.ResourceClass<CronJob>;
/** A Render static site. Headers and routes are managed separately. @resource */
export type StaticSite = ServiceResource<"Render.StaticSite", StaticSiteProps, "static_site">;
export declare const StaticSite: Resource.ResourceClass<StaticSite>;
export declare const WebServiceProvider: () => import("effect/Layer").Layer<import("alchemy/Provider").Provider<WebService>, never, import("./Api/Api.js").RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const PrivateServiceProvider: () => import("effect/Layer").Layer<import("alchemy/Provider").Provider<PrivateService>, never, import("./Api/Api.js").RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const BackgroundWorkerProvider: () => import("effect/Layer").Layer<import("alchemy/Provider").Provider<BackgroundWorker>, never, import("./Api/Api.js").RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const CronJobProvider: () => import("effect/Layer").Layer<import("alchemy/Provider").Provider<CronJob>, never, import("./Api/Api.js").RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const StaticSiteProvider: () => import("effect/Layer").Layer<import("alchemy/Provider").Provider<StaticSite>, never, import("./Api/Api.js").RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export {};
//# sourceMappingURL=Services.d.ts.map