import { createHash } from "node:crypto";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import { createPhysicalName } from "alchemy/PhysicalName";
import * as Provider from "alchemy/Provider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { RenderApi, RenderApiError, } from "./Api/Api.js";
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
const firstString = (entity, keys) => {
    for (const key of keys)
        if (typeof entity[key] === "string")
            return entity[key];
    return undefined;
};
export const unwrapEntity = (value) => {
    if (Array.isArray(value)) {
        return value.length === 0 ? {} : unwrapEntity(value[0]);
    }
    const root = record(value);
    if (!root)
        return {};
    if (typeof root.id === "string" ||
        typeof root.name === "string" ||
        typeof root.key === "string")
        return root;
    for (const key of [
        "service",
        "postgres",
        "redis",
        "keyValue",
        "project",
        "environment",
        "envGroup",
        "disk",
        "customDomain",
        "header",
        "headers",
        "route",
        "webhook",
        "workflow",
        "registryCredential",
        "dedicatedIp",
        "dedicatedIP",
        "logStream",
        "metricsStream",
        "override",
        "envVar",
        "secretFile",
    ]) {
        const nested = record(root[key]);
        if (nested)
            return { ...root, ...nested };
    }
    return root;
};
export const unwrapRows = (value) => {
    const items = record(value)?.items;
    const array = Array.isArray(value)
        ? value
        : Array.isArray(items)
            ? items
            : [];
    return array.flatMap((row) => {
        const wrapper = record(row);
        if (!wrapper)
            return [];
        const entity = unwrapEntity(wrapper);
        const cursor = firstString(wrapper, ["cursor"]);
        return [{ entity, ...(cursor === undefined ? {} : { cursor }) }];
    });
};
const defaultAttributes = (entity, fallback) => {
    const id = firstString(entity, ["id", "serviceId", "resourceId", "webhookId"]) ??
        fallback.id;
    const name = firstString(entity, ["name", "key", "domain", "host"]);
    const status = firstString(entity, ["status", "state"]);
    const ownerId = firstString(entity, ["ownerId"]);
    const createdAt = firstString(entity, ["createdAt"]);
    const updatedAt = firstString(entity, ["updatedAt"]);
    return {
        id,
        ...(name === undefined ? {} : { name }),
        ...(status === undefined ? {} : { status }),
        ownerId: ownerId ?? fallback.ownerId,
        ...(createdAt === undefined ? {} : { createdAt }),
        ...(updatedAt === undefined ? {} : { updatedAt }),
    };
};
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const property = (value, key) => Reflect.get(value, key);
const desiredIdentity = (props) => typeof props.name === "string"
    ? props.name
    : typeof props.key === "string"
        ? props.key
        : undefined;
const physicalIdentity = (id, props, kind = "name") => {
    const explicit = desiredIdentity(props);
    return explicit === undefined
        ? createPhysicalName({
            id,
            lowercase: true,
            maxLength: kind === "key" ? 100 : 64,
        })
        : Effect.succeed(explicit);
};
/**
 * Bridge Alchemy beta's `Aliases: T | undefined` ResourceClass field to the
 * exact-optional `Aliases?: T` shape accepted by Provider APIs. The runtime
 * object is returned intact so future ResourceClass fields are preserved.
 */
