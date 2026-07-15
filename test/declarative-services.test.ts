import type { ScopedPlanStatusSession } from "alchemy/Cli/Cli";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { layer as apiLayer } from "../src/Api/Api.js";
import { fromApiKey } from "../src/Credentials.js";
import {
  WebService,
  WebServiceProvider,
  type ServiceAttributes,
  type WebServiceProps,
} from "../src/Services.js";

const runPromise = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E>);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const withApi = (fetch: typeof globalThis.fetch) =>
  apiLayer({ fetch, disableRateLimit: true }).pipe(
    Layer.provide(
      fromApiKey({
        apiKey: "test-key",
        ownerId: "tea-test",
        apiBaseUrl: "https://render.invalid/v1",
      }),
    ),
  );

const session = {} as ScopedPlanStatusSession;

const reconcileInput = (
  news: WebServiceProps,
  output?: ServiceAttributes & { readonly type: "web_service" },
  olds: WebServiceProps = news,
) => ({
  id: "Api",
  fqn: "Api",
  instanceId: "00112233445566778899aabbccddeeff",
  news,
  olds: output === undefined ? undefined : olds,
  output,
  bindings: [],
  session,
});

const imageProps = (
  env: WebServiceProps["env"],
  options: Pick<WebServiceProps, "numInstances" | "waitForDeploy"> = {},
): WebServiceProps => ({
  name: "api",
  runtime: "image",
  image: { imagePath: "docker.io/acme/api:1" },
  plan: "pro",
  region: "frankfurt",
  ...(env === undefined ? {} : { env }),
  ...options,
});

const service = (numInstances = 2) => ({
  id: "srv-1",
  name: "api",
  ownerId: "tea-test",
  type: "web_service",
  imagePath: "docker.io/acme/api:1",
  autoDeploy: "yes",
  rootDir: "",
  buildFilter: { paths: [], ignoredPaths: [] },
  serviceDetails: {
    runtime: "image",
    envSpecificDetails: {},
    plan: "pro",
    region: "frankfurt",
    numInstances,
    url: "https://api.onrender.com",
  },
});

