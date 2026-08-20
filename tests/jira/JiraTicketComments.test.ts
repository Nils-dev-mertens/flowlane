import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { JiraTicketService } from '../../src/services/jira/JiraTicketService';

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

function comment(id: string, displayName: string, created: string, text: string): Record<string, unknown> {
  return {
    id,
    author: { displayName, emailAddress: 'x@y.com' },
    created,
    body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  };
}

test('JiraTicketService.addComment posts an ADF comment', async () => {
  let method = '';
  let url = '';
  let body: unknown;

  globalThis.fetch = async (input, init) => {
    method = init?.method ?? 'GET';
    url = String(input);
    body = JSON.parse(String(init?.body));
    return response(comment('10001', 'Jane Doe', '2026-08-20T09:00:00.000+0000', 'Fix this please'));
  };

  try {
    const service = new JiraTicketService(makeConfig());
    const created = await service.addComment('PRJ-1', 'Fix this please');

    assert.equal(method, 'POST');
    assert.equal(url, 'https://acme.atlassian.net/rest/api/3/issue/PRJ-1/comment');
    assert.deepEqual(body, {
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fix this please' }] }],
      },
    });
    assert.deepEqual(created, {
      id:          '10001',
      author:      'Jane Doe',
      content:     'Fix this please',
      publishedAt: new Date('2026-08-20T09:00:00.000+0000'),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('JiraTicketService.getComments lists comments oldest first', async () => {
  let url = '';
  globalThis.fetch = async (input) => {
    url = String(input);
    return response({
      comments: [
        comment('10002', 'Bob', '2026-08-20T12:00:00.000+0000', 'Second'),
        comment('10001', 'Jane Doe', '2026-08-20T09:00:00.000+0000', 'First'),
      ],
    });
  };

  try {
    const service = new JiraTicketService(makeConfig());
    const comments = await service.getComments('PRJ-1');

    assert.equal(url, 'https://acme.atlassian.net/rest/api/3/issue/PRJ-1/comment');
    assert.deepEqual(comments.map((item) => item.id), ['10001', '10002']);
    assert.equal(comments[0].content, 'First');
    assert.equal(comments[0].author, 'Jane Doe');
  } finally {
    globalThis.fetch = originalFetch;
  }
});