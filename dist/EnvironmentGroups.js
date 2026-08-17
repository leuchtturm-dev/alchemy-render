import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { RenderApi, RenderApiError } from "./Api/Api.js";
import { resourceClass, digest, moveEnvironmentResource, restProvider, reveal, unwrapEntity, } from "./RestResource.js";
export const EnvironmentGroup = Resource.Resource("Render.EnvironmentGroup");
export const EnvironmentGroupLink = Resource.Resource("Render.EnvironmentGroupLink");
export const EnvironmentGroupEnvVar = Resource.Resource("Render.EnvironmentGroupEnvVar");
export const EnvironmentGroupSecretFile = Resource.Resource("Render.EnvironmentGroupSecretFile");
export const EnvironmentGroupProvider = () => restProvider(EnvironmentGroup, {
    collection: "/env-groups",
    item: (id) => `/env-groups/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["environmentGroupId"],
    body: (p, name, ownerId) => ({
        name,
        ownerId,
        environmentId: p.environmentId,
        envVars: [],
    }),
    updateBody: (_p, name) => ({ name }),
    sensitiveChanged: (_olds, props, output) => output.environmentId !== props.environmentId,
    attributes: (e, f) => {
        const id = typeof e.id === "string" ? e.id : f.id;
        return {
            id,
            environmentGroupId: id,
            ownerId: f.ownerId,
            ...(typeof e.name === "string" ? { name: e.name } : {}),
            ...(typeof e.environmentId === "string"
                ? { environmentId: e.environmentId }
                : {}),
        };
    },
    finalize: (attributes, props, api, phase) => Effect.gen(function* () {
        if (phase === "read")
            return attributes;
        if (phase === "create") {
            return props.environmentId === undefined
                ? attributes
                : { ...attributes, environmentId: props.environmentId };
        }
        if (attributes.environmentId === props.environmentId)
            return attributes;
        yield* moveEnvironmentResource(api, attributes.environmentGroupId, attributes.environmentId, props.environmentId);
        const { environmentId: _previousEnvironment, ...withoutEnvironment } = attributes;
        return props.environmentId === undefined
            ? withoutEnvironment
            : { ...withoutEnvironment, environmentId: props.environmentId };
    }),
});
export const EnvironmentGroupLinkProvider = () => Provider.effect(resourceClass(EnvironmentGroupLink), Effect.gen(function* () {
    const getApi = yield* RenderApi;
    const read = (p, owned) => Effect.gen(function* () {
        const api = yield* getApi;
        const data = yield* api.request({
            method: "GET",
            path: `/env-groups/${encodeURIComponent(p.environmentGroupId)}`,
        });
        const links = unwrapEntity(data).serviceLinks;
        const found = Array.isArray(links) &&
            links.some((v) => typeof v === "object" &&
                v !== null &&
                v.id === p.serviceId);
        if (!found)
            return undefined;
        const attrs = {
            id: p.serviceId,
            serviceId: p.serviceId,
            environmentGroupId: p.environmentGroupId,
        };
        return owned ? attrs : Unowned(attrs);
    }).pipe(Effect.catch((e) => e.isNotFound ? Effect.succeed(undefined) : Effect.fail(e)));
    return EnvironmentGroupLink.Provider.of({
        stables: ["id", "environmentGroupId", "serviceId"],
        nuke: { skip: true },
        list: () => Effect.succeed([]),
        read: ({ olds, output }) => read(olds, output !== undefined),
        diff: ({ olds, news }) => Effect.succeed(!isResolved(news)
            ? undefined
            : olds.environmentGroupId !== news.environmentGroupId ||
                olds.serviceId !== news.serviceId
                ? { action: "replace" }
                : undefined),
        reconcile: Effect.fn(function* ({ news }) {
            const existing = yield* read(news, true);
            if (existing)
                return existing;
            const api = yield* getApi;
            yield* api.request({
                method: "POST",
                path: `/env-groups/${encodeURIComponent(news.environmentGroupId)}/services/${encodeURIComponent(news.serviceId)}`,
            });
            return {
                id: news.serviceId,
                serviceId: news.serviceId,
                environmentGroupId: news.environmentGroupId,
            };
        }),
        delete: Effect.fn(function* ({ output }) {
            const api = yield* getApi;
            yield* api
                .request({
                method: "DELETE",
                path: `/env-groups/${encodeURIComponent(output.environmentGroupId)}/services/${encodeURIComponent(output.serviceId)}`,
            })
                .pipe(Effect.asVoid, Effect.catch((e) => e.isNotFound ? Effect.void : Effect.fail(e)));
        }),
    });
}));
const secretAttrs = (e, f) => {
    const generateValue = typeof f.props === "object" &&
        f.props !== null &&
        f.props.generateValue === true;
    const remoteValue = typeof e.value === "string"
        ? e.value
        : typeof e.content === "string"
            ? e.content
            : undefined;
    const valueDigest = remoteValue === undefined
        ? f.previous?.valueDigest
        : digest(Redacted.make(remoteValue));
    return {
        id: f.id,
        generated: f.previous?.generated ?? generateValue,
        ...(typeof e.key === "string"
            ? { name: e.key }
            : typeof e.name === "string"
                ? { name: e.name }
                : {}),
        ...(valueDigest === undefined ? {} : { valueDigest }),
    };
};
export const EnvironmentGroupEnvVarProvider = () => restProvider(EnvironmentGroupEnvVar, {
    collection: (p) => `/env-groups/${encodeURIComponent(p.environmentGroupId)}/env-vars`,
    item: (key, p) => `/env-groups/${encodeURIComponent(p.environmentGroupId)}/env-vars/${encodeURIComponent(key)}`,
    listable: false,
    nukeSkip: true,
    identity: "key",
    immutable: ["environmentGroupId", "key"],
    createMethod: "PUT",
    recoverPut: true,
    createPath: (key, p) => `/env-groups/${encodeURIComponent(p.environmentGroupId)}/env-vars/${encodeURIComponent(key)}`,
    updateMethod: "PUT",
    remoteDiff: false,
    existingSatisfies: (_entity, props) => props.generateValue === true && props.value === undefined,
    validate: (props) => {
        const hasValue = props.value !== undefined;
        const generatesValue = props.generateValue === true;
        return hasValue === generatesValue
            ? Effect.fail(new RenderApiError("EnvironmentGroupEnvVar requires exactly one of value or generateValue: true"))
            : Effect.void;
    },
    sensitiveChanged: (_olds, news, output) => news.value === undefined
        ? output.generated !== true
        : output.valueDigest !== digest(news.value),
    body: (p) => p.value === undefined
        ? { generateValue: true }
        : { value: reveal(p.value) },
    attributes: secretAttrs,
    afterWrite: (a, p) => {
        const { valueDigest: _oldDigest, ...rest } = a;
        return {
            ...rest,
            generated: p.value === undefined,
            ...(p.value === undefined ? {} : { valueDigest: digest(p.value) }),
        };
    },
});
export const EnvironmentGroupSecretFileProvider = () => restProvider(EnvironmentGroupSecretFile, {
    collection: (p) => `/env-groups/${encodeURIComponent(p.environmentGroupId)}/secret-files`,
    item: (name, p) => `/env-groups/${encodeURIComponent(p.environmentGroupId)}/secret-files/${encodeURIComponent(name)}`,
    listable: false,
    nukeSkip: true,
    identity: "key",
    immutable: ["environmentGroupId", "name"],
    createMethod: "PUT",
    recoverPut: true,
    createPath: (name, p) => `/env-groups/${encodeURIComponent(p.environmentGroupId)}/secret-files/${encodeURIComponent(name)}`,
    updateMethod: "PUT",
    remoteDiff: false,
    sensitiveChanged: (_olds, news, output) => output.valueDigest !== digest(news.content),
    body: (p) => ({ content: reveal(p.content) }),
    attributes: secretAttrs,
    afterWrite: (a, p) => ({ ...a, valueDigest: digest(p.content) }),
});
//# sourceMappingURL=EnvironmentGroups.js.map