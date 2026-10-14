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
  if (!instances.length) throw new Error('No Realtime Database instance exists. In Firebase Console, open Build → Realtime Database → Create database. Choose the intended region and locked mode, then update both app/backend URLs if different and deploy the owner rules. Enabling the API alone does not create a database.');
  for (const instance of instances) {
    console.log(JSON.stringify({ databaseURL: instance.databaseUrl, state: instance.state,
      matchesConfiguredURL: instance.databaseUrl?.replace(/\/$/, '') === firebaseConfig.databaseURL.replace(/\/$/, '') }));
  }
  const matching = instances.find(instance => instance.databaseUrl?.replace(/\/$/, '') === firebaseConfig.databaseURL.replace(/\/$/, ''));
  if (!matching) throw new Error('Configured database URL does not match a listed instance. Update frontend and backend URLs and verify the rules deployment target before deploying.');
  if (matching.state !== 'ACTIVE') throw new Error('The configured database instance is not ACTIVE. Review its state in Firebase Console; setup will not restore, enable or replace an instance automatically.');
  console.log('Database instance exists, matches configuration and is ACTIVE.');
  console.log('Only instance metadata was read. No database records, subscriptions or credential values were displayed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
