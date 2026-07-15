import { describe, expect, it } from "vitest";
import { Stack, type StackSpec } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import {
  Deploy,
  RecoverPostgres,
  RestoreDiskSnapshot,
  RunTask,
  type DeployProps,
} from "../src/Actions.js";
import { layer as apiLayer } from "../src/Api/Api.js";
import { fromApiKey } from "../src/Credentials.js";

const runPromise = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect as Effect.Effect<A, E>);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const withApiAt = (
  fetch: typeof globalThis.fetch,
  ownerId: string,
  apiBaseUrl: string,
) =>
  apiLayer({ fetch, disableRateLimit: true }).pipe(
    Layer.provide(
      fromApiKey({ apiKey: "test-key", ownerId, apiBaseUrl }),
    ),
  );

const withApi = (fetch: typeof globalThis.fetch) =>
  withApiAt(fetch, "tea-test", "https://render.invalid/v1");

describe("at-least-once Actions", () => {
  it("resolves credentials per execution instead of caching the first stack", async () => {
    const urls: string[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(new Request(input, init).url);
      return json({ id: "dep-1", status: "created" }, 201);
    }) as typeof globalThis.fetch;

    const run = (suffix: string) => {
      const stack: Omit<StackSpec, "output"> = {
        name: `test-${suffix}`,
        stage: "test",
        resources: {},
        bindings: {},
        actions: {},
      };
      const input = { serviceId: "srv-1" };
      return runPromise(
        Effect.gen(function* () {
          yield* Deploy(`deploy-${suffix}`, input);
          return yield* stack.actions[`deploy-${suffix}`]!.Run(input);
        }).pipe(
          Effect.provideService(Stack, stack),
          Effect.provide(
            withApiAt(
              fetch,
              `tea-${suffix}`,
              `https://${suffix}.render.invalid/v1`,
            ),
          ),
        ),
      );
    };

    await run("one");
    await run("two");
    expect(urls).toEqual([
      "https://one.render.invalid/v1/services/srv-1/deploys",
      "https://two.render.invalid/v1/services/srv-1/deploys",
    ]);
  });

  it("uses the documented Postgres recovery path and secret field casing", async () => {
    let request: Request | undefined;
    let body: unknown;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      body = await request.json();
      return json({ id: "dpg-recovered", status: "creating" });
    }) as typeof globalThis.fetch;
    const input = {
      postgresId: "dpg-source",
      restoreTime: "2026-07-15T09:00:00Z",
      restoreName: "recovered",
      datadogApiKey: Redacted.make("datadog-secret"),
      datadogSite: "datadoghq.com",
    };
    const stack: Omit<StackSpec, "output"> = {
      name: "test",
      stage: "test",
      resources: {},
      bindings: {},
      actions: {},
    };

    const result = await runPromise(
      Effect.gen(function* () {
        yield* RecoverPostgres("recover-db", input);
        const action = stack.actions["recover-db"]!;
        return yield* action.Run(input);
      }).pipe(
        Effect.provideService(Stack, stack),
        Effect.provide(withApi(fetch)),
      ),
    );

    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(
      "https://render.invalid/v1/postgres/dpg-source/recovery",
    );
    expect(body).toEqual({
      restoreTime: "2026-07-15T09:00:00Z",
      restoreName: "recovered",
      datadogApiKey: "datadog-secret",
      datadogSite: "datadoghq.com",
    });
    expect(result).toEqual({
      accepted: true,
      id: "dpg-recovered",
      status: "creating",
    });
  });

  it("redacts persisted task input while revealing it only to Render", async () => {
    let body: unknown;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      body = await new Request(input, init).json();
      return json({ id: "trn-1", status: "pending" }, 202);
    }) as typeof globalThis.fetch;
    const input = {
      task: "workflow/send-email",
      input: Redacted.make({ recipient: "secret@example.com" }),
    };
    const stack: Omit<StackSpec, "output"> = {
      name: "test",
      stage: "test",
      resources: {},
      bindings: {},
      actions: {},
    };
    await runPromise(
      Effect.gen(function* () {
        yield* RunTask("run-task", input);
        const action = stack.actions["run-task"]!;
        expect(JSON.stringify(action.Input)).not.toContain(
          "secret@example.com",
        );
        return yield* action.Run(input);
      }).pipe(
        Effect.provideService(Stack, stack),
        Effect.provide(withApi(fetch)),
      ),
    );
    expect(body).toEqual({
      task: "workflow/send-email",
      input: { recipient: "secret@example.com" },
    });
  });

  it("rejects deployMode combined with a commit, image, or cache selector", async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return json({});
    }) as typeof globalThis.fetch;
    const input = {
      serviceId: "srv-1",
      deployMode: "deploy_only",
      clearCache: "clear",
    } as unknown as DeployProps;
    const stack: Omit<StackSpec, "output"> = {
      name: "test",
      stage: "test",
      resources: {},
      bindings: {},
      actions: {},
    };
    await expect(
      runPromise(
        Effect.gen(function* () {
          yield* Deploy("invalid-deploy", input);
          return yield* stack.actions["invalid-deploy"]!.Run(input);
        }).pipe(
          Effect.provideService(Stack, stack),
          Effect.provide(withApi(fetch)),
        ),
      ),
    ).rejects.toThrow("deployMode cannot be combined");
    expect(calls).toBe(0);
  });

  it("passes the optional disk instance selector to snapshot restore", async () => {
    let body: unknown;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      body = await new Request(input, init).json();
      return json({ id: "dsk-1" });
    }) as typeof globalThis.fetch;
    const input = {
      diskId: "dsk-1",
      snapshotKey: "2026-07-15T12:00:00Z",
      instanceId: "srv-1-abc",
    };
    const stack: Omit<StackSpec, "output"> = {
      name: "test",
      stage: "test",
      resources: {},
      bindings: {},
      actions: {},
    };
    await runPromise(
      Effect.gen(function* () {
        yield* RestoreDiskSnapshot("restore-disk", input);
        return yield* stack.actions["restore-disk"]!.Run(input);
      }).pipe(
        Effect.provideService(Stack, stack),
        Effect.provide(withApi(fetch)),
      ),
    );
    expect(body).toEqual({
      snapshotKey: "2026-07-15T12:00:00Z",
      instanceId: "srv-1-abc",
    });
  });
});
