import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import createClient, { type Client } from "openapi-fetch";
import { Credentials } from "../Credentials.js";
import { USER_AGENT } from "../Config.js";
import type { paths } from "./schema.js";

export interface RenderRequest {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<
    Record<
      string,
      | string
      | number
      | boolean
      | readonly (string | number | boolean)[]
      | undefined
    >
  >;
  readonly body?: unknown;
}

export interface RenderApiClient {
  /** The authenticated, generated OpenAPI client. */
  readonly client: Client<paths>;
  /** Authenticated transport used by resources and actions. */
  readonly request: <A = unknown>(
    input: RenderRequest,
  ) => Effect.Effect<A, RenderApiError>;
  /** Default workspace/owner for owner-scoped resources. */
  readonly ownerId: string;
  /** Exact API root, including `/v1`. */
  readonly apiBaseUrl: string;
}

/**
 * A lazy authenticated Render API client. The service value is itself an
 * Effect so credentials are not resolved while a stack module is imported.
 */
export class RenderApi extends Context.Service<
  RenderApi,
  Effect.Effect<RenderApiClient, RenderApiError>
>()("Render.Api") {}

export interface RenderApiLayerOptions {
  /** Override fetch for tests, recording, or a custom proxy. */
  readonly fetch?: typeof globalThis.fetch;
  /** Disable the Terraform-compatible 400 requests/minute client throttle. */
  readonly disableRateLimit?: boolean;
}

export class RenderApiError extends Error {
  readonly _tag = "RenderApiError";

  constructor(
    message: string,
    readonly details: {
      readonly status?: number;
      readonly requestId?: string;
    } = {},
  ) {
    super(message);
    this.name = "RenderApiError";
  }

