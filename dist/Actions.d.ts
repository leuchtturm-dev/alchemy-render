import * as Action from "alchemy/Action";
import * as Redacted from "effect/Redacted";
import { RenderApi } from "./Api/Api.js";
import type { PostgresPlan } from "./Datastores.js";
import type { ServicePlan } from "./Services.js";
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
interface DeployTargetProps extends ServiceProps {
    readonly clearCache?: "clear" | "do_not_clear";
    readonly commitId?: string;
    readonly imageUrl?: string;
    readonly deployMode?: never;
}
interface DeployModeProps extends ServiceProps {
    readonly deployMode: "deploy_only" | "build_and_deploy";
    readonly clearCache?: never;
    readonly commitId?: never;
    readonly imageUrl?: never;
}
/**
 * Trigger a deploy. Render does not allow `deployMode` to be combined with a
 * cache, commit, or image selector.
 */
export type DeployProps = DeployTargetProps | DeployModeProps;
export interface RollbackProps extends ServiceProps {
    readonly deployId: string;
}
/** Cancel a deploy. Render does not support cron-job deploy cancellation. */
export interface CancelDeployProps extends ServiceProps {
    readonly deployId: string;
}
export interface PurgeCacheProps extends ServiceProps {
}
export interface SuspendServiceProps extends ServiceProps {
}
export interface ResumeServiceProps extends ServiceProps {
}
/** Restart a service. Render does not support restarting cron jobs. */
export interface RestartServiceProps extends ServiceProps {
}
export interface ScaleServiceProps extends ServiceProps {
    readonly numInstances: number;
}
export interface PreviewServiceProps extends ServiceProps {
    readonly imagePath: string;
    readonly name?: string;
    readonly plan?: ServicePlan;
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
    /** Select the instance snapshot when the disk belongs to a scaled service. */
    readonly instanceId?: string;
}
export interface SuspendPostgresProps extends PostgresProps {
}
export interface ResumePostgresProps extends PostgresProps {
}
export interface RestartPostgresProps extends PostgresProps {
}
export interface FailoverPostgresProps extends PostgresProps {
}
export interface RecoverPostgresProps extends PostgresProps {
    readonly restoreTime: string;
    readonly restoreName?: string;
    readonly plan?: PostgresPlan;
    readonly environmentId?: string;
    readonly datadogApiKey?: Redacted.Redacted<string>;
    readonly datadogSite?: string;
}
export interface ExportPostgresProps extends PostgresProps {
}
export interface CreatePostgresUserProps extends PostgresProps {
    readonly username: string;
}
/** @deprecated Use `CreatePostgresUserProps`. */
export interface RotatePostgresCredentialsProps extends CreatePostgresUserProps {
}
export interface DeletePostgresUserProps extends PostgresProps {
    readonly username: string;
}
export interface TriggerMaintenanceProps extends MaintenanceProps {
}
export interface UpdateMaintenanceScheduleProps extends MaintenanceProps {
    readonly scheduledAt: string;
}
export interface CreateWorkflowVersionProps {
    readonly workflowId: string;
    readonly commit?: string;
}
export interface RunTaskProps {
    readonly task: string;
    readonly input: Redacted.Redacted<readonly unknown[] | Readonly<Record<string, unknown>>>;
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
export declare const Deploy: Action.ActionClass<never, "Render.Deploy", DeployProps, AcceptedResult, RenderApi>;
export declare const Rollback: Action.ActionClass<never, "Render.Rollback", RollbackProps, AcceptedResult, RenderApi>;
export declare const CancelDeploy: Action.ActionClass<never, "Render.CancelDeploy", CancelDeployProps, AcceptedResult, RenderApi>;
export declare const PurgeCache: Action.ActionClass<never, "Render.PurgeCache", PurgeCacheProps, AcceptedResult, RenderApi>;
export declare const SuspendService: Action.ActionClass<never, "Render.SuspendService", SuspendServiceProps, AcceptedResult, RenderApi>;
export declare const ResumeService: Action.ActionClass<never, "Render.ResumeService", ResumeServiceProps, AcceptedResult, RenderApi>;
export declare const RestartService: Action.ActionClass<never, "Render.RestartService", RestartServiceProps, AcceptedResult, RenderApi>;
export declare const ScaleService: Action.ActionClass<never, "Render.ScaleService", ScaleServiceProps, AcceptedResult, RenderApi>;
export declare const PreviewService: Action.ActionClass<never, "Render.PreviewService", PreviewServiceProps, AcceptedResult, RenderApi>;
export declare const VerifyCustomDomain: Action.ActionClass<never, "Render.VerifyCustomDomain", VerifyCustomDomainProps, AcceptedResult, RenderApi>;
export declare const RunJob: Action.ActionClass<never, "Render.RunJob", RunJobProps, AcceptedResult, RenderApi>;
export declare const CancelJob: Action.ActionClass<never, "Render.CancelJob", CancelJobProps, AcceptedResult, RenderApi>;
export declare const RunCronJob: Action.ActionClass<never, "Render.RunCronJob", RunCronJobProps, AcceptedResult, RenderApi>;
export declare const CancelCronJobRun: Action.ActionClass<never, "Render.CancelCronJobRun", CancelCronJobRunProps, AcceptedResult, RenderApi>;
export declare const RestoreDiskSnapshot: Action.ActionClass<never, "Render.RestoreDiskSnapshot", RestoreDiskSnapshotProps, AcceptedResult, RenderApi>;
export declare const SuspendPostgres: Action.ActionClass<never, "Render.SuspendPostgres", SuspendPostgresProps, AcceptedResult, RenderApi>;
export declare const ResumePostgres: Action.ActionClass<never, "Render.ResumePostgres", ResumePostgresProps, AcceptedResult, RenderApi>;
export declare const RestartPostgres: Action.ActionClass<never, "Render.RestartPostgres", RestartPostgresProps, AcceptedResult, RenderApi>;
export declare const FailoverPostgres: Action.ActionClass<never, "Render.FailoverPostgres", FailoverPostgresProps, AcceptedResult, RenderApi>;
/** The recovery endpoint uses `datadogApiKey`, unlike Postgres CRUD. */
export declare const RecoverPostgres: Action.ActionClass<never, "Render.RecoverPostgres", RecoverPostgresProps, AcceptedResult, RenderApi>;
export declare const ExportPostgres: Action.ActionClass<never, "Render.ExportPostgres", ExportPostgresProps, AcceptedResult, RenderApi>;
export declare const CreatePostgresUser: Action.ActionClass<never, "Render.CreatePostgresUser", CreatePostgresUserProps, AcceptedResult, RenderApi>;
/** @deprecated Use `CreatePostgresUser`. */
export declare const RotatePostgresCredentials: Action.ActionClass<never, "Render.RotatePostgresCredentials", RotatePostgresCredentialsProps, AcceptedResult, RenderApi>;
export declare const DeletePostgresUser: Action.ActionClass<never, "Render.DeletePostgresUser", DeletePostgresUserProps, AcceptedResult, RenderApi>;
export declare const TriggerMaintenance: Action.ActionClass<never, "Render.TriggerMaintenance", TriggerMaintenanceProps, AcceptedResult, RenderApi>;
export declare const UpdateMaintenanceSchedule: Action.ActionClass<never, "Render.UpdateMaintenanceSchedule", UpdateMaintenanceScheduleProps, AcceptedResult, RenderApi>;
export declare const SuspendKeyValue: Action.ActionClass<never, "Render.SuspendKeyValue", KeyValueActionProps, AcceptedResult, RenderApi>;
export declare const ResumeKeyValue: Action.ActionClass<never, "Render.ResumeKeyValue", KeyValueActionProps, AcceptedResult, RenderApi>;
/** @deprecated Use Key Value for new infrastructure. */
export declare const SuspendRedis: Action.ActionClass<never, "Render.SuspendRedis", RedisActionProps, AcceptedResult, RenderApi>;
/** @deprecated Use Key Value for new infrastructure. */
export declare const ResumeRedis: Action.ActionClass<never, "Render.ResumeRedis", RedisActionProps, AcceptedResult, RenderApi>;
export declare const CreateWorkflowVersion: Action.ActionClass<never, "Render.CreateWorkflowVersion", CreateWorkflowVersionProps, AcceptedResult, RenderApi>;
export declare const RunTask: Action.ActionClass<never, "Render.RunTask", RunTaskProps, AcceptedResult, RenderApi>;
export declare const CancelTaskRun: Action.ActionClass<never, "Render.CancelTaskRun", CancelTaskRunProps, AcceptedResult, RenderApi>;
export {};
//# sourceMappingURL=Actions.d.ts.map