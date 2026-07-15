import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Render from "../src/index.js";
import {
  call,
  createRenderFetch,
  paginate,
  RenderApi,
  RenderApiError,
  layer as apiLayer,
} from "../src/Api/Api.js";
import { Credentials, fromApiKey } from "../src/Credentials.js";

const runApi = <A>(
  effect: Effect.Effect<A, unknown, RenderApi>,
  fetch: typeof globalThis.fetch,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        apiLayer({ fetch, disableRateLimit: true }).pipe(
          Layer.provide(
            fromApiKey({
              apiKey: "test-key",
              ownerId: "test-owner",
              apiBaseUrl: "https://render.invalid/v1/",
            }),
          ),
        ),
      ),
    ),
  );

describe("Render API transport", () => {
  it("sets bearer authorization and normalizes the base URL", async () => {
    let seen: Request | undefined;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = new Request(input, init);
      return new Response(JSON.stringify({ id: "srv-1" }), { status: 200 });
    }) as typeof globalThis.fetch;
    const baseUrl = await runApi(
      Effect.gen(function* () {
        const getApi = yield* RenderApi;
        const api = yield* getApi;
        yield* api.request({ method: "GET", path: "/services/srv-1" });
        return api.apiBaseUrl;
      }),
      fetch,
    );
    expect(baseUrl).toBe("https://render.invalid/v1");
    expect(seen?.url).toBe("https://render.invalid/v1/services/srv-1");
    expect(seen?.headers.get("authorization")).toBe("Bearer test-key");
  });

  it("sanitizes API errors without retaining response bodies", async () => {
    const secret = "do-not-leak";
    const error = await Effect.runPromise(
      Effect.flip(
        call(async () => ({
          error: { code: secret, message: secret },
          response: new Response(JSON.stringify({ message: secret }), {
            status: 400,
            statusText: "Bad Request",
            headers: { "x-render-request-id": "req-1" },
          }),
        })),
      ),
    );
    expect(error).toBeInstanceOf(RenderApiError);
    expect(error.message).toBe("Render API returned 400");
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error.details).toEqual({ status: 400, requestId: "req-1" });

    const transportError = await runApi(
      Effect.gen(function* () {
        const getApi = yield* RenderApi;
        const api = yield* getApi;
        return yield* Effect.flip(
          api.request({ method: "GET", path: "/services" }),
        );
      }),
      (async () =>
        new Response(JSON.stringify({ code: secret, message: secret }), {
          status: 400,
          statusText: secret,
        })) as typeof globalThis.fetch,
    );
    expect(JSON.stringify(transportError)).not.toContain(secret);
    expect(transportError.message).toBe("Render API returned 400");
  });

  it("honors Retry-After for safe requests", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fetch = createRenderFetch({
      disableRateLimit: true,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: (async () => {
        calls++;
        return calls === 1
          ? new Response(null, { status: 429, headers: { "retry-after": "2" } })
          : new Response("ok");
      }) as typeof globalThis.fetch,
    });
    expect(
      (await fetch("https://render.invalid", { method: "GET" })).status,
    ).toBe(200);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it("retries a rate-limited POST because Render rejected the request", async () => {
    const sleeps: number[] = [];
    const bodies: string[] = [];
    let calls = 0;
    const fetch = createRenderFetch({
      disableRateLimit: true,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls++;
        bodies.push(await new Request(input, init).text());
        return calls === 1
          ? new Response(null, {
              status: 429,
              headers: { "ratelimit-reset": "2" },
            })
          : new Response("ok");
      }) as typeof globalThis.fetch,
    });
    const response = await fetch("https://render.invalid/services", {
      method: "POST",
      body: JSON.stringify({ name: "api" }),
    });
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(bodies).toEqual([
      JSON.stringify({ name: "api" }),
      JSON.stringify({ name: "api" }),
    ]);
  });

  it("never retries unsafe POST on network or 5xx failures", async () => {
    let networkCalls = 0;
    const network = createRenderFetch({
      disableRateLimit: true,
      sleep: async () => {},
      fetch: (async () => {
        networkCalls++;
        throw new Error("offline");
      }) as typeof globalThis.fetch,
    });
    await expect(
      network("https://render.invalid", { method: "POST" }),
    ).rejects.toThrow("offline");
    expect(networkCalls).toBe(1);

    let serverCalls = 0;
    const server = createRenderFetch({
      disableRateLimit: true,
      sleep: async () => {},
      fetch: (async () => {
        serverCalls++;
        return new Response(null, { status: 503 });
      }) as typeof globalThis.fetch,
    });
    expect(
      (await server("https://render.invalid", { method: "POST" })).status,
    ).toBe(503);
    expect(serverCalls).toBe(1);
  });

  it("retries safe transport and server failures", async () => {
    let calls = 0;
    const fetch = createRenderFetch({
      disableRateLimit: true,
      sleep: async () => {},
      fetch: (async () => {
        calls++;
        if (calls === 1) throw new Error("offline");
        if (calls === 2) return new Response(null, { status: 503 });
        return new Response("ok");
      }) as typeof globalThis.fetch,
    });
    expect(
      (await fetch("https://render.invalid", { method: "GET" })).status,
    ).toBe(200);
    expect(calls).toBe(3);
  });

  it("serializes concurrent requests at the 400/minute client limit", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const calls: number[] = [];
    const fetch = createRenderFetch({
      now: () => clock,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        clock += milliseconds;
      },
      fetch: (async () => {
        calls.push(clock);
        return new Response("ok");
      }) as typeof globalThis.fetch,
    });
    await Promise.all([
      fetch("https://render.invalid/a"),
      fetch("https://render.invalid/b"),
      fetch("https://render.invalid/c"),
    ]);
    expect(calls).toEqual([0, 150, 300]);
    expect(sleeps).toEqual([150, 150]);
  });

  it("does not replay generated-secret PUTs after indeterminate failures", async () => {
    for (const failure of ["network", "server"] as const) {
      let calls = 0;
      const fetch = createRenderFetch({
        disableRateLimit: true,
        sleep: async () => {},
        fetch: (async () => {
          calls++;
          if (failure === "network") throw new Error("offline");
          return new Response(null, { status: 503 });
        }) as typeof globalThis.fetch,
      });
      const request = fetch("https://render.invalid/generated", {
        method: "PUT",
        body: JSON.stringify({ generateValue: true }),
      });
      if (failure === "network") {
        await expect(request).rejects.toThrow("offline");
      } else {
        expect((await request).status).toBe(503);
      }
      expect(calls).toBe(1);
    }
  });

  it("replays an idempotent PUT body and aborts during backoff", async () => {
    const bodies: string[] = [];
    let calls = 0;
    const replaying = createRenderFetch({
      disableRateLimit: true,
      sleep: async () => {},
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls++;
        bodies.push(await new Request(input, init).text());
        return new Response(null, { status: calls === 1 ? 503 : 200 });
      }) as typeof globalThis.fetch,
    });
    expect(
      (
        await replaying("https://render.invalid/value", {
          method: "PUT",
          body: JSON.stringify({ value: "secret" }),
        })
      ).status,
    ).toBe(200);
    expect(bodies).toEqual([
      JSON.stringify({ value: "secret" }),
      JSON.stringify({ value: "secret" }),
    ]);

    const controller = new AbortController();
    let enteredBackoff!: () => void;
    const backoffStarted = new Promise<void>((resolve) => {
      enteredBackoff = resolve;
    });
    const aborting = createRenderFetch({
      disableRateLimit: true,
      sleep: () => {
        enteredBackoff();
        return new Promise(() => {});
      },
      fetch: (async () =>
        new Response(null, { status: 503 })) as typeof globalThis.fetch,
    });
    const pending = aborting("https://render.invalid/value", {
      method: "PUT",
      signal: controller.signal,
    });
    await backoffStarted;
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
  });
});

