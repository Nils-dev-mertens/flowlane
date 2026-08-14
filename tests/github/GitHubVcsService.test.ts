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
