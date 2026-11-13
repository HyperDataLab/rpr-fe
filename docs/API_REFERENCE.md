# Google Workspace API reference

Base URL: the deployed Worker URL (the existing `NEXT_PUBLIC_R2_WORKER_URL` is reused). All endpoints except public registration/login and the Google OAuth callback require `Authorization: Bearer <Firebase ID token>`. Workspace administration requires an active `ADMIN` profile; research-project APIs accept any active, approved application role. The OAuth callback is protected by a single-use D1 state transaction, nonce, and PKCE instead.

All JSON results use:

```json
{"success":true,"data":{},"message":"Operation completed successfully"}
```

Errors use:

```json
{"success":false,"error":{"code":"WORKSPACE_PERMISSION_DENIED","message":"Insufficient permission.","details":null}}
```

## Public registration

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register` | Saves applicant contact and student details to `registrationRequests` only. It does not create a Firebase Auth user or `userProfiles` document. The request ID becomes the application profile UID only after admin approval and linking an existing Workspace email. |

## OAuth connection

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/google/start` | Creates a short-lived OAuth transaction and returns `{ authorizationUrl }`. Navigate the browser to this URL. |
| GET | `/auth/google/callback` | Google redirect. Validates state, PKCE, nonce, Google identity, Workspace domain, and admin allowlist. Redirects only to configured frontend `/admin/users`. |
| GET | `/auth/google/status` | Returns connection state, domain, approved admin email, granted scopes, and whether deletion is enabled. Never returns tokens. |
| POST | `/auth/google/disconnect` | Revokes the stored Google refresh token and clears the local encrypted credential. |
| POST | `/auth/workspace/exchange` | Accepts a verified Firebase Google sign-in token for an existing Workspace address and returns a Firebase custom token for the linked app profile UID. Only the Worker returns the custom token; it never returns Google OAuth tokens. |
| POST | `/auth/username-login` | Public username/password login. Resolves the case-insensitive username in D1, verifies the password with Firebase Identity Toolkit, checks the profile is active and approved, then returns only a Firebase custom token. Invalid username/password responses are generic and rate limited by hashed IP/username. |

## Research projects

