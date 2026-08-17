import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import { RenderApi } from "./Api/Api.js";
import type { Providers } from "./Providers.js";
import { type CommonAttributes } from "./RestResource.js";
export interface EnvironmentIpRule {
    readonly cidrBlock: string;
    readonly description: string;
}
export interface ProjectProps {
    readonly name?: string;
}
export interface EnvironmentProps {
    readonly name?: string;
    readonly projectId: string;
    readonly protectedStatus?: "protected" | "unprotected";
    readonly networkIsolationEnabled?: boolean;
    readonly ipAllowList?: readonly EnvironmentIpRule[];
}
export interface EnvironmentResourceProps {
    readonly environmentId: string;
    readonly resourceId: string;
}
export interface ProjectAttributes extends CommonAttributes {
    readonly projectId: string;
    readonly environmentIds: readonly string[];
}
export interface EnvironmentAttributes extends CommonAttributes {
    readonly environmentId: string;
    readonly projectId: string;
    readonly protectedStatus: "protected" | "unprotected";
    readonly networkIsolationEnabled: boolean;
}
export interface EnvironmentResourceAttributes extends CommonAttributes {
    readonly environmentId: string;
    readonly resourceId: string;
}
type Managed<T extends string, P extends object, A extends object> = Resource.Resource<T, P, A, never, Providers>;
/** A Render project used to organize environments. @resource */
export type Project = Managed<"Render.Project", ProjectProps, ProjectAttributes>;
export declare const Project: Resource.ResourceClass<Project>;
/** A Render project environment. @resource */
export type Environment = Managed<"Render.Environment", EnvironmentProps, EnvironmentAttributes>;
export declare const Environment: Resource.ResourceClass<Environment>;
/** Membership of a service or datastore in an environment. @resource */
export type EnvironmentResource = Managed<"Render.EnvironmentResource", EnvironmentResourceProps, EnvironmentResourceAttributes>;
export declare const EnvironmentResource: Resource.ResourceClass<EnvironmentResource>;
export declare const ProjectProvider: () => import("effect/Layer").Layer<Provider.Provider<Project>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const EnvironmentProvider: () => import("effect/Layer").Layer<Provider.Provider<Environment>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const EnvironmentResourceProvider: () => import("effect/Layer").Layer<Provider.Provider<EnvironmentResource>, never, RenderApi>;
export {};
//# sourceMappingURL=Projects.d.ts.map