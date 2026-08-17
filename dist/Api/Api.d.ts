import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { type Client } from "openapi-fetch";
import { Credentials } from "../Credentials.js";
import type { paths } from "./schema.js";
export interface RenderRequest {
    readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    readonly path: string;
    readonly query?: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[] | undefined>>;
    readonly body?: unknown;
}
export interface RenderApiClient {
    /** The authenticated, generated OpenAPI client. */
    readonly client: Client<paths>;
    /** Authenticated transport used by resources and actions. */
    readonly request: <A = unknown>(input: RenderRequest) => Effect.Effect<A, RenderApiError>;
    /** Default workspace/owner for owner-scoped resources. */
    readonly ownerId: string;
    /** Exact API root, including `/v1`. */
    readonly apiBaseUrl: string;
}
declare const RenderApi_base: Context.ServiceClass<RenderApi, "Render.Api", Effect.Effect<RenderApiClient, RenderApiError, never>>;
/**
 * A lazy authenticated Render API client. The service value is itself an
 * Effect so credentials are not resolved while a stack module is imported.
 */
export declare class RenderApi extends RenderApi_base {
    /** Type-level marker that allows this provider service to flow into Stack. */
    readonly kind: "Credentials";
}
export interface RenderApiLayerOptions {
    /** Override fetch for tests, recording, or a custom proxy. */
    readonly fetch?: typeof globalThis.fetch;
    /** Disable the baseline 400 requests/minute client throttle. */
    readonly disableRateLimit?: boolean;
}
export declare class RenderApiError extends Error {
    readonly details: {
        readonly status?: number;
        readonly requestId?: string;
    };
    readonly _tag = "RenderApiError";
    constructor(message: string, details?: {
        readonly status?: number;
        readonly requestId?: string;
    });
    get status(): number | undefined;
    get isNotFound(): boolean;
}
/** Build the lazy API service from the active Render credentials service. */
export declare const layer: (options?: RenderApiLayerOptions) => Layer.Layer<RenderApi, never, Credentials>;
/**
 * Convert an openapi-fetch response into a typed Effect. Only status and
 * request ID are retained; response bodies and server-controlled status text are
 * deliberately discarded because they can echo write-only request values.
 */
export declare const call: <A>(request: () => Promise<{
    readonly data?: A;
    readonly error?: unknown;
    readonly response: Response;
}>) => Effect.Effect<A, RenderApiError>;
/** Turn a 404 into `undefined` while preserving every other API failure. */
export declare const optional: <A>(effect: Effect.Effect<A, RenderApiError>) => Effect.Effect<A | undefined, RenderApiError>;
/** Turn a 404 delete into success. */
export declare const ignoreNotFound: (effect: Effect.Effect<unknown, RenderApiError>) => Effect.Effect<void, RenderApiError>;
export interface PaginateOptions<Row> {
    readonly cursor: (row: Row) => string | undefined;
    /** Fail closed when a full page has no cursor. */
    readonly pageSize?: number;
    readonly maxItems?: number;
}
/** Exhaust a Render cursor-paginated list without looping on a stale cursor. */
export declare const paginate: <Row>(page: (cursor: string | undefined) => Effect.Effect<readonly Row[], RenderApiError>, options: PaginateOptions<Row>) => Effect.Effect<Row[], RenderApiError>;
export interface PollOptions<A> {
    readonly timeoutMs: number;
    readonly initialDelayMs?: number;
    readonly maximumDelayMs?: number;
    readonly while: (value: A) => boolean;
}
/** Poll with the same bounded 1.2x backoff shape as Render's Terraform provider. */
export declare const poll: <A, E>(read: Effect.Effect<A, E>, options: PollOptions<A>) => Effect.Effect<A, E | RenderApiError>;
export interface RenderFetchOptions {
    readonly fetch?: typeof globalThis.fetch;
    readonly disableRateLimit?: boolean;
    readonly sleep?: (milliseconds: number) => Promise<void>;
    readonly now?: () => number;
}
/**
 * Render-aware fetch wrapper: one request every 150ms (400/minute), honors
 * rate-limit reset headers, and bounds retries. A 429 explicitly rejects the
 * request and is retried for every method as Render recommends. Unsafe
 * POST/PATCH requests and generated-secret PUTs are not replayed after
 * transport or 5xx failures.
 */
export declare const createRenderFetch: (options?: RenderFetchOptions) => typeof globalThis.fetch;
export {};
//# sourceMappingURL=Api.d.ts.map