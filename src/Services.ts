import { createHash } from "node:crypto";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import {
  poll,
  RenderApiError,
  type RenderApiClient,
} from "./Api/Api.js";
import type { Providers } from "./Providers.js";
import {
  matchesDesired,
  moveEnvironmentResource,
  restProvider,
  unwrapEntity,
  unwrapRows,
  type CommonAttributes,
} from "./RestResource.js";

export type Region = "frankfurt" | "oregon" | "ohio" | "singapore" | "virginia";
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
  readonly description: string;
}

const ALLOW_ALL_IPS = [
  { cidrBlock: "0.0.0.0/0", description: "everywhere" },
] as const;

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

export type ServiceEnvironment = Readonly<
  Record<string, Redacted.Redacted<string>>
>;

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
  readonly previews?: { readonly generation?: "off" | "manual" | "automatic" };
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
    readonly profile:
      | "no-cache"
      | "origin-controlled"
      | "origin-controlled-all";
  };
}
export type WebServiceProps = WebServiceConfiguration & ServiceSourceProps;

interface PrivateServiceConfiguration extends ServiceCoreProps {
  readonly plan?: PaidServicePlan;
  readonly region?: Region;
}
export type PrivateServiceProps =
  PrivateServiceConfiguration & ServiceSourceProps;

interface BackgroundWorkerConfiguration extends ServiceCoreProps {
  readonly plan?: PaidServicePlan;
  readonly region?: Region;
}
export type BackgroundWorkerProps =
  BackgroundWorkerConfiguration & ServiceSourceProps;

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
  readonly previews?: { readonly generation?: "off" | "manual" | "automatic" };
  readonly renderSubdomainPolicy?: "enabled" | "disabled";
  readonly ipAllowList?: readonly ServiceIpRule[];
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
  /** Equality-only digest of the service-owned environment. */
  readonly envDigest?: string;
  /** Equality-only marker for the core configuration's deployed transition. */
  readonly coreDigest?: string;
  /** Observed fixed/manual instance count. */
  readonly numInstances?: number;
}

type ServiceResource<
  T extends string,
  P extends object,
  K extends ServiceAttributes["type"],
> = Resource.Resource<
  T,
  P,
  ServiceAttributes & { readonly type: K },
  never,
  Providers
>;

/** A Render public web service. @resource */
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
export const PrivateService = Resource.Resource<PrivateService>(
  "Render.PrivateService",
);
/** A continuously running background worker. @resource */
export type BackgroundWorker = ServiceResource<
  "Render.BackgroundWorker",
  BackgroundWorkerProps,
  "background_worker"
>;
export const BackgroundWorker = Resource.Resource<BackgroundWorker>(
  "Render.BackgroundWorker",
);
/** A scheduled Render cron service. @resource */
export type CronJob = ServiceResource<
  "Render.CronJob",
  CronJobProps,
  "cron_job"
>;
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
  if (props.runtime === "image") {
    return { dockerCommand: props.dockerCommand };
  }
  return {
    buildCommand: props.buildCommand,
    startCommand: props.startCommand,
  };
};

// Cron create uses Render's legacy full Docker-details shape. Unlike the
// PATCH shape, all three strings must be present and registry credentials are
// nested. Render's first-party Terraform provider emits the same wire shape.
const cronCreateEnvSpecificDetails = (props: ServiceSourceProps) => {
  if (props.runtime === "docker") {
    return {
      dockerCommand: props.dockerCommand ?? "",
      dockerContext: props.dockerContext ?? "",
      dockerfilePath: props.dockerfilePath ?? "",
      ...(props.registryCredentialId === undefined
        ? {}
        : { registryCredential: { id: props.registryCredentialId } }),
    };
  }
  if (props.runtime === "image") {
    return {
      dockerCommand: props.dockerCommand ?? "",
      dockerContext: "",
      dockerfilePath: "",
    };
  }
  return envSpecificDetails(props);
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
  if (props.runtime !== "image")
    return { repo: props.repo, branch: props.branch };
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

const scalable = new Set<ServiceAttributes["type"]>([
  "web_service",
  "private_service",
  "background_worker",
]);

const validateNumInstances = (value: number | undefined) => {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < 1 || value > 100)
  ) {
    throw new Error("Render numInstances must be an integer from 1 to 100");
  }
};

