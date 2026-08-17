import * as Provider from "alchemy/Provider";
import * as Layer from "effect/Layer";
import * as Api from "./Api/Api.js";
import * as Credentials from "./Credentials.js";
declare const Providers_base: Provider.ProviderCollection<Providers, "Render">;
export declare class Providers extends Providers_base {
}
export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;
export declare const providers: (options?: Api.RenderApiLayerOptions) => Layer.Layer<import("alchemy/Auth/Credentials").CredentialsStore | Credentials.Credentials | import("alchemy/Auth/Profile").AlchemyProfile | Api.RenderApi | Providers, never, import("alchemy/Auth/AuthProvider").AuthProviders | import("alchemy/Stack").Stack | import("alchemy/Stage").Stage | import("effect/FileSystem").FileSystem>;
export {};
//# sourceMappingURL=Providers.d.ts.map