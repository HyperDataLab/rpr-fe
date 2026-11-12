# ResearchPulse Publication Repository Frontend

Next.js frontend for the public repository, student submission workspace, lecturer review workspace, and administration console.

## Runtime architecture

- Firebase Authentication owns browser sign-in and password resets.
- The Firebase Web SDK reads and writes Firestore directly. `firestore.rules` is the authorization boundary; do not rely on UI role checks alone.
- The Cloudflare Worker owns authenticated PDF access through its R2 bucket binding and Google Workspace account administration through the Admin SDK Directory API. The manuscript form sends PDFs to the configured GROBID HTTPS service for metadata extraction.
- The previous Fastify API is no longer part of the frontend runtime. The frontend and its Worker source, configuration, and deployment commands are maintained in this repository.

## Configure Firebase and the Worker

1. Copy `.env.example` to `.env.local` and fill the Firebase Web app values, the deployed Worker URL, and `NEXT_PUBLIC_GROBID_URL` (defaults to `https://grobid.hyperdatalab.org`).
2. Enable Email/Password in Firebase Authentication.
3. Deploy Firestore rules and indexes from this directory with `firebase deploy --only firestore:rules,firestore:indexes --project hyperdatalab-27172`.
4. The Worker binds the existing `storage-pdf` bucket in `worker/wrangler.toml`; it uses this binding and does not need R2 S3 credentials. Set `FRONTEND_ORIGINS` to the exact FE origins that will call it.
5. Run `npm run worker:dev` for local development or `npm run worker:deploy` to deploy. Wrangler prints the deployed `workers.dev` URL; set that origin as `NEXT_PUBLIC_R2_WORKER_URL` in `.env.local` and restart the FE.
6. Set `FIREBASE_WEB_API_KEY` as a Worker secret only if using the account-invitation route: `npx wrangler secret put FIREBASE_WEB_API_KEY --config worker/wrangler.toml`. Public registration stores applicant details only in `registrationRequests`; it does not create Firebase Auth or an application profile.

Google Workspace account administration requires a Cloudflare D1 database, a Google OAuth Web Application client, and Worker secrets. Follow [Google Workspace setup](docs/GOOGLE_WORKSPACE_SETUP.md), [API reference](docs/API_REFERENCE.md), [frontend integration](docs/FRONTEND_INTEGRATION.md), and [security notes](docs/SECURITY.md). It uses the existing Worker's Firebase Admin authorization and does not use a separate backend or Domain-Wide Delegation.

Workspace Directory users are separate from Firebase Auth users and Firestore profiles. To link the already existing `admin@hyperdatalab.org` mailbox to an approved Firebase profile, first apply the D1 migrations with `npm run worker:migrate:remote`, then run `npm run seed:workspace-admin`. The seed uses the service-account path and project confirmation in `.env.local`; it does not create a mailbox, change a password, or send email. It creates/reuses the Firebase `userProfiles` document and adds the matching D1 SSO link. The general demo seed remains `npm run seed`.

The Firebase Web API key and web app configuration are client identifiers, not service-account credentials. Never put a Firebase service-account key or an R2 access key in this repository or a `NEXT_PUBLIC_*` variable. The Worker uses the R2 binding and does not need S3 credentials.

## Existing data migration

The old BE stores account data in `users/{id}` and includes `passwordHash` there. Client rules deliberately deny that collection. Existing BE user IDs are not Firebase Auth UIDs, while publications, reviews, and notifications reference those old IDs. Existing accounts and their related records therefore need a trusted migration/mapping before they can be used from the new FE. Old passwords are not automatically carried into Firebase Auth; users need an account setup/reset flow.

The first ADMIN profile must be provisioned through a trusted Firebase administration path before protected admin screens can be used. Do not grant roles by editing a browser-owned profile.

## Migration parity limits

- Admin approval and invitation use Firebase profiles and the Worker, but creating/deleting Firebase Auth users and changing another user's email/password still require a privileged Auth administration route.
- Editing metadata on a published item updates the publication record only. It does not yet fork a version and copy the PDF in R2 as the old BE did; author/privacy edits on published items are blocked.
- Existing author account matching/auto-verification and some workflow notifications are not reproduced by the direct-client path. Review assignment carry-forward on revisions is supported.

## Local development

```bash
npm ci
npm run dev
```

The app runs on `http://localhost:3003`. Run `npm run worker:dev` from this repository root for the Worker. Wrangler uses a local R2 emulator by default, so local uploads do not prove that the deployed Worker can write to the Cloudflare bucket. Optional Worker secrets go in ignored `worker/.dev.vars`.

## Project checks

```bash
npm run lint
npm run build
npm run worker:test
```

The reusable design system is included as `@hyperdata/design-system` in `packages/design-system`.
