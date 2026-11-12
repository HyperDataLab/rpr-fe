'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { PageHeader } from '@hyperdata/design-system';

import { ROUTES } from '@/app/router';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { authApi } from '@/features/auth/api/authApi';
import { useTranslation } from '@/i18n';
import { NotificationBell } from '@/shared/components/NotificationBell';
import { firestoreDb } from '@/lib/firebase/client';

export type AdminNavKey = 'dashboard' | 'submissions' | 'reviews' | 'users' | 'registrations' | 'profile';

export interface AdminShellProps {
  active: AdminNavKey;
  title: string;
  pendingCount?: number;
  children: ReactNode;
}

export function AdminSidebar({
  active,
  pendingCount,
  isOpen,
  onClose,
}: {
  active: AdminNavKey;
  pendingCount?: number;
  isOpen?: boolean;
  onClose?: () => void;
}) {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [internalPendingCount, setInternalPendingCount] = useState<number | undefined>(
    () => pendingCount
  );

  useEffect(() => {
    if (pendingCount !== undefined) {
      setInternalPendingCount(pendingCount);
    }
  }, [pendingCount]);

  useEffect(() => {
    if (!user?.id || user.role !== 'ADMIN' || !user.isActive || user.status !== 'APPROVED') return;
    const pendingQuery = query(
      collection(firestoreDb(), 'registrationRequests'),
      where('status', '==', 'PENDING'),
      limit(1000),
    );
    return onSnapshot(pendingQuery, { includeMetadataChanges: true }, (snapshot) => {
      // A cached snapshot can outlive a resolved/rejected registration. Only show a
      // badge after Firestore confirms the current server-side count.
      if (snapshot.metadata.fromCache) return;
      setInternalPendingCount(snapshot.size);
    }, (reason) => {
      console.warn('Admin registration count listener failed:', reason.code);
      setInternalPendingCount(undefined);
    });
  }, [user?.id, user?.isActive, user?.role, user?.status]);

  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Administrator';
  const displayRole = user?.role === 'ADMIN' ? 'System Administrator' : user?.email || 'Administrator';

  const getInitials = (name?: string, email?: string) => {
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
    return 'AD';
  };

  const initials = getInitials(user?.name, user?.email);

  return (
    <aside className={`student-sidebar ${isOpen ? 'student-sidebar--open' : ''}`}>
      {/* Brand Header */}
      <div className="student-sidebar__brand">
        <Link href={ROUTES.ADMIN.SUBMISSIONS} className="student-sidebar__logo-link" aria-label="HyperData Lab Home">
          <div className="student-sidebar__logo-lockup">
            <Image
              src="/hyperdata-lab-logo.png"
              alt="HyperData Lab Logo"
              width={28}
              height={28}
              style={{ borderRadius: '6px', objectFit: 'contain' }}
              priority
            />
            <span className="student-sidebar__brand-name">HyperData Lab</span>
          </div>
        </Link>

        {/* Close button on mobile */}
        {onClose && (
          <button
            type="button"
            className="student-sidebar__close-btn"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        )}
      </div>

      {/* Navigation Groups */}
      <nav className="student-sidebar__nav" aria-label="Admin navigation">
        <div className="student-sidebar__group">
          <span className="student-sidebar__group-title">{t('admin.workspace')}</span>
          <Link
            href={ROUTES.ADMIN.SUBMISSIONS}
            className={`student-sidebar__link ${active === 'submissions' || active === 'dashboard' ? 'student-sidebar__link--active' : ''}`}
            onClick={onClose}
          >
            <span className="student-sidebar__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" x2="8" y1="9" y2="9" />
              </svg>
            </span>
            <span className="student-sidebar__text">{t('admin.submissions')}</span>
            {pendingCount !== undefined && pendingCount > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: '12.5px', fontWeight: 700, color: '#0071bc' }}>
                {pendingCount}
              </span>
            )}
          </Link>

          <Link
            href={ROUTES.ADMIN.REVIEWS}
            className={`student-sidebar__link ${active === 'reviews' ? 'student-sidebar__link--active' : ''}`}
            onClick={onClose}
          >
            <span className="student-sidebar__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                <path d="m9 9 2 2 4-4" />
              </svg>
            </span>
            <span className="student-sidebar__text">{t('admin.reviews')}</span>
          </Link>
        </div>

        {/* Group: SYSTEM */}
        <div className="student-sidebar__group">
          <span className="student-sidebar__group-title">{t('admin.system')}</span>
          <Link
            href={ROUTES.ADMIN.USERS}
            className={`student-sidebar__link ${active === 'users' ? 'student-sidebar__link--active' : ''}`}
            onClick={onClose}
          >
            <span className="student-sidebar__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <span className="student-sidebar__text">{t('admin.accountManagement')}</span>
          </Link>

          <Link
            href={ROUTES.ADMIN.REGISTRATIONS}
            className={`student-sidebar__link ${active === 'registrations' ? 'student-sidebar__link--active' : ''}`}
            onClick={onClose}
          >
            <span className="student-sidebar__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </span>
            <span className="student-sidebar__text">{t('admin.registrationRequests')}</span>
            {internalPendingCount !== undefined && internalPendingCount > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: '999px',
                  background: '#fef3c7',
                  color: '#b45309',
                  border: '1px solid #fde68a',
                  lineHeight: 1.4,
                }}
              >
                {internalPendingCount}
              </span>
            )}
          </Link>

          <Link
            href={ROUTES.ADMIN.PROFILE}
            className={`student-sidebar__link ${active === 'profile' ? 'student-sidebar__link--active' : ''}`}
            onClick={onClose}
          >
            <span className="student-sidebar__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <span className="student-sidebar__text">{t('common.profile')}</span>
          </Link>
        </div>
      </nav>


      {/* Sidebar Footer with Profile Card */}
      <div className="student-sidebar__footer">
        <div className="student-sidebar__profile-card">
          <div className="student-sidebar__avatar">
            <span>{initials}</span>
            <span className="student-sidebar__status-dot" aria-label="Online" />
          </div>
          <div className="student-sidebar__profile-info">
            <span className="student-sidebar__name" title={displayName}>
              {displayName}
            </span>
            <span className="student-sidebar__org" title={displayRole}>
              {displayRole}
            </span>
          </div>
          <button
            type="button"
            onClick={() => authApi.logout()}
            className="student-sidebar__logout-btn"
            title={t('common.logout')}
            aria-label={t('common.logout')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}


