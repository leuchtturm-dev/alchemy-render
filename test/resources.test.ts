import type { ScopedPlanStatusSession } from "alchemy/Cli/Cli";
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
import {
  KeyValue,
  KeyValueProvider,
  Postgres,
  PostgresProvider,
} from "../src/Datastores.js";
import { fromApiKey } from "../src/Credentials.js";
import {
  EnvironmentGroupEnvVar,
  EnvironmentGroupEnvVarProvider,
  EnvironmentGroupSecretFile,
  EnvironmentGroupSecretFileProvider,
} from "../src/EnvironmentGroups.js";
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
  CronJob,
  CronJobProvider,
  PrivateService,
  PrivateServiceProvider,
  WebService,
  WebServiceProvider,
} from "../src/Services.js";
import {
  Autoscaling,
  AutoscalingProvider,
  CustomDomain,
  CustomDomainProvider,
  Header,
  HeaderProvider,
  Disk,
  DiskProvider,
  Route,
  type RouteAttributes,
  RouteProvider,
  ServiceEnvVar,
  ServiceEnvVarProvider,
  ServiceSecretFile,
  ServiceSecretFileProvider,
} from "../src/ServiceConfiguration.js";

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

const reconcileInput = <P, A>(news: P, output?: A) => ({
  id: "Test",
  fqn: "Test",
  instanceId: "00112233445566778899aabbccddeeff",
  news,
  olds: output === undefined ? undefined : news,
  output,
  bindings: [],
  session,
});

const readInput = <P, A>(olds: P, output?: A) => ({
  id: "Test",
  fqn: "Test",
  instanceId: "00112233445566778899aabbccddeeff",
  olds,
  output,
});

const diffInput = <P, A>(olds: P, news: P, output: A) => ({
  id: "Test",
  fqn: "Test",
  instanceId: "00112233445566778899aabbccddeeff",
  olds,
  news,
  output,
  oldBindings: [],
  newBindings: [],
});

