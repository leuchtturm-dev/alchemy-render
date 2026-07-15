import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileLive } from "alchemy/Auth/Profile";
import * as Provider from "alchemy/Provider";
import * as Layer from "effect/Layer";
import * as Api from "./Api/Api.js";
import {
  DedicatedIp, DedicatedIpProvider, MetricsStream, MetricsStreamProvider,
  OwnerLogStream, OwnerLogStreamProvider, RegistryCredential, RegistryCredentialProvider,
  ResourceLogStream, ResourceLogStreamProvider, ServiceNotificationOverride,
  ServiceNotificationOverrideProvider, Webhook, WebhookProvider, Workflow, WorkflowProvider,
} from "./AccountResources.js";
import { RenderAuth } from "./AuthProvider.js";
import * as Credentials from "./Credentials.js";
import { KeyValue, KeyValueProvider, Postgres, PostgresProvider, Redis, RedisProvider } from "./Datastores.js";
import {
  EnvironmentGroup, EnvironmentGroupEnvVar, EnvironmentGroupEnvVarProvider,
  EnvironmentGroupLink, EnvironmentGroupLinkProvider, EnvironmentGroupProvider,
  EnvironmentGroupSecretFile, EnvironmentGroupSecretFileProvider,
} from "./EnvironmentGroups.js";
import { Environment, EnvironmentProvider, EnvironmentResource, EnvironmentResourceProvider, Project, ProjectProvider } from "./Projects.js";
import {
  Autoscaling, AutoscalingProvider, CustomDomain, CustomDomainProvider, Disk, DiskProvider,
  Header, HeaderProvider, Route, RouteProvider, ServiceEnvVar, ServiceEnvVarProvider,
  ServiceSecretFile, ServiceSecretFileProvider,
} from "./ServiceConfiguration.js";
import {
  BackgroundWorker, BackgroundWorkerProvider, CronJob, CronJobProvider,
  PrivateService, PrivateServiceProvider, StaticSite, StaticSiteProvider,
  WebService, WebServiceProvider,
} from "./Services.js";

export class Providers extends Provider.ProviderCollection<Providers>()("Render") {}
export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

const resources = [
  WebService, PrivateService, BackgroundWorker, CronJob, StaticSite,
  Postgres, KeyValue, Redis,
  Project, Environment, EnvironmentResource,
  EnvironmentGroup, EnvironmentGroupLink, EnvironmentGroupEnvVar, EnvironmentGroupSecretFile,
  ServiceEnvVar, ServiceSecretFile, CustomDomain, Disk, Header, Route, Autoscaling,
  DedicatedIp, RegistryCredential, Webhook, OwnerLogStream, ResourceLogStream, MetricsStream, Workflow, ServiceNotificationOverride,
];

/** Register every managed Render resource plus profile-backed authentication and API access. */
export const providers = (options: Api.RenderApiLayerOptions = {}) =>
  Layer.effect(Providers, Provider.collection(resources as any)).pipe(
    Layer.provide(Layer.mergeAll(
      WebServiceProvider(), PrivateServiceProvider(), BackgroundWorkerProvider(), CronJobProvider(), StaticSiteProvider(),
      PostgresProvider(), KeyValueProvider(), RedisProvider(),
      ProjectProvider(), EnvironmentProvider(), EnvironmentResourceProvider(),
      EnvironmentGroupProvider(), EnvironmentGroupLinkProvider(), EnvironmentGroupEnvVarProvider(), EnvironmentGroupSecretFileProvider(),
      ServiceEnvVarProvider(), ServiceSecretFileProvider(), CustomDomainProvider(), DiskProvider(), HeaderProvider(), RouteProvider(), AutoscalingProvider(),
      DedicatedIpProvider(), RegistryCredentialProvider(), WebhookProvider(), OwnerLogStreamProvider(), ResourceLogStreamProvider(), MetricsStreamProvider(), WorkflowProvider(), ServiceNotificationOverrideProvider(),
    )),
    Layer.provideMerge(Api.layer(options)),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(RenderAuth),
    Layer.provideMerge(ProfileLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
