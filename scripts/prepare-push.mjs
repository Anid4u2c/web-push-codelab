import { createECDH } from 'node:crypto';
import push from '../functions/push.cjs';
import { GoogleAuth } from 'google-auth-library';

const project = 'web-push-4u2c';
const runtime = `web-push-runtime@${project}.iam.gserviceaccount.com`;
const secretName = `projects/${project}/secrets/WEB_PUSH_VAPID`;
const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
const request = (url, method = 'GET', data) => client.request({ url, method, data });
const status = error => error.response?.status;

try {
  // The runtime identity is deliberately separate from the deploy identity.
  try {
    await request(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${runtime}`);
  } catch {
    throw new Error(`Create or verify ${runtime} and grant it Firebase Realtime Database Admin. Grant the deployment account Service Account User on this runtime identity.`);
  }
  const base = 'https://secretmanager.googleapis.com/v1/';
  try {
    await request(base + secretName);
  } catch (error) {
    if (status(error) !== 404) throw error;
    await request(`${base}projects/${project}/secrets?secretId=WEB_PUSH_VAPID`, 'POST', {
      replication: { automatic: {} }
    });
  }
  try {
    const latest = await request(`${base}${secretName}/versions/latest`);
    if (latest.data.state !== 'ENABLED') throw new Error('Enable the existing WEB_PUSH_VAPID secret version. Do not replace the key pair.');
  } catch (error) {
    if (status(error) !== 404) throw error;
    // Generated only when no version exists. No secret values are written to disk or logs.
    const key = createECDH('prime256v1');
    do { key.generateKeys(); } while (key.getPrivateKey().length !== 32);
    const pair = { publicKey: key.getPublicKey().toString('base64url'), privateKey: key.getPrivateKey().toString('base64url') };
    await request(`${base}${secretName}:addVersion`, 'POST', {
      payload: { data: Buffer.from(JSON.stringify(pair)).toString('base64') }
    });
  }
  const existing = await request(`${base}${secretName}/versions/latest:access`);
  push.parseVapid(Buffer.from(existing.data.payload.data, 'base64').toString('utf8'));
  const policyResponse = await request(`${base}${secretName}:getIamPolicy?options.requestedPolicyVersion=3`);
  const policy = policyResponse.data;
  policy.bindings ||= [];
  let accessor = policy.bindings.find(binding => binding.role === 'roles/secretmanager.secretAccessor' && !binding.condition);
  if (!accessor) {
    accessor = { role: 'roles/secretmanager.secretAccessor', members: [] };
    policy.bindings.push(accessor);
  }
  const member = `serviceAccount:${runtime}`;
  if (!accessor.members.includes(member)) {
    accessor.members.push(member);
    await request(`${base}${secretName}:setIamPolicy`, 'POST', { policy });
  }
  console.log('Stable VAPID secret is configured; runtime access is set. No key values were displayed.');
} catch (error) {
  const message = error.response?.data?.error?.message || error.message || 'Push backend preparation failed.';
  console.error(`::error::${String(message).replaceAll('%', '%25').replaceAll('\n', '%0A').replaceAll('\r', '%0D')}`);
  process.exitCode = 1;
}
