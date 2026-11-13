# Tích hợp API đọc dự án nghiên cứu

> **Trạng thái: bản thiết kế, chưa được triển khai trên Worker.** Hai endpoint dự án trong tài liệu này chỉ có thể gọi được sau khi Worker bổ sung xác thực OAuth Bearer token và scope `research_projects:read`. Các endpoint nội bộ `/api/research-projects` hiện dùng Firebase ID token.

Tài liệu dành cho ứng dụng bên ngoài cần đọc danh sách và thông tin dự án mà người dùng HyperDataLab đang tham gia. API dùng OAuth access token đã được cấp cho chính người dùng đó.

## 1. Điều kiện tích hợp

Quản trị viên cần đăng ký ứng dụng tại ResearchPulse → **Admin → Users → Connected applications**, khai báo callback URL chính xác và cấp scope `research_projects:read` cho client. Ứng dụng đăng nhập qua OAuth Authorization Code + PKCE như hướng dẫn tại [SSO_INTEGRATION_GUIDE_VI.md](./SSO_INTEGRATION_GUIDE_VI.md).

Worker hiện chỉ hỗ trợ các scope `email`, `profile`, `hyperdatalab_profile`; scope dự án cần được bổ sung trước khi ứng dụng có thể yêu cầu nó. Với confidential client, đổi authorization code ở backend và giữ client secret trong secret manager. Với public client, không nhúng secret vào ứng dụng; luôn dùng PKCE.

## 2. Base URL và xác thực

```text
https://<worker-host>
```

Gửi access token trong header cho mỗi request:

```http
Authorization: Bearer <access_token>
Accept: application/json
```

Token có thời hạn theo phản hồi `/oauth/token` (hiện tại là 3600 giây). Khi hết hạn, ứng dụng cần khởi động lại luồng OAuth; Worker hiện không cấp refresh token. Không ghi token vào URL, log hoặc mã nguồn phía client.

## 3. Lấy danh sách dự án

```http
GET /api/v1/me/research-projects?limit=50
```

Chỉ trả về dự án mà tài khoản đã tham gia (`ACTIVE`). Lời mời đang chờ hoặc đã từ chối không được đưa vào danh sách. `limit` mặc định 50, tối đa 100. Nếu còn dữ liệu, phản hồi có `nextCursor`; gửi cursor đó ở trang kế tiếp.

```bash
curl --get "https://<worker-host>/api/v1/me/research-projects" \
  --data-urlencode "limit=50" \
  --header "Authorization: Bearer <access_token>" \
  --header "Accept: application/json"
```

Phản hồi:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "project-uuid",
        "title": "Demo Project",
        "description": "Mô tả dự án",
        "researchArea": "AI",
        "ownerUid": "user-uuid",
        "myRole": "OWNER",
        "joinedAt": "2026-11-13T10:00:00.000Z",
        "createdAt": "2026-11-13T10:00:00.000Z",
        "updatedAt": "2026-11-13T10:00:00.000Z"
      }
    ],
    "nextCursor": null
  }
}
```

Lấy trang tiếp theo:

```http
GET /api/v1/me/research-projects?limit=50&cursor=<nextCursor>
```

Cursor là giá trị opaque do API trả về. Ứng dụng nên giữ nguyên giá trị này, không tự giải mã hoặc tạo cursor.

## 4. Lấy thông tin một dự án

```http
GET /api/v1/research-projects/{projectId}
```

Ví dụ:

```bash
curl "https://<worker-host>/api/v1/research-projects/project-uuid" \
  --header "Authorization: Bearer <access_token>" \
  --header "Accept: application/json"
```

Chỉ thành viên có membership `ACTIVE` mới đọc được chi tiết. `members` chỉ gồm thành viên đang hoạt động và thông tin cơ bản; email thành viên không được trả về theo thiết kế mặc định.

```json
{
  "success": true,
  "data": {
    "id": "project-uuid",
    "title": "Demo Project",
    "description": "Mô tả dự án",
    "researchArea": "AI",
    "ownerUid": "user-uuid",
    "myRole": "MEMBER",
    "members": [
      { "name": "Nguyen Van A", "role": "OWNER" },
      { "name": "Tran Thi B", "role": "MEMBER" }
    ],
    "createdAt": "2026-11-13T10:00:00.000Z",
    "updatedAt": "2026-11-13T10:00:00.000Z"
  }
}
```

## 5. Xử lý lỗi

| HTTP | Mã lỗi | Cách xử lý |
| --- | --- | --- |
| `401` | `INVALID_TOKEN` | Token thiếu, hết hạn hoặc đã bị thu hồi. Đăng nhập lại qua OAuth. |
| `403` | `INSUFFICIENT_SCOPE` | Client chưa được cấp `research_projects:read`; yêu cầu quản trị viên cập nhật quyền client rồi xác thực lại. |
| `404` | `PROJECT_NOT_FOUND` | Dự án không tồn tại hoặc tài khoản không có membership `ACTIVE`. |
| `429` | `RATE_LIMITED` | Chờ theo `Retry-After` nếu có, sau đó thử lại với exponential backoff. |

Ví dụ lỗi:

```json
{
  "success": false,
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "Research project not found.",
    "details": null
  }
}
```

## 6. Quy tắc bảo mật và đồng bộ

- API xác định tài khoản từ access token; request không truyền UID hoặc email để chọn dữ liệu người dùng.
- Chỉ membership `ACTIVE` mới được đọc. Quyền thành viên được kiểm tra lại khi gọi API.
- Token được ràng buộc với OAuth client, có thời hạn và có thể bị thu hồi khi client bị vô hiệu hóa.
- Dữ liệu dự án là riêng tư theo tài khoản; phía tích hợp không nên cache phản hồi dùng chung giữa nhiều người dùng. Phản hồi dự kiến có `Cache-Control: private, no-store`.
- API chỉ đọc dữ liệu dự án. Tạo dự án, mời thành viên, chấp nhận lời mời và quản lý thành viên tiếp tục thuộc các endpoint nội bộ.