const deleteInput = <P, A>(olds: P, output: A) => ({
  id: "Test",
  fqn: "Test",
  instanceId: "00112233445566778899aabbccddeeff",
  olds,
  output,
  bindings: [],
  session,
});

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
      const created = yield* provider.reconcile(reconcileInput(props));
      const converged = yield* provider.reconcile(
        reconcileInput(props, created),
      );
      return { created, converged };
    });
    const result = await runPromise(
      program.pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(methods).toEqual(["POST", "GET"]);
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
    let body: unknown;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "GET") return json([]);
      body = await request.json();
      return json({ id: "prj-1", name: "app", environmentIds: [] }, 201);
    }) as typeof globalThis.fetch;
    const program = Effect.gen(function* () {
      const provider = yield* Project.Provider;
      return yield* provider.reconcile(reconcileInput({ name: "app" }));
    });
    const result = await runPromise(
      program.pipe(
        Effect.provide(ProjectProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(body).toEqual({
      name: "app",
      ownerId: "tea-test",
      environments: [],
    });
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
      return yield* provider.reconcile(reconcileInput(props));
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
        return yield* provider.delete(
          deleteInput({ environmentId: "evm-1", resourceId: "srv-1" }, output),
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
      return yield* provider.reconcile(reconcileInput(props));
    });
    const result = await runPromise(
      program.pipe(
        Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(Redacted.value(result.connectionInfo!.password!)).toBe(
      "database-secret",
    );
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
      return yield* provider.reconcile(reconcileInput(props));
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

  it("fails closed when a full list page omits Render's pagination cursor", async () => {
    const fetch = (async () =>
      json(
        Array.from({ length: 100 }, (_, index) => ({
          id: `rgc-${index}`,
          name: `registry-${index}`,
          registry: "DOCKER",
          username: "user",
        })),
      )) as typeof globalThis.fetch;

    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* RegistryCredential.Provider;
          return yield* provider.list();
        }).pipe(
          Effect.provide(
            RegistryCredentialProvider().pipe(Layer.provide(withApi(fetch))),
          ),
        ),
      ),
    ).rejects.toThrow("without a pagination cursor");
  });

  it("redacts the one-time webhook signing secret from a create envelope", async () => {
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "GET") return json([]);
      return json(
        {
          webhook: {
            id: "whk-1",
            name: "deploys",
            url: "https://example.com/render-hook",
            enabled: true,
            eventFilter: ["deploy_started"],
          },
          secret: "webhook-secret",
        },
        201,
      );
    }) as typeof globalThis.fetch;
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Webhook.Provider;
        return yield* provider.reconcile(
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
    expect(Redacted.value(result.signingSecret!)).toBe("webhook-secret");
    expect(JSON.stringify(result)).not.toContain("webhook-secret");
  });

  it("preserves omitted stream token digests and clears them explicitly", async () => {
    const methods: string[] = [];
    const bodies: unknown[] = [];
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
        return yield* provider.reconcile(
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
        return yield* provider.reconcile(
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
        return yield* provider.reconcile(
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
        return yield* provider.diff!(
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

  it("clears an unknown resource log token once and records the managed clear", async () => {
    const methods: string[] = [];
    let putBody: unknown;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.method === "PUT") putBody = await request.json();
      return json({
        resourceId: "srv-1",
        endpoint: "https://logs.example.com",
        setting: "send",
      });
    }) as typeof globalThis.fetch;
    const olds = {
      resourceId: "srv-1",
      endpoint: "https://logs.example.com",
      setting: "send" as const,
    };
    const news = { ...olds, token: null };
    const output = {
      id: "srv-1",
      resourceId: "srv-1",
      endpoint: "https://logs.example.com",
      setting: "send" as const,
    };

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* ResourceLogStream.Provider;
        const diff = yield* provider.diff!(diffInput(olds, news, output));
        const reconciled = yield* provider.reconcile({
          ...reconcileInput(news, output),
          olds,
        });
        const converged = yield* provider.diff!(
          diffInput(news, news, reconciled),
        );
        return { diff, reconciled, converged };
      }).pipe(
        Effect.provide(
          ResourceLogStreamProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(result.diff).toEqual({ action: "update" });
    expect(methods).toEqual(["GET", "PUT", "GET"]);
    expect(putBody).toEqual({
      endpoint: "https://logs.example.com",
      setting: "send",
      token: "",
    });
    expect(result.reconciled.tokenCleared).toBe(true);
    expect(result.converged).toBeUndefined();
  });

  it("does not claim write-only stream token changes after an indeterminate PUT", async () => {
    const methods: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.method === "PUT") {
        return json({ message: "indeterminate" }, 500);
      }
      return json({
        resourceId: "srv-1",
        endpoint: "https://logs.example.com",
        setting: "send",
      });
    }) as typeof globalThis.fetch;

    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* ResourceLogStream.Provider;
          return yield* provider.reconcile(
            reconcileInput({
              resourceId: "srv-1",
              endpoint: "https://logs.example.com",
              setting: "send" as const,
              token: null,
            }),
          );
        }).pipe(
          Effect.provide(
            ResourceLogStreamProvider().pipe(Layer.provide(withApi(fetch))),
          ),
        ),
      ),
    ).rejects.toThrow("Render API returned 500");
    expect(methods).toEqual(["PUT"]);
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
      yield* provider.delete(deleteInput(olds, output));
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
        const listed = yield* provider.list();
        const discovered = yield* provider.read!(readInput(props));
        if (!discovered) throw new Error("expected service discovery");
        const reconciled = yield* provider.reconcile(
          reconcileInput(props, { ...discovered }),
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
        return yield* provider.list();
      }).pipe(
        Effect.provide(
          BackgroundWorkerProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(web.listed.map((item) => item.serviceId)).toEqual(["srv-web"]);
    expect(web.reconciled.serviceId).toBe("srv-web");
    expect(workers.map((item) => item.serviceId)).toEqual(["srv-worker"]);
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
        const listed = yield* provider.list();
        const discovered = yield* provider.read!(readInput(props));
        if (!discovered) throw new Error("expected environment discovery");
        const reconciled = yield* provider.reconcile(
          reconcileInput(props, { ...discovered }),
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
    const output = {
      id: "route-1",
      serviceId: "srv-1",
      source: olds.source,
      destination: olds.destination,
      type: olds.type,
    };
    const diff = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Route.Provider;
        return yield* provider.diff!(diffInput(olds, news, output));
      }).pipe(
        Effect.provide(
          RouteProvider().pipe(
            Layer.provide(
              withApi((async () => json({})) as typeof globalThis.fetch),
            ),
          ),
        ),
      ),
    );
    expect(diff).toEqual({ action: "replace" });
  });

  it("refreshes legacy route outputs before deciding whether to replace", async () => {
    let reads = 0;
    const props = {
      serviceId: "srv-1",
      source: "/api/*",
      destination: "/index.html",
      type: "rewrite" as const,
    };
    const legacyOutput = {
      id: "route-1",
      serviceId: "srv-1",
    } as RouteAttributes;
    const fetch = (async () => {
      reads++;
      return json([{ id: "route-1", priority: 0, ...props }]);
    }) as typeof globalThis.fetch;

    const diff = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Route.Provider;
        return yield* provider.diff!(
          diffInput(props, props, legacyOutput),
        );
      }).pipe(
        Effect.provide(
          RouteProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(diff).toBeUndefined();
    expect(reads).toBe(1);
  });

  it("updates route priority through Render's only route PATCH field", async () => {
    let patchBody: unknown;
    const route = {
      id: "route-1",
      serviceId: "srv-1",
      source: "/api/*",
      destination: "/index.html",
      type: "rewrite" as const,
      priority: 1,
    };
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "GET") return json([route]);
      patchBody = await request.json();
      return json({ ...route, priority: 2 });
    }) as typeof globalThis.fetch;
    const olds = {
      serviceId: "srv-1",
      source: route.source,
      destination: route.destination,
      type: route.type,
      priority: 1,
    };
    const news = { ...olds, priority: 2 };

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Route.Provider;
        const diff = yield* provider.diff!(diffInput(olds, news, route));
        const reconciled = yield* provider.reconcile({
          ...reconcileInput(news, route),
          olds,
        });
        return { diff, reconciled };
      }).pipe(
        Effect.provide(RouteProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );

    expect(result.diff).toEqual({ action: "update" });
    expect(patchBody).toEqual({ priority: 2 });
    expect(result.reconciled.priority).toBe(2);
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
        return yield* provider.diff!(diffInput(props, props, output));
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(
            Layer.provide(
              withApi((async () => json({})) as typeof globalThis.fetch),
            ),
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
        const discovered = yield* provider.read!(readInput(props));
        if (!discovered) throw new Error("expected variable discovery");
        return yield* provider.reconcile(
          reconcileInput(props, { ...discovered }),
        );
      }).pipe(
        Effect.provide(
          ServiceEnvVarProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(methods).toEqual(["GET", "GET"]);
    expect(result.generated).toBe(true);
  });

  it("does not let generated-value adoption shortcuts suppress a requested rotation", async () => {
    const requests: Array<{ method: string; body?: unknown }> = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({
        method: request.method,
        ...(request.method === "PUT" ? { body: await request.json() } : {}),
      });
      if (request.method === "GET") {
        return json({ key: "TOKEN", value: "old-value" });
      }
      if (request.method === "PUT") {
        return json({ key: "TOKEN", value: "new-generated-value" });
      }
      return json({ id: "dep-1", status: "created" }, 201);
    }) as typeof globalThis.fetch;
    const olds = {
      serviceId: "srv-1",
      key: "TOKEN",
      value: Redacted.make("old-value"),
    };
    const news = {
      serviceId: "srv-1",
      key: "TOKEN",
      generateValue: true as const,
    };

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* ServiceEnvVar.Provider;
        return yield* provider.reconcile({
          ...reconcileInput(news, {
            id: "TOKEN",
            name: "TOKEN",
            generated: false,
            valueDigest: "old-digest",
          }),
          olds,
        });
      }).pipe(
        Effect.provide(
          ServiceEnvVarProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(requests).toEqual([
      { method: "GET" },
      { method: "PUT", body: { generateValue: true } },
      { method: "POST" },
    ]);
    expect(result.generated).toBe(true);
    expect(result.valueDigest).toBeUndefined();
  });

  it("creates generated environment-group variables without persisting their value", async () => {
    let body: unknown;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      body = await request.json();
      return json({ key: "TOKEN", value: "generated-secret" });
    }) as typeof globalThis.fetch;
    const props = {
      environmentGroupId: "evg-1",
      key: "TOKEN",
      generateValue: true as const,
    };

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* EnvironmentGroupEnvVar.Provider;
        return yield* provider.reconcile(reconcileInput(props));
      }).pipe(
        Effect.provide(
          EnvironmentGroupEnvVarProvider().pipe(
            Layer.provide(withApi(fetch)),
          ),
        ),
      ),
    );

    expect(body).toEqual({ generateValue: true });
    expect(result.generated).toBe(true);
    expect(result.valueDigest).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("generated-secret");
  });

  it("normalizes omitted autoscaling criteria to Render's complete shape", async () => {
    let body: { criteria?: unknown } | undefined;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      body = (await new Request(input, init).json()) as { criteria?: unknown };
      return json({});
    }) as typeof globalThis.fetch;
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Autoscaling.Provider;
        return yield* provider.reconcile(
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
    expect(body?.criteria).toEqual({
      cpu: { enabled: true, percentage: 70 },
      memory: { enabled: false, percentage: 0 },
    });
    expect(result.criteria).toEqual(body?.criteria);
  });

  it("rejects invalid autoscaling bounds before issuing a request", async () => {
    let requests = 0;
    const fetch = (async () => {
      requests += 1;
      return json({});
    }) as typeof globalThis.fetch;

    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* Autoscaling.Provider;
          return yield* provider.reconcile(
            reconcileInput({
              serviceId: "srv-1",
              min: 4,
              max: 2,
              criteria: { cpu: { enabled: true, percentage: 70 } },
            }),
          );
        }).pipe(
          Effect.provide(
            AutoscalingProvider().pipe(Layer.provide(withApi(fetch))),
          ),
        ),
      ),
    ).rejects.toThrow("1 <= min <= max <= 100");
    expect(requests).toBe(0);
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
        return yield* provider.reconcile(
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
      "POST /v1/key-value",
      "GET /v1/key-value/kv-1",
      "GET /v1/key-value/kv-1/connection-info",
    ]);
    expect(
      Redacted.value(result.connectionInfo!.internalConnectionString!),
    ).toContain("secret");
  });

  it("preserves connection state without querying it while suspended", async () => {
    const paths: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      paths.push(new URL(request.url).pathname);
      return json({ id: "kv-1", name: "cache", status: "suspended" });
    }) as typeof globalThis.fetch;
    const connectionInfo = {
      internalConnectionString: Redacted.make("redis://secret@internal"),
    };
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* KeyValue.Provider;
        return yield* provider.read!({
          id: "Cache",
          fqn: "Cache",
          instanceId: "00112233445566778899aabbccddeeff",
          olds: {
            name: "cache",
            plan: "starter" as const,
            maxmemoryPolicy: "noeviction" as const,
          },
          output: {
            id: "kv-1",
            datastoreId: "kv-1",
            name: "cache",
            connectionInfo,
          },
        });
      }).pipe(
        Effect.provide(KeyValueProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );

    expect(paths).toEqual(["/v1/key-value/kv-1"]);
    expect(result?.connectionInfo).toBe(connectionInfo);
    expect(result?.status).toBe("suspended");
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
        return yield* provider.diff!(diffInput(props, props, output));
      }).pipe(
        Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    const changed = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Postgres.Provider;
        return yield* provider.diff!(
          diffInput(
            props,
            { ...props, datadogApiKey: Redacted.make("rotated") },
            output,
          ),
        );
      }).pipe(
        Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    let patchBody: Record<string, unknown> | undefined;
    const writingFetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/connection-info")) return json({});
      if (request.method === "PATCH") {
        patchBody = (await request.json()) as Record<string, unknown>;
      }
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
        return yield* provider.reconcile(input);
      }).pipe(
        Effect.provide(
          PostgresProvider().pipe(Layer.provide(withApi(writingFetch))),
        ),
      ),
    );
    expect(diff).toBeUndefined();
    expect(changed).toEqual({ action: "update" });
    expect(patchBody?.datadogAPIKey).toBe("rotated");
    expect(JSON.stringify(output)).not.toContain("datadog-secret");
  });

  it("stores a Workflow environment digest and replaces on value-only changes", async () => {
    let body: Record<string, unknown> | undefined;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "GET") return json([]);
      body = (await request.json()) as Record<string, unknown>;
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
      envVars: [
        { key: "TOKEN", value: Redacted.make("first") },
        { key: "GENERATED", generateValue: true as const },
      ],
    };
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Workflow.Provider;
        const created = yield* provider.reconcile(reconcileInput(props));
        const changed = yield* provider.diff!(
          diffInput(
            props,
            {
              ...props,
              envVars: [
                { key: "TOKEN", value: Redacted.make("second") },
                { key: "GENERATED", generateValue: true as const },
              ],
            },
            created,
          ),
        );
        return { created, changed };
      }).pipe(
        Effect.provide(WorkflowProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(body?.envVars).toEqual([
      { key: "TOKEN", value: "first" },
      { key: "GENERATED", generateValue: true },
    ]);
    expect(result.created.envVarsDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.created)).not.toContain("first");
    expect(result.changed).toEqual({ action: "replace" });
  });

  it("sends the required initial instance count for private services and workers", async () => {
    const bodies: Array<{ serviceDetails?: { numInstances?: number } }> = [];
    const fetchFor = (type: "private_service" | "background_worker") =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.method === "GET") return json([]);
        bodies.push(
          (await request.json()) as {
            serviceDetails?: { numInstances?: number };
          },
        );
        return json(
          {
            service: {
              id: type === "private_service" ? "srv-private" : "srv-worker",
              name: type === "private_service" ? "private" : "worker",
              type,
              serviceDetails: { runtime: "node" },
            },
          },
          201,
        );
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
        return yield* provider.reconcile(
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
        return yield* provider.reconcile(
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
    expect(bodies.map((body) => body.serviceDetails?.numInstances)).toEqual([
      1, 1,
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
        return yield* provider.diff!(
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
    const bodies: unknown[] = [];
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
      return json(
        request.method === "POST" ? { service } : service,
        request.method === "POST" ? 201 : 200,
      );
    }) as typeof globalThis.fetch;
    await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        return yield* provider.reconcile(
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
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(methods).toEqual(["POST", "PATCH", "POST"]);
    expect(bodies[1]).toEqual({
      serviceDetails: { cache: { profile: "origin-controlled" } },
    });
  });

  it("keeps the physical ID returned by custom-domain creation", async () => {
    const methods: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.method === "GET") return json({ message: "not found" }, 404);
      return json([{ id: "cd-1", name: "api.example.com" }], 201);
    }) as typeof globalThis.fetch;
    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* CustomDomain.Provider;
        return yield* provider.reconcile(
          reconcileInput({ serviceId: "srv-1", name: "api.example.com" }),
        );
      }).pipe(
        Effect.provide(
          CustomDomainProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(methods).toEqual(["POST"]);
    expect(result.id).toBe("cd-1");
  });

  it("deploys a service after creating or updating its disk", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    let disk = {
      id: "dsk-1",
      serviceId: "srv-1",
      name: "data",
      mountPath: "/data",
      sizeGB: 1,
    };
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push({ method: request.method, path });
      if (request.method === "GET" && path === "/v1/disks") return json([]);
      if (request.method === "GET") return json(disk);
      if (path.endsWith("/deploys")) {
        return json({ id: "dep-disk", status: "created" }, 201);
      }
      if (request.method === "POST") return json(disk, 201);
      if (request.method === "PATCH") {
        disk = { ...disk, ...JSON.parse(await request.text()) };
        return json(disk);
      }
      return json({}, 204);
    }) as typeof globalThis.fetch;
    const props = {
      serviceId: "srv-1",
      name: "data",
      mountPath: "/data",
      sizeGB: 1,
    };

    const created = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Disk.Provider;
        return yield* provider.reconcile(reconcileInput(props));
      }).pipe(
        Effect.provide(DiskProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(created.configurationDigest).toHaveLength(64);

    await runPromise(
      Effect.gen(function* () {
        const provider = yield* Disk.Provider;
        return yield* provider.reconcile(
          reconcileInput(props, created),
        );
      }).pipe(
        Effect.provide(DiskProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );

    const grown = { ...props, sizeGB: 2 };
    await runPromise(
      Effect.gen(function* () {
        const provider = yield* Disk.Provider;
        return yield* provider.reconcile(
          reconcileInput(grown, created),
        );
      }).pipe(
        Effect.provide(DiskProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );

    expect(requests.filter(({ path }) => path.endsWith("/deploys"))).toHaveLength(
      2,
    );
    expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
  });

  it("rejects disk shrinkage before sending a destructive PATCH", async () => {
    const methods: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      return json({
        id: "dsk-1",
        serviceId: "srv-1",
        name: "data",
        mountPath: "/data",
        sizeGB: 10,
      });
    }) as typeof globalThis.fetch;
    const props = {
      serviceId: "srv-1",
      name: "data",
      mountPath: "/data",
      sizeGB: 5,
    };
    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* Disk.Provider;
          return yield* provider.reconcile(
            reconcileInput(props, {
              id: "dsk-1",
              diskId: "dsk-1",
              serviceId: "srv-1",
              name: "data",
              mountPath: "/data",
              sizeGB: 10,
            }),
          );
        }).pipe(
          Effect.provide(DiskProvider().pipe(Layer.provide(withApi(fetch)))),
        ),
      ),
    ).rejects.toThrow("Render disks can only grow");
    expect(methods).toEqual(["GET"]);
  });

  it("clears a removed Postgres Datadog integration explicitly", async () => {
    let patchBody: Record<string, unknown> | undefined;
    const remote = {
      id: "dpg-1",
      name: "db",
      plan: "basic_1gb",
      version: "16",
      status: "available",
      highAvailabilityEnabled: false,
      diskAutoscalingEnabled: false,
      connectionPool: "none",
      ipAllowList: [],
      parameterOverrides: {},
      readReplicas: [],
    };
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "PATCH") {
        patchBody = JSON.parse(await request.text());
        return json(remote);
      }
      if (path.endsWith("/connection-info")) return json({});
      return json(remote);
    }) as typeof globalThis.fetch;
    const props = {
      name: "db",
      plan: "basic_1gb" as const,
      version: "16" as const,
    };

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Postgres.Provider;
        return yield* provider.reconcile(
          reconcileInput(props, {
            id: "dpg-1",
            datastoreId: "dpg-1",
            name: "db",
            datadogApiKeyDigest: "previous-digest",
            datadogSite: "US1",
          }),
        );
      }).pipe(
        Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );

    expect(patchBody).toMatchObject({ datadogAPIKey: "", datadogSite: "" });
    expect(result.datadogApiKeyDigest).toBeUndefined();
    expect(result.datadogSite).toBeUndefined();
  });

  it("rejects an explicit autoscaled Postgres shrink but tolerates autoscaling growth", async () => {
    const methods: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(new Request(input, init).method);
      return json({
        id: "dpg-1",
        name: "db",
        plan: "basic_1gb",
        version: "16",
        diskSizeGB: 15,
        diskAutoscalingEnabled: true,
        highAvailabilityEnabled: false,
        connectionPool: "none",
        ipAllowList: [],
        parameterOverrides: {},
        readReplicas: [],
        status: "available",
      });
    }) as typeof globalThis.fetch;
    const previous = {
      name: "db",
      plan: "basic_1gb" as const,
      version: "16" as const,
      diskSizeGB: 10,
      enableDiskAutoscaling: true,
    };
    const output = {
      id: "dpg-1",
      datastoreId: "dpg-1",
      name: "db",
      diskSizeGB: 10,
    };

    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* Postgres.Provider;
          return yield* provider.diff!(
            diffInput(previous, { ...previous, diskSizeGB: 5 }, output),
          );
        }).pipe(
          Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
        ),
      ),
    ).rejects.toThrow("Postgres storage can only grow");
    expect(methods).toEqual([]);

    const unchanged = await runPromise(
      Effect.gen(function* () {
        const provider = yield* Postgres.Provider;
        return yield* provider.diff!(diffInput(previous, previous, output));
      }).pipe(
        Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );
    expect(unchanged).toBeUndefined();
    expect(methods).toEqual(["GET"]);
  });

  it("rejects Postgres storage shrinkage before PATCH", async () => {
    const methods: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      return json({
        id: "dpg-1",
        name: "db",
        plan: "basic_1gb",
        version: "16",
        diskSizeGB: 10,
        status: "available",
      });
    }) as typeof globalThis.fetch;
    const props = {
      name: "db",
      plan: "basic_1gb" as const,
      version: "16" as const,
      diskSizeGB: 5,
    };
    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* Postgres.Provider;
          return yield* provider.reconcile(
            reconcileInput(props, {
              id: "dpg-1",
              datastoreId: "dpg-1",
              name: "db",
              diskSizeGB: 10,
            }),
          );
        }).pipe(
          Effect.provide(PostgresProvider().pipe(Layer.provide(withApi(fetch)))),
        ),
      ),
    ).rejects.toThrow("Postgres storage can only grow");
    expect(methods).toEqual(["GET"]);
  });

  it("recovers a verifiably accepted environment PUT and still deploys it", async () => {
    const requests: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (request.method === "GET") {
        return json({ key: "TOKEN", value: "secret" });
      }
      if (request.method === "PUT") {
        return json({ message: "indeterminate write" }, 500);
      }
      return json({ id: "dep-recovered", status: "created" }, 201);
    }) as typeof globalThis.fetch;
    const props = {
      serviceId: "srv-1",
      key: "TOKEN",
      value: Redacted.make("secret"),
    };

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* ServiceEnvVar.Provider;
        return yield* provider.reconcile(reconcileInput(props));
      }).pipe(
        Effect.provide(
          ServiceEnvVarProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(result.valueDigest).toHaveLength(64);
    expect(requests).toEqual([
      "PUT /v1/services/srv-1/env-vars/TOKEN",
      "GET /v1/services/srv-1/env-vars/TOKEN",
      "POST /v1/services/srv-1/deploys",
    ]);
  });

  it("deploys after standalone service environment writes and deletes", async () => {
    const requests: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (request.method === "GET") return json({ message: "not found" }, 404);
      if (path.endsWith("/deploys")) return new Response(null, { status: 202 });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      return json({ key: "TOKEN" });
    }) as typeof globalThis.fetch;
    const props = {
      serviceId: "srv-1",
      key: "TOKEN",
      value: Redacted.make("secret"),
    };
    const output = await runPromise(
      Effect.gen(function* () {
        const provider = yield* ServiceEnvVar.Provider;
        return yield* provider.reconcile(reconcileInput(props));
      }).pipe(
        Effect.provide(
          ServiceEnvVarProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    await runPromise(
      Effect.gen(function* () {
        const provider = yield* ServiceEnvVar.Provider;
        yield* provider.delete(deleteInput(props, output));
      }).pipe(
        Effect.provide(
          ServiceEnvVarProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    expect(requests).toEqual([
      "PUT /v1/services/srv-1/env-vars/TOKEN",
      "POST /v1/services/srv-1/deploys",
      "DELETE /v1/services/srv-1/env-vars/TOKEN",
      "POST /v1/services/srv-1/deploys",
    ]);
  });

  it("does not turn a rejected create into an unrelated PATCH", async () => {
    const methods: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.method === "GET") return json([]);
      return json({ message: "invalid" }, 400);
    }) as typeof globalThis.fetch;
    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* Project.Provider;
          return yield* provider.reconcile(reconcileInput({ name: "app" }));
        }).pipe(
          Effect.provide(ProjectProvider().pipe(Layer.provide(withApi(fetch)))),
        ),
      ),
    ).rejects.toThrow("Render API returned 400");
    expect(methods).toEqual(["POST"]);
  });

  it("surfaces an indeterminate POST create without claiming a same-name object", async () => {
    const methods: string[] = [];
    let created = false;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.method === "POST") {
        created = true;
        throw new Error("connection closed after accept");
      }
      return created
        ? json([{ project: { id: "prj-1", name: "app" } }])
        : json([]);
    }) as typeof globalThis.fetch;
    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* Project.Provider;
          return yield* provider.reconcile(reconcileInput({ name: "app" }));
        }).pipe(
          Effect.provide(ProjectProvider().pipe(Layer.provide(withApi(fetch)))),
        ),
      ),
    ).rejects.toThrow("Render API request failed");
    expect(methods).toEqual(["POST"]);
  });

  it("never rebinds a missing owned ID to an unrelated same-name resource", async () => {
    const requests: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (request.method === "GET" && path.endsWith("/prj-owned")) {
        return json({ message: "missing" }, 404);
      }
      if (request.method === "GET") {
        return json([{ project: { id: "prj-foreign", name: "app" } }]);
      }
      if (request.method === "POST") {
        return json({ message: "name already exists" }, 409);
      }
      return json({ id: "prj-foreign", name: "app" });
    }) as typeof globalThis.fetch;

    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* Project.Provider;
          return yield* provider.reconcile(
            reconcileInput(
              { name: "app" },
              {
                id: "prj-owned",
                projectId: "prj-owned",
                name: "app",
                environmentIds: [],
              },
            ),
          );
        }).pipe(
          Effect.provide(ProjectProvider().pipe(Layer.provide(withApi(fetch)))),
        ),
      ),
    ).rejects.toThrow("Render API returned 409");
    expect(requests).toEqual([
      "GET /v1/projects/prj-owned",
      "POST /v1/projects",
    ]);
  });

  it("uses only endpoint-supported filters and strict IDs for header and route reads", async () => {
    const urls: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      urls.push(url.href);
      return url.pathname.endsWith("/headers")
        ? json([
            {
              header: {
                id: "hdr-foreign",
                name: "X-Frame-Options",
                path: "/*",
                value: "SAMEORIGIN",
              },
            },
          ])
        : json([
            {
              route: {
                id: "rte-1",
                type: "rewrite",
                source: "/api/*",
                destination: "/old.html",
              },
            },
          ]);
    }) as typeof globalThis.fetch;
    const headerProps = {
      serviceId: "srv-1",
      name: "X-Frame-Options",
      path: "/*",
      value: "DENY",
    };
    const routeProps = {
      serviceId: "srv-1",
      type: "rewrite" as const,
      source: "/api/*",
      destination: "/index.html",
    };

    const result = await runPromise(
      Effect.gen(function* () {
        const header = yield* Header.Provider;
        const coldHeader = yield* header.read!(readInput(headerProps));
        const missingOwnedHeader = yield* header.read!(
          readInput(headerProps, {
            id: "hdr-owned",
            serviceId: "srv-1",
            name: "X-Frame-Options",
          }),
        );
        const route = yield* Route.Provider;
        const coldRoute = yield* route.read!(readInput(routeProps));
        const missingOwnedRoute = yield* route.read!(
          readInput(routeProps, {
            id: "rte-owned",
            serviceId: "srv-1",
            source: routeProps.source,
            destination: routeProps.destination,
            type: routeProps.type,
          }),
        );
        return {
          coldHeader,
          missingOwnedHeader,
          coldRoute,
          missingOwnedRoute,
        };
      }).pipe(
        Effect.provide(
          Layer.mergeAll(HeaderProvider(), RouteProvider()).pipe(
            Layer.provide(withApi(fetch)),
          ),
        ),
      ),
    );

    expect(result.coldHeader?.id).toBe("hdr-foreign");
    expect(result.missingOwnedHeader).toBeUndefined();
    expect(result.coldRoute?.id).toBe("rte-1");
    expect(result.missingOwnedRoute).toBeUndefined();
    const headerQuery = new URL(urls[0]!).searchParams;
    expect(headerQuery.get("name")).toBe("X-Frame-Options");
    expect(headerQuery.get("path")).toBe("/*");
    expect(headerQuery.has("value")).toBe(false);
    expect(headerQuery.has("ownerId")).toBe(false);
    const strictHeaderQuery = new URL(urls[1]!).searchParams;
    expect(strictHeaderQuery.has("name")).toBe(false);
    expect(strictHeaderQuery.has("path")).toBe(false);
    expect(strictHeaderQuery.has("value")).toBe(false);
    const routeQuery = new URL(urls[2]!).searchParams;
    expect(routeQuery.get("type")).toBe("rewrite");
    expect(routeQuery.get("source")).toBe("/api/*");
    expect(routeQuery.has("destination")).toBe(false);
    expect(routeQuery.has("ownerId")).toBe(false);
    expect(routeQuery.has("name")).toBe(false);
    const strictRouteQuery = new URL(urls[3]!).searchParams;
    expect(strictRouteQuery.has("type")).toBe(false);
    expect(strictRouteQuery.has("source")).toBe(false);
    expect(strictRouteQuery.has("destination")).toBe(false);
  });

  it("hashes remotely readable secret drift without persisting plaintext", async () => {
    const remoteValue = "rotated-out-of-band";
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(new Request(input, init).url).pathname;
      return path.includes("secret-files")
        ? json({ name: "SECRET", content: remoteValue })
        : json({ key: "TOKEN", value: remoteValue });
    }) as typeof globalThis.fetch;
    const serviceEnvProps = {
      serviceId: "srv-1",
      key: "TOKEN",
      value: Redacted.make("desired"),
    };
    const serviceFileProps = {
      serviceId: "srv-1",
      name: "SECRET",
      content: Redacted.make("desired"),
    };
    const groupEnvProps = {
      environmentGroupId: "evg-1",
      key: "TOKEN",
      value: Redacted.make("desired"),
    };
    const groupFileProps = {
      environmentGroupId: "evg-1",
      name: "SECRET",
      content: Redacted.make("desired"),
    };

    const serviceEnv = await runPromise(
      Effect.gen(function* () {
        const provider = yield* ServiceEnvVar.Provider;
        const observed = yield* provider.read!(
          readInput(serviceEnvProps, {
            id: "TOKEN",
            name: "TOKEN",
            generated: false,
            valueDigest: "stale",
          }),
        );
        if (!observed) throw new Error("expected service env var");
        const diff = yield* provider.diff!(
          diffInput(serviceEnvProps, serviceEnvProps, observed),
        );
        return { observed, diff };
      }).pipe(
        Effect.provide(
          ServiceEnvVarProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    const serviceFile = await runPromise(
      Effect.gen(function* () {
        const provider = yield* ServiceSecretFile.Provider;
        const observed = yield* provider.read!(
          readInput(serviceFileProps, {
            id: "SECRET",
            name: "SECRET",
            generated: false,
            valueDigest: "stale",
          }),
        );
        if (!observed) throw new Error("expected service secret file");
        const diff = yield* provider.diff!(
          diffInput(serviceFileProps, serviceFileProps, observed),
        );
        return { observed, diff };
      }).pipe(
        Effect.provide(
          ServiceSecretFileProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );
    const groupEnv = await runPromise(
      Effect.gen(function* () {
        const provider = yield* EnvironmentGroupEnvVar.Provider;
        const observed = yield* provider.read!(
          readInput(groupEnvProps, {
            id: "TOKEN",
            name: "TOKEN",
            valueDigest: "stale",
          }),
        );
        if (!observed) throw new Error("expected group env var");
        const diff = yield* provider.diff!(
          diffInput(groupEnvProps, groupEnvProps, observed),
        );
        return { observed, diff };
      }).pipe(
        Effect.provide(
          EnvironmentGroupEnvVarProvider().pipe(
            Layer.provide(withApi(fetch)),
          ),
        ),
      ),
    );
    const groupFile = await runPromise(
      Effect.gen(function* () {
        const provider = yield* EnvironmentGroupSecretFile.Provider;
        const observed = yield* provider.read!(
          readInput(groupFileProps, {
            id: "SECRET",
            name: "SECRET",
            valueDigest: "stale",
          }),
        );
        if (!observed) throw new Error("expected group secret file");
        const diff = yield* provider.diff!(
          diffInput(groupFileProps, groupFileProps, observed),
        );
        return { observed, diff };
      }).pipe(
        Effect.provide(
          EnvironmentGroupSecretFileProvider().pipe(
            Layer.provide(withApi(fetch)),
          ),
        ),
      ),
    );

    for (const result of [serviceEnv, serviceFile, groupEnv, groupFile]) {
      expect(result.observed.valueDigest).toHaveLength(64);
      expect(result.diff).toEqual({ action: "update" });
      expect(JSON.stringify(result.observed)).not.toContain(remoteValue);
    }
  });

  it("uses Render's cron-specific Docker details for Docker and image creates", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let sequence = 0;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      sequence += 1;
      return json(
        {
          service: {
            id: `crn-${sequence}`,
            name: `cron-${sequence}`,
            ownerId: "tea-test",
            type: "cron_job",
            serviceDetails: body.serviceDetails,
          },
          deployId: `dep-${sequence}`,
        },
        201,
      );
    }) as typeof globalThis.fetch;

    await runPromise(
      Effect.gen(function* () {
        const provider = yield* CronJob.Provider;
        yield* provider.reconcile(
          reconcileInput({
            name: "docker-cron",
            runtime: "docker" as const,
            repo: "https://github.com/acme/jobs",
            registryCredentialId: "rgc-1",
            schedule: "0 * * * *",
          }),
        );
        yield* provider.reconcile(
          reconcileInput({
            name: "image-cron",
            runtime: "image" as const,
            image: { imagePath: "docker.io/acme/job:1" },
            dockerCommand: "bun run cron",
            schedule: "30 * * * *",
          }),
        );
      }).pipe(
        Effect.provide(CronJobProvider().pipe(Layer.provide(withApi(fetch)))),
      ),
    );

    expect(bodies[0]).toMatchObject({
      serviceDetails: {
        runtime: "docker",
        envSpecificDetails: {
          dockerCommand: "",
          dockerContext: "",
          dockerfilePath: "",
          registryCredential: { id: "rgc-1" },
        },
      },
    });
    expect(bodies[0]).not.toHaveProperty(
      "serviceDetails.envSpecificDetails.registryCredentialId",
    );
    expect(bodies[1]).toMatchObject({
      image: {
        ownerId: "tea-test",
        imagePath: "docker.io/acme/job:1",
      },
      serviceDetails: {
        runtime: "image",
        envSpecificDetails: {
          dockerCommand: "bun run cron",
          dockerContext: "",
          dockerfilePath: "",
        },
      },
    });
  });

  it("releases an omitted service branch without a false PATCH or deploy", async () => {
    const methods: string[] = [];
    const service = {
      id: "srv-1",
      name: "api",
      ownerId: "tea-test",
      type: "web_service",
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
    };
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      methods.push(`${request.method} ${path}`);
      if (request.method === "GET") return json(service);
      if (request.method === "POST" && path.endsWith("/services")) {
        return json({ service, deployId: "dep-create" }, 201);
      }
      return json({ message: "unexpected write" }, 500);
    }) as typeof globalThis.fetch;
    const olds = {
      name: "api",
      repo: "https://github.com/acme/app",
      branch: "main",
      runtime: "node" as const,
      buildCommand: "bun install",
      startCommand: "bun start",
      plan: "starter" as const,
    };
    const news = {
      name: "api",
      repo: "https://github.com/acme/app",
      runtime: "node" as const,
      buildCommand: "bun install",
      startCommand: "bun start",
      plan: "starter" as const,
    };

    const result = await runPromise(
      Effect.gen(function* () {
        const provider = yield* WebService.Provider;
        const created = yield* provider.reconcile(reconcileInput(olds));
        methods.length = 0;
        const reconciled = yield* provider.reconcile({
          ...reconcileInput(news, created),
          olds,
        });
        return { created, reconciled };
      }).pipe(
        Effect.provide(
          WebServiceProvider().pipe(Layer.provide(withApi(fetch))),
        ),
      ),
    );

    expect(methods).toEqual(["GET /v1/services/srv-1"]);
    expect(result.reconciled.coreDigest).not.toBe(result.created.coreDigest);
  });

  it("rejects ambiguous cold lookups instead of adopting the first match", async () => {
    const fetch = (async () =>
      json([
        { project: { id: "prj-1", name: "app" } },
        { project: { id: "prj-2", name: "app" } },
      ])) as typeof globalThis.fetch;
    await expect(
      runPromise(
        Effect.gen(function* () {
          const provider = yield* Project.Provider;
          return yield* provider.read!(
            readInput<{ name: string }, never>({ name: "app" }),
          );
        }).pipe(
          Effect.provide(ProjectProvider().pipe(Layer.provide(withApi(fetch)))),
        ),
      ),
    ).rejects.toThrow("Render lookup matched multiple resources");
  });
});
