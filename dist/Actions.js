import * as Action from "alchemy/Action";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { RenderApi, RenderApiError } from "./Api/Api.js";
const encode = encodeURIComponent;
const result = (value) => {
    if (typeof value !== "object" || value === null)
        return { accepted: true };
    const row = value;
    const nested = typeof row.service === "object" && row.service !== null
        ? row.service
        : undefined;
    const status = typeof row.status === "string"
        ? row.status
        : typeof row.state === "string"
            ? row.state
            : undefined;
    const id = typeof row.id === "string"
        ? row.id
        : typeof nested?.id === "string"
            ? nested.id
            : typeof row.deployId === "string"
                ? row.deployId
                : undefined;
    return {
        accepted: true,
        ...(id === undefined ? {} : { id }),
        ...(status === undefined ? {} : { status }),
    };
};
const operation = (type, method, path, body, validate) => Action.Action(type, (props) => Effect.gen(function* () {
    const validationError = validate?.(props);
    if (validationError !== undefined) {
        return yield* Effect.fail(new RenderApiError(validationError));
    }
    // Resolve the API at execution time. Alchemy caches baked Action init
    // Effects process-wide, which must not capture one stack's profile.
    const getApi = yield* RenderApi;
    const api = yield* getApi;
    const value = yield* api.request({
        method,
        path: path(props),
        ...(body === undefined ? {} : { body: body(props) }),
    });
    return result(value);
}));
export const Deploy = operation("Render.Deploy", "POST", (p) => `/services/${encode(p.serviceId)}/deploys`, ({ serviceId: _, ...body }) => body, (p) => p.deployMode !== undefined &&
    (p.clearCache !== undefined ||
        p.commitId !== undefined ||
        p.imageUrl !== undefined)
    ? "Render deployMode cannot be combined with clearCache, commitId, or imageUrl"
    : undefined);
export const Rollback = operation("Render.Rollback", "POST", (p) => `/services/${encode(p.serviceId)}/rollback`, (p) => ({ deployId: p.deployId }));
export const CancelDeploy = operation("Render.CancelDeploy", "POST", (p) => `/services/${encode(p.serviceId)}/deploys/${encode(p.deployId)}/cancel`);
export const PurgeCache = operation("Render.PurgeCache", "POST", (p) => `/services/${encode(p.serviceId)}/cache/purge`);
export const SuspendService = operation("Render.SuspendService", "POST", (p) => `/services/${encode(p.serviceId)}/suspend`);
export const ResumeService = operation("Render.ResumeService", "POST", (p) => `/services/${encode(p.serviceId)}/resume`);
export const RestartService = operation("Render.RestartService", "POST", (p) => `/services/${encode(p.serviceId)}/restart`);
export const ScaleService = operation("Render.ScaleService", "POST", (p) => `/services/${encode(p.serviceId)}/scale`, (p) => ({ numInstances: p.numInstances }), (p) => Number.isInteger(p.numInstances) &&
    p.numInstances >= 1 &&
    p.numInstances <= 100
    ? undefined
    : "Render numInstances must be an integer from 1 to 100");
