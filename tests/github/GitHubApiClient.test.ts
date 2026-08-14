import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubApiClient, GitHubApiError } from '../../src/services/github/GitHubApiClient';

const originalFetch = globalThis.fetch;

test('GitHubApiClient paginates REST collections and sends auth headers', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });

    if (new URL(url).searchParams.get('page') === '1') {
      return new Response(JSON.stringify(firstPage), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          link: '<https://api.github.test/repos/me/demo/issues?per_page=100&page=2>; rel="next"',
        },
      });
    }

    return new Response(JSON.stringify([{ id: 101 }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const client = new GitHubApiClient({
      token: 'test-token',
      baseUrl: 'https://api.github.test',
    });
    const result = await client.getPaginated<{ id: number }>('/repos/me/demo/issues');

    assert.equal(result.length, 101);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://api.github.test/repos/me/demo/issues?per_page=100&page=1');
    assert.equal(requests[0].init?.method, 'GET');
    assert.equal(requests[1].url, 'https://api.github.test/repos/me/demo/issues?per_page=100&page=2');
    assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubApiClient reports GraphQL errors', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    errors: [{ message: 'Resource not accessible by integration' }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const client = new GitHubApiClient({ token: 'test-token' });
    await assert.rejects(
      client.graphql('query Test { viewer { login } }'),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.message === 'GitHub GraphQL error: Resource not accessible by integration',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
