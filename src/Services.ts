import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import { poll, RenderApiError } from "./Api/Api.js";
import type { Providers } from "./Providers.js";
import { restProvider, type CommonAttributes } from "./RestResource.js";

export type Region =
  | "frankfurt"
  | "oregon"
  | "ohio"
  | "singapore"
  | "virginia";
export type ServiceRuntime =
  | "docker"
  | "elixir"
  | "go"
  | "node"
  | "python"
  | "ruby"
  | "rust"
  | "image";
export type NativeRuntime = Exclude<ServiceRuntime, "docker" | "image">;
export type AutoDeploy = "yes" | "no";
export type ServicePlan =
  | "free"
  | "starter"
  | "starter_plus"
  | "standard"
  | "standard_plus"
  | "pro"
  | "pro_plus"
  | "pro_max"
  | "pro_ultra"
  | "custom"
  | "starter_legacy"
  | "standard_legacy"
  | "standard_plus_legacy"
  | "pro_legacy"
  | "pro_plus_legacy";
export type PaidServicePlan =
  | "starter"
  | "standard"
  | "pro"
  | "pro_plus"
  | "pro_max"
  | "pro_ultra";

export interface BuildFilter {
  readonly paths: readonly string[];
  readonly ignoredPaths: readonly string[];
}

export interface ServiceIpRule {
  readonly cidrBlock: string;
  readonly description?: string;
}

const ALLOW_ALL_IPS = [
  { cidrBlock: "0.0.0.0/0", description: "everywhere" },
] as const;

export interface NativeSource {
  readonly runtime: NativeRuntime;
  readonly repo: string;
  readonly branch?: string;
  readonly buildCommand: string;
  readonly startCommand: string;
  readonly image?: never;
}

export interface DockerSource {
  readonly runtime: "docker";
  readonly repo: string;
  readonly branch?: string;
  readonly dockerCommand?: string;
  readonly dockerContext?: string;
  readonly dockerfilePath?: string;
  readonly registryCredentialId?: string;
  readonly image?: never;
}

export interface ImageSource {
  readonly runtime: "image";
  readonly image: {
    readonly imagePath: string;
    readonly registryCredentialId?: string;
  };
  readonly repo?: never;
  readonly branch?: never;
}

export interface ServiceSourceProps {
  readonly runtime: ServiceRuntime;
  readonly repo?: string;
  readonly branch?: string;
  readonly image?: {
    readonly imagePath: string;
    readonly registryCredentialId?: string;
  };
  readonly buildCommand?: string;
  readonly startCommand?: string;
  readonly dockerCommand?: string;
  readonly dockerContext?: string;
  readonly dockerfilePath?: string;
  readonly registryCredentialId?: string;
}

export interface ServiceCoreProps {
  /** Physical name. Alchemy generates one when omitted. */
  readonly name?: string;
  readonly autoDeploy?: AutoDeploy;
  readonly rootDir?: string;
  readonly environmentId?: string;
  readonly buildFilter?: BuildFilter;
  readonly preDeployCommand?: string;
  readonly previews?: { readonly generation?: "off" | "manual" | "automatic" };
  readonly maxShutdownDelaySeconds?: number;
  /** Wait for the deploy returned by service creation to reach `live`. */
  readonly waitForDeploy?: boolean;
  /** @default 10800000 (3 hours) */
  readonly deployTimeoutMs?: number;
}

