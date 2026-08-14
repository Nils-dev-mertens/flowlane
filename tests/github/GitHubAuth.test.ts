import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubApiClient, GitHubApiError } from '../../src/services/github/GitHubApiClient';

const originalFetch = globalThis.fetch;

test('GitHubApiClient allows anonymous public reads without Authorization', async () => {
  let headers: Record<string, string> | undefined;
  globalThis.fetch = async (_input, init) => {
    headers = init?.headers as Record<string, string>;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new GitHubApiClient({});
    const result = await client.request<{ ok: boolean }>('GET', '/public');

    assert.deepEqual(result, { ok: true });
    assert.equal(headers?.Authorization, undefined);
    assert.equal(client.hasToken, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubApiClient requires a token for writes and GraphQL', async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };

  try {
    const client = new GitHubApiClient({});

    await assert.rejects(
      client.request('POST', '/issues'),
      (error: unknown) => error instanceof GitHubApiError && error.message.includes('require a GitHub token'),
    );
    await assert.rejects(
      client.graphql('query Viewer { viewer { login } }'),
      (error: unknown) => error instanceof GitHubApiError && error.message.includes('require a GitHub token'),
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
