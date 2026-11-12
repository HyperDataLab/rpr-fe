# Google Workspace integration security

## Trust boundaries

- Firebase ID tokens authenticate the application user. The Worker verifies token signature, issuer, audience, subject, expiry, and issue time, then reads the active Firestore profile to authorize `ADMIN` role. Frontend role fields are not trusted.
- Google OAuth independently proves the connected Workspace administrator. The Worker checks Google token signature/issuer/audience/expiry/nonce/email verification, hosted Workspace domain, and an explicit email allowlist.
- Google privileged API calls originate only inside the Worker. The browser never receives OAuth credentials or access tokens.

## Credential handling

- Refresh tokens and transient PKCE verifiers are AES-256-GCM encrypted with per-value random 96-bit nonces and context-bound additional authenticated data.
- Encryption keys live in Cloudflare secrets. D1 stores ciphertext, nonce, and key version. Keep old key versions available while rows use them; rotate by adding a new key version, re-encrypting rows, verifying, then removing the old version.
- OAuth state is SHA-256 hashed in D1, expires after ten minutes, binds to the initiating Firebase UID, and is atomically consumed once. PKCE uses S256 and the ID token nonce is checked.
- OAuth code, passwords, access tokens, and refresh tokens are never written to audit logs. Audit target detail is limited to necessary account identifiers.

## Authorization and destructive actions

- Every protected route re-verifies the Firebase token and Firestore role. Each operation checks its permission independently.
- Workspace sign-in accepts only verified Firebase Google-provider identities from the configured Workspace domain with an active D1 profile link. The Worker signs a Firebase custom token for the existing profile UID; linked profiles reject password-provider sessions in both the app auth provider and Firestore's `activeUser()` rule.
- Registration creates a `registrationRequests` document only; it creates neither a Firebase Auth user nor an application profile. Approval verifies an existing active primary Workspace account, then creates the app profile under the request ID. Workspace sign-in uses that approved profile; approval never creates a mailbox or alters a password. For mailboxes explicitly created through the Worker, the initial password is encrypted in D1 for up to seven days and included in the personal-contact email once; it is deleted after Resend accepts the message. Existing mailbox passwords are never retrieved or populated with a shared default.
- Workspace domain restrictions apply to create/update/delete targets. The configured Google administrator allowlist also protects administrator accounts from deletion.
- Google Workspace mailbox deletion is disabled unless `WORKSPACE_DELETE_ENABLED=true`, requires an exact-email confirmation, and is never automatically retried.
- Application-account deletion is a separate admin-only route. It requires exact-email confirmation, blocks self-deletion and deletion of the last active administrator, revokes Firebase Auth, removes the D1 app-to-Workspace identity link, and does not invoke Google Directory or alter the Workspace mailbox. It preserves all R2 PDF files; shared Firestore records remain available to other authors while the deleted user's links and activity are removed.
- Admin APIs are rate limited. CORS uses exact configured origins. Callback redirect is fixed to the trusted configured frontend origin.

## Operational controls

- Store secrets with `wrangler secret put`; never commit `.dev.vars`, service-account credentials, or real OAuth credentials.
- `FIREBASE_SERVICE_ACCOUNT_JSON` is used only by the Worker to sign Firebase custom tokens and perform server-side Firestore work. Application-account deletion needs Firestore document read/write/delete permission and Firebase Authentication user deletion permission (`firebaseauth.users.delete`, typically through the Firebase Authentication Admin role) in the configured Google Cloud project. No service-account credential is sent to the browser. Workspace onboarding email may contain a newly created account's temporary password once; it never contains an existing account's password, and sending an email never changes a Workspace password.
- Limit access to Cloudflare D1, Worker deployments, Google Cloud OAuth settings, and the Workspace administrator allowlist.
- Review audit activity and Google Admin audit events. Configure retention for D1 audit records according to organizational policy.
- Test against a non-production Workspace or test organizational unit before enabling user creation.
- OAuth client secret or token-encryption-key compromise requires immediate rotation/revocation. If an OAuth refresh returns `invalid_grant`, the Worker marks the connection revoked and requires reconnection.

## Known operational constraints

- Google may require consent-screen verification or test-user configuration depending on its audience and scopes.
- Directory API requests are subject to Google quotas and Workspace admin privileges.
- User provisioning may consume a Workspace license. The API does not assign privileged administrator roles.
- D1 migrations are not applied automatically on deploy. Apply and review migrations as a separate release step.
