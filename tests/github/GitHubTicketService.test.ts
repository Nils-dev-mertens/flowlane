import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { GitHubTicketService } from '../../src/services/github/GitHubTicketService';

const originalFetch = globalThis.fetch;

function makeConfig(): IConfigService {
  const values = {
    org: 'me',
    project: 'demo',
    repo: 'demo',
    token: 'test-token',
    user: 'me',
  };

  return {
    get<T = unknown>(key: keyof typeof values): T | undefined {
      return values[key] as T | undefined;
    },
  } as IConfigService;
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('GitHubTicketService maps issues and excludes pull requests', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/issues/42')) {
      return response({
        number: 42,
        title: 'Fix login',
        state: 'open',
        html_url: 'https://github.test/me/demo/issues/42',
        assignee: { login: 'me' },
        body: 'Details',
        labels: [{ name: 'bug' }],
      });
    }
    if (url.pathname.endsWith('/issues')) {
      return response([
        {
          number: 42,
          title: 'Fix login',
          state: 'open',
          html_url: 'https://github.test/me/demo/issues/42',
          assignee: { login: 'me' },
          body: 'Details',
          labels: [{ name: 'bug' }],
        },
        {
          number: 43,
          title: 'A pull request',
          state: 'open',
          html_url: 'https://github.test/me/demo/pulls/43',
          assignee: { login: 'me' },
          body: null,
          labels: [],
          pull_request: {},
        },
      ]);
    }
    throw new Error(`Unexpected mocked GitHub request: ${String(input)}`);
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    const ticket = await service.getTicket('42');
    const tickets = await service.getTicketsForUser('me');

    assert.deepEqual(ticket, {
      id: '42',
      title: 'Fix login',
      status: 'open',
      url: 'https://github.test/me/demo/issues/42',
      assignee: 'me',
      description: 'Details',
      type: 'bug',
    });
    assert.deepEqual(tickets.map((item) => item.id), ['42']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService maps closed status to GitHub issue state', async () => {
  let method = '';
  let body: unknown;

  globalThis.fetch = async (input, init) => {
    method = init?.method ?? '';
    body = JSON.parse(String(init?.body));
    assert.equal(String(input), 'https://api.github.com/repos/me/demo/issues/42');
    return response({});
  };

  try {
    const service = new GitHubTicketService(makeConfig());
    await service.updateStatus('42', 'Closed');
    assert.equal(method, 'PATCH');
    assert.deepEqual(body, { state: 'closed' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubTicketService resolves a configured git email to the authenticated GitHub login', async () => {
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);

    if (url === 'https://api.github.com/user') {
      return response({ login: 'me' });
    }
    if (new URL(url).pathname.endsWith('/issues')) {
      assert.equal(new URL(url).searchParams.get('assignee'), 'me');
      return response([]);
    }
    throw new Error(`Unexpected mocked GitHub request: ${url}`);
  };

  try {
    const values = {
      org: 'me',
      project: 'demo',
      repo: 'demo',
      token: 'test-token',
      user: 'me@example.com',
    };
    const config = {
      get<T = unknown>(key: keyof typeof values): T | undefined {
        return values[key] as T | undefined;
      },
    } as IConfigService;

    const service = new GitHubTicketService(config);
    await service.getTicketsForUser(values.user);

    assert.deepEqual(requests, [
      'https://api.github.com/user',
      'https://api.github.com/repos/me/demo/issues?state=open&assignee=me&per_page=100&page=1',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
