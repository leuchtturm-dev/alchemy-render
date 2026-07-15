import { describe, expect, it } from "vitest";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { RecoverPostgres, RunTask } from "../src/Actions.js";
import { layer as apiLayer } from "../src/Api/Api.js";
import { fromApiKey } from "../src/Credentials.js";

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

describe("at-least-once Actions", () => {
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
    const stack = { resources: {}, actions: {} } as any;

    const result = await runPromise(
      Effect.gen(function* () {
        yield* RecoverPostgres("recover-db", input);
        const action = stack.actions["recover-db"];
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
    const stack = { resources: {}, actions: {} } as any;
    await runPromise(
      Effect.gen(function* () {
        yield* RunTask("run-task", input);
        expect(JSON.stringify(stack.actions["run-task"].Input)).not.toContain(
          "secret@example.com",
        );
        return yield* stack.actions["run-task"].Run(input);
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
});