export interface WebServiceProps extends ServiceCoreProps, ServiceSourceProps {
  readonly plan?: ServicePlan;
  readonly region?: Region;
  readonly healthCheckPath?: string;
  readonly maintenanceMode?: { readonly enabled: boolean; readonly uri: string };
  readonly renderSubdomainPolicy?: "enabled" | "disabled";
  readonly ipAllowList?: readonly ServiceIpRule[];
  readonly cache?: {
    readonly profile: "no-cache" | "origin-controlled" | "origin-controlled-all";
  };
}
export interface PrivateServiceProps extends ServiceCoreProps, ServiceSourceProps {
  readonly plan?: PaidServicePlan;
  readonly region?: Region;
}
export interface BackgroundWorkerProps extends ServiceCoreProps, ServiceSourceProps {
  readonly plan?: PaidServicePlan;
  readonly region?: Region;
}
export interface CronJobProps extends ServiceSourceProps {
  readonly name?: string;
  readonly autoDeploy?: AutoDeploy;
  readonly rootDir?: string;
  readonly environmentId?: string;
  readonly buildFilter?: BuildFilter;
  readonly waitForDeploy?: boolean;
  readonly deployTimeoutMs?: number;
  readonly plan?: PaidServicePlan;
  readonly region?: Region;
  readonly schedule: string;
}
export interface StaticSiteProps {
  readonly name?: string;
  readonly repo: string;
  readonly branch: string;
  readonly autoDeploy?: AutoDeploy;
  readonly rootDir?: string;
  readonly environmentId?: string;
  readonly buildFilter?: BuildFilter;
  readonly buildCommand: string;
  readonly publishPath?: string;
  readonly previews?: { readonly generation?: "off" | "manual" | "automatic" };
  readonly renderSubdomainPolicy?: "enabled" | "disabled";
  readonly ipAllowList?: readonly ServiceIpRule[];
  readonly waitForDeploy?: boolean;
  readonly deployTimeoutMs?: number;
}

export interface ServiceAttributes extends CommonAttributes {
  readonly serviceId: string;
  readonly type:
    | "web_service"
    | "private_service"
    | "background_worker"
    | "cron_job"
    | "static_site";
  readonly slug?: string;
  readonly url?: string;
  readonly dashboardUrl?: string;
  readonly suspended?: "suspended" | "not_suspended";
  readonly runtime?: ServiceRuntime;
  readonly plan?: string;
  readonly region?: Region;
  readonly environmentId?: string;
  readonly deployId?: string;
}

type ServiceResource<
  T extends string,
  P extends object,
  K extends ServiceAttributes["type"],
> = Resource.Resource<T, P, ServiceAttributes & { readonly type: K }, never, Providers>;

/** A Render public web service. Child configuration is managed separately. @resource */
export type WebService = ServiceResource<
  "Render.WebService",
  WebServiceProps,
  "web_service"
>;
export const WebService = Resource.Resource<WebService>("Render.WebService");
/** A private Render service. @resource */
export type PrivateService = ServiceResource<
  "Render.PrivateService",
  PrivateServiceProps,
  "private_service"
>;
export const PrivateService = Resource.Resource<PrivateService>("Render.PrivateService");
/** A continuously running background worker. @resource */
export type BackgroundWorker = ServiceResource<
  "Render.BackgroundWorker",
  BackgroundWorkerProps,
  "background_worker"
>;
export const BackgroundWorker =
  Resource.Resource<BackgroundWorker>("Render.BackgroundWorker");
/** A scheduled Render cron service. @resource */
export type CronJob = ServiceResource<"Render.CronJob", CronJobProps, "cron_job">;
export const CronJob = Resource.Resource<CronJob>("Render.CronJob");
/** A Render static site. Headers and routes are managed separately. @resource */
export type StaticSite = ServiceResource<
  "Render.StaticSite",
  StaticSiteProps,
  "static_site"
>;
export const StaticSite = Resource.Resource<StaticSite>("Render.StaticSite");

const envSpecificDetails = (props: ServiceSourceProps) => {
  if (props.runtime === "docker") {
    return {
      dockerCommand: props.dockerCommand,
      dockerContext: props.dockerContext,
      dockerfilePath: props.dockerfilePath,
      registryCredentialId: props.registryCredentialId,
    };
  }
  if (props.runtime === "image") return {};
  return {
    buildCommand: props.buildCommand,
    startCommand: props.startCommand,
  };
};

