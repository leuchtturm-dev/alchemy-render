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
  type ImageSource,
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
): WebServiceProps & ImageSource => ({
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
    let deleted = false;
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
      if (request.method === "GET") {
        return deleted ? json({ message: "not found" }, 404) : json(service());
      }
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
        const beforeDeletionDiff = methods.length;
        deleted = true;
        const deletionDiff = yield* provider.diff!({
          id: "Api",
          fqn: "Api",
          instanceId: "00112233445566778899aabbccddeeff",
          olds: props,
          news: props,
          output: unchanged,
          oldBindings: [],
          newBindings: [],
        });
        return {
          created,
          unchanged,
          deletionDiff,
          deletionRequests: methods.slice(beforeDeletionDiff),
        };
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
    expect(result.deletionDiff).toEqual({ action: "update" });
    expect(result.deletionRequests).toEqual(["GET /v1/services/srv-1"]);
  });

  it("fails closed when full environment pagination cannot advance", async () => {
    const env = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `KEY_${index}`,
        Redacted.make(`value-${index}`),
      ]),
    );
    const props: WebServiceProps = imageProps(env);

    for (const mode of ["missing", "repeated"] as const) {
      const methods: string[] = [];
      const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        methods.push(`${request.method} ${path}`);
        if (request.method === "POST" && path.endsWith("/services")) {
          return json({ service: service(), deployId: "dep-create" }, 201);
        }
        if (request.method === "GET" && path.endsWith("/env-vars")) {
          return json(
            Object.entries(env).map(([key, value]) => ({
              envVar: { key, value: Redacted.value(value) },
              ...(mode === "repeated" ? { cursor: "stale" } : {}),
            })),
          );
        }
        if (request.method === "GET") return json(service());
        return json({ message: "unexpected write" }, 500);
      }) as typeof globalThis.fetch;

      await expect(
        runPromise(
          Effect.gen(function* () {
            const provider = yield* WebService.Provider;
            const created = yield* provider.reconcile(reconcileInput(props));
            return yield* provider.diff!({
              id: "Api",
              fqn: "Api",
              instanceId: "00112233445566778899aabbccddeeff",
              olds: props,
              news: props,
              output: created,
              oldBindings: [],
              newBindings: [],
            });
          }).pipe(
            Effect.provide(
              WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
            ),
          ),
        ),
      ).rejects.toThrow(
        mode === "missing"
          ? "without a pagination cursor"
          : "non-advancing pagination cursor",
      );
      expect(methods).toEqual([
        "POST /v1/services",
        "GET /v1/services/srv-1",
        "GET /v1/services/srv-1/env-vars",
        ...(mode === "repeated"
          ? ["GET /v1/services/srv-1/env-vars"]
          : []),
      ]);
    }
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
        const refreshed = yield* provider.read!({
          id: "Api",
          fqn: "Api",
          instanceId: "00112233445566778899aabbccddeeff",
          olds: props,
          output: created,
        });
        const driftDiff = yield* provider.diff!({
          id: "Api",
          fqn: "Api",
          instanceId: "00112233445566778899aabbccddeeff",
          olds: props,
          news: props,
          output: refreshed,
          oldBindings: [],
          newBindings: [],
        });
        const corrected = yield* provider.reconcile(
          reconcileInput(props, created),
        );
        return {
          createRequest,
          driftDiff,
          corrected,
          correctionRequests: [...requests],
        };
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(result.createRequest?.body).toMatchObject({
      serviceDetails: { numInstances: 2 },
    });
    expect(result.driftDiff).toEqual({ action: "update" });
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

  it("moves a service between environments without replacing it", async () => {
    const oldProps: WebServiceProps & ImageSource = {
      ...imageProps(undefined),
      environmentId: "evm-old",
    };
    const newProps: WebServiceProps & ImageSource = {
      ...oldProps,
      environmentId: "evm-new",
    };
    const remote = { ...service(), environmentId: "evm-old" };
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const text = request.method === "GET" ? "" : await request.text();
      const body = text.length === 0 ? undefined : JSON.parse(text);
      requests.push({ method: request.method, path, body });
      if (request.method === "GET") return json(remote);
      if (path.endsWith("/deploys")) {
        return json({ id: "dep-environment", status: "created" }, 201);
      }
      return json({});
    }) as typeof globalThis.fetch;
    const output: ServiceAttributes & { readonly type: "web_service" } = {
      id: "srv-1",
      serviceId: "srv-1",
      type: "web_service",
      name: "api",
      ownerId: "tea-test",
      environmentId: "evm-old",
    };

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        return yield* provider.reconcile(
          reconcileInput(newProps, output, oldProps),
        );
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(result.environmentId).toBe("evm-new");
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "GET /v1/services/srv-1",
      "GET /v1/environments/evm-new",
      "DELETE /v1/environments/evm-old/resources",
      "POST /v1/environments/evm-new/resources",
      "POST /v1/services/srv-1/deploys",
    ]);
    expect(requests[2]?.body).toBeUndefined();
    expect(requests[3]?.body).toEqual({ resourceIds: ["srv-1"] });
  });

  it("repairs out-of-band service environment drift", async () => {
    const props: WebServiceProps & ImageSource = {
      ...imageProps(undefined),
      environmentId: "evm-desired",
    };
    const remote = { ...service(), environmentId: "evm-external" };
    const requests: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (request.method === "GET") return json(remote);
      if (path.endsWith("/deploys")) {
        return json({ id: "dep-drift", status: "created" }, 201);
      }
      return json({});
    }) as typeof globalThis.fetch;
    const output: ServiceAttributes & { readonly type: "web_service" } = {
      id: "srv-1",
      serviceId: "srv-1",
      type: "web_service",
      name: "api",
      ownerId: "tea-test",
      environmentId: "evm-desired",
    };

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        return yield* provider.reconcile(
          reconcileInput(props, output, props),
        );
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(result.environmentId).toBe("evm-desired");
    expect(requests).toEqual([
      "GET /v1/services/srv-1",
      "GET /v1/environments/evm-desired",
      "DELETE /v1/environments/evm-external/resources",
      "POST /v1/environments/evm-desired/resources",
      "POST /v1/services/srv-1/deploys",
    ]);
  });

  it("conservatively deploys a cold-adopted web cache transition", async () => {
    const props: WebServiceProps & ImageSource = {
      ...imageProps(undefined),
      cache: { profile: "origin-controlled" },
    };
    const remote = {
      ...service(),
      serviceDetails: {
        ...service().serviceDetails,
        cache: { profile: "origin-controlled" },
      },
    };
    const requests: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (request.method === "GET" && path.endsWith("/services")) {
        return json([{ service: remote }]);
      }
      if (request.method === "GET") return json(remote);
      if (request.method === "POST" && path.endsWith("/deploys")) {
        return json({ id: "dep-recovery", status: "created" }, 201);
      }
      return json({ message: "unexpected request" }, 500);
    }) as typeof globalThis.fetch;

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        const cold = yield* provider.read!({
          id: "Api",
          fqn: "Api",
          instanceId: "00112233445566778899aabbccddeeff",
          olds: props,
          output: undefined,
        });
        expect(cold?.coreDigest).toBeUndefined();
        const adopted = { ...cold! };
        return yield* provider.reconcile({
          ...reconcileInput(props, adopted),
          olds: undefined,
        });
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(result.deployId).toBe("dep-recovery");
    expect(requests.filter((request) => request.endsWith("/deploys"))).toEqual([
      "POST /v1/services/srv-1/deploys",
    ]);
  });
});
