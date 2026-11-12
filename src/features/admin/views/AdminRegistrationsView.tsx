'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { Button } from '@hyperdata/design-system';
import { AdminPageHeader, AdminShell } from '../components';
import { adminApi, type AdminUser } from '../api';
import { TableSkeleton } from '@/components/skeleton';
import { useTranslation } from '@/i18n';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { firestoreDb } from '@/lib/firebase/client';

const approvalInputStyle: CSSProperties = {
  width: '100%', height: 42, border: '1px solid #cbd5e1', borderRadius: 8,
  padding: '0 12px', color: '#0f172a', background: '#fff', font: 'inherit',
};
const approvalLabelStyle: CSSProperties = { display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 600 };
const approvalTwoColumnStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 };

function timestampIso(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate as () => Date)().toISOString();
  }
  return value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '';
}

function getUserInitials(name?: string | null, email?: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return 'U';
}

export function AdminRegistrationsView() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [pendingUsers, setPendingUsers] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState<{ page: number; totalPages: number; total: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [approvalModal, setApprovalModal] = useState<{
    applicant: AdminUser;
    workspaceEmail: string;
    firstName: string;
    lastName: string;
    studentId: string;
    major: string;
  } | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const previousPendingIds = useRef<Set<string> | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    isDanger?: boolean;
    onConfirm: () => Promise<void> | void;
  } | null>(null);

  const PAGE_SIZE = 10;

  useEffect(() => {
    if (!user?.id || user.role !== 'ADMIN' || !user.isActive || user.status !== 'APPROVED') {
      setPendingUsers([]);
      setPagination({ page: 1, totalPages: 1, total: 0 });
      setLoading(false);
      return;
    }

    setLoading(true);
    const pendingQuery = query(
      collection(firestoreDb(), 'registrationRequests'),
      where('status', '==', 'PENDING'),
      limit(1000),
    );
    return onSnapshot(pendingQuery, { includeMetadataChanges: true }, (snapshot) => {
      // Do not let a stale local cache masquerade as the current registration list.
      if (snapshot.metadata.fromCache) return;
      const allUsers = snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          email: String(data.email || ''),
          workspaceEmail: typeof data.workspaceEmail === 'string' ? data.workspaceEmail : null,
          username: typeof data.username === 'string' ? data.username : null,
          name: typeof data.name === 'string' ? data.name : [data.firstName, data.lastName].filter((part) => typeof part === 'string' && part).join(' ') || null,
          firstName: typeof data.firstName === 'string' ? data.firstName : null,
          lastName: typeof data.lastName === 'string' ? data.lastName : null,
          phone: typeof data.phone === 'string' ? data.phone : null,
          studentId: typeof data.studentId === 'string' ? data.studentId : null,
          major: typeof data.major === 'string' ? data.major : null,
          avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : null,
          role: data.role === 'LECTURER' || data.role === 'ADMIN' ? data.role : 'STUDENT',
          isActive: data.isActive === true,
          status: data.status === 'APPROVED' || data.status === 'REJECTED' || data.status === 'SUSPENDED' || data.status === 'PENDING' ? data.status : 'PENDING',
          mustChangePassword: data.mustChangePassword === true,
          lastLoginAt: timestampIso(data.lastLoginAt) || null,
          createdAt: timestampIso(data.createdAt),
          updatedAt: timestampIso(data.updatedAt),
        } satisfies AdminUser;
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const currentIds = new Set(allUsers.map((item) => item.id));
      const previousIds = previousPendingIds.current;
      if (previousIds && [...currentIds].some((id) => !previousIds.has(id))) {
        setMessage(locale === 'vi' ? 'Có đăng ký mới chờ duyệt.' : 'A new registration is awaiting review.');
      }
      previousPendingIds.current = currentIds;

      const totalPages = Math.ceil(allUsers.length / PAGE_SIZE) || 1;
      const activePage = Math.min(page, totalPages);
      setPagination({ page: activePage, totalPages, total: allUsers.length });
      if (activePage !== page) setPage(activePage);
      const start = (activePage - 1) * PAGE_SIZE;
      setPendingUsers(allUsers.slice(start, start + PAGE_SIZE));
      setError(null);
      setLoading(false);
    }, (reason) => {
      setError(reason.message || 'Unable to listen for pending registrations.');
      setPendingUsers([]);
      setPagination({ page: 1, totalPages: 1, total: 0 });
      setLoading(false);
    });
  }, [locale, page, user?.id, user?.isActive, user?.role, user?.status]);
  const filteredPendingUsers = useMemo(() => {
    if (!search.trim()) return pendingUsers;
    const q = search.toLowerCase().trim();
    return pendingUsers.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.studentId?.toLowerCase().includes(q) ||
        u.major?.toLowerCase().includes(q),
    );
  }, [pendingUsers, search]);

  const decidePendingUser = (user: AdminUser, decision: 'approve' | 'reject') => {
    if (decision === 'approve') {
      const nameParts = (user.name || '').trim().split(/\s+/).filter(Boolean);
      setApprovalError(null);
      setApprovalModal({
        applicant: user,
        workspaceEmail: user.workspaceEmail || '',
        firstName: user.firstName || nameParts[0] || '',
        lastName: user.lastName || nameParts.slice(1).join(' '),
        studentId: user.studentId || '',
        major: user.major || '',
      });
      return;
    }
    setConfirmModal({
      open: true,
      title: locale === 'vi' ? 'Từ chối đăng ký tài khoản' : 'Reject Registration',
      description: locale === 'vi' ? `Xác nhận từ chối yêu cầu đăng ký của ${user.email}?` : `Reject registration request for ${user.email}?`,
      confirmLabel: locale === 'vi' ? 'Từ chối' : 'Reject',
      cancelLabel: locale === 'vi' ? 'Hủy' : 'Cancel',
      isDanger: true,
      onConfirm: async () => {
        setBusyId(user.id);
        setMessage(null);
        setError(null);
        try {
          await adminApi.rejectUser(user.id);
          setMessage(locale === 'vi' ? `Đã từ chối đăng ký cho ${user.email}.` : `Registration for ${user.email} was rejected.`);
        } catch (reason: unknown) {
          setError(reason instanceof Error ? reason.message : 'Unable to process pending registration.');
        } finally {
          setBusyId(null);
          setConfirmModal(null);
        }
      },
    });
  };

  const submitApproval = async () => {
    if (!approvalModal) return;
    const { applicant, workspaceEmail, firstName, lastName, studentId, major } = approvalModal;
    setBusyId(applicant.id);
    setApprovalError(null);
    setMessage(null);
    try {
      const result = await adminApi.approveUser(applicant.id, {
        workspaceEmail: workspaceEmail.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        studentId: studentId.trim(),
        major: major.trim(),
      });
      setApprovalModal(null);
      if (result.onboardingEmailSent) {
        setMessage(locale === 'vi'
          ? `Đã duyệt ${applicant.name || applicant.email}, liên kết với mailbox ${result.workspaceEmail} có sẵn và gửi hướng dẫn đăng nhập đến ${applicant.email}.`
          : `Approved ${applicant.name || applicant.email}, linked existing mailbox ${result.workspaceEmail}, and emailed sign-in instructions to ${applicant.email}.`);
      } else {
        setError(locale === 'vi'
          ? `Đã duyệt và liên kết mailbox ${result.workspaceEmail}, nhưng gửi hướng dẫn đăng nhập thất bại. Dùng Resend access để gửi lại đến ${applicant.email}.`
          : `Approved and linked ${result.workspaceEmail}, but the sign-in notice could not be delivered. Use Resend access to retry to ${applicant.email}.`);
      }
    } catch (reason: unknown) {
      const errorMessage = reason instanceof Error ? reason.message : 'Unable to approve this registration.';
      if (/WORKSPACE_ACCOUNT_REQUIRED|Workspace user was not found|Create the Workspace mailbox/i.test(errorMessage)) {
        setApprovalError(locale === 'vi'
          ? `Không tìm thấy mailbox ${workspaceEmail.trim()} trong Google Workspace. Chưa duyệt hồ sơ. Hãy tạo mailbox trước tại Quản lý tài khoản → Google Workspace, sau đó quay lại chọn đúng email này.`
          : `Workspace mailbox ${workspaceEmail.trim()} was not found. The registration was not approved. Create the mailbox first in Account Management → Google Workspace, then return and enter its exact email address.`);
      } else {
        setApprovalError(errorMessage);
      }
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = pagination?.total ?? pendingUsers.length;

  return (
    <AdminShell active="registrations" title={t('admin.registrationsTitle')} pendingCount={pendingCount}>
      <AdminPageHeader
        title={t('admin.registrationsTitle')}
        description={t('admin.registrationsDesc')}
      />

      {message && (
        <div
          className="user-notice"
          style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f0fdf4', borderColor: '#bbf7d0', color: '#15803d' }}
          role="status"
        >
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} style={{ background: 'none', border: 'none', color: '#15803d', cursor: 'pointer', fontSize: '18px' }}>×</button>
        </div>
      )}

      {error && (
        <div
          className="user-notice"
          style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}
          role="alert"
        >
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: '18px' }}>×</button>
        </div>
      )}

      <div className="student-filter-toolbar" style={{ marginBottom: '20px' }}>
        <div className="student-tabs-pills" role="tablist" style={{ background: 'transparent', padding: 0 }}>
          <div
            className="student-tab-pill student-tab-pill--active student-tab-pill--alert"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 600,
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
              cursor: 'default',
            }}
          >
            <span>{locale === 'vi' ? 'Chờ phê duyệt' : 'Pending approval'}</span>{' '}
            <span
              className="student-tab-pill__count"
              style={{
                background: '#fef3c7',
                color: '#b45309',
                border: '1px solid #fde68a',
                borderRadius: '6px',
                padding: '1px 6px',
                fontSize: '11px',
                fontWeight: 700,
                marginLeft: '4px',
              }}
            >
              {pendingCount}
            </span>
          </div>
        </div>

        <div className="student-search-sort-group">
          <div className="student-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder={locale === 'vi' ? 'Tìm đơn đăng ký (tên, email, MSSV)...' : 'Search registrations...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="student-search-input"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="student-search-clear">×</button>
            )}
          </div>
        </div>
      </div>

      <div className="admin-users-card">
        <div className="table-wrap">
          <table className="data-table admin-users-table">
            <thead>
              <tr>
                <th>{locale === 'vi' ? 'Người đăng ký' : 'Applicant'}</th>
                <th>{locale === 'vi' ? 'Mã sinh viên' : 'Student ID'}</th>
                <th>{locale === 'vi' ? 'Ngành học' : 'Major'}</th>
                <th>{locale === 'vi' ? 'Ngày đăng ký' : 'Registered'}</th>
                <th style={{ textAlign: 'right' }}>{locale === 'vi' ? 'Thao tác' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} type="users" />
              ) : filteredPendingUsers.length > 0 ? (
                filteredPendingUsers.map((user) => (
                  <tr key={user.id} className="admin-user-row">
                    <td className="admin-user-col-main">
                      <div className="admin-user-cell">
                        <div className="admin-user-avatar">
                          {getUserInitials(user.name, user.email)}
                        </div>
                        <div className="admin-user-info">
                          <div className="admin-user-name">
                            {user.name || (locale === 'vi' ? 'Chưa có tên' : 'Unnamed Applicant')}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', minWidth: 0 }}>
                            <span className="admin-user-email" title={user.email}>{user.email}</span>
                            {user.phone && (
                              <span style={{ fontSize: '11.5px', color: '#0369a1', background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 500, border: '1px solid #bae6fd', flexShrink: 0 }}>
                                📞 {user.phone}
                              </span>
                            )}
                          </div>
                          {user.attemptNumber && user.attemptNumber > 1 && (
                            <details style={{ marginTop: 4 }}>
                              <summary style={{ fontSize: 12, color: '#b91c1c', cursor: 'pointer', fontWeight: 600 }}>
                                {locale === 'vi'
                                  ? `Đăng ký lại lần thứ ${user.attemptNumber}`
                                  : `Re-registration #${user.attemptNumber}`}
                              </summary>
                              <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12, color: '#475569' }}>
                                {(user.rejectionHistory ?? []).map((h) => (
                                  <li key={h.id}>
                                    {locale === 'vi' ? 'Lần' : 'Attempt'} {h.attemptNumber}: {h.name || '—'} · {h.studentId || '—'} · {h.major || '—'} ·{' '}
                                    {locale === 'vi' ? 'bị từ chối' : 'rejected'}{' '}
                                    {new Date(h.rejectedAt).toLocaleDateString(locale === 'vi' ? 'vi-VN' : undefined, {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric',
                                    })}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="admin-user-col-academic">
                      <div className="admin-user-academic-info">
                        {user.studentId ? (
                          <div className="admin-user-id" style={{ fontWeight: 600, color: '#0f172a' }}>{user.studentId}</div>
                        ) : (
                          <span className="admin-user-empty" style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td className="admin-user-col-major">
                      <div className="admin-user-academic-info">
                        {user.major ? (
                          <div className="admin-user-major" style={{ fontSize: '12px', color: '#64748b' }}>{user.major}</div>
                        ) : (
                          <span className="admin-user-empty" style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td className="admin-user-col-date" style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '12.5px', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {user.createdAt
                          ? new Date(user.createdAt).toLocaleDateString(locale === 'vi' ? 'vi-VN' : undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                          : locale === 'vi' ? 'Gần đây' : 'Recently'}
                      </span>
                    </td>
                    <td className="admin-user-col-actions" style={{ whiteSpace: 'nowrap' }}>
                      <div className="review-actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap', gap: '6px' }}>
                        <Button
                          variant="primary"
                          disabled={busyId === user.id}
                          onClick={() => decidePendingUser(user, 'approve')}
                          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          {locale === 'vi' ? 'Phê duyệt' : 'Approve'}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busyId === user.id}
                          onClick={() => decidePendingUser(user, 'reject')}
                          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                        >
                          {locale === 'vi' ? 'Từ chối' : 'Reject'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>
                      {locale === 'vi' ? 'Không có đăng ký chờ duyệt' : 'No pending registrations'}
                    </div>
                    <div style={{ fontSize: '12.5px' }}>
                      {locale === 'vi'
                        ? 'Tất cả yêu cầu đăng ký đã được xử lý.'
                        : 'All registration requests have been processed.'}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexWrap: 'wrap', gap: '12px' }}
          >
            <span style={{ fontSize: '12.5px', color: '#64748b' }}>
              {locale === 'vi' ? 'Trang' : 'Page'} <strong>{pagination.page}</strong> / <strong>{pagination.totalPages}</strong>
              {' · '}
              {pagination.total} {locale === 'vi' ? 'đăng ký chờ duyệt' : 'pending registrations'}
            </span>
            <div className="review-actions">
              <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((c) => Math.max(1, c - 1))}>
                {locale === 'vi' ? 'Trước' : 'Previous'}
              </Button>
              <Button
                variant="secondary"
                disabled={page >= pagination.totalPages || loading}
                onClick={() => setPage((c) => c + 1)}
              >
                {locale === 'vi' ? 'Sau' : 'Next'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {approvalModal && (
        <div className="admin-modal-backdrop" onClick={() => !busyId && setApprovalModal(null)}>
          <form
            className="admin-modal-card"
            onSubmit={(event) => { event.preventDefault(); void submitApproval(); }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="registration-approval-title"
            style={{ width: 'min(100% - 32px, 680px)', maxHeight: 'min(92vh, 820px)', overflowY: 'auto' }}
          >
            <div className="admin-modal-header">
              <div className="admin-modal-icon admin-modal-icon--published" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 id="registration-approval-title" className="admin-modal-title">
                  {locale === 'vi' ? 'Duyệt và liên kết email Workspace' : 'Approve and link Workspace email'}
                </h3>
                <p className="admin-modal-subtitle">
                  {locale === 'vi' ? 'Chỉ liên kết mailbox đã được admin tạo sẵn; duyệt không tạo email hay đổi mật khẩu.' : 'Only an existing mailbox can be linked. Approval will not create an email account or change its password.'}
                </p>
              </div>
              <button type="button" className="admin-modal-close" onClick={() => !busyId && setApprovalModal(null)} aria-label={locale === 'vi' ? 'Đóng' : 'Close'} disabled={Boolean(busyId)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div style={{ padding: '20px 24px', display: 'grid', gap: 16 }}>
              <div role="note" style={{ display: 'flex', gap: 10, padding: '12px 14px', border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff', color: '#1e40af', fontSize: 13, lineHeight: 1.5 }}>
                <span aria-hidden="true">ⓘ</span>
                <span>{locale === 'vi'
                  ? `Nhập email chính đang hoạt động trong Google Workspace (${process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN || 'hyperdatalab.org'}). Nếu mailbox chưa có, hãy tạo ở mục Quản lý tài khoản → Google Workspace trước. Hệ thống chỉ gửi hướng dẫn đăng nhập đến email cá nhân bên dưới; không tạo mailbox hoặc đổi mật khẩu.`
                  : `Enter an active primary Google Workspace address (${process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN || 'hyperdatalab.org'}). If the mailbox does not exist yet, create it first under Account Management → Google Workspace. The system only emails sign-in instructions to the personal contact below; it will not create a mailbox or change a password.`}</span>
              </div>
              <label style={{ display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 600 }}>
                {locale === 'vi' ? 'Email cá nhân đăng ký' : 'Registered personal email'}
                <input value={approvalModal.applicant.email} readOnly type="email" style={approvalInputStyle} />
                <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>{locale === 'vi' ? 'Chỉ nhận hướng dẫn đăng nhập; mailbox Workspace mới là email dùng để đăng nhập ứng dụng.' : 'Receives sign-in instructions only; the Workspace mailbox is used to sign in to the application.'}</span>
              </label>
              <label style={{ display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 600 }}>
                <span>{locale === 'vi' ? 'Email Workspace đã có sẵn' : 'Existing Workspace email'} <span style={{ color: '#dc2626' }}>*</span></span>
                <input required type="email" autoComplete="off" placeholder={`name@${process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN || 'hyperdatalab.org'}`} value={approvalModal.workspaceEmail} onChange={(event) => setApprovalModal((current) => current ? { ...current, workspaceEmail: event.target.value } : current)} style={approvalInputStyle} />
                <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>{locale === 'vi' ? 'Phải là email chính của mailbox đang hoạt động; không dùng email bí danh.' : 'Must be the primary email of an active mailbox; aliases are not accepted.'}</span>
              </label>
              <div style={approvalTwoColumnStyle}>
                <label style={approvalLabelStyle}><span>{locale === 'vi' ? 'Tên' : 'First name'} <span style={{ color: '#dc2626' }}>*</span></span>
                  <input required maxLength={100} value={approvalModal.firstName} onChange={(event) => setApprovalModal((current) => current ? { ...current, firstName: event.target.value } : current)} style={approvalInputStyle} />
                </label>
                <label style={approvalLabelStyle}><span>{locale === 'vi' ? 'Họ và tên đệm' : 'Last name'} <span style={{ color: '#dc2626' }}>*</span></span>
                  <input required maxLength={100} value={approvalModal.lastName} onChange={(event) => setApprovalModal((current) => current ? { ...current, lastName: event.target.value } : current)} style={approvalInputStyle} />
                </label>
              </div>
              <div style={approvalTwoColumnStyle}>
                <label style={approvalLabelStyle}>{locale === 'vi' ? 'Mã sinh viên' : 'Student ID'}
                  <input maxLength={50} value={approvalModal.studentId} onChange={(event) => setApprovalModal((current) => current ? { ...current, studentId: event.target.value } : current)} style={approvalInputStyle} />
                </label>
                <label style={approvalLabelStyle}>{locale === 'vi' ? 'Ngành / Khoa' : 'Major / Department'}
                  <input maxLength={120} value={approvalModal.major} onChange={(event) => setApprovalModal((current) => current ? { ...current, major: event.target.value } : current)} style={approvalInputStyle} />
                </label>
              </div>
              <div style={{ fontSize: 13, color: '#475569' }}>
                {locale === 'vi' ? 'Vai trò hồ sơ:' : 'Profile role:'}{' '}
                <strong>{approvalModal.applicant.role === 'ADMIN' ? 'Admin' : approvalModal.applicant.role === 'LECTURER' ? (locale === 'vi' ? 'Giảng viên' : 'Lecturer') : (locale === 'vi' ? 'Sinh viên' : 'Student')}</strong>
              </div>
              {approvalError && <div role="alert" style={{ padding: '11px 13px', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', background: '#fef2f2', fontSize: 13 }}>{approvalError}</div>}
            </div>
            <div className="admin-modal-footer">
              <button type="button" className="admin-btn-cancel" onClick={() => setApprovalModal(null)} disabled={Boolean(busyId)}>{locale === 'vi' ? 'Hủy' : 'Cancel'}</button>
              <button type="submit" className="admin-btn-confirm admin-btn-confirm--published" disabled={Boolean(busyId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvalModal.workspaceEmail.trim()) || !approvalModal.firstName.trim() || !approvalModal.lastName.trim()}>
                {busyId ? (locale === 'vi' ? 'Đang xác minh và liên kết…' : 'Verifying and linking…') : (locale === 'vi' ? 'Duyệt và liên kết' : 'Approve and link')}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmModal && confirmModal.open && (
        <div className="admin-modal-backdrop" onClick={() => !busyId && setConfirmModal(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="admin-modal-header">
              <div className={`admin-modal-icon ${confirmModal.isDanger ? 'admin-modal-icon--rejected' : 'admin-modal-icon--published'}`}>
                {confirmModal.isDanger ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <div>
                <h3 className="admin-modal-title">{confirmModal.title}</h3>
                <p className="admin-modal-subtitle">{confirmModal.description}</p>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => !busyId && setConfirmModal(null)}
                aria-label="Close"
                disabled={Boolean(busyId)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="admin-modal-footer">
              <button type="button" className="admin-btn-cancel" onClick={() => setConfirmModal(null)} disabled={Boolean(busyId)}>
                {confirmModal.cancelLabel}
              </button>
              <button
                type="button"
                className={`admin-btn-confirm ${confirmModal.isDanger ? 'admin-btn-confirm--rejected' : 'admin-btn-confirm--published'}`}
                onClick={() => confirmModal.onConfirm()}
                disabled={Boolean(busyId)}
              >
                {busyId ? (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                    </svg>
                    {locale === 'vi' ? 'Đang xử lý...' : 'Processing...'}
                  </>
                ) : confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

export default AdminRegistrationsView;
