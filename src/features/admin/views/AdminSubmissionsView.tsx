'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@hyperdata/design-system';
import { AdminPageHeader, AdminShell } from '../components';
import { adminApi, type AdminPublication, type AdminPublicationStatus, type AdminOverview, type AdminPublicationAudience } from '../api';
import { TableSkeleton } from '@/components/skeleton';
import type { PreprintStatus } from '@/shared/types';
import { ROUTES } from '@/app/router';
import { useTranslation } from '@/i18n';

type StatusFilter = 'ALL' | AdminPublicationStatus;
type RoleFilter = 'ALL' | 'LECTURER' | 'STUDENT';

function badgeStatus(status: AdminPublicationStatus): PreprintStatus {
  switch (status) {
    case 'REVIEWING':
      return 'UNDER_REVIEW';
    case 'PUBLISHED':
      return 'PUBLISHED';
    case 'REJECTED':
      return 'REJECTED';
    case 'DRAFTING':
      return 'NEEDS_REVISION';
    case 'PROCESSING':
    default:
      return 'DRAFT';
  }
}

function formatVersionLabel(versionLabel?: string | null, versionNumber?: number | null) {
  if (versionLabel) {
    return versionLabel.startsWith('v') ? versionLabel : `v${versionLabel}`;
  }
  if (typeof versionNumber === 'number') {
    return `v${versionNumber}`;
  }
  return 'v1.0';
}

function displayTitle(item: AdminPublication) {
  return item.title?.trim() || 'Untitled manuscript';
}

