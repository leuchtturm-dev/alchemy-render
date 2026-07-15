import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Render from "alchemy-render";

/** Add `Render.providers()` to your Alchemy stack's provider layer. */
export const renderProviders = Render.providers();

/** A service and a separately owned child configuration resource. */
export const basic = Effect.gen(function* () {
  const service = yield* Render.WebService("api", {
    repo: "https://github.com/acme/example",
    branch: "main",
    runtime: "node",
    plan: "starter",
    buildCommand: "bun install",
    startCommand: "bun run start",
  });

  yield* Render.ServiceEnvVar("api-token", {
    serviceId: service.serviceId,
    key: "API_TOKEN",
    value: Redacted.make("replace-me"),
  });
});
