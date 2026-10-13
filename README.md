# Web Push codelab

A small browser push-notification demo hosted on Firebase. The app uses the Push API and a service worker to receive messages, display notifications, and return users to the site.

Primary site: **https://web-push-4u2c.web.app**. The alternate Firebase Hosting domain, **https://web-push-4u2c.firebaseapp.com**, remains available. Authentication sessions and push subscriptions are specific to each origin.

## Development

Use Node.js 24 or newer and Python 3 for the static server.

```sh
npm ci
npm test
python3 -m http.server 8000 --bind 127.0.0.1 --directory .
```

The static server exposes `/app/` and the examples under `/completed/`. It does not provide Firebase Hosting's reserved SDK and initialization routes, so the app's database integration requires Firebase Hosting or a suitable emulator configuration.

`npm test` runs ESLint and five Node tests covering notification payloads, notification clicks, form navigation, and subscription serialization. These tests do not exercise live Firebase authentication or push delivery. ESLint uses a flat configuration in `eslint.config.mjs`; dependency versions are pinned in `package-lock.json`.

The frontend remains plain JavaScript. Its current size does not justify a React dependency or build pipeline.

## Deployment

GitHub Actions runs tests on pull requests and pushes to `master`. A successful push to `master` deploys **Hosting only** to project `web-push-4u2c`. The workflow can also be started manually on `master`.

The repository secret `FIREBASE_SERVICE_ACCOUNT` supplies the deployment credential for `github-deploy@web-push-4u2c.iam.gserviceaccount.com`. Keep the credential in GitHub Actions secrets; never commit its JSON key. The deployment account has Firebase Hosting Admin. Actions are pinned to commit IDs, and pull requests cannot run the production deployment job.

Database rules and backend functions are not deployed by this workflow. Do not run a blanket `firebase deploy` with the current database rules.

## Current limitations

This is a legacy demo, not yet a complete authenticated PWA:

- The checked-in Realtime Database rules allow public reads and writes. Live rules must be inspected separately. Replace the rules and shared `/subscription/` record together with authenticated per-user, per-device storage before opening the demo to multiple users.
- Google sign-in is enabled in the project but has no frontend integration yet. Sign-in alone must not grant permission to send notifications.
- The app uses Firebase SDK 6.0.2, Material Design Lite, and a clipboard library. Migrate to the modular Firebase SDK and native Clipboard API during the next frontend update.
- The manifest, install experience, offline strategy, and message-sending backend remain to be implemented.
- Glitch project hosting has ended; the active app no longer links to its companion site. The original companion-site links and embedded keys in `completed/` are historical examples. Supply your own application-server public key; the VAPID private key belongs exclusively on the backend.
- Automatic subscription renewal needs an authenticated backend. The app checks the browser subscription when opened; it does not post renewals to a placeholder endpoint.

## Next steps

1. Integrate Google authentication using the registered Firebase web app configuration. Keep both Hosting domains authorized. Configure and test same-origin auth handling before changing `authDomain` for redirect sign-in.
2. Move subscriptions under each user's UID and device identifier. Test ownership, validation, deletion, and account linking with database rules in an emulator.
3. Add a Cloud Functions sender using standards-based Web Push and stable VAPID credentials. Authorize senders server-side, validate payloads and push endpoints, limit sends, and remove expired subscriptions. Firebase Cloud Messaging is an alternative with a different registration flow.
4. Add a web manifest, install guidance, and explicit permission controls. Define notification action behavior and unsupported-browser states.
5. Test real delivery, unsubscribe, denied permissions, multiple users, and both Hosting origins. Include supported Android browsers and installed iOS/iPadOS Home Screen web apps.

## Security and credentials

Firebase web app configuration and VAPID **public** keys are client configuration, not server credentials. Private VAPID keys, service-account JSON, OAuth client secrets, and personal access tokens must stay outside the repository. Local environment files and common credential file extensions are ignored; ignore rules are a precaution, not a secret detector.

A credential-pattern review of tracked files found no matching server credentials. Local Git history includes cryptography test keys and PEM-format markers from previously vendored Python libraries; these are test fixtures or library code, not identified deployment credentials. Pattern matching cannot guarantee the absence of every secret. Open database access is a separate issue and remains unresolved.

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
