import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowTarget } from '../../src/utils/workflowTarget';
import type { FlowlaneConfig } from '../../src/types';

test('workflowTarget resolves Azure DevOps start status and column', () => {
  const config: Partial<FlowlaneConfig> = {
    azuredevops: { activeStatus: 'Active', activeColumn: 'Doing' },
  };
  assert.deepEqual(workflowTarget('azuredevops', config, 'start'), {
    state: 'Active',
    column: 'Doing',
  });
});

test('workflowTarget defaults Azure DevOps start to Active when unset', () => {
  assert.deepEqual(workflowTarget('azuredevops', {}, 'start'), {
    state: 'Active',
    column: undefined,
  });
});

test('workflowTarget resolves Azure DevOps review status and column', () => {
  const config: Partial<FlowlaneConfig> = {
    azuredevops: { reviewStatus: 'Active', reviewColumn: 'Ready for Review' },
  };
  assert.deepEqual(workflowTarget('azuredevops', config, 'review'), {
    state: 'Active',
    column: 'Ready for Review',
  });
});

test('workflowTarget returns null for Azure DevOps review when unconfigured', () => {
  assert.equal(workflowTarget('azuredevops', {}, 'review'), null);
});

test('workflowTarget resolves Jira start/review transition names', () => {
  const config: Partial<FlowlaneConfig> = {
    jira: { activeStatus: 'In Progress', reviewStatus: 'In Review' },
  };
  assert.deepEqual(workflowTarget('jira', config, 'start'), { state: 'In Progress' });
  assert.deepEqual(workflowTarget('jira', config, 'review'), { state: 'In Review' });
});

test('workflowTarget returns null for Jira when transition is unset', () => {
  assert.equal(workflowTarget('jira', {}, 'start'), null);
  assert.equal(workflowTarget('jira', {}, 'review'), null);
});

test('workflowTarget always returns null for GitHub', () => {
  const config: Partial<FlowlaneConfig> = { github: { owner: 'me', repo: 'demo' } };
  assert.equal(workflowTarget('github', config, 'start'), null);
  assert.equal(workflowTarget('github', config, 'review'), null);
});

test('workflowTarget reads nested provider blocks, not legacy flat keys', () => {
  const config: Partial<FlowlaneConfig> = {
    // Legacy flat keys should not leak into Jira resolution.
    activeStatus: 'Wrong',
    jira: { activeStatus: 'In Progress' },
  };
  assert.deepEqual(workflowTarget('jira', config, 'start'), { state: 'In Progress' });
});
