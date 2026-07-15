import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { layer as apiLayer } from "../src/Api/Api.js";
import {
  MetricsStream,
  MetricsStreamProvider,
  OwnerLogStream,
  OwnerLogStreamProvider,
  RegistryCredential,
  RegistryCredentialProvider,
  ResourceLogStream,
  ResourceLogStreamProvider,
  type ResourceLogStreamProps,
  Webhook,
  WebhookProvider,
  Workflow,
  WorkflowProvider,
  ServiceNotificationOverride,
  ServiceNotificationOverrideProvider,
} from "../src/AccountResources.js";
import { KeyValue, KeyValueProvider, Postgres, PostgresProvider } from "../src/Datastores.js";
import { fromApiKey } from "../src/Credentials.js";
import {
  Environment,
  EnvironmentProvider,
  EnvironmentResource,
  EnvironmentResourceProvider,
  Project,
  ProjectProvider,
} from "../src/Projects.js";
import {
  BackgroundWorker,
  BackgroundWorkerProvider,
  PrivateService,
  PrivateServiceProvider,
  WebService,
  WebServiceProvider,
} from "../src/Services.js";
import {
  Autoscaling,
  AutoscalingProvider,
  Route,
  RouteProvider,
  ServiceEnvVar,
  ServiceEnvVarProvider,
} from "../src/ServiceConfiguration.js";

const runPromise = Effect.runPromise as <A>(
  effect: Effect.Effect<A, any, any>,
) => Promise<A>;

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

const reconcileInput = <P, A>(news: P, output?: A) =>
  ({
    id: "Test",
    fqn: "Test",
    instanceId: "00112233445566778899aabbccddeeff",
    news,
    olds: output === undefined ? undefined : news,
    output,
    bindings: [],
    session: {},
  }) as any;

const diffInput = <P, A>(olds: P, news: P, output: A) =>
  ({
    id: "Test",
    fqn: "Test",
    instanceId: "00112233445566778899aabbccddeeff",
    olds,
    news,
    output,
    bindings: [],
    session: {},
  }) as any;

const deleteInput = <P, A>(olds: P, output: A) =>
  ({
    id: "Test",
    fqn: "Test",
    instanceId: "00112233445566778899aabbccddeeff",
    olds,
    output,
    bindings: [],
    session: {},
  }) as any;

