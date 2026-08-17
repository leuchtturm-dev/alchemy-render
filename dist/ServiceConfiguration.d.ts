import * as Provider from "alchemy/Provider";
import * as Resource from "alchemy/Resource";
import * as Redacted from "effect/Redacted";
import { RenderApi } from "./Api/Api.js";
import type { Providers } from "./Providers.js";
import { type CommonAttributes } from "./RestResource.js";
interface ServiceEnvVarBaseProps {
    readonly serviceId: string;
    readonly key: string;
}
export type ServiceEnvVarProps = ServiceEnvVarBaseProps & ({
    readonly value: Redacted.Redacted<string>;
    readonly generateValue?: never;
} | {
    readonly value?: never;
    readonly generateValue: true;
});
export interface ServiceSecretFileProps {
    readonly serviceId: string;
    readonly name: string;
    readonly content: Redacted.Redacted<string>;
}
export interface CustomDomainProps {
    readonly serviceId: string;
    readonly name: string;
}
export interface DiskProps {
    readonly serviceId: string;
    readonly name?: string;
    readonly mountPath: string;
    readonly sizeGB: number;
}
export interface HeaderProps {
    readonly serviceId: string;
    readonly name: string;
    readonly path: string;
    readonly value: string;
}
export interface RouteProps {
    readonly serviceId: string;
    readonly source: string;
    readonly destination: string;
    readonly type: "redirect" | "rewrite";
    /** Zero-based rule order. Omit on create to append; omission on update leaves the current priority unchanged. */
    readonly priority?: number;
}
export interface AutoscalingProps {
    readonly serviceId: string;
    readonly enabled?: true;
    readonly min: number;
    readonly max: number;
    readonly criteria: {
        readonly cpu?: {
            readonly enabled: boolean;
            readonly percentage: number;
        };
        readonly memory?: {
            readonly enabled: boolean;
            readonly percentage: number;
        };
    };
}
export interface SecretValueAttributes extends CommonAttributes {
    readonly valueDigest?: string;
    readonly generated: boolean;
}
export interface ServiceChildAttributes extends CommonAttributes {
    readonly serviceId: string;
}
export interface RouteAttributes extends ServiceChildAttributes {
    readonly source: string;
    readonly destination: string;
    readonly type: RouteProps["type"];
    readonly priority?: number;
}
export interface DiskAttributes extends ServiceChildAttributes {
    readonly diskId: string;
    readonly mountPath?: string;
    readonly sizeGB?: number;
    readonly configurationDigest?: string;
}
export interface AutoscalingAttributes extends CommonAttributes {
    readonly serviceId: string;
    readonly enabled: true;
    readonly min: number;
    readonly max: number;
    readonly criteria: Required<AutoscalingProps["criteria"]>;
}
type Managed<T extends string, P extends object, A extends object> = Resource.Resource<T, P, A, never, Providers>;
/** A service environment variable. Secret values are stored as digests. @resource */
export type ServiceEnvVar = Managed<"Render.ServiceEnvVar", ServiceEnvVarProps, SecretValueAttributes>;
export declare const ServiceEnvVar: Resource.ResourceClass<ServiceEnvVar>;
/** A service secret file. Secret values are stored as digests. @resource */
export type ServiceSecretFile = Managed<"Render.ServiceSecretFile", ServiceSecretFileProps, SecretValueAttributes>;
export declare const ServiceSecretFile: Resource.ResourceClass<ServiceSecretFile>;
/** A custom domain attached to a service. @resource */
export type CustomDomain = Managed<"Render.CustomDomain", CustomDomainProps, ServiceChildAttributes>;
export declare const CustomDomain: Resource.ResourceClass<CustomDomain>;
/** A persistent disk attached to a service. @resource */
export type Disk = Managed<"Render.Disk", DiskProps, DiskAttributes>;
export declare const Disk: Resource.ResourceClass<Disk>;
/** A static-site response header rule. @resource */
export type Header = Managed<"Render.Header", HeaderProps, ServiceChildAttributes>;
export declare const Header: Resource.ResourceClass<Header>;
/** A static-site redirect or rewrite rule. @resource */
export type Route = Managed<"Render.Route", RouteProps, RouteAttributes>;
export declare const Route: Resource.ResourceClass<Route>;
/** Autoscaling configuration managed separately from the service. @resource */
export type Autoscaling = Managed<"Render.Autoscaling", AutoscalingProps, AutoscalingAttributes>;
export declare const Autoscaling: Resource.ResourceClass<Autoscaling>;
export declare const ServiceEnvVarProvider: () => import("effect/Layer").Layer<Provider.Provider<ServiceEnvVar>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const ServiceSecretFileProvider: () => import("effect/Layer").Layer<Provider.Provider<ServiceSecretFile>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const CustomDomainProvider: () => import("effect/Layer").Layer<Provider.Provider<CustomDomain>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const DiskProvider: () => import("effect/Layer").Layer<Provider.Provider<Disk>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const HeaderProvider: () => import("effect/Layer").Layer<Provider.Provider<Header>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const RouteProvider: () => import("effect/Layer").Layer<Provider.Provider<Route>, never, RenderApi | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage>;
export declare const AutoscalingProvider: () => import("effect/Layer").Layer<Provider.Provider<Autoscaling>, never, RenderApi>;
export {};
//# sourceMappingURL=ServiceConfiguration.d.ts.map