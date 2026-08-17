import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import createClient, {} from "openapi-fetch";
import { Credentials } from "../Credentials.js";
import { USER_AGENT } from "../Config.js";
/**
 * A lazy authenticated Render API client. The service value is itself an
 * Effect so credentials are not resolved while a stack module is imported.
 */
export class RenderApi extends Context.Service()("Render.Api") {
}
export class RenderApiError extends Error {
    details;
    _tag = "RenderApiError";
    constructor(message, details = {}) {
        super(message);
        this.details = details;
        this.name = "RenderApiError";
    }
    get status() {
        return this.details.status;
    }
    get isNotFound() {
        return this.status === 404;
    }
}
/** Build the lazy API service from the active Render credentials service. */
export const layer = (options = {}) => Layer.effect(RenderApi, Effect.gen(function* () {
    const credentials = yield* Credentials;
    return yield* credentials.pipe(Effect.map(({ apiKey, ownerId, apiBaseUrl }) => {
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
        const request = (input) => {
            const url = new URL(`${baseUrl}${input.path.startsWith("/") ? input.path : `/${input.path}`}`);
            for (const [key, value] of Object.entries(input.query ?? {})) {
                if (Array.isArray(value)) {
                    for (const item of value) {
                        url.searchParams.append(key, String(item));
                    }
                }
                else if (value !== undefined) {
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
                        const requestId = safeRequestId(response.headers.get("x-render-request-id"));
                        await response.body?.cancel().catch(() => undefined);
                        throw new RenderApiError(safeErrorMessage(response.status), {
                            status: response.status,
                            ...(requestId === undefined ? {} : { requestId }),
                        });
                    }
                    const text = response.status === 204 ? "" : await response.text();
                    try {
                        return (text.length === 0 ? undefined : JSON.parse(text));
                    }
                    catch {
                        return text;
                    }
                },
                catch: (cause) => cause instanceof RenderApiError
                    ? cause
                    : new RenderApiError("Render API request failed"),
            });
        };
        return {
            client: createClient({ baseUrl, fetch: fetchImpl, headers }),
            request,
            ownerId,
            apiBaseUrl: baseUrl,
        };
    }), Effect.cached);
}));
/**
 * Convert an openapi-fetch response into a typed Effect. Only status and
 * request ID are retained; response bodies and server-controlled status text are
 * deliberately discarded because they can echo write-only request values.
 */
export const call = (request) => Effect.tryPromise({
    try: request,
    catch: (cause) => cause instanceof RenderApiError
        ? cause
        : new RenderApiError("Render API request failed"),
}).pipe(Effect.flatMap(({ data, response }) => {
    if (response.ok)
        return Effect.succeed(data);
    const requestId = safeRequestId(response.headers.get("x-render-request-id") ??
        response.headers.get("x-request-id"));
    return Effect.fail(new RenderApiError(safeErrorMessage(response.status), {
        status: response.status,
        ...(requestId === undefined ? {} : { requestId }),
    }));
}));
/** Turn a 404 into `undefined` while preserving every other API failure. */
export const optional = (effect) => effect.pipe(Effect.catch((error) => error.isNotFound ? Effect.succeed(undefined) : Effect.fail(error)));
/** Turn a 404 delete into success. */
export const ignoreNotFound = (effect) => effect.pipe(Effect.asVoid, Effect.catch((error) => error.isNotFound ? Effect.void : Effect.fail(error)));
/** Exhaust a Render cursor-paginated list without looping on a stale cursor. */
export const paginate = (page, options) => Effect.gen(function* () {
    const rows = [];
    let cursor;
    for (;;) {
        const next = yield* page(cursor);
        if (next.length === 0)
            return rows;
        rows.push(...next);
        if (options.maxItems !== undefined && rows.length >= options.maxItems) {
            return rows.slice(0, options.maxItems);
        }
        const nextCursor = options.cursor(next[next.length - 1]);
        if (!nextCursor) {
            if (options.pageSize !== undefined &&
                next.length >= options.pageSize) {
                return yield* Effect.fail(new RenderApiError("Render list response reached the requested limit without a pagination cursor"));
            }
            return rows;
        }
        if (nextCursor === cursor) {
            if (options.pageSize !== undefined &&
                next.length >= options.pageSize) {
                return yield* Effect.fail(new RenderApiError("Render list response reached the requested limit with a non-advancing pagination cursor"));
            }
            return rows;
        }
        cursor = nextCursor;
    }
});
/** Poll with the same bounded 1.2x backoff shape as Render's Terraform provider. */
export const poll = (read, options) => Effect.gen(function* () {
    const started = Date.now();
    let delay = options.initialDelayMs ?? 3_000;
    const maximum = options.maximumDelayMs ?? 15_000;
    for (;;) {
        const value = yield* read;
        if (!options.while(value))
            return value;
        if (Date.now() - started >= options.timeoutMs) {
            return yield* Effect.fail(new RenderApiError(`Render operation timed out after ${options.timeoutMs}ms`));
        }
        yield* Effect.sleep(`${delay} millis`);
        delay = Math.min(maximum, Math.ceil(delay * 1.2));
    }
});
/**
 * Render-aware fetch wrapper: one request every 150ms (400/minute), honors
 * rate-limit reset headers, and bounds retries. A 429 explicitly rejects the
 * request and is retried for every method as Render recommends. Unsafe
 * POST/PATCH requests and generated-secret PUTs are not replayed after
 * transport or 5xx failures.
 */
