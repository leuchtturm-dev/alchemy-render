import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { getAuthProvider } from "alchemy/Auth/AuthProvider";
import { ALCHEMY_PROFILE, AlchemyProfile } from "alchemy/Auth/Profile";
import {
  RENDER_AUTH_PROVIDER_NAME,
  type RenderAuthConfig,
  type RenderResolvedCredentials,
} from "./AuthProvider.js";
import { DEFAULT_API_BASE_URL } from "./Config.js";

export interface RenderCredentials {
  readonly apiKey: Redacted.Redacted<string>;
  readonly ownerId: string;
  /** Exact API root, including `/v1`. */
  readonly apiBaseUrl: string;
}

/** Lazy credentials used by every Render provider operation. */
export class Credentials extends Context.Service<
  Credentials,
  Effect.Effect<RenderCredentials>
>()("Render.Credentials") {}

export interface ApiKeyCredentials {
  readonly apiKey: string | Redacted.Redacted<string>;
  readonly ownerId: string;
  readonly apiBaseUrl?: string;
}

/** Explicit credentials layer for tests and non-profile embedding. */
export const fromApiKey = (input: ApiKeyCredentials) =>
  Layer.succeed(
    Credentials,
    Effect.succeed({
      apiKey: Redacted.isRedacted(input.apiKey)
        ? input.apiKey
        : Redacted.make(input.apiKey),
      ownerId: input.ownerId,
      apiBaseUrl: input.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    }),
  );

/** Resolve credentials lazily through the active Alchemy profile. */
export const fromAuthProvider = () =>
  Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const profile = yield* AlchemyProfile;
      const auth = yield* getAuthProvider<
        RenderAuthConfig,
        RenderResolvedCredentials
      >(RENDER_AUTH_PROVIDER_NAME);
      const profileName = yield* ALCHEMY_PROFILE;
      const ci = yield* Config.boolean("CI").pipe(Config.withDefault(false));
      return yield* profile.loadOrConfigure(auth, profileName, { ci }).pipe(
        Effect.flatMap((config) => auth.read(profileName, config)),
        Effect.map(({ apiKey, ownerId, apiBaseUrl }) => ({
          apiKey,
          ownerId,
          apiBaseUrl,
        })),
        Effect.orDie,
        Effect.cached,
      );
    }),
  );
