# Tích hợp đăng nhập HyperDataLab SSO

Tài liệu này dành cho nhóm phát triển **một hệ thống khác** muốn cho người dùng đăng nhập bằng tài khoản Google Workspace đã được liên kết với hồ sơ ResearchPulse/HyperDataLab.

SSO API được cung cấp bởi Cloudflare Worker hiện có, không cần dựng SSO_BE hoặc SSO_FE riêng.

## 1. Luồng đăng nhập

1. Quản trị viên đăng ký ứng dụng ở ResearchPulse → `/admin/users` → **Connected applications**.
2. Hệ thống tích hợp tạo `state`, PKCE `code_verifier` và `code_challenge`, lưu vào session tạm của ứng dụng, rồi chuyển trình duyệt tới `/oauth/authorize`.
3. Worker chuyển người dùng về trang `/login` của ResearchPulse. Người dùng đăng nhập bằng Google Workspace.
4. ResearchPulse kiểm tra email Workspace có liên kết với hồ sơ Firebase đã duyệt và đang hoạt động hay không.
5. Nếu hợp lệ, Worker trả trình duyệt về callback URL đã đăng ký kèm mã authorization dùng một lần và `state`.
6. Backend của ứng dụng đổi mã lấy bearer access token, gọi `/oauth/userinfo`, rồi tạo session đăng nhập riêng cho ứng dụng đó.

```text
Ứng dụng bên ngoài → Worker /oauth/authorize → ResearchPulse /login
       ← callback?code=...&state=... ← kiểm tra Workspace + hồ sơ đã duyệt
Backend ứng dụng → Worker /oauth/token → access_token
Backend ứng dụng → Worker /oauth/userinfo → profile
```

## 2. Điều kiện trước khi tích hợp

- D1 migration `0007_sso_provider.sql` đã áp dụng và Worker đã deploy.
- Người tạo client là quản trị viên ResearchPulse.
- Người dùng có email `@hyperdatalab.org` đã được liên kết với hồ sơ ResearchPulse `APPROVED` và `isActive: true`.
- Callback URL phải khớp chính xác URL đã đăng ký. Dùng HTTPS ở production; HTTP chỉ dùng cho `localhost`.
- Với SPA chạy hoàn toàn trên trình duyệt, chọn loại client **Public** và đăng ký chính xác URL callback của SPA. Có thể dùng domain/port bất kỳ; Worker tự lấy origin từ callback đã đăng ký để cho phép SPA gọi các endpoint token/userinfo/revoke, không cần sửa `ALLOWED_ORIGINS` cho từng ứng dụng. Redirect về callback là điều hướng trình duyệt nên không cần CORS ở server callback. CORS chỉ áp dụng khi JavaScript tại trang callback gọi Worker.

## 3. Đăng ký client

1. Đăng nhập ResearchPulse bằng tài khoản quản trị.
2. Mở `/admin/users` và tới phần **Connected applications**.
3. Nhập tên ứng dụng, callback URL, loại client và scope cần dùng.
4. Nhấn **Register application**.
5. Lưu `client_id`; với loại **Confidential**, lưu `client_secret` ngay khi UI hiển thị. Secret chỉ hiện một lần.
6. Lưu thông tin client trong secret manager của ứng dụng ngoài, ví dụ:

```env
HYPERDATALAB_SSO_BASE_URL=https://rpr-grobid-gateway.hpl-storage.workers.dev
HYPERDATALAB_SSO_CLIENT_ID=hd_...
HYPERDATALAB_SSO_CLIENT_SECRET=hds_...
HYPERDATALAB_SSO_CALLBACK_URL=https://app.example.com/auth/hyperdatalab/callback
```

Không đưa client secret vào JavaScript bundle, HTML, mobile app, hoặc repository. Nếu ứng dụng là SPA thuần, đăng ký loại **Public** và bắt buộc dùng PKCE; không có client secret.

## 4. Scopes và dữ liệu trả về

