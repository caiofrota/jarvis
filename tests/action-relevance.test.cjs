const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relevantApplications } = require('../dist/shared/action-relevance');
const { taskTitleKey } = require('../dist/shared/task-title');
test('shortlists available apps by actual identity and successful recent use', () => {
  const apps = Array.from({ length: 10 }, (_, i) => ({
    id: `app-${i}`,
    label: `Unknown ${i}`,
    kind: 'app',
    available: true,
  }));
  apps.push({ id: 'folder', label: 'Folder', kind: 'folder', available: true });
  apps[8].available = false;
  const history = [
    { id: '1', targetId: 'app-9', at: new Date().toISOString(), status: 'sent' },
    { id: '2', targetId: 'app-8', at: new Date().toISOString(), status: 'sent' },
    { id: '3', targetId: 'app-7', at: new Date().toISOString(), status: 'error' },
  ];
  const result = relevantApplications(apps, history);
  assert.equal(result.length, 6);
  assert.equal(result[0].id, 'app-9');
  assert.ok(!result.some((t) => t.id === 'folder' || t.id === 'app-8'));
  assert.equal(relevantApplications(apps, history, ['app-6'])[0].id, 'app-6');
});
test('task identities preserve meaningful punctuation', () => {
  assert.notEqual(taskTitleKey('Estudar C++'), taskTitleKey('Estudar C#'));
  assert.equal(taskTitleKey('  Fazer REVISÃO '), taskTitleKey('fazer revisão'));
});

test('application activity survives reopening without launching anything', async () => {
  const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
  const { ActionService } = require('../dist/lib/actions');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-activity-'));
  try {
    const historyPath = path.join(dir, 'activity.json');
    const catalog = [
      {
        id: 'boreal',
        label: 'Boreal',
        kind: 'app',
        available: true,
        command: process.execPath,
        args: [],
        target: process.execPath,
      },
    ];
    let launched = 0;
    const options = {
      catalog,
      historyPath,
      environment: { restricted: false },
      launcher: async () => {
        launched++;
      },
    };
    const service = new ActionService(options),
      prepared = service.prepare('boreal', 'fixture');
    await service.execute(prepared.token, 'fixture');
    assert.equal(launched, 1);
    const reopened = new ActionService(options);
    assert.equal(reopened.list().history[0].targetId, 'boreal');
    assert.equal(launched, 1);
    fs.writeFileSync(historyPath, '{broken');
    assert.deepEqual(new ActionService(options).list().history, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