export const createRenderFetch = (options = {}) => {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const sleep = options.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = options.now ?? Date.now;
    let gate = Promise.resolve();
    let nextRequestAt = 0;
    const pause = (milliseconds, signal) => {
        if (signal.aborted) {
            return Promise.reject(signal.reason ?? new Error("Request aborted"));
        }
        return new Promise((resolve, reject) => {
            const onAbort = () => reject(signal.reason ?? new Error("Request aborted"));
            signal.addEventListener("abort", onAbort, { once: true });
            Promise.resolve()
                .then(() => sleep(milliseconds))
                .then(resolve, reject)
                .finally(() => signal.removeEventListener("abort", onAbort));
        });
    };
    const throttle = (signal) => {
        if (options.disableRateLimit)
            return Promise.resolve();
        const queued = gate.then(async () => {
            const current = now();
            const wait = Math.max(0, nextRequestAt - current);
            if (wait > 0)
                await pause(wait, signal);
            nextRequestAt = Math.max(nextRequestAt, now()) + 150;
        });
        gate = queued.catch(() => undefined);
        return queued;
    };
    return (async (input, init) => {
        const original = new Request(input, init);
        const replaySafe = await isReplaySafe(original);
        const backoffSeconds = [1, 5, 10, 20, 40, 60, 120];
        for (let attempt = 0;; attempt++) {
            await throttle(original.signal);
            let response;
            try {
                response = await fetchImpl(original.clone());
            }
            catch (error) {
                if (!replaySafe || attempt >= 2 || original.signal.aborted)
                    throw error;
                await pause(backoffSeconds[attempt] * 1_000, original.signal);
                continue;
            }
            const retryableStatus = response.status === 429 ||
                (replaySafe && [502, 503, 504].includes(response.status));
            if (!retryableStatus || attempt >= backoffSeconds.length)
                return response;
            const current = now();
            const retryAfter = parseRetryAfter(response.headers.get("retry-after"), current);
            const rateLimitReset = parseRateLimitReset(response.headers.get("ratelimit-reset"), current);
            await response.body?.cancel().catch(() => undefined);
            await pause(retryAfter ?? rateLimitReset ?? backoffSeconds[attempt] * 1_000, original.signal);
        }
    });
};
const normalizeBaseUrl = (url) => url.replace(/\/+$/, "");
const containsGeneratedValue = (value) => {
    if (Array.isArray(value))
        return value.some(containsGeneratedValue);
    if (typeof value !== "object" || value === null)
        return false;
    const record = value;
    return (record.generateValue === true ||
        Object.values(record).some(containsGeneratedValue));
};
const isReplaySafe = async (request) => {
    const method = request.method.toUpperCase();
    if (["GET", "HEAD", "DELETE", "OPTIONS"].includes(method))
        return true;
    if (method !== "PUT")
        return false;
    try {
        const text = await request.clone().text();
        return text.length === 0 || !containsGeneratedValue(JSON.parse(text));
    }
    catch {
        // A deterministic opaque PUT remains replayable under HTTP semantics.
        return true;
    }
};
const MAX_RATE_LIMIT_DELAY_MS = 60 * 60 * 1_000;
const parseRetryAfter = (value, now) => {
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
        return Math.min(seconds * 1_000, MAX_RATE_LIMIT_DELAY_MS);
    const date = Date.parse(value);
    return Number.isNaN(date)
        ? undefined
        : Math.min(Math.max(0, date - now), MAX_RATE_LIMIT_DELAY_MS);
};
const parseRateLimitReset = (value, now) => {
    if (!value)
        return undefined;
    const reset = Number(value);
    if (!Number.isFinite(reset) || reset < 0)
        return undefined;
    const milliseconds = reset > now / 1_000 - 60 ? reset * 1_000 - now : reset * 1_000;
    return Math.min(Math.max(0, milliseconds), MAX_RATE_LIMIT_DELAY_MS);
};
const safeRequestId = (value) => value !== null && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : undefined;
const safeErrorMessage = (status) => `Render API returned ${status}`;
//# sourceMappingURL=Api.js.map