export function AdminSubmissionsView() {
  const { t, locale } = useTranslation();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Awaited<ReturnType<typeof adminApi.listSubmissions>> | null>(null);
  const [metrics, setMetrics] = useState<AdminOverview['metrics'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openAudienceMenu, setOpenAudienceMenu] = useState(false);
  const [updatingAudience, setUpdatingAudience] = useState(false);

  // Clear selections when filters or pagination change
  useEffect(() => {
    setSelectedIds([]);
    setOpenAudienceMenu(false);
  }, [page, debouncedQuery, status, roleFilter]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(handler);
  }, [query]);

  // Close audience popover when clicking outside
  useEffect(() => {
    if (!openAudienceMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.admin-audience-toolbar-wrapper')) {
        setOpenAudienceMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openAudienceMenu]);

  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (!result?.items.length) return;
    if (selectedIds.length === result.items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(result.items.map((it) => it.id));
    }
  };

  const toggleAudience = async (item: AdminPublication, targetAudience: AdminPublicationAudience) => {
    const currentList = item.audiences || [];
    const isCurrentlySet = currentList.includes(targetAudience);
    const nextAudiences = isCurrentlySet
      ? currentList.filter((a) => a !== targetAudience)
      : [...currentList, targetAudience];

    // Optimistic UI update
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((pub) =>
          pub.id === item.id ? { ...pub, audiences: nextAudiences, updatedAt: new Date().toISOString() } : pub
        ),
      };
    });

    setUpdatingAudience(true);
    try {
      await adminApi.updateVisibility(item.id, nextAudiences);
    } catch (err: unknown) {
      // Revert optimistic update on failure
      setResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((pub) =>
            pub.id === item.id ? { ...pub, audiences: currentList } : pub
          ),
        };
      });
      setError(err instanceof Error ? err.message : 'Unable to update audience visibility.');
    } finally {
      setUpdatingAudience(false);
    }
  };

  const toggleBatchAudience = async (targetAudience: AdminPublicationAudience) => {
    if (selectedIds.length === 0 || !result?.items) return;
    const targetItems = result.items.filter((it) => selectedIds.includes(it.id));
    const allHaveIt = targetItems.every((it) => it.audiences?.includes(targetAudience));
    const nextAction = !allHaveIt; // true = add to all, false = remove from all

    // Optimistic UI update
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((pub) => {
          if (!selectedIds.includes(pub.id)) return pub;
          const cur = pub.audiences || [];
          const next = nextAction
            ? Array.from(new Set([...cur, targetAudience]))
            : cur.filter((a) => a !== targetAudience);
          return { ...pub, audiences: next, updatedAt: new Date().toISOString() };
        }),
      };
    });

    setUpdatingAudience(true);
    try {
      await Promise.all(
        targetItems.map((item) => {
          const cur = item.audiences || [];
          const next = nextAction
            ? Array.from(new Set([...cur, targetAudience]))
            : cur.filter((a) => a !== targetAudience);
          return adminApi.updateVisibility(item.id, next);
        })
      );
    } catch (err: unknown) {
      // Revert optimistic update on failure
      setResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((pub) => {
            const original = targetItems.find((t) => t.id === pub.id);
            return original ? { ...pub, audiences: original.audiences } : pub;
          }),
        };
      });
      setError(err instanceof Error ? err.message : 'Unable to batch update audience visibility.');
    } finally {
      setUpdatingAudience(false);
    }
  };

  // Fetch overview metrics for top cards & status pills count
  useEffect(() => {
    let active = true;
    adminApi
      .overview()
      .then((res) => {
        if (active && res?.metrics) {
          setMetrics(res.metrics);
        }
      })
      .catch(() => {
        // Soft-fail: metrics are complementary, table still loads
      });

    return () => {
      active = false;
    };
  }, []);

  // Fetch submissions list whenever page, query, status, or roleFilter changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    adminApi
      .listSubmissions({
        page,
        limit: 20,
        search: debouncedQuery.trim() || undefined,
        status: status === 'ALL' ? undefined : status,
        uploaderRole: roleFilter === 'ALL' ? undefined : roleFilter,
      })
      .then((next) => {
        if (active) setResult(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load submissions.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, debouncedQuery, status, roleFilter]);

  const displayMetrics = metrics || {
    submitted: 0,
    underReview: 0,
    needsRevision: 0,
    published: 0,
    rejected: 0,
    processing: 0,
    facultySubmissions: 0,
    studentSubmissions: 0,
    total: result?.pagination?.total || 0,
  };

  const pagination = result?.pagination;

  const selectedItems = (result?.items || []).filter((it) => selectedIds.includes(it.id));
  const isGuestActive = selectedItems.length > 0 && selectedItems.every((it) => it.audiences?.includes('GUEST'));
  const isStudentActive = selectedItems.length > 0 && selectedItems.every((it) => it.audiences?.includes('STUDENT'));
  const isLecturerActive = selectedItems.length > 0 && selectedItems.every((it) => it.audiences?.includes('LECTURER'));

  return (
    <AdminShell active="submissions" title="Submissions" pendingCount={displayMetrics.underReview}>
      <AdminPageHeader
        title={t('admin.submissionsManagement')}
        description={t('admin.submissionsDesc')}
      />

      {error && (
        <div className="user-notice" style={{ marginBottom: '20px', background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {/* 1. Metrics Grid */}
      <div className="student-metrics-grid" style={{ marginBottom: '24px' }}>
        <div
          className={`student-metric-card ${status === 'ALL' ? 'student-metric-card--active' : ''}`}
          onClick={() => {
            setStatus('ALL');
            setPage(1);
          }}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
        >
          <div className="student-metric-icon" style={{ background: '#e0f2fe', color: '#0071bc' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div className="student-metric-info">
            <span className="student-metric-value">{displayMetrics.total}</span>
            <span className="student-metric-label">{t('admin.totalManuscripts')}</span>
          </div>
        </div>

        <div
          className={`student-metric-card ${status === 'REVIEWING' ? 'student-metric-card--active' : ''}`}
          onClick={() => {
            setStatus('REVIEWING');
            setPage(1);
          }}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
        >
          <div className="student-metric-icon" style={{ background: '#e0f2fe', color: '#0284c7' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="student-metric-info">
            <span className="student-metric-value">{displayMetrics.underReview}</span>
            <span className="student-metric-label">{t('admin.inReview')}</span>
          </div>
        </div>

        <div
          className={`student-metric-card ${displayMetrics.needsRevision > 0 ? 'student-metric-card--alert' : ''} ${status === 'DRAFTING' ? 'student-metric-card--active' : ''}`}
          onClick={() => {
            setStatus('DRAFTING');
            setPage(1);
          }}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
        >
          <div className="student-metric-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="student-metric-info">
            <span className="student-metric-value" style={{ color: displayMetrics.needsRevision > 0 ? '#d97706' : undefined }}>
              {displayMetrics.needsRevision}
            </span>
            <span className="student-metric-label">{t('admin.needsRevision')}</span>
          </div>
        </div>

        <div
          className={`student-metric-card ${status === 'PUBLISHED' ? 'student-metric-card--active' : ''}`}
          onClick={() => {
            setStatus('PUBLISHED');
            setPage(1);
          }}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
        >
          <div className="student-metric-icon" style={{ background: '#dcfce7', color: '#16a34a' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="student-metric-info">
            <span className="student-metric-value" style={{ color: '#16a34a' }}>{displayMetrics.published}</span>
            <span className="student-metric-label">{t('admin.published')}</span>
          </div>
        </div>
      </div>

      {/* Submitter Category Tabs (All / Faculty / Student) - System Style */}
      <div className="student-filter-toolbar" style={{ marginBottom: '14px' }}>
        <div className="student-tabs-pills" role="tablist" aria-label="Filter submissions by submitter category">
          <button
            type="button"
            className={`student-tab-pill ${roleFilter === 'ALL' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setRoleFilter('ALL');
              setPage(1);
            }}
          >
            {t('admin.submissions')} <span className="student-tab-pill__count">{displayMetrics.total}</span>
          </button>

          <button
            type="button"
            className={`student-tab-pill ${roleFilter === 'LECTURER' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setRoleFilter('LECTURER');
              setPage(1);
            }}
          >
            {t('admin.lecturers')} <span className="student-tab-pill__count">{displayMetrics.facultySubmissions ?? 0}</span>
          </button>

          <button
            type="button"
            className={`student-tab-pill ${roleFilter === 'STUDENT' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setRoleFilter('STUDENT');
              setPage(1);
            }}
          >
            {t('admin.students')} <span className="student-tab-pill__count">{displayMetrics.studentSubmissions ?? 0}</span>
          </button>
        </div>
      </div>

      {/* 2. Filter Toolbar: Filter Tab Pills & Search Box */}
      <div className="student-filter-toolbar" style={{ marginBottom: '20px' }}>
        <div className="student-tabs-pills">
          <button
            type="button"
            className={`student-tab-pill ${status === 'ALL' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setStatus('ALL');
              setPage(1);
            }}
          >
            {t('common.all')} <span className="student-tab-pill__count">{displayMetrics.total}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${status === 'REVIEWING' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setStatus('REVIEWING');
              setPage(1);
            }}
          >
            {t('admin.inReview')} <span className="student-tab-pill__count">{displayMetrics.underReview}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${status === 'DRAFTING' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setStatus('DRAFTING');
              setPage(1);
            }}
          >
            {t('admin.needsRevision')} <span className="student-tab-pill__count">{displayMetrics.needsRevision}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${status === 'PUBLISHED' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setStatus('PUBLISHED');
              setPage(1);
            }}
          >
            {t('admin.published')} <span className="student-tab-pill__count">{displayMetrics.published}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${status === 'REJECTED' ? 'student-tab-pill--active' : ''}`}
            onClick={() => {
              setStatus('REJECTED');
              setPage(1);
            }}
          >
            {t('admin.rejected')} <span className="student-tab-pill__count">{displayMetrics.rejected}</span>
          </button>
        </div>

        <div className="student-search-sort-group">
          {/* Select Choice on the LEFT of Search Box */}
          {status === 'PUBLISHED' && (
            <div className="admin-audience-toolbar-wrapper admin-audience-popover-container">
              <button
                type="button"
                className={`admin-toolbar-audience-btn ${openAudienceMenu ? 'admin-toolbar-audience-btn--open' : ''} ${selectedIds.length > 0 ? 'admin-toolbar-audience-btn--active' : ''}`}
                onClick={() => setOpenAudienceMenu((prev) => !prev)}
                title={locale === 'vi' ? 'Thiết lập quyền hiển thị cho các bài đã chọn' : 'Configure audience visibility for selected manuscripts'}
              >
                <span>
                  {selectedIds.length > 0
                    ? `${locale === 'vi' ? 'Hiển thị' : 'Audience'} (${selectedIds.length})`
                    : (locale === 'vi' ? 'Hiển thị' : 'Audience')}
                </span>
                <svg
                  className="admin-toolbar-audience-arrow"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {openAudienceMenu && (
                <div className="admin-audience-popover-menu admin-audience-popover-menu--toolbar">
                  <div className="admin-audience-popover-header">
                    {locale === 'vi' ? 'Hiển thị' : 'Audience'}
                  </div>
                  <div className="admin-audience-popover-sub">
                    {selectedIds.length === 0
                      ? (locale === 'vi'
                          ? '💡 Hãy tích chọn checkbox ở cột bên trái của bài viết để thiết lập quyền truy cập.'
                          : '💡 Check the boxes on the left of manuscripts to configure access.')
                      : selectedIds.length === 1
                        ? (locale === 'vi'
                            ? 'Tích chọn để cập nhật ngay cho 1 bài viết đã chọn:'
                            : 'Toggle options to update the selected manuscript:')
                        : (locale === 'vi'
                            ? `Áp dụng thay đổi cho ${selectedIds.length} bài viết đã chọn:`
                            : `Apply changes to ${selectedIds.length} selected manuscripts:`)}
                  </div>

                  <div className="admin-audience-popover-list">
                    {/* GUEST Option */}
                    <label className={`admin-audience-popover-item ${isGuestActive ? 'admin-audience-popover-item--selected' : ''}`} style={selectedIds.length === 0 ? { opacity: 0.6, cursor: 'not-allowed' } : {}}>
                      <input
                        type="checkbox"
                        className="admin-audience-popover-checkbox"
                        checked={isGuestActive}
                        disabled={selectedIds.length === 0 || updatingAudience}
                        onChange={() => {
                          if (selectedIds.length === 1) {
                            const item = result?.items.find((it) => it.id === selectedIds[0]);
                            if (item) toggleAudience(item, 'GUEST');
                          } else {
                            toggleBatchAudience('GUEST');
                          }
                        }}
                      />
                      <div className="admin-audience-popover-text">
                        <span className="admin-audience-popover-title">
                          Public Landing (Guest)
                        </span>
                        <span className="admin-audience-popover-desc">
                          {locale === 'vi' ? 'Hiển thị bài báo ra trang chủ cho khách đọc (tự động đưa lên đầu)' : 'Exposed to public visitors on landing page'}
                        </span>
                      </div>
                    </label>

                    {/* STUDENT Option */}
                    <label className={`admin-audience-popover-item ${isStudentActive ? 'admin-audience-popover-item--selected' : ''}`} style={selectedIds.length === 0 ? { opacity: 0.6, cursor: 'not-allowed' } : {}}>
                      <input
                        type="checkbox"
                        className="admin-audience-popover-checkbox"
                        checked={isStudentActive}
                        disabled={selectedIds.length === 0 || updatingAudience}
                        onChange={() => {
                          if (selectedIds.length === 1) {
                            const item = result?.items.find((it) => it.id === selectedIds[0]);
                            if (item) toggleAudience(item, 'STUDENT');
                          } else {
                            toggleBatchAudience('STUDENT');
                          }
                        }}
                      />
                      <div className="admin-audience-popover-text">
                        <span className="admin-audience-popover-title">
                          Sinh viên (Student)
                        </span>
                        <span className="admin-audience-popover-desc">
                          {locale === 'vi' ? 'Cho phép sinh viên đã đăng nhập đọc' : 'University students with active accounts'}
                        </span>
                      </div>
                    </label>

                    {/* LECTURER Option */}
                    <label className={`admin-audience-popover-item ${isLecturerActive ? 'admin-audience-popover-item--selected' : ''}`} style={selectedIds.length === 0 ? { opacity: 0.6, cursor: 'not-allowed' } : {}}>
                      <input
                        type="checkbox"
                        className="admin-audience-popover-checkbox"
                        checked={isLecturerActive}
                        disabled={selectedIds.length === 0 || updatingAudience}
                        onChange={() => {
                          if (selectedIds.length === 1) {
                            const item = result?.items.find((it) => it.id === selectedIds[0]);
                            if (item) toggleAudience(item, 'LECTURER');
                          } else {
                            toggleBatchAudience('LECTURER');
                          }
                        }}
                      />
                      <div className="admin-audience-popover-text">
                        <span className="admin-audience-popover-title">
                          Giảng viên (Lecturer)
                        </span>
                        <span className="admin-audience-popover-desc">
                          {locale === 'vi' ? 'Cho phép giảng viên và ban biên tập đọc' : 'Faculty members and reviewers'}
                        </span>
                      </div>
                    </label>
                  </div>

                  {selectedIds.length > 0 && (
                    <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedIds([])}
                        style={{ fontSize: '11.5px', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                      >
                        {locale === 'vi' ? 'Bỏ chọn tất cả' : 'Clear selection'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="student-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="student-search-input"
              placeholder={t('admin.searchSubmissions')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setPage(1);
                }}
                className="student-search-clear"
                aria-label={t('admin.clearSearch')}
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. Submissions Academic Table Card */}
      <div className="dashboard-table-card dashboard-table-wrapper">
        {loading ? (
          <table className="dashboard-table dashboard-table--repository" aria-label="Editorial submissions queue">
            <thead>
              <tr>
                <th style={{ width: '45%' }}>{t('admin.titleAndVersion')}</th>
                <th>{t('admin.author')}</th>
                <th>{t('nav.versions')}</th>
                <th>{t('admin.submittedDate')}</th>
                <th>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              <TableSkeleton rows={6} type="submissions" />
            </tbody>
          </table>
        ) : !result?.items.length ? (
          <div className="student-empty-card" style={{ padding: '48px 24px' }}>
            <div className="student-empty-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="1.75">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <h3>{t('admin.noSubmissions')}</h3>
            <p>
              {query || status !== 'ALL' || roleFilter !== 'ALL'
                ? (locale === 'vi'
                    ? 'Không có bản thảo nào khớp với bộ lọc hiện tại. Hãy thử thay đổi từ khóa tìm kiếm hoặc tab trạng thái.'
                    : 'No submissions match your current filters. Try changing your search query, status tab, or author role tab.')
                : (locale === 'vi'
                    ? 'Các bản thảo nghiên cứu mới sẽ tự động hiển thị tại đây.'
                    : 'New research submissions will appear here automatically.')}
            </p>
          </div>
        ) : (
          <table className="dashboard-table dashboard-table--repository" aria-label="Editorial submissions queue">
            <thead>
              <tr>
                {status === 'PUBLISHED' && (
                  <th style={{ width: '44px', textAlign: 'center', padding: '0 8px' }}>
                    <input
                      type="checkbox"
                      className="admin-table-checkbox"
                      checked={result.items.length > 0 && selectedIds.length === result.items.length}
                      onChange={toggleSelectAll}
                      title={selectedIds.length === result.items.length ? (locale === 'vi' ? 'Bỏ chọn tất cả' : 'Deselect all') : (locale === 'vi' ? 'Chọn tất cả' : 'Select all')}
                      aria-label="Select all published manuscripts"
                    />
                  </th>
                )}
                <th style={{ width: status === 'PUBLISHED' ? '32%' : '45%' }}>{t('admin.titleAndVersion')}</th>
                <th>{t('admin.author')}</th>
                <th>{t('nav.versions')}</th>
                <th>{t('admin.submittedDate')}</th>
                <th>{t('common.status')}</th>
                {status === 'PUBLISHED' && (
                  <th style={{ width: '130px', textAlign: 'center' }}>
                    {locale === 'vi' ? 'Hiển thị' : 'Audience'}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => {
                const authorName = item.uploader?.name || item.uploader?.email || (locale === 'vi' ? 'Không có tên tác giả' : 'Author unavailable');
                const isSelected = selectedIds.includes(item.id);

                return (
                  <tr key={item.id} className={isSelected ? 'dashboard-table__row--selected' : ''}>
                    {/* Item Checkbox on the LEFT */}
                    {status === 'PUBLISHED' && (
                      <td style={{ width: '44px', textAlign: 'center', padding: '0 8px' }}>
                        <input
                          type="checkbox"
                          className="admin-table-checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectItem(item.id)}
                          title={isSelected ? (locale === 'vi' ? 'Bỏ chọn bài này' : 'Deselect') : (locale === 'vi' ? 'Chọn bài này' : 'Select')}
                          aria-label={`Select ${displayTitle(item)}`}
                        />
                      </td>
                    )}

                    {/* Manuscript Column - Clickable Title */}
                    <td className="dashboard-table__title-cell">
                      <Link
                        href={ROUTES.ADMIN.SUBMISSION_DETAIL(item.id)}
                        className="dashboard-table__title-link"
                        title={displayTitle(item)}
                      >
                        {displayTitle(item)}
                      </Link>
                    </td>

                    {/* Author with Email Subtext */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1e293b' }}>
                          {authorName}
                        </span>
                        {item.uploader?.email ? (
                          <span
                            style={{
                              fontSize: '12px',
                              color: '#64748b',
                              fontWeight: 400,
                              lineHeight: 1.2,
                            }}
                          >
                            {item.uploader.email}
                          </span>
                        ) : null}
                      </div>
                    </td>

                    {/* Version */}
                    <td>
                      <span className="dashboard-version-pill">
                        {formatVersionLabel(item.currentVersion?.versionLabel, item.currentVersion?.version)}
                      </span>
                    </td>

                    {/* Updated */}
                    <td className="dashboard-table__date">
                      {new Date(item.updatedAt).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>

                    {/* Status */}
                    <td>
                      <StatusBadge status={badgeStatus(item.status)} />
                    </td>

                    {/* Audience Visibility Badges (Clean display) */}
                    {/* Audience Visibility (Clean text display) */}
                    {status === 'PUBLISHED' && (
                      <td style={{ textAlign: 'center' }}>
                        {(item.audiences || []).length === 0 ? (
                          <span className="admin-audience-badge admin-audience-badge--empty">
                            {locale === 'vi' ? 'Chưa cấu hình' : 'Default'}
                          </span>
                        ) : (
                          <div style={{ display: 'inline-flex', gap: '3px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                            {[
                              item.audiences?.includes('GUEST') ? (
                                <span key="guest" className="admin-audience-badge admin-audience-badge--guest" title="Hiển thị Landing">
                                  Landing
                                </span>
                              ) : null,
                              item.audiences?.includes('STUDENT') ? (
                                <span key="student" className="admin-audience-badge admin-audience-badge--student" title="Sinh viên">
                                  SV
                                </span>
                              ) : null,
                              item.audiences?.includes('LECTURER') ? (
                                <span key="lecturer" className="admin-audience-badge admin-audience-badge--lecturer" title="Giảng viên">
                                  GV
                                </span>
                              ) : null,
                            ]
                              .filter(Boolean)
                              .reduce<React.ReactNode[]>((acc, node, idx) => (idx === 0 ? [node] : [...acc, <span key={`sep-${idx}`} style={{ color: '#94a3b8' }}>, </span>, node]), [])}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination Strip */}
        {pagination && pagination.totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 22px',
              borderTop: '1px solid #f1f5f9',
              background: '#fcfdfe',
            }}
          >
            <span style={{ fontSize: '13px', color: '#64748b' }}>
              {t('admin.pageOf', { page: pagination.page, totalPages: pagination.totalPages })} · {t('admin.totalSubmissionsNum', { total: pagination.total })}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="dashboard-table__cite-btn"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('common.previous')}
              </button>
              <button
                type="button"
                className="dashboard-table__cite-btn"
                disabled={page >= pagination.totalPages || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('common.next')}
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export default AdminSubmissionsView;
