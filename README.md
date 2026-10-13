# Web Push PWA showcase

A legacy Web Push codelab fork being prepared for a modern Firebase-backed PWA demonstration. The current application is **not yet a production-ready authenticated showcase**.

## Origins and current references

The original examples come from [GoogleChromeLabs/web-push-codelab](https://github.com/GoogleChromeLabs/web-push-codelab) and Google's [Push Notifications codelab](https://codelabs.developers.google.com/codelabs/push-notifications/). This fork added Realtime Database integration, subscription copying, and notification actions. The `completed/` directories preserve the original teaching progression; their embedded public keys and companion-site links are historical examples.

Reviewed on October 13, 2026:

- [Firebase JavaScript messaging quickstart](https://github.com/firebase/quickstart-js/tree/master/messaging): a newer Firebase-oriented example using Vite, TypeScript, and the messaging SDK. Its README structure informed this document's setup, validation, and deployment sections. Verify sender API details against official documentation rather than copying every sample instruction unchanged.
- [web-push](https://github.com/web-push-libs/web-push): server-side standards-based Web Push with VAPID keys and encrypted payloads. Prefer this route for a showcase explaining browser Push API subscriptions; Firebase Cloud Messaging is a reasonable alternative, but uses a different registration/sending flow.
- [Firebase Google authentication](https://firebase.google.com/docs/auth/web/google-signin) and [redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices): references for the pending authentication integration.
- [WebKit's iOS Web Push guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): test installed Home Screen web apps on supported iOS/iPadOS versions, with permission requested from a user action.

The GitHub source READMEs were retrieved during review. The linked Google documentation and WebKit pages could not be fetched through this environment's network policy; they are references, not verified live configuration. The original upstream README itself still mentions Google Cloud Messaging and is not a modernization template. Treat the Glitch companion as a historical dependency; this review did not verify its availability.

## Local development

Prerequisites: Node.js/npm and Python 3. The existing toolchain was exercised with Node 24.19.0, npm 11.9.0, and Python 3.12.14. ESLint 3 is legacy and emits warnings on current Node.

```sh
cd /workspace/web-push-codelab
npm install --package-lock=false --no-audit --no-fund --cache /workspace/.npm-cache
npm test
python3 -m http.server 8000 --bind 127.0.0.1 --directory .
```

There is no build step or dependency lockfile. The installation command preserves that state; a future tooling migration should introduce a reviewed lockfile. The static server exposes `/app/` and `/completed/08-push-subscription-change/`. Localhost is suitable for service-worker development; deployed service workers require HTTPS.

A static server does **not** supply Firebase Hosting's `/__/firebase/...` SDK and initialization routes. It verifies file serving and lets you inspect the original completed examples, but cannot validate the customized app's database workflow. Do not interpret `npm test` as browser coverage: it runs ESLint only.

## What this review changed

- Corrected the page instruction to copy the VAPID **public** key. Private keys belong only on the sending backend.
- Made empty push payloads display the existing fallback message instead of throwing.
- Changed notification clicks to open the app's own service-worker scope.
- Removed broken automatic renewal that omitted the VAPID key and posted an incomplete subscription to a nonexistent `register` endpoint. Opening the app checks the current browser subscription; reliable renewal and authenticated server reconciliation still need implementation.
- Fixed the four existing lint violations in the customized app.

## Review findings and remaining work

| Finding | Consequence / required change |
| --- | --- |
| `database.rules.json` grants everyone read/write access | These checked-in rules must be replaced and tested before deployment. Live rules were not inspected. |
| `/subscription/` and `/publicKey/` are global records | Visitors overwrite one another's subscription/key; a visitor without a subscription can delete the shared record during initialization. Use subscriptions per authenticated UID and device, with a server-controlled public key. |
| Google sign-in enabled in the console, but no Auth SDK or sign-in flow in the app | Enabling a provider alone does not authenticate database requests or authorize senders. |
| Firebase SDK 6.0.2, Material Design Lite, clipboard library and legacy lint dependencies | Migrate to a current modular SDK and supported tooling; native Clipboard API can replace the clipboard dependency. |
| No manifest, install experience, or sending backend | This is currently a service-worker demo, not a complete installable PWA showcase. |
| “Yes” and “No” notification actions have the same click handling | Define actual action behavior and a normal notification-click fallback; browsers differ in action support. |
| Public-key form submits by default; asynchronous database operations are not consistently awaited | Prevent form navigation, surface failures, and restore controls after failures. |
| Renewal examples use mismatched hardcoded keys; app had no registration endpoint | Preserve historical examples as examples; implement authenticated renewal using the same application-server key. |

## Step-by-step modernization

1. **Establish the Firebase app configuration.** Use project `web-push-4u2c`; obtain its registered web app config and actual Realtime Database URL from project settings. Do not invent the app ID or database hostname. Inspect live rules, deployed services and IAM bindings before changing them. The App Engine default service account alone does not establish App Engine usage; this checkout has no App Engine configuration.
2. **Choose the primary origin.** Use `https://web-push-4u2c.web.app` in navigation, sharing and the manifest; retain `https://web-push-4u2c.firebaseapp.com`. Keep both authorized for Firebase Auth. Sessions and push subscriptions are origin-specific; the two domains do not share them. For redirect sign-in on `web.app`, configure and test same-origin auth handling following Firebase's redirect guidance. Hosting URL and `authDomain` are separate settings.
3. **Integrate authentication.** Add the current modular Firebase SDK and Google sign-in/sign-out UI. Anonymous visitors may try subscriptions; link accounts only if persistent identity is needed. Require explicit server-side authorization for sending, such as an admin custom claim assigned by a trusted administrator. Google sign-in alone must not grant sender privileges.
4. **Replace global subscription storage and rules together.** Store multiple browser subscriptions under each UID, validate record shape and lengths, and restrict reads/writes to the owner. Keep VAPID public configuration read-only to clients. Verify unauthenticated and cross-user access is denied with emulator tests before any rules deployment. Choose an account-linking and deletion strategy.
5. **Add the sender backend.** Use Cloud Functions and `web-push`, with a stable VAPID key pair and private key stored as a backend secret. Check Firebase billing/runtime prerequisites. Authenticate and authorize each request, validate payload size, limit sends, and remove subscriptions returning 404/410. Do not log subscription secrets or allow arbitrary user-supplied destinations without validating their role as push endpoints. Never put service-account credentials or VAPID private keys in browser code.
6. **Build the PWA experience.** Add a manifest, suitable icons, install guidance and a deliberate offline strategy. Request notification permission only after an explicit click. Show unsupported/denied states; reconcile subscriptions at startup and remove server records when unsubscribing. Give notification actions clear behavior.
7. **Modernize development tooling.** Adopt a supported lint setup, pinned dependencies and a lockfile. Use the Firebase quickstart as a structural reference, not as a wholesale replacement of this fork. Add tests for auth boundaries, payload handling, subscription lifecycle and sender authorization.
8. **Validate and release.** Test Google sign-in on both hosting domains, Chrome/Edge desktop, supported Android browsers, and installed iOS/iPadOS web apps. Exercise empty/text payloads, background delivery, clicks/actions, denied permission, expired subscriptions, unsubscribe and two simultaneous users. Use a Hosting preview before production. Deploy only reviewed rules/backend/application changes; do not blindly deploy the existing open rules.

## Configuration and deployment status

Local dependency installation and static HTTP serving were verified during onboarding. Firebase project access, live authentication, database rules, sending and push delivery have not been verified. No cloud resources, IAM roles, or deployments were changed during this review. The console's Google provider enablement was reported by the project owner.

The onboarding configuration contains installation and static-server startup instructions. Its original baseline noted four lint errors; those errors are corrected by this review. Keep startup notes synchronized if adopting a new dev server or backend. Each cloud task has an isolated environment; reuse its existing checkout rather than creating a Git worktree unless requested.

## License

Original examples copyright 2015 Google, Inc. Licensed under the Apache License, Version 2.0; see [LICENSE](LICENSE). Retain the original source notices when adapting examples.

## GitHub deployment automation

`.github/workflows/firebase-hosting.yml` runs `npm test` on pull requests and pushes to `master`. Successful pushes to `master` deploy **Firebase Hosting only** to project `web-push-4u2c`; both default Hosting domains remain available. Database rules and backend functions are not deployed by this workflow. Manual dispatch on `master` can retry deployment after credential setup. Actions are pinned to reviewed tag commit IDs.

The repository Actions secret is named `FIREBASE_SERVICE_ACCOUNT` and contains the deployment service account's JSON credential. The project owner reports that `github-deploy@web-push-4u2c.iam.gserviceaccount.com` has Firebase Hosting Admin. The workflow uses this existing secret; no duplicate secret is needed. Keep the JSON out of Git and chat. GitHub API access was denied during setup, so the credential and workflow outcome have not been independently verified. A missing secret fails the deployment job with an explicit error; investigate any deployment permission error before adding broader IAM roles.

Push-to-deploy does not complete the modernization above: authentication, per-user storage, database rules, PWA installation, and the sender backend remain pending. Review existing live rules before presenting the site as an authenticated demo.
