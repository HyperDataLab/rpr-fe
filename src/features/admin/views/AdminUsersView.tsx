'use client';

import { useEffect, useState, useRef } from 'react';
import { Button } from '@hyperdata/design-system';
import { AdminPageHeader, AdminShell } from '../components';
import { adminApi, type AdminUser, type AdminOverview } from '../api';
import { TableSkeleton } from '@/components/skeleton';
import { SortDropdown } from '@/components/sort-dropdown';
import { useTranslation } from '@/i18n';
import {
  connectGoogleWorkspace, createWorkspaceProfile, createWorkspaceUser, deleteWorkspaceUser, disconnectGoogleWorkspace,
  getWorkspaceConnectionStatus, listWorkspaceUsers, restoreWorkspaceUser, suspendWorkspaceUser,
  type WorkspaceConnectionStatus, type WorkspaceUser,
} from '../api/workspaceApi';

type AccountRoleTab = 'ALL' | 'STUDENT' | 'LECTURER' | 'ADMIN';
type ActiveFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

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

export function AdminUsersView() {
  const { t, locale } = useTranslation();
  const [roleTab, setRoleTab] = useState<AccountRoleTab>('ALL');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('ALL');
  const [page, setPage] = useState(1);

  // Data states
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [accounts, setAccounts] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState<{ page: number; totalPages: number; total: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceConnectionStatus | null>(null);
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([]);
  const [workspacePage, setWorkspacePage] = useState(1);
  const [workspacePageTokens, setWorkspacePageTokens] = useState<Array<string | undefined>>([undefined]);
  const [workspaceNextPageToken, setWorkspaceNextPageToken] = useState<string | null>(null);
  const [workspaceSearch, setWorkspaceSearch] = useState('');
  const [workspaceSearchInput, setWorkspaceSearchInput] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceForm, setWorkspaceForm] = useState({ email: '', firstName: '', lastName: '' });

  // Create User Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isNormalCreateOpen, setIsNormalCreateOpen] = useState(false);
  const [normalForm, setNormalForm] = useState({ username: '', email: '', name: '', studentId: '', major: '', role: 'STUDENT' as AdminUser['role'], passwordMode: 'GENERATE' as 'GENERATE' | 'CUSTOM', password: '' });
  const [normalCreateError, setNormalCreateError] = useState<string | null>(null);
  const normalModalRef = useRef<HTMLDivElement>(null);
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    personalEmail: '',
    studentId: '',
    major: '',
    role: 'STUDENT' as AdminUser['role'],
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const createModalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isCreateOpen && !isNormalCreateOpen) return;

    const body = document.body;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    const bodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    const rootOverflow = root.style.overflow;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    root.style.overflow = 'hidden';

    const modal = () => isNormalCreateOpen ? normalModalRef.current : createModalRef.current;
    const handleModalWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const activeModal = modal();
      if (!activeModal) return;
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? activeModal.clientHeight : 1;
      activeModal.scrollTop += event.deltaY * multiplier;
    };
    window.addEventListener('wheel', handleModalWheel, { capture: true, passive: false });

    return () => {
      window.removeEventListener('wheel', handleModalWheel, true);
      body.style.overflow = bodyStyles.overflow;
      body.style.position = bodyStyles.position;
      body.style.top = bodyStyles.top;
      body.style.left = bodyStyles.left;
      body.style.right = bodyStyles.right;
      body.style.width = bodyStyles.width;
      root.style.overflow = rootOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [isCreateOpen, isNormalCreateOpen]);

  // Custom Confirm Modal state
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    isDanger?: boolean;
    requiredConfirmation?: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const PAGE_SIZE = 10;
  const WORKSPACE_PAGE_SIZE = 5;

  const refreshWorkspace = async (targetPage = workspacePage, pageTokens = workspacePageTokens, search = workspaceSearch) => {
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const status = await getWorkspaceConnectionStatus();
      setWorkspaceStatus(status);
      if (status.connected) {
        const pageResult = await listWorkspaceUsers({
          pageSize: WORKSPACE_PAGE_SIZE,
          pageToken: pageTokens[targetPage - 1],
          orderBy: 'email',
          query: search
            ? search.includes('@')
              ? `email:${search.toLowerCase().replace(/[^a-z0-9._%+-@]/g, '')}*`
              : `name:'${search.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
            : undefined,
        });
        setWorkspaceUsers(pageResult.users);
        setWorkspaceNextPageToken(pageResult.nextPageToken);
      } else {
        setWorkspaceUsers([]);
        setWorkspaceNextPageToken(null);
        setWorkspacePage(1);
        setWorkspacePageTokens([undefined]);
      }
    } catch (reason) {
      setWorkspaceError(reason instanceof Error ? reason.message : 'Unable to load Workspace accounts.');
    } finally {
      setWorkspaceLoading(false);
    }
  };

  useEffect(() => { void refreshWorkspace(); }, []);

  const workspaceSearchFirstRender = useRef(true);
  useEffect(() => {
    if (workspaceSearchFirstRender.current) {
      workspaceSearchFirstRender.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const query = workspaceSearchInput.trim();
      const firstPageTokens: Array<string | undefined> = [undefined];
      setWorkspaceSearch(query);
      setWorkspacePage(1);
      setWorkspacePageTokens(firstPageTokens);
      setWorkspaceNextPageToken(null);
      void refreshWorkspace(1, firstPageTokens, query);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [workspaceSearchInput]);

  const runWorkspaceAction = async (action: () => Promise<unknown>) => {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try { await action(); await refreshWorkspace(); }
    catch (reason) { setWorkspaceError(reason instanceof Error ? reason.message : 'Workspace action failed.'); }
    finally { setWorkspaceBusy(false); }
  };

  // Refresh Overview metrics
  const refreshOverview = () => {
    adminApi
      .overview()
      .then((data) => setOverview(data))
      .catch(() => {});
  };

  // Refresh System Accounts
  const refreshAccounts = (targetPage = page) => {
    setLoading(true);
    const roleParam = roleTab === 'ALL' ? undefined : roleTab;
    const isActiveParam = activeFilter === 'ALL' ? undefined : activeFilter === 'ACTIVE';

    adminApi
      .listUsers({
        page: targetPage,
        limit: PAGE_SIZE,
        role: roleParam,
        search: search.trim() || undefined,
        isActive: isActiveParam,
      })
      .then((res) => {
        setAccounts(res.users || []);
        setPagination(res.pagination || null);
        if (res.users?.length === 0 && targetPage > 1) {
          setPage(targetPage - 1);
        }
      })
      .catch((reason: unknown) => {
        setAccounts([]);
        setPagination(null);
        setError(reason instanceof Error ? reason.message : 'Unable to load accounts.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refreshOverview();
  }, []);

  useEffect(() => {
    refreshAccounts(page);
  }, [roleTab, page, activeFilter]);

  // Debounced search for accounts
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setPage(1);
      refreshAccounts(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Toggle User Active/Suspended status
  const handleToggleActive = (user: AdminUser) => {
    const willActive = !user.isActive;
    setConfirmModal({
      open: true,
      title: willActive
        ? (locale === 'vi' ? 'Mở khóa tài khoản' : 'Activate Account')
        : (locale === 'vi' ? 'Khóa tài khoản' : 'Suspend Account'),
      description: willActive
        ? (locale === 'vi' ? `Xác nhận mở khóa và cho phép ${user.email} đăng nhập lại hệ thống?` : `Activate and allow ${user.email} to log in again?`)
        : (locale === 'vi' ? `Xác nhận tạm khóa tài khoản ${user.email}? Người dùng này sẽ không thể đăng nhập cho đến khi được mở khóa.` : `Suspend ${user.email}? This user will not be able to log in until unlocked.`),
      confirmLabel: willActive ? (locale === 'vi' ? 'Mở khóa' : 'Activate') : (locale === 'vi' ? 'Khóa tài khoản' : 'Suspend'),
      cancelLabel: locale === 'vi' ? 'Hủy' : 'Cancel',
      isDanger: !willActive,
      onConfirm: async () => {
        setBusyId(user.id);
        setMessage(null);
        setError(null);
        try {
          await adminApi.updateUserStatus(user.id, willActive);
          refreshAccounts(page);
          refreshOverview();
          setMessage(
            willActive
              ? (locale === 'vi' ? `Đã mở khóa tài khoản ${user.email}.` : `Activated ${user.email}.`)
              : (locale === 'vi' ? `Đã tạm khóa tài khoản ${user.email}.` : `Suspended ${user.email}.`),
          );
        } catch (reason: unknown) {
          setError(reason instanceof Error ? reason.message : 'Unable to update account status.');
        } finally {
          setBusyId(null);
          setConfirmModal(null);
        }
      },
    });
  };

  // Change User Role
  const handleChangeRole = (user: AdminUser, newRole: AdminUser['role']) => {
    if (newRole === user.role) return;
    const roleNames: Record<AdminUser['role'], string> = {
      STUDENT: locale === 'vi' ? 'Sinh viên' : 'Student',
      LECTURER: locale === 'vi' ? 'Giảng viên' : 'Lecturer',
      ADMIN: locale === 'vi' ? 'Quản trị viên' : 'Admin',
    };

    setConfirmModal({
      open: true,
      title: locale === 'vi' ? 'Thay đổi vai trò người dùng' : 'Change User Role',
      description: locale === 'vi'
        ? `Xác nhận chuyển vai trò của ${user.email} từ ${roleNames[user.role]} sang ${roleNames[newRole]}?`
        : `Change role for ${user.email} from ${user.role} to ${newRole}?`,
      confirmLabel: locale === 'vi' ? 'Cập nhật' : 'Update',
      cancelLabel: locale === 'vi' ? 'Hủy' : 'Cancel',
      onConfirm: async () => {
        setBusyId(user.id);
        setMessage(null);
        setError(null);
        try {
          await adminApi.updateUserRole(user.id, newRole);
          refreshAccounts(page);
          refreshOverview();
          setMessage(
            locale === 'vi'
              ? `Đã chuyển vai trò của ${user.email} thành ${roleNames[newRole]}.`
              : `Updated role of ${user.email} to ${newRole}.`,
          );
        } catch (reason: unknown) {
          setError(reason instanceof Error ? reason.message : 'Unable to change user role.');
        } finally {
          setBusyId(null);
          setConfirmModal(null);
        }
      },
    });
  };

  // Delete application account while preserving the Workspace mailbox.
  const handleDeleteUser = (user: AdminUser) => {
    setConfirmText('');
    setConfirmModal({
      open: true,
      title: locale === 'vi' ? 'Xóa tài khoản ứng dụng' : 'Delete application account',
      description: locale === 'vi'
        ? `Thao tác này xóa tài khoản và dữ liệu của ${user.email} trong ứng dụng. Mailbox Google Workspace và các bài có đồng tác giả khác sẽ được giữ nguyên.`
        : `This permanently deletes ${user.email}'s Firebase account and application data. Their Workspace mailbox and stored PDF files will be preserved.`,
      confirmLabel: locale === 'vi' ? 'Xóa tài khoản' : 'Delete account',
      cancelLabel: locale === 'vi' ? 'Hủy' : 'Cancel',
      isDanger: true,
      requiredConfirmation: user.email,
      onConfirm: async () => {
        setBusyId(user.id);
        setMessage(null);
        setError(null);
        try {
          await adminApi.deleteUser(user.id, user.email);
          refreshAccounts(page);
          refreshOverview();
          setMessage(locale === 'vi' ? `Đã xóa tài khoản ${user.email}.` : `Deleted account ${user.email}.`);
        } catch (reason: unknown) {
          setError(reason instanceof Error ? reason.message : 'Unable to delete user.');
        } finally {
          setBusyId(null);
          setConfirmModal(null);
        }
      },
    });
  };
  // Create User submit
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.email.trim()) return;

    setBusyId('create');
    setMessage(null);
    setCreateError(null);
    try {
      const createdProfile = await createWorkspaceProfile({
        email: createForm.email.trim(),
        personalEmail: createForm.personalEmail.trim(),
        name: createForm.name.trim() || undefined,
        studentId: createForm.studentId.trim() || undefined,
        major: createForm.major.trim() || undefined,
        role: createForm.role || 'STUDENT',
      });
      setIsCreateOpen(false);
      setCreateForm({ name: '', email: '', personalEmail: '', studentId: '', major: '', role: 'STUDENT' });
      refreshAccounts(1);
      refreshOverview();
      void refreshWorkspace(1, [undefined], workspaceSearch);
      setMessage(createdProfile.onboardingEmailSent
        ? (locale === 'vi' ? `Đã tạo hồ sơ và gửi thông tin đăng nhập đến ${createdProfile.personalEmail}.` : `Profile created; sign-in details sent to ${createdProfile.personalEmail}.`)
        : (locale === 'vi' ? 'Đã tạo hồ sơ nhưng gửi email thất bại. Dùng Resend access để gửi lại.' : 'Profile created, but the email could not be sent. Use Resend access to retry.'));
    } catch (reason: unknown) {
      const errorMessage = reason instanceof Error ? reason.message : 'Unable to create profile.';
      const viErrors: Record<string, string> = {
        'This Workspace email is already assigned to an application profile.': 'Email Workspace này đã được gán cho một hồ sơ khác.',
        'This Workspace email is already linked to another application profile.': 'Email Workspace này đã liên kết với hồ sơ khác.',
        'Only an existing Workspace mailbox can be linked. No mailbox was created.': 'Chỉ có thể liên kết mailbox Workspace đã tồn tại; hệ thống không tạo mailbox mới.',
        'Restore this Workspace account before linking it to a profile.': 'Hãy khôi phục tài khoản Workspace trước khi liên kết hồ sơ.',
        'Use the Workspace account’s primary email address, not an alias.': 'Hãy nhập email chính của tài khoản Workspace, không dùng email bí danh.',
        'The email must use the configured Workspace domain.': 'Email phải thuộc domain Workspace đã cấu hình.',
        'Enter a valid personal email address for the access notice.': 'Vui lòng nhập email cá nhân hợp lệ để nhận thông tin đăng nhập.',
        'The access-notice email must differ from the Workspace email.': 'Email nhận thông tin phải khác email Workspace.',
      };
      setCreateError(locale === 'vi' ? viErrors[errorMessage] || errorMessage : errorMessage);
    } finally {
      setBusyId(null);
    }
  };

  const handleNormalCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusyId('create-normal');
    setMessage(null);
    setNormalCreateError(null);
    try {
      const created = await adminApi.createUser({
        username: normalForm.username.trim(), email: normalForm.email.trim(), name: normalForm.name.trim(),
        studentId: normalForm.studentId.trim() || null, major: normalForm.major.trim() || null,
        role: normalForm.role, passwordMode: normalForm.passwordMode,
        ...(normalForm.passwordMode === 'CUSTOM' ? { password: normalForm.password } : {}),
      });
      setIsNormalCreateOpen(false);
      setNormalForm({ username: '', email: '', name: '', studentId: '', major: '', role: 'STUDENT', passwordMode: 'GENERATE', password: '' });
      refreshAccounts(1);
      refreshOverview();
      setMessage(created.onboardingEmailSent
        ? (locale === 'vi' ? `Đã tạo tài khoản và gửi thông tin đăng nhập đến ${created.email}.` : `Account created; sign-in details sent to ${created.email}.`)
        : (locale === 'vi' ? 'Đã tạo tài khoản nhưng gửi email thất bại. Dùng “Gửi lại thông tin” trong danh sách tài khoản.' : 'Account created, but email delivery failed. Use “Resend credentials” in the account list.'));
    } catch (reason) {
      setNormalCreateError(reason instanceof Error ? reason.message : 'Unable to create account.');
    } finally {
      setBusyId(null);
    }
  };

  const renderRoleBadge = (role: AdminUser['role']) => {
    switch (role) {
      case 'STUDENT':
        return (
          <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {locale === 'vi' ? 'SINH VIÊN' : 'STUDENT'}
          </span>
        );
      case 'LECTURER':
        return (
          <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {locale === 'vi' ? 'GIẢNG VIÊN' : 'LECTURER'}
          </span>
        );
      case 'ADMIN':
        return (
          <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {locale === 'vi' ? 'QUẢN TRỊ VIÊN' : 'ADMIN'}
          </span>
        );
      default:
        return <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{role}</span>;
    }
  };

  const renderStatusBadge = (isActive: boolean) => {
    return isActive ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#ecfdf5', color: '#047857', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, border: '1px solid #a7f3d0', whiteSpace: 'nowrap', flexShrink: 0 }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
        {locale === 'vi' ? 'Hoạt động' : 'Active'}
      </span>
    ) : (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#fef2f2', color: '#b91c1c', padding: '3px 8px', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, border: '1px solid #fecaca', whiteSpace: 'nowrap', flexShrink: 0 }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
        {locale === 'vi' ? 'Đã khóa' : 'Suspended'}
      </span>
    );
  };

  const totalUsersCount = overview?.users?.total || pagination?.total || 0;
  const studentsCount = overview?.users?.students || 0;
  const lecturersCount = overview?.users?.lecturers || 0;
  const adminsCount = Math.max(0, totalUsersCount - studentsCount - lecturersCount);

  return (
    <AdminShell active="users" title={t('admin.usersTitle')}>
      <AdminPageHeader
        title={t('admin.usersTitle')}
        description={t('admin.usersDesc')}
      />

      {/* Dismissible Feedback Message */}
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

      <section className="workspace-admin" aria-labelledby="workspace-accounts-title">
        <header className="workspace-admin__header">
          <div className="workspace-admin__heading">
            <span className="workspace-admin__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M3.75 6.75h16.5v10.5H3.75z" stroke="currentColor" strokeWidth="1.7"/><path d="m4.5 8 7.5 5.25L19.5 8M8 17.25l2.2-2.7m5.8 2.7-2.2-2.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
            <div className="workspace-admin__title-group">
              <div className="workspace-admin__title-row">
                <h2 id="workspace-accounts-title">Google Workspace</h2>
                <span className={`workspace-admin__connection ${workspaceLoading && !workspaceStatus ? 'is-loading' : workspaceStatus?.connected ? 'is-connected' : 'is-disconnected'}`} aria-live="polite">
                  <span className="workspace-admin__connection-dot" />
                  {workspaceLoading && !workspaceStatus ? 'Checking connection' : workspaceStatus?.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <p>Create and manage organization email accounts.</p>
            </div>
          </div>
          <div className="workspace-admin__header-actions">
            <Button variant="secondary" disabled={workspaceBusy || workspaceLoading || workspaceSearchInput.trim() !== workspaceSearch} onClick={() => void refreshWorkspace()}>
              {workspaceLoading ? 'Refreshing…' : 'Refresh'}
            </Button>
            {workspaceStatus?.connected ? (
              <Button variant="secondary" disabled={workspaceBusy} onClick={() => {
                if (window.confirm(`Disconnect ${workspaceStatus.adminEmail}?`)) void runWorkspaceAction(disconnectGoogleWorkspace);
              }}>Disconnect</Button>
            ) : (
              <Button variant="primary" disabled={workspaceBusy || workspaceLoading} onClick={() => void connectGoogleWorkspace().catch((reason) => setWorkspaceError(reason instanceof Error ? reason.message : 'Unable to connect Google Workspace.'))}>Connect Google Workspace</Button>
            )}
          </div>
        </header>

        {workspaceError && <div className="workspace-admin__error" role="alert">{workspaceError}</div>}

        {workspaceStatus?.connected ? <>
          <div className="workspace-admin__connection-details">
            <div>
              <span className="workspace-admin__detail-label">Workspace domain</span>
              <strong>{workspaceStatus.domain}</strong>
            </div>
            <span className="workspace-admin__detail-divider" aria-hidden="true" />
            <div>
              <span className="workspace-admin__detail-label">Connected administrator</span>
              <strong>{workspaceStatus.adminEmail}</strong>
            </div>
            <span className="workspace-admin__accounts-count">{workspaceUsers.length} shown · 5 per page</span>
          </div>

          <form className="workspace-admin__create" onSubmit={(event) => {
            event.preventDefault();
            void runWorkspaceAction(async () => {
              await createWorkspaceUser({ ...workspaceForm, changePasswordAtNextLogin: true, orgUnitPath: '/' });
              setWorkspaceForm({ email: '', firstName: '', lastName: '' });
            });
          }}>
            <div className="workspace-admin__create-heading">
              <div>
                <h3>Create an account</h3>
                <p>A unique temporary password is generated automatically, encrypted for up to 7 days, then emailed once after the profile is linked. Users must change it at first sign-in.</p>
              </div>
              <span className="workspace-admin__domain-hint">Use @{workspaceStatus.domain}</span>
            </div>
            <div className="workspace-admin__form-grid">
              <label className="workspace-admin__field workspace-admin__field--email">
                <span>Email address</span>
                <input aria-label="Workspace email" type="email" required autoComplete="off" placeholder={`name@${workspaceStatus.domain}`} value={workspaceForm.email} onChange={(event) => setWorkspaceForm({ ...workspaceForm, email: event.target.value })} />
              </label>
              <label className="workspace-admin__field">
                <span>First name</span>
                <input aria-label="First name" required autoComplete="given-name" placeholder="First name" value={workspaceForm.firstName} onChange={(event) => setWorkspaceForm({ ...workspaceForm, firstName: event.target.value })} />
              </label>
              <label className="workspace-admin__field">
                <span>Last name</span>
                <input aria-label="Last name" required autoComplete="family-name" placeholder="Last name" value={workspaceForm.lastName} onChange={(event) => setWorkspaceForm({ ...workspaceForm, lastName: event.target.value })} />
              </label>
              <Button variant="primary" type="submit" disabled={workspaceBusy}>
                {workspaceBusy ? 'Creating…' : 'Create account'}
              </Button>
            </div>
          </form>

          <div className="workspace-admin__list-heading">
            <div>
              <h3>Organization accounts</h3>
              <p>Manage access for accounts in this Workspace.</p>
            </div>
            <div className="workspace-admin__list-tools">
              <label className="workspace-admin__search">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" strokeWidth="1.6"/><path d="m13.2 13.2 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                <input
                  type="search"
                  aria-label="Search Workspace accounts by name or email"
                  placeholder="Search name or email"
                  value={workspaceSearchInput}
                  onChange={(event) => {
                    setWorkspaceSearchInput(event.target.value);
                    setWorkspacePage(1);
                    setWorkspacePageTokens([undefined]);
                    setWorkspaceNextPageToken(null);
                  }}
                />
              </label>
              {workspaceLoading && <span className="workspace-admin__refreshing">Searching…</span>}
            </div>
          </div>

          <div className="table-wrap workspace-admin__table-wrap">
            <table className="data-table workspace-admin__table">
              <thead><tr><th>Email address</th><th>Name</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {workspaceUsers.map((user) => <tr key={user.id}>
                  <td><span className="workspace-admin__email">{user.primaryEmail}</span></td>
                  <td>{user.name.fullName}</td>
                  <td><span className={`workspace-admin__user-status ${user.suspended ? 'is-suspended' : 'is-active'}`}><span />{user.suspended ? 'Suspended' : 'Active'}</span></td>
                  <td>
                    <div className="workspace-admin__row-actions">
                      <Button variant="secondary" disabled={workspaceBusy} onClick={() => void runWorkspaceAction(() => user.suspended ? restoreWorkspaceUser(user.id) : suspendWorkspaceUser(user.id))}>{user.suspended ? 'Restore access' : 'Suspend'}</Button>
                      {workspaceStatus.deleteEnabled && <Button variant="secondary" disabled={workspaceBusy} onClick={() => {
                        const confirmation = window.prompt(`Type ${user.primaryEmail} to permanently delete this Workspace account.`);
                        if (confirmation === user.primaryEmail) void runWorkspaceAction(() => deleteWorkspaceUser(user.id, confirmation));
                      }}>Delete</Button>}
                    </div>
                  </td>
                </tr>)}
                {!workspaceLoading && workspaceUsers.length === 0 && <tr><td colSpan={4} className="workspace-admin__empty">{workspaceSearch ? 'No accounts match your search.' : 'No Workspace accounts found.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <nav className="workspace-admin__pagination" aria-label="Workspace accounts pagination">
            <span>Page {workspacePage}</span>
            <div>
              <Button variant="secondary" disabled={workspaceBusy || workspaceLoading || workspaceSearchInput.trim() !== workspaceSearch || workspacePage <= 1} onClick={() => {
                const targetPage = workspacePage - 1;
                setWorkspacePage(targetPage);
                void refreshWorkspace(targetPage, workspacePageTokens);
              }}>Previous</Button>
              <Button variant="secondary" disabled={workspaceBusy || workspaceLoading || workspaceSearchInput.trim() !== workspaceSearch || !workspaceNextPageToken} onClick={() => {
                if (!workspaceNextPageToken) return;
                const targetPage = workspacePage + 1;
                const pageTokens = [...workspacePageTokens];
                pageTokens[targetPage - 1] = workspaceNextPageToken;
                setWorkspacePageTokens(pageTokens);
                setWorkspacePage(targetPage);
                void refreshWorkspace(targetPage, pageTokens);
              }}>Next</Button>
            </div>
          </nav>
        </> : !workspaceLoading && <div className="workspace-admin__not-connected">
          <span className="workspace-admin__not-connected-mark" aria-hidden="true">!</span>
          <div>
            <strong>Connect an administrator account to continue</strong>
            <p>Use an approved Google Workspace administrator to manage organization accounts here.</p>
          </div>
        </div>}
      </section>

      {/* Filter Toolbar with Navigation Role Tabs */}
      <div className="student-filter-toolbar" style={{ marginBottom: '20px' }}>
        <div className="student-tabs-pills" role="tablist">
          <button
            type="button"
            className={`student-tab-pill ${roleTab === 'ALL' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setRoleTab('ALL');
              setPage(1);
            }}
          >
            {locale === 'vi' ? 'Tất cả tài khoản' : 'All Accounts'}{' '}
            {totalUsersCount > 0 && <span className="student-tab-pill__count">{totalUsersCount}</span>}
          </button>

          <button
            type="button"
            className={`student-tab-pill ${roleTab === 'STUDENT' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setRoleTab('STUDENT');
              setPage(1);
            }}
          >
            {locale === 'vi' ? 'Sinh viên' : 'Students'}{' '}
            {studentsCount > 0 && <span className="student-tab-pill__count">{studentsCount}</span>}
          </button>

          <button
            type="button"
            className={`student-tab-pill ${roleTab === 'LECTURER' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setRoleTab('LECTURER');
              setPage(1);
            }}
          >
            {locale === 'vi' ? 'Giảng viên' : 'Lecturers'}{' '}
            {lecturersCount > 0 && <span className="student-tab-pill__count">{lecturersCount}</span>}
          </button>

          <button
            type="button"
            className={`student-tab-pill ${roleTab === 'ADMIN' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setRoleTab('ADMIN');
              setPage(1);
            }}
          >
            {locale === 'vi' ? 'Quản trị viên' : 'Admins'}{' '}
            {adminsCount > 0 && <span className="student-tab-pill__count">{adminsCount}</span>}
          </button>
        </div>

        <div className="student-search-sort-group" style={{ width: '100%' }}>
          {/* Search Box */}
          <div className="student-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder={locale === 'vi' ? 'Tìm tài khoản (tên, email, MSSV)...' : 'Search accounts...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="student-search-input"
              aria-label="Search users"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="student-search-clear"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          {/* Active status dropdown */}
          <div className="student-sort-box">
            <span className="student-sort-label">{locale === 'vi' ? 'Trạng thái:' : 'Status:'}</span>
            <SortDropdown
              value={activeFilter}
              onChange={(val) => {
                setActiveFilter(val as ActiveFilter);
                setPage(1);
              }}
              options={[
                { value: 'ALL', label: locale === 'vi' ? 'Tất cả trạng thái' : 'All statuses' },
                { value: 'ACTIVE', label: locale === 'vi' ? 'Đang hoạt động' : 'Active' },
                { value: 'INACTIVE', label: locale === 'vi' ? 'Đã khóa' : 'Suspended' },
              ]}
            />
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
            <Button variant="primary" onClick={() => { setNormalCreateError(null); setIsNormalCreateOpen(true); }}>
              {locale === 'vi' ? '+ Tạo tài khoản thường' : '+ Create normal account'}
            </Button>
            <Button variant="secondary" onClick={() => { setCreateError(null); setIsCreateOpen(true); }}>
              {locale === 'vi' ? '+ Thêm tài khoản' : '+ Add Account'}
            </Button>
          </div>
        </div>
      </div>

      {/* SYSTEM ACCOUNTS TABLE */}
      <div className="admin-users-card">
        <div className="table-wrap">
          <table className="data-table admin-users-table">
            <thead>
              <tr>
                <th style={{ width: '28%' }}>{locale === 'vi' ? 'Tài khoản / Người dùng' : 'Account / User'}</th>
                <th style={{ width: '20%' }}>{locale === 'vi' ? 'Vai trò' : 'Role'}</th>
                <th style={{ width: '18%' }}>{locale === 'vi' ? 'MSSV / Khoa ngành' : 'Student ID / Major'}</th>
                <th style={{ width: '12%' }}>{locale === 'vi' ? 'Trạng thái' : 'Status'}</th>
                <th style={{ width: '10%' }}>{locale === 'vi' ? 'Ngày tham gia' : 'Joined'}</th>
                <th style={{ width: '12%', textAlign: 'right' }}>{locale === 'vi' ? 'Thao tác' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={4} type="users" />
              ) : accounts.length > 0 ? (
                accounts.map((user) => (
                  <tr key={user.id} className="admin-user-row">
                    <td className="admin-user-col-main">
                      <div className="admin-user-cell">
                        <div className="admin-user-avatar">
                          {getUserInitials(user.name, user.email)}
                        </div>
                        <div className="admin-user-info">
                          <div className="admin-user-name">
                            {user.name || (locale === 'vi' ? 'Chưa đặt tên' : 'Unnamed User')}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px', minWidth: 0 }}>
                            <span className="admin-user-email" title={user.email}>{user.email}</span>
                            {user.phone && (
                              <span style={{ fontSize: '11.5px', color: '#0369a1', background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px', fontWeight: 500, border: '1px solid #bae6fd', flexShrink: 0 }}>
                                📞 {user.phone}
                              </span>
                            )}
                          </div>
                          {user.username && <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: '#475569' }}>Username: {user.username}</span>}
                          {user.workspaceEmail && <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: '#0369a1' }}>Workspace SSO: {user.workspaceEmail}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="admin-user-col-role">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {renderRoleBadge(user.role)}
                        {/* Role Switcher Dropdown */}
                        <div style={{ width: '115px' }}>
                          <SortDropdown
                            value={user.role}
                            onChange={(val) => handleChangeRole(user, val as AdminUser['role'])}
                            options={[
                              { value: 'STUDENT', label: locale === 'vi' ? 'Sinh viên' : 'Student' },
                              { value: 'LECTURER', label: locale === 'vi' ? 'Giảng viên' : 'Lecturer' },
                              { value: 'ADMIN', label: locale === 'vi' ? 'Quản trị viên' : 'Admin' },
                            ]}
                            disabled={busyId === user.id}
                            size="sm"
                          />
                        </div>
                      </div>
                    </td>
                    <td className="admin-user-col-academic">
                      <div className="admin-user-academic-info">
                        {user.studentId && <div className="admin-user-id" style={{ fontWeight: 600, color: '#0f172a' }}>{user.studentId}</div>}
                        {user.major && <div className="admin-user-major" style={{ fontSize: '12px', color: '#64748b' }}>{user.major}</div>}
                        {!user.studentId && !user.major && <span className="admin-user-empty" style={{ color: '#94a3b8' }}>—</span>}
                      </div>
                    </td>
                    <td className="admin-user-col-status" style={{ whiteSpace: 'nowrap' }}>
                      {renderStatusBadge(user.isActive)}
                    </td>
                    <td className="admin-user-col-date" style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '12.5px', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {user.createdAt
                          ? new Date(user.createdAt).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                          : locale === 'vi' ? 'Gần đây' : 'Recently'}
                      </span>
                    </td>
                    <td className="admin-user-col-actions" style={{ whiteSpace: 'nowrap' }}>
                      <div className="review-actions" style={{ justifyContent: 'flex-end', gap: '6px', flexWrap: 'nowrap' }}>
                        {user.username && user.credentialEmailStatus === 'FAILED' && <Button
                          variant="secondary"
                          disabled={busyId === user.id}
                          onClick={async () => {
                            setBusyId(user.id);
                            try {
                              await adminApi.resendUserCredentials(user.id);
                              refreshAccounts(page);
                              setMessage(`Sign-in details sent to ${user.email}.`);
                            } catch (reason) {
                              setError(reason instanceof Error ? reason.message : 'Could not resend credentials.');
                            } finally { setBusyId(null); }
                          }}
                          style={{ fontSize: 12, padding: '5px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
                        >{locale === 'vi' ? 'Gửi lại thông tin' : 'Resend credentials'}</Button>}
                        {user.workspaceEmail && <Button
                          variant="secondary"
                          disabled={busyId === user.id}
                          onClick={() => setConfirmModal({
                            open: true,
                            title: 'Resend Workspace sign-in instructions?',
                            description: `This sends sign-in instructions to ${user.email}. The existing Workspace mailbox and its password will not be changed.`,
                            confirmLabel: 'Resend instructions',
                            cancelLabel: 'Cancel',
                            onConfirm: async () => {
                              setBusyId(user.id);
                              setError(null);
                              try {
                                await adminApi.resendWorkspaceNotice(user.id);
                                setMessage(`Workspace sign-in instructions sent to ${user.email}. No password was changed.`);
                                setConfirmModal(null);
                              } catch (reason) {
                                setError(reason instanceof Error ? reason.message : 'Could not resend the Workspace sign-in notice.');
                              } finally {
                                setBusyId(null);
                              }
                            },
                          })}
                          style={{ fontSize: 12, padding: '5px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
                          title="Resend sign-in instructions without changing the password"
                        >Resend access</Button>}
                        <Button
                          variant="secondary"
                          disabled={busyId === user.id}
                          onClick={() => handleToggleActive(user)}
                          style={{
                            fontSize: '12px',
                            padding: '5px 10px',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            color: user.isActive ? '#b91c1c' : '#047857',
                            borderColor: user.isActive ? '#fecaca' : '#a7f3d0',
                            background: user.isActive ? '#fef2f2' : '#ecfdf5',
                          }}
                        >
                          {user.isActive ? (locale === 'vi' ? 'Khóa' : 'Suspend') : (locale === 'vi' ? 'Mở khóa' : 'Activate')}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busyId === user.id}
                          onClick={() => handleDeleteUser(user)}
                          style={{
                            fontSize: '12px',
                            padding: '5px 8px',
                            color: '#64748b',
                            flexShrink: 0,
                          }}
                          title={locale === 'vi' ? 'Xóa tài khoản' : 'Delete user'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>
                      {locale === 'vi' ? 'Không tìm thấy tài khoản nào' : 'No accounts found'}
                    </div>
                    <div style={{ fontSize: '12.5px' }}>
                      {locale === 'vi' ? 'Không có tài khoản nào phù hợp với bộ lọc hiện tại.' : 'No accounts matched the current criteria.'}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {pagination && pagination.totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 20px',
              borderTop: '1px solid #e2e8f0',
              background: '#f8fafc',
              flexWrap: 'wrap',
              gap: '12px',
            }}
            aria-label="Pagination"
          >
            <span style={{ fontSize: '12.5px', color: '#64748b' }}>
              {locale === 'vi' ? 'Trang' : 'Page'}{' '}
              <strong>{pagination.page}</strong> / <strong>{pagination.totalPages}</strong>
              {' · '}
              {pagination.total} {locale === 'vi' ? 'tài khoản' : 'accounts'}
            </span>
            <div className="review-actions">
              <Button
                variant="secondary"
                disabled={page <= 1 || loading}
                onClick={() => setPage((c) => Math.max(1, c - 1))}
              >
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

      {isNormalCreateOpen && (
        <div className="admin-modal-backdrop admin-profile-create-backdrop" onClick={() => !busyId && setIsNormalCreateOpen(false)}>
          <div ref={normalModalRef} className="admin-modal-card admin-profile-create-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="admin-normal-create-title">
            <div className="admin-modal-header admin-profile-create-header">
              <div className="admin-modal-icon admin-modal-icon--primary"><span style={{ fontSize: 20, fontWeight: 700 }}>@</span></div>
              <div>
                <h3 id="admin-normal-create-title" className="admin-modal-title">{locale === 'vi' ? 'Tạo tài khoản thường' : 'Create normal account'}</h3>
                <p className="admin-modal-subtitle">{locale === 'vi' ? 'Tạo tài khoản HyperDataLab bằng username và mật khẩu.' : 'Create a HyperDataLab username and password account.'}</p>
              </div>
              <button type="button" className="admin-modal-close" onClick={() => !busyId && setIsNormalCreateOpen(false)} aria-label="Close" disabled={Boolean(busyId)}>×</button>
            </div>
            <form className="admin-profile-create-form" onSubmit={(event) => void handleNormalCreateSubmit(event)}>
              <div className="admin-modal-body admin-profile-create-body">
                <div className="admin-profile-create-note" role="note"><p>{locale === 'vi' ? 'Thông tin đăng nhập sẽ được gửi đến email liên hệ bên dưới.' : 'Sign-in details will be sent to the contact email below.'}</p></div>
                <div className="admin-modal-field">
                  <label className="admin-modal-label" htmlFor="admin-normal-username">{locale === 'vi' ? 'Tên đăng nhập' : 'Username'} *</label>
                  <input id="admin-normal-username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autoComplete="off" className="admin-modal-input" placeholder="e.g. duy.nguyen" value={normalForm.username} onChange={(event) => setNormalForm({ ...normalForm, username: event.target.value })} />
                  <span className="admin-profile-create-hint">{locale === 'vi' ? 'Từ 3–32 ký tự: chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.' : '3–32 characters: letters, numbers, dot, underscore, or hyphen.'}</span>
                </div>
                <div className="admin-modal-field">
                  <label className="admin-modal-label" htmlFor="admin-normal-email">{locale === 'vi' ? 'Email liên hệ' : 'Contact email'} *</label>
                  <input id="admin-normal-email" type="email" required maxLength={254} autoComplete="email" className="admin-modal-input" placeholder="name@example.com" value={normalForm.email} onChange={(event) => setNormalForm({ ...normalForm, email: event.target.value })} />
                </div>
                <div className="admin-modal-field">
                  <label className="admin-modal-label" htmlFor="admin-normal-name">{locale === 'vi' ? 'Họ và tên' : 'Full name'} *</label>
                  <input id="admin-normal-name" required maxLength={160} autoComplete="name" className="admin-modal-input" value={normalForm.name} onChange={(event) => setNormalForm({ ...normalForm, name: event.target.value })} />
                </div>
                <div className="admin-profile-create-grid">
                  <div className="admin-modal-field"><label className="admin-modal-label" id="admin-normal-role-label">{locale === 'vi' ? 'Vai trò' : 'Role'}</label>
                    <div className="users-create-role-dropdown">
                      <SortDropdown
                        value={normalForm.role}
                        onChange={(value) => setNormalForm({ ...normalForm, role: value as AdminUser['role'] })}
                        options={[
                          { value: 'STUDENT', label: locale === 'vi' ? 'Sinh viên' : 'Student' },
                          { value: 'LECTURER', label: locale === 'vi' ? 'Giảng viên' : 'Lecturer' },
                          { value: 'ADMIN', label: locale === 'vi' ? 'Quản trị viên' : 'Admin' },
                        ]}
                        disabled={Boolean(busyId)}
                        style={{ width: '100%' }}
                        ariaLabel={locale === 'vi' ? 'Chọn vai trò tài khoản' : 'Select account role'}
                      />
                    </div>
                  </div>
                  <div className="admin-modal-field"><label className="admin-modal-label" htmlFor="admin-normal-student-id">{locale === 'vi' ? 'Mã sinh viên' : 'Student ID'}</label>
                    <input id="admin-normal-student-id" maxLength={50} className="admin-modal-input" value={normalForm.studentId} onChange={(event) => setNormalForm({ ...normalForm, studentId: event.target.value })} />
                  </div>
                </div>
                <div className="admin-modal-field"><label className="admin-modal-label" htmlFor="admin-normal-major">{locale === 'vi' ? 'Ngành / Khoa' : 'Major / Department'}</label>
                  <input id="admin-normal-major" maxLength={120} className="admin-modal-input" value={normalForm.major} onChange={(event) => setNormalForm({ ...normalForm, major: event.target.value })} />
                </div>
                <div className="admin-modal-field"><span className="admin-modal-label">{locale === 'vi' ? 'Mật khẩu ban đầu' : 'Initial password'}</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                    <label><input type="radio" name="normal-password-mode" checked={normalForm.passwordMode === 'GENERATE'} onChange={() => setNormalForm({ ...normalForm, passwordMode: 'GENERATE', password: '' })} /> {locale === 'vi' ? 'Tạo tự động' : 'Generate automatically'}</label>
                    <label><input type="radio" name="normal-password-mode" checked={normalForm.passwordMode === 'CUSTOM'} onChange={() => setNormalForm({ ...normalForm, passwordMode: 'CUSTOM' })} /> {locale === 'vi' ? 'Nhập mật khẩu' : 'Enter password'}</label>
                  </div>
                  {normalForm.passwordMode === 'CUSTOM' && <input type="password" required minLength={8} maxLength={128} autoComplete="new-password" className="admin-modal-input" placeholder={locale === 'vi' ? 'Ít nhất 8 ký tự' : 'At least 8 characters'} value={normalForm.password} onChange={(event) => setNormalForm({ ...normalForm, password: event.target.value })} style={{ marginTop: 10 }} />}
                  {normalForm.passwordMode === 'GENERATE' && <span className="admin-profile-create-hint">{locale === 'vi' ? 'Mật khẩu tự tạo chỉ được gửi qua email và không hiển thị tại đây.' : 'The generated password is emailed once and is not displayed here.'}</span>}
                </div>
                {normalCreateError && <div className="admin-profile-create-error" role="alert">{normalCreateError}</div>}
              </div>
              <div className="admin-modal-footer admin-profile-create-footer">
                <button type="button" className="admin-btn-cancel" onClick={() => setIsNormalCreateOpen(false)} disabled={Boolean(busyId)}>{locale === 'vi' ? 'Hủy' : 'Cancel'}</button>
                <button type="submit" className="admin-btn-confirm admin-btn-confirm--primary" disabled={Boolean(busyId)}>{busyId === 'create-normal' ? (locale === 'vi' ? 'Đang tạo tài khoản…' : 'Creating account…') : (locale === 'vi' ? 'Tạo tài khoản' : 'Create account')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {isCreateOpen && (
        <div className="admin-modal-backdrop admin-profile-create-backdrop" onClick={() => !busyId && setIsCreateOpen(false)}>
          <div ref={createModalRef} className="admin-modal-card admin-profile-create-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="admin-profile-create-title" aria-describedby="admin-profile-create-description">
            <div className="admin-modal-header admin-profile-create-header">
              <div className="admin-modal-icon admin-modal-icon--primary">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
              </div>
              <div>
                <h3 id="admin-profile-create-title" className="admin-modal-title">{locale === 'vi' ? 'Tạo hồ sơ Workspace' : 'Create Workspace profile'}</h3>
                <p id="admin-profile-create-description" className="admin-modal-subtitle">
                  {locale === 'vi' ? 'Liên kết một email Workspace đang hoạt động với hồ sơ ứng dụng.' : 'Link an active Workspace email to an application profile.'}
                </p>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => !busyId && setIsCreateOpen(false)}
                aria-label={locale === 'vi' ? 'Đóng' : 'Close'}
                disabled={Boolean(busyId)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <form className="admin-profile-create-form" onSubmit={handleCreateSubmit}>
              <div className="admin-modal-body admin-profile-create-body">
                <div className="admin-profile-create-note" role="note">
                  <span className="admin-profile-create-note__icon" aria-hidden="true">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                  </span>
                  <p>{locale === 'vi'
                    ? 'Không tạo hộp thư hay mật khẩu mới. Người dùng đăng nhập bằng Google Workspace với email này.'
                    : 'No mailbox or password will be created. The user signs in with Google Workspace using this email.'}</p>
                </div>

                <div className="admin-modal-field">
                  <label className="admin-modal-label" htmlFor="admin-profile-workspace-email">
                    {locale === 'vi' ? 'Email Workspace' : 'Workspace email'} <span aria-hidden="true" style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    id="admin-profile-workspace-email"
                    type="email"
                    required
                    autoComplete="off"
                    placeholder={`name@${workspaceStatus?.domain || 'hyperdatalab.org'}`}
                    value={createForm.email}
                    onChange={(e) => { setCreateForm({ ...createForm, email: e.target.value }); setCreateError(null); }}
                    className="admin-modal-input"
                    aria-invalid={Boolean(createError)}
                    aria-describedby={createError ? 'admin-profile-create-error' : 'admin-profile-email-hint'}
                  />
                  <span id="admin-profile-email-hint" className="admin-profile-create-hint">
                    {locale === 'vi'
                      ? `Dùng email chính thuộc ${workspaceStatus?.domain || 'Workspace'}, đang hoạt động và chưa được gán cho hồ sơ khác.`
                      : `Use an active primary email in ${workspaceStatus?.domain || 'your Workspace'} that is not linked to another profile.`}
                  </span>
                </div>

                <div className="admin-modal-field">
                  <label className="admin-modal-label" htmlFor="admin-profile-personal-email">
                    {locale === 'vi' ? 'Email nhận thông tin đăng nhập' : 'Email for sign-in details'} <span aria-hidden="true" style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    id="admin-profile-personal-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="name@example.com"
                    value={createForm.personalEmail}
                    onChange={(e) => { setCreateForm({ ...createForm, personalEmail: e.target.value }); setCreateError(null); }}
                    className="admin-modal-input"
                  />
                  <span className="admin-profile-create-hint">
                    {locale === 'vi'
                      ? 'Thông tin tài khoản Workspace và mật khẩu tạm thời (nếu vừa được tạo) sẽ gửi đến email này.'
                      : 'Workspace account details and its temporary password, if newly created, will be sent here.'}
                  </span>
                </div>

                <div className="admin-modal-field">
                  <label className="admin-modal-label" htmlFor="admin-profile-full-name">
                    {locale === 'vi' ? 'Họ và tên' : 'Full Name'}
                  </label>
                  <input
                    id="admin-profile-full-name"
                    type="text"
                    placeholder={locale === 'vi' ? 'Nguyễn Văn A' : 'John Doe'}
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    className="admin-modal-input"
                    autoComplete="name"
                  />
                  <span className="admin-profile-create-hint">{locale === 'vi' ? 'Để trống để dùng tên đã lưu trong Google Workspace.' : 'Leave blank to use the name saved in Google Workspace.'}</span>
                </div>

                <div className="admin-profile-create-grid">
                  <div className="admin-modal-field">
                    <label className="admin-modal-label" id="admin-profile-role-label">
                      {locale === 'vi' ? 'Vai trò' : 'Role'}
                    </label>
                    <div className="users-create-role-dropdown">
                      <SortDropdown
                        value={createForm.role}
                        onChange={(val) => setCreateForm({ ...createForm, role: val as AdminUser['role'] })}
                        options={[
                          { value: 'STUDENT', label: locale === 'vi' ? 'Sinh viên' : 'Student' },
                          { value: 'LECTURER', label: locale === 'vi' ? 'Giảng viên' : 'Lecturer' },
                          { value: 'ADMIN', label: locale === 'vi' ? 'Quản trị viên' : 'Admin' },
                        ]}
                        disabled={Boolean(busyId)}
                        style={{ width: '100%' }}
                        ariaLabel={locale === 'vi' ? 'Chọn vai trò hồ sơ' : 'Select profile role'}
                      />
                    </div>
                  </div>

                  <div className="admin-modal-field">
                    <label className="admin-modal-label" htmlFor="admin-profile-student-id">
                      {locale === 'vi' ? 'Mã sinh viên (nếu có)' : 'Student ID'}
                    </label>
                    <input
                      id="admin-profile-student-id"
                      type="text"
                      placeholder={locale === 'vi' ? 'VD: SE123456' : 'e.g. SE123456'}
                      value={createForm.studentId}
                      onChange={(e) => setCreateForm({ ...createForm, studentId: e.target.value })}
                      className="admin-modal-input"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="admin-modal-field">
                  <label className="admin-modal-label" htmlFor="admin-profile-major">
                    {locale === 'vi' ? 'Ngành / Khoa' : 'Major / Department'}
                  </label>
                  <input
                    id="admin-profile-major"
                    type="text"
                    placeholder={locale === 'vi' ? 'Kỹ thuật phần mềm' : 'Software Engineering'}
                    value={createForm.major}
                    onChange={(e) => setCreateForm({ ...createForm, major: e.target.value })}
                    className="admin-modal-input"
                    autoComplete="organization-title"
                  />
                </div>

                {createError && <div id="admin-profile-create-error" className="admin-profile-create-error" role="alert">{createError}</div>}
              </div>

              <div className="admin-modal-footer admin-profile-create-footer">
                <button
                  type="button"
                  className="admin-btn-cancel"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={Boolean(busyId)}
                >
                  {locale === 'vi' ? 'Hủy' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="admin-btn-confirm admin-btn-confirm--primary"
                  disabled={Boolean(busyId)}
                >
                  {busyId ? (locale === 'vi' ? 'Đang tạo hồ sơ...' : 'Creating profile...') : (locale === 'vi' ? 'Tạo hồ sơ' : 'Create profile')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom General Confirmation Modal */}
      {confirmModal && confirmModal.open && (
        <div className="admin-modal-backdrop" onClick={() => !busyId && setConfirmModal(null)}>
          <div
            className="admin-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
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

            {confirmModal.requiredConfirmation && (
              <div style={{ padding: '0 24px 20px' }}>
                <label htmlFor="delete-user-confirmation" style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#334155' }}>
                  {locale === 'vi' ? 'Nhập chính xác email để xác nhận' : 'Type the exact email to confirm'}
                </label>
                <input
                  id="delete-user-confirmation"
                  type="email"
                  autoComplete="off"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder={confirmModal.requiredConfirmation}
                  style={{ width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, color: '#0f172a', font: 'inherit', outlineColor: '#0284c7' }}
                />
                <p className="admin-modal-subtitle" style={{ marginTop: 8 }}>
                  {locale === 'vi' ? 'Mailbox Workspace sẽ không bị xóa hoặc thay đổi.' : 'The Workspace mailbox will not be deleted or changed.'}
                </p>
              </div>
            )}
            <div className="admin-modal-footer">
              <button
                type="button"
                className="admin-btn-cancel"
                onClick={() => setConfirmModal(null)}
                disabled={Boolean(busyId)}
              >
                {confirmModal.cancelLabel}
              </button>
              <button
                type="button"
                className={`admin-btn-confirm ${confirmModal.isDanger ? 'admin-btn-confirm--rejected' : 'admin-btn-confirm--published'}`}
                onClick={() => confirmModal.onConfirm()}
                disabled={Boolean(busyId) || Boolean(confirmModal.requiredConfirmation && confirmText !== confirmModal.requiredConfirmation)}
              >
                {busyId ? (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                    </svg>
                    {locale === 'vi' ? 'Đang xử lý...' : 'Processing...'}
                  </>
                ) : (
                  confirmModal.confirmLabel
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

export default AdminUsersView;
