import { createHash } from "node:crypto";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { RenderApi, RenderApiError, } from "./Api/Api.js";
import { resourceClass, digest, restProvider, reveal, unwrapEntity, } from "./RestResource.js";
export const ServiceEnvVar = Resource.Resource("Render.ServiceEnvVar");
export const ServiceSecretFile = Resource.Resource("Render.ServiceSecretFile");
export const CustomDomain = Resource.Resource("Render.CustomDomain");
export const Disk = Resource.Resource("Render.Disk");
export const Header = Resource.Resource("Render.Header");
export const Route = Resource.Resource("Render.Route");
export const Autoscaling = Resource.Resource("Render.Autoscaling");
const deployServiceConfiguration = (api, serviceId, ignoreNotFound = false) => api
    .request({
    method: "POST",
    path: `/services/${encodeURIComponent(serviceId)}/deploys`,
    body: {},
})
    .pipe(Effect.asVoid, Effect.catch((error) => ignoreNotFound && error.isNotFound
    ? Effect.void
    : Effect.fail(error)));
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
export const ServiceEnvVarProvider = () => restProvider(ServiceEnvVar, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/env-vars`,
    item: (key, p) => `/services/${encodeURIComponent(p.serviceId)}/env-vars/${encodeURIComponent(key)}`,
    listable: false,
    nukeSkip: true,
    identity: "key",
    immutable: ["serviceId", "key"],
    createMethod: "PUT",
    recoverPut: true,
    createPath: (key, p) => `/services/${encodeURIComponent(p.serviceId)}/env-vars/${encodeURIComponent(key)}`,
    updateMethod: "PUT",
    remoteDiff: false,
    existingSatisfies: (_entity, props) => props.generateValue === true && props.value === undefined,
    validate: (props) => {
        const hasValue = props.value !== undefined;
        const generatesValue = props.generateValue === true;
        return hasValue === generatesValue
            ? Effect.fail(new RenderApiError("ServiceEnvVar requires exactly one of value or generateValue: true"))
            : Effect.void;
    },
    sensitiveChanged: (_olds, news, output) => news.value === undefined
        ? !output.generated
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
            ...(p.value ? { valueDigest: digest(p.value) } : {}),
        };
    },
    finalize: (attributes, props, api, phase) => phase === "create" || phase === "update"
        ? deployServiceConfiguration(api, props.serviceId).pipe(Effect.as(attributes))
        : Effect.succeed(attributes),
    afterDelete: (_attributes, props, api) => deployServiceConfiguration(api, props.serviceId, true),
});
export const ServiceSecretFileProvider = () => restProvider(ServiceSecretFile, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/secret-files`,
    item: (name, p) => `/services/${encodeURIComponent(p.serviceId)}/secret-files/${encodeURIComponent(name)}`,
    listable: false,
    nukeSkip: true,
    identity: "key",
    immutable: ["serviceId", "name"],
    createMethod: "PUT",
    recoverPut: true,
    createPath: (name, p) => `/services/${encodeURIComponent(p.serviceId)}/secret-files/${encodeURIComponent(name)}`,
    updateMethod: "PUT",
    remoteDiff: false,
    sensitiveChanged: (_olds, news, output) => output.valueDigest !== digest(news.content),
    body: (p) => ({ content: reveal(p.content) }),
    attributes: secretAttrs,
    afterWrite: (a, p) => ({
        ...a,
        generated: false,
        valueDigest: digest(p.content),
    }),
    finalize: (attributes, props, api, phase) => phase === "create" || phase === "update"
        ? deployServiceConfiguration(api, props.serviceId).pipe(Effect.as(attributes))
        : Effect.succeed(attributes),
    afterDelete: (_attributes, props, api) => deployServiceConfiguration(api, props.serviceId, true),
});
const childAttrs = (e, f) => ({
    id: typeof e.id === "string" ? e.id : f.id,
    serviceId: f.props?.serviceId ?? f.previous?.serviceId ?? "",
    ...(typeof e.name === "string"
        ? { name: e.name }
        : typeof e.domain === "string"
            ? { name: e.domain }
            : {}),
});
export const CustomDomainProvider = () => restProvider(CustomDomain, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/custom-domains`,
    item: (id, p) => `/services/${encodeURIComponent(p.serviceId)}/custom-domains/${encodeURIComponent(id)}`,
    listable: false,
    nukeSkip: true,
    stables: ["serviceId"],
    immutable: ["serviceId", "name"],
    body: (_p, name) => ({ name }),
    updateBody: () => ({}),
    writeEntity: (value, props) => {
        if (!Array.isArray(value))
            return unwrapEntity(value);
        const match = value.find((entry) => typeof entry === "object" &&
            entry !== null &&
            !Array.isArray(entry) &&
            entry.name === props.name);
        return match ?? unwrapEntity(value);
    },
    attributes: childAttrs,
    afterWrite: (a, p) => ({ ...a, serviceId: p.serviceId }),
});
const diskConfigurationDigest = (props, attributes) => createHash("sha256")
    .update(JSON.stringify({
    name: props.name ?? attributes.name ?? attributes.id,
    mountPath: props.mountPath,
    sizeGB: props.sizeGB,
}))
    .digest("hex");
export const DiskProvider = () => restProvider(Disk, {
    collection: "/disks",
    item: (id) => `/disks/${encodeURIComponent(id)}`,
    ownerScoped: true,
    stables: ["diskId", "serviceId"],
    filter: (entity, props) => props === undefined || entity.serviceId === props.serviceId,
    immutable: ["serviceId"],
    reconcileOnNoop: true,
    sensitiveChanged: (_olds, props, output) => output.configurationDigest !== diskConfigurationDigest(props, output),
    validate: (props, observed) => {
        if (!Number.isInteger(props.sizeGB) || props.sizeGB < 1) {
            return Effect.fail(new RenderApiError("Render disk sizeGB must be a positive integer"));
        }
        if (observed?.sizeGB !== undefined &&
            props.sizeGB < observed.sizeGB) {
            return Effect.fail(new RenderApiError(`Render disks can only grow (current ${observed.sizeGB} GB, requested ${props.sizeGB} GB)`));
        }
        return Effect.void;
    },
    body: (p, name) => ({
        name,
        serviceId: p.serviceId,
        mountPath: p.mountPath,
        sizeGB: p.sizeGB,
    }),
    updateBody: (p, name) => ({
        name,
        mountPath: p.mountPath,
        sizeGB: p.sizeGB,
    }),
    attributes: (e, f) => {
        const id = typeof e.id === "string" ? e.id : f.id;
        return {
            id,
            diskId: id,
            serviceId: typeof e.serviceId === "string"
                ? e.serviceId
                : (f.props?.serviceId ?? ""),
            ...(typeof e.name === "string" ? { name: e.name } : {}),
            ...(typeof e.mountPath === "string" ? { mountPath: e.mountPath } : {}),
            ...(typeof e.sizeGB === "number" ? { sizeGB: e.sizeGB } : {}),
            ...(f.previous?.configurationDigest
                ? { configurationDigest: f.previous.configurationDigest }
                : {}),
        };
    },
    finalize: (attributes, props, api, phase) => {
        const configurationDigest = diskConfigurationDigest(props, attributes);
        const needsDeploy = phase === "create" ||
            phase === "update" ||
            (phase === "reconcile" &&
                attributes.configurationDigest !== configurationDigest);
        return needsDeploy
            ? deployServiceConfiguration(api, props.serviceId).pipe(Effect.as({ ...attributes, configurationDigest }))
            : Effect.succeed(attributes);
    },
});
export const HeaderProvider = () => restProvider(Header, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/headers`,
    item: (id, p) => `/services/${encodeURIComponent(p.serviceId)}/headers/${encodeURIComponent(id)}`,
    listable: false,
    nukeSkip: true,
    ownerScoped: false,
    stables: ["serviceId"],
    lookupByList: true,
    lookupQuery: (p) => ({
        name: [p.name],
        path: [p.path],
    }),
    remoteMismatchAction: "replace",
    immutable: ["serviceId", "name", "path", "value"],
    matches: (e, _id, p) => e.name === p.name && e.path === p.path,
    body: (p, name) => ({ name, path: p.path, value: p.value }),
    attributes: childAttrs,
    afterWrite: (a, p) => ({ ...a, serviceId: p.serviceId }),
});
const routeAttrs = (e, f) => ({
    ...childAttrs(e, f),
    source: typeof e.source === "string"
        ? e.source
        : (f.props?.source ?? f.previous?.source ?? ""),
    destination: typeof e.destination === "string"
        ? e.destination
        : (f.props?.destination ?? f.previous?.destination ?? ""),
    type: e.type === "redirect" || e.type === "rewrite"
        ? e.type
        : (f.props?.type ?? f.previous?.type ?? "rewrite"),
    ...(typeof e.priority === "number"
        ? { priority: e.priority }
        : f.previous?.priority === undefined
            ? {}
            : { priority: f.previous.priority }),
});
export const RouteProvider = () => restProvider(Route, {
    collection: (p) => `/services/${encodeURIComponent(p.serviceId)}/routes`,
    item: (id, p) => `/services/${encodeURIComponent(p.serviceId)}/routes/${encodeURIComponent(id)}`,
    listable: false,
    nukeSkip: true,
    ownerScoped: false,
    nameFilter: false,
    stables: ["serviceId"],
    lookupByList: true,
    lookupQuery: (p) => ({
        type: [p.type],
        source: [p.source],
    }),
    immutable: ["serviceId", "source", "destination", "type"],
    validate: (props) => props.priority !== undefined &&
        (!Number.isInteger(props.priority) || props.priority < 0)
        ? Effect.fail(new RenderApiError("Route priority must be a non-negative integer"))
        : Effect.void,
    replaceWhen: (_olds, props, output) => {
        // Outputs persisted before RouteAttributes tracked the immutable rule
        // fields must be refreshed from Render before deciding to replace.
        const hasIdentitySnapshot = typeof output.source === "string" &&
            typeof output.destination === "string" &&
            (output.type === "redirect" || output.type === "rewrite");
        return (hasIdentitySnapshot &&
            (output.source !== props.source ||
                output.destination !== props.destination ||
                output.type !== props.type));
    },
    resolveIdentity: (id) => Effect.succeed(id),
    matches: (e, _id, p) => e.source === p.source && e.type === p.type,
    body: (p) => ({
        source: p.source,
        destination: p.destination,
        type: p.type,
        priority: p.priority,
    }),
    updateBody: (p) => ({ priority: p.priority }),
    attributes: routeAttrs,
    afterWrite: (a, p) => ({ ...a, serviceId: p.serviceId }),
});
const normalizeAutoscalingCriteria = (criteria) => ({
    cpu: criteria.cpu ?? { enabled: false, percentage: 0 },
    memory: criteria.memory ?? { enabled: false, percentage: 0 },
});
const autoAttrs = (p) => ({
    id: p.serviceId,
    serviceId: p.serviceId,
    enabled: true,
    min: p.min,
    max: p.max,
    criteria: normalizeAutoscalingCriteria(p.criteria),
});
const validateAutoscaling = (props) => {
    if (!Number.isInteger(props.min) ||
        !Number.isInteger(props.max) ||
        props.min < 1 ||
        props.max > 100 ||
        props.min > props.max) {
        return Effect.fail(new RenderApiError("Render autoscaling requires integer bounds with 1 <= min <= max <= 100"));
    }
    for (const [name, criterion] of Object.entries(props.criteria)) {
        if (criterion !== undefined &&
            (!Number.isInteger(criterion.percentage) ||
                criterion.percentage < (criterion.enabled ? 1 : 0) ||
                criterion.percentage > 100)) {
            return Effect.fail(new RenderApiError(`Render autoscaling ${name} percentage must be an integer between ${criterion.enabled ? 1 : 0} and 100`));
        }
    }
    return Effect.void;
};
export const AutoscalingProvider = () => Provider.effect(resourceClass(Autoscaling), Effect.gen(function* () {
    const getApi = yield* RenderApi;
    const observe = (p, owned) => Effect.gen(function* () {
        const api = yield* getApi;
        const data = unwrapEntity(yield* api.request({
            method: "GET",
            path: `/services/${encodeURIComponent(p.serviceId)}`,
        }));
        const details = typeof data.serviceDetails === "object" &&
            data.serviceDetails !== null
            ? data.serviceDetails
            : {};
        if (!details.autoscaling || details.autoscaling.enabled !== true)
            return undefined;
        const value = {
            id: p.serviceId,
            serviceId: p.serviceId,
            enabled: true,
            min: details.autoscaling.min,
            max: details.autoscaling.max,
            criteria: normalizeAutoscalingCriteria(details.autoscaling.criteria ?? {}),
        };
        return owned ? value : Unowned(value);
    }).pipe(Effect.catch((e) => e.isNotFound ? Effect.succeed(undefined) : Effect.fail(e)));
    return Autoscaling.Provider.of({
        stables: ["id", "serviceId"],
        nuke: { skip: true },
        list: () => Effect.succeed([]),
        read: ({ olds, output }) => observe(olds, !!output),
        diff: Effect.fn(function* ({ olds, news, output }) {
            if (!isResolved(news))
                return undefined;
            yield* validateAutoscaling(news);
            return olds.serviceId !== news.serviceId
                ? { action: "replace" }
                : !output ||
                    output.min !== news.min ||
                    output.max !== news.max ||
                    JSON.stringify(output.criteria) !==
                        JSON.stringify(normalizeAutoscalingCriteria(news.criteria))
                    ? { action: "update" }
                    : undefined;
        }),
        reconcile: Effect.fn(function* ({ news }) {
            yield* validateAutoscaling(news);
            const api = yield* getApi;
            yield* api.request({
                method: "PUT",
                path: `/services/${encodeURIComponent(news.serviceId)}/autoscaling`,
                body: {
                    enabled: news.enabled ?? true,
                    min: news.min,
                    max: news.max,
                    criteria: normalizeAutoscalingCriteria(news.criteria),
                },
            });
            return autoAttrs(news);
        }),
        delete: Effect.fn(function* ({ output }) {
            const api = yield* getApi;
            yield* api
                .request({
                method: "DELETE",
                path: `/services/${encodeURIComponent(output.serviceId)}/autoscaling`,
            })
                .pipe(Effect.asVoid, Effect.catch((e) => e.isNotFound ? Effect.void : Effect.fail(e)));
        }),
    });
}));
//# sourceMappingURL=ServiceConfiguration.js.map