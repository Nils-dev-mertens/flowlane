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
