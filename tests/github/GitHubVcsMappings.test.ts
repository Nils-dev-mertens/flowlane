import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { GitHubVcsService } from '../../src/services/github/GitHubVcsService';

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
