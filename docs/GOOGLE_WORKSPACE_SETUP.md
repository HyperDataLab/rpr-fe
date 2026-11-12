# Google Workspace and Cloudflare setup

This integration runs in the existing Cloudflare Worker. It uses Google OAuth Authorization Code flow and the Admin SDK Directory API. It does not use a service account or Domain-Wide Delegation.

## 1. Google Cloud OAuth client

1. Open the Google Cloud project that will own the OAuth consent configuration.
2. Enable **Admin SDK API**.
3. Configure the OAuth consent screen with the application name, support email, and allowed audience. If the consent screen is External and still in Testing, add the connecting administrator as a test user.
4. Create an OAuth client with application type **Web application**.
5. Add the exact Worker callback as an authorized redirect URI:
   `https://<worker-hostname>/auth/google/callback`
   For local development use `http://localhost:8787/auth/google/callback`.
6. Add only the Worker/frontend origins needed for your deployment. The required Workspace scope is `https://www.googleapis.com/auth/admin.directory.user`; the implementation also requests `openid email profile` to verify who granted access.
7. Keep the client secret private. Never put it in a `NEXT_PUBLIC_*` frontend variable.

The Workspace administrator must approve the consent screen and have Directory user-management rights. Google may require OAuth verification depending on the consent-screen audience and deployment.

## 1a. Firebase Google sign-in and Resend

1. In Firebase Console → Authentication → Sign-in method, enable **Google**.
2. Add the local frontend host (`localhost`) and production app domain to Firebase Authentication's authorized domains.
3. Set `NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN=hyperdatalab.org` in the FE `.env.local` for local testing. This is only an account-picker hint; the Worker verifies the domain and the existing D1 link.
4. Verify the sending domain in Resend and set the matching sender in `RESEND_FROM_EMAIL` in Wrangler vars. Configure `RESEND_API_KEY` as a Worker secret.

## 2. Create and bind D1

From the repository root:

```powershell
npx wrangler@4.160.1 d1 create researchpulse-workspace
```

Copy the returned database UUID into `worker/wrangler.toml` at `[[d1_databases]].database_id` (replace the all-zero placeholder). Then run:

```powershell
npx wrangler@4.160.1 d1 migrations apply researchpulse-workspace --local --config worker/wrangler.toml
npx wrangler@4.160.1 d1 migrations apply researchpulse-workspace --remote --config worker/wrangler.toml
```

The remote migration changes only the new Workspace tables. Review the SQL in `worker/migrations` before applying it.

## 3. Configure Worker values and secrets

Set the public/operational values in the Wrangler environment for the intended deployment:

- `FIREBASE_PROJECT_ID`: Firebase project used by the existing Worker.
- `FRONTEND_URL`: exact frontend origin, for example `https://app.example.org`.
- `ALLOWED_ORIGINS`: comma-separated exact frontend origins; no wildcard.
- `GOOGLE_WORKSPACE_DOMAIN`: Workspace primary domain, without `@`.
- `GOOGLE_ADMIN_EMAILS`: comma-separated Google accounts allowed to own the connection and protected from deletion.
- `GOOGLE_REDIRECT_URI`: exact callback URL registered in Google Cloud.
- `WORKSPACE_DELETE_ENABLED`: keep `false` unless permanent deletion has been reviewed and deliberately enabled.

The OAuth client ID, redirect URI, Workspace domain, admin allowlist, and key version are non-secret values in `[vars]` in `worker/wrangler.toml`. Replace the sample values for the target environment. Store sensitive values as Worker secrets (Wrangler prompts for each value):

```powershell
npx wrangler@4.160.1 secret put GOOGLE_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler@4.160.1 secret put TOKEN_ENCRYPTION_KEYS --config worker/wrangler.toml
npx wrangler@4.160.1 secret put FIREBASE_SERVICE_ACCOUNT_JSON --config worker/wrangler.toml
npx wrangler@4.160.1 secret put RESEND_API_KEY --config worker/wrangler.toml
```

