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

function issue(key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '10001',
    key,
    fields: {
      summary: 'Add members table',
      status: { name: 'In Progress' },
      issuetype: { name: 'Task' },
      assignee: { displayName: 'Jane Doe', emailAddress: 'jane@acme.com' },
      description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Details' }] }] },
      labels: ['ui'],
      ...overrides,
    },
  };
}

test('JiraTicketService.getTicket fetches and maps a single issue', async () => {
  let url = '';
  globalThis.fetch = async (input) => {
    url = String(input);
    return response(issue('PRJ-1'));
  };

  try {
    const service = new JiraTicketService(makeConfig());
    const ticket = await service.getTicket('PRJ-1');

    assert.equal(url, 'https://acme.atlassian.net/rest/api/3/issue/PRJ-1');
    assert.deepEqual(ticket, {
      id: 'PRJ-1',
      title: 'Add members table',
      status: 'In Progress',
      type: 'Task',
      url: 'https://acme.atlassian.net/browse/PRJ-1',
      assignee: 'Jane Doe',
      description: 'Details',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.getTicketsForUser queries by assignee JQL', async () => {
  let url = '';
  globalThis.fetch = async (input) => {
    url = String(input);
    return response({ issues: [issue('PRJ-1'), issue('PRJ-2')], total: 2 });
  };

  try {
    const service = new JiraTicketService(makeConfig());
    const tickets = await service.getTicketsForUser('jane@acme.com');

    assert.ok(url.includes('/search?'));
    // URLSearchParams encodes spaces as '+' and quotes/equals via percent-encoding.
    const decoded = decodeURIComponent(url.replace(/\+/g, ' '));
    assert.ok(decoded.includes('assignee = "jane@acme.com"'));
    assert.ok(decoded.includes('statusCategory in (new, indeterminate)'));
    assert.equal(tickets.length, 2);
    assert.deepEqual(tickets.map((t) => t.id), ['PRJ-1', 'PRJ-2']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.createTicket posts a minimal issue with ADF description', async () => {
  let method = '';
  let url = '';
  let body: unknown;

  globalThis.fetch = async (input, init) => {
    method = init?.method ?? 'GET';
    url = String(input);
    body = JSON.parse(String(init?.body));
    return response(issue('PRJ-10'));
  };

  try {
    const service = new JiraTicketService(makeConfig());
    const ticket = await service.createTicket({ title: 'Add members table' });

    assert.equal(method, 'POST');
    assert.equal(url, 'https://acme.atlassian.net/rest/api/3/issue');
    assert.deepEqual(body, {
      fields: {
        project: { key: 'PRJ' },
        summary: 'Add members table',
        issuetype: { name: 'Task' },
      },
    });
    assert.equal(ticket.id, 'PRJ-10');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.createTicket maps kind, description, labels, and assignee', async () => {
  let body: unknown;
  const calls: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/user/search')) {
      return response([{ accountId: '5b10ac8d82e05b22cc7d4ef5' }]);
    }
    body = JSON.parse(String(init?.body));
    return response(issue('PRJ-11'));
  };

  try {
    const service = new JiraTicketService(makeConfig());
    await service.createTicket({
      title: 'Fix login',
      description: 'Broken\non mobile',
      kind: 'bug',
      assignee: 'jane@acme.com',
      labels: ['auth', 'p1'],
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(body, {
      fields: {
        project: { key: 'PRJ' },
        summary: 'Fix login',
        issuetype: { name: 'Bug' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Broken' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'on mobile' }] },
          ],
        },
        labels: ['auth', 'p1'],
        assignee: { id: '5b10ac8d82e05b22cc7d4ef5' },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.createTicket creates a subtask when parentId is set', async () => {
  let body: unknown;

  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return response(issue('PRJ-12', { parent: { key: 'PRJ-5' } }));
  };

  try {
    const service = new JiraTicketService(makeConfig());
    const ticket = await service.createTicket({ title: 'Subtask', parentId: 'PRJ-5' });

    assert.deepEqual(body, {
      fields: {
        project: { key: 'PRJ' },
        summary: 'Subtask',
        issuetype: { name: 'Sub-task' },
        parent: { key: 'PRJ-5' },
      },
    });
    assert.equal(ticket.parentId, 'PRJ-5');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.updateStatus transitions to the matching state', async () => {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const call = { method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (url.includes('/transitions') && call.method === 'GET') {
      return response({ transitions: [{ id: '11', name: 'Start', to: { name: 'In Review' } }] });
    }
    return response({});
  };

  try {
    const service = new JiraTicketService(makeConfig());
    await service.updateStatus('PRJ-1', 'In Review');

    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, 'POST');
    assert.deepEqual(calls[1].body, { transition: { id: '11' } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.updateStatus reports available transitions on failure', async () => {
  globalThis.fetch = async () =>
    response({ transitions: [{ id: '11', to: { name: 'Done' } }] });

  try {
    const service = new JiraTicketService(makeConfig());
    await assert.rejects(
      service.updateStatus('PRJ-1', 'In Review'),
      (err: unknown) =>
        err instanceof JiraApiError &&
        err.message.includes('no transition') &&
        err.message.includes('Done'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.updateStatus rejects a board column (no such concept)', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return response({});
  };

  try {
    const service = new JiraTicketService(makeConfig());
    await assert.rejects(
      service.updateStatus('PRJ-1', 'In Review', 'Code Review'),
      (err: unknown) =>
        err instanceof JiraApiError &&
        err.message.includes('no board-column concept'),
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService surfaces Jira API errors with detail', async () => {
  globalThis.fetch = async () =>
    response({ errorMessages: ['Issue does not exist.'], errors: {} }, 404);

  try {
    const service = new JiraTicketService(makeConfig());
    await assert.rejects(
      service.getTicket('NOPE-1'),
      (err: unknown) =>
        err instanceof JiraApiError &&
        err.status === 404 &&
        err.message.includes('Issue does not exist'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