const validateSource = (props: ServiceSourceProps) => {
  if (props.runtime === "image") {
    if (!props.image?.imagePath) {
      throw new Error("Render image services require image.imagePath");
    }
    return;
  }
  if (!props.repo) {
    throw new Error("Render repository services require repo");
  }
  if (
    props.runtime !== "docker" &&
    (!props.buildCommand || !props.startCommand)
  ) {
    throw new Error(
      `Render ${props.runtime} services require buildCommand and startCommand`,
    );
  }
};

const sourceBody = (props: ServiceSourceProps, ownerId: string) => {
  validateSource(props);
  if (props.runtime !== "image") return { repo: props.repo, branch: props.branch };
  if (!props.image) {
    throw new Error("Render image services require image.imagePath");
  }
  return {
    image: {
      ownerId,
      imagePath: props.image.imagePath,
      registryCredentialId: props.image.registryCredentialId,
    },
  };
};

const createDetails = (
  kind: ServiceAttributes["type"],
  props: WebServiceProps | PrivateServiceProps | BackgroundWorkerProps | CronJobProps | StaticSiteProps,
) => {
  if (kind === "static_site") {
    const site = props as StaticSiteProps;
    return {
      buildCommand: site.buildCommand,
      publishPath: site.publishPath,
      previews: site.previews,
      renderSubdomainPolicy: site.renderSubdomainPolicy,
      ipAllowList: site.ipAllowList,
    };
  }
  const service = props as Exclude<typeof props, StaticSiteProps>;
  return {
    runtime: service.runtime,
    envSpecificDetails: envSpecificDetails(service),
    plan: service.plan,
    region: service.region,
    preDeployCommand:
      kind === "cron_job"
        ? undefined
        : (service as ServiceCoreProps).preDeployCommand,
    previews:
      kind === "cron_job" ? undefined : (service as ServiceCoreProps).previews,
    maxShutdownDelaySeconds:
      kind === "cron_job"
        ? undefined
        : (service as ServiceCoreProps).maxShutdownDelaySeconds,
    ...(kind === "private_service" || kind === "background_worker"
      ? { numInstances: 1 }
      : {}),
    ...(kind === "web_service"
      ? {
          healthCheckPath: (service as WebServiceProps).healthCheckPath,
          maintenanceMode: (service as WebServiceProps).maintenanceMode,
          renderSubdomainPolicy: (service as WebServiceProps).renderSubdomainPolicy,
          ipAllowList: (service as WebServiceProps).ipAllowList,
        }
      : {}),
    ...(kind === "cron_job"
      ? { schedule: (service as CronJobProps).schedule }
      : {}),
  };
};

const updateDetails = (
  kind: ServiceAttributes["type"],
  props: WebServiceProps | PrivateServiceProps | BackgroundWorkerProps | CronJobProps | StaticSiteProps,
) => {
  const details = createDetails(kind, props) as Record<string, unknown>;
  delete details.region;
  delete details.numInstances;
  if (kind === "static_site") {
    const site = props as StaticSiteProps;
    details.previews = site.previews ?? { generation: "off" };
    details.renderSubdomainPolicy = site.renderSubdomainPolicy ?? "enabled";
    details.ipAllowList = site.ipAllowList ?? ALLOW_ALL_IPS;
  } else if (kind !== "cron_job") {
    const service = props as ServiceCoreProps;
    details.preDeployCommand = service.preDeployCommand ?? "";
    details.previews = service.previews ?? { generation: "off" };
    details.maxShutdownDelaySeconds = service.maxShutdownDelaySeconds ?? 30;
  }
  if (kind === "web_service") {
    const web = props as WebServiceProps;
    details.healthCheckPath = web.healthCheckPath ?? "";
    details.maintenanceMode = web.maintenanceMode ?? {
      enabled: false,
      uri: "",
    };
    details.renderSubdomainPolicy = web.renderSubdomainPolicy ?? "enabled";
    details.cache = web.cache ?? { profile: "no-cache" };
    details.ipAllowList = web.ipAllowList ?? ALLOW_ALL_IPS;
  }
  return details;
};

