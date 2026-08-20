import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { JiraTicketService } from '../../src/services/jira/JiraTicketService';
import { JiraApiError } from '../../src/services/jira/JiraApiClient';

const originalFetch = globalThis.fetch;

function makeConfig(): IConfigService {
  return {
    getProviderConfig(provider: string) {
      assert.equal(provider, 'jira');
      return { site: 'acme.atlassian.net', project: 'PRJ', token: 'api-token', user: 'jane@acme.com' };
    },
  } as IConfigService;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function transitions(...items: Array<{ id: string; name?: string; to?: { name?: string; statusCategory?: { key?: string } } }>): unknown {
  return { transitions: items };
}

test('JiraTicketService.closeTicket transitions to a done status', async () => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/transitions')) return response(
      transitions(
        { id: '31', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
        { id: '41', to: { name: 'Done', statusCategory: { key: 'done' } } },
      ),
    );
    return response({});
  };

  try {
    const service = new JiraTicketService(makeConfig());
    await service.closeTicket('PRJ-1');

    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].method, 'POST');
    assert.deepEqual(calls[1].body, { transition: { id: '41' } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.reopenTicket transitions to an open status', async () => {
  let posted: unknown;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/transitions') && (init?.method ?? 'GET') === 'GET') {
      return response(
        transitions(
          { id: '41', to: { name: 'Done', statusCategory: { key: 'done' } } },
          { id: '11', to: { name: 'To Do', statusCategory: { key: 'new' } } },
        ),
      );
    }
    posted = init?.body ? JSON.parse(String(init.body)) : undefined;
    return response({});
  };

  try {
    const service = new JiraTicketService(makeConfig());
    await service.reopenTicket('PRJ-1');
    assert.deepEqual(posted, { transition: { id: '11' } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.closeTicket reports available transitions when none close', async () => {
  globalThis.fetch = async () =>
    response(transitions({ id: '11', to: { name: 'To Do', statusCategory: { key: 'new' } } }));

  try {
    const service = new JiraTicketService(makeConfig());
    await assert.rejects(
      service.closeTicket('PRJ-1'),
      (err: unknown) =>
        err instanceof JiraApiError &&
        err.message.includes('no transition to Done') &&
        err.message.includes('To Do'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.addLabels merges with existing labels', async () => {
  let method = '';
  let url = '';
  let body: unknown;
  const calls: string[] = [];

  globalThis.fetch = async (input, init) => {
    const u = String(input);
    calls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.includes('?fields=labels')) {
      return response({ id: '10001', key: 'PRJ-1', fields: { labels: ['ui'] } });
    }
    method = init?.method ?? '';
    url = u;
    body = JSON.parse(String(init?.body));
    return response({});
  };

  try {
    const service = new JiraTicketService(makeConfig());
    await service.addLabels('PRJ-1', ['p1']);

    assert.deepEqual(calls, [
      'GET https://acme.atlassian.net/rest/api/3/issue/PRJ-1?fields=labels',
      'PUT https://acme.atlassian.net/rest/api/3/issue/PRJ-1',
    ]);
    assert.equal(method, 'PUT');
    assert.deepEqual(body, { fields: { labels: ['ui', 'p1'] } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.assignTicket resolves the account and PUTs the assignee', async () => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/user/search')) return response([{ accountId: '5b10ac8d82e05b22cc7d4ef5' }]);
    return response({});
  };

  try {
    const service = new JiraTicketService(makeConfig());
    await service.assignTicket('PRJ-1', 'jane@acme.com');

    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, 'PUT');
    assert.deepEqual(calls[1].body, { fields: { assignee: { id: '5b10ac8d82e05b22cc7d4ef5' } } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});