describe("representative resource lifecycles", () => {
  it("creates a service and skips PATCH when observed core configuration is converged", async () => {
    const methods: string[] = [];
    const bodies: unknown[] = [];
    const service = {
      id: "srv-1",
      name: "api",
      ownerId: "tea-test",
      type: "web_service",
      repo: "https://github.com/acme/app",
      branch: "main",
      autoDeploy: "yes",
      dashboardUrl: "https://dashboard.render.com/web/srv-1",
      serviceDetails: {
        runtime: "node",
        envSpecificDetails: {
          buildCommand: "bun install",
          startCommand: "bun start",
        },
        plan: "starter",
        region: "oregon",
        healthCheckPath: "/health",
        url: "https://api.onrender.com",
      },
    };
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.method !== "GET") bodies.push(await request.json());
      if (request.method === "POST") {
        return json({ service, deployId: "dep-1" }, 201);
      }
      if (request.method === "GET") return json(service);
      return json({ message: "unexpected patch" }, 500);
    }) as typeof globalThis.fetch;

    const props = {
      name: "api",
      repo: "https://github.com/acme/app",
      branch: "main",
      runtime: "node" as const,
      buildCommand: "bun install",
      startCommand: "bun start",
      plan: "starter" as const,
      region: "oregon" as const,
      autoDeploy: "yes" as const,
      healthCheckPath: "/health",
    };
    const program = Effect.gen(function* () {
      const provider = yield* WebService.Provider;
      const created = yield* (provider.reconcile as any)(reconcileInput(props));
      const converged = yield* (provider.reconcile as any)(
        reconcileInput(props, created),
      );
      return { created, converged };
    });
    const result = await runPromise(
      program.pipe(
        Effect.provide(WebServiceProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );

    expect(methods).toEqual(["GET", "POST", "GET"]);
    expect(result.created.serviceId).toBe("srv-1");
    expect(result.created.deployId).toBe("dep-1");
    expect(result.created.url).toBe("https://api.onrender.com");
    expect(result.converged.serviceId).toBe("srv-1");
    expect(bodies[0]).toMatchObject({
      type: "web_service",
      ownerId: "tea-test",
      name: "api",
      serviceDetails: { runtime: "node", region: "oregon" },
    });
  });

  it("sends the required empty environments collection when creating a Project", async () => {
    let body: any;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "GET") return json([]);
      body = await request.json();
      return json({ id: "prj-1", name: "app", environmentIds: [] }, 201);
    }) as typeof globalThis.fetch;
    const program = Effect.gen(function* () {
      const provider = yield* Project.Provider;
      return yield* (provider.reconcile as any)(
        reconcileInput({ name: "app" }),
      );
    });
    const result = await runPromise(
      program.pipe(
        Effect.provide(ProjectProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(body).toEqual({ name: "app", ownerId: "tea-test", environments: [] });
    expect(result.projectId).toBe("prj-1");
  });

  it("does not add an environment membership that is already present", async () => {
    const methods: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      return json({
        id: "evm-1",
        serviceIds: ["srv-1"],
        databasesIds: [],
        redisIds: [],
        envGroupIds: [],
      });
    }) as typeof globalThis.fetch;
    const props = { environmentId: "evm-1", resourceId: "srv-1" };
    const program = Effect.gen(function* () {
      const provider = yield* EnvironmentResource.Provider;
      return yield* (provider.reconcile as any)(reconcileInput(props));
    });
    const result = await runPromise(
      program.pipe(
        Effect.provide(
          EnvironmentResourceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(methods).toEqual(["GET"]);
    expect(result).toMatchObject(props);
  });

  it("removes environment membership with repeated query parameters", async () => {
    let request: Request | undefined;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;
    const output = {
      id: "srv-1",
      environmentId: "evm-1",
      resourceId: "srv-1",
    };
    await runPromise(
      Effect.gen(function* () {
        const provider = yield* EnvironmentResource.Provider;
        return yield* (provider.delete as any)(
          deleteInput(
            { environmentId: "evm-1", resourceId: "srv-1" },
            output,
          ),
        );
      }).pipe(
        Effect.provide(
          EnvironmentResourceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(request?.method).toBe("DELETE");
    expect(new URL(request!.url).searchParams.getAll("resourceIds")).toEqual([
      "srv-1",
    ]);
    expect(await request!.text()).toBe("");
  });

  it("redacts Postgres connection values returned after creation", async () => {
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/connection-info")) {
        return json({
          password: "database-secret",
          internalConnectionString: "postgres://database-secret@internal/db",
          externalConnectionString: "postgres://database-secret@external/db",
          psqlCommand: "PGPASSWORD=database-secret psql",
        });
      }
      return json(
        {
          id: "dpg-1",
          name: "app-db",
          owner: { id: "tea-test" },
          plan: "basic_256mb",
          region: "oregon",
          version: "16",
          status: "available",
          highAvailabilityEnabled: false,
          diskAutoscalingEnabled: false,
          connectionPool: "none",
          ipAllowList: [],
          readReplicas: [],
        },
        201,
      );
    }) as typeof globalThis.fetch;
    const props = {
      name: "app-db",
      plan: "basic_256mb" as const,
      region: "oregon" as const,
      version: "16" as const,
    };
    const program = Effect.gen(function* () {
      const provider = yield* Postgres.Provider;
      return yield* (provider.reconcile as any)(reconcileInput(props));
    });
    const result = await runPromise(
      program.pipe(
        Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(Redacted.value(result.connectionInfo.password)).toBe("database-secret");
    expect(JSON.stringify(result)).not.toContain("database-secret");
  });

  it("stores a registry token digest, not the token", async () => {
    const fetch = (async () =>
      json({
        id: "rgc-1",
        name: "registry",
        registry: "GITHUB",
        username: "octocat",
      })) as typeof globalThis.fetch;
    const props = {
      name: "registry",
      registry: "GITHUB" as const,
      username: "octocat",
      authToken: Redacted.make("registry-secret"),
    };
    const program = Effect.gen(function* () {
      const provider = yield* RegistryCredential.Provider;
      return yield* (provider.reconcile as any)(reconcileInput(props));
    });
    const result = await runPromise(
      program.pipe(
        Effect.provide(
          RegistryCredentialProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(result.authTokenDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("registry-secret");
  });

  it("redacts the one-time webhook signing secret from a create envelope", async () => {
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "GET") return json([]);
      return json({
        webhook: {
          id: "whk-1",
          name: "deploys",
          url: "https://example.com/render-hook",
          enabled: true,
          eventFilter: ["deploy_started"],
        },
        secret: "webhook-secret",
      }, 201);
    }) as typeof globalThis.fetch;
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Webhook.Provider;
        return yield* (provider.reconcile as any)(
          reconcileInput({
            name: "deploys",
            url: "https://example.com/render-hook",
            eventFilter: ["deploy_started"],
          }),
        );
      }).pipe(
        Effect.provide(WebhookProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(Redacted.value(result.signingSecret)).toBe("webhook-secret");
    expect(JSON.stringify(result)).not.toContain("webhook-secret");
  });

  it("preserves omitted stream token digests and clears them explicitly", async () => {
    const methods: string[] = [];
    const bodies: any[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.method === "PUT") bodies.push(await request.json());
      return json({
        resourceId: "srv-1",
        endpoint: "https://logs.example.com/new",
        setting: "send",
        provider: "CUSTOM",
        url: "https://metrics.example.com",
        preview: "send",
      });
    }) as typeof globalThis.fetch;
    const resourceProps: ResourceLogStreamProps = {
      resourceId: "srv-1",
      endpoint: "https://logs.example.com/new",
      setting: "send" as const,
    };
    const previous = {
      id: "srv-1",
      resourceId: "srv-1",
      endpoint: "https://logs.example.com/old",
      setting: "send" as const,
      tokenDigest: "old-digest",
    };
    const resourceResult = await runPromise(
      Effect.gen(function* () {
        const provider = yield* ResourceLogStream.Provider;
        return yield* (provider.reconcile as any)(
          reconcileInput(resourceProps, previous),
        );
      }).pipe(
        Effect.provide(
          ResourceLogStreamProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(methods.slice(0, 2)).toEqual(["GET", "PUT"]);
    expect(resourceResult.tokenDigest).toBe("old-digest");
    expect(bodies[0]).not.toHaveProperty("token");

    const ownerResult = await runPromise(
      Effect.gen(function* () {
        const provider = yield* OwnerLogStream.Provider;
        return yield* (provider.reconcile as any)(
          reconcileInput(
            {
              endpoint: "https://logs.example.com/new",
              preview: "send" as const,
            },
            {
              id: "tea-test",
              ownerId: "tea-test",
              tokenDigest: "owner-digest",
            },
          ),
        );
      }).pipe(
        Effect.provide(
          OwnerLogStreamProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(ownerResult.tokenDigest).toBe("owner-digest");

    const metricsResult = await runPromise(
      Effect.gen(function* () {
        const provider = yield* MetricsStream.Provider;
        return yield* (provider.reconcile as any)(
          reconcileInput(
            {
              provider: "CUSTOM" as const,
              url: "https://metrics.example.com",
            },
            {
              id: "tea-test",
              ownerId: "tea-test",
              tokenDigest: "metrics-digest",
            },
          ),
        );
      }).pipe(
        Effect.provide(
          MetricsStreamProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(metricsResult.tokenDigest).toBe("metrics-digest");

    const clearDiff = await runPromise(
      Effect.gen(function* () {
        const provider = yield* ResourceLogStream.Provider;
        return yield* (provider.diff as any)(
          diffInput(
            resourceProps,
            { ...resourceProps, token: null },
            resourceResult,
          ),
        );
      }).pipe(
        Effect.provide(
          ResourceLogStreamProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(clearDiff).toEqual({ action: "update" });
  });

  it("resets a service notification override on delete", async () => {
    let body: unknown;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      body = await new Request(input, init).json();
      return json({
        serviceId: "srv-1",
        previewNotificationsEnabled: "default",
        notificationsToSend: "default",
      });
    }) as typeof globalThis.fetch;
    const olds = {
      serviceId: "srv-1",
      previewNotificationsEnabled: true,
      notificationsToSend: "all" as const,
    };
    const output = {
      id: "srv-1",
      serviceId: "srv-1",
      previewNotificationsEnabled: "true" as const,
      notificationsToSend: "all" as const,
    };
    const program = Effect.gen(function* () {
      const provider = yield* ServiceNotificationOverride.Provider;
      yield* (provider.delete as any)(deleteInput(olds, output));
    });
    await runPromise(
      program.pipe(
        Effect.provide(
          ServiceNotificationOverrideProvider().pipe(
            Layer.provide(withApi(fetch)),
          ),
        ),
      ),
    );
    expect(body).toEqual({
      previewNotificationsEnabled: "default",
      notificationsToSend: "default",
    });
  });

  it("filters service variants during listing and cold reconciliation", async () => {
    const methods: string[] = [];
    const services = [
      {
        service: {
          id: "srv-web",
          name: "api",
          type: "web_service",
          ownerId: "tea-test",
          repo: "https://github.com/acme/app",
          branch: "main",
          autoDeploy: "yes",
          serviceDetails: {
            runtime: "node",
            plan: "starter",
            envSpecificDetails: {
              buildCommand: "bun install",
              startCommand: "bun start",
            },
          },
        },
      },
      {
        service: {
          id: "srv-worker",
          name: "worker",
          type: "background_worker",
          ownerId: "tea-test",
          serviceDetails: { runtime: "node" },
        },
      },
    ];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(new Request(input, init).method);
      return json(services);
    }) as typeof globalThis.fetch;
    const props = {
      name: "api",
      repo: "https://github.com/acme/app",
      branch: "main",
      runtime: "node" as const,
      buildCommand: "bun install",
      startCommand: "bun start",
      plan: "starter" as const,
    };
    const web = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        const listed = yield* (provider.list as any)();
        const reconciled = yield* (provider.reconcile as any)(
          reconcileInput(props),
        );
        return { listed, reconciled };
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    const workers = await runPromise(
      Effect.gen(function* () {
        const provider = yield* BackgroundWorker.Provider;
        return yield* (provider.list as any)();
      }).pipe(
        Effect.provide(
          BackgroundWorkerProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(web.listed.map((item: any) => item.serviceId)).toEqual(["srv-web"]);
    expect(web.reconciled.serviceId).toBe("srv-web");
    expect(workers.map((item: any) => item.serviceId)).toEqual(["srv-worker"]);
    expect(methods.every((method) => method === "GET")).toBe(true);
  });

  it("scopes environment lookup and account listing through projects", async () => {
    const urls: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      urls.push(request.url);
      if (new URL(request.url).pathname.endsWith("/projects")) {
        return json([{ project: { id: "prj-1", name: "app" } }]);
      }
      return json([
        {
          environment: {
            id: "evm-1",
            name: "production",
            projectId: "prj-1",
            protectedStatus: "unprotected",
            networkIsolationEnabled: false,
          },
        },
      ]);
    }) as typeof globalThis.fetch;
    const props = { name: "production", projectId: "prj-1" };
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Environment.Provider;
        const listed = yield* (provider.list as any)();
        const reconciled = yield* (provider.reconcile as any)(
          reconcileInput(props),
        );
        return { listed, reconciled };
      }).pipe(
        Effect.provide(
          EnvironmentProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(result.listed).toHaveLength(1);
    expect(result.reconciled.environmentId).toBe("evm-1");
    const environmentUrls = urls.filter((url) =>
      new URL(url).pathname.endsWith("/environments"),
    );
    expect(environmentUrls).toHaveLength(2);
    expect(
      environmentUrls.every(
        (url) => new URL(url).searchParams.get("projectId") === "prj-1",
      ),
    ).toBe(true);
  });

  it("replaces a route when an unsupported mutable field changes", async () => {
    const olds = {
      serviceId: "srv-1",
      source: "/old",
      destination: "/target",
      type: "rewrite" as const,
    };
    const news = { ...olds, source: "/new" };
    const output = { id: "route-1", serviceId: "srv-1" };
    const diff = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Route.Provider;
        return yield* (provider.diff as any)(diffInput(olds, news, output));
      }).pipe(
        Effect.provide(RouteProvider().pipe(Layer.provide(withApi(async () => json({}) as any)))),
      ),
    );
    expect(diff).toEqual({ action: "replace" });
  });

  it("replaces a cold-adopted resource when observed immutable state differs", async () => {
    const props = {
      name: "api",
      repo: "https://github.com/acme/app",
      runtime: "node" as const,
      buildCommand: "bun install",
      startCommand: "bun start",
      region: "oregon" as const,
    };
    const output = {
      id: "srv-1",
      serviceId: "srv-1",
      type: "web_service" as const,
      name: "api",
      region: "frankfurt" as const,
    };
    const diff = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        return yield* (provider.diff as any)(diffInput(props, props, output));
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(
            Layer.provide(withApi((async () => json({})) as typeof globalThis.fetch)),
          ),
        ),
      ),
    );
    expect(diff).toEqual({ action: "replace" });
  });

  it("adopts an existing generated service variable without rotating it", async () => {
    const methods: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(new Request(input, init).method);
      return json({ key: "TOKEN" });
    }) as typeof globalThis.fetch;
    const props = {
      serviceId: "srv-1",
      key: "TOKEN",
      generateValue: true as const,
    };
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* ServiceEnvVar.Provider;
        return yield* (provider.reconcile as any)(reconcileInput(props));
      }).pipe(
        Effect.provide(
          ServiceEnvVarProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(methods).toEqual(["GET"]);
    expect(result.generated).toBe(true);
  });

  it("normalizes omitted autoscaling criteria to Render's complete shape", async () => {
    let body: any;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      body = await new Request(input, init).json();
      return json({});
    }) as typeof globalThis.fetch;
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Autoscaling.Provider;
        return yield* (provider.reconcile as any)(
          reconcileInput({
            serviceId: "srv-1",
            min: 1,
            max: 4,
            criteria: { cpu: { enabled: true, percentage: 70 } },
          }),
        );
      }).pipe(
        Effect.provide(
          AutoscalingProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(body.criteria).toEqual({
      cpu: { enabled: true, percentage: 70 },
      memory: { enabled: false, percentage: 0 },
    });
    expect(result.criteria).toEqual(body.criteria);
  });

  it("waits for Key Value readiness before reading connection information", async () => {
    const paths: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      paths.push(`${request.method} ${path}`);
      if (path.endsWith("/connection-info")) {
        return json({ internalConnectionString: "redis://secret@internal" });
      }
      if (request.method === "GET" && path.endsWith("/key-value")) {
        return json([]);
      }
      if (request.method === "POST") {
        return json({ id: "kv-1", name: "cache", status: "creating" }, 201);
      }
      return json({ id: "kv-1", name: "cache", status: "available" });
    }) as typeof globalThis.fetch;
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* KeyValue.Provider;
        return yield* (provider.reconcile as any)(
          reconcileInput({
            name: "cache",
            plan: "starter" as const,
            maxmemoryPolicy: "noeviction" as const,
          }),
        );
      }).pipe(
        Effect.provide(KeyValueProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(paths).toEqual([
      "GET /v1/key-value",
      "POST /v1/key-value",
      "GET /v1/key-value/kv-1",
      "GET /v1/key-value/kv-1/connection-info",
    ]);
    expect(
      Redacted.value(result.connectionInfo.internalConnectionString),
    ).toContain("secret");
  });

  it("tracks Postgres Datadog secrets by digest without perpetual drift", async () => {
    const secret = Redacted.make("datadog-secret");
    const props = {
      name: "db",
      plan: "basic_256mb" as const,
      version: "16" as const,
      datadogApiKey: secret,
      datadogSite: "datadoghq.com",
    };
    const output = {
      id: "dpg-1",
      datastoreId: "dpg-1",
      name: "db",
      datadogApiKeyDigest:
        "5988f0315abb61de14040ccf964184c2797f6c8378c785f6183eb9ebddac7a06",
      datadogSite: "datadoghq.com",
    };
    const fetch = (async () =>
      json({
        id: "dpg-1",
        name: "db",
        plan: "basic_256mb",
        version: "16",
        status: "available",
        highAvailabilityEnabled: false,
        diskAutoscalingEnabled: false,
        connectionPool: "none",
        ipAllowList: [],
        parameterOverrides: {},
        readReplicas: [],
      })) as typeof globalThis.fetch;
    const diff = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Postgres.Provider;
        return yield* (provider.diff as any)(diffInput(props, props, output));
      }).pipe(
        Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    const changed = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Postgres.Provider;
        return yield* (provider.diff as any)(
          diffInput(props, { ...props, datadogApiKey: Redacted.make("rotated") }, output),
        );
      }).pipe(
        Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    let patchBody: any;
    const writingFetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/connection-info")) return json({});
      if (request.method === "PATCH") patchBody = await request.json();
      return json({
        id: "dpg-1",
        name: "db",
        plan: "basic_256mb",
        version: "16",
        status: "available",
        highAvailabilityEnabled: false,
        diskAutoscalingEnabled: false,
        connectionPool: "none",
        ipAllowList: [],
        parameterOverrides: {},
        readReplicas: [],
      });
    }) as typeof globalThis.fetch;
    const rotated = { ...props, datadogApiKey: Redacted.make("rotated") };
    await runPromise(
      Effect.gen(function* () {
        const provider = yield* Postgres.Provider;
        const input = reconcileInput(rotated, output);
        input.olds = props;
        return yield* (provider.reconcile as any)(input);
      }).pipe(
        Effect.provide(
          PostgresProvider().pipe(Layer.provide(withApi(writingFetch))),
        ),
      ),
    );
    expect(diff).toBeUndefined();
    expect(changed).toEqual({ action: "update" });
    expect(patchBody.datadogAPIKey).toBe("rotated");
    expect(JSON.stringify(output)).not.toContain("datadog-secret");
  });

  it("stores a Workflow environment digest and replaces on value-only changes", async () => {
    let body: any;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "GET") return json([]);
      body = await request.json();
      return json({ id: "wfl-1", name: "workflow", region: "oregon" }, 201);
    }) as typeof globalThis.fetch;
    const props = {
      name: "workflow",
      buildConfig: {
        repo: "https://github.com/acme/app",
        branch: "main",
        buildCommand: "bun install",
        runtime: "node" as const,
      },
      runCommand: "bun run workflow",
      region: "oregon" as const,
      envVars: [{ key: "TOKEN", value: Redacted.make("first") }],
    };
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Workflow.Provider;
        const created = yield* (provider.reconcile as any)(reconcileInput(props));
        const changed = yield* (provider.diff as any)(
          diffInput(
            props,
            { ...props, envVars: [{ key: "TOKEN", value: Redacted.make("second") }] },
            created,
          ),
        );
        return { created, changed };
      }).pipe(
        Effect.provide(WorkflowProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(body.envVars).toEqual([{ key: "TOKEN", value: "first" }]);
    expect(result.created.envVarsDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.created)).not.toContain("first");
    expect(result.changed).toEqual({ action: "replace" });
  });

  it("sends the required initial instance count for private services and workers", async () => {
    const bodies: any[] = [];
    const fetchFor = (type: "private_service" | "background_worker") =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.method === "GET") return json([]);
        bodies.push(await request.json());
        return json({
          service: {
            id: type === "private_service" ? "srv-private" : "srv-worker",
            name: type === "private_service" ? "private" : "worker",
            type,
            serviceDetails: { runtime: "node" },
          },
        }, 201);
      }) as typeof globalThis.fetch;
    const source = {
      repo: "https://github.com/acme/app",
      runtime: "node" as const,
      buildCommand: "bun install",
      startCommand: "bun start",
    };
    await runPromise(
      Effect.gen(function* () {
        const provider = yield* PrivateService.Provider;
        return yield* (provider.reconcile as any)(
          reconcileInput({ ...source, name: "private" }),
        );
      }).pipe(
        Effect.provide(
          PrivateServiceProvider().pipe(
            Layer.provide(withApi(fetchFor("private_service"))),
          ),
        ),
      ),
    );
    await runPromise(
      Effect.gen(function* () {
        const provider = yield* BackgroundWorker.Provider;
        return yield* (provider.reconcile as any)(
          reconcileInput({ ...source, name: "worker" }),
        );
      }).pipe(
        Effect.provide(
          BackgroundWorkerProvider().pipe(
            Layer.provide(withApi(fetchFor("background_worker"))),
          ),
        ),
      ),
    );
    expect(bodies.map((body) => body.serviceDetails.numInstances)).toEqual([
      1,
      1,
    ]);
  });

  it("normalizes Docker registry credential responses during drift checks", async () => {
    const props = {
      name: "docker-api",
      repo: "https://github.com/acme/app",
      runtime: "docker" as const,
      registryCredentialId: "rgc-1",
    };
    const fetch = (async () =>
      json({
        id: "srv-docker",
        name: "docker-api",
        type: "web_service",
        repo: "https://github.com/acme/app",
        autoDeploy: "yes",
        rootDir: "",
        buildFilter: { paths: [], ignoredPaths: [] },
        serviceDetails: {
          runtime: "docker",
          envSpecificDetails: {
            registryCredential: { id: "rgc-1", name: "registry" },
          },
        },
      })) as typeof globalThis.fetch;
    const diff = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        return yield* (provider.diff as any)(
          diffInput(props, props, {
            id: "srv-docker",
            serviceId: "srv-docker",
            type: "web_service",
            name: "docker-api",
          }),
        );
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(diff).toBeUndefined();
  });

  it("applies web cache configuration immediately after service creation", async () => {
    const methods: string[] = [];
    const bodies: any[] = [];
    const service = {
      id: "srv-1",
      name: "api",
      type: "web_service",
      ownerId: "tea-test",
      serviceDetails: { runtime: "node" },
    };
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.method === "GET") return json([]);
      bodies.push(await request.json());
      return json(request.method === "POST" ? { service } : service, request.method === "POST" ? 201 : 200);
    }) as typeof globalThis.fetch;
    await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        return yield* (provider.reconcile as any)(
          reconcileInput({
            name: "api",
            repo: "https://github.com/acme/app",
            runtime: "node" as const,
            buildCommand: "bun install",
            startCommand: "bun start",
            cache: { profile: "origin-controlled" as const },
          }),
        );
      }).pipe(
        Effect.provide(WebServiceProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(methods).toEqual(["GET", "POST", "PATCH"]);
    expect(bodies[1]).toEqual({
      serviceDetails: { cache: { profile: "origin-controlled" } },
    });
  });
});
