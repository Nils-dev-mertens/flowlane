import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IConfigService } from '../../src/services/interfaces/IConfigService';
import { AzureDevOpsTicketService } from '../../src/services/azuredevops/AzureDevOpsTicketService';

function makeConfig(): IConfigService {
  return {
    getProviderConfig(provider: string) {
      assert.equal(provider, 'azuredevops');
      return { org: 'acme', project: 'MyProject', token: 'pat', user: 'jane@acme.com' };
    },
  } as IConfigService;
}

function stubApi(service: AzureDevOpsTicketService, fake: object): void {
  (service as unknown as { api: () => Promise<object> }).api = async () => fake;
}

function azComment(id: number, text: string, displayName: string, createdDate: Date): Record<string, unknown> {
  return { id, text, createdBy: { displayName, uniqueName: 'jane@acme.com' }, createdDate };
}

test('AzureDevOpsTicketService.addComment posts a work item comment via the SDK', async () => {
  let requestText = '';
  let passedProject = '';
  let passedId = 0;

  const service = new AzureDevOpsTicketService(makeConfig());
  stubApi(service, {
    addComment: async (request: { text: string }, project: string, workItemId: number) => {
      requestText = request.text;
      passedProject = project;
      passedId = workItemId;
      return azComment(5, request.text, 'Jane Doe', new Date('2026-08-20T09:00:00Z'));
    },
  });

  const created = await service.addComment('42', 'Please fix the query');

  assert.equal(passedProject, 'MyProject');
  assert.equal(passedId, 42);
  assert.equal(requestText, 'Please fix the query');
  assert.deepEqual(created, {
    id:          '5',
    author:      'Jane Doe',
    content:     'Please fix the query',
    publishedAt: new Date('2026-08-20T09:00:00Z'),
  });
});

test('AzureDevOpsTicketService.getComments maps and sorts comments oldest first', async () => {
  let passedProject = '';
  let passedId = 0;
  let passedTop = 0;

  const service = new AzureDevOpsTicketService(makeConfig());
  stubApi(service, {
    getComments: async (project: string, workItemId: number, top: number) => {
      passedProject = project;
      passedId = workItemId;
      passedTop = top;
      return {
        comments: [
          azComment(6, 'Second', 'Bob', new Date('2026-08-20T12:00:00Z')),
          azComment(5, 'First', 'Jane Doe', new Date('2026-08-20T09:00:00Z')),
        ],
      };
    },
  });

  const comments = await service.getComments('42');

  assert.equal(passedProject, 'MyProject');
  assert.equal(passedId, 42);
  assert.equal(passedTop, 100);
  assert.deepEqual(comments.map((item) => item.id), ['5', '6']);
  assert.equal(comments[0].content, 'First');
  assert.equal(comments[0].author, 'Jane Doe');
});

test('AzureDevOpsTicketService.addComment wraps SDK errors', async () => {
  const service = new AzureDevOpsTicketService(makeConfig());
  stubApi(service, {
    addComment: async () => {
      throw new Error('{"message":"Work item 42 does not exist."}');
    },
  });

  await assert.rejects(
    service.addComment('42', 'hi'),
    (err: unknown) => err instanceof Error && err.message === 'Work item 42 does not exist.',
  );
});