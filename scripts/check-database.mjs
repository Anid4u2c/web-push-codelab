import { spawnSync } from 'node:child_process';
import { firebaseConfig } from '../src/firebase-config.mjs';

try {
  const active = spawnSync('gcloud', ['config', 'list', 'project', '--format=json'], { encoding: 'utf8' });
  if (active.error) throw active.error;
  if (active.status !== 0) throw new Error('Could not read the active gcloud project.');
  const project = JSON.parse(active.stdout)?.core?.project;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project || '')) throw new Error('Select your project in gcloud first.');
  if (project !== firebaseConfig.projectId) throw new Error('Active project does not match app configuration.');
  const auth = spawnSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' });
  if (auth.error) throw auth.error;
  if (auth.status !== 0) throw new Error('Sign in to gcloud with permission to list Realtime Database instances.');
  const response = await fetch(`https://firebasedatabase.googleapis.com/v1beta/projects/${project}/locations/-/instances`, {
    headers: { Authorization: `Bearer ${auth.stdout.trim()}` }, signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Database instance listing failed (HTTP ${response.status}). Check project access and API enablement.`);
  const result = await response.json();
  const instances = result.instances || [];
  console.log('Configured database URL:', firebaseConfig.databaseURL);
  if (!instances.length) console.log('No database instances returned. Check the selected project and create a database if needed.');
  for (const instance of instances) {
    console.log(JSON.stringify({ databaseURL: instance.databaseUrl, state: instance.state,
      matchesConfiguredURL: instance.databaseUrl?.replace(/\/$/, '') === firebaseConfig.databaseURL.replace(/\/$/, '') }));
  }
  console.log('Only instance metadata was read. No database records, subscriptions or credential values were displayed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
