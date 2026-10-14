import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const configFile = new URL('../functions/deployment-config.json', import.meta.url);
const config = JSON.parse(await readFile(configFile, 'utf8'));
const prompt = createInterface({ input: stdin, output: stdout });
const gcloud = (...args) => {
  const result = spawnSync('gcloud', [...args, '--quiet', '--format=json'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `gcloud failed (${result.status}).`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};
async function ask(label, fallback, pattern) {
  const answer = (await prompt.question(`${label}${fallback ? ` [${fallback}]` : ' [required]'}: `)).trim() || fallback;
  if (!pattern.test(answer)) throw new Error(`Invalid ${label.toLowerCase()}.`);
  return answer;
}

try {
  console.log('Run in Google Cloud Shell as a project administrator. This configures the selected cloud project; it does not create credentials or reveal secret values.');
  const selectedProject = gcloud('config', 'list', 'project')?.core?.project;
  const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
  const projectDefault = typeof selectedProject === 'string' && projectPattern.test(selectedProject)
    ? selectedProject : '';
  const project = await ask('Project ID', projectDefault, projectPattern);
  if (project !== config.projectId) throw new Error('The selected project does not match deployment configuration. Configure the app and workflow for the selected project before proceeding.');
  const runtimeId = await ask('Runtime service account ID', 'runtime', /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
  const deployId = await ask('Deployment service account ID', 'github-deploy', /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
  if (runtimeId === deployId) throw new Error('Runtime and deployment accounts must be separate.');
  const secretId = await ask('VAPID Secret Manager name', 'WEB_PUSH_VAPID', /^[A-Za-z0-9_-]{1,255}$/);
  const runtime = `${runtimeId}@${project}.iam.gserviceaccount.com`;
  const deploy = `${deployId}@${project}.iam.gserviceaccount.com`;
  gcloud('projects', 'describe', project);
  const billing = gcloud('billing', 'projects', 'describe', project);
  if (!billing.billingEnabled) throw new Error('Enable project billing before running setup.');
  // List operations distinguish an absent resource from a denied lookup. Never create on a permission error.
  const accounts = gcloud('iam', 'service-accounts', 'list', '--project', project);
  const services = gcloud('services', 'list', '--enabled', '--project', project);
  const secretApiEnabled = services.some(service => service.config?.name === 'secretmanager.googleapis.com');
  const secrets = secretApiEnabled ? gcloud('secrets', 'list', '--project', project) : null;
  const accountExists = email => accounts.some(account => account.email === email);
  const defaultAccount = `${project}@appspot.gserviceaccount.com`;
  const defaultExists = accountExists(defaultAccount);
  if (accounts.find(account => account.email === defaultAccount)?.disabled) {
    throw new Error('Enable the existing default App Engine service account before deploying with this Firebase CLI.');
  }
  console.log(defaultExists
    ? 'Existing default App Engine account: include the Firebase CLI deployment permission grant.'
    : 'No default App Engine account found; no account will be created for the CLI compatibility check.');
  for (const email of [runtime, deploy]) {
    const account = accounts.find(item => item.email === email);
    if (account?.disabled) throw new Error('Enable the selected existing service account before continuing.');
    console.log(`${account ? 'Reuse' : 'Create'} ${email === runtime ? 'runtime' : 'deployment'} service account.`);
  }
  const hasSecret = list => list.some(secret => secret.name.split('/').at(-1) === secretId);
  console.log(`${secrets ? (hasSecret(secrets) ? 'Reuse' : 'Create empty secret container') : 'Check after enabling Secret Manager API, then reuse or create empty container'}: ${secretId}`);
  console.log(`\nPlan: enable required APIs; grant the runtime account Database Admin and secret-specific Secret Accessor; grant the deployment account Hosting Admin, Database Admin, Functions Developer, Cloud Run Admin, Service Account User on runtime and the existing default App Engine account, and secret-specific Secret Manager Admin. Existing policies and secret versions are preserved.`);
  if ((await prompt.question('Apply these changes? [y/N]: ')).trim().toLowerCase() !== 'y') {
    console.log('Cancelled. No changes applied.');
  } else {
    gcloud('services', 'enable', 'cloudfunctions.googleapis.com', 'cloudbuild.googleapis.com',
      'artifactregistry.googleapis.com', 'run.googleapis.com', 'iam.googleapis.com',
      'secretmanager.googleapis.com', 'firebasehosting.googleapis.com', 'firebasedatabase.googleapis.com',
      'firebaseextensions.googleapis.com', 'eventarc.googleapis.com', 'pubsub.googleapis.com',
      'storage.googleapis.com', 'cloudbilling.googleapis.com', '--project', project);
    for (const [id, email] of [[runtimeId, runtime], [deployId, deploy]]) {
      if (!accountExists(email)) gcloud('iam', 'service-accounts', 'create', id, '--project', project);
    }
    const currentSecrets = secrets ?? gcloud('secrets', 'list', '--project', project);
    if (!hasSecret(currentSecrets)) gcloud('secrets', 'create', secretId, '--replication-policy=automatic', '--project', project);
    const projectRole = (email, role) => gcloud('projects', 'add-iam-policy-binding', project,
      `--member=serviceAccount:${email}`, `--role=${role}`, '--condition=None');
    projectRole(runtime, 'roles/firebasedatabase.admin');
    for (const role of ['roles/firebasehosting.admin', 'roles/firebasedatabase.admin', 'roles/cloudfunctions.developer', 'roles/run.admin']) {
      projectRole(deploy, role);
    }
    for (const account of new Set([runtime, ...(defaultExists ? [defaultAccount] : [])])) {
      gcloud('iam', 'service-accounts', 'add-iam-policy-binding', account, '--project', project,
        `--member=serviceAccount:${deploy}`, '--role=roles/iam.serviceAccountUser', '--condition=None');
    }
    for (const [email, role] of [[runtime, 'roles/secretmanager.secretAccessor'], [deploy, 'roles/secretmanager.admin']]) {
      gcloud('secrets', 'add-iam-policy-binding', secretId, '--project', project,
        `--member=serviceAccount:${email}`, `--role=${role}`, '--condition=None');
    }
    await writeFile(configFile, JSON.stringify({ ...config, runtimeAccountId: runtimeId,
      deploymentAccountId: deployId, vapidSecretName: secretId }, null, 2) + '\n');
    console.log('\nSetup complete. No key values were generated or read. The deployment workflow creates the VAPID pair if no version exists.');
    console.log('Review functions/deployment-config.json. If changed, commit and push it before deploying.');
    console.log('The deployment credential must authenticate as the selected deployment account. If you chose a new account, configure its credential separately; this script does not create JSON keys.');
    console.log('Rerun the master deployment workflow. IAM changes may take a few minutes to propagate.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  prompt.close();
}
