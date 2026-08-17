import * as Redacted from "effect/Redacted";
import { CredentialsStore } from "alchemy/Auth/Credentials";
export declare const RENDER_AUTH_PROVIDER_NAME = "Render";
export type RenderAuthConfig = {
    method: "env";
} | {
    method: "stored";
};
export interface RenderStoredCredentials {
    readonly type: "apiKey";
    readonly apiKey: string;
    readonly ownerId: string;
}
export interface RenderResolvedCredentials {
    readonly type: "apiKey";
    readonly apiKey: Redacted.Redacted<string>;
    readonly ownerId: string;
    readonly apiBaseUrl: string;
    readonly source: {
        readonly type: RenderAuthConfig["method"];
    };
}
/** Register Render with Alchemy's profile-aware authentication registry. */
export declare const RenderAuth: import("effect/Layer").Layer<never, never, CredentialsStore | import("alchemy/Auth/AuthProvider").AuthProviders>;
//# sourceMappingURL=AuthProvider.d.ts.map