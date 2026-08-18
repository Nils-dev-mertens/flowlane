import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { GitHubVcsService } from '../../src/services/github/GitHubVcsService';

const originalFetch = globalThis.fetch;

function makeConfig(): IConfigService {
  return {
    getProviderConfig(provider: string) {
      assert.equal(provider, 'github');
      return { owner: 'me', repo: 'demo', token: 'test-token', user: 'me' };
    },
  } as IConfigService;
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installGitHubReviewMock(): { mutations: number } {
  const state = { mutations: 0 };

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const parsed = new URL(url);

    if (parsed.pathname === '/graphql') {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes('mutation ResolveReviewThread')) {
        state.mutations += 1;
        return response({ data: { resolveReviewThread: { thread: { id: 'thread-active', isResolved: true } } } });
      }

      return response({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: 'thread-resolved',
                    isResolved: true,
                    path: 'src/old.ts',
                    line: 4,
                    startLine: null,
                    comments: { nodes: [{ databaseId: 10 }] },
                  },
                  {
                    id: 'thread-active',
                    isResolved: false,
                    path: 'src/new.ts',
                    line: 8,
                    startLine: null,
                    comments: { nodes: [{ databaseId: 11 }] },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      });
    }

    if (parsed.pathname.endsWith('/pulls/42/comments')) {
      return response([
        {
          id: 10,
          user: { login: 'reviewer' },
          body: 'Already fixed',
          path: 'src/old.ts',
          line: 4,
          original_line: 4,
          created_at: '2026-08-14T10:00:00Z',
        },
        {
          id: 11,
          user: { login: 'reviewer' },
          body: 'Please simplify this',
          path: 'src/new.ts',
          line: 8,
          original_line: 8,
          created_at: '2026-08-14T11:00:00Z',
        },
        {
          id: 12,
          in_reply_to_id: 11,
          user: { login: 'me' },
          body: 'I will update it',
          path: 'src/new.ts',
          line: 8,
          original_line: 8,
          created_at: '2026-08-14T11:01:00Z',
        },
      ]);
    }

    if (parsed.pathname.endsWith('/issues/42/comments')) {
      return response([]);
    }

    throw new Error(`Unexpected mocked GitHub request: ${url}`);
  };

  return state;
}

test('GitHubVcsService filters resolved review threads', async () => {
  installGitHubReviewMock();

  try {
    const service = new GitHubVcsService(makeConfig());
    const active = await service.getThreads(42, true);
    const all = await service.getThreads(42, false);

    assert.deepEqual(active.map((thread) => thread.id), [11]);
    assert.equal(active[0].status, 'active');
    assert.equal(active[0].providerId, 'thread-active');
    assert.equal(active[0].comments.length, 2);
    assert.deepEqual(all.map((thread) => [thread.id, thread.status]), [
      [10, 'resolved'],
      [11, 'active'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubVcsService resolves an inline thread through GraphQL', async () => {
  const state = installGitHubReviewMock();

  try {
    const service = new GitHubVcsService(makeConfig());
    await service.resolveThread(42, 11);
    assert.equal(state.mutations, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubVcsService replies to an issue comment via the issue-comments endpoint', async () => {
  const posts: Array<{ url: string; body: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;

    if (path === '/graphql') {
      return response({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
    }
    if (method === 'POST' && path.endsWith('/comments')) {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return response({});
    }
    if (path.endsWith('/pulls/42/comments')) return response([]);
    if (path.endsWith('/issues/42/comments')) {
      return response([{ id: 99, user: { login: 'reviewer' }, body: 'Nice work', created_at: '2026-08-14T10:00:00Z' }]);
    }
    throw new Error(`Unexpected mocked GitHub request: ${url}`);
  };

  try {
    const service = new GitHubVcsService(makeConfig());
    await service.replyToThread(42, 99, 'Thanks!');

    assert.equal(posts.length, 1);
    assert.ok(posts[0].url.includes('/issues/42/comments'));
    assert.deepEqual(posts[0].body, { body: 'Thanks!' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubVcsService replies to an inline thread via the review-comments endpoint', async () => {
  const posts: Array<{ url: string; body: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;

    if (path === '/graphql') {
      return response({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
    }
    if (method === 'POST' && path.endsWith('/comments')) {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return response({});
    }
    if (path.endsWith('/pulls/42/comments')) {
      return response([{ id: 11, user: { login: 'reviewer' }, body: 'Simplify', path: 'src/new.ts', line: 8, original_line: 8, created_at: '2026-08-14T10:00:00Z' }]);
    }
    if (path.endsWith('/issues/42/comments')) return response([]);
    throw new Error(`Unexpected mocked GitHub request: ${url}`);
  };

  try {
    const service = new GitHubVcsService(makeConfig());
    await service.replyToThread(42, 11, 'Will do');

    assert.equal(posts.length, 1);
    assert.ok(posts[0].url.includes('/pulls/42/comments'));
    assert.deepEqual(posts[0].body, { body: 'Will do', in_reply_to: 11 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubVcsService surfaces an existing PR when PR creation 503s after the write', async () => {
  let postAttempts = 0;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;

    // Branch existence + commit-ahead checks for the create flow.
    if (method === 'GET' && path.endsWith('/branches/feature-1')) {
      return response({ name: 'feature-1', commit: { sha: 'abc' } });
    }
    if (method === 'GET' && path.endsWith('/branches/main')) {
      return response({ name: 'main', commit: { sha: 'def' } });
    }
    if (method === 'GET' && path.includes('/compare/main...feature-1')) {
      return response({ ahead_by: 3 });
    }
    if (method === 'GET' && path.endsWith('/pulls')) {
      // findPRForBranch: first call (before create) finds nothing; after the
      // failed POST the PR now exists.
      const hasExisting = postAttempts > 0;
      return hasExisting
        ? response([{ number: 50, title: '[1] Existing PR', html_url: 'https://github.com/me/demo/pull/50', state: 'open', user: { login: 'me' }, head: { ref: 'feature-1', sha: 'abc' }, base: { ref: 'main' }, draft: false, created_at: '2026-08-14T10:00:00Z' }])
        : response([]);
    }
    if (method === 'POST' && path.endsWith('/pulls')) {
      postAttempts += 1;
      return new Response(JSON.stringify({ message: 'No server is currently available' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected mocked GitHub request: ${url}`);
  };

  try {
    const service = new GitHubVcsService(makeConfig());
    const pr = await service.createPR({
      ticketId: '1',
      title: 'Existing PR',
      description: 'desc',
      sourceBranch: 'feature-1',
      targetBranch: 'main',
      isDraft: false,
    });

    assert.ok(postAttempts >= 1);
    assert.equal(pr.id, 50);
    assert.equal(pr.url, 'https://github.com/me/demo/pull/50');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
