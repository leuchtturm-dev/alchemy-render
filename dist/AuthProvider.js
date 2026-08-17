import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Redacted from "effect/Redacted";
import { AuthError, AuthProviderLayer, } from "alchemy/Auth/AuthProvider";
import { CredentialsStore, displayRedacted } from "alchemy/Auth/Credentials";
import { getEnv, getEnvRedactedRequired, getEnvRequired, retryOnce, } from "alchemy/Auth/Env";
import * as Clank from "alchemy/Util/Clank";
import { DEFAULT_API_BASE_URL } from "./Config.js";
export const RENDER_AUTH_PROVIDER_NAME = "Render";
const STORAGE_KEY = "render-stored";
const options = [
    {
        value: "env",
        label: "Environment Variables",
        hint: "RENDER_API_KEY + RENDER_OWNER_ID",
    },
    {
        value: "stored",
        label: "API Key",
        hint: "enter interactively, stored in ~/.alchemy/credentials",
    },
];
/** Register Render with Alchemy's profile-aware authentication registry. */
export const RenderAuth = AuthProviderLayer()(RENDER_AUTH_PROVIDER_NAME, Effect.gen(function* () {
    const store = yield* CredentialsStore;
    const loginStored = Effect.fn(function* (profileName) {
        const apiKey = yield* Clank.password({
            message: "Render API Key",
            validate: (value) => (value.length === 0 ? "Required" : undefined),
        }).pipe(retryOnce);
        const ownerId = yield* Clank.text({
            message: "Render Workspace / Owner ID",
            validate: (value) => (value.length === 0 ? "Required" : undefined),
        }).pipe(retryOnce);
        yield* store.write(profileName, STORAGE_KEY, {
            type: "apiKey",
            apiKey,
            ownerId,
        });
        yield* Clank.success("Render: credentials saved.");
        return { method: "stored" };
    });
    const configureInteractive = (profileName) => Clank.select({
        message: "Render authentication method",
        options,
    }).pipe(Effect.flatMap((method) => Match.value(method).pipe(Match.when("env", () => Effect.succeed({ method: "env" })), Match.when("stored", () => loginStored(profileName)), Match.exhaustive)));
    const configure = (profileName, context) => Effect.gen(function* () {
        if (context.ci)
            return { method: "env" };
        return yield* configureInteractive(profileName);
    }).pipe(Effect.mapError((cause) => new AuthError({
        message: "Failed to configure Render credentials",
        cause,
    })));
    const read = (profileName, config) => Match.value(config).pipe(Match.when({ method: "env" }, Effect.fn(function* () {
        const apiKey = yield* getEnvRedactedRequired("RENDER_API_KEY");
        const ownerId = yield* getEnvRequired("RENDER_OWNER_ID");
        const apiBaseUrl = (yield* getEnv("RENDER_HOST")) ?? DEFAULT_API_BASE_URL;
        return {
            type: "apiKey",
            apiKey,
            ownerId,
            apiBaseUrl,
            source: { type: "env" },
        };
    })), Match.when({ method: "stored" }, () => Effect.gen(function* () {
        const credentials = yield* store.read(profileName, STORAGE_KEY);
        if (!credentials) {
            return yield* new AuthError({
                message: "Render stored credentials not found. Run: alchemy login --configure",
            });
        }
        const apiBaseUrl = (yield* getEnv("RENDER_HOST")) ?? DEFAULT_API_BASE_URL;
        return {
            type: "apiKey",
            apiKey: Redacted.make(credentials.apiKey),
            ownerId: credentials.ownerId,
            apiBaseUrl,
            source: { type: "stored" },
        };
    })), Match.exhaustive);
    const login = (profileName, config) => Match.value(config)
        .pipe(Match.when({ method: "env" }, () => read(profileName, config).pipe(Effect.asVoid)), Match.when({ method: "stored" }, () => store
        .read(profileName, STORAGE_KEY)
        .pipe(Effect.flatMap((credentials) => credentials
        ? Effect.void
        : loginStored(profileName).pipe(Effect.asVoid)))), Match.exhaustive)
        .pipe(Effect.mapError((cause) => new AuthError({ message: "Render login failed", cause })));
    const logout = (profileName, config) => Match.value(config).pipe(Match.when({ method: "env" }, () => Effect.void), Match.when({ method: "stored" }, () => store
        .delete(profileName, STORAGE_KEY)
        .pipe(Effect.andThen(Clank.success("Render: stored credentials removed.")))), Match.exhaustive);
    const prettyPrint = (profileName, config) => read(profileName, config).pipe(Effect.tap((credentials) => Effect.all([
        Console.log(`  apiKey: ${displayRedacted(credentials.apiKey, 7)}`),
        Console.log(`  ownerId: ${credentials.ownerId}`),
        Console.log(`  apiBaseUrl: ${credentials.apiBaseUrl}`),
        Console.log(`  source: ${credentials.source.type}`),
    ])), Effect.asVoid);
    return { configure, login, logout, prettyPrint, read };
}));
//# sourceMappingURL=AuthProvider.js.map