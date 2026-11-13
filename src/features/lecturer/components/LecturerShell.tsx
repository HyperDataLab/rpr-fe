'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Suspense, useState, useRef, useEffect, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ROUTES } from '@/app/router';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { authApi } from '@/features/auth/api/authApi';
import { useTranslation, LanguageSwitcher } from '@/i18n';
import { NotificationBell } from '@/shared/components/NotificationBell';

export type LecturerNavKey = 'reviews' | 'submissions' | 'profile' | 'publications' | 'projects';

export interface LecturerShellProps {
  active: LecturerNavKey;
  title: string;
  pendingCount?: number;
  children: ReactNode;
}

function LecturerTopbarSearch() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams?.get('search') || searchParams?.get('q') || '');

  // 1. Sync from URL
  useEffect(() => {
    const q = searchParams?.get('search') || searchParams?.get('q') || '';
    setSearchQuery(q);
  }, [searchParams]);

  // 2. Bi-directional sync: listen to search changes from list tables
  useEffect(() => {
    const handleSearchChange = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      if (typeof customEvent.detail === 'string') {
        setSearchQuery(customEvent.detail);
      }
    };
    window.addEventListener('lecturer-search-change', handleSearchChange);
    return () => window.removeEventListener('lecturer-search-change', handleSearchChange);
  }, []);

  const isListView =
    pathname.startsWith('/lecturer/submissions') ||
    pathname.startsWith('/lecturer/reviews') ||
    pathname.startsWith('/lecturer/publications');

  const getTargetListRoute = () => {
    if (pathname.startsWith('/lecturer/reviews')) return '/lecturer/reviews';
    if (pathname.startsWith('/lecturer/publications')) return '/lecturer/publications';
    return '/lecturer/submissions';
  };

  const onInputChange = (val: string) => {
    setSearchQuery(val);

    if (isListView) {
      // Realtime live filter: broadcast to table immediately
      window.dispatchEvent(new CustomEvent('lecturer-search-change', { detail: val }));

      // Update URL silently without whole page reload
      const target = getTargetListRoute();
      const newUrl = val.trim() ? `${target}?search=${encodeURIComponent(val.trim())}` : target;
      window.history.replaceState(null, '', newUrl);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    const target = getTargetListRoute();
    if (trimmed) {
      router.push(`${target}?search=${encodeURIComponent(trimmed)}`);
    } else {
      router.push(target);
    }
  };

  const handleClear = () => {
    onInputChange('');
    if (!isListView) {
      router.push(getTargetListRoute());
    }
  };

  return (
    <form className="student-topbar__search" onSubmit={handleSearch} role="search">
      <button
        type="submit"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          color: 'inherit',
        }}
        aria-label={t('common.search')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
      <input
        type="text"
        placeholder={t('common.search')}
        value={searchQuery}
        onChange={(e) => onInputChange(e.target.value)}
        className="student-topbar__search-input"
        aria-label={t('common.search')}
      />
      {searchQuery && (
        <button
          type="button"
          onClick={handleClear}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#94a3b8',
            fontSize: '15px',
            padding: '0 4px',
            lineHeight: 1,
          }}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </form>
  );
}

