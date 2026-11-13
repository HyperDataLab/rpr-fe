# ResearchPulse data Worker

This Worker lives with the frontend and handles authenticated PDF access through Cloudflare R2 and Google Workspace user administration through the Admin SDK Directory API. The browser sends Firebase ID tokens to the Worker. Manuscript metadata extraction uses `NEXT_PUBLIC_GROBID_URL` directly from the frontend.

## Routes

- `POST /r2/upload?fileName=...`: uploads a PDF from an authenticated student or lecturer to the `storage-pdf` bucket.
- `GET /r2/object?key=...&publicationId=...`: checks Firestore access and streams the PDF, including HTTP byte-range requests for in-browser PDF rendering. Public guest publications can be read without signing in.
- `DELETE /r2/object?key=...&publicationId=...`: deletes a draft owner's PDF after checking ownership; admins may delete by key.
- `POST /auth/register` and `POST /auth/invite`: registration and legacy invitation routes.
- `POST /api/processHeaderDocument`: optional forwarding route for private GROBID deployments.
- `/auth/google/*` and `/api/workspace/users*`: Google Workspace connection and user-management API. These routes require an active Firebase `ADMIN` profile except for the state-protected Google OAuth callback.
- `POST /api/workspace/profiles`: creates an approved app profile linked to an existing active Workspace primary email, saves the required personal-email recipient, and emails access instructions. It includes a still-pending Worker-generated temporary password once and rejects email/link duplicates. `onboardingEmailSent: false` means the profile is linked but delivery should be retried with Resend access.
- `POST /auth/register`: stores the applicant's contact and student details in `registrationRequests` only. It creates no Firebase Auth user or application profile; those are created after admin approval and Workspace email linking.
- `POST /api/workspace/registrations/:uid/approve`: verifies an existing active primary Workspace mailbox and links it to the Firebase application profile only after approval, using the registration UID and submitted details. Legacy pending profiles are updated in place. It never creates a mailbox or changes a password; if the mailbox is missing, an administrator must create it explicitly in Account Management before retrying approval. The email includes a still-pending one-time temporary password only when the mailbox was created by this Worker.
- `POST /api/workspace/registrations/:uid/resend`: sends SSO instructions to the registered personal contact and includes a newly provisioned mailbox's encrypted temporary password only if it is still pending. The encrypted password is deleted after Resend accepts the message or expires after seven days. Existing mailboxes have no retrievable password and receive SSO instructions only. This route never changes Workspace credentials.
- `DELETE /api/workspace/app-users/:uid`: permanently deletes a Firebase Auth account and its application records after exact-email confirmation. It removes the D1 app-to-Workspace identity link, but never calls Google Directory or changes the mailbox. R2 PDF files are preserved. The Firebase service account needs `firebaseauth.users.delete` permission for this route.
- `POST /auth/workspace/exchange`: validates a verified Google Workspace Firebase sign-in against the D1 profile link and issues a Firebase custom token for the existing application UID.
- `GET /health`: Worker health response.

## Run locally

From the FE repository root:

```powershell
npm run worker:dev
```

The local Worker listens on `http://localhost:8787`. Wrangler uses a local R2 emulator by default; local uploads do not prove that a deployed Worker can write to the Cloudflare bucket.

Optional local Worker secrets go in `worker/.dev.vars`, which is ignored by Git. See `.dev.vars.example` for variable names.

Google Workspace also requires a D1 database. Create it, replace the D1 UUID placeholder in `wrangler.toml`, apply `worker/migrations`, configure Google OAuth and Worker secrets, then connect an approved Workspace administrator in the Admin account page. Follow [Google Workspace setup](../docs/GOOGLE_WORKSPACE_SETUP.md), [API reference](../docs/API_REFERENCE.md), [frontend integration](../docs/FRONTEND_INTEGRATION.md), and [security notes](../docs/SECURITY.md).

## Deploy

From the FE repository root, authenticate with Cloudflare once, then deploy:

```powershell
npx wrangler login
npm run worker:deploy
```

Wrangler prints the deployed `workers.dev` URL. Set its origin as `NEXT_PUBLIC_R2_WORKER_URL` in `.env.local`, restart the FE, and check `<worker-url>/health` before testing an upload with a student or lecturer account. Admin uploads are intentionally rejected.

The `PUBLICATION_PDFS` binding and `storage-pdf` bucket are declared in `wrangler.toml`. Do not place R2 S3 credentials in FE environment variables; the Worker accesses the bucket through the binding. Set `FRONTEND_ORIGINS` to exact browser origins. Firebase service-account JSON and Resend API key are Worker secrets; see `.dev.vars.example` and the setup guide.

Run the isolated Worker tests with `npm run worker:test`. Deploy only after creating/binding D1 and configuring production OAuth values and secrets; this change does not deploy the Worker.
