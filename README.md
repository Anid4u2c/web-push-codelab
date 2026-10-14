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

The script enables only missing required APIs, creates missing accounts and an empty secret container, and grants the roles below. Secret permissions are scoped to the chosen secret; Service Account User is scoped to the runtime account and, when present, the default App Engine account required by the pinned Firebase CLI and the default Compute account used for function builds. It does not create service-account JSON keys or read secret values. GitHub generates the VAPID pair on deployment.

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
2. **Database instance and runtime identity.** Enabling the Realtime Database API alone does not create or activate a database. In Firebase Console, select your project, open **Build → Realtime Database**, and create a database if missing using the intended region and locked mode. If an existing instance is disabled, review why before enabling it. Copy its URL into both frontend and backend configuration if needed, and verify the database rules deployment target. Setup checks instance metadata and stops unless the configured URL matches an ACTIVE instance; it does not replace databases or weaken rules. Use your selected runtime service account (`RUNTIME_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com`). Grant it Firebase Realtime Database Admin (`roles/firebasedatabase.admin`) on the project. This account runs the functions; it does not need Hosting or Functions deployment roles.
3. **Allow deployment to use runtime.** Open [Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts), select your runtime account, then **Permissions → Grant access**. Add `DEPLOY_ACCOUNT@PROJECT_ID.iam.gserviceaccount.com` as principal with **Service Account User** (`roles/iam.serviceAccountUser`). Apply this grant to the runtime account itself. The pinned Firebase CLI also checks `iam.serviceAccounts.actAs` on the existing default App Engine account (`PROJECT_ID@appspot.gserviceaccount.com`), even when functions use a custom runtime identity. Grant the deployment principal Service Account User on that account too; the setup script handles this when the account exists and never creates a default account. For function builds using the existing default Compute account (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`), the deployment principal also needs Service Account User on that account. Setup discovers the project number and grants this only when the account exists. It never creates either default account. The functions still run as the selected runtime account. Service Account Token Creator is not required for this deployment.
4. **Deployment permissions.** In [project IAM](https://console.cloud.google.com/iam-admin/iam), the selected deployment account needs Firebase Hosting Admin, Firebase Realtime Database Admin, Cloud Functions Admin (`roles/cloudfunctions.admin`) and Cloud Run Admin (`roles/run.admin`). Cloud Functions Admin includes `cloudfunctions.functions.setIamPolicy`, which the pinned CLI checks when creating public HTTPS functions; Cloud Functions Developer does not include that permission. The Cloud Shell administrator creates the secret container and grants the deployment account Secret Manager Admin (`roles/secretmanager.admin`) on that secret only. If relying on the deployment job to create the container instead, it needs project-level secret creation permissions initially. Do not grant Owner or Editor.
5. **GitHub credential.** Keep the existing repository Actions secret **`FIREBASE_SERVICE_ACCOUNT`** containing the deployment account's JSON credential. No additional GitHub VAPID secret is needed.
6. **Run deployment.** Push to `master`, or open [GitHub Actions](../../actions), select **Validate and deploy Firebase push demo**, and choose **Run workflow** on `master`. Check the preparation and function deployment steps before expecting the new Hosting UI.

### Troubleshooting the default service-account permission check

If deployment reports missing `iam.serviceAccounts.ActAs` on the default App Engine or Compute account, update your checkout and rerun setup:

```sh
git pull --ff-only
node scripts/setup-gcp.mjs
```

Enter the same project and account names used previously, approve the displayed plan, then rerun deployment after IAM changes propagate. Alternatively, a project administrator can grant the deployment principal **Service Account User** directly on the existing default account named in the error in **Service Accounts → Permissions → Grant access**. A project-wide grant is unnecessary.

### Container image cleanup

The pinned CLI requires an Artifact Registry cleanup policy for noninteractive deployment. Setup checks the existing `gcf-artifacts` repository in `us-central1` and, if no policy or explicit opt-out exists, enables a 7-day deletion policy for build images. Existing policies are preserved. This removes old stored build images, not running services; old image downloads may no longer be available.

If the first deployment says **Functions successfully deployed but could not set up cleanup policy**, rerun Cloud Shell setup and then deployment. The repository exists after function creation. The administrator configures cleanup; the deployment account does not need Artifact Registry Admin.

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

## Reviewing notification responses

New test notifications ask **Did you send this test notification from the browser on this device?** Yes and No record separate responses; clicking the notification body records an open action. The service worker focuses an existing site tab when available or opens a new one, and records that result.

Expand **Test notification history** and refresh while signed in to review the latest 20 tests for your account. Records include a random test ID, sending/target subscription hashes, creation and expiry times, provider result, the reported receiving subscription hash, browser event time, server recording time, first response, tab-opening result and answer comparison. Raw endpoints, encryption keys, Google ID tokens and receipt capabilities are excluded from history. Records are owner-readable and server-write-only.

Matching subscription IDs support Yes; different IDs support No. Contradictions are labeled **response mismatch**, and missing IDs are not evaluated. A subscription identifies a browser installation, not physical hardware. The server verifies an expiring capability delivered in the encrypted notification; the receiving ID and client time remain client-reported evidence. This is a test review tool, not a tamper-proof device attestation system. The current sender still targets its initiating browser; another-device targeting is not implemented.

Diagnostics report receipt submission status while the page is open (saved, already recorded, HTTP error or network failure), without exposing receipt tokens. Refresh history after answering to read the latest server record. Receipts are best effort and may be absent when the browser is offline or terminates the worker. Provider acceptance is not proof of display. Only the first receipt and first click response are retained, and receipt capabilities expire after 24 hours. There is no automatic history purge yet; administrators can remove old `pushTests` and `_pushTestReceipts` records according to their retention needs. Historical notifications cannot gain tracking retroactively. Chrome’s own Unsubscribe action is browser-controlled and does not pass through the Yes/No handler.

## Diagnostics

Expand **Diagnostics** on the page for the active site/auth domain, authentication state, browser support, notification permission, service-worker state, backend key availability, and subscription presence. Use the touch-friendly copy-icon buttons for subscription data, test history and diagnostics. Each provides copy feedback and a selectable fallback if clipboard access fails. Copy, download or clear the latest 20 app events; they stay in memory for this tab and use the browser's local time. Diagnostics exclude account identifiers, credentials and subscription contents. They summarize app events rather than intercepting the browser console. Copy remains available during other operations; when clipboard access fails, a selectable text field appears. Download diagnostics is an alternative. The page explains why push/test controls are disabled and distinguishes a browser subscription from a subscription saved for the signed-in account. Database saves time out with a retry option instead of indefinitely locking controls. A timeout does not cancel a queued database write; a retry writes the same owned device record.

Google popup authentication can emit COOP `window.closed` warnings while Firebase polls for cancellation. A signed-in account indicates login completed despite those warnings. If notifications are denied, allow them in the browser's site permissions and reload.

### Subscription saves timing out

A browser subscription can exist while its database write remains unconfirmed. Check **Database connection** in Diagnostics. If disconnected, verify connectivity and that the configured URL belongs to an active database. From a signed-in Cloud Shell checkout:

```sh
node scripts/check-database.mjs
```

This lists instance URLs and their state, compares them with the frontend configuration, and reads no database records. Share this metadata and the safe page Diagnostics; subscription JSON is unnecessary. A URL mismatch requires updating both frontend and backend database URLs and checking the rules deployment target. A connected database with failed writes calls for checking deployed owner rules and authentication; never loosen rules to troubleshoot.

### Export backend logs from Cloud Shell

After reproducing an issue, run from your checkout while signed in with a Cloud Logging reader identity:

```sh
node scripts/export-push-logs.mjs --since 1h --limit 200
```

The script uses the active `gcloud` project; override with `--project PROJECT_ID` if needed. It writes a timestamped JSON file under the project-root **logs/** folder, which is ignored by Git, and includes the receipt endpoint and prints request status counts without dumping log contents. Audit logs are excluded so deployment records do not crowd out requests and application errors. For a named file:

```sh
node scripts/export-push-logs.mjs --output logs/push-logs.json
cloudshell download logs/push-logs.json
```

Existing files are not overwritten. Exported logs can contain personal data; review before sharing. A signed-in page alone is not sufficient to send: notification permission, a matching browser subscription and a confirmed database save are required. If no `testpush` request appears, use the page diagnostics to identify the blocked client step.

The CLI warning **Failed to fetch the list of extensions** is separate from function application errors. This app deploys standalone functions, not an extension. If deployment continues successfully, that warning alone is not a reason to add Extensions permissions. Investigate it if extension management is actually needed.

## Current limitations

This is a legacy demo, not yet a complete authenticated PWA:

- Subscriptions are stored at `/subscriptions/{uid}/{endpointHash}`. Rules deny unauthenticated and cross-user access. Deploy the new rules before using this client; the workflow enforces that order. Legacy records may need administrator cleanup after a backup.
- Google sign-in is integrated; anonymous provider enablement does not automatically sign users in. Sign-out unsubscribes this browser and deletes its owned record. Google sign-in allows self-tests on that user’s devices only. Keep both hosting domains authorized. Authentication uses `web.app` by default and `firebaseapp.com` only when that domain is opened intentionally. In the Google OAuth web client, authorize both redirect URIs: `https://PROJECT_ID.web.app/__/auth/handler` and `https://PROJECT_ID.firebaseapp.com/__/auth/handler`. Firebase authorized domains and Google OAuth redirect URIs are separate settings.
- Firebase SDK 13 is bundled with esbuild, and copying uses the native Clipboard API. All styles and icons are hosted locally; no Material Design Lite CDN is required. JavaScript and stylesheet filenames are versioned per build to avoid stale assets.
- The manifest, install experience, and offline strategy remain to be implemented. The sender supports self-tests only; there is no broadcast or arbitrary-message endpoint.
- Glitch project hosting has ended; the active app no longer links to its companion site. The original companion-site links and embedded keys in `completed/` are historical examples. The live app gets its public key from the backend; the private key is never returned to the browser.
- Automatic subscription renewal needs an authenticated backend. The app checks the browser subscription when opened; it does not post renewals to a placeholder endpoint.

## Release validation and follow-up

The deployment workflow completed successfully, and Android Chrome displayed the self-test notification. Sending also succeeded with a second Google account. These manual checks confirm real delivery for the tested accounts and device; they do not establish cross-account isolation by themselves. Automated database rules tests cover owner access and cross-user denial.

An existing Realtime Database instance needed to be enabled again before subscription saves completed. Setup now verifies that the configured instance is ACTIVE rather than relying solely on API enablement. If an instance becomes inactive, review its state and the reason in Firebase Console before re-enabling it; no replacement database is required for an existing instance.

Remaining follow-up:

- Verify sign-out/unsubscribe and both Hosting origins on real devices, including denied notification permissions.
- Add a web manifest, app icons and install guidance for a complete PWA showcase. Notification appearance is controlled by the browser and OS; installation does not guarantee browser branding disappears everywhere.
- Test installed iOS/iPadOS Home Screen delivery when the install experience is available.
- Add App Check and stronger abuse controls before promoting the demo to a wider public audience.

## Security and credentials

Firebase web app configuration and VAPID **public** keys are client configuration, not server credentials. Private VAPID keys, service-account JSON, OAuth client secrets, and personal access tokens must stay outside the repository. Local environment files and common credential file extensions are ignored; ignore rules are a precaution, not a secret detector.

A credential-pattern review of tracked files found no matching server credentials. Local Git history includes cryptography test keys and PEM-format markers from previously vendored Python libraries; these are test fixtures or library code, not identified deployment credentials. Pattern matching cannot guarantee the absence of every secret. Live rule deployment must be verified separately. The frontend production and Functions dependency audits reported no vulnerabilities during the release review. The Firebase CLI’s `gaxios` dependency now uses a scoped `uuid@11.1.1` override to fix [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); its CommonJS API and normal UUID generation are verified. The override does not affect the separate analytics dependency. The broader development-tool audit still reports advisories through Firebase CLI dependencies, including OpenTelemetry, FTP/proxy tooling and braces. These tools are not included in the deployed frontend or Functions runtime, but their findings remain open for upstream updates and tooling review. The GitHub Dependabot alert API was inaccessible to this environment, so the exact alert identity and closure were not independently verified.

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
