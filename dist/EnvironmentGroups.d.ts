import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Redacted from "effect/Redacted";
import { RenderApi } from "./Api/Api.js";
import type { Providers } from "./Providers.js";
import { type CommonAttributes } from "./RestResource.js";
export interface EnvironmentGroupProps {
    readonly name?: string;
    readonly environmentId?: string;
}
export interface EnvironmentGroupLinkProps {
    readonly environmentGroupId: string;
    readonly serviceId: string;
}
interface EnvironmentGroupEnvVarBaseProps {
    readonly environmentGroupId: string;
    readonly key: string;
}
export type EnvironmentGroupEnvVarProps = EnvironmentGroupEnvVarBaseProps & ({
    readonly value: Redacted.Redacted<string>;
    readonly generateValue?: never;
} | {
    readonly value?: never;
    readonly generateValue: true;
});
export interface EnvironmentGroupSecretFileProps {
    readonly environmentGroupId: string;
    readonly name: string;
    readonly content: Redacted.Redacted<string>;
}
export interface EnvironmentGroupAttributes extends CommonAttributes {
    readonly environmentGroupId: string;
    readonly environmentId?: string;
}
export interface EnvironmentGroupLinkAttributes extends CommonAttributes {
    readonly environmentGroupId: string;
    readonly serviceId: string;
}
export interface SecretAttributes extends CommonAttributes {
    readonly valueDigest?: string;
    readonly generated?: boolean;
}
type Managed<T extends string, P extends object, A extends object> = Resource.Resource<T, P, A, never, Providers>;
/** A shared Render environment group. @resource */
export type EnvironmentGroup = Managed<"Render.EnvironmentGroup", EnvironmentGroupProps, EnvironmentGroupAttributes>;
export declare const EnvironmentGroup: Resource.ResourceClass<EnvironmentGroup>;
/** Links a service to an environment group. @resource */
export type EnvironmentGroupLink = Managed<"Render.EnvironmentGroupLink", EnvironmentGroupLinkProps, EnvironmentGroupLinkAttributes>;
export declare const EnvironmentGroupLink: Resource.ResourceClass<EnvironmentGroupLink>;
/** An environment-group variable. Secret values are stored as digests. @resource */
export type EnvironmentGroupEnvVar = Managed<"Render.EnvironmentGroupEnvVar", EnvironmentGroupEnvVarProps, SecretAttributes>;
export declare const EnvironmentGroupEnvVar: Resource.ResourceClass<EnvironmentGroupEnvVar>;
/** An environment-group secret file. Secret values are stored as digests. @resource */
export type EnvironmentGroupSecretFile = Managed<"Render.EnvironmentGroupSecretFile", EnvironmentGroupSecretFileProps, SecretAttributes>;
export declare const EnvironmentGroupSecretFile: Resource.ResourceClass<EnvironmentGroupSecretFile>;
export declare const EnvironmentGroupProvider: () => import("effect/Layer").Layer<Provider.Provider<EnvironmentGroup>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const EnvironmentGroupLinkProvider: () => import("effect/Layer").Layer<Provider.Provider<EnvironmentGroupLink>, never, RenderApi>;
export declare const EnvironmentGroupEnvVarProvider: () => import("effect/Layer").Layer<Provider.Provider<EnvironmentGroupEnvVar>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const EnvironmentGroupSecretFileProvider: () => import("effect/Layer").Layer<Provider.Provider<EnvironmentGroupSecretFile>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export {};
//# sourceMappingURL=EnvironmentGroups.d.ts.map