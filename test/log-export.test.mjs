import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('log export uses active project, filters audits, saves private JSON and refuses overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'push-logs-test-'));
  try {
    await mkdir(join(directory, 'scripts'));
    await copyFile(new URL('../scripts/export-push-logs.mjs', import.meta.url), join(directory, 'scripts/export-push-logs.mjs'));
    const calls = join(directory, 'calls.jsonl');
    await writeFile(join(directory, 'gcloud'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
console.log(JSON.stringify(args[0] === 'config' ? { core: { project: 'demo-push-project' } } : [{ resource: { labels: { service_name: 'testpush' } }, httpRequest: { status: 503 }, textPayload: 'sensitive fixture detail' }]));
`, { mode: 0o755 });
    const options = { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CALL_LOG: calls } };
    const run = output => spawnSync(process.execPath, [join(directory, 'scripts/export-push-logs.mjs'), '--output', output], options);
    const first = run('logs/result.json');
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /testpush HTTP 503/);
    assert.doesNotMatch(first.stdout, /sensitive fixture detail/);
    const file = join(directory, 'logs/result.json');
    assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].httpRequest.status, 503);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.notEqual(run('logs/result.json').status, 0);
    assert.notEqual(run('outside.json').status, 0);
    const requests = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(requests.some(args => args[0] === 'logging' && args.includes('--project=demo-push-project')
      && args.some(arg => arg.includes('NOT logName:"cloudaudit.googleapis.com"'))));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