export function Topbar({ title, onToggleSidebar, scrolled }: { title: string; onToggleSidebar?: () => void; scrolled?: boolean }) {
  const { t } = useTranslation();

  return (
    <header className={`student-topbar admin-topbar-fixed${scrolled ? ' admin-topbar--scrolled' : ''}`}>
      <div className="student-topbar__left">
        {/* Hamburger Button on Mobile */}
        <button
          type="button"
          className="student-topbar__menu-btn"
          onClick={onToggleSidebar}
          aria-label="Toggle Sidebar Navigation"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <div className="student-topbar__breadcrumbs">
          <span className="student-topbar__crumb-root">{t('admin.dashboard')}</span>
          <span className="student-topbar__crumb-sep">/</span>
          <span className="student-topbar__crumb-current">{title}</span>
        </div>
      </div>

      <div className="student-topbar__right">
        <div className="student-topbar__search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={t('common.searchShell')}
            className="student-topbar__search-input"
            aria-label={t('common.searchManuscripts')}
          />
        </div>

        <NotificationBell />
      </div>
    </header>
  );
}

export function AdminPageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />;
}

export function AdminShell({ active, title, pendingCount, children }: AdminShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="admin-frame">
      <a className="skip-link" href="#main-content">Skip to content</a>

      {/* Mobile Backdrop Overlay */}
      {sidebarOpen && (
        <div
          className="student-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Responsive Drawer Sidebar */}
      <AdminSidebar
        active={active}
        pendingCount={pendingCount}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="admin-main">
        <Topbar
          title={title}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          scrolled={scrolled}
        />
        <div className="admin-content-scroll" id="main-content">
          <div className="admin-content">{children}</div>
        </div>
      </main>
    </div>
  );
}