export const PreviewService = operation("Render.PreviewService", "POST", (p) => `/services/${encode(p.serviceId)}/preview`, (p) => ({
    imagePath: p.imagePath,
    ...(p.name === undefined ? {} : { name: p.name }),
    ...(p.plan === undefined ? {} : { plan: p.plan }),
}));
export const VerifyCustomDomain = operation("Render.VerifyCustomDomain", "POST", (p) => `/services/${encode(p.serviceId)}/custom-domains/${encode(p.domainNameOrId)}/verify`);
export const RunJob = operation("Render.RunJob", "POST", (p) => `/services/${encode(p.serviceId)}/jobs`, (p) => ({
    startCommand: p.startCommand,
    ...(p.planId === undefined ? {} : { planId: p.planId }),
}));
export const CancelJob = operation("Render.CancelJob", "POST", (p) => `/services/${encode(p.serviceId)}/jobs/${encode(p.jobId)}/cancel`);
export const RunCronJob = operation("Render.RunCronJob", "POST", (p) => `/cron-jobs/${encode(p.cronJobId)}/runs`);
export const CancelCronJobRun = operation("Render.CancelCronJobRun", "DELETE", (p) => `/cron-jobs/${encode(p.cronJobId)}/runs`);
export const RestoreDiskSnapshot = operation("Render.RestoreDiskSnapshot", "POST", (p) => `/disks/${encode(p.diskId)}/snapshots/restore`, (p) => ({
    snapshotKey: p.snapshotKey,
    ...(p.instanceId === undefined ? {} : { instanceId: p.instanceId }),
}));
export const SuspendPostgres = operation("Render.SuspendPostgres", "POST", (p) => `/postgres/${encode(p.postgresId)}/suspend`);
export const ResumePostgres = operation("Render.ResumePostgres", "POST", (p) => `/postgres/${encode(p.postgresId)}/resume`);
export const RestartPostgres = operation("Render.RestartPostgres", "POST", (p) => `/postgres/${encode(p.postgresId)}/restart`);
export const FailoverPostgres = operation("Render.FailoverPostgres", "POST", (p) => `/postgres/${encode(p.postgresId)}/failover`);
/** The recovery endpoint uses `datadogApiKey`, unlike Postgres CRUD. */
export const RecoverPostgres = operation("Render.RecoverPostgres", "POST", (p) => `/postgres/${encode(p.postgresId)}/recovery`, ({ postgresId: _, datadogApiKey, ...body }) => ({
    ...body,
    ...(datadogApiKey === undefined
        ? {}
        : { datadogApiKey: Redacted.value(datadogApiKey) }),
}));
export const ExportPostgres = operation("Render.ExportPostgres", "POST", (p) => `/postgres/${encode(p.postgresId)}/export`);
export const CreatePostgresUser = operation("Render.CreatePostgresUser", "POST", (p) => `/postgres/${encode(p.postgresId)}/credentials`, (p) => ({ username: p.username }));
/** @deprecated Use `CreatePostgresUser`. */
export const RotatePostgresCredentials = operation("Render.RotatePostgresCredentials", "POST", (p) => `/postgres/${encode(p.postgresId)}/credentials`, (p) => ({ username: p.username }));
export const DeletePostgresUser = operation("Render.DeletePostgresUser", "DELETE", (p) => `/postgres/${encode(p.postgresId)}/credentials/${encode(p.username)}`);
export const TriggerMaintenance = operation("Render.TriggerMaintenance", "POST", (p) => `/maintenance/${encode(p.maintenanceRunId)}/trigger`);
export const UpdateMaintenanceSchedule = operation("Render.UpdateMaintenanceSchedule", "PATCH", (p) => `/maintenance/${encode(p.maintenanceRunId)}`, (p) => ({ scheduledAt: p.scheduledAt }));
export const SuspendKeyValue = operation("Render.SuspendKeyValue", "POST", (p) => `/key-value/${encode(p.keyValueId)}/suspend`);
export const ResumeKeyValue = operation("Render.ResumeKeyValue", "POST", (p) => `/key-value/${encode(p.keyValueId)}/resume`);
/** @deprecated Use Key Value for new infrastructure. */
export const SuspendRedis = operation("Render.SuspendRedis", "POST", (p) => `/redis/${encode(p.redisId)}/suspend`);
/** @deprecated Use Key Value for new infrastructure. */
export const ResumeRedis = operation("Render.ResumeRedis", "POST", (p) => `/redis/${encode(p.redisId)}/resume`);
export const CreateWorkflowVersion = operation("Render.CreateWorkflowVersion", "POST", (_p) => "/workflowversions", (p) => ({
    workflowId: p.workflowId,
    ...(p.commit === undefined ? {} : { commit: p.commit }),
}));
export const RunTask = operation("Render.RunTask", "POST", (_p) => "/task-runs", (p) => ({ task: p.task, input: Redacted.value(p.input) }));
export const CancelTaskRun = operation("Render.CancelTaskRun", "DELETE", (p) => `/task-runs/${encode(p.taskRunId)}`);
//# sourceMappingURL=Actions.js.map