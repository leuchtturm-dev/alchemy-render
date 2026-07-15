import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileLive } from "alchemy/Auth/Profile";
import * as Provider from "alchemy/Provider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Api from "./Api/Api.js";
import {
  DedicatedIp,
  DedicatedIpProvider,
  MetricsStream,
  MetricsStreamProvider,
  OwnerLogStream,
  OwnerLogStreamProvider,
  RegistryCredential,
  RegistryCredentialProvider,
  ResourceLogStream,
  ResourceLogStreamProvider,
  ServiceNotificationOverride,
  ServiceNotificationOverrideProvider,
  Webhook,
  WebhookProvider,
  Workflow,
  WorkflowProvider,
} from "./AccountResources.js";
import { RenderAuth } from "./AuthProvider.js";
import * as Credentials from "./Credentials.js";
import {
  KeyValue,
  KeyValueProvider,
  Postgres,
  PostgresProvider,
  Redis,
  RedisProvider,
} from "./Datastores.js";
import {
  EnvironmentGroup,
  EnvironmentGroupEnvVar,
  EnvironmentGroupEnvVarProvider,
  EnvironmentGroupLink,
  EnvironmentGroupLinkProvider,
  EnvironmentGroupProvider,
  EnvironmentGroupSecretFile,
  EnvironmentGroupSecretFileProvider,
} from "./EnvironmentGroups.js";
import {
  Environment,
  EnvironmentProvider,
  EnvironmentResource,
  EnvironmentResourceProvider,
  Project,
  ProjectProvider,
} from "./Projects.js";
import {
  Autoscaling,
  AutoscalingProvider,
  CustomDomain,
  CustomDomainProvider,
  Disk,
  DiskProvider,
  Header,
  HeaderProvider,
  Route,
  RouteProvider,
  ServiceEnvVar,
  ServiceEnvVarProvider,
  ServiceSecretFile,
  ServiceSecretFileProvider,
} from "./ServiceConfiguration.js";
import { resourceClass } from "./RestResource.js";
import {
  BackgroundWorker,
  BackgroundWorkerProvider,
  CronJob,
  CronJobProvider,
  PrivateService,
  PrivateServiceProvider,
  StaticSite,
  StaticSiteProvider,
  WebService,
  WebServiceProvider,
} from "./Services.js";

export class Providers extends Provider.ProviderCollection<Providers>()(
  "Render",
) {}

interface RenderProviderCollection extends Provider.ProviderCollectionService {
  readonly renderApi: Effect.Effect<Api.RenderApiClient, Api.RenderApiError>;
}

/** Internal bridge that lets Actions use the same stack-level provider Layer. */
export const apiFromProviders = Effect.gen(function* () {
  const collection = yield* Providers;
  return (collection as RenderProviderCollection).renderApi;
});

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

const resources = [
  resourceClass(WebService),
  resourceClass(PrivateService),
  resourceClass(BackgroundWorker),
  resourceClass(CronJob),
  resourceClass(StaticSite),
  resourceClass(Postgres),
  resourceClass(KeyValue),
  resourceClass(Redis),
  resourceClass(Project),
  resourceClass(Environment),
  resourceClass(EnvironmentResource),
  resourceClass(EnvironmentGroup),
  resourceClass(EnvironmentGroupLink),
  resourceClass(EnvironmentGroupEnvVar),
  resourceClass(EnvironmentGroupSecretFile),
  resourceClass(ServiceEnvVar),
  resourceClass(ServiceSecretFile),
  resourceClass(CustomDomain),
  resourceClass(Disk),
  resourceClass(Header),
  resourceClass(Route),
  resourceClass(Autoscaling),
  resourceClass(DedicatedIp),
  resourceClass(RegistryCredential),
  resourceClass(Webhook),
  resourceClass(OwnerLogStream),
  resourceClass(ResourceLogStream),
  resourceClass(MetricsStream),
  resourceClass(Workflow),
  resourceClass(ServiceNotificationOverride),
];

export const providers = (options: Api.RenderApiLayerOptions = {}) =>
  Layer.effect(
    Providers,
    Effect.gen(function* () {
      const collection = yield* Provider.collection(resources);
      const renderApi = yield* Api.RenderApi;
      return { ...collection, renderApi } satisfies RenderProviderCollection;
    }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        WebServiceProvider(),
        PrivateServiceProvider(),
        BackgroundWorkerProvider(),
        CronJobProvider(),
        StaticSiteProvider(),
        PostgresProvider(),
        KeyValueProvider(),
        RedisProvider(),
        ProjectProvider(),
        EnvironmentProvider(),
        EnvironmentResourceProvider(),
        EnvironmentGroupProvider(),
        EnvironmentGroupLinkProvider(),
        EnvironmentGroupEnvVarProvider(),
        EnvironmentGroupSecretFileProvider(),
        ServiceEnvVarProvider(),
        ServiceSecretFileProvider(),
        CustomDomainProvider(),
        DiskProvider(),
        HeaderProvider(),
        RouteProvider(),
        AutoscalingProvider(),
        DedicatedIpProvider(),
        RegistryCredentialProvider(),
        WebhookProvider(),
        OwnerLogStreamProvider(),
        ResourceLogStreamProvider(),
        MetricsStreamProvider(),
        WorkflowProvider(),
        ServiceNotificationOverrideProvider(),
      ),
    ),
    Layer.provideMerge(Api.layer(options)),
    Layer.provideMerge(Credentials.fromAuthProvider()),
    Layer.provideMerge(RenderAuth),
    Layer.provideMerge(ProfileLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
