# Web Push codelab

A small browser push-notification demo hosted on Firebase. The app uses the Push API and a service worker to receive messages, display notifications, and return users to the site.

Primary site: **https://web-push-4u2c.web.app**. The alternate Firebase Hosting domain, **https://web-push-4u2c.firebaseapp.com**, remains available. Authentication sessions and push subscriptions are specific to each origin.

## Development

Use Node.js 24 or newer, Python 3 for the static server, and Java 21 for database rules tests.

```sh
npm ci
npm test
npm run build
npm run test:rules
python3 -m http.server 8000 --bind 127.0.0.1 --directory app/dist
```

The static server exposes the built app at `/`. Build the app first; Hosting also serves `app/dist`. Historical examples remain under `completed/` in the repository. The modular Firebase SDK is bundled locally, so reserved Hosting SDK routes are no longer required. Firebase web configuration is in `src/firebase-config.mjs`. Local sign-in requires an authorized localhost domain and a development API key configuration; never use live credentials for emulator tests.

`npm test` runs ESLint and Node tests covering notification handling, Google sign-in UI, per-owner subscription paths, form submission, sign-out cleanup, and VAPID key conversion. `npm run test:rules` uses a demo-project database emulator to check owner access, cross-user denial, legacy-path denial, record validation, and multiple devices. These checks do not exercise live Google authentication or push delivery. ESLint uses a flat configuration in `eslint.config.mjs`; dependency versions are pinned in `package-lock.json`.

The frontend remains plain JavaScript. Its current size does not justify a React dependency or build pipeline.

## Deployment

GitHub Actions runs tests on pull requests and pushes to `master`. A successful push to `master` deploys **database rules first, then Hosting** to project `web-push-4u2c`. The release stops if rules cannot be deployed. The workflow can also be started manually on `master`.

The repository secret `FIREBASE_SERVICE_ACCOUNT` supplies the deployment credential for `github-deploy@web-push-4u2c.iam.gserviceaccount.com`. Keep the credential in GitHub Actions secrets; never commit its JSON key. The deployment account has Firebase Hosting Admin; it also needs **Firebase Realtime Database Admin** (`roles/firebasedatabase.admin`) to publish rules. Actions are pinned to commit IDs, and pull requests cannot run the production deployment job.

CI runs the unit tests, build, and database emulator tests before deployment. The deploy job writes its credential to a temporary restricted file and removes it after use. Backend functions are not deployed. Existing legacy database data is not deleted, but the new rules make global `/subscription/` and `/publicKey/` records inaccessible to clients.

## Diagnostics

Expand **Diagnostics** on the page for the active site/auth domain, authentication state, browser support, notification permission, service-worker state, and subscription presence. Copy or clear the latest 20 app events; they stay in memory for this tab and use the browser's local time. Diagnostics exclude account identifiers, credentials and subscription contents. They summarize app events rather than intercepting the browser console.

Google popup authentication can emit COOP `window.closed` warnings while Firebase polls for cancellation. A signed-in account indicates login completed despite those warnings. If notifications are denied, allow them in the browser's site permissions and reload.

## Current limitations

This is a legacy demo, not yet a complete authenticated PWA:

- Subscriptions are stored at `/subscriptions/{uid}/{endpointHash}`. Rules deny unauthenticated and cross-user access. Deploy the new rules before using this client; the workflow enforces that order. Legacy records may need administrator cleanup after a backup.
- Google sign-in is integrated; anonymous provider enablement does not automatically sign users in. Sign-out unsubscribes this browser and deletes its owned record. Sign-in alone does not grant sender privileges. Keep both hosting domains authorized. Authentication uses `web.app` by default and `firebaseapp.com` only when that domain is opened intentionally. In the Google OAuth web client, authorize both redirect URIs: `https://web-push-4u2c.web.app/__/auth/handler` and `https://web-push-4u2c.firebaseapp.com/__/auth/handler`. Firebase authorized domains and Google OAuth redirect URIs are separate settings.
- Firebase SDK 13 is bundled with esbuild, and copying uses the native Clipboard API. All styles and icons are hosted locally; no Material Design Lite CDN is required. JavaScript and stylesheet filenames are versioned per build to avoid stale assets.
- The manifest, install experience, offline strategy, and message-sending backend remain to be implemented.
- Glitch project hosting has ended; the active app no longer links to its companion site. The original companion-site links and embedded keys in `completed/` are historical examples. Supply your own application-server public key; the VAPID private key belongs exclusively on the backend.
- Automatic subscription renewal needs an authenticated backend. The app checks the browser subscription when opened; it does not post renewals to a placeholder endpoint.

## Next steps

1. Verify the release's Google sign-in on both authorized Hosting domains and check the live rules. Test with two distinct accounts and multiple browser profiles.
2. Add a Cloud Functions sender using standards-based Web Push and stable VAPID credentials. Authorize senders server-side, validate payloads and push endpoints, limit sends, and remove expired subscriptions. Firebase Cloud Messaging is an alternative with a different registration flow.
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
