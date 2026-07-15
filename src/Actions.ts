import * as Action from "alchemy/Action";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { apiFromProviders, Providers } from "./Providers.js";

/** Render actions have at-least-once execution semantics. */

export interface AcceptedResult {
  readonly accepted: true;
  readonly id?: string;
  readonly status?: string;
}

interface ServiceProps {
  readonly serviceId: string;
}
interface PostgresProps {
  readonly postgresId: string;
}
interface MaintenanceProps {
  readonly maintenanceRunId: string;
}

export interface DeployProps extends ServiceProps {
  readonly clearCache?: "clear" | "do_not_clear";
  readonly commitId?: string;
  readonly imageUrl?: string;
  readonly deployMode?: "deploy_only" | "build_and_deploy";
}
export interface RollbackProps extends ServiceProps {
  readonly deployId: string;
}
export interface CancelDeployProps extends ServiceProps {
  readonly deployId: string;
}
export interface PurgeCacheProps extends ServiceProps {}
export interface SuspendServiceProps extends ServiceProps {}
export interface ResumeServiceProps extends ServiceProps {}
export interface RestartServiceProps extends ServiceProps {}
export interface ScaleServiceProps extends ServiceProps {
  readonly numInstances: number;
}
export interface PreviewServiceProps extends ServiceProps {
  readonly imagePath: string;
  readonly name?: string;
  readonly plan?: string;
}
export interface VerifyCustomDomainProps extends ServiceProps {
  readonly domainNameOrId: string;
}
export interface RunJobProps extends ServiceProps {
  readonly startCommand: string;
  readonly planId?: string;
}
export interface CancelJobProps extends ServiceProps {
  readonly jobId: string;
}
export interface RunCronJobProps {
  readonly cronJobId: string;
}
export interface CancelCronJobRunProps {
  readonly cronJobId: string;
}
export interface RestoreDiskSnapshotProps {
  readonly diskId: string;
  readonly snapshotKey: string;
}
export interface SuspendPostgresProps extends PostgresProps {}
export interface ResumePostgresProps extends PostgresProps {}
export interface RestartPostgresProps extends PostgresProps {}
export interface FailoverPostgresProps extends PostgresProps {}
export interface RecoverPostgresProps extends PostgresProps {
  readonly restoreTime: string;
  readonly restoreName?: string;
  readonly plan?: string;
  readonly environmentId?: string;
  readonly datadogApiKey?: Redacted.Redacted<string>;
  readonly datadogSite?: string;
}
export interface ExportPostgresProps extends PostgresProps {}
export interface RotatePostgresCredentialsProps extends PostgresProps {
  readonly username: string;
}
export interface DeletePostgresUserProps extends PostgresProps {
  readonly username: string;
}
export interface TriggerMaintenanceProps extends MaintenanceProps {}
export interface UpdateMaintenanceScheduleProps extends MaintenanceProps {
  readonly scheduledAt: string;
}
export interface CreateWorkflowVersionProps {
  readonly workflowId: string;
  readonly commit?: string;
}
export interface RunTaskProps {
  readonly task: string;
  readonly input: Redacted.Redacted<
    readonly unknown[] | Readonly<Record<string, unknown>>
  >;
}
export interface CancelTaskRunProps {
  readonly taskRunId: string;
}
export interface KeyValueActionProps {
  readonly keyValueId: string;
}
export interface RedisActionProps {
  readonly redisId: string;
}

