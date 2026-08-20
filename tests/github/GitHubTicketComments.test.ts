import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { GitHubTicketService } from '../../src/services/github/GitHubTicketService';

const originalFetch = globalThis.fetch;

function makeConfig(overrides: Record<string, unknown> = {}): IConfigService {
  return {
    getProviderConfig(provider: string) {
      assert.equal(provider, 'github');
      return { owner: 'me', repo: 'demo', token: 'test-token', user: 'me', ...overrides };
    },
  } as IConfigService;
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function comment(id: number, login: string, createdAt: string, body: string): Record<string, unknown> {
  return { id, body, user: { login }, created_at: createdAt };
}

test('GitHubTicketService.addComment posts via the REST API with the stored token', async () => {
  let method = '';
  let url = '';
  let authHeader = '';
  let body: unknown;

  globalThis.fetch = async (input, init) => {
    method = init?.method ?? '';
    url = String(input);
    authHeader = (init?.headers as Record<string, string>).Authorization;
    body = JSON.parse(String(init?.body));
    return response(comment(101, 'octocat', '2026-08-20T10:00:00Z', 'Thanks for the detail'));
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    const created = await service.addComment('42', 'Thanks for the detail');

    assert.equal(method, 'POST');
    assert.equal(url, 'https://api.github.com/repos/me/demo/issues/42/comments');
    assert.equal(authHeader, 'Bearer test-token');
    assert.deepEqual(body, { body: 'Thanks for the detail' });
    assert.deepEqual(created, {
      id:          '101',
      author:      'octocat',
      content:     'Thanks for the detail',
      publishedAt: new Date('2026-08-20T10:00:00Z'),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService.getComments lists and maps comments oldest first', async () => {
  let url = '';
  globalThis.fetch = async (input) => {
    url = String(input);
    return response([
      comment(102, 'me', '2026-08-20T12:00:00Z', 'Second'),
      comment(101, 'octocat', '2026-08-20T10:00:00Z', 'First'),
    ]);
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    const comments = await service.getComments('42');

    assert.ok(url.startsWith('https://api.github.com/repos/me/demo/issues/42/comments'));
    assert.deepEqual(comments.map((item) => item.id), ['101', '102']);
    assert.equal(comments[0].content, 'First');
    assert.equal(comments[0].author, 'octocat');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService.addComment authenticates via "gh auth token" when authMethod is gh-cli', async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const childProcess = require('node:child_process') as typeof import('node:child_process');
  let authHeader = '';

  globalThis.fetch = async (_input, init) => {
    authHeader = (init?.headers as Record<string, string>).Authorization;
    return response(comment(103, 'me', '2026-08-20T12:00:00Z', 'via gh'));
  };

  mock.method(childProcess, 'execSync', () => 'gh-cli-token-xyz');
  try {
    const service = new GitHubTicketService(makeConfig({ authMethod: 'gh-cli', token: undefined }));
    await service.addComment('42', 'via gh');
    assert.equal(authHeader, 'Bearer gh-cli-token-xyz');
  } finally {
    mock.restoreAll();
    globalThis.fetch = originalFetch;
  }
});