# HyperDataLab SSO API (ResearchPulse Worker)

ResearchPulse serves the SSO endpoints from its existing Cloudflare Worker (`worker/`). There is no separate SSO backend or SSO frontend to deploy. The Worker reuses Firebase Authentication, the approved `userProfiles` collection, Google Workspace email links, and D1.

For an end-to-end Vietnamese integration walkthrough with Node.js examples, see [SSO_INTEGRATION_GUIDE_VI.md](./SSO_INTEGRATION_GUIDE_VI.md).

## Eligibility and profile fields

A user signs in on the existing ResearchPulse `/login` page with Google Workspace. The existing Workspace exchange must resolve that Google identity to a linked Firebase profile. The SSO completion route additionally requires that profile to be `APPROVED`, active, and linked to the configured Workspace domain. It never creates a mailbox or an application profile. User info is rechecked against Firestore on each request.

Supported OAuth scopes:

- `email`: Workspace email and `email_verified`.
- `profile`: display name and avatar when present in the application profile.
- `hyperdatalab_profile`: application role, student ID, and major/department.

The userinfo response uses `sub` as the existing ResearchPulse profile UID. It does not include the user's personal contact email or phone number.

## Register a relying application

1. Apply the D1 migration: `npm run worker:migrate:remote`.
2. Deploy the Worker: `npm run worker:deploy`.
3. Sign in to ResearchPulse as an administrator and open `/admin/users`.
4. In **Connected applications**, register the app, exact callback URL(s), and client type. Save the client secret immediately for a confidential client; it is only shown once.
5. For a browser-only public client, select **Public** and use Authorization Code + PKCE S256. Register the exact callback URL served by the SPA. It may use any domain and port; the Worker derives the allowed CORS origin from each active Public client's registered callback, so no per-app `ALLOWED_ORIGINS` update is needed. The browser follows the callback redirect as a top-level navigation (no CORS is involved in that redirect); CORS is needed only when the SPA calls the Worker's token/userinfo/revoke endpoints from the callback page.

Use HTTPS callback URLs outside localhost. Do not use wildcard redirect URLs. Disable a client in the same admin section to prevent new authorizations and invalidate its existing access tokens.

## OAuth Authorization Code + PKCE

Authorization endpoint:

```http
GET https://<worker-host>/oauth/authorize?response_type=code&client_id=<client-id>&redirect_uri=<exact-callback>&scope=email%20profile%20hyperdatalab_profile&state=<random-state>&code_challenge=<base64url-sha256-verifier>&code_challenge_method=S256
```

The Worker validates the registered client, exact callback, scopes, state, and PKCE challenge, then redirects to the existing ResearchPulse `/login?sso_request=<opaque-id>`. After Google Workspace sign-in and the ResearchPulse profile checks succeed, the existing login page returns a short-lived one-time authorization code to the exact callback, together with the original state. The relying app must verify state.

Exchange the code server-to-server for a confidential client. Public clients omit the secret and must still provide the PKCE verifier. Send JSON or `application/x-www-form-urlencoded`:

```http
POST https://<worker-host>/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=<client-id>&client_secret=<client-secret>&code=<code>&redirect_uri=<exact-callback>&code_verifier=<original-verifier>
```

The response contains an opaque bearer access token and `expires_in: 3600`. Refresh tokens are not issued; after expiry, start a new authorization flow. Access tokens are stored hashed in D1 and bound to the client. The client secret is never sent to a browser for confidential clients.

Fetch the user's profile:

```http
GET https://<worker-host>/oauth/userinfo
Authorization: Bearer <access-token>
```

Revoke an access token:

```http
POST https://<worker-host>/oauth/revoke
Content-Type: application/json

{"token":"<access-token>"}
```

This is an OAuth 2.0 authorization and userinfo API. It does not issue an OpenID Connect ID token. An integrating application should validate the returned `sub` and treat the bearer token as a secret.

## Local development and deployment

- Local Worker: `npm run worker:dev` (default `http://localhost:8787`).
- Frontend: `npm run dev` (default `http://localhost:3003`).
- Worker tests: `npm run worker:test`.
- Remote D1 migration: `npm run worker:migrate:remote`.
- Production Worker deploy: `npm run worker:deploy`.

Use exact local callback URLs such as `http://localhost:4000/auth/callback` for local clients. Any localhost port or external app domain is supported when its exact callback URL is registered. The Worker frontend redirect is controlled by `FRONTEND_URL`; ensure that origin is in `ALLOWED_ORIGINS` or `FRONTEND_ORIGINS`. No new secrets or Google OAuth client are required for this SSO flow; the SSO client secret is generated inside the Worker and shown once at registration. Browser CORS access to `/oauth/token`, `/oauth/userinfo`, and `/oauth/revoke` is granted only to the callback origins of active Public clients. The callback server does not need to configure CORS just to receive the browser redirect.
