import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { paginate, poll, RenderApi, RenderApiError } from "./Api/Api.js";
import { resourceClass, digest, restProvider, reveal, unwrapEntity, unwrapRows, } from "./RestResource.js";
export const DedicatedIp = Resource.Resource("Render.DedicatedIp");
export const RegistryCredential = Resource.Resource("Render.RegistryCredential");
export const Webhook = Resource.Resource("Render.Webhook");
export const OwnerLogStream = Resource.Resource("Render.OwnerLogStream");
export const ResourceLogStream = Resource.Resource("Render.ResourceLogStream");
export const MetricsStream = Resource.Resource("Render.MetricsStream");
export const Workflow = Resource.Resource("Render.Workflow");
export const ServiceNotificationOverride = Resource.Resource("Render.ServiceNotificationOverride");
const string = (e, key) => typeof e[key] === "string" ? e[key] : undefined;
const dedicatedAttrs = (e, f) => {
    const id = string(e, "id") ?? f.id;
    const region = string(e, "region") ??
        (typeof e.region === "object" && e.region !== null
            ? string(e.region, "name")
            : undefined);
    return {
        id,
        dedicatedIpId: id,
        ownerId: f.ownerId,
        environmentIds: Array.isArray(e.environmentIds)
            ? e.environmentIds.filter((v) => typeof v === "string")
            : [],
        ips: Array.isArray(e.ips)
            ? e.ips.filter((v) => typeof v === "string")
            : [],
        ...(string(e, "name") ? { name: string(e, "name") } : {}),
        ...(string(e, "description")
            ? { description: string(e, "description") }
            : {}),
        ...(region ? { region: region } : {}),
        ...(string(e, "status") ? { status: string(e, "status") } : {}),
    };
};
export const DedicatedIpProvider = () => restProvider(DedicatedIp, {
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
    finalize: (attributes, _props, api) => attributes.status !== "CREATING" && attributes.status !== "PENDING"
        ? Effect.succeed(attributes)
        : poll(api
            .request({
            method: "GET",
            path: `/dedicated-ips/${encodeURIComponent(attributes.dedicatedIpId)}`,
        })
            .pipe(Effect.map((value) => dedicatedAttrs(unwrapEntity(value), {
            id: attributes.dedicatedIpId,
            ownerId: api.ownerId,
        }))), {
            timeoutMs: 15 * 60 * 1_000,
            while: (value) => value.status === "CREATING" || value.status === "PENDING",
        }).pipe(Effect.flatMap((value) => value.status === "FAILED" ||
            value.status === "DELETING" ||
            value.status === "DELETED"
            ? Effect.fail(new RenderApiError(`Dedicated IP provisioning ended in ${value.status}`))
            : Effect.succeed(value))),
});
const registryAttrs = (e, f) => {
    const id = string(e, "id") ?? f.id;
    return {
        id,
        registryCredentialId: id,
        ownerId: f.ownerId,
        ...(string(e, "name") ? { name: string(e, "name") } : {}),
        ...(string(e, "registry")
            ? {
                registry: string(e, "registry"),
            }
            : {}),
        ...(string(e, "username") ? { username: string(e, "username") } : {}),
        ...(f.previous?.authTokenDigest
            ? { authTokenDigest: f.previous.authTokenDigest }
            : {}),
    };
};
export const RegistryCredentialProvider = () => restProvider(RegistryCredential, {
    collection: "/registrycredentials",
    item: (id) => `/registrycredentials/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["registryCredentialId"],
    attributes: registryAttrs,
    remoteDiff: false,
    sensitiveChanged: (_olds, p, o) => (p.name !== undefined && o.name !== p.name) ||
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
const webhookAttrs = (e, f) => {
    const id = string(e, "id") ?? f.id;
    const signingSecret = typeof e.secret === "string"
        ? Redacted.make(e.secret)
        : f.previous?.signingSecret;
    return {
        id,
        webhookId: id,
        ownerId: f.ownerId,
        ...(string(e, "name") ? { name: string(e, "name") } : {}),
        ...(string(e, "url") ? { url: string(e, "url") } : {}),
        ...(typeof e.enabled === "boolean" ? { enabled: e.enabled } : {}),
        ...(Array.isArray(e.eventFilter)
            ? {
                eventFilter: e.eventFilter.filter((v) => typeof v === "string"),
            }
            : {}),
        ...(signingSecret ? { signingSecret } : {}),
    };
};
export const WebhookProvider = () => restProvider(Webhook, {
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
const resourceLogAttrs = (e, f) => ({
    id: string(e, "resourceId") ?? f.id,
    resourceId: string(e, "resourceId") ?? f.id,
    ...(string(e, "endpoint") ? { endpoint: string(e, "endpoint") } : {}),
    ...(string(e, "setting")
        ? { setting: string(e, "setting") }
        : {}),
    ...(f.previous?.tokenDigest ? { tokenDigest: f.previous.tokenDigest } : {}),
    ...(f.previous?.tokenCleared ? { tokenCleared: true } : {}),
});
export const ResourceLogStreamProvider = () => restProvider(ResourceLogStream, {
    collection: "/logs/streams/resource",
    item: (id) => `/logs/streams/resource/${encodeURIComponent(id)}`,
    ownerScoped: true,
    identity: "id",
    stables: ["resourceId"],
    resolveIdentity: (_id, p) => Effect.succeed(p.resourceId),
    immutable: ["resourceId"],
    createMethod: "PUT",
    updateMethod: "PUT",
    validate: (props) => (props.setting === "send" && props.endpoint === undefined) ||
        (props.setting === "drop" && props.endpoint !== undefined)
        ? Effect.fail(new RenderApiError("ResourceLogStream requires endpoint for send and forbids it for drop"))
        : Effect.void,
    createPath: (id) => `/logs/streams/resource/${encodeURIComponent(id)}`,
    attributes: resourceLogAttrs,
    remoteDiff: false,
    sensitiveChanged: (olds, p, o) => o.endpoint !== p.endpoint ||
        o.setting !== p.setting ||
        (p.token === null
            ? olds.token !== null || o.tokenCleared !== true
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
        const { tokenDigest: oldDigest, tokenCleared: wasCleared, ...rest } = a;
        const nextDigest = p.token === undefined
            ? oldDigest
            : p.token === null
                ? undefined
                : digest(p.token);
        const tokenCleared = p.token === undefined ? wasCleared : p.token === null ? true : undefined;
        return {
            ...rest,
            resourceId: p.resourceId,
            ...(nextDigest ? { tokenDigest: nextDigest } : {}),
            ...(tokenCleared ? { tokenCleared: true } : {}),
        };
    },
});
const workflowEnvBody = (envVars) => envVars?.map((entry) => entry.value === undefined
    ? { key: entry.key, generateValue: true }
    : { key: entry.key, value: Redacted.value(entry.value) });
const workflowEnvDigest = (envVars) => envVars === undefined
    ? undefined
    : digest(Redacted.make(JSON.stringify(workflowEnvBody([...envVars].sort((left, right) => left.key.localeCompare(right.key))))));
const workflowAttrs = (e, f) => {
    const id = string(e, "id") ?? f.id;
    return {
        id,
        workflowId: id,
        ownerId: f.ownerId,
        ...(string(e, "name") ? { name: string(e, "name") } : {}),
        ...(string(e, "region") ? { region: string(e, "region") } : {}),
        ...(string(e, "environmentId")
            ? { environmentId: string(e, "environmentId") }
            : {}),
        ...(string(e, "autoDeployTrigger")
            ? { autoDeployTrigger: string(e, "autoDeployTrigger") }
            : {}),
        ...(f.previous?.envVarsDigest
            ? { envVarsDigest: f.previous.envVarsDigest }
            : {}),
        ...(string(e, "createdAt") ? { createdAt: string(e, "createdAt") } : {}),
        ...(string(e, "updatedAt") ? { updatedAt: string(e, "updatedAt") } : {}),
    };
};
export const WorkflowProvider = () => restProvider(Workflow, {
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
    validate: (props) => {
        const invalid = props.envVars?.find((entry) => {
            const hasValue = entry.value !== undefined;
            const generatesValue = entry.generateValue === true;
            return hasValue === generatesValue;
        });
        return invalid
            ? Effect.fail(new RenderApiError(`Workflow env var ${invalid.key} requires exactly one of value or generateValue: true`))
            : Effect.void;
    },
    replaceWhen: (_olds, props, output) => output.envVarsDigest !== workflowEnvDigest(props.envVars),
    body: (p, name, ownerId) => ({
        name,
        ownerId,
        buildConfig: p.buildConfig,
        runCommand: p.runCommand,
        region: p.region,
        autoDeployTrigger: p.autoDeployTrigger ?? "commit",
        envVars: workflowEnvBody(p.envVars),
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
const ignore404 = (effect) => effect.pipe(Effect.catch((e) => e.isNotFound ? Effect.succeed(undefined) : Effect.fail(e)));
export const OwnerLogStreamProvider = () => Provider.effect(resourceClass(OwnerLogStream), Effect.gen(function* () {
    const getApi = yield* RenderApi;
    const read = (previous) => Effect.gen(function* () {
        const api = yield* getApi;
        const e = unwrapEntity(yield* api.request({
            method: "GET",
            path: `/logs/streams/owner/${encodeURIComponent(api.ownerId)}`,
        }));
        return {
            id: api.ownerId,
            ownerId: api.ownerId,
            ...(string(e, "endpoint")
                ? { endpoint: string(e, "endpoint") }
                : {}),
            ...(string(e, "preview")
                ? { preview: string(e, "preview") }
                : {}),
            ...(previous?.tokenDigest
                ? { tokenDigest: previous.tokenDigest }
                : {}),
            ...(previous?.tokenCleared ? { tokenCleared: true } : {}),
        };
    }).pipe(ignore404);
    return OwnerLogStream.Provider.of({
        stables: ["id", "ownerId"],
        list: () => read().pipe(Effect.map((v) => (v ? [v] : []))),
        read: ({ output }) => read(output).pipe(Effect.map((v) => (!v || output ? v : Unowned(v)))),
        diff: ({ olds, news, output }) => Effect.succeed(!isResolved(news) || !output
            ? undefined
            : output.endpoint !== news.endpoint ||
                output.preview !== news.preview ||
                (news.token === null
                    ? olds.token !== null || output.tokenCleared !== true
                    : news.token !== undefined &&
                        output.tokenDigest !== digest(news.token))
                ? { action: "update" }
                : undefined),
        reconcile: Effect.fn(function* ({ news, output }) {
            const api = yield* getApi;
            const e = unwrapEntity(yield* api.request({
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
            }));
            const tokenDigest = news.token === undefined
                ? output?.tokenDigest
                : news.token === null
                    ? undefined
                    : digest(news.token);
            const tokenCleared = news.token === undefined
                ? output?.tokenCleared
                : news.token === null
                    ? true
                    : undefined;
            return {
                id: api.ownerId,
                ownerId: api.ownerId,
                ...(string(e, "endpoint")
                    ? { endpoint: string(e, "endpoint") }
                    : {}),
                preview: news.preview,
                ...(tokenDigest === undefined ? {} : { tokenDigest }),
                ...(tokenCleared ? { tokenCleared: true } : {}),
            };
        }),
        delete: Effect.fn(function* () {
            const api = yield* getApi;
            yield* ignore404(api.request({
                method: "DELETE",
                path: `/logs/streams/owner/${encodeURIComponent(api.ownerId)}`,
            })).pipe(Effect.asVoid);
        }),
    });
}));
export const MetricsStreamProvider = () => Provider.effect(resourceClass(MetricsStream), Effect.gen(function* () {
    const getApi = yield* RenderApi;
    const read = (previous) => Effect.gen(function* () {
        const api = yield* getApi;
        const e = unwrapEntity(yield* api.request({
            method: "GET",
            path: `/metrics-stream/${encodeURIComponent(api.ownerId)}`,
        }));
        return {
            id: api.ownerId,
            ownerId: api.ownerId,
            ...(string(e, "provider")
                ? {
                    provider: string(e, "provider"),
                }
                : {}),
            ...(string(e, "url") ? { url: string(e, "url") } : {}),
            ...(previous?.tokenDigest
                ? { tokenDigest: previous.tokenDigest }
                : {}),
            ...(previous?.tokenCleared ? { tokenCleared: true } : {}),
        };
    }).pipe(ignore404);
    return MetricsStream.Provider.of({
        stables: ["id", "ownerId"],
        list: () => read().pipe(Effect.map((v) => (v ? [v] : []))),
        read: ({ output }) => read(output).pipe(Effect.map((v) => (!v || output ? v : Unowned(v)))),
        diff: ({ olds, news, output }) => Effect.succeed(!isResolved(news) || !output
            ? undefined
            : output.provider !== news.provider ||
                output.url !== news.url ||
                (news.token === null
                    ? olds.token !== null || output.tokenCleared !== true
                    : news.token !== undefined &&
                        output.tokenDigest !== digest(news.token))
                ? { action: "update" }
                : undefined),
        reconcile: Effect.fn(function* ({ news, output }) {
            const api = yield* getApi;
            const e = unwrapEntity(yield* api.request({
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
            }));
            const tokenDigest = news.token === undefined
                ? output?.tokenDigest
                : news.token === null
                    ? undefined
                    : digest(news.token);
            const tokenCleared = news.token === undefined
                ? output?.tokenCleared
                : news.token === null
                    ? true
                    : undefined;
            return {
                id: api.ownerId,
                ownerId: api.ownerId,
                ...(string(e, "provider")
                    ? {
                        provider: string(e, "provider"),
                    }
                    : {}),
                ...(string(e, "url") ? { url: string(e, "url") } : {}),
                ...(tokenDigest === undefined ? {} : { tokenDigest }),
                ...(tokenCleared ? { tokenCleared: true } : {}),
            };
        }),
        delete: Effect.fn(function* () {
            const api = yield* getApi;
            yield* ignore404(api.request({
                method: "DELETE",
                path: `/metrics-stream/${encodeURIComponent(api.ownerId)}`,
            })).pipe(Effect.asVoid);
        }),
    });
}));
const notificationAttributes = (entity, serviceId) => ({
    id: serviceId,
    serviceId,
    previewNotificationsEnabled: entity.previewNotificationsEnabled === "true" ||
        entity.previewNotificationsEnabled === "false"
        ? entity.previewNotificationsEnabled
        : "default",
    notificationsToSend: entity.notificationsToSend === "none" ||
        entity.notificationsToSend === "failure" ||
        entity.notificationsToSend === "all"
        ? entity.notificationsToSend
        : "default",
});
export const ServiceNotificationOverrideProvider = () => Provider.effect(resourceClass(ServiceNotificationOverride), Effect.gen(function* () {
    const getApi = yield* RenderApi;
    const read = (serviceId, owned) => Effect.gen(function* () {
        const api = yield* getApi;
        const attributes = notificationAttributes(unwrapEntity(yield* api.request({
            method: "GET",
            path: `/notification-settings/overrides/services/${encodeURIComponent(serviceId)}`,
        })), serviceId);
        if (!owned &&
            attributes.previewNotificationsEnabled === "default" &&
            attributes.notificationsToSend === "default") {
            return undefined;
        }
        return owned ? attributes : Unowned(attributes);
    }).pipe(ignore404);
    return ServiceNotificationOverride.Provider.of({
        stables: ["id", "serviceId"],
        list: Effect.fn(function* () {
            const api = yield* getApi;
            const rows = yield* paginate((cursor) => api
                .request({
                method: "GET",
                path: "/notification-settings/overrides",
                query: {
                    ownerId: [api.ownerId],
                    limit: 100,
                    ...(cursor === undefined ? {} : { cursor }),
                },
            })
                .pipe(Effect.map(unwrapRows)), { cursor: (row) => row.cursor, pageSize: 100 });
            return rows.flatMap(({ entity }) => {
                const serviceId = string(entity, "serviceId");
                return serviceId ? [notificationAttributes(entity, serviceId)] : [];
            });
        }),
        read: ({ olds, output }) => read(olds.serviceId, output !== undefined),
        diff: ({ olds, news, output }) => Effect.succeed(!isResolved(news)
            ? undefined
            : olds.serviceId !== news.serviceId
                ? { action: "replace" }
                : output &&
                    (output.previewNotificationsEnabled !==
                        String(news.previewNotificationsEnabled ?? "default") ||
                        output.notificationsToSend !==
                            (news.notificationsToSend ?? "default"))
                    ? { action: "update" }
                    : undefined),
        reconcile: Effect.fn(function* ({ news }) {
            const api = yield* getApi;
            const entity = unwrapEntity(yield* api.request({
                method: "PATCH",
                path: `/notification-settings/overrides/services/${encodeURIComponent(news.serviceId)}`,
                body: {
                    previewNotificationsEnabled: String(news.previewNotificationsEnabled ?? "default"),
                    notificationsToSend: news.notificationsToSend ?? "default",
                },
            }));
            return notificationAttributes(entity, news.serviceId);
        }),
        delete: Effect.fn(function* ({ output }) {
            const api = yield* getApi;
            yield* ignore404(api.request({
                method: "PATCH",
                path: `/notification-settings/overrides/services/${encodeURIComponent(output.serviceId)}`,
                body: {
                    previewNotificationsEnabled: "default",
                    notificationsToSend: "default",
                },
            })).pipe(Effect.asVoid);
        }),
    });
}));
//# sourceMappingURL=AccountResources.js.map