const createBody = (
  kind: ServiceAttributes["type"],
  props: any,
  name: string,
  ownerId: string,
) => ({
  type: kind,
  name,
  ownerId,
  environmentId: props.environmentId,
  autoDeploy: props.autoDeploy,
  rootDir: props.rootDir,
  buildFilter: props.buildFilter,
  ...(kind === "static_site"
    ? { repo: props.repo, branch: props.branch }
    : sourceBody(props, ownerId)),
  serviceDetails: createDetails(kind, props),
});

const updateBody = (
  kind: ServiceAttributes["type"],
  props: any,
  name: string,
  ownerId: string,
) => ({
  name,
  autoDeploy: props.autoDeploy ?? "yes",
  rootDir: props.rootDir ?? "",
  buildFilter: props.buildFilter ?? { paths: [], ignoredPaths: [] },
  ...(kind === "static_site"
    ? { repo: props.repo, branch: props.branch }
    : sourceBody(props, ownerId)),
  serviceDetails: updateDetails(kind, props),
});

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const observe = (
  entity: Record<string, unknown>,
  kind: ServiceAttributes["type"],
) => {
  const rawDetails = record(entity.serviceDetails);
  const envDetails = record(rawDetails.envSpecificDetails);
  const registryCredential = record(envDetails.registryCredential);
  const normalizedEnvDetails = {
    ...envDetails,
    ...(typeof envDetails.registryCredentialId === "string"
      ? { registryCredentialId: envDetails.registryCredentialId }
      : typeof registryCredential.id === "string"
        ? { registryCredentialId: registryCredential.id }
        : {}),
  };
  const details: Record<string, unknown> = {
    ...rawDetails,
    envSpecificDetails: normalizedEnvDetails,
    preDeployCommand:
      rawDetails.preDeployCommand ?? envDetails.preDeployCommand ?? "",
  };
  if (kind !== "cron_job") {
    details.previews = rawDetails.previews ?? { generation: "off" };
    details.maxShutdownDelaySeconds =
      rawDetails.maxShutdownDelaySeconds ?? 30;
  }
  if (kind === "web_service") {
    details.healthCheckPath = rawDetails.healthCheckPath ?? "";
    details.maintenanceMode = rawDetails.maintenanceMode ?? {
      enabled: false,
      uri: "",
    };
    details.renderSubdomainPolicy =
      rawDetails.renderSubdomainPolicy ?? "enabled";
    details.cache = rawDetails.cache ?? { profile: "no-cache" };
    details.ipAllowList = rawDetails.ipAllowList ?? ALLOW_ALL_IPS;
  }
  if (kind === "static_site") {
    details.renderSubdomainPolicy =
      rawDetails.renderSubdomainPolicy ?? "enabled";
    details.ipAllowList = rawDetails.ipAllowList ?? ALLOW_ALL_IPS;
  }
  const registry = record(entity.registryCredential);
  return {
    name: entity.name,
    repo: entity.repo,
    branch: entity.branch,
    image:
      typeof entity.imagePath === "string"
        ? {
            imagePath: entity.imagePath,
            ownerId: entity.ownerId,
            registryCredentialId: registry.id,
          }
        : undefined,
    autoDeploy: entity.autoDeploy ?? "yes",
    rootDir: entity.rootDir ?? "",
    buildFilter: entity.buildFilter ?? { paths: [], ignoredPaths: [] },
    serviceDetails: details,
  };
};

