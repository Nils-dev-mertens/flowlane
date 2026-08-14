import assert from 'node:assert/strict';
import test from 'node:test';
import { changeTypeBadge, formatAge, formatReviewers, wrapText } from '../../src/utils/prDisplay';

test('wrapText leaves short lines untouched', () => {
  assert.deepEqual(wrapText('short line', 20), ['short line']);
});

test('wrapText wraps long lines to the given width', () => {
  assert.deepEqual(wrapText('one two three four five six', 10), [
    'one two',
    'three four',
    'five six',
  ]);
});

test('wrapText preserves existing newlines', () => {
  assert.deepEqual(wrapText('hello\nworld foo bar', 8), ['hello', 'world', 'foo bar']);
});

test('formatAge renders minutes, hours, and days', () => {
  assert.equal(formatAge(new Date(Date.now() - 90_000)), '1m ago');
  assert.equal(formatAge(new Date(Date.now() - 2 * 3_600_000)), '2h ago');
  assert.equal(formatAge(new Date(Date.now() - 3 * 86_400_000)), '3d ago');
});

test('changeTypeBadge returns the right symbol per change type', () => {
  assert.ok(changeTypeBadge('add').includes('+'));
  assert.ok(changeTypeBadge('edit').includes('~'));
  assert.ok(changeTypeBadge('delete').includes('-'));
  assert.ok(changeTypeBadge('rename').includes('→'));
  assert.ok(changeTypeBadge('other').includes('?'));
});

test('formatReviewers maps votes to badges and shortens names', () => {
  const out = formatReviewers([
    { name: 'Alice Smith', email: 'a', vote: 10 },
    { name: 'Bob', email: 'b', vote: -10 },
    { name: 'Carol', email: 'c', vote: 0 },
  ]);
  assert.ok(out.includes('Alice'));
  assert.ok(out.includes('✓'));
  assert.ok(out.includes('Bob'));
  assert.ok(out.includes('✗'));
  assert.ok(out.includes('Carol'));
  assert.ok(out.includes('○'));
});

test('formatReviewers returns an empty string when there are no reviewers', () => {
  assert.equal(formatReviewers([]), '');
});
