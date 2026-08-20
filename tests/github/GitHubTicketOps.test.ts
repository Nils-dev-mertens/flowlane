import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { GitHubTicketService } from '../../src/services/github/GitHubTicketService';

const originalFetch = globalThis.fetch;

function makeConfig(user = 'me'): IConfigService {
  return {
    getProviderConfig(provider: string) {
      assert.equal(provider, 'github');
      return { owner: 'me', repo: 'demo', token: 'test-token', user };
    },
  } as IConfigService;
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('GitHubTicketService.closeTicket closes the issue', async () => {
  let method = '';
  let url = '';
  let body: unknown;
  globalThis.fetch = async (input, init) => {
    method = init?.method ?? '';
    url = String(input);
    body = JSON.parse(String(init?.body));
    return response({});
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    await service.closeTicket('42');
    assert.equal(method, 'PATCH');
    assert.equal(url, 'https://api.github.com/repos/me/demo/issues/42');
    assert.deepEqual(body, { state: 'closed' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService.reopenTicket opens the issue', async () => {
  let body: unknown;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return response({});
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    await service.reopenTicket('42');
    assert.deepEqual(body, { state: 'open' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService.addLabels posts to the labels endpoint', async () => {
  let method = '';
  let url = '';
  let body: unknown;
  globalThis.fetch = async (input, init) => {
    method = init?.method ?? '';
    url = String(input);
    body = JSON.parse(String(init?.body));
    return response([]);
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    await service.addLabels('42', ['p1', 'auth']);
    assert.equal(method, 'POST');
    assert.equal(url, 'https://api.github.com/repos/me/demo/issues/42/labels');
    assert.deepEqual(body, { labels: ['p1', 'auth'] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService.assignTicket patches the assignee login', async () => {
  let method = '';
  let url = '';
  let body: unknown;
  globalThis.fetch = async (input, init) => {
    method = init?.method ?? '';
    url = String(input);
    body = JSON.parse(String(init?.body));
    return response({});
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    await service.assignTicket('42', 'octocat');
    assert.equal(method, 'PATCH');
    assert.equal(url, 'https://api.github.com/repos/me/demo/issues/42');
    assert.deepEqual(body, { assignees: ['octocat'] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService.assignTicket resolves an email to the authenticated login', async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://api.github.com/user') return response({ login: 'me' });
    return response({});
  };

  try {
    const service = new GitHubTicketService(makeConfig('me@example.com'));
    await service.assignTicket('42', 'me@example.com');
    assert.deepEqual(calls, ['https://api.github.com/user', 'https://api.github.com/repos/me/demo/issues/42']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});