export const resourceClass = (resource) => resource;
export const restProvider = (resource, descriptor) => Provider.effect(resourceClass(resource), Effect.gen(function* () {
    const getApi = yield* RenderApi;
    const attrs = descriptor.attributes ?? (defaultAttributes);
    const makeAttrs = (entity, fallback) => attrs(entity, fallback);
    const finalize = (attributes, props, api, phase, previousProps) => descriptor.finalize?.(attributes, props, api, phase, previousProps) ?? Effect.succeed(attributes);
    const collection = (props) => typeof descriptor.collection === "string"
        ? descriptor.collection
        : descriptor.collection(props);
    const canList = descriptor.listable !== false &&
        typeof descriptor.collection === "string";
    const entityMatches = (entity, identity, props, strictIdentity = false) => {
        if (descriptor.filter && !descriptor.filter(entity, props))
            return false;
        if (["id", "resourceId", "serviceId"].some((key) => entity[key] === identity))
            return true;
        // Once Alchemy has persisted a physical ID, never fall back to a
        // natural-key match. A same-name object is not the owned object.
        if (strictIdentity)
            return false;
        if (descriptor.matches)
            return descriptor.matches(entity, identity, props);
        const keys = descriptor.identity === "id"
            ? ["id", "resourceId", "serviceId"]
            : descriptor.identity === "key"
                ? ["key", "name"]
                : ["name", "domain"];
        return keys.some((key) => entity[key] === identity);
    };
    const lookupEntity = (api, identity, props, strictIdentity = false) => Effect.gen(function* () {
        let cursor;
        let found;
        let foundId;
        for (;;) {
            const data = yield* api.request({
                method: "GET",
                path: collection(props),
                query: {
                    ...(descriptor.paginated === false ? {} : { limit: 100 }),
                    ...(descriptor.paginated === false || cursor === undefined
                        ? {}
                        : { cursor }),
                    ...(descriptor.ownerScoped === false
                        ? {}
                        : { ownerId: [api.ownerId] }),
                    ...(!strictIdentity &&
                        !descriptor.lookupByList &&
                        descriptor.nameFilter !== false &&
                        (descriptor.identity === "name" ||
                            descriptor.identity === undefined)
                        ? { name: [identity] }
                        : {}),
                    ...(strictIdentity
                        ? {}
                        : descriptor.lookupQuery?.(props, identity, api.ownerId)),
                },
            });
            const rows = unwrapRows(data);
            for (const { entity } of rows) {
                if (!entityMatches(entity, identity, props, strictIdentity))
                    continue;
                const entityId = firstString(entity, [
                    "id",
                    "resourceId",
                    "serviceId",
                ]);
                if (found !== undefined &&
                    (entityId === undefined || entityId !== foundId)) {
                    return yield* Effect.fail(new RenderApiError("Render lookup matched multiple resources; use a unique physical name"));
                }
                found = entity;
                foundId = entityId;
            }
            const next = rows.at(-1)?.cursor;
            if (descriptor.paginated !== false &&
                !next &&
                rows.length >= 100) {
                return yield* Effect.fail(new RenderApiError("Render list response reached the requested limit without a pagination cursor"));
            }
            if (descriptor.paginated !== false &&
                next === cursor &&
                rows.length >= 100) {
                return yield* Effect.fail(new RenderApiError("Render list response reached the requested limit with a non-advancing pagination cursor"));
            }
            if (descriptor.paginated === false ||
                !next ||
                next === cursor ||
                rows.length === 0)
                return found;
            cursor = next;
        }
    });
    const getEntity = (api, identity, props) => (descriptor.lookupByList
        ? lookupEntity(api, identity, props, true)
        : api
            .request({
            method: "GET",
            path: descriptor.item(identity, props),
        })
            .pipe(Effect.map(unwrapEntity))).pipe(Effect.catch((error) => error.isNotFound ? Effect.succeed(undefined) : Effect.fail(error)));
    return resource.Provider.of({
        stables: ["id", ...(descriptor.stables ?? [])],
        ...(descriptor.nukeSkip ? { nuke: { skip: true } } : {}),
        list: descriptor.list
            ? Effect.fn(function* () {
                return yield* descriptor.list(yield* getApi);
            })
            : !canList
                ? () => Effect.succeed([])
                : Effect.fn(function* () {
                    const api = yield* getApi;
                    const all = [];
                    let cursor;
                    for (;;) {
                        const data = yield* api.request({
                            method: "GET",
                            path: collection({}),
                            query: {
                                ...(descriptor.paginated === false ? {} : { limit: 100 }),
                                ...(descriptor.paginated === false || cursor === undefined
                                    ? {}
                                    : { cursor }),
                                ...(descriptor.ownerScoped === false
                                    ? {}
                                    : { ownerId: [api.ownerId] }),
                            },
                        });
                        const rows = unwrapRows(data);
                        for (const row of rows) {
                            if (descriptor.filter && !descriptor.filter(row.entity))
                                continue;
                            const id = firstString(row.entity, [
                                "id",
                                "serviceId",
                                "resourceId",
                            ]);
                            if (!id)
                                continue;
                            all.push(makeAttrs(row.entity, {
                                id,
                                identity: firstString(row.entity, ["name", "key"]) ?? id,
                                ownerId: api.ownerId,
                            }));
                        }
                        const next = rows.at(-1)?.cursor;
                        if (descriptor.paginated !== false &&
                            !next &&
                            rows.length >= 100) {
                            return yield* Effect.fail(new RenderApiError("Render list response reached the requested limit without a pagination cursor"));
                        }
                        if (descriptor.paginated !== false &&
                            next === cursor &&
                            rows.length >= 100) {
                            return yield* Effect.fail(new RenderApiError("Render list response reached the requested limit with a non-advancing pagination cursor"));
                        }
                        if (descriptor.paginated === false ||
                            !next ||
                            next === cursor ||
                            rows.length === 0)
                            return all;
                        cursor = next;
                    }
                }),
        read: Effect.fn(function* ({ id, olds, output }) {
            const api = yield* getApi;
            const props = olds;
            const identity = output?.id ??
                (yield* descriptor.resolveIdentity?.(id, props) ??
                    physicalIdentity(id, props, descriptor.identity));
            if (descriptor.lookupByList) {
                const found = yield* lookupEntity(api, identity, props, output !== undefined);
                if (!found)
                    return undefined;
                const remoteId = firstString(found, ["id", "resourceId"]) ?? identity;
                const foundAttrs = yield* finalize(makeAttrs(found, {
                    id: remoteId,
                    identity,
                    ownerId: api.ownerId,
                    props,
                    ...(output === undefined ? {} : { previous: output }),
                }), props, api, "read");
                return output ? foundAttrs : Unowned(foundAttrs);
            }
            if (output?.id) {
                return yield* api
                    .request({
                    method: "GET",
                    path: descriptor.item(identity, props),
                })
                    .pipe(Effect.flatMap((data) => finalize(makeAttrs(unwrapEntity(data), {
                    id: identity,
                    identity,
                    ownerId: api.ownerId,
                    previous: output,
                    props,
                }), props, api, "read")), Effect.catch((error) => error.isNotFound
                    ? Effect.succeed(undefined)
                    : Effect.fail(error)));
            }
            if (!canList) {
                return yield* api
                    .request({
                    method: "GET",
                    path: descriptor.item(identity, props),
                })
                    .pipe(Effect.flatMap((data) => finalize(makeAttrs(unwrapEntity(data), {
                    id: identity,
                    identity,
                    ownerId: api.ownerId,
                    props,
                }), props, api, "read").pipe(Effect.map(Unowned))), Effect.catch((error) => error.isNotFound
                    ? Effect.succeed(undefined)
                    : Effect.fail(error)));
            }
            const found = yield* lookupEntity(api, identity, props);
            if (!found)
                return undefined;
            const remoteId = firstString(found, ["id", "serviceId", "resourceId"]) ?? identity;
            return Unowned(yield* finalize(makeAttrs(found, {
                id: remoteId,
                identity,
                ownerId: api.ownerId,
                props,
            }), props, api, "read"));
        }),
        diff: Effect.fn(function* ({ id, olds, news, output }) {
            if (!isResolved(news))
                return undefined;
            const resolvedNews = news;
            const resolvedOlds = olds === undefined ? undefined : olds;
            for (const key of descriptor.immutable ?? []) {
                const desired = property(resolvedNews, key);
                const observed = output ? property(output, key) : undefined;
                if (output &&
                    desired !== undefined &&
                    observed !== undefined &&
                    !equal(observed, desired)) {
                    return { action: "replace" };
                }
                if (output &&
                    resolvedOlds !== undefined &&
                    !equal(property(resolvedOlds, key), desired)) {
                    return { action: "replace" };
                }
            }
            if (!output)
                return undefined;
            yield* descriptor.validate?.(resolvedNews, output, resolvedOlds) ?? Effect.void;
            if (descriptor.replaceWhen?.(resolvedOlds ?? resolvedNews, resolvedNews, output)) {
                return { action: "replace" };
            }
            if (descriptor.sensitiveChanged?.(resolvedOlds ?? resolvedNews, resolvedNews, output)) {
                return { action: "update" };
            }
            const api = yield* getApi;
            const identity = output.id;
            const liveEntity = yield* getEntity(api, identity, resolvedNews);
            if (!liveEntity)
                return { action: "update" };
            const liveAttributes = makeAttrs(liveEntity, {
                id: output.id,
                identity,
                ownerId: api.ownerId,
                previous: output,
                props: resolvedNews,
            });
            yield* descriptor.validate?.(resolvedNews, liveAttributes, resolvedOlds) ?? Effect.void;
            if (descriptor.replaceWhen?.(resolvedOlds ?? resolvedNews, resolvedNews, liveAttributes)) {
                return { action: "replace" };
            }
            if (descriptor.sensitiveChanged?.(resolvedOlds ?? resolvedNews, resolvedNews, liveAttributes)) {
                return { action: "update" };
            }
            if (descriptor.remoteSensitiveChanged &&
                (yield* descriptor.remoteSensitiveChanged(resolvedNews, liveAttributes, api))) {
                return { action: "update" };
            }
            if (descriptor.remoteDiff === false)
                return undefined;
            const bodyIdentity = desiredIdentity(resolvedNews) ??
                output.name ??
                (yield* descriptor.resolveIdentity?.(id, resolvedNews) ??
                    physicalIdentity(id, resolvedNews, descriptor.identity));
            const desired = (descriptor.compareBody ??
                descriptor.updateBody ??
                descriptor.body)(resolvedNews, bodyIdentity, api.ownerId, liveAttributes);
            const observed = descriptor.observe
                ? descriptor.observe(liveEntity)
                : liveEntity;
            if (!matchesDesired(observed, desired)) {
                return descriptor.remoteMismatchAction === "replace"
                    ? { action: "replace" }
                    : { action: "update" };
            }
            return undefined;
        }),
        reconcile: Effect.fn(function* ({ id, olds, news, output }) {
            const api = yield* getApi;
            const props = news;
            const previousProps = olds === undefined ? undefined : olds;
            let sensitiveNeedsWrite = output !== undefined &&
                descriptor.sensitiveChanged?.(previousProps ?? props, props, output) === true;
            const identity = yield* descriptor.resolveIdentity?.(id, props) ??
                physicalIdentity(id, props, descriptor.identity);
            // Cold name lookup belongs to read/adoption. Reconcile may only
            // mutate a persisted physical ID; if it disappeared, create and let
            // any natural-key conflict fail instead of taking over a stranger.
            const liveEntity = output
                ? yield* getEntity(api, output.id, props)
                : undefined;
            const existingId = liveEntity
                ? (firstString(liveEntity, ["id", "serviceId", "resourceId"]) ??
                    output?.id ??
                    identity)
                : undefined;
            const observedAttributes = liveEntity
                ? makeAttrs(liveEntity, {
                    id: existingId ?? identity,
                    identity,
                    ownerId: api.ownerId,
                    props,
                    ...(output === undefined ? {} : { previous: output }),
                })
                : output;
            yield* descriptor.validate?.(props, observedAttributes, previousProps) ?? Effect.void;
            if (observedAttributes !== undefined &&
                descriptor.sensitiveChanged?.(previousProps ?? props, props, observedAttributes)) {
                sensitiveNeedsWrite = true;
            }
            const bodyIdentity = desiredIdentity(props) ??
                output?.name ??
                identity;
            const body = (existingId
                ? (descriptor.updateBody ?? descriptor.body)
                : descriptor.body)(props, bodyIdentity, api.ownerId, observedAttributes);
            if (liveEntity &&
                !sensitiveNeedsWrite &&
                descriptor.existingSatisfies?.(liveEntity, props)) {
                return yield* finalize(observedAttributes, props, api, descriptor.reconcileOnNoop && sensitiveNeedsWrite
                    ? "reconcile"
                    : "read", previousProps);
            }
            if (liveEntity &&
                descriptor.remoteDiff === false &&
                !sensitiveNeedsWrite) {
                return yield* finalize(observedAttributes, props, api, "read", previousProps);
            }
            if (liveEntity &&
                descriptor.remoteDiff !== false &&
                (!sensitiveNeedsWrite || descriptor.reconcileOnNoop)) {
                const observed = descriptor.observe
                    ? descriptor.observe(liveEntity)
                    : liveEntity;
                const comparable = (descriptor.compareBody ??
                    (existingId ? descriptor.updateBody : undefined) ??
                    descriptor.body)(props, bodyIdentity, api.ownerId, observedAttributes);
                if (matchesDesired(observed, comparable)) {
                    return yield* finalize(observedAttributes, props, api, descriptor.reconcileOnNoop &&
                        (output !== undefined || sensitiveNeedsWrite)
                        ? "reconcile"
                        : "read", previousProps);
                }
            }
            const writeId = existingId;
            // Render does not expose idempotency keys for POST creates. Surface
            // an indeterminate result rather than claiming whichever same-name
            // object appears afterward. A PUT create can be recovered only when
            // a strict read of that same address proves the desired state.
            const data = yield* api
                .request({
                method: writeId
                    ? (descriptor.updateMethod ?? "PATCH")
                    : (descriptor.createMethod ?? "POST"),
                path: writeId
                    ? descriptor.item(writeId, props)
                    : (descriptor.createPath?.(identity, props) ??
                        collection(props)),
                body,
            })
                .pipe(Effect.catch((error) => {
                if (writeId !== undefined ||
                    descriptor.createMethod !== "PUT" ||
                    descriptor.recoverPut !== true ||
                    (error.status !== undefined && error.status < 500)) {
                    return Effect.fail(error);
                }
                return getEntity(api, identity, props).pipe(Effect.flatMap((recovered) => {
                    if (recovered === undefined ||
                        descriptor.existingSatisfies?.(recovered, props)) {
                        return Effect.fail(error);
                    }
                    const recoveredAttributes = makeAttrs(recovered, {
                        id: identity,
                        identity,
                        ownerId: api.ownerId,
                        props,
                        ...(observedAttributes === undefined
                            ? {}
                            : { previous: observedAttributes }),
                    });
                    const sensitiveMatches = descriptor.sensitiveChanged !== undefined &&
                        !descriptor.sensitiveChanged(previousProps ?? props, props, recoveredAttributes);
                    const observed = descriptor.observe
                        ? descriptor.observe(recovered)
                        : recovered;
                    const comparable = (descriptor.compareBody ??
                        descriptor.updateBody ??
                        descriptor.body)(props, bodyIdentity, api.ownerId, recoveredAttributes);
                    const verified = descriptor.remoteDiff === false
                        ? sensitiveMatches
                        : matchesDesired(observed, comparable);
                    return verified
                        ? Effect.succeed(recovered)
                        : Effect.fail(error);
                }));
            }));
            const result = makeAttrs(descriptor.writeEntity?.(data, props) ?? unwrapEntity(data), {
                id: writeId ?? identity,
                identity,
                ownerId: api.ownerId,
                props,
                ...(observedAttributes === undefined
                    ? {}
                    : { previous: observedAttributes }),
            });
            return yield* finalize(descriptor.afterWrite
                ? descriptor.afterWrite(result, props)
                : result, props, api, writeId ? "update" : "create", previousProps);
        }),
        delete: Effect.fn(function* ({ output, olds }) {
            const api = yield* getApi;
            const props = olds;
            yield* api
                .request({
                method: "DELETE",
                path: descriptor.item(output.id, props),
            })
                .pipe(Effect.asVoid, Effect.catch((error) => error.isNotFound ? Effect.void : Effect.fail(error)));
            yield* descriptor.afterDelete?.(output, props, api) ?? Effect.void;
        }),
    });
}));
export const matchesDesired = (observed, desired) => {
    if (desired === undefined)
        return true;
    if (Array.isArray(desired)) {
        return (Array.isArray(observed) &&
            observed.length === desired.length &&
            desired.every((value, index) => matchesDesired(observed[index], value)));
    }
    const o = record(observed);
    const d = record(desired);
    if (d) {
        if (!o)
            return false;
        return Object.entries(d).every(([key, value]) => value === undefined || matchesDesired(o[key], value));
    }
    return Object.is(observed, desired);
};
export const digest = (value) => createHash("sha256").update(Redacted.value(value)).digest("hex");
export const reveal = (value) => Redacted.value(value);
/** Move a Render resource between project environments without replacing it. */
export const moveEnvironmentResource = (api, resourceId, currentEnvironmentId, desiredEnvironmentId) => currentEnvironmentId === desiredEnvironmentId
    ? Effect.void
    : Effect.gen(function* () {
        // Validate the destination before detaching from the current
        // environment. The membership API has no atomic move operation.
        if (desiredEnvironmentId !== undefined) {
            yield* api.request({
                method: "GET",
                path: `/environments/${encodeURIComponent(desiredEnvironmentId)}`,
            });
        }
        if (currentEnvironmentId !== undefined) {
            yield* api
                .request({
                method: "DELETE",
                path: `/environments/${encodeURIComponent(currentEnvironmentId)}/resources`,
                query: { resourceIds: [resourceId] },
            })
                .pipe(Effect.asVoid, Effect.catch((error) => error.isNotFound ? Effect.void : Effect.fail(error)));
        }
        if (desiredEnvironmentId !== undefined) {
            yield* api.request({
                method: "POST",
                path: `/environments/${encodeURIComponent(desiredEnvironmentId)}/resources`,
                body: { resourceIds: [resourceId] },
            });
        }
    });
//# sourceMappingURL=RestResource.js.map