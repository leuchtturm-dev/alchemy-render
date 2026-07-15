import { createHash } from "node:crypto";
import { Unowned } from "alchemy/AdoptPolicy";
import { isResolved } from "alchemy/Diff";
import { createPhysicalName } from "alchemy/PhysicalName";
import * as Provider from "alchemy/Provider";
import type { ResourceClass, ResourceClassLike, ResourceLike } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { RenderApi, type RenderApiClient, type RenderApiError } from "./Api/Api.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue | undefined };

export interface CommonAttributes {
  readonly id: string;
  readonly name?: string;
  readonly status?: string;
  readonly ownerId?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

interface Descriptor<Props extends object, Attrs extends CommonAttributes> {
  readonly collection: string | ((props: Props) => string);
  readonly item: (identity: string, props?: Props) => string;
  readonly createMethod?: "POST" | "PUT";
  readonly createPath?: (identity: string, props: Props) => string;
  readonly updateMethod?: "PATCH" | "PUT";
  readonly deleteMethod?: "DELETE";
  readonly deletePath?: (output: Attrs, props: Props) => string;
  readonly deleteBody?: (output: Attrs, props: Props) => unknown;
  readonly ownerScoped?: boolean;
  readonly listable?: boolean;
  readonly paginated?: boolean;
  readonly nameFilter?: boolean;
  readonly stables?: readonly Extract<keyof Attrs, string>[];
  readonly filter?: (entity: Record<string, unknown>, props?: Props) => boolean;
  readonly lookupQuery?: (
    props: Props,
    identity: string,
    ownerId: string,
  ) => Readonly<Record<string, string | number | boolean | undefined>>;
  readonly list?: (api: RenderApiClient) => Effect.Effect<Attrs[], any, any>;
  /** Explicitly opt child resources without ambient enumeration out of account nuke. */
  readonly nukeSkip?: boolean;
  /** Skip remote body comparison for write-only resources; sensitiveChanged remains authoritative. */
  readonly remoteDiff?: boolean;
  readonly remoteMismatchAction?: "update" | "replace";
  readonly existingSatisfies?: (entity: Record<string, unknown>, props: Props) => boolean;
  readonly sensitiveChanged?: (olds: Props, news: Props, output: Attrs) => boolean;
  readonly replaceWhen?: (olds: Props, news: Props, output: Attrs) => boolean;
  /** Use the parent-scoped collection for cold lookup while global list remains empty. */
  readonly lookupByList?: boolean;
  readonly identity?: "name" | "key" | "id";
  readonly resolveIdentity?: (id: string, props: Props) => Effect.Effect<string, never, any>;
  readonly matches?: (entity: Record<string, unknown>, identity: string, props: Props) => boolean;
  readonly immutable?: readonly (keyof Props)[];
  readonly body: (props: Props, identity: string, ownerId: string) => unknown;
  readonly updateBody?: (props: Props, identity: string, ownerId: string) => unknown;
  readonly compareBody?: (props: Props, identity: string, ownerId: string) => unknown;
  readonly observe?: (entity: Record<string, unknown>) => unknown;
  readonly attributes?: (
    entity: Record<string, unknown>,
    fallback: { id: string; identity: string; ownerId: string; previous?: Attrs; props?: Props },
  ) => Attrs;
  readonly afterWrite?: (attrs: Attrs, props: Props) => Attrs;
  readonly finalize?: (
    attrs: Attrs,
    props: Props,
    api: RenderApiClient,
    phase: "read" | "create" | "update",
  ) => Effect.Effect<Attrs, any, any>;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const firstString = (entity: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) if (typeof entity[key] === "string") return entity[key] as string;
  return undefined;
};

export const unwrapEntity = (value: unknown): Record<string, unknown> => {
  const root = record(value);
  if (!root) return {};
  if (typeof root.id === "string" || typeof root.name === "string" || typeof root.key === "string") return root;
  for (const key of [
    "service", "postgres", "redis", "keyValue", "project", "environment", "envGroup",
    "disk", "customDomain", "header", "headers", "route", "webhook", "workflow", "registryCredential",
    "dedicatedIp", "dedicatedIP", "logStream", "metricsStream", "override", "envVar", "secretFile",
  ]) {
    const nested = record(root[key]);
    if (nested) return { ...root, ...nested };
  }
  return root;
};

export const unwrapRows = (value: unknown): Array<{ entity: Record<string, unknown>; cursor?: string }> => {
  const array = Array.isArray(value)
    ? value
    : Array.isArray(record(value)?.items)
      ? (record(value)!.items as unknown[])
      : [];
  return array.flatMap((row) => {
    const wrapper = record(row);
    if (!wrapper) return [];
    const entity = unwrapEntity(wrapper);
    const cursor = firstString(wrapper, ["cursor"]);
    return [{ entity, ...(cursor === undefined ? {} : { cursor }) }];
  });
};

const defaultAttributes = <A extends CommonAttributes>(
  entity: Record<string, unknown>,
  fallback: { id: string; identity: string; ownerId: string },
): A => {
  const id = firstString(entity, ["id", "serviceId", "resourceId", "webhookId"]) ?? fallback.id;
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
  } as A;
};

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const desiredIdentity = (props: Record<string, unknown>) =>
  typeof props.name === "string" ? props.name : typeof props.key === "string" ? props.key : undefined;

