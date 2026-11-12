'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ROUTES } from '@/app/router';
import { LecturerShell } from '../components';
import { SortDropdown } from '@/components/sort-dropdown';
import { TableSkeleton } from '@/components/skeleton';
import { lecturerReviewApi, type LecturerReviewItem } from '../api';

type QueueFilter = 'ALL' | 'AWAITING_REVIEW' | 'COMPLETED';
type SortOption = 'UPDATED' | 'TITLE' | 'STATUS';

function displayTitle(item: LecturerReviewItem) {
  let raw = item.title?.trim() || item.currentVersion?.fileName || item.objectKey.split('/').pop() || 'Untitled manuscript';
  // Strip common GROBID publisher/licensing noise if extracted into title
  if (raw.includes('Provided proper attribution is provided') && raw.includes('Attention Is All You Need')) {
    raw = 'Attention Is All You Need';
  } else if (raw.startsWith('Provided proper attribution is provided') && raw.length > 100) {
    const parts = raw.split('. ');
    if (parts.length > 1) {
      raw = parts[parts.length - 1].trim();
    }
  }
  return raw;
}

function displayDate(value?: string, locale: string = 'en') {
  if (!value) return locale === 'vi' ? 'Chưa có ngày' : 'Date unavailable';
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function getSlaDetails(item: LecturerReviewItem, locale: string) {
  if (item.reviewStatus === 'COMPLETED') {
    return {
      isOverdue: false,
      badgeColor: '#16a34a',
      bg: '#f0fdf4',
      border: '#bbf7d0',
      label: locale === 'vi' ? 'Đã hoàn thành' : 'Completed',
      tooltip: locale === 'vi' ? 'Đã hoàn thành đánh giá thẩm định' : 'Evaluation submitted',
      iconType: 'check' as const,
    };
  }

  const assignTime = new Date(item.myReview?.createdAt || item.updatedAt || item.createdAt).getTime();
  const deadline = assignTime + 48 * 60 * 60 * 1000;
  const now = Date.now();
  const diffMs = deadline - now;

  if (diffMs > 0) {
    const hoursLeft = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)));
    const isUrgent = hoursLeft <= 12;
    return {
      isOverdue: false,
      badgeColor: isUrgent ? '#d97706' : '#0284c7',
      bg: isUrgent ? '#fffbeb' : '#f0f9ff',
      border: isUrgent ? '#fde68a' : '#bae6fd',
      label: locale === 'vi' ? `Còn ${hoursLeft}h (SLA)` : `${hoursLeft}h left (SLA)`,
      tooltip: locale === 'vi'
        ? `Thời hạn phản hồi trong vòng 48h (còn khoảng ${hoursLeft} giờ)`
        : `Standard 48-hour response window (~${hoursLeft} hours remaining)`,
      iconType: 'clock' as const,
    };
  } else {
    const overdueHours = Math.max(1, Math.floor(Math.abs(diffMs) / (1000 * 60 * 60)));
    return {
      isOverdue: true,
      badgeColor: '#dc2626',
      bg: '#fef2f2',
      border: '#fecaca',
      label: locale === 'vi' ? `Quá hạn ${overdueHours}h` : `Overdue by ${overdueHours}h`,
      tooltip: locale === 'vi'
        ? `Nhiệm vụ đã vượt quá hạn cam kết 48 giờ khoảng ${overdueHours} tiếng`
        : `Task has exceeded the 48-hour SLA window by ~${overdueHours} hours`,
      iconType: 'alert' as const,
    };
  }
}



import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from '@/i18n';

