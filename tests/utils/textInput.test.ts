import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTextInput } from '../../src/utils/textInput';

test('resolveTextInput returns the inline text as-is', async () => {
  assert.equal(await resolveTextInput('hello world'), 'hello world');
});

test('resolveTextInput returns null when no source is provided', async () => {
  assert.equal(await resolveTextInput(undefined), null);
});

test('resolveTextInput reads content from a file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowlane-text-'));
  const file = join(dir, 'comment.md');
  await writeFile(file, 'line one\nline two\n');
  try {
    assert.equal(await resolveTextInput(undefined, file), 'line one\nline two\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveTextInput prefers the file over inline text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowlane-text-'));
  const file = join(dir, 'comment.md');
  await writeFile(file, 'from file');
  try {
    assert.equal(await resolveTextInput('from inline', file), 'from file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