Chỉ yêu cầu scope mà ứng dụng thật sự cần:

| Scope | Claims trong userinfo |
|---|---|
| `email` | `email`, `email_verified` (email Workspace) |
| `profile` | `name`, `picture` (avatar, nếu hồ sơ có) |
| `hyperdatalab_profile` | `role`, `student_id`, `major` |

`sub` luôn được trả về và là UID hồ sơ ResearchPulse. Dùng `sub` làm định danh ổn định để nối/tạo user trong ứng dụng. Không dùng email làm khóa chính vì email có thể thay đổi. API không trả email cá nhân liên hệ hoặc số điện thoại.

## 5. Tích hợp backend (Authorization Code + PKCE)

Ví dụ dưới đây dùng Node.js hiện đại, Express và một session store phía server. Route `/auth/hyperdatalab/start` phải lưu `state` và `verifier` trong session server-side (Redis/DB trong production), không gửi verifier hoặc secret qua URL.

```js
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const SSO = process.env.HYPERDATALAB_SSO_BASE_URL;
const CLIENT_ID = process.env.HYPERDATALAB_SSO_CLIENT_ID;
const CLIENT_SECRET = process.env.HYPERDATALAB_SSO_CLIENT_SECRET;
const CALLBACK = process.env.HYPERDATALAB_SSO_CALLBACK_URL;
const SCOPES = ['email', 'profile', 'hyperdatalab_profile'];

const base64urlSha256 = (value) =>
  createHash('sha256').update(value).digest('base64url');

app.get('/auth/hyperdatalab/start', (req, res) => {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = base64urlSha256(verifier);

  // Store in the server-side session; expire it after a few minutes.
  req.session.ssoAttempt = { state, verifier, createdAt: Date.now() };

  const authorize = new URL('/oauth/authorize', SSO);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK,
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  res.redirect(authorize.toString());
});

app.get('/auth/hyperdatalab/callback', async (req, res, next) => {
  try {
    const attempt = req.session.ssoAttempt;
    delete req.session.ssoAttempt; // one use, even if the callback is retried

    if (!attempt || Date.now() - attempt.createdAt > 10 * 60 * 1000) {
      return res.status(400).send('SSO sign-in expired. Please try again.');
    }

    const returnedState = String(req.query.state || '');
    const expected = Buffer.from(attempt.state);
    const received = Buffer.from(returnedState);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return res.status(400).send('Invalid SSO state. Please start sign-in again.');
    }
    if (typeof req.query.code !== 'string') {
      return res.status(400).send('No authorization code was returned.');
    }

    const tokenResponse = await fetch(new URL('/oauth/token', SSO), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: req.query.code,
        redirect_uri: CALLBACK,
        code_verifier: attempt.verifier,
      }),
    });
    const tokenBody = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenBody.access_token) {
      return res.status(401).send('Could not exchange the SSO authorization code.');
    }

    const userInfoResponse = await fetch(new URL('/oauth/userinfo', SSO), {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });
    const profile = await userInfoResponse.json();
    if (!userInfoResponse.ok || !profile.sub) {
      return res.status(401).send('Could not load the signed-in profile.');
    }

    // Find/create the local account by profile.sub, then create your app's own session.
    // Keep the access token server-side; do not put it in a browser URL.
    req.session.user = {
      externalId: profile.sub,
      email: profile.email,
      name: profile.name,
      avatar: profile.picture,
      role: profile.role,
      studentId: profile.student_id,
      major: profile.major,
    };
    req.session.ssoAccessToken = tokenBody.access_token;
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});
```

Adapt the session calls and account lookup to the framework in use. Cookie sessions should be `HttpOnly`, `Secure` in production, and use an appropriate `SameSite` policy. Do not trust a role sent by the browser: read it from the validated `/oauth/userinfo` response on the server and apply the authorization rules of your app.

### PKCE values

