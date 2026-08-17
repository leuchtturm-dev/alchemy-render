import * as Provider from "alchemy/Provider";
import type { ResourceClass, ResourceClassLike, ResourceLike } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { RenderApi, RenderApiError, type RenderApiClient } from "./Api/Api.js";
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
    readonly item: (identity: string, props: Props) => string;
    readonly createMethod?: "POST" | "PUT";
    /** Recover an indeterminate PUT create only when remote state is readable. */
    readonly recoverPut?: boolean;
    readonly createPath?: (identity: string, props: Props) => string;
    readonly updateMethod?: "PATCH" | "PUT";
    readonly ownerScoped?: boolean;
    readonly listable?: boolean;
    readonly paginated?: boolean;
    readonly nameFilter?: boolean;
    readonly stables?: readonly Extract<keyof Attrs, string>[];
    readonly filter?: (entity: Record<string, unknown>, props?: Props) => boolean;
    readonly lookupQuery?: (props: Props, identity: string, ownerId: string) => Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[] | undefined>>;
    readonly list?: (api: RenderApiClient) => Effect.Effect<Attrs[], RenderApiError>;
    readonly nukeSkip?: boolean;
    readonly remoteDiff?: boolean;
    readonly remoteMismatchAction?: "update" | "replace";
    readonly existingSatisfies?: (entity: Record<string, unknown>, props: Props) => boolean;
    readonly sensitiveChanged?: (olds: Props, news: Props, output: Attrs) => boolean;
    readonly remoteSensitiveChanged?: (news: Props, output: Attrs, api: RenderApiClient) => Effect.Effect<boolean, RenderApiError>;
    readonly validate?: (news: Props, observed: Attrs | undefined, olds?: Props) => Effect.Effect<void, RenderApiError>;
    /** Run finalize during reconcile even when the core object needs no write. */
    readonly reconcileOnNoop?: boolean;
    readonly replaceWhen?: (olds: Props, news: Props, output: Attrs) => boolean;
    readonly lookupByList?: boolean;
    readonly identity?: "name" | "key" | "id";
    readonly resolveIdentity?: (id: string, props: Props) => Effect.Effect<string>;
    readonly matches?: (entity: Record<string, unknown>, identity: string, props: Props) => boolean;
    readonly immutable?: readonly (keyof Props)[];
    readonly body: (props: Props, identity: string, ownerId: string) => unknown;
    readonly updateBody?: (props: Props, identity: string, ownerId: string, previous?: Attrs) => unknown;
    readonly compareBody?: (props: Props, identity: string, ownerId: string, previous?: Attrs) => unknown;
    readonly observe?: (entity: Record<string, unknown>) => unknown;
    readonly writeEntity?: (value: unknown, props: Props) => Record<string, unknown>;
    readonly attributes?: (entity: Record<string, unknown>, fallback: {
        id: string;
        identity: string;
        ownerId: string;
        previous?: Attrs;
        props?: Props;
    }) => Attrs;
    readonly afterWrite?: (attrs: Attrs, props: Props) => Attrs;
    readonly afterDelete?: (attrs: Attrs, props: Props, api: RenderApiClient) => Effect.Effect<void, RenderApiError>;
    readonly finalize?: (attrs: Attrs, props: Props, api: RenderApiClient, phase: "read" | "create" | "update" | "reconcile", previousProps?: Props) => Effect.Effect<Attrs, RenderApiError>;
}
export declare const unwrapEntity: (value: unknown) => Record<string, unknown>;
export declare const unwrapRows: (value: unknown) => Array<{
    entity: Record<string, unknown>;
    cursor?: string;
}>;
/**
 * Bridge Alchemy beta's `Aliases: T | undefined` ResourceClass field to the
 * exact-optional `Aliases?: T` shape accepted by Provider APIs. The runtime
 * object is returned intact so future ResourceClass fields are preserved.
 */
export declare const resourceClass: <R extends ResourceLike>(resource: ResourceClass<R>) => ResourceClassLike<R>;
export declare const restProvider: <R extends ResourceLike<string, object, CommonAttributes>>(resource: ResourceClass<R>, descriptor: Descriptor<R["Props"], R["Attributes"]>) => import("effect/Layer").Layer<Provider.Provider<R>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const matchesDesired: (observed: unknown, desired: unknown) => boolean;
export declare const digest: (value: Redacted.Redacted<string>) => string;
export declare const reveal: (value: Redacted.Redacted<string>) => string;
/** Move a Render resource between project environments without replacing it. */
export declare const moveEnvironmentResource: (api: RenderApiClient, resourceId: string, currentEnvironmentId: string | undefined, desiredEnvironmentId: string | undefined) => Effect.Effect<void, RenderApiError>;
export {};
//# sourceMappingURL=RestResource.d.ts.map