type Method = "POST" | "PATCH" | "DELETE";
const encode = encodeURIComponent;
const result = (value: unknown): AcceptedResult => {
  if (typeof value !== "object" || value === null) return { accepted: true };
  const row = value as Record<string, unknown>;
  const nested =
    typeof row.service === "object" && row.service !== null
      ? (row.service as Record<string, unknown>)
      : undefined;
  const status =
    typeof row.status === "string"
      ? row.status
      : typeof row.state === "string"
        ? row.state
        : undefined;
  const id =
    typeof row.id === "string"
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

const operation = <const Type extends string, Props extends object>(
  type: Type,
  method: Method,
  path: (props: Props) => string,
  body?: (props: Props) => unknown,
) =>
  Action.Action<Type, Props, AcceptedResult, Providers>(
    type,
    Effect.gen(function* () {
      const getApi = yield* apiFromProviders;
      return (props) =>
        Effect.gen(function* () {
          const api = yield* getApi;
          const value = yield* api.request({
            method,
            path: path(props),
            ...(body === undefined ? {} : { body: body(props) }),
          });
          return result(value);
        });
    }),
  );

export const Deploy = operation(
  "Render.Deploy",
  "POST",
  (p: DeployProps) => `/services/${encode(p.serviceId)}/deploys`,
  ({ serviceId: _, ...body }) => body,
);
export const Rollback = operation(
  "Render.Rollback",
  "POST",
  (p: RollbackProps) => `/services/${encode(p.serviceId)}/rollback`,
  (p) => ({ deployId: p.deployId }),
);
export const CancelDeploy = operation(
  "Render.CancelDeploy",
  "POST",
  (p: CancelDeployProps) =>
    `/services/${encode(p.serviceId)}/deploys/${encode(p.deployId)}/cancel`,
);
export const PurgeCache = operation(
  "Render.PurgeCache",
  "POST",
  (p: PurgeCacheProps) => `/services/${encode(p.serviceId)}/cache/purge`,
);
export const SuspendService = operation(
  "Render.SuspendService",
  "POST",
  (p: SuspendServiceProps) => `/services/${encode(p.serviceId)}/suspend`,
);
export const ResumeService = operation(
  "Render.ResumeService",
  "POST",
  (p: ResumeServiceProps) => `/services/${encode(p.serviceId)}/resume`,
);
export const RestartService = operation(
  "Render.RestartService",
  "POST",
  (p: RestartServiceProps) => `/services/${encode(p.serviceId)}/restart`,
);
export const ScaleService = operation(
  "Render.ScaleService",
  "POST",
  (p: ScaleServiceProps) => `/services/${encode(p.serviceId)}/scale`,
  (p) => ({ numInstances: p.numInstances }),
);
export const PreviewService = operation(
  "Render.PreviewService",
  "POST",
  (p: PreviewServiceProps) => `/services/${encode(p.serviceId)}/preview`,
  (p) => ({
    imagePath: p.imagePath,
    ...(p.name === undefined ? {} : { name: p.name }),
    ...(p.plan === undefined ? {} : { plan: p.plan }),
  }),
);
export const VerifyCustomDomain = operation(
  "Render.VerifyCustomDomain",
  "POST",
  (p: VerifyCustomDomainProps) =>
    `/services/${encode(p.serviceId)}/custom-domains/${encode(p.domainNameOrId)}/verify`,
);
export const RunJob = operation(
  "Render.RunJob",
  "POST",
  (p: RunJobProps) => `/services/${encode(p.serviceId)}/jobs`,
  (p) => ({
    startCommand: p.startCommand,
    ...(p.planId === undefined ? {} : { planId: p.planId }),
  }),
);
export const CancelJob = operation(
  "Render.CancelJob",
  "POST",
  (p: CancelJobProps) =>
    `/services/${encode(p.serviceId)}/jobs/${encode(p.jobId)}/cancel`,
);
export const RunCronJob = operation(
  "Render.RunCronJob",
  "POST",
  (p: RunCronJobProps) => `/cron-jobs/${encode(p.cronJobId)}/runs`,
);
export const CancelCronJobRun = operation(
  "Render.CancelCronJobRun",
  "DELETE",
  (p: CancelCronJobRunProps) => `/cron-jobs/${encode(p.cronJobId)}/runs`,
);
export const RestoreDiskSnapshot = operation(
  "Render.RestoreDiskSnapshot",
  "POST",
  (p: RestoreDiskSnapshotProps) =>
    `/disks/${encode(p.diskId)}/snapshots/restore`,
  (p) => ({ snapshotKey: p.snapshotKey }),
);
export const SuspendPostgres = operation(
  "Render.SuspendPostgres",
  "POST",
  (p: SuspendPostgresProps) => `/postgres/${encode(p.postgresId)}/suspend`,
);
export const ResumePostgres = operation(
  "Render.ResumePostgres",
  "POST",
  (p: ResumePostgresProps) => `/postgres/${encode(p.postgresId)}/resume`,
);
export const RestartPostgres = operation(
  "Render.RestartPostgres",
  "POST",
  (p: RestartPostgresProps) => `/postgres/${encode(p.postgresId)}/restart`,
);
export const FailoverPostgres = operation(
  "Render.FailoverPostgres",
  "POST",
  (p: FailoverPostgresProps) => `/postgres/${encode(p.postgresId)}/failover`,
);
/** The recovery endpoint uses `datadogApiKey`, unlike Postgres CRUD. */
export const RecoverPostgres = operation(
  "Render.RecoverPostgres",
  "POST",
  (p: RecoverPostgresProps) => `/postgres/${encode(p.postgresId)}/recovery`,
  ({ postgresId: _, datadogApiKey, ...body }) => ({
    ...body,
    ...(datadogApiKey === undefined
      ? {}
      : { datadogApiKey: Redacted.value(datadogApiKey) }),
  }),
);
export const ExportPostgres = operation(
  "Render.ExportPostgres",
  "POST",
  (p: ExportPostgresProps) => `/postgres/${encode(p.postgresId)}/export`,
);
export const RotatePostgresCredentials = operation(
  "Render.RotatePostgresCredentials",
  "POST",
  (p: RotatePostgresCredentialsProps) =>
    `/postgres/${encode(p.postgresId)}/credentials`,
  (p) => ({ username: p.username }),
);
export const DeletePostgresUser = operation(
  "Render.DeletePostgresUser",
  "DELETE",
  (p: DeletePostgresUserProps) =>
    `/postgres/${encode(p.postgresId)}/credentials/${encode(p.username)}`,
);
export const TriggerMaintenance = operation(
  "Render.TriggerMaintenance",
  "POST",
  (p: TriggerMaintenanceProps) =>
    `/maintenance/${encode(p.maintenanceRunId)}/trigger`,
);
export const UpdateMaintenanceSchedule = operation(
  "Render.UpdateMaintenanceSchedule",
  "PATCH",
  (p: UpdateMaintenanceScheduleProps) =>
    `/maintenance/${encode(p.maintenanceRunId)}`,
  (p) => ({ scheduledAt: p.scheduledAt }),
);
export const SuspendKeyValue = operation(
  "Render.SuspendKeyValue",
  "POST",
  (p: KeyValueActionProps) => `/key-value/${encode(p.keyValueId)}/suspend`,
);
export const ResumeKeyValue = operation(
  "Render.ResumeKeyValue",
  "POST",
  (p: KeyValueActionProps) => `/key-value/${encode(p.keyValueId)}/resume`,
);
/** @deprecated Use Key Value for new infrastructure. */
export const SuspendRedis = operation(
  "Render.SuspendRedis",
  "POST",
  (p: RedisActionProps) => `/redis/${encode(p.redisId)}/suspend`,
);
/** @deprecated Use Key Value for new infrastructure. */
export const ResumeRedis = operation(
  "Render.ResumeRedis",
  "POST",
  (p: RedisActionProps) => `/redis/${encode(p.redisId)}/resume`,
);
export const CreateWorkflowVersion = operation(
  "Render.CreateWorkflowVersion",
  "POST",
  (_p: CreateWorkflowVersionProps) => "/workflowversions",
  (p) => ({
    workflowId: p.workflowId,
    ...(p.commit === undefined ? {} : { commit: p.commit }),
  }),
);
export const RunTask = operation(
  "Render.RunTask",
  "POST",
  (_p: RunTaskProps) => "/task-runs",
  (p) => ({ task: p.task, input: Redacted.value(p.input) }),
);
export const CancelTaskRun = operation(
  "Render.CancelTaskRun",
  "DELETE",
  (p: CancelTaskRunProps) => `/task-runs/${encode(p.taskRunId)}`,
);
