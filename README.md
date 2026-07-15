# alchemy-render

An Effect-native [Alchemy v2](https://v2.alchemy.run/) provider for [Render](https://render.com/). It follows Alchemy's first-party provider model: typed `Resource` declarations, idempotent reconcilers, an Effect `ProviderCollection`, profile-aware lazy credentials, and a generated typed API escape hatch.

> Alchemy v2 is currently beta. This release is tested with `alchemy@2.0.0-beta.62` and `effect@4.0.0-beta.97`.

```sh
bun add alchemy-render alchemy@2.0.0-beta.62 effect@4.0.0-beta.97
```

## Quick start

```ts
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Render from "alchemy-render";

export default Alchemy.Stack(
  "my-app",
  {
    providers: Render.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const api = yield* Render.WebService("Api", {
      repo: "https://github.com/acme/my-app",
      branch: "main",
      runtime: "node",
      buildCommand: "bun install",
      startCommand: "bun run start",
      plan: "starter",
      region: "oregon",
      waitForDeploy: true,
    });

    yield* Render.ServiceEnvVar("ApiToken", {
      serviceId: api.serviceId,
      key: "API_TOKEN",
      value: Redacted.make("replace-me"),
    });

    return { url: api.url };
  }),
);
```

To combine providers, merge their layers exactly as you would for Alchemy's built-ins:

```ts
import * as Layer from "effect/Layer";
import * as AWS from "alchemy/AWS";
import * as Cloudflare from "alchemy/Cloudflare";

providers: Layer.mergeAll(
  AWS.providers(),
  Cloudflare.providers(),
  Render.providers(),
),
```

## Authentication

Run `alchemy login` and select Render. The provider supports:

- **Environment variables:** `RENDER_API_KEY` and `RENDER_OWNER_ID`
- **Stored credentials:** an interactively entered API key and owner/workspace ID, stored under Alchemy's credential store

Set `RENDER_HOST` to override the exact API root (including `/v1`) for a proxy or test server. The default is `https://api.render.com/v1`. CI automatically selects the environment-variable method.

Credentials are represented by a lazy Effect and are not resolved merely by importing a stack. API keys are wrapped in `Redacted` and are unwrapped only while constructing the Authorization header.

For tests or embedding, `Render.fromApiKey({ apiKey, ownerId, apiBaseUrl? })` provides an explicit credentials Layer.

## Ownership and adoption

Service Resources own only the core service object. Independently addressable configuration is deliberately managed by standalone Resources:

- environment variables and secret files
- custom domains and disks
- static-site headers and routes
- autoscaling
- environment and environment-group links
- log and notification overrides

Do not let two stacks—or a Resource and another tool—authoritatively manage the same child object. This avoids destructive replace-all conflicts present in aggregate configuration models. Header and route field changes replace the rule because headers have no item-update endpoint and route PATCH only changes priority. Workflow environment variables are create-only in the API, so adding, removing, or rotating one replaces the Workflow.

On a cold read, name-addressable Render objects are returned as `Unowned`. Deploy with Alchemy's `--adopt` flow only after confirming the matching object is safe to take over. Reads by a previously persisted physical ID remain owned. Resources that cannot be enumerated without a parent are explicitly excluded from `alchemy unsafe nuke`; ordinary stack deletion still removes them.

## Secrets and state

Secret inputs use `Redacted<string>`. Write-only values such as registry tokens, stream tokens, env vars, and secret-file contents are never copied into Attributes; state stores a SHA-256 equality digest instead. Database connection values and webhook signing secrets are returned as `Redacted` outputs.

A digest is not encryption, and resource state still contains infrastructure metadata. Protect state and credential files accordingly. API errors retain only numeric status and a server request ID; response bodies and status text are discarded because they can echo secret input.

## Service deploy behavior

Creating a Render service already initiates a deploy. Set `waitForDeploy: true` to poll the concrete deploy ID until it reaches `live`; `deployTimeoutMs` defaults to three hours. Core service reconciliation sends a PATCH only when the observed core configuration differs.

The provider does **not** trigger an additional deploy after updates. Use the explicit `Deploy` Action when you need a manual deploy, commit-specific deploy, or cache-clearing deploy. Because Render's create contract does not accept web-cache settings, a requested `cache` profile is applied with one immediate PATCH after creation.

## Actions are at-least-once

Alchemy Actions have no Resource-style read recovery. If a process stops after Render accepts an Action but before Alchemy persists its result, a later apply can run it again. Deploys, jobs, previews, restores, recoveries, credential rotations, exports, workflow versions, and task runs can therefore be duplicated.

The transport never retries unsafe POST/PATCH requests after network or 5xx failures, but process-level replay remains possible. Use stable logical IDs, inspect Render before forcing an Action, and treat every Action as replayable.

## Capability matrix

| Area | Managed Resources |
|---|---|
| Services | `WebService`, `PrivateService`, `BackgroundWorker`, `CronJob`, `StaticSite` |
| Service configuration | `ServiceEnvVar`, `ServiceSecretFile`, `CustomDomain`, `Disk`, `Header`, `Route`, `Autoscaling`, `ServiceNotificationOverride`, `ResourceLogStream` |
| Datastores | `Postgres`, `KeyValue`, deprecated `Redis` |
| Projects | `Project`, `Environment`, `EnvironmentResource` |
| Environment groups | `EnvironmentGroup`, `EnvironmentGroupLink`, `EnvironmentGroupEnvVar`, `EnvironmentGroupSecretFile` |
| Workspace/account | `DedicatedIp`, `RegistryCredential`, `Webhook`, `OwnerLogStream`, `MetricsStream` |
| Workflows | `Workflow` |

| Area | At-least-once Actions |
|---|---|
| Deploys | `Deploy`, `CancelDeploy`, `Rollback` |
| Services | `PurgeCache`, `SuspendService`, `ResumeService`, `RestartService`, `ScaleService`, `PreviewService`, `VerifyCustomDomain` |
| Jobs | `RunJob`, `CancelJob`, `RunCronJob`, `CancelCronJobRun` |
| Disks | `RestoreDiskSnapshot` |
| Postgres | `SuspendPostgres`, `ResumePostgres`, `RestartPostgres`, `FailoverPostgres`, `RecoverPostgres`, `ExportPostgres`, `RotatePostgresCredentials`, `DeletePostgresUser` |
| Key Value / Redis | `SuspendKeyValue`, `ResumeKeyValue`, deprecated `SuspendRedis`, `ResumeRedis` |
| Maintenance | `TriggerMaintenance`, `UpdateMaintenanceSchedule` |
| Workflows and tasks | `CreateWorkflowVersion`, `RunTask`, `CancelTaskRun` |

The generated client under `Render.Api` covers the complete published OpenAPI document, including read/query endpoints for owners, members, audit logs, deploy history, events, logs, metrics, snapshots, instances, Postgres diagnostics, webhook deliveries, workflow versions, tasks, and task runs.

Some API concepts intentionally are not Resources:

- **Blueprints:** Render exposes validate/read/update/disconnect, but no create/connect endpoint.
- **Workflow versions and task runs:** ephemeral or append-only; use Actions/the typed API.
- **Postgres credential rotation:** Render creates a new default user, so the endpoint does not provide a truthful reversible Resource lifecycle; use the explicit credential Actions or typed API deliberately.
- **Owner notification settings:** always exist and Render does not define a truthful delete/reset operation. Service-level overrides are managed because delete can reset both fields to `default`.
- **Read-only observability and account data:** available through the typed API, not fake lifecycle Resources.

`Redis` exists for migration and Terraform parity only. Use `KeyValue` for new stacks. Disk size is required and can only be increased by Render; a shrink request fails rather than replacing and destroying the disk. Set a stream `token` to `null` to explicitly clear it; omitting it leaves an unknown existing token unmanaged.

## Typed API escape hatch

`Render.Api.RenderApi` exposes both the generated `openapi-fetch` client and the provider's small Effect request client:

```ts
const owners = yield* Effect.gen(function* () {
  const getApi = yield* Render.Api.RenderApi;
  const api = yield* getApi;
  return yield* Render.Api.call(() => api.client.GET("/owners"));
});
```

The generated schema is internal to transport typing; curated Resource props and Attributes remain the stable public IaC contract.

## OpenAPI generation

`src/Api/schema.ts` is checked in. Normal install, typecheck, test, build, and prepack never access the network.

```sh
npm run generate:api  # explicitly fetch and regenerate from Render's spec
npm run check:api     # offline declaration checksum check
```

Generation records the source URL, source SHA-256, and declaration SHA-256 without a timestamp so identical input is deterministic. The offline check verifies the checked-in header and declaration integrity; only explicit regeneration verifies the source checksum against the live Render document. Render explicitly warns that the structure of its OpenAPI document can change even while the wire API remains backward compatible; review generated diffs before committing them.

## Validation and acceptance tests

```sh
bun run typecheck
bun test
bun run build
npm pack --dry-run
```

The default suite uses mocked HTTP and creates no billable infrastructure. Real-account acceptance testing should use a disposable Render workspace and is intentionally opt-in. Validate create/update/adopt/delete behavior and clean up through both Alchemy and the Render dashboard.

## License

Apache-2.0.