const attributes = (kind: ServiceAttributes["type"]) =>
  (entity: Record<string, unknown>, fallback: { id: string; ownerId: string; previous?: ServiceAttributes }) => {
    const id = typeof entity.id === "string" ? entity.id : fallback.id;
    const details = record(entity.serviceDetails);
    const region = typeof details.region === "string" ? details.region : undefined;
    return {
      id,
      serviceId: id,
      type: kind,
      ownerId:
        typeof entity.ownerId === "string" ? entity.ownerId : fallback.ownerId,
      ...(typeof entity.name === "string" ? { name: entity.name } : {}),
      ...(typeof entity.slug === "string" ? { slug: entity.slug } : {}),
      ...(typeof details.url === "string" ? { url: details.url } : {}),
      ...(typeof entity.dashboardUrl === "string"
        ? { dashboardUrl: entity.dashboardUrl }
        : {}),
      ...(entity.suspended === "suspended" || entity.suspended === "not_suspended"
        ? { suspended: entity.suspended }
        : {}),
      ...(typeof details.runtime === "string"
        ? { runtime: details.runtime as ServiceRuntime }
        : {}),
      ...(typeof details.plan === "string" ? { plan: details.plan } : {}),
      ...(region ? { region: region as Region } : {}),
      ...(typeof entity.environmentId === "string"
        ? { environmentId: entity.environmentId }
        : {}),
      ...(typeof entity.deployId === "string"
        ? { deployId: entity.deployId }
        : fallback.previous?.deployId
          ? { deployId: fallback.previous.deployId }
          : {}),
      ...(typeof entity.createdAt === "string" ? { createdAt: entity.createdAt } : {}),
      ...(typeof entity.updatedAt === "string" ? { updatedAt: entity.updatedAt } : {}),
    } as any;
  };

const provider = (resource: any, kind: ServiceAttributes["type"]) =>
  restProvider(resource, {
    collection: "/services",
    item: (id: string) => `/services/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["serviceId"],
    filter: (entity: Record<string, unknown>) => entity.type === kind,
    lookupQuery: () => ({ type: kind }),
    immutable: ["environmentId", "region"],
    body: (props: any, name: string, ownerId: string) =>
      createBody(kind, props, name, ownerId),
    updateBody: (props: any, name: string, ownerId: string) =>
      updateBody(kind, props, name, ownerId),
    observe: (entity: Record<string, unknown>) => observe(entity, kind),
    attributes: attributes(kind),
    finalize: (service: ServiceAttributes, props: ServiceCoreProps, api, phase) =>
      Effect.gen(function* () {
        let current = service;
        if (
          phase === "create" &&
          kind === "web_service" &&
          (props as WebServiceProps).cache
        ) {
          const patched = yield* api.request({
            method: "PATCH",
            path: `/services/${encodeURIComponent(service.serviceId)}`,
            body: {
              serviceDetails: { cache: (props as WebServiceProps).cache },
            },
          });
          current = attributes(kind)(record(patched), {
            id: service.serviceId,
            ownerId: service.ownerId ?? api.ownerId,
            previous: service,
          });
        }
        if (phase !== "create" || !props.waitForDeploy || !current.deployId) {
          return current;
        }
        const terminal = new Set([
          "live",
          "deactivated",
          "build_failed",
          "update_failed",
          "canceled",
          "pre_deploy_failed",
        ]);
        const deploy = yield* poll(
          api.request({
            method: "GET",
            path: `/services/${encodeURIComponent(current.serviceId)}/deploys/${encodeURIComponent(current.deployId)}`,
          }).pipe(Effect.map((value) => value as Record<string, unknown>)),
          {
            timeoutMs: props.deployTimeoutMs ?? 3 * 60 * 60 * 1_000,
            while: (value) => !terminal.has(String(value.status ?? "")),
          },
        );
        if (deploy.status !== "live") {
          return yield* Effect.fail(
            new RenderApiError(
              `Render deploy ${current.deployId} ended in ${String(deploy.status)}`,
            ),
          );
        }
        return current;
      }),
  });

export const WebServiceProvider = () => provider(WebService, "web_service");
export const PrivateServiceProvider = () =>
  provider(PrivateService, "private_service");
export const BackgroundWorkerProvider = () =>
  provider(BackgroundWorker, "background_worker");
export const CronJobProvider = () => provider(CronJob, "cron_job");
export const StaticSiteProvider = () => provider(StaticSite, "static_site");
