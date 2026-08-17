import { createHash } from "node:crypto";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { poll, RenderApiError, } from "./Api/Api.js";
import { matchesDesired, moveEnvironmentResource, restProvider, unwrapEntity, unwrapRows, } from "./RestResource.js";
const ALLOW_ALL_IPS = [
    { cidrBlock: "0.0.0.0/0", description: "everywhere" },
];
export const WebService = Resource.Resource("Render.WebService");
export const PrivateService = Resource.Resource("Render.PrivateService");
export const BackgroundWorker = Resource.Resource("Render.BackgroundWorker");
export const CronJob = Resource.Resource("Render.CronJob");
export const StaticSite = Resource.Resource("Render.StaticSite");
const envSpecificDetails = (props) => {
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
const cronCreateEnvSpecificDetails = (props) => {
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
            ...(props.image.registryCredentialId === undefined
                ? {}
                : {
                    registryCredential: {
                        id: props.image.registryCredentialId,
                    },
                }),
        };
    }
    return envSpecificDetails(props);
};
const validateSource = (props) => {
    if (props.runtime === "image") {
        if (!props.image?.imagePath) {
            throw new Error("Render image services require image.imagePath");
        }
        return;
    }
    if (!props.repo) {
        throw new Error("Render repository services require repo");
    }
    if (props.runtime !== "docker" &&
        (!props.buildCommand || !props.startCommand)) {
        throw new Error(`Render ${props.runtime} services require buildCommand and startCommand`);
    }
};
const sourceBody = (props, ownerId) => {
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
const scalable = new Set([
    "web_service",
    "private_service",
    "background_worker",
]);
const validateNumInstances = (value) => {
    if (value !== undefined &&
        (!Number.isInteger(value) || value < 1 || value > 100)) {
        throw new Error("Render numInstances must be an integer from 1 to 100");
    }
};
const environmentEntries = (env) => Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
    if (!Redacted.isRedacted(value)) {
        throw new Error(`Render environment value for ${key} must be Redacted`);
    }
    return [key, Redacted.value(value)];
});
const environmentDigestFromEntries = (entries) => {
    const hash = createHash("sha256");
    for (const [key, value] of entries) {
        hash.update(String(Buffer.byteLength(key))).update(":").update(key);
        hash.update(String(Buffer.byteLength(value))).update(":").update(value);
    }
    return hash.digest("hex");
};
const environmentDigest = (env) => environmentDigestFromEntries(environmentEntries(env));
const environmentBody = (env) => environmentEntries(env).map(([key, value]) => ({ key, value }));
const readEnvironmentDigest = (api, serviceId) => Effect.gen(function* () {
    const entries = [];
    let cursor;
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
        if (!next && rows.length >= 100) {
            return yield* Effect.fail(new RenderApiError("Render list response reached the requested limit without a pagination cursor"));
        }
        if (next === cursor && rows.length >= 100) {
            return yield* Effect.fail(new RenderApiError("Render list response reached the requested limit with a non-advancing pagination cursor"));
        }
        if (!next || next === cursor || rows.length === 0)
            break;
        cursor = next;
    }
    entries.sort(([left], [right]) => left.localeCompare(right));
    return environmentDigestFromEntries(entries);
});
const createDetails = (kind, props) => {
    if (kind === "static_site") {
        const site = props;
        return {
            buildCommand: site.buildCommand,
            publishPath: site.publishPath,
            previews: site.previews,
            renderSubdomainPolicy: site.renderSubdomainPolicy,
            ipAllowList: site.ipAllowList,
        };
    }
    const service = props;
    const serviceCore = service;
    validateNumInstances(serviceCore.numInstances);
    return {
        runtime: service.runtime,
        envSpecificDetails: kind === "cron_job"
            ? cronCreateEnvSpecificDetails(service)
            : envSpecificDetails(service),
        plan: service.plan,
        region: service.region,
        preDeployCommand: kind === "cron_job"
            ? undefined
            : service.preDeployCommand,
        previews: kind === "cron_job" ? undefined : service.previews,
        maxShutdownDelaySeconds: kind === "cron_job"
            ? undefined
            : service.maxShutdownDelaySeconds,
        ...(scalable.has(kind)
            ? kind === "web_service" && serviceCore.numInstances === undefined
                ? {}
                : { numInstances: serviceCore.numInstances ?? 1 }
            : {}),
        ...(kind === "web_service"
            ? {
                healthCheckPath: service.healthCheckPath,
                maintenanceMode: service.maintenanceMode,
                renderSubdomainPolicy: service
                    .renderSubdomainPolicy,
                ipAllowList: service.ipAllowList,
            }
            : {}),
        ...(kind === "cron_job"
            ? { schedule: service.schedule }
            : {}),
    };
};
const updateDetails = (kind, props) => {
    const details = createDetails(kind, props);
    delete details.region;
    delete details.numInstances;
    if (kind === "cron_job") {
        details.envSpecificDetails = envSpecificDetails(props);
    }
    if (kind === "static_site") {
        const site = props;
        details.previews = site.previews;
        details.renderSubdomainPolicy = site.renderSubdomainPolicy;
        details.ipAllowList = site.ipAllowList;
    }
    else if (kind !== "cron_job") {
        const service = props;
        details.preDeployCommand = service.preDeployCommand;
        details.previews = service.previews;
        details.maxShutdownDelaySeconds = service.maxShutdownDelaySeconds;
    }
    if (kind === "web_service") {
        const web = props;
        details.healthCheckPath = web.healthCheckPath;
        details.maintenanceMode = web.maintenanceMode;
        details.renderSubdomainPolicy = web.renderSubdomainPolicy;
        details.cache = web.cache;
        details.ipAllowList = web.ipAllowList;
    }
    return details;
};
const createBody = (kind, props, name, ownerId) => ({
    type: kind,
    name,
    ownerId,
    environmentId: props.environmentId,
    autoDeploy: props.autoDeploy,
    rootDir: props.rootDir,
    buildFilter: props.buildFilter,
    ...(props.env !== undefined
        ? { envVars: environmentBody(props.env) }
        : {}),
    ...(kind === "static_site"
        ? { repo: props.repo, branch: props.branch }
        : sourceBody(props, ownerId)),
    serviceDetails: createDetails(kind, props),
});
const updateBody = (kind, props, name, ownerId) => ({
    name,
    // Prebuilt image services do not support repository auto-deploy updates.
    autoDeploy: "runtime" in props && props.runtime === "image"
        ? undefined
        : props.autoDeploy,
    rootDir: props.rootDir,
    buildFilter: props.buildFilter,
    ...(kind === "static_site"
        ? { repo: props.repo, branch: props.branch }
        : sourceBody(props, ownerId)),
    serviceDetails: updateDetails(kind, props),
});
const coreDigest = (kind, props, name, ownerId) => createHash("sha256")
    .update(JSON.stringify({
    ...updateBody(kind, props, name, ownerId),
    environmentId: props.environmentId,
}))
    .digest("hex");
