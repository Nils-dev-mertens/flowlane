import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { AzureDevOpsTicketService } from '../../src/services/azuredevops/AzureDevOpsTicketService';

function makeConfig(overrides: Record<string, unknown> = {}): IConfigService {
  return {
    getProviderConfig(provider: string) {
      assert.equal(provider, 'azuredevops');
      return { org: 'acme', project: 'MyProject', token: 'pat', user: 'jane@acme.com', ...overrides };
    },
  } as IConfigService;
}

function stubApi(service: AzureDevOpsTicketService, fake: object): void {
  (service as unknown as { api: () => Promise<object> }).api = async () => fake;
}

test('AzureDevOpsTicketService.closeTicket sets the first closed state', async () => {
  const patches: Array<{ op: string; path: string; value: string }> = [];
  let passedId = 0;

  const service = new AzureDevOpsTicketService(makeConfig());
  stubApi(service, {
    updateWorkItem: async (_patch: unknown, body: typeof patches, workItemId: number) => {
      patches.push(...body);
      passedId = workItemId;
      return {};
    },
  });

  await service.closeTicket('42');
  assert.equal(passedId, 42);
  assert.deepEqual(patches, [{ op: 'add', path: '/fields/System.State', value: 'Done' }]);
});

test('AzureDevOpsTicketService.reopenTicket uses the configured activeStatus', async () => {
  let value = '';
  const service = new AzureDevOpsTicketService(makeConfig({ activeStatus: 'In Progress' }));
  stubApi(service, {
    updateWorkItem: async (_patch: unknown, body: Array<{ op: string; path: string; value: string }>) => {
      value = body[0].value;
      return {};
    },
  });

  await service.reopenTicket('42');
  assert.equal(value, 'In Progress');
});

test('AzureDevOpsTicketService.addLabels merges with existing tags', async () => {
  const tags: Array<{ op: string; path: string; value: string }> = [];
  const calls: string[] = [];

  const service = new AzureDevOpsTicketService(makeConfig());
  stubApi(service, {
    getWorkItem: async () => ({ fields: { 'System.Tags': 'ui; auth' } }),
    updateWorkItem: async (_patch: unknown, body: Array<{ op: string; path: string; value: string }>) => {
      tags.push(...body);
      calls.push('update');
      return {};
    },
  });

  await service.addLabels('42', ['p1']);
  assert.deepEqual(calls, ['update']);
  assert.deepEqual(tags, [{ op: 'add', path: '/fields/System.Tags', value: 'ui; auth; p1' }]);
});

test('AzureDevOpsTicketService.assignTicket sets System.AssignedTo', async () => {
  let value = '';
  const service = new AzureDevOpsTicketService(makeConfig());
  stubApi(service, {
    updateWorkItem: async (_patch: unknown, body: Array<{ op: string; path: string; value: string }>) => {
      value = body[0].value;
      return {};
    },
  });

  await service.assignTicket('42', 'bob@acme.com');
  assert.equal(value, 'bob@acme.com');
});