  get status(): number | undefined {
    return this.details.status;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** Build the lazy API service from the active Render credentials service. */
export const layer = (options: RenderApiLayerOptions = {}) =>
  Layer.effect(
    RenderApi,
    Effect.gen(function* () {
      const credentials = yield* Credentials;
      return yield* credentials.pipe(
        Effect.map(({ apiKey, ownerId, apiBaseUrl }) => {
          const fetchImpl = createRenderFetch({
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
            ...(options.disableRateLimit === undefined
              ? {}
              : { disableRateLimit: options.disableRateLimit }),
          });
          const baseUrl = normalizeBaseUrl(apiBaseUrl);
          const headers = {
            Authorization: `Bearer ${Redacted.value(apiKey)}`,
            Accept: "application/json",
            "User-Agent": USER_AGENT,
          };
          const request = <A = unknown>(
            input: RenderRequest,
          ): Effect.Effect<A, RenderApiError> => {
            const url = new URL(
              `${baseUrl}${input.path.startsWith("/") ? input.path : `/${input.path}`}`,
            );
            for (const [key, value] of Object.entries(input.query ?? {})) {
              if (Array.isArray(value)) {
                for (const item of value) {
                  url.searchParams.append(key, String(item));
                }
              } else if (value !== undefined) {
                url.searchParams.set(key, String(value));
              }
            }
            return Effect.tryPromise({
              try: async () => {
                const response = await fetchImpl(url, {
                  method: input.method,
                  headers: {
                    ...headers,
                    ...(input.body === undefined
                      ? {}
                      : { "Content-Type": "application/json" }),
                  },
                  ...(input.body === undefined
                    ? {}
                    : { body: JSON.stringify(input.body) }),
                });
                if (!response.ok) {
                  const requestId = safeRequestId(
                    response.headers.get("x-render-request-id"),
                  );
                  await response.body?.cancel().catch(() => undefined);
                  throw new RenderApiError(safeErrorMessage(response.status), {
                    status: response.status,
                    ...(requestId === undefined ? {} : { requestId }),
                  });
                }
                const text =
                  response.status === 204 ? "" : await response.text();
                try {
                  return (
                    text.length === 0 ? undefined : JSON.parse(text)
                  ) as A;
                } catch {
                  return text as A;
                }
              },
              catch: (cause) =>
                cause instanceof RenderApiError
                  ? cause
                  : new RenderApiError("Render API request failed"),
            });
          };
          return {
            client: createClient<paths>({ baseUrl, fetch: fetchImpl, headers }),
            request,
            ownerId,
            apiBaseUrl: baseUrl,
          } satisfies RenderApiClient;
        }),
        Effect.cached,
      );
    }),
  );

/**
 * Convert an openapi-fetch response into a typed Effect. Only status and
 * request ID are retained; response bodies and server-controlled status text are
 * deliberately discarded because they can echo write-only request values.
 */
export const call = <A>(
  request: () => Promise<{
    readonly data?: A;
    readonly error?: unknown;
    readonly response: Response;
  }>,
): Effect.Effect<A, RenderApiError> =>
  Effect.tryPromise({
    try: request,
    catch: (cause) =>
      cause instanceof RenderApiError
        ? cause
        : new RenderApiError("Render API request failed"),
  }).pipe(
    Effect.flatMap(({ data, response }) => {
      if (response.ok) return Effect.succeed(data as A);
      const requestId = safeRequestId(
        response.headers.get("x-render-request-id") ??
          response.headers.get("x-request-id"),
      );
      return Effect.fail(
        new RenderApiError(safeErrorMessage(response.status), {
          status: response.status,
          ...(requestId === undefined ? {} : { requestId }),
        }),
      );
    }),
  );

/** Turn a 404 into `undefined` while preserving every other API failure. */
export const optional = <A>(
  effect: Effect.Effect<A, RenderApiError>,
): Effect.Effect<A | undefined, RenderApiError> =>
  effect.pipe(
    Effect.catch((error) =>
      error.isNotFound ? Effect.succeed(undefined) : Effect.fail(error),
    ),
  );

/** Turn a 404 delete into success. */
export const ignoreNotFound = (
  effect: Effect.Effect<unknown, RenderApiError>,
): Effect.Effect<void, RenderApiError> =>
  effect.pipe(
    Effect.asVoid,
    Effect.catch((error) =>
      error.isNotFound ? Effect.void : Effect.fail(error),
    ),
  );

export interface PaginateOptions<Row> {
  readonly cursor: (row: Row) => string | undefined;
  readonly maxItems?: number;
}

/** Exhaust a Render cursor-paginated list without looping on a stale cursor. */
export const paginate = <Row>(
  page: (
    cursor: string | undefined,
  ) => Effect.Effect<readonly Row[], RenderApiError>,
  options: PaginateOptions<Row>,
): Effect.Effect<Row[], RenderApiError> =>
  Effect.gen(function* () {
    const rows: Row[] = [];
    let cursor: string | undefined;
    for (;;) {
      const next = yield* page(cursor);
      if (next.length === 0) return rows;
      rows.push(...next);
      if (options.maxItems !== undefined && rows.length >= options.maxItems) {
        return rows.slice(0, options.maxItems);
      }
      const nextCursor = options.cursor(next[next.length - 1]!);
      if (!nextCursor || nextCursor === cursor) return rows;
      cursor = nextCursor;
    }
  });

export interface PollOptions<A> {
  readonly timeoutMs: number;
  readonly initialDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly while: (value: A) => boolean;
}

/** Poll with the same bounded 1.2x backoff shape as Render's Terraform provider. */
export const poll = <A, E>(
  read: Effect.Effect<A, E>,
  options: PollOptions<A>,
): Effect.Effect<A, E | RenderApiError> =>
  Effect.gen(function* () {
    const started = Date.now();
    let delay = options.initialDelayMs ?? 3_000;
    const maximum = options.maximumDelayMs ?? 15_000;
    for (;;) {
      const value = yield* read;
      if (!options.while(value)) return value;
      if (Date.now() - started >= options.timeoutMs) {
        return yield* Effect.fail(
          new RenderApiError(
            `Render operation timed out after ${options.timeoutMs}ms`,
          ),
        );
      }
      yield* Effect.sleep(`${delay} millis`);
      delay = Math.min(maximum, Math.ceil(delay * 1.2));
    }
  });

export interface RenderFetchOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly disableRateLimit?: boolean;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}

/**
 * Render-aware fetch wrapper: one request every 150ms (400/minute), honors
 * Retry-After, and bounds retries. Unsafe POST/PATCH requests are never
 * replayed automatically, including after transport, 429, or 5xx failures.
 */
export const createRenderFetch = (
  options: RenderFetchOptions = {},
): typeof globalThis.fetch => {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  let gate: Promise<void> = Promise.resolve();
  let nextRequestAt = 0;

  const pause = (milliseconds: number, signal: AbortSignal) => {
    if (signal.aborted) {
      return Promise.reject(signal.reason ?? new Error("Request aborted"));
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () =>
        reject(signal.reason ?? new Error("Request aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve()
        .then(() => sleep(milliseconds))
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", onAbort));
    });
  };

  const throttle = (signal: AbortSignal) => {
    if (options.disableRateLimit) return Promise.resolve();
    const queued = gate.then(async () => {
      const current = now();
      const wait = Math.max(0, nextRequestAt - current);
      if (wait > 0) await pause(wait, signal);
      nextRequestAt = Math.max(nextRequestAt, now()) + 150;
    });
    gate = queued.catch(() => undefined);
    return queued;
  };

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const original = new Request(input, init);
    const safeMethod = ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"].includes(
      original.method.toUpperCase(),
    );
    const backoffSeconds = [1, 5, 10, 20, 40, 60, 120];

    for (let attempt = 0; ; attempt++) {
      await throttle(original.signal);
      let response: Response;
      try {
        response = await fetchImpl(original.clone());
      } catch (error) {
        if (!safeMethod || attempt >= 2 || original.signal.aborted) throw error;
        await pause(backoffSeconds[attempt]! * 1_000, original.signal);
        continue;
      }

      const retryableStatus =
        safeMethod &&
        (response.status === 429 || [502, 503, 504].includes(response.status));
      if (!retryableStatus || attempt >= backoffSeconds.length) return response;

      const retryAfter = parseRetryAfter(
        response.headers.get("retry-after"),
        now(),
      );
      await response.body?.cancel().catch(() => undefined);
      await pause(
        retryAfter ?? backoffSeconds[attempt]! * 1_000,
        original.signal,
      );
    }
  }) as typeof globalThis.fetch;
};

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

const parseRetryAfter = (
  value: string | null,
  now: number,
): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1_000, 120_000);
  const date = Date.parse(value);
  return Number.isNaN(date)
    ? undefined
    : Math.min(Math.max(0, date - now), 120_000);
};

const safeRequestId = (value: string | null): string | undefined =>
  value !== null && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : undefined;

const safeErrorMessage = (status: number): string =>
  `Render API returned ${status}`;
