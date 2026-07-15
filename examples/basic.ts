import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Render from "alchemy-render";

export const renderProviders = Render.providers();

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