const environmentEntries = (env: ServiceEnvironment) =>
  Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      if (!Redacted.isRedacted(value)) {
        throw new Error(`Render environment value for ${key} must be Redacted`);
      }
      return [key, Redacted.value(value)] as const;
    });

const environmentDigestFromEntries = (
  entries: readonly (readonly [string, string])[],
) => {
  const hash = createHash("sha256");
  for (const [key, value] of entries) {
    hash.update(String(Buffer.byteLength(key))).update(":").update(key);
    hash.update(String(Buffer.byteLength(value))).update(":").update(value);
  }
  return hash.digest("hex");
};

const environmentDigest = (env: ServiceEnvironment) =>
  environmentDigestFromEntries(environmentEntries(env));

const environmentBody = (env: ServiceEnvironment) =>
  environmentEntries(env).map(([key, value]) => ({ key, value }));

const readEnvironmentDigest = (
  api: RenderApiClient,
  serviceId: string,
): Effect.Effect<string, RenderApiError> =>
  Effect.gen(function* () {
    const entries: Array<readonly [string, string]> = [];
    let cursor: string | undefined;
    for (;;) {
      const response = yield* api.request({
        method: "GET",
        path: `/services/${encodeURIComponent(serviceId)}/env-vars`,
        query: { limit: 100, ...(cursor ? { cursor } : {}) },
      });
      const rows = unwrapRows(response);
      for (const { entity } of rows) {
        if (typeof entity.key === "string" && typeof entity.value === "string") {
          entries.push([entity.key, entity.value]);
        }
      }
      const next = rows.at(-1)?.cursor;
      if (!next || next === cursor || rows.length === 0) break;
      cursor = next;
    }
    entries.sort(([left], [right]) => left.localeCompare(right));
    return environmentDigestFromEntries(entries);
  });

