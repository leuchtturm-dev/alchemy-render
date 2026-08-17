import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { poll, RenderApiError } from "./Api/Api.js";
import { digest, moveEnvironmentResource, restProvider, unwrapEntity, } from "./RestResource.js";
export const Postgres = Resource.Resource("Render.Postgres");
export const KeyValue = Resource.Resource("Render.KeyValue");
export const Redis = Resource.Resource("Render.Redis");
const string = (value) => typeof value === "string" ? value : undefined;
const attrs = (entity, fallback) => {
    const id = string(entity.id) ?? fallback.id;
    const region = string(entity.region) ??
        (typeof entity.region === "object" && entity.region !== null
            ? string(entity.region.name)
            : undefined);
    return {
        id,
        datastoreId: id,
        ownerId: fallback.ownerId,
        ...(string(entity.name) ? { name: string(entity.name) } : {}),
        ...(string(entity.status) ? { status: string(entity.status) } : {}),
        ...(string(entity.plan) ? { plan: string(entity.plan) } : {}),
        ...(region ? { region: region } : {}),
        ...(string(entity.dashboardUrl)
            ? { dashboardUrl: string(entity.dashboardUrl) }
            : {}),
        ...(string(entity.version) ? { version: string(entity.version) } : {}),
        ...(typeof entity.diskSizeGB === "number"
            ? { diskSizeGB: entity.diskSizeGB }
            : {}),
        ...(string(entity.databaseName)
            ? { databaseName: string(entity.databaseName) }
            : {}),
        ...(string(entity.databaseUser)
            ? { databaseUser: string(entity.databaseUser) }
            : {}),
        ...(string(entity.environmentId)
            ? { environmentId: string(entity.environmentId) }
            : {}),
        ...(string(entity.createdAt)
            ? { createdAt: string(entity.createdAt) }
            : {}),
        ...(string(entity.updatedAt)
            ? { updatedAt: string(entity.updatedAt) }
            : {}),
        ...(fallback.previous?.connectionInfo
            ? { connectionInfo: fallback.previous.connectionInfo }
            : {}),
        ...(fallback.previous?.datadogApiKeyDigest
            ? { datadogApiKeyDigest: fallback.previous.datadogApiKeyDigest }
            : {}),
        ...(fallback.previous?.datadogSite === undefined
            ? {}
            : { datadogSite: fallback.previous.datadogSite }),
    };
};
const redactConnectionInfo = (value) => {
    const entity = unwrapEntity(value);
    const redact = (key) => typeof entity[key] === "string"
        ? Redacted.make(entity[key])
        : undefined;
    const command = redact("psqlCommand") ?? redact("cliCommand") ?? redact("redisCLICommand");
    return {
        ...(redact("internalConnectionString")
            ? { internalConnectionString: redact("internalConnectionString") }
            : {}),
        ...(redact("externalConnectionString")
            ? { externalConnectionString: redact("externalConnectionString") }
            : {}),
        ...(redact("internalConnectionPoolString")
            ? {
                internalConnectionPoolString: redact("internalConnectionPoolString"),
            }
            : {}),
        ...(redact("externalConnectionPoolString")
            ? {
                externalConnectionPoolString: redact("externalConnectionPoolString"),
            }
            : {}),
        ...(redact("password") ? { password: redact("password") } : {}),
        ...(command ? { command } : {}),
    };
};
const hydrateConnection = (kind, attributes, api) => Effect.gen(function* () {
    let current = attributes;
    const transient = new Set([
        "creating",
        "config_restart",
        "recovery_in_progress",
        "updating_instance",
    ]);
    if (current.status && transient.has(current.status)) {
        const entity = yield* poll(api
            .request({
            method: "GET",
            path: `/${kind}/${encodeURIComponent(current.datastoreId)}`,
        })
            .pipe(Effect.map(unwrapEntity)), {
            timeoutMs: 15 * 60 * 1_000,
            while: (row) => transient.has(String(row.status ?? "")),
        });
        current = attrs(entity, {
            id: current.datastoreId,
            ownerId: current.ownerId ?? api.ownerId,
            previous: current,
        });
    }
    if (current.status === "unavailable" ||
        current.status === "recovery_failed") {
        return yield* Effect.fail(new RenderApiError(`Render ${kind} ${current.datastoreId} ended provisioning in ${current.status}`));
    }
    if (current.status === "suspended" ||
        current.status === "maintenance_scheduled" ||
        current.status === "maintenance_in_progress" ||
        current.status === "unknown") {
        return current;
    }
    const info = yield* api.request({
        method: "GET",
        path: `/${kind}/${encodeURIComponent(current.datastoreId)}/connection-info`,
    });
    return { ...current, connectionInfo: redactConnectionInfo(info) };
});
const finalizeDatastore = (kind, attributes, props, api, phase) => Effect.gen(function* () {
    let current = attributes;
    if (phase === "create") {
        if (props.environmentId !== undefined) {
            current = { ...current, environmentId: props.environmentId };
        }
    }
    else if (phase !== "read" &&
        current.environmentId !== props.environmentId) {
        yield* moveEnvironmentResource(api, current.datastoreId, current.environmentId, props.environmentId);
        const { environmentId: _previousEnvironment, ...withoutEnvironment } = current;
        current =
            props.environmentId === undefined
                ? withoutEnvironment
                : { ...withoutEnvironment, environmentId: props.environmentId };
    }
    return yield* hydrateConnection(kind, current, api);
});
const keyValueBody = (props, name, ownerId, create) => ({
    name,
    ...(create
        ? { ownerId, region: props.region, environmentId: props.environmentId }
        : {}),
    plan: props.plan,
    maxmemoryPolicy: props.maxmemoryPolicy,
    persistenceMode: props.persistenceMode,
    ipAllowList: props.ipAllowList ?? [],
});
const keyValueObserve = (entity) => {
    const options = typeof entity.options === "object" && entity.options !== null
        ? entity.options
        : {};
    return {
        name: entity.name,
        plan: entity.plan,
        maxmemoryPolicy: options.maxmemoryPolicy,
        persistenceMode: options.persistenceMode,
        ipAllowList: entity.ipAllowList,
    };
};
export const PostgresProvider = () => restProvider(Postgres, {
    collection: "/postgres",
    item: (id) => `/postgres/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["datastoreId"],
    immutable: ["region", "version", "databaseName", "databaseUser"],
    validate: (props, observed, previousProps) => {
        if (props.diskSizeGB !== undefined &&
            (!Number.isInteger(props.diskSizeGB) || props.diskSizeGB < 1)) {
            return Effect.fail(new RenderApiError("Render Postgres diskSizeGB must be a positive integer"));
        }
        if (props.diskSizeGB !== undefined &&
            observed?.diskSizeGB !== undefined &&
            props.diskSizeGB < observed.diskSizeGB &&
            (props.enableDiskAutoscaling !== true ||
                (previousProps?.diskSizeGB !== undefined &&
                    props.diskSizeGB < previousProps.diskSizeGB))) {
            return Effect.fail(new RenderApiError(`Render Postgres storage can only grow (current ${observed.diskSizeGB} GB, requested ${props.diskSizeGB} GB)`));
        }
        return Effect.void;
    },
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
        datadogAPIKey: props.datadogApiKey === undefined
            ? undefined
            : Redacted.value(props.datadogApiKey),
        datadogSite: props.datadogSite,
    }),
    updateBody: (props, name, _ownerId, previous) => ({
        name,
        plan: props.plan,
        diskSizeGB: props.diskSizeGB !== undefined &&
            previous?.diskSizeGB !== undefined &&
            props.diskSizeGB <= previous.diskSizeGB
            ? undefined
            : props.diskSizeGB,
        enableHighAvailability: props.enableHighAvailability ?? false,
        enableDiskAutoscaling: props.enableDiskAutoscaling ?? false,
        connectionPool: props.connectionPool ?? "none",
        ipAllowList: props.ipAllowList ?? [],
        parameterOverrides: props.parameterOverrides ?? {},
        readReplicas: props.readReplicas ?? [],
        datadogAPIKey: props.datadogApiKey === undefined
            ? previous?.datadogApiKeyDigest === undefined
                ? undefined
                : ""
            : Redacted.value(props.datadogApiKey),
        datadogSite: props.datadogSite === undefined && previous?.datadogSite !== undefined
            ? ""
            : props.datadogSite,
    }),
    compareBody: (props, name, _ownerId, previous) => ({
        name,
        plan: props.plan,
        diskSizeGB: props.enableDiskAutoscaling === true &&
            props.diskSizeGB !== undefined &&
            previous?.diskSizeGB !== undefined &&
            props.diskSizeGB <= previous.diskSizeGB
            ? undefined
            : props.diskSizeGB,
        enableHighAvailability: props.enableHighAvailability ?? false,
        enableDiskAutoscaling: props.enableDiskAutoscaling ?? false,
        connectionPool: props.connectionPool ?? "none",
        ipAllowList: props.ipAllowList ?? [],
        parameterOverrides: props.parameterOverrides ?? {},
        readReplicas: props.readReplicas ?? [],
    }),
    sensitiveChanged: (_olds, props, output) => output.environmentId !== props.environmentId ||
        output.datadogApiKeyDigest !==
            (props.datadogApiKey ? digest(props.datadogApiKey) : undefined) ||
        output.datadogSite !== props.datadogSite,
    afterWrite: (attributes, props) => {
        const { datadogApiKeyDigest: _oldDigest, datadogSite: _oldSite, ...rest } = attributes;
        return {
            ...rest,
            ...(props.datadogApiKey
                ? { datadogApiKeyDigest: digest(props.datadogApiKey) }
                : {}),
            ...(props.datadogSite === undefined
                ? {}
                : { datadogSite: props.datadogSite }),
        };
    },
    finalize: (attributes, props, api, phase) => finalizeDatastore("postgres", attributes, props, api, phase),
});
export const KeyValueProvider = () => restProvider(KeyValue, {
    collection: "/key-value",
    item: (id) => `/key-value/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["datastoreId"],
    immutable: ["region"],
    attributes: attrs,
    observe: keyValueObserve,
    body: (props, name, ownerId) => keyValueBody(props, name, ownerId, true),
    updateBody: (props, name, ownerId) => keyValueBody(props, name, ownerId, false),
    sensitiveChanged: (_olds, props, output) => output.environmentId !== props.environmentId,
    finalize: (attributes, props, api, phase) => finalizeDatastore("key-value", attributes, props, api, phase),
});
export const RedisProvider = () => restProvider(Redis, {
    collection: "/redis",
    item: (id) => `/redis/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["datastoreId"],
    immutable: ["region"],
    attributes: attrs,
    observe: keyValueObserve,
    body: (props, name, ownerId) => keyValueBody(props, name, ownerId, true),
    updateBody: (props, name, ownerId) => keyValueBody(props, name, ownerId, false),
    sensitiveChanged: (_olds, props, output) => output.environmentId !== props.environmentId,
    finalize: (attributes, props, api, phase) => finalizeDatastore("redis", attributes, props, api, phase),
});
//# sourceMappingURL=Datastores.js.map