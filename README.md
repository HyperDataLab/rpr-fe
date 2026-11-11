# ResearchPulse Publication Repository Frontend

Next.js frontend for the public repository, student submission workspace, lecturer review workspace, and administration console.

## Runtime architecture

- Firebase Authentication owns browser sign-in and password resets.
- The Firebase Web SDK reads and writes Firestore directly. `firestore.rules` is the authorization boundary; do not rely on UI role checks alone.
- The Cloudflare Worker owns PDF access through its R2 bucket binding and forwards authenticated PDF analysis requests to the private GROBID service.
- The previous Fastify API is no longer part of the frontend runtime. Its code remains in the sibling repository as the reference for existing Firestore records and business behavior.

The Worker source and deployment config currently live at `../ResearchPulse-Publication-Repository-BE/worker`. This is a Cloudflare Worker, not the old Fastify API.

## Configure Firebase and the Worker

1. Copy `.env.example` to `.env.local` and fill the Firebase Web app values and the deployed Worker URL.
2. Enable Email/Password in Firebase Authentication.
3. Deploy Firestore rules and indexes from this directory with `firebase deploy --only firestore:rules,firestore:indexes --project hyperdatalab-27172`.
4. Bind the existing `storage-pdf` bucket to the Worker. Set `FRONTEND_ORIGINS` to the exact deployed FE origin(s), and set the Firebase Web API key in the Worker environment.
5. Deploy the Worker from `../ResearchPulse-Publication-Repository-BE/worker` with Wrangler. The GROBID VPC network must remain connected for PDF analysis.

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

The app runs on `http://localhost:3003`. For the Worker, run Wrangler from its `worker` directory. The local R2 binding uses Wrangler's local bucket unless configured for remote development.

## Project checks

```bash
npm run lint
npm run build
```

The reusable design system is included as `@hyperdata/design-system` in `packages/design-system`.
