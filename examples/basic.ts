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
    numInstances: 2,
    env: {
      API_TOKEN: Redacted.make("replace-me"),
    },
  });

  return { url: service.url };
});