const physicalIdentity = (id: string, props: Record<string, unknown>, kind = "name") => {
  const explicit = desiredIdentity(props);
  return explicit === undefined
    ? createPhysicalName({ id, lowercase: true, maxLength: kind === "key" ? 100 : 64 })
    : Effect.succeed(explicit);
};

/** Internal factory shared by the curated public resource modules. */
export const restProvider = <R extends ResourceLike<any, any, any, any, any>>(
  resource: ResourceClass<R>,
  descriptor: Descriptor<R["Props"], R["Attributes"]>,
) =>
  Provider.effect(
    resource as unknown as ResourceClassLike<R>,
    Effect.gen(function* () {
      const getApi = yield* RenderApi;
      const attrs = descriptor.attributes ?? defaultAttributes<R["Attributes"]>;
      const makeAttrs = (entity: Record<string, unknown>, fallback: Parameters<typeof attrs>[1]) =>
        attrs(entity, fallback);
      const finalize = (
        attributes: R["Attributes"],
        props: R["Props"],
        api: RenderApiClient,
        phase: "read" | "create" | "update",
      ) =>
        descriptor.finalize?.(attributes, props, api, phase) ??
        Effect.succeed(attributes);

      const collection = (props: R["Props"]) => typeof descriptor.collection === "string" ? descriptor.collection : descriptor.collection(props);
      const canList = descriptor.listable !== false && typeof descriptor.collection === "string";
      const entityMatches = (
        entity: Record<string, unknown>,
        identity: string,
        props: R["Props"],
      ) => {
        if (descriptor.filter && !descriptor.filter(entity, props)) return false;
        if (
          ["id", "resourceId", "serviceId"].some(
            (key) => entity[key] === identity,
          )
        ) return true;
        if (descriptor.matches) return descriptor.matches(entity, identity, props);
        const keys =
          descriptor.identity === "id"
            ? ["id", "resourceId", "serviceId"]
            : descriptor.identity === "key"
              ? ["key", "name"]
              : ["name", "domain"];
        return keys.some((key) => entity[key] === identity);
      };
      const lookupEntity = (
        api: RenderApiClient,
        identity: string,
        props: R["Props"],
      ) =>
        Effect.gen(function* () {
          let cursor: string | undefined;
          for (;;) {
            const data = yield* api.request({
              method: "GET",
              path: collection(props),
              query: {
                ...(descriptor.paginated === false ? {} : { limit: 100 }),
                ...(descriptor.paginated === false || cursor === undefined
                  ? {}
                  : { cursor }),
                ...(descriptor.ownerScoped === false ? {} : { ownerId: api.ownerId }),
                ...(!descriptor.lookupByList &&
                descriptor.nameFilter !== false &&
                (descriptor.identity === "name" || descriptor.identity === undefined)
                  ? { name: identity }
                  : {}),
                ...descriptor.lookupQuery?.(props, identity, api.ownerId),
              },
            });
            const rows = unwrapRows(data);
            const found = rows.find(({ entity }) =>
              entityMatches(entity, identity, props),
            )?.entity;
            if (found) return found;
            const next = rows.at(-1)?.cursor;
            if (
              descriptor.paginated === false ||
              !next ||
              next === cursor ||
              rows.length === 0
            ) return undefined;
            cursor = next;
          }
        });
      const getEntity = (
        api: RenderApiClient,
        identity: string,
        props: R["Props"],
      ) =>
        (descriptor.lookupByList
          ? lookupEntity(api, identity, props)
          : api
              .request({
                method: "GET",
                path: descriptor.item(identity, props),
              })
              .pipe(Effect.map(unwrapEntity))
        ).pipe(
          Effect.catch((error: RenderApiError) =>
            error.isNotFound ? Effect.succeed(undefined) : Effect.fail(error),
          ),
        );

      return resource.Provider.of({
        stables: ["id", ...(descriptor.stables ?? [])] as Extract<keyof R["Attributes"], string>[],
        ...(descriptor.nukeSkip ? { nuke: { skip: true } } : {}),
        list: descriptor.list
          ? Effect.fn(function* () {
              return yield* descriptor.list!(yield* getApi);
            })
          : !canList
            ? () => Effect.succeed([])
            : Effect.fn(function* () {
              const api = yield* getApi;
              const all: R["Attributes"][] = [];
              let cursor: string | undefined;
              for (;;) {
                const data = yield* api.request({
                  method: "GET",
                  path: collection({} as R["Props"]),
                  query: {
                    ...(descriptor.paginated === false ? {} : { limit: 100 }),
                    ...(descriptor.paginated === false || cursor === undefined ? {} : { cursor }),
                    ...(descriptor.ownerScoped === false ? {} : { ownerId: api.ownerId }),
                  },
                });
                const rows = unwrapRows(data);
                for (const row of rows) {
                  if (
                    descriptor.filter &&
                    !descriptor.filter(row.entity)
                  ) continue;
                  const id = firstString(row.entity, ["id", "serviceId", "resourceId"]);
                  if (!id) continue;
                  all.push(makeAttrs(row.entity, { id, identity: firstString(row.entity, ["name", "key"]) ?? id, ownerId: api.ownerId }));
                }
                const next = rows.at(-1)?.cursor;
                if (descriptor.paginated === false || !next || next === cursor || rows.length === 0) return all;
                cursor = next;
              }
            }),
        read: Effect.fn(function* ({ id, olds, output }) {
          const api = yield* getApi;
          const identity = output?.id ?? (yield* (descriptor.resolveIdentity?.(id, olds) ?? physicalIdentity(id, olds as Record<string, unknown>, descriptor.identity)));
          if (descriptor.lookupByList) {
            const found = yield* lookupEntity(api, identity, olds);
            if (!found) return undefined;
            const remoteId = firstString(found, ["id", "resourceId"]) ?? identity;
            const foundAttrs = yield* finalize(
              makeAttrs(found, {
                id: remoteId,
                identity,
                ownerId: api.ownerId,
                props: olds,
                ...(output === undefined ? {} : { previous: output }),
              }),
              olds,
              api,
              "read",
            );
            return output ? foundAttrs : Unowned(foundAttrs);
          }
          if (output?.id) {
            return yield* api.request({ method: "GET", path: descriptor.item(identity, olds) }).pipe(
              Effect.flatMap((data) =>
                finalize(
                  makeAttrs(unwrapEntity(data), {
                    id: identity,
                    identity,
                    ownerId: api.ownerId,
                    previous: output,
                    props: olds,
                  }),
                  olds,
                  api,
                  "read",
                ),
              ),
              Effect.catch((error: RenderApiError) => error.isNotFound ? Effect.succeed(undefined) : Effect.fail(error)),
            );
          }
          if (!canList && !descriptor.lookupByList) {
            return yield* api.request({ method: "GET", path: descriptor.item(identity, olds) }).pipe(
              Effect.flatMap((data) =>
                finalize(
                  makeAttrs(unwrapEntity(data), {
                    id: identity,
                    identity,
                    ownerId: api.ownerId,
                    props: olds,
                  }),
                  olds,
                  api,
                  "read",
                ).pipe(Effect.map(Unowned)),
              ),
              Effect.catch((error: RenderApiError) => error.isNotFound ? Effect.succeed(undefined) : Effect.fail(error)),
            );
          }
          const found = yield* lookupEntity(api, identity, olds);
          if (!found) return undefined;
          const remoteId = firstString(found, ["id", "serviceId", "resourceId"]) ?? identity;
          return Unowned(
            yield* finalize(
              makeAttrs(found, {
                id: remoteId,
                identity,
                ownerId: api.ownerId,
                props: olds,
              }),
              olds,
              api,
              "read",
            ),
          );
        }),
        diff: Effect.fn(function* ({ id, olds, news, output }) {
          if (!isResolved(news)) return undefined;
          for (const key of descriptor.immutable ?? []) {
            const desired = (news as any)[key];
            const observed = output ? (output as any)[key] : undefined;
            if (
              output &&
              desired !== undefined &&
              observed !== undefined &&
              !equal(observed, desired)
            ) {
              return { action: "replace" as const };
            }
            if (
              output &&
              olds !== undefined &&
              !equal((olds as any)[key], desired)
            ) {
              return { action: "replace" as const };
            }
          }
          if (!output) return undefined;
          const resolvedNews = news as R["Props"];
          if (
            olds !== undefined &&
            descriptor.replaceWhen?.(olds, resolvedNews, output)
          ) {
            return { action: "replace" as const };
          }
          if (
            olds !== undefined &&
            descriptor.sensitiveChanged?.(olds, resolvedNews, output)
          ) {
            return { action: "update" as const };
          }
          const api = yield* getApi;
          const identity = output.id;
          const liveEntity = yield* getEntity(api, identity, resolvedNews);
          if (!liveEntity) return { action: "update" as const };
          if (descriptor.remoteDiff === false) return undefined;
          const bodyIdentity = desiredIdentity(resolvedNews as Record<string, unknown>) ?? output.name ?? (yield* physicalIdentity(id, resolvedNews as Record<string, unknown>, descriptor.identity));
          const desired = (descriptor.compareBody ?? descriptor.updateBody ?? descriptor.body)(resolvedNews, bodyIdentity, api.ownerId);
          const observed = descriptor.observe ? descriptor.observe(liveEntity) : liveEntity;
          if (!matchesDesired(observed, desired)) {
            return descriptor.remoteMismatchAction === "replace"
              ? { action: "replace" as const }
              : { action: "update" as const };
          }
          return undefined;
        }),
        reconcile: Effect.fn(function* ({ id, olds, news, output }) {
          const api = yield* getApi;
          const sensitiveNeedsWrite =
            output !== undefined &&
            olds !== undefined &&
            descriptor.sensitiveChanged?.(olds, news, output) === true;
          const identity = yield* (
            descriptor.resolveIdentity?.(id, news) ??
            physicalIdentity(
              id,
              news as Record<string, unknown>,
              descriptor.identity,
            )
          );
          let liveEntity = output
            ? yield* getEntity(api, output.id, news)
            : undefined;
          if (!liveEntity) {
            liveEntity =
              canList || descriptor.lookupByList
                ? yield* lookupEntity(api, identity, news)
                : yield* getEntity(api, identity, news);
          }
          const existingId = liveEntity
            ? firstString(liveEntity, ["id", "serviceId", "resourceId"]) ??
              output?.id ??
              identity
            : undefined;
          const bodyIdentity =
            desiredIdentity(news as Record<string, unknown>) ??
            output?.name ??
            identity;
          const body = (existingId
            ? descriptor.updateBody ?? descriptor.body
            : descriptor.body)(news, bodyIdentity, api.ownerId);
          if (
            liveEntity &&
            output === undefined &&
            descriptor.existingSatisfies?.(liveEntity, news)
          ) {
            return yield* finalize(
              makeAttrs(liveEntity, {
                id: existingId!,
                identity,
                ownerId: api.ownerId,
                props: news,
              }),
              news,
              api,
              "read",
            );
          }
          if (
            liveEntity &&
            descriptor.remoteDiff !== false &&
            !sensitiveNeedsWrite
          ) {
            const observed = descriptor.observe
              ? descriptor.observe(liveEntity)
              : liveEntity;
            const comparable = (
              descriptor.compareBody ??
              (existingId ? descriptor.updateBody : undefined) ??
              descriptor.body
            )(news, bodyIdentity, api.ownerId);
            if (matchesDesired(observed, comparable)) {
              return yield* finalize(
                makeAttrs(liveEntity, {
                  id: existingId!,
                  identity,
                  ownerId: api.ownerId,
                  props: news,
                  ...(output === undefined ? {} : { previous: output }),
                }),
                news,
                api,
                "read",
              );
            }
          }
          let writeId = existingId;
          const data = yield* api
            .request({
              method: writeId
                ? descriptor.updateMethod ?? "PATCH"
                : descriptor.createMethod ?? "POST",
              path: writeId
                ? descriptor.item(writeId, news)
                : descriptor.createPath?.(identity, news) ?? collection(news),
              body,
            })
            .pipe(
              Effect.catch((error: RenderApiError) => {
                if (writeId) return Effect.fail(error);
                const observe =
                  canList || descriptor.lookupByList
                    ? lookupEntity(api, identity, news)
                    : getEntity(api, identity, news);
                return observe.pipe(
                  Effect.flatMap((conflict) => {
                    if (!conflict) return Effect.fail(error);
                    writeId =
                      firstString(conflict, [
                        "id",
                        "serviceId",
                        "resourceId",
                      ]) ?? identity;
                    return api.request({
                      method: descriptor.updateMethod ?? "PATCH",
                      path: descriptor.item(writeId, news),
                      body: (descriptor.updateBody ?? descriptor.body)(
                        news,
                        bodyIdentity,
                        api.ownerId,
                      ),
                    });
                  }),
                );
              }),
            );
          const result = makeAttrs(unwrapEntity(data), { id: writeId ?? identity, identity, ownerId: api.ownerId, props: news, ...(output === undefined ? {} : { previous: output }) });
          return yield* finalize(
            descriptor.afterWrite ? descriptor.afterWrite(result, news) : result,
            news,
            api,
            writeId ? "update" : "create",
          );
        }),
        delete: Effect.fn(function* ({ output, olds }) {
          const api = yield* getApi;
          const body = descriptor.deleteBody?.(output, olds);
          yield* api.request({
            method: descriptor.deleteMethod ?? "DELETE",
            path: descriptor.deletePath?.(output, olds) ?? descriptor.item(output.id, olds),
            ...(body === undefined ? {} : { body }),
          }).pipe(
            Effect.asVoid,
            Effect.catch((error: RenderApiError) => error.isNotFound ? Effect.void : Effect.fail(error)),
          );
        }),
      });
    }),
  );

export const matchesDesired = (observed: unknown, desired: unknown): boolean => {
  if (desired === undefined) return true;
  if (Array.isArray(desired)) {
    return (
      Array.isArray(observed) &&
      observed.length === desired.length &&
      desired.every((value, index) => matchesDesired(observed[index], value))
    );
  }
  const o = record(observed);
  const d = record(desired);
  if (d) {
    if (!o) return false;
    return Object.entries(d).every(([key, value]) =>
      value === undefined || matchesDesired(o[key], value),
    );
  }
  return Object.is(observed, desired);
};

export const digest = (value: Redacted.Redacted<string>): string =>
  createHash("sha256").update(Redacted.value(value)).digest("hex");

export const reveal = (value: Redacted.Redacted<string>): string => Redacted.value(value);

export const invoke = <A = unknown>(
  operation: (api: RenderApiClient) => Effect.Effect<A, RenderApiError>,
): Effect.Effect<A, RenderApiError, RenderApi> =>
  Effect.gen(function* () {
    const getApi = yield* RenderApi;
    return yield* operation(yield* getApi);
  });