All endpoints require an active, approved Firebase profile. Projects and their many-to-many membership/invitation records are stored in D1. Only exact username/email lookup is exposed; the API never lists all application users.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/research-projects` | Returns the caller's active projects and incoming pending invitations. |
| POST | `/api/research-projects` | Creates a project `{ title, description?, researchArea? }` and an active owner membership. |
| GET | `/api/research-projects/users?query=username-or-email` | Exact lookup of one active, approved account for invitations. |
| GET | `/api/research-projects/:projectId` | Returns project details and active/pending members; caller must be an active member. |
| POST | `/api/research-projects/:projectId/invitations` | Owner invites an existing user with `{ usernameOrEmail }`. Creates a pending membership, in-app notification, and Resend email. Response reports each delivery channel; invitation remains available if a delivery channel fails. |
| POST | `/api/research-projects/:projectId/invitations/:uid/accept` | The invited user accepts, making the membership active. |
| POST | `/api/research-projects/:projectId/invitations/:uid/decline` | The invited user declines the pending invitation. |
| DELETE | `/api/research-projects/:projectId/members/:uid` | Owner removes an active member, or a member leaves. Owner cannot leave through this route. |

When an administrator deletes an account that owns a project, ownership moves to the earliest joined active member whose application profile is still active and approved. If no such member exists, the project is deleted. The deleting account's memberships are removed from other projects.

## Users

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/workspace/users?pageSize=50&pageToken=...&query=...&orderBy=email&sortOrder=ASCENDING` | `workspace.read` | Bounded list, maximum 100 users per page. Google next-page token is returned as `nextPageToken`. |
| GET | `/api/workspace/users/:id` | `workspace.read` | Get a user by Google Directory ID or primary email. |
| POST | `/api/workspace/users` | `workspace.create` | Generates a unique temporary password inside the Worker, creates the Workspace user, and stages the password encrypted in D1 for up to seven days so it can be emailed once after profile linking. Client-supplied passwords are rejected; the password is never returned by the API and must be changed at first sign-in. |
| PATCH | `/api/workspace/users/:id` | `workspace.update` | Update only `givenName`, `familyName`, `orgUnitPath`, `recoveryEmail`, or `recoveryPhone`. |
| PATCH | `/api/workspace/users/:id/suspend` | `workspace.suspend` | Suspend account. |
| PATCH | `/api/workspace/users/:id/restore` | `workspace.suspend` | Restore account. |
| DELETE | `/api/workspace/users/:id` | `workspace.delete` | Disabled by default. Requires `WORKSPACE_DELETE_ENABLED=true` and JSON `{ "confirmEmail": "exact-user@domain" }`. Protected allowlisted and connected administrator accounts cannot be deleted. |
| DELETE | `/api/workspace/app-users/:uid` | `appUser.delete` (active app administrator) | Permanently removes the Firebase Auth user and application profile/registration/notifications/reviews/events and related Firestore records. Removes the D1 app-to-Workspace identity link so the mailbox can be linked again. Requires `{ "confirmEmail": "exact-profile-email" }`. It never calls Google Directory, preserves the Workspace mailbox, and preserves R2 PDF files. |
| POST | `/api/workspace/app-users` | `workspace.create` | Creates a normal HyperDataLab account with `{ username, email, name, role, studentId?, major?, passwordMode: "GENERATE"|"CUSTOM", password? }`. Username is normalized to lowercase and unique. The real contact email is used as Firebase Auth email and receives the initial username/password. Response never includes the password or Firebase tokens; `onboardingEmailSent: false` means encrypted credentials remain available for retry for up to seven days. |
| POST | `/api/workspace/app-users/:uid/resend-credentials` | `workspace.create` | Resends staged normal-account credentials. The password is encrypted in D1, removed after Resend accepts delivery, and expires after seven days. |
| POST | `/api/workspace/profiles` | `workspace.create` | Creates an approved profile for an existing, active primary Workspace mailbox and requires `personalEmail` as the access-notice recipient. Rejects duplicate profile/mailbox links, then emails SSO instructions and includes a still-pending temporary password once when the mailbox was created by this Worker. It never creates a mailbox or changes a password. Returns `onboardingEmailSent`; use the linked profile's resend endpoint if delivery fails. |
| POST | `/api/workspace/registrations/:profileUid/approve` | `workspace.create` | Verifies an existing, active primary Workspace mailbox, then links it to the approved application profile using the registration UID and details. It never creates a mailbox or changes its password. If the mailbox is missing, returns `409 WORKSPACE_ACCOUNT_REQUIRED` and leaves the registration pending. Legacy pending profiles are updated in place. Sends sign-in instructions and, once only, a still-pending temporary password for mailboxes provisioned by this Worker. |
| POST | `/api/workspace/registrations/:profileUid/resend` | `workspace.update` | Sends Workspace SSO instructions to the saved personal contact. Includes the encrypted temporary password once if the mailbox was created through this Worker and the credential is still pending; never changes a password. |

Example create request:

```http
POST /api/workspace/users
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

```json
{"email":"student@example.org","firstName":"Nguyen","lastName":"Van A","changePasswordAtNextLogin":true,"orgUnitPath":"/"}
```

Registration approval request body:

```json
{"userId":"existing-firebase-profile-uid","workspaceEmail":"student@hyperdatalab.org","firstName":"Nguyen","lastName":"Van A","studentId":"SE123456","major":"Computer Science"}
```

Admin profile creation request body:

```json
{"email":"student@hyperdatalab.org","personalEmail":"student@example.com","name":"Nguyen Van A","role":"STUDENT","studentId":"SE123456","major":"Software Engineering"}
```

The Worker saves `personalEmail` on the identity link for future access resends. If the email service is unavailable, the profile is still created and the response reports `onboardingEmailSent: false`; the staged temporary password remains encrypted until delivery succeeds or it expires.

The Worker verifies the Directory user with a read-only lookup, then links the existing primary mailbox to the application profile using the registration UID. It never calls the Directory create-user or password-update operation in the approval flow. Existing legacy pending profiles retain their UID and role. If no mailbox exists, create it explicitly in Admin → Account Management → Google Workspace, then retry approval. If notice delivery fails after linking, retry through `/resend`; the encrypted temporary password is included if still pending, otherwise the action sends SSO instructions only.

The admin account form uses `POST /api/workspace/profiles`; it is a profile-linking operation, not the general Directory account creation endpoint. Firestore checks reject duplicate application email/profile assignment, and the D1 unique constraint on `workspace_email` is the authoritative guard against linking the same Workspace mailbox to a second profile.

Normal username/password accounts use the separate `POST /api/workspace/app-users` flow. Apply D1 migration `0008_app_user_logins.sql` before deploying the Worker. Username lookup remains private to the Worker; the browser only receives a Firebase custom token after password verification and active-profile checks.

Common status codes: 400 validation, 401 authentication, 403 permission, 404 missing user, 409 duplicate user, 429 rate limit, 500 internal error, 502 Google API failure, 503 missing/revoked connection.