Generate a 256-bit key locally in PowerShell (do not paste it in chat or commit it):

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Set `TOKEN_ENCRYPTION_KEY_VERSION` to `v1` and `TOKEN_ENCRYPTION_KEYS` to a JSON object such as `{"v1":"<generated-base64-key>"}`. The JSON keyring lets you retain old versions during key rotation. For local development, copy `worker/.dev.vars.example` to the ignored `worker/.dev.vars` and enter local-only values there.

`FIREBASE_SERVICE_ACCOUNT_JSON` must be the private service-account JSON for the same Firebase project (Firebase Console → Project settings → Service accounts). It is used only inside the Worker to sign Firebase custom tokens and to perform server-side Firestore profile lookups/creation, which are not subject to client Firestore rules. Grant that service account Firestore data access in Google Cloud IAM (the predefined `Cloud Datastore User` role, `roles/datastore.user`, includes entity read/write access); the Worker fails closed if it cannot perform the duplicate-profile lookup. Never enable Domain-Wide Delegation or commit this JSON. `RESEND_API_KEY` is a Resend secret. Verify the sender domain in Resend and set `RESEND_FROM_EMAIL` in `[vars]` to that verified sender. Approval can send the encrypted, one-time temporary password only for mailboxes created through this Worker's account form; existing mailbox passwords are unavailable to the API. Password change is required at first Google sign-in; approval itself never changes the password. See [Firestore IAM roles](https://cloud.google.com/iam/docs/roles-permissions/firestore).

Also configure `GOOGLE_REDIRECT_URI`, `GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_ADMIN_EMAILS`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, and `WORKSPACE_DELETE_ENABLED` in Wrangler's deployed environment. Wrangler `[vars]` must not contain secrets.

## 4. Local development

1. Configure local values in `worker/.dev.vars`.
2. Ensure the local D1 migration has run.
3. Use the local redirect URI in both the Google OAuth client and `GOOGLE_REDIRECT_URI`.
4. Start the Worker:

```powershell
npm run worker:dev
```

The app must be opened from an origin listed in `ALLOWED_ORIGINS`. Connect the Workspace administrator from **Admin → Accounts → Google Workspace accounts**.

## 5. Deploy

After setting the production D1 UUID, production Worker values, secrets, OAuth redirect URI, and remote migration:

```powershell
npx wrangler login
npm run worker:deploy
```

Register the deployed callback with Google before connecting. Confirm the Worker URL and exact redirect match, and verify `/health` before using the Workspace settings UI.

## 6. Safely test account creation

Submit a test registration and confirm it creates only a `registrationRequests` document, with no Firebase Auth user or `userProfiles` document. Create the test Workspace mailbox explicitly in Admin → Account Management, then approve the request and link that existing address. Confirm the approved profile keeps the registration request ID and the sign-in notice goes to the applicant's personal contact email. Workspace SSO creates the Firebase Auth session when the user first signs in. Then suspend and restore the test Workspace user. Do not test deletion on real accounts. Workspace account creation may consume a paid license depending on the Workspace edition and subscription settings; confirm license availability before creating users.

## Troubleshooting

- `redirect_uri_mismatch`: the URI must match exactly in Google Cloud, Worker config, and the browser callback.
- `access_denied`: the Google account did not approve consent or is not on the configured allowlist.
- `missing_refresh_token`: revoke the existing app grant in the Google account and reconnect with consent. The code preserves a previously stored token when reconnecting the same account.
- `WORKSPACE_CONNECTION_REVOKED`: reconnect the approved administrator.
- Directory API 403: confirm Admin SDK API is enabled and the connected account has user-management privileges.
- D1 binding error: replace the placeholder `database_id`, then deploy the binding and run migrations.
- OAuth app testing/verification: add test users while in testing or complete Google's publishing/verification requirements for the intended audience.