const record = (value) => typeof value === "object" && value !== null
    ? value
    : {};
const observe = (entity, kind) => {
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
    const details = {
        ...rawDetails,
        envSpecificDetails: normalizedEnvDetails,
        preDeployCommand: rawDetails.preDeployCommand ?? envDetails.preDeployCommand ?? "",
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
        image: typeof entity.imagePath === "string"
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
const attributes = (kind) => (entity, fallback) => {
    const id = typeof entity.id === "string" ? entity.id : fallback.id;
    const details = record(entity.serviceDetails);
    const region = typeof details.region === "string" ? details.region : undefined;
    return {
        id,
        serviceId: id,
        type: kind,
        ownerId: typeof entity.ownerId === "string" ? entity.ownerId : fallback.ownerId,
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
            ? { runtime: details.runtime }
            : {}),
        ...(typeof details.plan === "string" ? { plan: details.plan } : {}),
        ...(region ? { region: region } : {}),
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
const waitForDeployment = (api, serviceId, deployId, timeoutMs) => Effect.gen(function* () {
    const terminal = new Set([
        "live",
        "deactivated",
        "build_failed",
        "update_failed",
        "canceled",
        "pre_deploy_failed",
    ]);
    const deploy = yield* poll(api
        .request({
        method: "GET",
        path: `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`,
    })
        .pipe(Effect.map((value) => record(value))), {
        timeoutMs,
        while: (value) => !terminal.has(String(value.status ?? "")),
    });
    if (deploy.status !== "live") {
        return yield* Effect.fail(new RenderApiError(`Render deploy ${deployId} ended in ${String(deploy.status)}`));
    }
});
const createDeployment = (api, serviceId) => api
    .request({
    method: "POST",
    path: `/services/${encodeURIComponent(serviceId)}/deploys`,
    body: {},
})
    .pipe(Effect.map((value) => {
    const deploy = unwrapEntity(value);
    return typeof deploy.id === "string" ? deploy.id : undefined;
}));
const provider = (resource, kind) => {
    const makeAttributes = (entity, fallback) => attributes(kind)(entity, fallback);
    return restProvider(resource, {
        collection: "/services",
        item: (id) => `/services/${encodeURIComponent(id)}`,
        ownerScoped: true,
        stables: ["serviceId"],
        filter: (entity) => entity.type === kind,
        lookupQuery: () => ({ type: [kind] }),
        immutable: (kind === "static_site" ? [] : ["region"]),
        body: (props, name, ownerId) => createBody(kind, props, name, ownerId),
        updateBody: (props, name, ownerId) => updateBody(kind, props, name, ownerId),
        observe: (entity) => observe(entity, kind),
        attributes: makeAttributes,
        reconcileOnNoop: true,
        sensitiveChanged: (_olds, news, output) => {
            const desiredCoreDigest = coreDigest(kind, news, news.name ?? output.name ?? output.serviceId, output.ownerId ?? "");
            if (output.coreDigest !== undefined &&
                desiredCoreDigest !== output.coreDigest) {
                return true;
            }
            const desired = news;
            const desiredEnvDigest = desired.env === undefined ? undefined : environmentDigest(desired.env);
            return (news.environmentId !== output.environmentId ||
                desiredEnvDigest !== output.envDigest ||
                (scalable.has(kind) &&
                    desired.numInstances !== undefined &&
                    desired.numInstances !== output.numInstances));
        },
        remoteSensitiveChanged: (news, output, api) => {
            const desired = news;
            if (desired.env === undefined)
                return Effect.succeed(false);
            const digest = environmentDigest(desired.env);
            if (digest !== output.envDigest)
                return Effect.succeed(true);
            return readEnvironmentDigest(api, output.serviceId).pipe(Effect.map((observed) => observed !== digest));
        },
        finalize: (service, props, api, phase, previousProps) => Effect.gen(function* () {
            let current = service;
            const ownerId = current.ownerId ?? api.ownerId;
            const desiredName = props.name ?? current.name ?? current.serviceId;
            const desiredCoreDigest = coreDigest(kind, props, desiredName, ownerId);
            const coreTransitionRequired = previousProps === undefined ||
                !matchesDesired({
                    ...updateBody(kind, previousProps, previousProps.name ?? current.name ?? current.serviceId, ownerId),
                    environmentId: previousProps.environmentId,
                }, {
                    ...updateBody(kind, props, desiredName, ownerId),
                    environmentId: props.environmentId,
                });
            const hasManagedWebCache = kind === "web_service" &&
                props.cache !== undefined;
            const hasUnknownCacheTransition = phase === "reconcile" &&
                hasManagedWebCache &&
                current.coreDigest === undefined;
            let needsDeployment = phase === "update" ||
                hasUnknownCacheTransition ||
                (phase === "reconcile" &&
                    current.coreDigest !== undefined &&
                    current.coreDigest !== desiredCoreDigest &&
                    coreTransitionRequired);
            let deploymentToWaitFor = phase === "create" ? current.deployId : undefined;
            if (phase === "create" ||
                (current.coreDigest === undefined &&
                    !(phase === "read" && hasManagedWebCache))) {
                current = { ...current, coreDigest: desiredCoreDigest };
            }
            if (phase === "create") {
                if (props.environmentId !== undefined) {
                    current = { ...current, environmentId: props.environmentId };
                }
            }
            else if (phase !== "read" &&
                current.environmentId !== props.environmentId) {
                yield* moveEnvironmentResource(api, current.serviceId, current.environmentId, props.environmentId);
                const { environmentId: _previousEnvironment, ...withoutEnvironment } = current;
                current = (props.environmentId === undefined
                    ? withoutEnvironment
                    : {
                        ...withoutEnvironment,
                        environmentId: props.environmentId,
                    });
                needsDeployment = true;
            }
            if (phase === "create" &&
                kind === "web_service" &&
                props.cache) {
                const patched = yield* api.request({
                    method: "PATCH",
                    path: `/services/${encodeURIComponent(service.serviceId)}`,
                    body: {
                        serviceDetails: { cache: props.cache },
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
            const deployment = props;
            if (deployment.env !== undefined) {
                const desiredDigest = environmentDigest(deployment.env);
                if (phase === "create") {
                    current = { ...current, envDigest: desiredDigest };
                }
                else if (phase === "read") {
                    if (current.envDigest === undefined) {
                        current = {
                            ...current,
                            envDigest: yield* readEnvironmentDigest(api, current.serviceId),
                        };
                    }
                }
                else {
                    const observedDigest = yield* readEnvironmentDigest(api, current.serviceId);
                    const transitionWasUnpersisted = current.envDigest !== desiredDigest;
                    if (observedDigest !== desiredDigest) {
                        yield* api.request({
                            method: "PUT",
                            path: `/services/${encodeURIComponent(current.serviceId)}/env-vars`,
                            body: environmentBody(deployment.env),
                        });
                        needsDeployment = true;
                    }
                    if (transitionWasUnpersisted)
                        needsDeployment = true;
                    current = { ...current, envDigest: desiredDigest };
                }
            }
            else if (phase !== "read" && current.envDigest !== undefined) {
                const { envDigest: _released, ...released } = current;
                current = released;
            }
            if (scalable.has(kind)) {
                const desired = props;
                validateNumInstances(desired.numInstances);
                if (phase !== "create" &&
                    phase !== "read" &&
                    desired.numInstances !== undefined &&
                    current.numInstances !== desired.numInstances) {
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
                yield* waitForDeployment(api, current.serviceId, deploymentToWaitFor, props.deployTimeoutMs ?? 3 * 60 * 60 * 1_000);
            }
            return current;
        }),
    });
};
export const WebServiceProvider = () => provider(WebService, "web_service");
export const PrivateServiceProvider = () => provider(PrivateService, "private_service");
export const BackgroundWorkerProvider = () => provider(BackgroundWorker, "background_worker");
export const CronJobProvider = () => provider(CronJob, "cron_job");
export const StaticSiteProvider = () => provider(StaticSite, "static_site");
//# sourceMappingURL=Services.js.map