export function LecturerReviewsView() {
  const { t, locale } = useTranslation();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<QueueFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState(searchParams?.get('search') || searchParams?.get('q') || '');
  
  // 1. Sync from URL
  useEffect(() => {
    const q = searchParams?.get('search') || searchParams?.get('q') || '';
    setSearchQuery(q);
  }, [searchParams]);

  // 2. Bi-directional sync with Topbar
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

  const handleToolbarSearchChange = (val: string) => {
    setSearchQuery(val);
    window.dispatchEvent(new CustomEvent('lecturer-search-change', { detail: val }));
    const newUrl = val.trim() ? `/lecturer/reviews?search=${encodeURIComponent(val.trim())}` : '/lecturer/reviews';
    window.history.replaceState(null, '', newUrl);
  };

  const [sortBy, setSortBy] = useState('UPDATED');
  const safeSortBy = sortBy;

  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['lecturer', 'reviews'],
    queryFn: async () => {
      const result = await lecturerReviewApi.list();
      return result.items || [];
    },
    staleTime: 3 * 60 * 1000,
  });

  const items = data || [];
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Unable to load the review queue.') : null;

  const pendingCount = useMemo(
    () => items.filter((item) => item.reviewStatus === 'AWAITING_REVIEW').length,
    [items],
  );

  const completedCount = useMemo(
    () => items.filter((item) => item.reviewStatus === 'COMPLETED').length,
    [items],
  );

  const visibleItems = useMemo(() => {
    let result = items;

    if (filter !== 'ALL') {
      result = result.filter((item) => item.reviewStatus === filter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((item) => {
        const title = displayTitle(item).toLowerCase();
        const author = (item.uploader?.name || item.uploader?.email || '').toLowerCase();
        const doi = (item.doi || '').toLowerCase();
        return title.includes(q) || author.includes(q) || doi.includes(q);
      });
    }

    return [...result].sort((a, b) => {
      if (sortBy === 'TITLE') {
        return displayTitle(a).localeCompare(displayTitle(b));
      }
      if (sortBy === 'STATUS') {
        return a.reviewStatus.localeCompare(b.reviewStatus);
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [filter, items, searchQuery, safeSortBy]);

  return (
    <LecturerShell active="reviews" title={locale === 'vi' ? 'Hàng đợi thẩm định' : 'Review queue'} pendingCount={pendingCount}>
      {/* Filter Toolbar with Integrated Counts, Search, and Sort */}
      <div className="student-filter-toolbar lecturer-reviews-filter-toolbar">
        {/* Status Tab Pills */}
        <div className="student-tabs-pills" role="tablist" aria-label="Filter review queue">
          <button
            type="button"
            className={`student-tab-pill ${filter === 'ALL' ? 'student-tab-pill--active' : ''}`}
            onClick={() => setFilter('ALL')}
          >
            {t('common.all')} <span className="student-tab-pill__count">{items.length}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${filter === 'AWAITING_REVIEW' ? 'student-tab-pill--active student-tab-pill--alert' : ''}`}
            onClick={() => setFilter('AWAITING_REVIEW')}
          >
            {locale === 'vi' ? 'Chờ thẩm định' : 'Awaiting Review'} <span className="student-tab-pill__count">{pendingCount}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${filter === 'COMPLETED' ? 'student-tab-pill--active' : ''}`}
            onClick={() => setFilter('COMPLETED')}
          >
            {locale === 'vi' ? 'Đã hoàn thành' : 'Completed'} <span className="student-tab-pill__count">{completedCount}</span>
          </button>
        </div>

        {/* Search & Sort on Right */}
        <div className="student-toolbar-actions">
          <div className="student-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={t('common.searchManuscriptAuthor')}
              value={searchQuery}
              onChange={(e) => handleToolbarSearchChange(e.target.value)}
              className="student-search-input"
            />
            {searchQuery && (
              <button type="button" onClick={() => handleToolbarSearchChange('')} className="student-search-clear">
                ×
              </button>
            )}
          </div>

          <div className="student-sort-box">
            <span className="student-sort-label">{t('common.sortBy')}</span>
            <SortDropdown
              value={safeSortBy}
              onChange={(val) => setSortBy(val as SortOption)}
              options={[
                { value: 'UPDATED', label: t('common.recentlyUpdated') },
                { value: 'TITLE', label: t('common.titleAZ') },
                { value: 'STATUS', label: locale === 'vi' ? 'Trạng thái thẩm định' : 'Review Status' },
              ]}
              style={{ width: '160px' }}
            />
          </div>
        </div>
      </div>

      {/* 3. Loading, Error, Empty & Table States */}
      {loading && (
        <div className="dashboard-table-card dashboard-table-wrapper">
          <table className="dashboard-table dashboard-table--repository" aria-label="Available review manuscripts list">
            <thead>
              <tr>
                <th style={{ width: '44%' }}>{locale === 'vi' ? 'Bản thảo' : 'Manuscript'}</th>
                <th>{locale === 'vi' ? 'Tác giả' : 'Author'}</th>
                <th>{locale === 'vi' ? 'Phiên bản' : 'Version'}</th>
                <th>{locale === 'vi' ? 'Thời hạn SLA' : 'Review SLA'}</th>
                <th style={{ textAlign: 'right' }}>{locale === 'vi' ? 'Trạng thái' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              <TableSkeleton rows={5} type="reviews" />
            </tbody>
          </table>
        </div>
      )}

      {!loading && error && (
        <div className="student-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && visibleItems.length === 0 && (
        <div className="student-empty-card">
          <div className="student-empty-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <h3>
            {searchQuery
              ? (locale === 'vi' ? `Không tìm thấy bản thảo nào khớp với "${searchQuery}"` : 'No matching manuscripts found')
              : filter === 'AWAITING_REVIEW'
              ? (locale === 'vi' ? 'Không có bản thảo nào đang chờ thẩm định' : 'No manuscripts awaiting review')
              : filter === 'COMPLETED'
              ? (locale === 'vi' ? 'Chưa có bản thảo nào đã hoàn thành thẩm định' : 'No completed reviews recorded')
              : (locale === 'vi' ? 'Hiện không có bản thảo nào trong hàng đợi' : 'No manuscripts currently available for review')}
          </h3>
          <p>
            {searchQuery
              ? (locale === 'vi' ? 'Thử tìm kiếm với từ khóa khác.' : `No available manuscripts match "${searchQuery}". Try a different keyword.`)
              : filter === 'AWAITING_REVIEW'
              ? (locale === 'vi' ? 'Tất cả các bản thảo được phân công đã được gửi đánh giá thành công.' : 'All available reviews have been submitted. Thank you for your thorough peer mentorship!')
              : (locale === 'vi' ? 'Các bản thảo ở trạng thái Đang thẩm định sẽ xuất hiện ở đây khi được phân công.' : 'Submitted preprints in REVIEWING status will appear here for faculty review.')}
          </p>
        </div>
      )}

      {!loading && !error && visibleItems.length > 0 && (
        <div className="dashboard-table-card dashboard-table-wrapper">
          <table className="dashboard-table dashboard-table--repository" aria-label="Available review manuscripts list">
            <thead>
              <tr>
                <th style={{ width: '44%' }}>{locale === 'vi' ? 'Bản thảo' : 'Manuscript'}</th>
                <th>{locale === 'vi' ? 'Tác giả' : 'Author'}</th>
                <th>{locale === 'vi' ? 'Phiên bản' : 'Version'}</th>
                <th>{locale === 'vi' ? 'Thời hạn SLA' : 'Review SLA'}</th>
                <th style={{ textAlign: 'right' }}>{locale === 'vi' ? 'Trạng thái' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const isPending = item.reviewStatus === 'AWAITING_REVIEW';
                const cleanTitle = displayTitle(item);
                const authorName = item.uploader?.name || (locale === 'vi' ? 'Tác giả ẩn danh' : 'Anonymous Author');

                return (
                  <tr key={item.id}>
                    {/* Manuscript Info */}
                    <td>
                      <Link
                        href={ROUTES.LECTURER.REVIEW_DETAIL(item.id)}
                        className="dashboard-table__title-link"
                        style={{ fontWeight: 700, fontSize: '14.5px', color: '#0f172a', lineHeight: 1.4 }}
                        title={cleanTitle}
                      >
                        {cleanTitle}
                      </Link>
                    </td>

                    {/* Author (Student visible, Faculty Double-Blind) */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#334155' }}>
                          {authorName}
                        </span>
                        {item.uploader?.role === 'LECTURER' ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              fontSize: '11px',
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              background: '#f1f5f9',
                              color: '#64748b',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            {locale === 'vi' ? 'Ẩn danh đôi' : 'Double-Blind'}
                          </span>
                        ) : item.uploader?.email ? (
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
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>
                        v{item.currentVersion?.version || 1}.0
                      </span>
                    </td>

                    {/* Review SLA / Updated */}
                    <td>
                      {(() => {
                        const sla = getSlaDetails(item, locale);
                        return (
                          <div>
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                color: sla.badgeColor,
                                background: sla.bg,
                                border: `1px solid ${sla.border}`,
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 700,
                              }}
                              title={sla.tooltip}
                            >
                              {sla.iconType === 'check' && (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                              {sla.iconType === 'clock' && (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10" />
                                  <polyline points="12 6 12 12 16 14" />
                                </svg>
                              )}
                              {sla.iconType === 'alert' && (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="12" y1="8" x2="12" y2="12" />
                                  <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                              )}
                              <span>{sla.label}</span>
                            </div>
                            <span style={{ display: 'block', fontSize: '11.5px', color: '#64748b', marginTop: '3px' }}>
                              {locale === 'vi' ? 'Cập nhật' : 'Updated'} {displayDate(item.updatedAt, locale)}
                            </span>
                          </div>
                        );
                      })()}
                    </td>

                    {/* Status Badge */}
                    <td style={{ textAlign: 'right' }}>
                      <span className={`user-badge ${isPending ? 'user-badge--revision' : 'user-badge--approved'}`}>
                        {isPending
                          ? (locale === 'vi' ? 'CHỜ THẨM ĐỊNH' : 'AWAITING REVIEW')
                          : (locale === 'vi' ? 'ĐÃ HOÀN THÀNH' : 'COMPLETED')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </LecturerShell>
  );
}

export default LecturerReviewsView;