describe("declarative service-owned configuration", () => {
  it("creates with env and numInstances without persisting plaintext or polling", async () => {
    const methods: string[] = [];
    const bodies: unknown[] = [];
    const remoteEnv: Record<string, string> = {
      TOKEN: "first",
      MODE: "production",
    };
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      methods.push(`${request.method} ${path}`);
      if (request.method !== "GET") bodies.push(await request.json());
      if (request.method === "GET" && path.endsWith("/services")) {
        return json([]);
      }
      if (request.method === "POST" && path.endsWith("/services")) {
        return json({ service: service(), deployId: "dep-create" }, 201);
      }
      if (request.method === "GET" && path.endsWith("/env-vars")) {
        if (new URL(request.url).searchParams.has("cursor")) return json([]);
        return json(
          Object.entries(remoteEnv).map(([key, value], index) => ({
            envVar: { key, value },
            cursor: `cursor-${index}`,
          })),
        );
      }
      if (request.method === "GET") return json(service());
      return json({ message: "unexpected write" }, 500);
    }) as typeof globalThis.fetch;

    const props = imageProps(
      {
        TOKEN: Redacted.make("first"),
        MODE: Redacted.make("production"),
      },
      { numInstances: 2 },
    );
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        const created = yield* provider.reconcile(reconcileInput(props));
        const unchanged = yield* provider.reconcile(
          reconcileInput(props, created),
        );
        return { created, unchanged };
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(bodies[0]).toMatchObject({
      envVars: [
        { key: "MODE", value: "production" },
        { key: "TOKEN", value: "first" },
      ],
      serviceDetails: { numInstances: 2 },
    });
    expect(result.created.envDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.unchanged.envDigest).toBe(result.created.envDigest);
    expect(JSON.stringify(result.created)).not.toContain("first");
    expect(JSON.stringify(result.created)).not.toContain("production");
    expect(JSON.stringify(props)).not.toContain("first");
    expect(methods.filter((entry) => entry.includes("/deploys/"))).toEqual([]);
    expect(methods.filter((entry) => entry.startsWith("PUT "))).toEqual([]);
  });

  it("rotates and deletes env with one deployment transition each", async () => {
    let remoteEnv: Record<string, string> = { TOKEN: "first", OLD: "remove" };
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const body = request.method === "GET" ? undefined : await request.json();
      requests.push({ method: request.method, path, body });
      if (request.method === "GET" && path.endsWith("/services")) {
        return json([]);
      }
      if (request.method === "POST" && path.endsWith("/services")) {
        return json({ service: service(), deployId: "dep-create" }, 201);
      }
      if (request.method === "GET" && path.endsWith("/env-vars")) {
        if (new URL(request.url).searchParams.has("cursor")) return json([]);
        return json(
          Object.entries(remoteEnv).map(([key, value], index) => ({
            envVar: { key, value },
            cursor: `cursor-${index}`,
          })),
        );
      }
      if (request.method === "PUT" && path.endsWith("/env-vars")) {
        remoteEnv = Object.fromEntries(
          (body as Array<{ key: string; value: string }>).map(({ key, value }) => [
            key,
            value,
          ]),
        );
        return json([]);
      }
      if (request.method === "POST" && path.endsWith("/deploys")) {
        return json({ id: `dep-${requests.length}`, status: "created" }, 201);
      }
      if (request.method === "GET") return json(service());
      return json({ message: "unexpected request" }, 500);
    }) as typeof globalThis.fetch;

    const first = imageProps({
      TOKEN: Redacted.make("first"),
      OLD: Redacted.make("remove"),
    });
    const rotated = imageProps({ TOKEN: Redacted.make("second") });
    const empty = imageProps({});
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        const created = yield* provider.reconcile(reconcileInput(first));
        requests.length = 0;
        const changed = yield* provider.reconcile(
          reconcileInput(rotated, created, first),
        );
        const rotationRequests = [...requests];
        requests.length = 0;
        const deleted = yield* provider.reconcile(
          reconcileInput(empty, changed, rotated),
        );
        const deletionRequests = [...requests];
        requests.length = 0;
        yield* provider.reconcile(reconcileInput(empty, deleted));
        return { changed, rotationRequests, deletionRequests, unchanged: requests };
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    const writes = (rows: typeof requests) =>
      rows.filter(({ method }) => method !== "GET");
    expect(writes(result.rotationRequests).map(({ method, path }) => `${method} ${path}`)).toEqual([
      "PUT /v1/services/srv-1/env-vars",
      "POST /v1/services/srv-1/deploys",
    ]);
    expect(result.rotationRequests.find(({ method }) => method === "PUT")?.body).toEqual([
      { key: "TOKEN", value: "second" },
    ]);
    expect(writes(result.deletionRequests).map(({ method, path }) => `${method} ${path}`)).toEqual([
      "PUT /v1/services/srv-1/env-vars",
      "POST /v1/services/srv-1/deploys",
    ]);
    expect(result.deletionRequests.find(({ method }) => method === "PUT")?.body).toEqual([]);
    expect(writes(result.unchanged)).toEqual([]);
    expect(result.changed.deployId).toMatch(/^dep-/);
  });

  it("creates at two instances and corrects fixed-count drift without autoscaling", async () => {
    let observedInstances = 2;
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const body = request.method === "GET" ? undefined : await request.json();
      requests.push({ method: request.method, path, body });
      if (request.method === "GET" && path.endsWith("/services")) return json([]);
      if (request.method === "POST" && path.endsWith("/services")) {
        return json({ service: service(observedInstances), deployId: "dep-create" }, 201);
      }
      if (request.method === "POST" && path.endsWith("/scale")) {
        observedInstances = (body as { numInstances: number }).numInstances;
        return new Response(null, { status: 202 });
      }
      if (request.method === "GET") return json(service(observedInstances));
      return json({ message: "unexpected request" }, 500);
    }) as typeof globalThis.fetch;
    const props = imageProps(undefined, { numInstances: 2 });

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        const created = yield* provider.reconcile(reconcileInput(props));
        const createRequest = requests.find(
          ({ method, path }) => method === "POST" && path.endsWith("/services"),
        );
        observedInstances = 1;
        requests.length = 0;
        const corrected = yield* provider.reconcile(
          reconcileInput(props, created),
        );
        return { createRequest, corrected, correctionRequests: [...requests] };
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(result.createRequest?.body).toMatchObject({
      serviceDetails: { numInstances: 2 },
    });
    expect(
      result.correctionRequests.filter(({ method }) => method !== "GET"),
    ).toEqual([
      {
        method: "POST",
        path: "/v1/services/srv-1/scale",
        body: { numInstances: 2 },
      },
    ]);
    expect(result.corrected.numInstances).toBe(2);
  });

  it("recovers a core update accepted before its deployment was persisted", async () => {
    const writes: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method !== "GET") writes.push(`${request.method} ${path}`);
      if (request.method === "POST" && path.endsWith("/deploys")) {
        return json({ id: "dep-recovered", status: "created" }, 201);
      }
      return json({
        ...service(),
        imagePath: "docker.io/acme/api:2",
      });
    }) as typeof globalThis.fetch;
    const oldProps = imageProps(undefined);
    const newProps: WebServiceProps = {
      ...oldProps,
      image: { imagePath: "docker.io/acme/api:2" },
    };
    const oldOutput = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        return yield* provider.reconcile(reconcileInput(oldProps));
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(
            Layer.provide(
              withApi(
                (async (input: RequestInfo | URL, init?: RequestInit) => {
                  const request = new Request(input, init);
                  if (request.method === "GET") return json([]);
                  return json({ service: service(), deployId: "dep-create" }, 201);
                }) as typeof globalThis.fetch,
              ),
            ),
          ),
        ),
      ),
    );

    const recovered = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        return yield* provider.reconcile(
          reconcileInput(newProps, oldOutput, oldProps),
        );
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(writes).toEqual(["POST /v1/services/srv-1/deploys"]);
    expect(recovered.deployId).toBe("dep-recovered");
  });

  it("polls only when waitForDeploy is explicitly enabled", async () => {
    let remoteEnv = "first";
    const paths: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      paths.push(`${request.method} ${path}`);
      if (request.method === "GET" && path.endsWith("/services")) return json([]);
      if (request.method === "POST" && path.endsWith("/services")) {
        return json({ service: service(), deployId: "dep-create" }, 201);
      }
      if (request.method === "GET" && path.endsWith("/env-vars")) {
        if (new URL(request.url).searchParams.has("cursor")) return json([]);
        return json([{ envVar: { key: "TOKEN", value: remoteEnv }, cursor: "1" }]);
      }
      if (request.method === "PUT") {
        remoteEnv = "second";
        return json([]);
      }
      if (request.method === "POST" && path.endsWith("/deploys")) {
        return json({ id: "dep-update", status: "created" }, 201);
      }
      if (request.method === "GET" && path.endsWith("/deploys/dep-update")) {
        return json({ id: "dep-update", status: "live" });
      }
      if (request.method === "GET") return json(service());
      return json({ message: "unexpected request" }, 500);
    }) as typeof globalThis.fetch;
    const first = imageProps({ TOKEN: Redacted.make("first") });
    const changed = imageProps(
      { TOKEN: Redacted.make("second") },
      { waitForDeploy: true },
    );

    await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        const created = yield* provider.reconcile(reconcileInput(first));
        paths.length = 0;
        return yield* provider.reconcile(
          reconcileInput(changed, created, first),
        );
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(paths).toContain("GET /v1/services/srv-1/deploys/dep-update");
  });
});
