import assert from 'node:assert/strict';
import test from 'node:test';
import { extractApiError, mapChangeType, mapThreadStatus, stripHtml } from '../../src/services/azuredevops/mappers';

test('mapChangeType maps the VersionControlChangeType flags', () => {
  assert.equal(mapChangeType(1), 'add');
  assert.equal(mapChangeType(2), 'edit');
  assert.equal(mapChangeType(4), 'delete');
  assert.equal(mapChangeType(8), 'rename');
  assert.equal(mapChangeType(16), 'other');
  assert.equal(mapChangeType(32), 'other');
  assert.equal(mapChangeType(0), 'other');
});

test('mapChangeType prioritises delete/rename over add/edit in combined flags', () => {
  // e.g. edit+rename (10) resolves to rename; delete+rename (12) resolves to delete.
  assert.equal(mapChangeType(10), 'rename');
  assert.equal(mapChangeType(12), 'delete');
  assert.equal(mapChangeType(3), 'add'); // add+edit flags — add is checked before edit
});

test('mapThreadStatus maps known CommentThreadStatus values', () => {
  assert.equal(mapThreadStatus(1), 'active');
  assert.equal(mapThreadStatus(2), 'resolved');
  assert.equal(mapThreadStatus(3), 'resolved');
  assert.equal(mapThreadStatus(4), 'closed');
  assert.equal(mapThreadStatus(5), 'resolved');
  assert.equal(mapThreadStatus(6), 'pending');
});

test('mapThreadStatus maps unknown/undefined statuses to other', () => {
  assert.equal(mapThreadStatus(undefined), 'other');
  assert.equal(mapThreadStatus(0), 'other');
  assert.equal(mapThreadStatus(99), 'other');
});

test('stripHtml removes tags and decodes common entities', () => {
  assert.equal(
    stripHtml('<div>Hello <b>world</b></div>'),
    'Hello world',
  );
  assert.equal(stripHtml('a&amp;b &lt;c&gt; &quot;d&quot; &#39;e&#39;'), 'a&b <c> "d" \'e\'');
  assert.equal(stripHtml('a&nbsp;b'), 'a b');
});

test('stripHtml converts block-level tags to newlines', () => {
  assert.equal(
    stripHtml('<p>first</p><p>second</p>'),
    'first\nsecond',
  );
  assert.equal(
    stripHtml('one<br/>two'),
    'one\ntwo',
  );
});

test('stripHtml collapses excessive blank lines and trims', () => {
  assert.equal(
    stripHtml('  <p>a</p><p></p><p></p><p></p><p>b</p>  '),
    'a\n\nb',
  );
});

test('extractApiError unwraps a JSON error message', () => {
  const err = new Error('{"message":"VS402903: Work item type Task does not have a state \\"X\\"."}');
  assert.equal(extractApiError(err), 'VS402903: Work item type Task does not have a state "X".');
});

test('extractApiError passes through plain error messages', () => {
  assert.equal(extractApiError(new Error('boom')), 'boom');
});

test('extractApiError passes through non-JSON-string messages unchanged', () => {
  assert.equal(extractApiError(new Error('Not JSON {')), 'Not JSON {');
});

test('extractApiError stringifies non-Error values', () => {
  assert.equal(extractApiError('plain string'), 'plain string');
  assert.equal(extractApiError(42), '42');
});
