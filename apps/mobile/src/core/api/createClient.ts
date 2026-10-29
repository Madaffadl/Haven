import {
  apiErrorSchema,
  routes,
  tokenPairSchema,
  type ApiErrorCode,
  type TokenPair,
} from '@haven/contracts';

/**
 * The REST client, as a factory over its dependencies so the token logic can
 * be tested in plain Node (test/api.test.ts) with a fake fetch and an
 * in-memory token store. ./index.ts wires the real ones.
 */

export interface TokenStore {
  read(): Promise<TokenPair | null>;
  write(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

/** Anything with zod's `parse`: keeps zod itself out of this package's imports. */
export interface Parser<T> {
  parse(value: unknown): T;
}

export class ApiRequestError extends Error {
  constructor(
    /** 0 when the request never reached the server. */
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

interface ClientDeps {
  baseUrl: string;
  fetch: typeof fetch;
  tokens: TokenStore;
  /** The session is gone for good (refresh rejected). Called once per expiry. */
  onSessionExpired: () => void;
  now?: () => number;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** False for the sign-in calls that happen before there is a session. */
  auth?: boolean;
}

/**
 * Refresh this long before the access token expires rather than after, so a
 * request does not set off with a token that dies in flight.
 */
const EXPIRY_MARGIN_MS = 60_000;

const signedOut = () => new ApiRequestError(401, 'unauthenticated', 'signed out');

export const createApiClient = (deps: ClientDeps) => {
  const now = deps.now ?? Date.now;

  const send = async (
    method: string,
    path: string,
    body: unknown,
    accessToken: string | null,
  ): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    const init: RequestInit = { method, headers };
    // Only with a body: Fastify rejects an empty body declared as JSON.
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    try {
      return await deps.fetch(`${deps.baseUrl}${path}`, init);
    } catch {
      throw new ApiRequestError(0, 'network', "can't reach Haven");
    }
  };

  const toError = async (response: Response): Promise<ApiRequestError> => {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      return new ApiRequestError(response.status, 'internal', `HTTP ${response.status}`);
    }
    const { code, message, retryAfterMs } = parsed.data.error;
    return new ApiRequestError(response.status, code, message, retryAfterMs);
  };

  const expire = async (): Promise<void> => {
    await deps.tokens.clear();
    deps.onSessionExpired();
  };

  /**
   * Single-flight. Refresh tokens rotate on every use, so two refreshes
   * racing with the same token would leave the loser signed out. Every
   * caller that needs a refresh while one is running waits for that one.
   *
   * Only a 401 ends the session. A network failure or a 5xx keeps the tokens:
   * a phone in a tunnel must not sign its owner out.
   */
  let inflight: Promise<TokenPair | null> | null = null;

  const refresh = (): Promise<TokenPair | null> => {
    inflight ??= (async () => {
      const current = await deps.tokens.read();
      if (!current) return null;

      const response = await send(
        'POST',
        routes.refresh,
        { refreshToken: current.refreshToken },
        null,
      );
      if (response.status === 401) {
        await expire();
        return null;
      }
      if (!response.ok) throw await toError(response);

      const next = tokenPairSchema.parse(await response.json());
      await deps.tokens.write(next);
      return next;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  };

  /** A usable access token, refreshed first if it is about to expire. */
  const accessToken = async (): Promise<string | null> => {
    const tokens = await deps.tokens.read();
    if (!tokens) return null;
    if (Date.parse(tokens.accessExpiresAt) - now() > EXPIRY_MARGIN_MS) return tokens.accessToken;
    return (await refresh())?.accessToken ?? null;
  };

  async function request<T>(path: string, options: RequestOptions, schema: Parser<T>): Promise<T>;
  async function request(path: string, options?: RequestOptions): Promise<void>;
  async function request<T>(
    path: string,
    { method = 'GET', body, auth = true }: RequestOptions = {},
    schema?: Parser<T>,
  ): Promise<T | void> {
    let token = auth ? await accessToken() : null;
    if (auth && !token) throw signedOut();

    let response = await send(method, path, body, token);

    // The token was fine by the clock but the server disagrees, e.g. after a
    // restart with a rotated secret. One refresh, one retry, then give up.
    if (auth && response.status === 401) {
      token = (await refresh())?.accessToken ?? null;
      if (!token) throw signedOut();

      response = await send(method, path, body, token);
      if (response.status === 401) {
        await expire();
        throw signedOut();
      }
    }

    if (!response.ok) throw await toError(response);
    if (!schema) return;
    return schema.parse(await response.json());
  }

  return { request, accessToken };
};

export type ApiClient = ReturnType<typeof createApiClient>;
