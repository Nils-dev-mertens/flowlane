import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { getGhCliToken, resolveGithubToken } from '../../src/utils/ghCliAuth';
import { resolveProviderConfig } from '../../src/config/providers';

test('resolveGithubToken returns the stored PAT when authMethod is pat or unset', () => {
  assert.equal(resolveGithubToken('pat-123', undefined), 'pat-123');
  assert.equal(resolveGithubToken('pat-123', 'pat'), 'pat-123');
  assert.equal(resolveGithubToken(undefined, undefined), undefined);
});

test('resolveProviderConfig maps legacy authMethod into the github block', () => {
  const block = resolveProviderConfig(
    { platform: 'github', org: 'acme', repo: 'widgets', user: 'jane', authMethod: 'gh-cli' },
    'github',
  );
  assert.equal(block.owner, 'acme');
  assert.equal(block.repo, 'widgets');
  assert.equal(block.authMethod, 'gh-cli');
});

test('getGhCliToken returns the token from "gh auth token"', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const childProcess = require('node:child_process') as typeof import('node:child_process');
  const calls: Array<{ command: string; encoding: string }> = [];

  mock.method(childProcess, 'execSync', (command: string, options: { encoding: string }) => {
    calls.push({ command, encoding: options.encoding });
    return 'gh-token-123\n';
  });

  try {
    assert.equal(getGhCliToken(), 'gh-token-123');
    assert.deepEqual(calls, [{ command: 'gh auth token', encoding: 'utf8' }]);
  } finally {
    mock.restoreAll();
  }
});

test('getGhCliToken throws a clear error when gh auth fails', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const childProcess = require('node:child_process') as typeof import('node:child_process');
  mock.method(childProcess, 'execSync', () => {
    throw new Error('gh: not logged in');
  });

  try {
    assert.throws(() => getGhCliToken(), /GitHub CLI auth failed/);
  } finally {
    mock.restoreAll();
  }
});

test('resolveGithubToken prefers the gh CLI token when authMethod is gh-cli', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const childProcess = require('node:child_process') as typeof import('node:child_process');
  mock.method(childProcess, 'execSync', () => 'gh-cli-token');

  try {
    assert.equal(resolveGithubToken('stored-pat', 'gh-cli'), 'gh-cli-token');
    assert.equal(resolveGithubToken(undefined, 'gh-cli'), 'gh-cli-token');
  } finally {
    mock.restoreAll();
  }
});