import assert from 'node:assert/strict';
import test from 'node:test';
import { generateBranchName, ticketIdFromBranch, titleIsTruncated } from '../../src/utils/branch';

test('generateBranchName builds a numeric slug', () => {
  assert.equal(generateBranchName('123', 'Fix login button'), '123-fix-login-button');
});

test('generateBranchName preserves Jira project-key case', () => {
  assert.equal(generateBranchName('PROJ-456', 'Add dark mode'), 'PROJ-456-add-dark-mode');
});

test('generateBranchName lowercases numeric-only IDs', () => {
  assert.equal(generateBranchName('ABC123', 'Do a thing'), 'abc123-do-a-thing');
});

test('generateBranchName truncates to the slug word limit', () => {
  assert.equal(
    generateBranchName('789', 'A very long title with many words here'),
    '789-a-very-long-title',
  );
});

test('titleIsTruncated detects long titles', () => {
  assert.equal(titleIsTruncated('Short title'), false);
  assert.equal(titleIsTruncated('One two three four five'), true);
});

test('ticketIdFromBranch parses a numeric ID', () => {
  assert.equal(ticketIdFromBranch('123-fix-login-button'), '123');
});

test('ticketIdFromBranch parses a Jira key', () => {
  assert.equal(ticketIdFromBranch('PROJ-456-add-dark-mode'), 'PROJ-456');
});

test('ticketIdFromBranch preserves lowercase Jira key case as found', () => {
  assert.equal(ticketIdFromBranch('proj-456-add-dark-mode'), 'proj-456');
});

test('ticketIdFromBranch returns null for non-ticket branches', () => {
  assert.equal(ticketIdFromBranch('main'), null);
  assert.equal(ticketIdFromBranch('feature/login'), null);
  assert.equal(ticketIdFromBranch('develop'), null);
});

test('generateBranchName and ticketIdFromBranch round-trip for Jira keys', () => {
  const branch = generateBranchName('FEN-74', 'Leden tabel toevoegen');
  assert.equal(ticketIdFromBranch(branch), 'FEN-74');
});