const createDetails = (
  kind: ServiceAttributes["type"],
  props:
    | WebServiceProps
    | PrivateServiceProps
    | BackgroundWorkerProps
    | CronJobProps
    | StaticSiteProps,
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
  const serviceCore = service as ServiceCoreProps;
  validateNumInstances(serviceCore.numInstances);
  return {
    runtime: service.runtime,
    envSpecificDetails:
      kind === "cron_job"
        ? cronCreateEnvSpecificDetails(service)
        : envSpecificDetails(service),
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
    ...(scalable.has(kind)
      ? kind === "web_service" && serviceCore.numInstances === undefined
        ? {}
        : { numInstances: serviceCore.numInstances ?? 1 }
      : {}),
    ...(kind === "web_service"
      ? {
          healthCheckPath: (service as WebServiceProps).healthCheckPath,
          maintenanceMode: (service as WebServiceProps).maintenanceMode,
          renderSubdomainPolicy: (service as WebServiceProps)
            .renderSubdomainPolicy,
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
  props:
    | WebServiceProps
    | PrivateServiceProps
    | BackgroundWorkerProps
    | CronJobProps
    | StaticSiteProps,
) => {
  const details = createDetails(kind, props) as Record<string, unknown>;
  delete details.region;
  delete details.numInstances;
  if (kind === "cron_job") {
    details.envSpecificDetails = envSpecificDetails(
      props as ServiceSourceProps,
    );
  }
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

type ManagedServiceProps =
  | WebServiceProps
  | PrivateServiceProps
  | BackgroundWorkerProps
  | CronJobProps
  | StaticSiteProps;

type ManagedService =
  | WebService
  | PrivateService
  | BackgroundWorker
  | CronJob
  | StaticSite;

const createBody = (
  kind: ServiceAttributes["type"],
  props: ManagedServiceProps,
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
  ...((props as ServiceDeploymentProps).env !== undefined
    ? { envVars: environmentBody((props as ServiceDeploymentProps).env!) }
    : {}),
  ...(kind === "static_site"
    ? { repo: props.repo, branch: props.branch }
    : sourceBody(props as ServiceSourceProps, ownerId)),
  serviceDetails: createDetails(kind, props),
});

const updateBody = (
  kind: ServiceAttributes["type"],
  props: ManagedServiceProps,
  name: string,
  ownerId: string,
) => ({
  name,
  autoDeploy: props.autoDeploy ?? "yes",
  rootDir: props.rootDir ?? "",
  buildFilter: props.buildFilter ?? { paths: [], ignoredPaths: [] },
  ...(kind === "static_site"
    ? { repo: props.repo, branch: props.branch }
    : sourceBody(props as ServiceSourceProps, ownerId)),
  serviceDetails: updateDetails(kind, props),
});

const coreDigest = (
  kind: ServiceAttributes["type"],
  props: ManagedServiceProps,
  name: string,
  ownerId: string,
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        ...updateBody(kind, props, name, ownerId),
        environmentId: props.environmentId,
      }),
    )
    .digest("hex");

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
    details.maxShutdownDelaySeconds = rawDetails.maxShutdownDelaySeconds ?? 30;
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

const attributes =
  <K extends ServiceAttributes["type"]>(kind: K) =>
  (
    entity: Record<string, unknown>,
    fallback: { id: string; ownerId: string; previous?: ServiceAttributes },
  ): ServiceAttributes & { readonly type: K } => {
    const id = typeof entity.id === "string" ? entity.id : fallback.id;
    const details = record(entity.serviceDetails);
    const region =
      typeof details.region === "string" ? details.region : undefined;
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
      ...(entity.suspended === "suspended" ||
      entity.suspended === "not_suspended"
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
      ...(typeof details.numInstances === "number"
        ? { numInstances: details.numInstances }
        : fallback.previous?.numInstances !== undefined
          ? { numInstances: fallback.previous.numInstances }
          : {}),
      ...(fallback.previous?.envDigest
        ? { envDigest: fallback.previous.envDigest }
        : {}),
      ...(fallback.previous?.coreDigest
        ? { coreDigest: fallback.previous.coreDigest }
        : {}),
      ...(typeof entity.createdAt === "string"
        ? { createdAt: entity.createdAt }
        : {}),
      ...(typeof entity.updatedAt === "string"
        ? { updatedAt: entity.updatedAt }
        : {}),
    };
  };

const waitForDeployment = (
  api: RenderApiClient,
  serviceId: string,
  deployId: string,
  timeoutMs: number,
) =>
  Effect.gen(function* () {
    const terminal = new Set([
      "live",
      "deactivated",
      "build_failed",
      "update_failed",
      "canceled",
      "pre_deploy_failed",
    ]);
    const deploy = yield* poll(
      api
        .request({
          method: "GET",
          path: `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`,
        })
        .pipe(Effect.map((value) => record(value))),
      {
        timeoutMs,
        while: (value) => !terminal.has(String(value.status ?? "")),
      },
    );
    if (deploy.status !== "live") {
      return yield* Effect.fail(
        new RenderApiError(
          `Render deploy ${deployId} ended in ${String(deploy.status)}`,
        ),
      );
    }
  });

const createDeployment = (api: RenderApiClient, serviceId: string) =>
  api
    .request({
      method: "POST",
      path: `/services/${encodeURIComponent(serviceId)}/deploys`,
      body: {},
    })
    .pipe(
      Effect.map((value) => {
        const deploy = unwrapEntity(value);
        return typeof deploy.id === "string" ? deploy.id : undefined;
      }),
    );

const provider = <R extends ManagedService>(
  resource: Resource.ResourceClass<R>,
  kind: R["Attributes"]["type"],
) => {
  const makeAttributes = (
    entity: Record<string, unknown>,
    fallback: { id: string; ownerId: string; previous?: R["Attributes"] },
  ): R["Attributes"] => attributes(kind)(entity, fallback) as R["Attributes"];

  return restProvider(resource, {
    collection: "/services",
    item: (id: string) => `/services/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["serviceId"] as Extract<keyof R["Attributes"], string>[],
    filter: (entity: Record<string, unknown>) => entity.type === kind,
    lookupQuery: () => ({ type: [kind] }),
    immutable: (kind === "static_site" ? [] : ["region"]) as (
      keyof R["Props"]
    )[],
    body: (props, name, ownerId) => createBody(kind, props, name, ownerId),
    updateBody: (props, name, ownerId) =>
      updateBody(kind, props, name, ownerId),
    observe: (entity: Record<string, unknown>) => observe(entity, kind),
    attributes: makeAttributes,
    reconcileOnNoop: true,
    sensitiveChanged: (_olds, news, output) => {
      const desiredCoreDigest = coreDigest(
        kind,
        news,
        news.name ?? output.name ?? output.serviceId,
        output.ownerId ?? "",
      );
      if (
        output.coreDigest !== undefined &&
        desiredCoreDigest !== output.coreDigest
      ) {
        return true;
      }
      const desired = news as ServiceDeploymentProps & {
        readonly numInstances?: number;
      };
      const desiredEnvDigest =
        desired.env === undefined ? undefined : environmentDigest(desired.env);
      return (
        news.environmentId !== output.environmentId ||
        desiredEnvDigest !== output.envDigest ||
        (scalable.has(kind) &&
          desired.numInstances !== undefined &&
          desired.numInstances !== output.numInstances)
      );
    },
    remoteSensitiveChanged: (news, output, api) => {
      const desired = news as ServiceDeploymentProps;
      if (desired.env === undefined) return Effect.succeed(false);
      const digest = environmentDigest(desired.env);
      if (digest !== output.envDigest) return Effect.succeed(true);
      return readEnvironmentDigest(api, output.serviceId).pipe(
        Effect.map((observed) => observed !== digest),
      );
    },
    finalize: (service, props, api, phase, previousProps) =>
      Effect.gen(function* () {
        let current = service;
        const ownerId = current.ownerId ?? api.ownerId;
        const desiredName = props.name ?? current.name ?? current.serviceId;
        const desiredCoreDigest = coreDigest(
          kind,
          props,
          desiredName,
          ownerId,
        );
        const coreTransitionRequired =
          previousProps === undefined ||
          !matchesDesired(
            {
              ...updateBody(
                kind,
                previousProps,
                previousProps.name ?? current.name ?? current.serviceId,
                ownerId,
              ),
              environmentId: previousProps.environmentId,
            },
            {
              ...updateBody(kind, props, desiredName, ownerId),
              environmentId: props.environmentId,
            },
          );
        const hasManagedWebCache =
          kind === "web_service" &&
          (props as WebServiceProps).cache !== undefined;
        const hasUnknownCacheTransition =
          phase === "reconcile" &&
          hasManagedWebCache &&
          current.coreDigest === undefined;
        let needsDeployment =
          phase === "update" ||
          hasUnknownCacheTransition ||
          (phase === "reconcile" &&
            current.coreDigest !== undefined &&
            current.coreDigest !== desiredCoreDigest &&
            coreTransitionRequired);
        let deploymentToWaitFor =
          phase === "create" ? current.deployId : undefined;
        if (
          phase === "create" ||
          (current.coreDigest === undefined &&
            !(phase === "read" && hasManagedWebCache))
        ) {
          current = { ...current, coreDigest: desiredCoreDigest };
        }

        if (phase === "create") {
          if (props.environmentId !== undefined) {
            current = { ...current, environmentId: props.environmentId };
          }
        } else if (
          phase !== "read" &&
          current.environmentId !== props.environmentId
        ) {
          yield* moveEnvironmentResource(
            api,
            current.serviceId,
            current.environmentId,
            props.environmentId,
          );
          const { environmentId: _previousEnvironment, ...withoutEnvironment } =
            current;
          current = (props.environmentId === undefined
            ? withoutEnvironment
            : {
                ...withoutEnvironment,
                environmentId: props.environmentId,
              }) as R["Attributes"];
          needsDeployment = true;
        }

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
          current = {
            ...current,
            ...makeAttributes(record(patched), {
              id: service.serviceId,
              ownerId: service.ownerId ?? api.ownerId,
              previous: service,
            }),
          };
          needsDeployment = true;
        }

        const deployment = props as ServiceDeploymentProps;
        if (deployment.env !== undefined) {
          const desiredDigest = environmentDigest(deployment.env);
          if (phase === "create") {
            current = { ...current, envDigest: desiredDigest };
          } else if (phase === "read") {
            if (current.envDigest === undefined) {
              current = {
                ...current,
                envDigest: yield* readEnvironmentDigest(
                  api,
                  current.serviceId,
                ),
              };
            }
          } else {
            const observedDigest = yield* readEnvironmentDigest(
              api,
              current.serviceId,
            );
            const transitionWasUnpersisted =
              current.envDigest !== desiredDigest;
            if (observedDigest !== desiredDigest) {
              yield* api.request({
                method: "PUT",
                path: `/services/${encodeURIComponent(current.serviceId)}/env-vars`,
                body: environmentBody(deployment.env),
              });
              needsDeployment = true;
            }
            if (transitionWasUnpersisted) needsDeployment = true;
            current = { ...current, envDigest: desiredDigest };
          }
        } else if (phase !== "read" && current.envDigest !== undefined) {
          const { envDigest: _released, ...released } = current;
          current = released as R["Attributes"];
        }

        if (scalable.has(kind)) {
          const desired = props as ServiceCoreProps;
          validateNumInstances(desired.numInstances);
          if (
            phase !== "create" &&
            phase !== "read" &&
            desired.numInstances !== undefined &&
            current.numInstances !== desired.numInstances
          ) {
            yield* api.request({
              method: "POST",
              path: `/services/${encodeURIComponent(current.serviceId)}/scale`,
              body: { numInstances: desired.numInstances },
            });
            current = { ...current, numInstances: desired.numInstances };
          }
        }

        if (phase !== "read" && !needsDeployment) {
          // Dropping an optional PATCH field releases management of that
          // field; it is not a configuration transition that needs a deploy.
          current = { ...current, coreDigest: desiredCoreDigest };
        }

        if (phase !== "read" && needsDeployment) {
          const deployId = yield* createDeployment(api, current.serviceId);
          current = { ...current, coreDigest: desiredCoreDigest };
          if (deployId !== undefined) {
            current = { ...current, deployId };
            deploymentToWaitFor = deployId;
          }
        }

        if (props.waitForDeploy && deploymentToWaitFor) {
          yield* waitForDeployment(
            api,
            current.serviceId,
            deploymentToWaitFor,
            props.deployTimeoutMs ?? 3 * 60 * 60 * 1_000,
          );
        }
        return current;
      }),
  });
};

export const WebServiceProvider = () => provider(WebService, "web_service");
export const PrivateServiceProvider = () =>
  provider(PrivateService, "private_service");
export const BackgroundWorkerProvider = () =>
  provider(BackgroundWorker, "background_worker");
export const CronJobProvider = () => provider(CronJob, "cron_job");
export const StaticSiteProvider = () => provider(StaticSite, "static_site");
