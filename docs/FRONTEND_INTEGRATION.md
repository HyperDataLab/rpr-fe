# Frontend integration

The frontend uses `src/features/admin/api/workspaceApi.ts`. Each method obtains the current Firebase ID token through the existing Cloudflare Worker client and sends it as a Bearer header. Google client secrets, refresh tokens, and access tokens never enter browser storage or responses.

Registration stores applicant details in `registrationRequests` only; it creates neither a Firebase Auth user nor a `userProfiles` document. Approval opens a modal with the applicant's name, student ID, major, contact email, and a required existing Workspace primary email. The Worker verifies that the mailbox already exists and is active, then creates the approved app profile using the registration request ID and preserves the requested role. Approval never creates a mailbox or changes its password. If the mailbox is missing, create it explicitly under Admin → Account Management → Google Workspace and retry approval. Resend sends SSO sign-in instructions to the registered personal contact without changing credentials.

Admin → Accounts → Resend access confirms before acting. It resends SSO instructions to the registered personal email and includes a still-pending temporary password only for mailboxes created through the Worker. That encrypted credential is deleted after Resend accepts the message or expires after seven days. Existing mailbox passwords cannot be read back and are not reset by this action.

At login, the user selects Google Workspace SSO. Firebase verifies the Google identity, then the Worker checks the verified domain and D1 link and exchanges it for a Firebase custom token for the original profile UID. This keeps existing Firestore records attached to the same UID. Password login is rejected for linked profiles, and Firestore rules require the Worker-issued custom-auth session for linked accounts. The user's personal email remains contact information only.

```ts
import {
  connectGoogleWorkspace,
  getWorkspaceConnectionStatus,
  listWorkspaceUsers,
  createWorkspaceUser,
  updateWorkspaceUser,
  suspendWorkspaceUser,
  restoreWorkspaceUser,
  deleteWorkspaceUser,
} from '@/features/admin/api/workspaceApi';
```

The admin accounts page includes a Workspace connection area. Start connection from a user gesture, then the browser navigates to Google's authorization screen. The callback redirects to `/admin/users?workspace_connection=connected` (or a safe outcome code). Refresh the connection status after return. It is separate from Firebase application login; connecting Google does not sign the admin into Firebase and Firebase role alone does not authorize Google API calls.

Deleting an app account from Admin â†’ Account Management requires typing the account's exact app email. The frontend calls `DELETE /api/workspace/app-users/:uid`; the Worker removes the Firebase Auth account, app profile and owned data, and its D1 Workspace identity link. It never deletes or modifies the Workspace mailbox. The service account must have Firebase Authentication user deletion and Firestore read/write/delete permissions. Stored R2 PDF files are preserved; shared Firestore papers remain available to other authors; the deleted account's author/reviewer links are removed.

The Admin → Accounts “Create profile” form calls `createWorkspaceProfile()` and only links an existing, active primary Workspace mailbox to a new approved application profile. It does not create a mailbox or password. The Worker rejects duplicate profile email assignments and enforces one profile per Workspace email in D1. Keep the general `createWorkspaceUser()` Directory operation separate; it creates a mailbox and must not be used by this profile form.

Before approval, the existing Workspace account must be active in Google Directory. The exchange flow maps that verified Google identity to the approved Firebase profile; it does not create another Firebase profile, so all existing app records remain attached to the same UID.

Set `NEXT_PUBLIC_R2_WORKER_URL` to the Worker base URL in the frontend environment and add the frontend's exact origin to the Worker CORS allowlist. The Firebase token is sent only in an HTTP Authorization header, never in a URL.
