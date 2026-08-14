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

test('GitHubVcsService maps general, file, and multi-line comments', async () => {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    requests.push({ method, url, body });

    if (url.endsWith('/pulls/42')) return response({ head: { sha: 'abc123' } });
    return response({});
  };

  try {
    const service = new GitHubVcsService(makeConfig());
    await service.addComment(42, 'General feedback');
    await service.addComment(42, 'File feedback', { filePath: 'src/app.ts' });
    await service.addComment(42, 'Range feedback', {
      filePath: 'src/app.ts',
      startLine: 10,
      endLine: 12,
    });

    assert.deepEqual(requests, [
      {
        method: 'POST',
        url: 'https://api.github.com/repos/me/demo/issues/42/comments',
        body: { body: 'General feedback' },
      },
      {
        method: 'GET',
        url: 'https://api.github.com/repos/me/demo/pulls/42',
        body: undefined,
      },
      {
        method: 'POST',
        url: 'https://api.github.com/repos/me/demo/pulls/42/comments',
        body: {
          body: 'File feedback',
          commit_id: 'abc123',
          path: 'src/app.ts',
          side: 'RIGHT',
          subject_type: 'file',
        },
      },
      {
        method: 'GET',
        url: 'https://api.github.com/repos/me/demo/pulls/42',
        body: undefined,
      },
      {
        method: 'POST',
        url: 'https://api.github.com/repos/me/demo/pulls/42/comments',
        body: {
          body: 'Range feedback',
          commit_id: 'abc123',
          path: 'src/app.ts',
          side: 'RIGHT',
          start_line: 10,
          start_side: 'RIGHT',
          line: 12,
        },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubVcsService validates branches before creating a pull request', async () => {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    requests.push({ method, url, body });

    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/branches/feature')) return response({ name: 'feature' });
    if (parsed.pathname.endsWith('/branches/main')) return response({ name: 'main' });
    if (parsed.pathname.endsWith('/compare/main...feature')) return response({ ahead_by: 1 });
    if (parsed.pathname.endsWith('/pulls') && method === 'GET') return response([]);
    if (parsed.pathname.endsWith('/pulls') && method === 'POST') {
      return response({
        number: 74,
        title: '[74] Add members table',
        html_url: 'https://github.test/me/demo/pull/74',
        state: 'open',
      });
    }
    throw new Error(`Unexpected mocked GitHub request: ${url}`);
  };

  try {
    const service = new GitHubVcsService(makeConfig());
    const pr = await service.createPR({
      ticketId: '74',
      title: 'Add members table',
      sourceBranch: 'feature',
      targetBranch: 'main',
    });

    assert.deepEqual(pr, {
      id: 74,
      title: '[74] Add members table',
      url: 'https://github.test/me/demo/pull/74',
      status: 'open',
    });
    assert.equal(requests[0].url, 'https://api.github.com/repos/me/demo/branches/feature');
    assert.equal(requests[1].url, 'https://api.github.com/repos/me/demo/branches/main');
    assert.equal(requests[2].url, 'https://api.github.com/repos/me/demo/compare/main...feature');
    assert.equal(new URL(requests[3].url).searchParams.get('head'), 'me:feature');
    assert.deepEqual(requests[4].body, {
      title: '[74] Add members table',
      body: '',
      head: 'feature',
      base: 'main',
      draft: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubVcsService reports when the source branch has no commits to merge', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/branches/feature')) return response({ name: 'feature' });
    if (url.endsWith('/branches/main')) return response({ name: 'main' });
    if (url.endsWith('/compare/main...feature')) return response({ ahead_by: 0 });
    throw new Error(`Unexpected mocked GitHub request: ${url}`);
  };

  try {
    const service = new GitHubVcsService(makeConfig());
    await assert.rejects(
      service.createPR({
        ticketId: '74',
        title: 'Add members table',
        sourceBranch: 'feature',
        targetBranch: 'main',
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('no commits on "feature"') &&
        error.message.includes('not already in "main"'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubVcsService reports an unpublished source branch before creating a PR', async () => {
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://api.github.com/repos/me/demo/branches/feature');
    return new Response(JSON.stringify({ message: 'Branch not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const service = new GitHubVcsService(makeConfig());
    await assert.rejects(
      service.createPR({
        ticketId: '74',
        title: 'Add members table',
        sourceBranch: 'feature',
        targetBranch: 'main',
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('source branch "feature" was not found') &&
        error.message.includes('git push -u origin feature'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHubVcsService maps changed-file statuses', async () => {
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://api.github.com/repos/me/demo/pulls/42/files?per_page=100&page=1');
    return response([
      { filename: 'new.ts', status: 'added' },
      { filename: 'old.ts', status: 'removed' },
      { filename: 'edit.ts', status: 'modified' },
      { filename: 'renamed.ts', status: 'renamed', previous_filename: 'before.ts' },
    ]);
  };

  try {
    const service = new GitHubVcsService(makeConfig());
    const files = await service.getChangedFiles(42);
    assert.deepEqual(files, [
      { path: 'new.ts', changeType: 'add', originalPath: undefined },
      { path: 'old.ts', changeType: 'delete', originalPath: undefined },
      { path: 'edit.ts', changeType: 'edit', originalPath: undefined },
      { path: 'renamed.ts', changeType: 'rename', originalPath: 'before.ts' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