describe("API utilities and public surface", () => {
  it("exhausts cursor pagination and stops on a stale cursor", async () => {
    const seen: Array<string | undefined> = [];
    const rows = await Effect.runPromise(
      paginate(
        (cursor) => {
          seen.push(cursor);
          return Effect.succeed(
            cursor === undefined ? [{ id: "a" }, { id: "b" }] : [{ id: "b" }],
          );
        },
        { cursor: (row) => row.id },
      ),
    );
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "b"]);
    expect(seen).toEqual([undefined, "b"]);
  });

  it("fails closed when a full page has no pagination cursor", async () => {
    await expect(
      Effect.runPromise(
        paginate(
          () => Effect.succeed([{ id: "a" }, { id: "b" }]),
          { cursor: () => undefined, pageSize: 2 },
        ),
      ),
    ).rejects.toThrow("without a pagination cursor");
  });

  it("fails closed when a full page repeats its pagination cursor", async () => {
    await expect(
      Effect.runPromise(
        paginate(
          () =>
            Effect.succeed([
              { id: "a", cursor: "stale" },
              { id: "b", cursor: "stale" },
            ]),
          { cursor: (row) => row.cursor, pageSize: 2 },
        ),
      ),
    ).rejects.toThrow("non-advancing pagination cursor");
  });

  it("does not resolve credentials until the lazy API effect is run", async () => {
    let resolutions = 0;
    const credentials = Layer.succeed(
      Credentials,
      Effect.sync(() => {
        resolutions++;
        return {
          apiKey: Redacted.make("key"),
          ownerId: "owner",
          apiBaseUrl: "https://render.invalid/v1",
        };
      }),
    );
    const program = Effect.gen(function* () {
      const getApi = yield* RenderApi;
      expect(resolutions).toBe(0);
      yield* getApi;
      yield* getApi;
      return resolutions;
    });
    const count = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          apiLayer({ disableRateLimit: true }).pipe(Layer.provide(credentials)),
        ),
      ),
    );
    expect(count).toBe(1);
  });

  it("exports resources, actions, API namespace, and constructs provider layers", () => {
    expect(Render.WebService.Type).toBe("Render.WebService");
    expect(Render.Deploy.Type).toBe("Render.Deploy");
    expect(Render.Actions.CreateWorkflowVersion.Type).toBe(
      "Render.CreateWorkflowVersion",
    );
    expect(Render.Api.RenderApi).toBe(RenderApi);
    expect(Layer.isLayer(Render.providers())).toBe(true);
  });
});
