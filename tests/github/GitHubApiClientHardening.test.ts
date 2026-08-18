import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubApiClient, GitHubApiError } from '../../src/services/github/GitHubApiClient';

const originalFetch = globalThis.fetch;

test('GitHubApiClient uses a configured GraphQL endpoint', async () => {
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ data: { viewer: { login: 'me' } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new GitHubApiClient({
      token: 'test-token',
      graphqlUrl: 'https://ghe.example.test/api/graphql',
    });
    const result = await client.graphql<{ viewer: { login: string } }>('query Viewer { viewer { login } }');

    assert.equal(requestedUrl, 'https://ghe.example.test/api/graphql');
    assert.equal(result.viewer.login, 'me');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubApiClient reports rate-limit context', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
    status: 403,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1780000000',
    },
  });

  try {
    const client = new GitHubApiClient({ token: 'test-token' });
    await assert.rejects(
      client.request('GET', '/rate-limited'),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.status === 403 &&
        error.rateLimitRemaining === '0' &&
        error.message.includes('rate limit resets at'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubApiClient rejects invalid JSON responses', async () => {
  globalThis.fetch = async () => new Response('not-json', {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });

  try {
    const client = new GitHubApiClient({ token: 'test-token' });
    await assert.rejects(
      client.request('GET', '/invalid-json'),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.message === 'GitHub API response was not valid JSON.',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubApiClient includes GitHub validation details in API errors', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: 'Validation Failed',
    errors: [{ resource: 'Issue', field: 'assignee', code: 'invalid', value: 'me@example.com' }],
  }), {
    status: 422,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const client = new GitHubApiClient({ token: 'test-token' });
    await assert.rejects(
      client.request('GET', '/issues'),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.message.includes('Validation Failed') &&
        error.message.includes('assignee') &&
        error.status === 422,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubApiClient retries transient 503 responses with backoff', async () => {
  const calls: string[] = [];
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt += 1;
    calls.push(`attempt-${attempt}`);
    if (attempt < 3) {
      return new Response(JSON.stringify({ message: 'No server is currently available' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ id: 42 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new GitHubApiClient({
      token: 'test-token',
      retryDelayMs: 1,
      maxRetries: 3,
    });
    const result = await client.request<{ id: number }>('GET', '/repos/me/demo/pulls/42');
    assert.equal(result.id, 42);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubApiClient honors Retry-After and gives up after max retries', async () => {
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt += 1;
    return new Response(JSON.stringify({ message: 'Server unavailable' }), {
      status: 503,
      headers: {
        'content-type': 'application/json',
        'retry-after': '0',
      },
    });
  };

  try {
    const client = new GitHubApiClient({
      token: 'test-token',
      retryDelayMs: 1,
      maxRetries: 2,
    });
    await assert.rejects(
      client.request('GET', '/repos/me/demo/pulls/42'),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.status === 503 &&
        error.message.includes('GitHub API error 503'),
    );
    assert.equal(attempt, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubApiClient does not retry non-transient errors', async () => {
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt += 1;
    return new Response(JSON.stringify({ message: 'Validation Failed' }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new GitHubApiClient({ token: 'test-token', maxRetries: 3 });
    await assert.rejects(
      client.request('GET', '/repos/me/demo/pulls'),
      (error: unknown) => error instanceof GitHubApiError && error.status === 422,
    );
    assert.equal(attempt, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
