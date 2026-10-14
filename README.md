# Web Push codelab

A small browser push-notification demo hosted on Firebase. The app uses the Push API and a service worker to receive messages, display notifications, and return users to the site.

Hosting URLs use your project ID: **https://PROJECT_ID.web.app**. The alternate Firebase Hosting domain, **https://PROJECT_ID.firebaseapp.com**, remains available. Authentication sessions and push subscriptions are specific to each origin.

## Development

Use Node.js 24 or newer, Python 3 for the static server, and Java 21 for database rules tests.

```sh
npm ci
npm ci --prefix functions
npm test
npm run build
npm run test:rules
python3 -m http.server 8000 --bind 127.0.0.1 --directory app/dist
```

The static server exposes the built app at `/`. Build the app first; Hosting also serves `app/dist`. Historical examples remain under `completed/` in the repository. The modular Firebase SDK is bundled locally, so reserved Hosting SDK routes are no longer required. Firebase web configuration is in `src/firebase-config.mjs`. The static server cannot serve `/api/push/config` or `/api/push/test`; use the deployed site for the complete flow. Local sign-in requires an authorized localhost domain and a development API key configuration; never use live credentials for emulator tests.

`npm test` runs ESLint and Node tests covering notification handling, Google sign-in UI, per-owner subscription paths, form submission, sign-out cleanup, and VAPID key conversion. `npm run test:rules` uses a demo-project database emulator to check owner access, cross-user denial, legacy-path denial, record validation, and multiple devices. These checks do not exercise live Google authentication or push delivery. ESLint uses a flat configuration in `eslint.config.mjs`; dependency versions are pinned in `package-lock.json`.

The frontend remains plain JavaScript. Its current size does not justify a React dependency or build pipeline.

## Sending a test notification

Sign in with Google, choose **Enable Push Messaging**, accept the browser permission request, then choose **Send me a test notification**. The app fetches its public key automatically; there is no key to paste. A successful send means the push provider accepted the encrypted message, not that the operating system displayed it.

The backend accepts only the current user's stored device ID and sends a fixed demo message. It validates Google ID tokens and push-provider destinations, allows one test per user every 30 seconds, and caps the demo at 500 sends per UTC day. Expired subscriptions are removed. The private VAPID key is held in the `WEB_PUSH_VAPID` Secret Manager secret. The setup job creates a pair only if no version exists and verifies that an existing pair matches; it never prints the pair or rotates it on deployment.

If an existing browser subscription used an older manually supplied key, choose **Update push subscription** to replace it. Managed browser permissions may still block notifications. On iOS/iPadOS, Web Push requires a supported Home Screen web app; the installable PWA manifest remains a follow-up.

## Deployment

GitHub Actions runs tests on pull requests and pushes to `master`. A successful push to `master` deploys **the push backend and database rules before Hosting** to project `PROJECT_ID`. The release stops if backend setup, functions, or rules cannot be deployed. The workflow can also be started manually on `master`.

The repository secret `FIREBASE_SERVICE_ACCOUNT` supplies the deployment credential for `DEPLOY_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com`. Keep the credential in GitHub Actions secrets; never commit its JSON key. The deployment account has Firebase Hosting Admin; it also needs **Firebase Realtime Database Admin** (`roles/firebasedatabase.admin`) to publish rules. Actions are pinned to commit IDs, and pull requests cannot run the production deployment job.

CI runs the unit tests, build, and database emulator tests before deployment. The deploy job writes its credential to a temporary restricted file and removes it after use. Functions deploy from the `functions/` codebase before the app is published. Existing legacy database data is not deleted, but the new rules make global `/subscription/` and `/publicKey/` records inaccessible to clients.

### Configure from Google Cloud Shell

