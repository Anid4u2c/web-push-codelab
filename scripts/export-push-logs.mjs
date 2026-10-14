import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const values = new Map();
const allowed = new Set(['--project', '--since', '--limit', '--output']);
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/export-push-logs.mjs [--project PROJECT_ID] [--since 1h] [--limit 200] [--output logs/push-logs.json]');
    console.log('Uses your signed-in gcloud identity. Defaults to the active project and exports request and application logs for pushconfig/testpush, excluding audit logs. Output may contain personal data; review before sharing.');
    process.exit(0);
  }
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid arguments. Use --help.');
    values.set(args[index], args[index + 1]);
  }
  function gcloud(parameters) {
    const result = spawnSync('gcloud', [...parameters, '--format=json', '--quiet'], {
      encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 120000
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Cloud Logging export failed.');
    return JSON.parse(result.stdout);
  }
  const project = values.get('--project') || gcloud(['config', 'list', 'project'])?.core?.project;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project || '')) throw new Error('Select a gcloud project or pass --project PROJECT_ID.');
  const since = values.get('--since') || '1h';
  if (!/^\d+[smhd]$/.test(since)) throw new Error('--since must be a duration such as 30m, 1h or 1d.');
  const limit = values.get('--limit') || '200';
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 5000) throw new Error('--limit must be between 1 and 5000.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const output = resolve(root, values.get('--output') || `logs/push-logs-${stamp}.json`);
  const logDirectory = resolve(root, 'logs');
  if (!output.startsWith(logDirectory + '/') || !output.endsWith('.json')) throw new Error('--output must be a .json file under the project-root logs/ folder.');
  const filter = '(resource.type="cloud_run_revision" AND resource.labels.service_name=("testpush" OR "pushconfig") AND resource.labels.location="us-central1") OR (resource.type="cloud_function" AND resource.labels.function_name=("testPush" OR "pushConfig") AND resource.labels.region="us-central1")';
  const records = gcloud(['logging', 'read', `(${filter}) AND NOT logName:"cloudaudit.googleapis.com"`,
    `--project=${project}`, `--freshness=${since}`, `--limit=${limit}`, '--order=desc']);
  if (!Array.isArray(records)) throw new Error('Cloud Logging returned an unexpected result; no export written.');
  await mkdir(logDirectory, { recursive: true });
  // Exclusive creation avoids overwriting an earlier export. Never print record contents.
  await writeFile(output, JSON.stringify(records, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const requests = records.filter(record => record.httpRequest);
  const counts = {};
  for (const record of requests) {
    const service = record.resource?.labels?.service_name || record.resource?.labels?.function_name || 'unknown';
    const label = `${service} HTTP ${record.httpRequest.status || 'unknown'}`;
    counts[label] = (counts[label] || 0) + 1;
  }
  console.log(`Saved ${records.length} entries to ${output}`);
  console.log(`Request summary: ${JSON.stringify(counts)}`);
  if (!requests.some(record => ['testpush', 'testPush'].includes(record.resource?.labels?.service_name || record.resource?.labels?.function_name))) {
    console.log('No test-send request found. Check the page diagnostics and enable/save this device subscription first.');
  }
  console.log('This folder is ignored by Git. Review exports for tokens, personal data and subscription details before sharing.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
