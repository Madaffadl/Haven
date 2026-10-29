import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { meSchema, routes, type TokenPair } from '@haven/contracts';

import { ApiRequestError, createApiClient, type TokenStore } from '../src/core/api/createClient.js';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const ME = {
  userId: '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f01',
  email: 'maya@mail.com',
  displayName: 'Maya',
  avatarUrl: null,
  accentHex: '#B9A7FF',
  trustMode: 'precise',
};

const tokens = (n: number, expiresInMs = 15 * 60_000): TokenPair => ({
  accessToken: `access-${n}`,
  accessExpiresAt: new Date(NOW + expiresInMs).toISOString(),
  refreshToken: `refresh-${n}`.padEnd(43, 'x'),
});

const memoryStore = (initial: TokenPair | null) => {
  let value = initial;
  const store: TokenStore & { value: () => TokenPair | null } = {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    clear: async () => {
      value = null;
    },
    value: () => value,
  };
  return store;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  auth: string | undefined;
  body: unknown;
}

/** A fake server: `handle` decides each response; every call is recorded. */
const harness = (
  store: TokenStore,
  handle: (call: Call, n: number) => Response | Promise<Response>,
) => {
  const calls: Call[] = [];
  let expired = 0;
  const client = createApiClient({
    baseUrl: 'https://api.test',
    tokens: store,
    now: () => NOW,
    onSessionExpired: () => {
      expired += 1;
    },
    fetch: async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: Call = {
        url: String(input),
        method: init?.method ?? 'GET',
        auth: headers['Authorization'],
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      return handle(call, calls.length);
    },
  });
  return { client, calls, expired: () => expired };
};

describe('api client', () => {
  it('sends the access token and parses the response', async () => {
    const store = memoryStore(tokens(1));
    const { client, calls } = harness(store, () => json(200, ME));

    const me = await client.request(routes.me, {}, meSchema);

    assert.equal(me.displayName, 'Maya');
    assert.equal(calls[0]!.auth, 'Bearer access-1');
    assert.equal(calls[0]!.url, 'https://api.test/v1/me');
  });

  it('omits the body and its content type when there is none', async () => {
    const store = memoryStore(tokens(1));
    let contentType: string | undefined = 'unset';
    const client = createApiClient({
      baseUrl: '',
      tokens: store,
      now: () => NOW,
      onSessionExpired: () => {},
      fetch: async (_input, init) => {
        contentType = (init?.headers as Record<string, string>)['Content-Type'];
        assert.equal(init?.body, undefined);
        return new Response(null, { status: 204 });
      },
    });

    await client.request(routes.acceptInvite('K7M2QX'), { method: 'POST' });
    assert.equal(contentType, undefined);
  });

  it('refreshes on a 401 and retries once with the new token', async () => {
    const store = memoryStore(tokens(1));
    const { client, calls } = harness(store, (call) => {
      if (call.url.endsWith(routes.refresh)) return json(200, tokens(2));
      return call.auth === 'Bearer access-2' ? json(200, ME) : json(401, {});
    });

    await client.request(routes.me, {}, meSchema);

    assert.deepEqual(
      calls.map((c) => c.url.replace('https://api.test', '')),
      [routes.me, routes.refresh, routes.me],
    );
    assert.equal(
      calls[1]!.body && (calls[1]!.body as { refreshToken: string }).refreshToken,
      tokens(1).refreshToken,
    );
    assert.equal(store.value()?.accessToken, 'access-2');
  });

  it('refreshes before sending when the token is about to expire', async () => {
    const store = memoryStore(tokens(1, 10_000));
    const { client, calls } = harness(store, (call) =>
      call.url.endsWith(routes.refresh) ? json(200, tokens(2)) : json(200, ME),
    );

    await client.request(routes.me, {}, meSchema);

    assert.equal(calls[0]!.url, `https://api.test${routes.refresh}`);
    assert.equal(calls[1]!.auth, 'Bearer access-2');
  });

  it('runs one refresh for many concurrent requests', async () => {
    // Refresh tokens rotate: a second refresh with the same token would fail
    // and sign the user out. Only one may be in flight.
    const store = memoryStore(tokens(1, 10_000));
    let refreshes = 0;
    const { client } = harness(store, async (call) => {
      if (call.url.endsWith(routes.refresh)) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(200, tokens(2));
      }
      return json(200, ME);
    });

    await Promise.all([1, 2, 3, 4].map(() => client.request(routes.me, {}, meSchema)));
    assert.equal(refreshes, 1);
  });

  it('signs out when the refresh token is rejected', async () => {
    const store = memoryStore(tokens(1));
    const { client, expired } = harness(store, () => json(401, {}));

    await assert.rejects(client.request(routes.me, {}, meSchema), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.code, 'unauthenticated');
      return true;
    });
    assert.equal(store.value(), null);
    assert.equal(expired(), 1);
  });

  it('keeps the session through network failures', async () => {
    const store = memoryStore(tokens(1, 10_000));
    const client = createApiClient({
      baseUrl: '',
      tokens: store,
      now: () => NOW,
      onSessionExpired: () => assert.fail('must not sign out offline'),
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
    });

    await assert.rejects(client.request(routes.me, {}, meSchema), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.code, 'network');
      assert.equal(error.status, 0);
      return true;
    });
    assert.equal(store.value()?.refreshToken, tokens(1).refreshToken);
  });

  it('keeps the session when the refresh endpoint has a server error', async () => {
    const store = memoryStore(tokens(1, 10_000));
    const { client, expired } = harness(store, () =>
      json(503, { error: { code: 'internal', message: 'down' } }),
    );

    await assert.rejects(client.request(routes.me, {}, meSchema));
    assert.equal(expired(), 0);
    assert.ok(store.value());
  });

  it('surfaces the error envelope, including retry timing', async () => {
    const store = memoryStore(null);
    const { client } = harness(store, () =>
      json(429, { error: { code: 'rate_limited', message: 'slow down', retryAfterMs: 90_000 } }),
    );

    await assert.rejects(
      client.request(routes.emailStart, { method: 'POST', body: { email: 'a@b.co' }, auth: false }),
      (error: unknown) => {
        assert.ok(error instanceof ApiRequestError);
        assert.equal(error.status, 429);
        assert.equal(error.code, 'rate_limited');
        assert.equal(error.retryAfterMs, 90_000);
        return true;
      },
    );
  });

  it('refuses authenticated calls with no session, without a request', async () => {
    const { client, calls } = harness(memoryStore(null), () => json(200, ME));
    await assert.rejects(client.request(routes.me, {}, meSchema));
    assert.equal(calls.length, 0);
  });
});