Use [Cloud Shell](https://console.cloud.google.com/?cloudshell=true) while signed in as a project administrator. Blaze billing must already be enabled. In a fresh Cloud Shell checkout, run:

```sh
git clone <REPOSITORY_URL>
cd <CHECKOUT_DIRECTORY>
node scripts/setup-gcp.mjs
```

If you already have a checkout, enter it and run `git pull --ff-only` first. The setup script uses Node.js and the Cloud Shell `gcloud` login; no npm installation or downloaded service-account key is needed.

The script offers the active `gcloud` project as the project ID default. Press Enter to accept it, or enter another ID. If no project is selected, an explicit ID is required. It does not use the repository’s saved project ID as the prompt default. It also asks for runtime account ID (default **runtime**), deployment account ID (default **github-deploy**) and Secret Manager name (default **WEB_PUSH_VAPID**). Press Enter to keep a default. It targets this app's existing project; migrating to another project requires updating the Firebase client, database and workflow separately.

Before applying changes, it checks billing, lists existing accounts and secrets, and shows a plan for confirmation. It reuses existing resources and preserves secret versions and IAM bindings. Permission errors stop setup rather than being treated as missing resources. If the Secret Manager API is disabled, it checks for the secret after enabling the API and before creating anything. Interrupted setup can be rerun; earlier successful changes remain in place.

The script enables required APIs, creates missing accounts and an empty secret container, and grants the roles below. Secret permissions are scoped to the chosen secret; Service Account User is scoped to the runtime account and, when present, the default App Engine account required by the pinned Firebase CLI. It does not create service-account JSON keys or read secret values. GitHub generates the VAPID pair on deployment.

Your chosen names are saved in `functions/deployment-config.json`, which is shared by backend deployment and VAPID preparation. If you changed defaults, review, commit and push that file:

```sh
git diff -- functions/deployment-config.json
git add functions/deployment-config.json
git commit -m "Configure push deployment identities"
git push origin master
```

If the file is unchanged, skip the commit and rerun the deployment workflow on `master`. The existing GitHub `FIREBASE_SERVICE_ACCOUNT` credential must belong to the deployment account you selected; choosing a new account does not transfer the old credential. IAM changes may take a few minutes to propagate.

### One-time backend prerequisites

The Cloud Shell script performs these steps. They are also available manually:

1. **Billing and APIs.** Enable Blaze billing. In [APIs & Services](https://console.cloud.google.com/apis/library), enable Cloud Functions, Cloud Build, Artifact Registry, Cloud Run, IAM, Secret Manager, Firebase Hosting, Firebase Realtime Database, Firebase Extensions, Eventarc, Pub/Sub, Cloud Storage and Cloud Billing APIs. The pinned Firebase CLI checks these APIs during deployment, including Eventarc and Pub/Sub for this HTTP-only backend and Cloud Billing to verify the project billing status. Enabling Cloud Billing API is separate from linking a billing account or enabling Blaze. The administrator enables them during Cloud Shell setup; the deployment account does not need permission to enable APIs.
2. **Runtime identity.** Use your selected runtime service account (`RUNTIME_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com`). Grant it Firebase Realtime Database Admin (`roles/firebasedatabase.admin`) on the project. This account runs the functions; it does not need Hosting or Functions deployment roles.
3. **Allow deployment to use runtime.** Open [Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts), select your runtime account, then **Permissions → Grant access**. Add `DEPLOY_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com` as principal with **Service Account User** (`roles/iam.serviceAccountUser`). Apply this grant to the runtime account itself. The pinned Firebase CLI also checks `iam.serviceAccounts.actAs` on the existing default App Engine account (`PROJECT_ID@appspot.gserviceaccount.com`), even when functions use a custom runtime identity. Grant the deployment principal Service Account User on that account too; the setup script handles this when the account exists and never creates a default account. The functions still run as the selected runtime account. Service Account Token Creator is not required for this deployment.
4. **Deployment permissions.** In [project IAM](https://console.cloud.google.com/iam-admin/iam), the selected deployment account needs Firebase Hosting Admin, Firebase Realtime Database Admin, Cloud Functions Developer (`roles/cloudfunctions.developer`) and Cloud Run Admin (`roles/run.admin`). The Cloud Shell administrator creates the secret container and grants the deployment account Secret Manager Admin (`roles/secretmanager.admin`) on that secret only. If relying on the deployment job to create the container instead, it needs project-level secret creation permissions initially. Do not grant Owner or Editor.
5. **GitHub credential.** Keep the existing repository Actions secret **`FIREBASE_SERVICE_ACCOUNT`** containing the deployment account's JSON credential. No additional GitHub VAPID secret is needed.
6. **Run deployment.** Push to `master`, or open [GitHub Actions](../../actions), select **Validate and deploy Firebase push demo**, and choose **Run workflow** on `master`. Check the preparation and function deployment steps before expecting the new Hosting UI.

### Troubleshooting the default service-account permission check

If deployment reports missing `iam.serviceAccounts.ActAs` on the default App Engine account, update your checkout and rerun setup:

```sh
git pull --ff-only
node scripts/setup-gcp.mjs
```

Enter the same project and account names used previously, approve the displayed plan, then rerun deployment after IAM changes propagate. Alternatively, a project administrator can grant the deployment principal **Service Account User** directly on the existing default App Engine account in **Service Accounts → Permissions → Grant access**. A project-wide grant is unnecessary.

### Where `WEB_PUSH_VAPID` belongs

`WEB_PUSH_VAPID` is a **Google Cloud Secret Manager secret** in project `PROJECT_ID`, not a GitHub Actions secret or a browser environment variable. Its default name is `WEB_PUSH_VAPID` (or the name chosen in setup): do not add a `VITE_` or `FIREBASE_` prefix.

**You do not need to create or paste a key.** Cloud Shell creates an empty secret container. With the permissions above, `scripts/prepare-push.mjs` performs the setup automatically during deployment:

1. Creates the Secret Manager secret if it does not exist.
2. Generates a matching VAPID public/private key pair and stores it as a JSON secret version only when no version exists. Values stay in memory during creation and are not printed or written to a local key file.
3. Validates an existing pair and preserves it on later deployments.
4. Grants `RUNTIME_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com` **Secret Manager Secret Accessor** (`roles/secretmanager.secretAccessor`) on this secret. The functions bind the secret at runtime and expose only its public key to the page.

After successful preparation, open [Secret Manager](https://console.cloud.google.com/security/secret-manager). Verify that **WEB_PUSH_VAPID** has an enabled version and that its **Permissions** include the runtime account as Secret Accessor. You do not need to reveal the value. Avoid manually adding an empty version or a lone public key; the backend expects JSON containing both `publicKey` and `privateKey`. Do not replace the pair on routine deployments, because existing browser subscriptions depend on its public key.

If preparation reports permission denied, fix the named account's access and rerun the workflow. If an existing secret version is disabled, enable it; do not generate a replacement pair. Never paste private keys into the browser, chat, repository or cloud development environment.

The setup script checks the runtime identity before making changes. If permissions or prerequisites are missing, the workflow reports the specific setup error and keeps the previously deployed site. Secret creation, function deployment and real push delivery are not established by passing unit tests.

## Diagnostics

Expand **Diagnostics** on the page for the active site/auth domain, authentication state, browser support, notification permission, service-worker state, backend key availability, and subscription presence. Copy or clear the latest 20 app events; they stay in memory for this tab and use the browser's local time. Diagnostics exclude account identifiers, credentials and subscription contents. They summarize app events rather than intercepting the browser console.

Google popup authentication can emit COOP `window.closed` warnings while Firebase polls for cancellation. A signed-in account indicates login completed despite those warnings. If notifications are denied, allow them in the browser's site permissions and reload.

## Current limitations

This is a legacy demo, not yet a complete authenticated PWA:

- Subscriptions are stored at `/subscriptions/{uid}/{endpointHash}`. Rules deny unauthenticated and cross-user access. Deploy the new rules before using this client; the workflow enforces that order. Legacy records may need administrator cleanup after a backup.
- Google sign-in is integrated; anonymous provider enablement does not automatically sign users in. Sign-out unsubscribes this browser and deletes its owned record. Google sign-in allows self-tests on that user’s devices only. Keep both hosting domains authorized. Authentication uses `web.app` by default and `firebaseapp.com` only when that domain is opened intentionally. In the Google OAuth web client, authorize both redirect URIs: `https://PROJECT_ID.web.app/__/auth/handler` and `https://PROJECT_ID.firebaseapp.com/__/auth/handler`. Firebase authorized domains and Google OAuth redirect URIs are separate settings.
- Firebase SDK 13 is bundled with esbuild, and copying uses the native Clipboard API. All styles and icons are hosted locally; no Material Design Lite CDN is required. JavaScript and stylesheet filenames are versioned per build to avoid stale assets.
- The manifest, install experience, and offline strategy remain to be implemented. The sender supports self-tests only; there is no broadcast or arbitrary-message endpoint.
- Glitch project hosting has ended; the active app no longer links to its companion site. The original companion-site links and embedded keys in `completed/` are historical examples. The live app gets its public key from the backend; the private key is never returned to the browser.
- Automatic subscription renewal needs an authenticated backend. The app checks the browser subscription when opened; it does not post renewals to a placeholder endpoint.

## Next steps

1. Verify the release's Google sign-in on both authorized Hosting domains and check the live rules. Test with two distinct accounts and multiple browser profiles.
2. Verify real self-test delivery on multiple devices after backend deployment. Add App Check and stronger abuse controls before widening the public audience.
3. Add a web manifest, install guidance, and explicit permission controls. Define notification action behavior and unsupported-browser states.
4. Test real delivery, unsubscribe, denied permissions, multiple users, and both Hosting origins. Include supported Android browsers and installed iOS/iPadOS Home Screen web apps.

## Security and credentials

Firebase web app configuration and VAPID **public** keys are client configuration, not server credentials. Private VAPID keys, service-account JSON, OAuth client secrets, and personal access tokens must stay outside the repository. Local environment files and common credential file extensions are ignored; ignore rules are a precaution, not a secret detector.

A credential-pattern review of tracked files found no matching server credentials. Local Git history includes cryptography test keys and PEM-format markers from previously vendored Python libraries; these are test fixtures or library code, not identified deployment credentials. Pattern matching cannot guarantee the absence of every secret. Live rule deployment must be verified separately. The runtime dependency audit is clear after a compatible gRPC override. The Firebase CLI still introduces upstream development-tool advisories; do not interpret the earlier tooling-only audit as the status of this expanded dependency set.

## Sources

The examples originated in [GoogleChromeLabs/web-push-codelab](https://github.com/GoogleChromeLabs/web-push-codelab) and Google's [Push Notifications codelab](https://codelabs.developers.google.com/codelabs/push-notifications/). This fork adds Firebase database integration and notification actions. Original source notices are retained.

Useful references for the next iteration:

- [Firebase messaging quickstart](https://github.com/firebase/quickstart-js/tree/master/messaging)
- [Web Push server library](https://github.com/web-push-libs/web-push)
- [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase redirect sign-in guidance](https://firebase.google.com/docs/auth/web/redirect-best-practices)
- [WebKit Web Push guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

## License

Original examples copyright 2015 Google, Inc. Apache License 2.0; see [LICENSE](LICENSE).
