import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Render from "../src/index.js";

/** Compile-time coverage for stack-level provider satisfaction and Inputs. */
export const compileTimeRenderStack = Alchemy.Stack(
  "render-provider-integration",
  {
    providers: Render.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const privateService = yield* Render.PrivateService("Private", {
      name: "private",
      runtime: "image",
      image: { imagePath: "docker.io/acme/private:1" },
      region: "frankfurt",
      plan: "standard",
      numInstances: 1,
      env: { TOKEN: Redacted.make("secret") },
    });

    const webService = yield* Render.WebService("Web", {
      name: "web",
      runtime: "image",
      image: { imagePath: "docker.io/acme/web:1" },
      region: "frankfurt",
      plan: "pro",
      numInstances: 2,
      env: {
        PRIVATE_URL: privateService.url.pipe(
          Output.map((url) => Redacted.make(`ws://${url ?? "private"}`)),
        ),
      },
    });

    yield* Render.CustomDomain("Domain", {
      serviceId: webService.serviceId,
      name: "example.com",
    });

    return { privateUrl: privateService.url, publicUrl: webService.url };
  }),
);

/** Compile-time coverage for an existing imperative Action. */
export const compileTimeRenderActionStack = Alchemy.Stack(
  "render-action-provider-integration",
  {
    providers: Render.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    return yield* Render.Actions.Deploy("ManualDeploy", {
      serviceId: "srv-example",
      clearCache: "do_not_clear",
    });
  }),
);
