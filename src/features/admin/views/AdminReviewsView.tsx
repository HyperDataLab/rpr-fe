'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback } from 'react';
import { AdminPageHeader, AdminShell } from '../components';
import { adminApi, type AdminReview, type AdminPublication } from '../api';
import { TableSkeleton } from '@/components/skeleton';
import { SortDropdown } from '@/components/sort-dropdown';
import { ROUTES } from '@/app/router';
import { useTranslation } from '@/i18n';

type ReviewFilterTab = 'ALL' | 'PENDING' | 'NEEDS_REVISION' | 'PUBLISH' | 'REJECT';
type SortOption = 'UPDATED' | 'REVIEWER' | 'TITLE';

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}



export function AdminReviewsView() {
  const { t, locale } = useTranslation();
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ReviewFilterTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [sortBy, setSortBy] = useState('UPDATED');
  const safeSortBy = sortBy;

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let items: AdminReview[] = [];
      let primaryFailed = false;

      // Load reviews from the active admin data adapter.
      try {
        const res = await adminApi.listAllReviews();
        if (res && 'items' in res && Array.isArray(res.items)) {
          items = res.items;
        } else {
          primaryFailed = true;
        }
      } catch {
        primaryFailed = true;
      }

      // Secondary fallback: gather reviews across recent submissions
      if (primaryFailed) {
        try {
          const submissionsRes = await adminApi.listSubmissions({ limit: 50 });
          const pubs = submissionsRes.items || [];
          const allGathered: AdminReview[] = [];

          await Promise.all(
            pubs.map(async (pub: AdminPublication) => {
              try {
                const pubReviews = await adminApi.getReviews(pub.id);
                pubReviews.forEach((rev) => {
                  allGathered.push({
                    ...rev,
                    publication: {
                      id: pub.id,
                      title: pub.title,
                      status: pub.status,
                      currentVersionLabel: pub.currentVersion?.versionLabel || 'v1',
                      uploader: pub.uploader,
                    },
                  });
                });
              } catch {
                // Ignore individual submission review load failures
              }
            })
          );
          items = allGathered;
        } catch (subErr) {
          if (items.length === 0) {
            setError(subErr instanceof Error ? subErr.message : 'Unable to sync reviews from preprints.');
          }
        }
      }

      setReviews(items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load reviews.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  // Metrics calculation
  const metrics = useMemo(() => {
    const total = reviews.length;
    const pending = reviews.filter((r) => !r.recommendation).length;
    const needsRevision = reviews.filter((r) => r.recommendation === 'NEEDS_REVISION').length;
    const publish = reviews.filter((r) => r.recommendation === 'PUBLISH').length;
    const reject = reviews.filter((r) => r.recommendation === 'REJECT').length;
    return { total, pending, needsRevision, publish, reject };
  }, [reviews]);

  // Filtered & Sorted items
  const filteredReviews = useMemo(() => {
    return reviews
      .filter((review) => {
        // Tab filtering
        if (activeTab === 'PENDING' && review.recommendation) return false;
        if (activeTab === 'NEEDS_REVISION' && review.recommendation !== 'NEEDS_REVISION') return false;
        if (activeTab === 'PUBLISH' && review.recommendation !== 'PUBLISH') return false;
        if (activeTab === 'REJECT' && review.recommendation !== 'REJECT') return false;

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchTitle = review.publication?.title?.toLowerCase().includes(q);
          const matchReviewer = review.reviewer?.name?.toLowerCase().includes(q) || review.reviewer?.email?.toLowerCase().includes(q);
          const matchComment = review.comment?.toLowerCase().includes(q);
          if (!matchTitle && !matchReviewer && !matchComment) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (safeSortBy === 'REVIEWER') {
          const nameA = a.reviewer?.name || a.reviewer?.email || '';
          const nameB = b.reviewer?.name || b.reviewer?.email || '';
          return nameA.localeCompare(nameB);
        }
        if (safeSortBy === 'TITLE') {
          const titleA = a.publication?.title || '';
          const titleB = b.publication?.title || '';
          return titleA.localeCompare(titleB);
        }
        return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
      });
  }, [reviews, activeTab, searchQuery, safeSortBy]);

  return (
    <AdminShell active="reviews" title={t('admin.reviews')} pendingCount={metrics.pending}>
      <AdminPageHeader
        eyebrow={t('admin.reviewsEyebrow')}
        title={t('admin.reviewsTitle')}
        description={t('admin.reviewsDesc')}
        actions={
          <Link href={ROUTES.ADMIN.SUBMISSIONS} className="student-btn student-btn--secondary" style={{ textDecoration: 'none' }}>
            {t('admin.browseSubmissions')}
          </Link>
        }
      />

      {/* 1. Metrics Grid (Matching Student & Lecturer Dashboard) */}
      <div className="student-metrics-grid" style={{ marginBottom: '28px' }}>
        <div className="student-metric-card">
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
            <span className="student-metric-value">{metrics.total}</span>
            <span className="student-metric-label">{t('admin.totalLecturerReviews')}</span>
          </div>
        </div>

        <div className="student-metric-card">
          <div className="student-metric-icon" style={{ background: '#e0f2fe', color: '#0284c7' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="student-metric-info">
            <span className="student-metric-value">{metrics.pending}</span>
            <span className="student-metric-label">{t('admin.awaitingFeedback')}</span>
          </div>
        </div>

        <div className="student-metric-card">
          <div className="student-metric-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="student-metric-info">
            <span className="student-metric-value" style={{ color: '#d97706' }}>{metrics.needsRevision}</span>
            <span className="student-metric-label">{t('admin.revisionsRequested')}</span>
          </div>
        </div>

        <div className="student-metric-card">
          <div className="student-metric-icon" style={{ background: '#dcfce7', color: '#16a34a' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="student-metric-info">
            <span className="student-metric-value" style={{ color: '#16a34a' }}>{metrics.publish}</span>
            <span className="student-metric-label">{t('admin.publishRecommended')}</span>
          </div>
        </div>
      </div>

      {/* 2. Filter Toolbar (Pills Tabs + Search + Sort) */}
      <div className="student-filter-toolbar" style={{ marginBottom: '20px' }}>
        <div className="student-tabs-pills">
          <button
            type="button"
            className={`student-tab-pill ${activeTab === 'ALL' ? 'student-tab-pill--active' : ''}`}
            onClick={() => setActiveTab('ALL')}
          >
            {t('common.all')} <span className="student-tab-pill__count">{metrics.total}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${activeTab === 'PENDING' ? 'student-tab-pill--active' : ''}`}
            onClick={() => setActiveTab('PENDING')}
          >
            {locale === 'vi' ? 'Chờ phản hồi' : 'Awaiting Review'} <span className="student-tab-pill__count">{metrics.pending}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${activeTab === 'NEEDS_REVISION' ? 'student-tab-pill--active' : ''}`}
            onClick={() => setActiveTab('NEEDS_REVISION')}
          >
            {t('admin.needsRevision')} <span className="student-tab-pill__count">{metrics.needsRevision}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${activeTab === 'PUBLISH' ? 'student-tab-pill--active' : ''}`}
            onClick={() => setActiveTab('PUBLISH')}
          >
            {t('admin.publishRecommended')} <span className="student-tab-pill__count">{metrics.publish}</span>
          </button>
        </div>

        <div className="student-search-sort-group">
          <div className="student-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="student-search-input"
              placeholder={t('common.searchReviewLecturer')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="student-search-clear"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="student-sort-box">
            <label htmlFor="admin-sort-reviews" className="student-sort-label">{t('common.sortBy')}</label>
            <SortDropdown
              id="admin-sort-reviews"
              value={safeSortBy}
              onChange={(val) => setSortBy(val as SortOption)}
              options={[
                { value: 'UPDATED', label: t('common.recentlyUpdated') },
                { value: 'REVIEWER', label: locale === 'vi' ? 'Giảng viên' : 'Reviewer' },
                { value: 'TITLE', label: t('common.titleAZ') },
              ]}
              style={{ width: '160px' }}
            />
          </div>
        </div>
      </div>

      {/* Graceful soft error notice if sync failed */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 18px',
            marginBottom: '20px',
            borderRadius: '8px',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            fontSize: '13px',
          }}
        >
          <span>Notice: Live review API sync is unavailable ({error}). Displaying local records.</span>
          <button
            type="button"
            onClick={fetchReviews}
            className="dashboard-table__cite-btn"
            style={{ padding: '4px 12px', fontSize: '12px', fontWeight: 600 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 3. Review Oversight Academic Table Card */}
      <div className="dashboard-table-card dashboard-table-wrapper">
        {loading ? (
          <table className="dashboard-table dashboard-table--repository" aria-label="Faculty review records">
            <thead>
              <tr>
                <th style={{ width: '28%' }}>{t('admin.tableManuscript')}</th>
                <th style={{ minWidth: '220px' }}>{t('admin.tableReviewer')}</th>
                <th style={{ minWidth: '170px', whiteSpace: 'nowrap' }}>{t('admin.tableEvalStatus')}</th>
                <th style={{ width: '25%' }}>{t('admin.tableFeedbackNotes')}</th>
                <th style={{ minWidth: '140px', whiteSpace: 'nowrap' }}>{t('admin.tableSubmittedSLA')}</th>
              </tr>
            </thead>
            <tbody>
              <TableSkeleton rows={6} type="reviews" />
            </tbody>
          </table>
        ) : filteredReviews.length === 0 ? (
          <div className="student-empty-card" style={{ padding: '48px 24px' }}>
            <div className="student-empty-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="1.75">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <h3>{locale === 'vi' ? 'Không tìm thấy đánh giá nào' : 'No lecturer reviews found'}</h3>
            <p>
              {searchQuery
                ? (locale === 'vi' ? `Không có nhận xét nào khớp với "${searchQuery}".` : `No reviews matched "${searchQuery}". Try a different keyword.`)
                : activeTab !== 'ALL'
                ? (locale === 'vi' ? 'Không có nhận xét nào khớp với bộ lọc trạng thái được chọn.' : 'No lecturer reviews match the selected status filter.')
                : (locale === 'vi' ? 'Chưa có nhận xét nào từ giảng viên cho các bản thảo.' : 'No faculty reviews have been submitted for preprints yet.')}
            </p>
            <Link href={ROUTES.ADMIN.SUBMISSIONS} className="student-btn student-btn--primary" style={{ textDecoration: 'none' }}>
              {t('admin.browseSubmissions')}
            </Link>
          </div>
        ) : (
          <table className="dashboard-table dashboard-table--repository" aria-label="Faculty review records">
            <thead>
              <tr>
                <th style={{ width: '28%' }}>{t('admin.tableManuscript')}</th>
                <th style={{ minWidth: '220px' }}>{t('admin.tableReviewer')}</th>
                <th style={{ minWidth: '170px', whiteSpace: 'nowrap' }}>{t('admin.tableEvalStatus')}</th>
                <th style={{ width: '25%' }}>{t('admin.tableFeedbackNotes')}</th>
                <th style={{ minWidth: '140px', whiteSpace: 'nowrap' }}>{t('admin.tableSubmittedSLA')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredReviews.map((review) => {
                const reviewerInitials =
                  review.reviewer?.name
                    ?.split(' ')
                    .map((w) => w[0])
                    .filter(Boolean)
                    .slice(-2)
                    .join('')
                    .toUpperCase() || 'LR';

                return (
                  <tr key={review.id}>
                    {/* Manuscript Column - Clickable Title */}
                    <td className="dashboard-table__title-cell">
                      <Link
                        href={ROUTES.ADMIN.SUBMISSION_DETAIL(review.publicationId)}
                        className="dashboard-table__title-link"
                        title={review.publication?.title || 'Untitled Manuscript'}
                      >
                        {review.publication?.title || 'Untitled Manuscript'}
                      </Link>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                        <span className="dashboard-version-pill">
                          {review.publication?.currentVersionLabel || (review.round ? `v${review.round}.0` : 'v1.0')}
                        </span>
                        {(review.publication?.uploader?.name || review.publication?.uploader?.email) && (
                          <span className="dashboard-table__sha" style={{ fontSize: '11.5px', color: '#64748b' }}>
                            {locale === 'vi' ? 'Tác giả' : 'Author'}: {review.publication.uploader?.name ? `${review.publication.uploader.name} (${review.publication.uploader.email})` : review.publication.uploader?.email}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Lecturer Reviewer Column */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className="reviewer-avatar-circle" style={{ width: '32px', height: '32px', fontSize: '11px' }}>
                          {reviewerInitials}
                        </div>
                        <div>
                          <strong style={{ display: 'block', fontSize: '13.5px', color: '#0f172a' }}>
                            {review.reviewer?.name || review.reviewer?.email || review.reviewerId}
                          </strong>
                          <span style={{ fontSize: '11.5px', color: '#64748b', overflowWrap: 'anywhere' }}>
                            {review.reviewer?.email || t('admin.facultyReviewerDefault')}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Evaluation Status Column */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {review.recommendation === 'NEEDS_REVISION' && (
                        <span className="user-badge user-badge--revision">{t('admin.needsRevision').toUpperCase()}</span>
                      )}
                      {review.recommendation === 'PUBLISH' && (
                        <span className="user-badge user-badge--approved">{t('admin.recommendPublish')}</span>
                      )}
                      {review.recommendation === 'REJECT' && (
                        <span className="user-badge user-badge--withdrawn">{t('admin.recommendReject')}</span>
                      )}
                      {!review.recommendation && (
                        <span className="user-badge user-badge--review">{t('admin.inProgress')}</span>
                      )}
                    </td>

                    {/* Feedback Notes Column */}
                    <td>
                      {review.comment ? (
                        <span style={{ fontSize: '13px', color: '#334155', fontStyle: 'italic' }}>
                          &ldquo;{review.comment.length > 70 ? review.comment.slice(0, 70) + '…' : review.comment}&rdquo;
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                          {t('admin.pendingReviewerSubmission')}
                        </span>
                      )}
                    </td>

                    {/* SLA / Submitted Column */}
                    <td className="dashboard-table__date" style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: '12.5px', color: '#334155', fontWeight: 500 }}>
                        {formatDate(review.submittedAt || review.updatedAt)}
                      </div>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {review.submittedAt ? t('admin.evaluationComplete') : t('admin.expectedSla')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}

export default AdminReviewsView;