- `state`: a cryptographically random value generated for each sign-in attempt; compare it on callback and reject mismatch.
- `code_verifier`: random string (43–128 URL-safe characters), held privately until code exchange.
- `code_challenge`: Base64URL(SHA-256(`code_verifier`)); send `code_challenge_method=S256`.
- The authorization code is short-lived and single-use. Never log it.

## 6. SPA-only integration (Public client)

A SPA must not have a client secret. Register a **Public** client and use the same Authorization Code + PKCE flow. Store `state` and `code_verifier` in `sessionStorage` for the short callback round-trip, validate state before exchanging the code, and clear both values after use. Register the exact callback URL served by the SPA; any domain or port is supported. The Worker derives the CORS origin from that callback for `/oauth/token`, `/oauth/userinfo`, and `/oauth/revoke`. The browser's top-level redirect to the callback does not use CORS, so the callback server does not need CORS configuration just to receive the redirect. The access token remains sensitive: keep it in memory where possible and never write it to a URL or logs.

If the application has a backend, prefer the server-side flow above so tokens and profile data stay off the browser.

## 7. API contract

### Authorization

```http
GET /oauth/authorize
  ?response_type=code
  &client_id=<client-id>
  &redirect_uri=<registered-callback>
  &scope=email%20profile%20hyperdatalab_profile
  &state=<random-state>
  &code_challenge=<base64url-sha256>
  &code_challenge_method=S256
```

The browser is redirected to ResearchPulse `/login`. After successful Workspace sign-in, the registered callback receives `?code=...&state=...`.

### Exchange code

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=<client-id>&client_secret=<secret>&code=<code>&redirect_uri=<registered-callback>&code_verifier=<verifier>
```

Success response:

```json
{
  "access_token": "<opaque-bearer-token>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "email profile hyperdatalab_profile"
}
```

The endpoint also accepts HTTP Basic client authentication for Confidential clients. Public clients omit the secret. No refresh token or ID token is issued; when the one-hour access token expires, repeat authorization.

### Userinfo

```http
GET /oauth/userinfo
Authorization: Bearer <access-token>
```

Example response (fields vary with requested scopes):

```json
{
  "sub": "firebase-profile-uid",
  "email": "user@hyperdatalab.org",
  "email_verified": true,
  "name": "Example User",
  "picture": "https://example.invalid/avatar.png",
  "role": "STUDENT",
  "student_id": "SE123456",
  "major": "Software Engineering"
}
```

### Revoke token

```http
POST /oauth/revoke
Content-Type: application/json

{"token":"<access-token>"}
```

Revoke is safe to retry. Disabling a client in the ResearchPulse admin page also blocks its tokens from userinfo.

## 8. Operational notes and troubleshooting

- `INVALID_CLIENT_OR_REDIRECT_URI`: verify the exact callback URL, including scheme, port, path, and trailing slash.
- `INVALID_SCOPE`: ensure requested scopes are enabled for this client and spell them exactly.
- `INVALID_AUTHORIZATION_REQUEST`: generate a new `state` and PKCE pair and restart the flow; do not reuse an old code.
- `PROFILE_NOT_APPROVED`: an administrator must approve/activate the ResearchPulse profile and link the user's Workspace email first.
- `INVALID_CLIENT`: check client ID/secret and whether the client is enabled. A confidential secret cannot be recovered; create/rotate the client credentials through admin management.
- Browser CORS error: confirm the SPA is running at the registered callback origin, the client is enabled and set to **Public**, and the Worker version with dynamic CORS is deployed. The callback server does not need to allow the Worker through its own CORS settings; browser CORS is controlled by the Worker response to SPA API requests.
- `404` or storage error on OAuth endpoints: apply the `0007_sso_provider.sql` D1 migration and deploy the current Worker.
- The OAuth userinfo API is not OpenID Connect: there is no discovery document, OIDC `id_token`, or refresh token. Integrators must use `/oauth/userinfo` and manage a local session.
- For production, use HTTPS, protect session cookies and client secrets, redact authorization codes/tokens from logs, and map the stable `sub` to the local account.
