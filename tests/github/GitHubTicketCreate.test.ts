import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { GitHubTicketService } from '../../src/services/github/GitHubTicketService';
import { GitHubApiError } from '../../src/services/github/GitHubApiClient';

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

function issue(number: number): Record<string, unknown> {
  return {
    number,
    title: 'Add members table',
    state: 'open',
    html_url: `https://github.test/me/demo/issues/${number}`,
    assignee: { login: 'me' },
    body: 'Details',
    labels: [{ name: 'bug' }],
  };
}

test('GitHubTicketService.createTicket posts a minimal issue', async () => {
  let method = '';
  let url = '';
  let body: unknown;

  globalThis.fetch = async (input, init) => {
    method = init?.method ?? 'GET';
    url = String(input);
    body = JSON.parse(String(init?.body));
    return response(issue(74));
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    const ticket = await service.createTicket({ title: 'Add members table' });

    assert.equal(method, 'POST');
    assert.equal(url, 'https://api.github.com/repos/me/demo/issues');
    assert.deepEqual(body, { title: 'Add members table', body: '' });
    assert.deepEqual(ticket, {
      id: '74',
      title: 'Add members table',
      status: 'open',
      url: 'https://github.test/me/demo/issues/74',
      assignee: 'me',
      description: 'Details',
      type: 'bug',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService.createTicket maps kind, labels, assignee, and description', async () => {
  let body: unknown;

  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return response(issue(75));
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    await service.createTicket({
      title: 'Add members table',
      description: 'A table for members',
      kind: 'bug',
      assignee: 'octocat',
      labels: ['ui'],
    });

    assert.deepEqual(body, {
      title: 'Add members table',
      body: 'A table for members',
      assignee: 'octocat',
      labels: ['bug', 'ui'],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService.createTicket rejects a parent work item', async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return response(issue(76));
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    await assert.rejects(
      service.createTicket({ title: 'Child', parentId: '12' }),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.message.includes('no parent work item'),
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
