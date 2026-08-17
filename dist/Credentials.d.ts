import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { AlchemyProfile } from "alchemy/Auth/Profile";
export interface RenderCredentials {
    readonly apiKey: Redacted.Redacted<string>;
    readonly ownerId: string;
    /** Exact API root, including `/v1`. */
    readonly apiBaseUrl: string;
}
declare const Credentials_base: Context.ServiceClass<Credentials, "Render.Credentials", Effect.Effect<RenderCredentials, never, never>>;
/** Lazy credentials used by every Render provider operation. */
export declare class Credentials extends Credentials_base {
}
export interface ApiKeyCredentials {
    readonly apiKey: string | Redacted.Redacted<string>;
    readonly ownerId: string;
    readonly apiBaseUrl?: string;
}
/** Explicit credentials layer for tests and non-profile embedding. */
export declare const fromApiKey: (input: ApiKeyCredentials) => Layer.Layer<Credentials, never, never>;
/** Resolve credentials lazily through the active Alchemy profile. */
export declare const fromAuthProvider: () => Layer.Layer<Credentials, import("alchemy/Auth/AuthProvider").AuthError | Config.ConfigError, import("alchemy/Auth/AuthProvider").AuthProviders | AlchemyProfile>;
export {};
//# sourceMappingURL=Credentials.d.ts.map