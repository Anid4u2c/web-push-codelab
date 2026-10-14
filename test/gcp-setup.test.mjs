import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

async function runSetup(mode, answers = ['', '', '', '', 'y']) {
  const directory = await mkdtemp(join(tmpdir(), 'push-setup-'));
  try {
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'functions'));
    await copyFile(new URL('../scripts/setup-gcp.mjs', import.meta.url), join(directory, 'scripts/setup-gcp.mjs'));
    await copyFile(new URL('../functions/deployment-config.json', import.meta.url), join(directory, 'functions/deployment-config.json'));
    const log = join(directory, 'calls.jsonl');
    await writeFile(join(directory, 'gcloud'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
const starts = text => args.slice(0, text.split(' ').length).join(' ') === text;
let result = {};
if (starts('billing projects describe')) result = { billingEnabled: true };
if (starts('iam service-accounts list')) result = process.env.MODE === 'missing' ? [] : ['runtime', 'github-deploy'].map(id => ({ email: id + '@web-push-4u2c.iam.gserviceaccount.com' }));
if (starts('services list')) result = process.env.MODE === 'missing' ? [] : [{ config: { name: 'secretmanager.googleapis.com' } }];
if (starts('secrets list')) {
  if (process.env.MODE === 'denied') { console.error('Permission denied'); process.exit(1); }
  result = process.env.MODE === 'missing' ? [] : [{ name: 'projects/589537879159/secrets/WEB_PUSH_VAPID' }];
}
console.log(JSON.stringify(result));
`, { mode: 0o755 });
    const child = spawn(process.execPath, [join(directory, 'scripts/setup-gcp.mjs')], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, MODE: mode, CALL_LOG: log },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    let answered = 0;
    child.stdout.on('data', chunk => {
      output += chunk;
      const questions = output.match(/(?:\]: |\[y\/N\]: )/g) || [];
      while (answered < questions.length && answered < answers.length) child.stdin.write(`${answers[answered++]}\n`);
    });
    child.stderr.on('data', chunk => { output += chunk; });
    const timeout = setTimeout(() => child.kill(), 10000);
    const code = await new Promise(resolve => child.on('close', resolve));
    clearTimeout(timeout);
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const config = JSON.parse(await readFile(join(directory, 'functions/deployment-config.json'), 'utf8'));
    return { code, calls, config, output };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const starts = (args, text) => args.slice(0, text.split(' ').length).join(' ') === text;

test('Cloud Shell setup reuses existing resources and scopes identity/secret grants', async () => {
  const result = await runSetup('existing');
  assert.equal(result.code, 0, result.output);
  assert.equal(result.calls.some(args => starts(args, 'iam service-accounts create') || starts(args, 'secrets create')), false);
  assert.equal(result.calls.some(args => args.includes('--role=roles/iam.serviceAccountUser') && args.includes('runtime@web-push-4u2c.iam.gserviceaccount.com')), true);
  assert.equal(result.calls.some(args => starts(args, 'projects add-iam-policy-binding') && args.includes('--role=roles/secretmanager.admin')), false);
  assert.equal(result.calls.some(args => args.includes('versions') || args.includes('keys')), false);
});

test('Cloud Shell setup checks after API enablement and creates missing selected names', async () => {
  const result = await runSetup('missing', ['', 'push-runtime', 'push-deploy', 'CUSTOM_VAPID', 'y']);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.calls.filter(args => starts(args, 'iam service-accounts create')).length, 2);
  assert.equal(result.calls.filter(args => starts(args, 'secrets create')).length, 1);
  assert.ok(result.calls.findIndex(args => starts(args, 'secrets list')) > result.calls.findIndex(args => starts(args, 'services enable')));
  assert.equal(result.config.runtimeAccountId, 'push-runtime');
  assert.equal(result.config.deploymentAccountId, 'push-deploy');
  assert.equal(result.config.vapidSecretName, 'CUSTOM_VAPID');
});

test('Cloud Shell setup stops on lookup permission denial without creating anything', async () => {
  const result = await runSetup('denied');
  assert.equal(result.code, 1);
  assert.match(result.output, /Permission denied/);
  assert.equal(result.calls.some(args => args.includes('create') || args.includes('add-iam-policy-binding') || args.includes('enable')), false);
});

test('Cloud Shell setup cancellation applies no changes', async () => {
  const result = await runSetup('existing', ['', '', '', '', 'n']);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.calls.some(args => args.includes('create') || args.includes('add-iam-policy-binding') || args.includes('enable')), false);
});