export function LecturerShell({ active, title, pendingCount, children }: LecturerShellProps) {
  const { t, locale } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const displayName = authLoading
    ? t('common.loading')
    : user?.name?.trim() || user?.email?.split('@')[0] || 'Lecturer';
  const displayRole = authLoading
    ? t('common.loading')
    : user?.role === 'LECTURER' ? t('admin.lecturers') : user?.role === 'ADMIN' ? 'Administrator' : user?.email || 'Reviewer';

  const getInitials = (name?: string, email?: string) => {
    if (name?.trim()) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      return name.slice(0, 2).toUpperCase();
    }
    if (email) return email.slice(0, 2).toUpperCase();
    return 'LT';
  };

  const initials = getInitials(user?.name ?? undefined, user?.email ?? undefined);

  return (
    <div className="lecturer-frame">
      <a className="lecturer-skip-link" href="#lecturer-main">Skip to content</a>

      {/* Mobile Backdrop Overlay */}
      {sidebarOpen && (
        <div
          className="student-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Unified Student-Style Sidebar with Mobile Off-canvas Drawer */}
      <aside className={`student-sidebar ${sidebarOpen ? 'student-sidebar--open' : ''}`}>
        {/* Brand Header */}
        <div className="student-sidebar__brand">
          <Link href={ROUTES.LECTURER.REVIEWS} className="student-sidebar__logo-link" aria-label="HyperData Lab Home">
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
          <button
            type="button"
            className="student-sidebar__close-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        {/* Navigation Group */}
        <nav className="student-sidebar__nav" aria-label="Lecturer navigation">
          <div className="student-sidebar__group">
            <span className="student-sidebar__group-title">{t('lecturer.workspace')}</span>
            <Link
              href={ROUTES.LECTURER.SUBMISSIONS}
              className={`student-sidebar__link ${active === 'submissions' ? 'student-sidebar__link--active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="student-sidebar__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </span>
              <span className="student-sidebar__text">{t('lecturer.myManuscripts')}</span>
            </Link>

            <Link
              href={ROUTES.LECTURER.PUBLICATIONS}
              className={`student-sidebar__link ${active === 'publications' ? 'student-sidebar__link--active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="student-sidebar__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <line x1="9" y1="6" x2="16" y2="6" />
                  <line x1="9" y1="10" x2="16" y2="10" />
                  <line x1="9" y1="14" x2="13" y2="14" />
                </svg>
              </span>
              <span className="student-sidebar__text">{t('lecturer.publicationsRepository')}</span>
            </Link>

            <Link href={ROUTES.PROJECTS} className={`student-sidebar__link ${active === 'projects' ? 'student-sidebar__link--active' : ''}`} onClick={() => setSidebarOpen(false)}>
              <span className="student-sidebar__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 15a4 4 0 0 1 5 4v1" /></svg></span>
              <span className="student-sidebar__text">{locale === 'vi' ? 'Dự án nghiên cứu' : 'Research projects'}</span>
            </Link>
          </div>

          {/* Group: Peer Review */}
          <div className="student-sidebar__group">
            <span className="student-sidebar__group-title">{t('lecturer.peerReview')}</span>
            <Link
              href={ROUTES.LECTURER.REVIEWS}
              className={`student-sidebar__link ${active === 'reviews' ? 'student-sidebar__link--active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="student-sidebar__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <path d="m9 9 2 2 4-4" />
                </svg>
              </span>
              <span className="student-sidebar__text">{t('lecturer.reviewQueue')}</span>
              {pendingCount !== undefined && pendingCount > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: '12.5px', fontWeight: 700, color: '#0071bc' }}>
                  {pendingCount}
                </span>
              )}
            </Link>
          </div>

          {/* Group: Profile */}
          <div className="student-sidebar__group">
            <span className="student-sidebar__group-title">{t('admin.system')}</span>
            <Link
              href={ROUTES.LECTURER.PROFILE}
              className={`student-sidebar__link ${active === 'profile' ? 'student-sidebar__link--active' : ''}`}
              onClick={() => setSidebarOpen(false)}
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
          {/* User Profile Card */}
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

      {/* Main Workspace Frame */}
      <main className="lecturer-main" id="lecturer-main">
        <header className="student-topbar">
          <div className="student-topbar__left">
            {/* Hamburger Button on Mobile */}
            <button
              type="button"
              className="student-topbar__menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle Sidebar Navigation"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            <div className="student-topbar__breadcrumbs">
              <span className="student-topbar__crumb-root">
                {active === 'submissions' ? t('lecturer.workspace') : t('lecturer.peerReview')}
              </span>
              <span className="student-topbar__crumb-sep">/</span>
              <span className="student-topbar__crumb-current">{title}</span>
            </div>
          </div>

          <div className="student-topbar__right">
            <Suspense fallback={
              <div className="student-topbar__search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input type="text" placeholder={t('common.search')} className="student-topbar__search-input" disabled />
              </div>
            }>
              <LecturerTopbarSearch />
            </Suspense>

            <NotificationBell />

            <LanguageSwitcher variant="toggle" />

            <Link href={ROUTES.LECTURER.NEW_SUBMISSION} className="student-topbar__cta">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>{t('nav.newSubmission')}</span>
            </Link>
          </div>
        </header>
        <div className="lecturer-content">{children}</div>
      </main>
    </div>
  );
}
