'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StudentShell } from '../components';
import { FeedbackCardSkeleton } from '@/components/skeleton';
import { SortDropdown } from '@/components/sort-dropdown';
import { studentPreprintApi } from '../api';
import { usePreprintList } from '../hooks';
import type { StudentPreprint } from '../types';
import { useTranslation } from '@/i18n';

type FeedbackFilter = 'ALL' | 'ACTION' | 'REVIEW' | 'APPROVED';
type SortOption = 'UPDATED' | 'TITLE' | 'REVIEWER';

function FeedbackCommentBubble({ comment }: { comment: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = comment.length > 220;

  return (
    <div className="mentor-feedback-card__comment-box">
      <blockquote className={`mentor-feedback-card__comment-text ${!expanded && isLong ? 'mentor-feedback-card__comment-text--clamped' : ''}`}>
        &ldquo;{comment}&rdquo;
      </blockquote>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mentor-feedback-card__toggle-btn"
        >
          {expanded ? 'Thu gọn ▴' : 'Xem thêm ▾'}
        </button>
      )}
    </div>
  );
}

function getInitials(name?: string, fallback = 'GV') {
  if (!name || !name.trim()) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function StudentMentorFeedbackView() {
  const { t, locale } = useTranslation();
  const { items, loading: listLoading, error: listError } = usePreprintList();
  const [filter, setFilter] = useState<FeedbackFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('UPDATED');
  const [expandedManuscripts, setExpandedManuscripts] = useState<Record<string, boolean>>({});

  const toggleManuscript = (id: string) => {
    setExpandedManuscripts((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const reviewedManuscripts = useMemo(() => {
    return items.filter(
      (record) =>
        (record.reviews && record.reviews.length > 0) ||
        record.status === 'UNDER_REVIEW' ||
        record.status === 'NEEDS_REVISION' ||
        record.status === 'APPROVED' ||
        record.status === 'PUBLISHED'
    );
  }, [items]);
  const reviewsLoading = listLoading;
  const reviewsError = listError;

  // Counts for filter pills
  const actionCount = useMemo(
    () =>
      items.filter(
        (item) => item.status === 'NEEDS_REVISION' || (item.status === 'DRAFT' && item.reviews?.some((review) => review.decision === 'NEEDS_REVISION')),
      ).length,
    [items],
  );

  const reviewCount = useMemo(
    () => items.filter((item) => item.status === 'UNDER_REVIEW').length,
    [items],
  );

  const approvedCount = useMemo(
    () => items.filter((item) => item.status === 'APPROVED' || item.status === 'PUBLISHED').length,
    [items],
  );

  const totalTracked = useMemo(() => {
    return reviewedManuscripts.length;
  }, [reviewedManuscripts]);

  // Filter and sort stream
  const visibleManuscripts = useMemo(() => {
    let result = reviewedManuscripts;

    if (filter === 'ACTION') {
      result = result.filter(
        (item) => item.status === 'NEEDS_REVISION' || (item.status === 'DRAFT' && item.reviews?.some((review) => review.decision === 'NEEDS_REVISION')),
      );
    } else if (filter === 'REVIEW') {
      result = result.filter((item) => item.status === 'UNDER_REVIEW');
    } else if (filter === 'APPROVED') {
      result = result.filter(
        (item) =>
          item.status === 'APPROVED' ||
          item.status === 'PUBLISHED' ||
          (item.status !== 'UNDER_REVIEW' && item.reviews?.some((review) => review.decision === 'APPROVED')),
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.discipline?.toLowerCase().includes(q) ||
          item.reviews?.some((r) => r.reviewer_name?.toLowerCase().includes(q)),
      );
    }

    return [...result].sort((a, b) => {
      if (sortBy === 'TITLE') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'REVIEWER') {
        const nameA = a.reviews?.[0]?.reviewer_name || '';
        const nameB = b.reviews?.[0]?.reviewer_name || '';
        return nameA.localeCompare(nameB);
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [filter, reviewedManuscripts, searchQuery, sortBy]);

  const isAllExpanded = useMemo(() => {
    return visibleManuscripts.length > 0 && visibleManuscripts.every((m) => expandedManuscripts[m.id]);
  }, [visibleManuscripts, expandedManuscripts]);

  const toggleAll = () => {
    if (isAllExpanded) {
      setExpandedManuscripts({});
    } else {
      const next: Record<string, boolean> = {};
      visibleManuscripts.forEach((m) => {
        next[m.id] = true;
      });
      setExpandedManuscripts(next);
    }
  };

  return (
    <StudentShell title={t('nav.mentorFeedback')} showStandardHeader={false}>
      {/* 1. Filter Toolbar */}
      <div className="student-filter-toolbar" style={{ marginBottom: 16 }}>
        {/* Status Tab Pills */}
        <div className="student-tabs-pills" role="tablist" aria-label={t('student.preprints.filterStatus')}>
          <button
            type="button"
            className={`student-tab-pill ${filter === 'ALL' ? 'student-tab-pill--active' : ''}`}
            onClick={() => setFilter('ALL')}
          >
            {t('common.all')} <span className="student-tab-pill__count">{totalTracked}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${filter === 'REVIEW' ? 'student-tab-pill--active' : ''}`}
            onClick={() => setFilter('REVIEW')}
          >
            {t('student.preprints.underReview')} <span className="student-tab-pill__count">{reviewCount}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${filter === 'ACTION' ? 'student-tab-pill--active student-tab-pill--alert' : ''}`}
            onClick={() => setFilter('ACTION')}
          >
            {t('student.preprints.needsRevision')} <span className="student-tab-pill__count">{actionCount}</span>
          </button>
          <button
            type="button"
            className={`student-tab-pill ${filter === 'APPROVED' ? 'student-tab-pill--active' : ''}`}
            onClick={() => setFilter('APPROVED')}
          >
            {t('student.preprints.approved')} <span className="student-tab-pill__count">{approvedCount}</span>
          </button>
        </div>

        {/* Search & Sort Actions */}
        <div className="student-toolbar-actions">
          <div className="student-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder={t('common.searchFeedback')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="student-search-input"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="student-search-clear">
                ×
              </button>
            )}
          </div>

          <div className="student-sort-box">
            <span className="student-sort-label">{t('common.sortBy')}</span>
            <SortDropdown
              value={sortBy}
              onChange={(val) => setSortBy(val as SortOption)}
              options={[
                { value: 'UPDATED', label: t('common.recentlyUpdated') },
                { value: 'TITLE', label: t('common.titleAZ') },
                { value: 'REVIEWER', label: locale === 'vi' ? 'Tên người phản biện' : 'Reviewer Name' },
              ]}
              style={{ width: '160px' }}
            />
          </div>

          <button
            type="button"
            onClick={toggleAll}
            className="student-btn student-btn--secondary student-btn--sm"
            style={{ height: '36px', whiteSpace: 'nowrap' }}
            aria-label={isAllExpanded ? (locale === 'vi' ? 'Thu gọn tất cả bản thảo' : 'Collapse all manuscripts') : (locale === 'vi' ? 'Mở rộng tất cả bản thảo' : 'Expand all manuscripts')}
          >
            <span>{isAllExpanded ? (locale === 'vi' ? 'Thu gọn tất cả' : 'Collapse all') : (locale === 'vi' ? 'Mở rộng tất cả' : 'Expand all')}</span>
          </button>
        </div>
      </div>

      {/* 2. Feedback Stream Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {listLoading || reviewsLoading ? (
          <FeedbackCardSkeleton count={3} />
        ) : listError || reviewsError ? (
          <div className="student-error" role="alert">
            Lỗi: {(listError || reviewsError)?.message}
          </div>
        ) : visibleManuscripts.length === 0 ? (
          /* 3. Empty State */
          <div className="student-empty-card">
            <div className="student-empty-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
            <h3>
              {searchQuery
                ? 'Không tìm thấy đánh giá phù hợp'
                : filter === 'ACTION'
                ? 'Không có yêu cầu chỉnh sửa nào đang chờ'
                : filter === 'REVIEW'
                ? 'Không có bản thảo nào đang được thẩm định'
                : filter === 'APPROVED'
                ? 'Không tìm thấy bản thảo đã duyệt'
                : 'Chưa có phản hồi từ người phản biện'}
            </h3>
            <p>
              {searchQuery
                ? `Không tìm thấy nhận xét hoặc bản thảo nào khớp với "${searchQuery}". Hãy thử từ khóa khác.`
                : filter === 'ACTION'
                ? 'Tất cả các yêu cầu chỉnh sửa từ giảng viên đã được giải quyết hoặc gửi lại. Chúc mừng bạn đã duy trì tiến độ nghiên cứu tốt!'
                : filter === 'REVIEW'
                ? 'Hiện tại bạn không có bản thảo nào trong hàng đợi đánh giá của khoa. Hãy nộp bản thảo mới để bắt đầu quy trình bình duyệt.'
                : filter === 'APPROVED'
                ? 'Các bản thảo được giảng viên hướng dẫn phê duyệt sẽ hiển thị tại đây khi hoàn tất.'
                : 'Khi bạn nộp bản thảo, giảng viên hướng dẫn được phân công sẽ đánh giá preprint, đưa ra các ghi chú mang tính xây dựng và phản hồi các mục cần chỉnh sửa trong vòng 48–72 giờ.'}
            </p>
            <div className="student-empty-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href="/student/my-preprints" className="student-btn student-btn--secondary">
                Xem bản thảo của tôi
              </Link>
              <Link href="/student/my-preprints/new" className="student-btn student-btn--primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Bắt đầu nộp bản thảo mới</span>
              </Link>
            </div>
          </div>
        ) : (
          visibleManuscripts.map((manuscript) => {
            const isExpanded = Boolean(expandedManuscripts[manuscript.id]);
            const isCurrentlyUnderReview = manuscript.status === 'UNDER_REVIEW';
            const submittedReviews = (manuscript.reviews || [])
              .filter((r) => r.decision !== 'PENDING' && (r.comments || r.decision) && r.assignmentRole !== 'SECONDARY')
              .sort((a, b) => (b.round || 1) - (a.round || 1));
            const currentVersionReview = submittedReviews.find((r) => (r.round || 1) === manuscript.current_version);
            const priorReviews = submittedReviews.filter((r) => (r.round || 1) < manuscript.current_version);

            // Awaiting assignment by admin (no supervisor assigned, no reviews submitted)
            const isAwaitingAssignment = isCurrentlyUnderReview && !manuscript.supervisor && submittedReviews.length === 0;

            // Evaluating in progress by assigned supervisor
            const isCurrentRoundEvaluating = isCurrentlyUnderReview && !currentVersionReview && Boolean(manuscript.supervisor);

            // Completed evaluation exists (either for current version or latest available)
            const latestReview = currentVersionReview || submittedReviews[0];

            const primaryReviewerName = manuscript.supervisor || latestReview?.reviewer_name || 'Giảng viên hướng dẫn';
            const primaryReviewerInitials = getInitials(primaryReviewerName);

            // Header badge renderer
            const renderHeaderBadge = () => {
              if (isAwaitingAssignment) {
                return (
                  <span className="user-badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                    CHỜ PHÂN CÔNG
                  </span>
                );
              }
              if (isCurrentRoundEvaluating) {
                return <span className="user-badge user-badge--review">ĐANG THẨM ĐỊNH</span>;
              }
              if (latestReview) {
                const needsRevision = manuscript.status === 'NEEDS_REVISION' || latestReview.decision === 'NEEDS_REVISION';
                const isApproved = manuscript.status === 'APPROVED' || manuscript.status === 'PUBLISHED' || latestReview.decision === 'APPROVED';
                const isRejected = manuscript.status === 'REJECTED' || latestReview.decision === 'REJECTED';
                return (
                  <span className={`user-badge ${needsRevision ? 'user-badge--revision' : isApproved ? 'user-badge--approved' : isRejected ? 'user-badge--withdrawn' : 'user-badge--review'}`}>
                    {needsRevision ? 'CẦN CHỈNH SỬA' : isApproved ? (manuscript.status === 'PUBLISHED' ? 'ĐÃ XUẤT BẢN' : 'ĐÃ DUYỆT') : isRejected ? 'ĐÃ TỪ CHỐI' : 'ĐANG THẨM ĐỊNH'}
                  </span>
                );
              }
              if (manuscript.status === 'PUBLISHED') {
                return <span className="user-badge user-badge--approved">ĐÃ XUẤT BẢN</span>;
              }
              if (manuscript.status === 'APPROVED') {
                return <span className="user-badge user-badge--approved">ĐÃ DUYỆT</span>;
              }
              return <span className="user-badge user-badge--review">ĐANG THẨM ĐỊNH</span>;
            };

            return (
              <article key={manuscript.id} className="mentor-feedback-card mentor-feedback-card--review">
                {/* Unified Header with Title and Accordion Toggle */}
                <div
                  className="mentor-feedback-card__manuscript"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px',
                    flexWrap: 'nowrap',
                    borderBottom: isExpanded ? '1px solid #f1f5f9' : 'none',
                    paddingBottom: isExpanded ? '12px' : '0',
                    marginBottom: isExpanded ? '12px' : '0',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 className="mentor-feedback-card__title">
                      <Link href={`/student/my-preprints/${manuscript.id}`} title={manuscript.title}>
                        {manuscript.title}
                      </Link>
                    </h3>
                    <div className="mentor-feedback-card__tags" style={{ marginTop: '6px' }}>
                      <span className="mentor-version-tag">v{manuscript.current_version}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    {renderHeaderBadge()}
                    <Link
                      href={`/student/my-preprints/${manuscript.id}`}
                      className="student-btn student-btn--secondary student-btn--sm"
                    >
                      Xem chi tiết
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleManuscript(manuscript.id)}
                      className={`archive-toggle-btn ${isExpanded ? 'archive-toggle-btn--expanded' : ''}`}
                      title={isExpanded ? 'Thu gọn nhận xét' : 'Mở rộng xem nhận xét'}
                      aria-label="Thu gọn hoặc mở rộng nhận xét"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Collapsible Content Body */}
                {isExpanded && (
                  <div className="mentor-feedback-card__body">
                    {/* State 1: Awaiting assignment by admin */}
                    {isAwaitingAssignment && (
                      <div className="mentor-version-sections">
                        <div className="mentor-version-section mentor-version-section--active">
                          <div className="mentor-version-section__header">
                            <div className="mentor-version-section__info">
                              <div className="reviewer-avatar-circle" style={{ width: '32px', height: '32px', fontSize: '12px', background: '#64748b' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="10" />
                                  <polyline points="12 6 12 12 16 14" />
                                </svg>
                              </div>
                              <div>
                                <h4 className="mentor-feedback-card__name">Chờ phân công giảng viên</h4>
                                <p className="mentor-feedback-card__meta">Ban biên tập đang rà soát chuyên môn</p>
                              </div>
                            </div>
                            <span className="mentor-version-tag" style={{ color: '#92400e', background: '#fef3c7', fontWeight: 700 }}>
                              Phiên bản v{manuscript.current_version} · CHỜ PHÂN CÔNG
                            </span>
                          </div>
                          <p className="mentor-version-section__desc">
                            Bản thảo (Phiên bản v{manuscript.current_version}) đã được nộp thành công lên hệ thống. Ban biên tập đang tiến hành rà soát để phân công giảng viên phù hợp.
                          </p>
                        </div>

                        {priorReviews.length > 0 && (
                          priorReviews.map((prevRev) => (
                            <div key={prevRev.id} className="mentor-version-section mentor-version-section--history">
                              <div className="mentor-version-section__header">
                                <div className="mentor-version-section__info">
                                  <div className="reviewer-avatar-circle" style={{ width: '32px', height: '32px', fontSize: '12px', background: '#f59e0b' }}>
                                    {getInitials(prevRev.reviewer_name)}
                                  </div>
                                  <div>
                                    <h4 className="mentor-feedback-card__name">{prevRev.reviewer_name}</h4>
                                    <p className="mentor-feedback-card__meta">
                                      Đã đánh giá {new Date(prevRev.created_at).toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                                    </p>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span className="mentor-version-tag">Phiên bản v{prevRev.round || 1} (Vòng trước)</span>
                                  <span className={`user-badge ${prevRev.decision === 'NEEDS_REVISION' ? 'user-badge--revision' : prevRev.decision === 'APPROVED' ? 'user-badge--approved' : 'user-badge--review'}`}>
                                    {prevRev.decision === 'NEEDS_REVISION' ? 'CẦN CHỈNH SỬA' : prevRev.decision === 'APPROVED' ? 'ĐÃ DUYỆT' : 'ĐÃ TỪ CHỐI'}
                                  </span>
                                </div>
                              </div>

                              <h5 className="mentor-feedback-card__subheading">Nhận xét của giảng viên:</h5>
                              <FeedbackCommentBubble
                                comment={prevRev.comments || 'Giảng viên yêu cầu cập nhật và chỉnh sửa bản thảo.'}
                              />

                              {prevRev.recommendations && prevRev.recommendations.length > 0 && (
                                <div className="mentor-action-items" style={{ margin: 0 }}>
                                  <strong className="mentor-action-items__title">Các hạng mục cần hành động &amp; chỉnh sửa:</strong>
                                  <ul className="mentor-action-items__list">
                                    {prevRev.recommendations.map((rec, idx) => (
                                      <li key={idx}>{rec}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* State 2: Active Round Evaluation In-Progress */}
                    {isCurrentRoundEvaluating && (
                      <div className="mentor-version-sections">
                        {/* Current version actively being reviewed */}
                        <div className="mentor-version-section mentor-version-section--active">
                          <div className="mentor-version-section__header">
                            <div className="mentor-version-section__info">
                              <div className="reviewer-avatar-circle" style={{ width: '32px', height: '32px', fontSize: '12px' }}>
                                {primaryReviewerInitials}
                              </div>
                              <div>
                                <h4 className="mentor-feedback-card__name">{primaryReviewerName}</h4>
                                <p className="mentor-feedback-card__meta">Phụ trách thẩm định</p>
                              </div>
                            </div>
                            <span className="mentor-version-tag" style={{ color: '#0369a1', background: '#e0f2fe', fontWeight: 700 }}>
                              Phiên bản v{manuscript.current_version} · ĐANG THẨM ĐỊNH
                            </span>
                          </div>
                          <p className="mentor-version-section__desc">
                            Bản thảo (Phiên bản {manuscript.current_version}) đã được phân công cho <strong>{primaryReviewerName}</strong>. Giảng viên đang tiến hành thẩm định và đánh giá nội dung.
                          </p>
                        </div>

                        {/* Prior evaluated rounds */}
                        {priorReviews.length > 0 && (
                          priorReviews.map((prevRev) => (
                            <div key={prevRev.id} className="mentor-version-section mentor-version-section--history">
                              <div className="mentor-version-section__header">
                                <div className="mentor-version-section__info">
                                  <div className="reviewer-avatar-circle" style={{ width: '32px', height: '32px', fontSize: '12px', background: '#f59e0b' }}>
                                    {getInitials(prevRev.reviewer_name)}
                                  </div>
                                  <div>
                                    <h4 className="mentor-feedback-card__name">{prevRev.reviewer_name}</h4>
                                    <p className="mentor-feedback-card__meta">
                                      Đã đánh giá {new Date(prevRev.created_at).toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                                    </p>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span className="mentor-version-tag">Phiên bản v{prevRev.round || 1} (Vòng trước)</span>
                                  <span className={`user-badge ${prevRev.decision === 'NEEDS_REVISION' ? 'user-badge--revision' : prevRev.decision === 'APPROVED' ? 'user-badge--approved' : 'user-badge--review'}`}>
                                    {prevRev.decision === 'NEEDS_REVISION' ? 'CẦN CHỈNH SỬA' : prevRev.decision === 'APPROVED' ? 'ĐÃ DUYỆT' : 'ĐÃ TỪ CHỐI'}
                                  </span>
                                </div>
                              </div>

                              <h5 className="mentor-feedback-card__subheading">Nhận xét của giảng viên:</h5>
                              <FeedbackCommentBubble
                                comment={prevRev.comments || 'Giảng viên yêu cầu cập nhật và chỉnh sửa bản thảo.'}
                              />

                              {prevRev.recommendations && prevRev.recommendations.length > 0 && (
                                <div className="mentor-action-items" style={{ margin: 0 }}>
                                  <strong className="mentor-action-items__title">Các hạng mục cần hành động &amp; chỉnh sửa:</strong>
                                  <ul className="mentor-action-items__list">
                                    {prevRev.recommendations.map((rec, idx) => (
                                      <li key={idx}>{rec}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* State 3: Finalized review(s) available */}
                    {!isAwaitingAssignment && !isCurrentRoundEvaluating && submittedReviews.length > 0 && (
                      <div className="mentor-version-sections">
                        {submittedReviews.map((rev, idx) => {
                          const isLatest = idx === 0;
                          const isPrior = !isLatest;
                          const roundNum = rev.round || (isLatest ? manuscript.current_version : 1);

                          return (
                            <div
                              key={rev.id || idx}
                              className={`mentor-version-section ${isPrior ? 'mentor-version-section--history' : 'mentor-version-section--active'}`}
                              style={{
                                background: isPrior ? '#f8fafc' : '#ffffff',
                                border: '1px solid #e2e8f0',
                              }}
                            >
                              <div className="mentor-version-section__header">
                                <div className="mentor-version-section__info">
                                  <div
                                    className="reviewer-avatar-circle"
                                    style={{
                                      width: '32px',
                                      height: '32px',
                                      fontSize: '12px',
                                      background: isPrior ? '#64748b' : '#0071bc',
                                    }}
                                  >
                                    {getInitials(rev.reviewer_name)}
                                  </div>
                                  <div>
                                    <h4 className="mentor-feedback-card__name">{rev.reviewer_name}</h4>
                                    <p className="mentor-feedback-card__meta">
                                      Đã đánh giá {new Date(rev.created_at).toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                                    </p>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span
                                    className="mentor-version-tag"
                                    style={
                                      isPrior
                                        ? { color: '#64748b', background: '#f1f5f9' }
                                        : { color: '#0369a1', background: '#e0f2fe', fontWeight: 700 }
                                    }
                                  >
                                    Phiên bản v{roundNum}{isPrior ? ' (Vòng trước)' : ''}
                                  </span>
                                  <span
                                    className={`user-badge ${
                                      rev.decision === 'NEEDS_REVISION'
                                        ? 'user-badge--revision'
                                        : rev.decision === 'APPROVED'
                                          ? 'user-badge--approved'
                                          : rev.decision === 'REJECTED'
                                            ? 'user-badge--withdrawn'
                                            : 'user-badge--review'
                                    }`}
                                  >
                                    {rev.decision === 'NEEDS_REVISION'
                                      ? 'CẦN CHỈNH SỬA'
                                      : rev.decision === 'APPROVED'
                                        ? 'ĐÃ DUYỆT'
                                        : rev.decision === 'REJECTED'
                                          ? 'ĐÃ TỪ CHỐI'
                                          : 'ĐANG THẨM ĐỊNH'}
                                  </span>
                                </div>
                              </div>

                              <h5 className="mentor-feedback-card__subheading">Nhận xét của giảng viên:</h5>
                              <FeedbackCommentBubble
                                comment={rev.comments || 'Giảng viên không để lại nhận xét bổ sung.'}
                              />

                              {rev.recommendations && rev.recommendations.length > 0 && (
                                <div className="mentor-action-items">
                                  <strong className="mentor-action-items__title">Các hạng mục cần hành động &amp; chỉnh sửa:</strong>
                                  <ul className="mentor-action-items__list">
                                    {rev.recommendations.map((rec, rIdx) => (
                                      <li key={rIdx}>{rec}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {isLatest && rev.decision === 'NEEDS_REVISION' && (
                                <div className="mentor-feedback-card__actions" style={{ marginTop: '12px' }}>
                                  <Link
                                    href={`/student/my-preprints/${manuscript.id}/edit`}
                                    className="student-btn student-btn--primary"
                                    style={{ background: '#d97706', borderColor: '#d97706' }}
                                  >
                                    Mở trình chỉnh sửa bản thảo →
                                  </Link>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* State 4: Approved/Published without separate review cards */}
                    {!isAwaitingAssignment && !isCurrentRoundEvaluating && submittedReviews.length === 0 && (
                      <div className="mentor-version-sections">
                        <div className="mentor-version-section mentor-version-section--active" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
                          <div className="mentor-version-section__header">
                            <div className="mentor-version-section__info">
                              <div className="reviewer-avatar-circle" style={{ width: '32px', height: '32px', fontSize: '12px', background: '#10b981' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </div>
                              <div>
                                <h4 className="mentor-feedback-card__name">
                                  {manuscript.status === 'PUBLISHED' ? 'Bản thảo đã xuất bản thành công' : 'Bản thảo đã được phê duyệt'}
                                </h4>
                                <p className="mentor-feedback-card__meta">
                                  {manuscript.status === 'PUBLISHED' ? 'Đã công bố trên kho bài báo' : 'Sẵn sàng để xuất bản'}
                                </p>
                              </div>
                            </div>
                            <span className="mentor-version-tag" style={{ color: '#047857', background: '#d1fae5', fontWeight: 700 }}>
                              Phiên bản v{manuscript.current_version} · {manuscript.status === 'PUBLISHED' ? 'ĐÃ XUẤT BẢN' : 'ĐÃ DUYỆT'}
                            </span>
                          </div>
                          <p className="mentor-version-section__desc" style={{ marginTop: '12px', color: '#475569', fontSize: '13.5px', lineHeight: '1.6' }}>
                            {manuscript.status === 'PUBLISHED'
                              ? 'Bản thảo nghiên cứu của bạn đã hoàn thành quy trình thẩm định chuyên môn và đã được xuất bản chính thức.'
                              : 'Bản thảo nghiên cứu của bạn đã được giảng viên thẩm định thông qua và chấp thuận.'}
                          </p>
                          <div className="mentor-feedback-card__actions" style={{ marginTop: '14px' }}>
                            <Link
                              href={`/student/my-preprints/${manuscript.id}`}
                              className="student-btn student-btn--secondary student-btn--sm"
                            >
                              Xem chi tiết bản thảo →
                            </Link>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </StudentShell>
  );
}

export default StudentMentorFeedbackView;
