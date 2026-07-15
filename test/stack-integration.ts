import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Render from "../src/index.js";

const compileTimeInvalidInputs = () => {
  // @ts-expect-error Native services require both build and start commands.
  const invalidNative: Render.WebServiceProps = {
    runtime: "node",
    repo: "https://github.com/acme/app",
  };
  // @ts-expect-error Image-backed services cannot also declare a repository.
  const invalidImage: Render.WebServiceProps = {
    runtime: "image",
    image: { imagePath: "docker.io/acme/app:1" },
    repo: "https://github.com/acme/app",
  };
  // @ts-expect-error Docker cron jobs require a repository.
  const invalidDockerCron: Render.CronJobProps = {
    runtime: "docker",
    schedule: "0 * * * *",
  };
  // @ts-expect-error Render forbids deployMode with commit/cache/image selectors.
  const invalidDeploy: Render.DeployProps = {
    serviceId: "srv-example",
    deployMode: "deploy_only",
    commitId: "abc123",
  };
  return { invalidNative, invalidImage, invalidDockerCron, invalidDeploy };
};
void compileTimeInvalidInputs;

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

    yield* Render.BackgroundWorker("Worker", {
      name: "worker",
      runtime: "image",
      image: { imagePath: "docker.io/acme/worker:1" },
      region: "frankfurt",
      plan: "standard",
      numInstances: 1,
      env: { QUEUE: Redacted.make("default") },
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

    yield* Render.CronJob("Cron", {
      name: "cron",
      runtime: "node",
      repo: "https://github.com/acme/app",
      buildCommand: "bun install",
      startCommand: "bun run cron",
      schedule: "0 * * * *",
      env: { TOKEN: Redacted.make("secret") },
    });

    yield* Render.StaticSite("Docs", {
      name: "docs",
      repo: "https://github.com/acme/app",
      branch: "main",
      buildCommand: "bun run build",
      env: { DOCS_ENV: Redacted.make("production") },
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
