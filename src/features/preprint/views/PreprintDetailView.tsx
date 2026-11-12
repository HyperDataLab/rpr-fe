'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { StudentShell } from '../components';
import { LecturerShell } from '@/features/lecturer/components';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { usePreprintDetail } from '../hooks';
import { studentPreprintApi } from '../api';
import type { PreprintStatus } from '@/shared/types';
import { DetailSkeleton } from '@/components/skeleton';
import { useTranslation } from '@/i18n';
import { ExpandableAbstract } from '@/shared/components';

const NativePdfViewer = dynamic(
  () => import('../components/NativePdfViewer').then((mod) => mod.NativePdfViewer),
  {
    ssr: false,
    loading: () => (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '400px' }}>
        <div className="student-spinner" />
      </div>
    ),
  },
);


interface PreprintDetailViewProps {
  id: string;
}

type TabType = 'OVERVIEW' | 'PDF_VIEW' | 'REVIEWS' | 'TIMELINE';

function PreprintDetailShell({
  isLecturer,
  title,
  children,
}: {
  isLecturer: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return isLecturer ? (
    <LecturerShell active="submissions" title={title}>
      {children}
    </LecturerShell>
  ) : (
    <StudentShell title={title} showStandardHeader={false}>
      {children}
    </StudentShell>
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

export function PreprintDetailView({ id }: PreprintDetailViewProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const isLecturer = user?.role === 'LECTURER' || (pathname?.startsWith('/lecturer/') ?? false);
  const isPublishedSection = pathname?.startsWith('/student/published') ?? false;
  const workspacePath = isPublishedSection
    ? '/student/published'
    : isLecturer
    ? '/lecturer/submissions'
    : '/student/my-preprints';
  const editPath = `${workspacePath}/${id}/edit`;
  const versionsPath = `${workspacePath}/${id}/versions`;

  const { item, loading, error } = usePreprintDetail(id);
  const activeDownloadUrl = item?.download_url || item?.versions?.find((v) => v.is_current)?.download_url || item?.versions?.[0]?.download_url;
  const [activeTab, setActiveTab] = useState<TabType>('OVERVIEW');
  const [copiedDoi, setCopiedDoi] = useState(false);
  const [pdfExpanded, setPdfExpanded] = useState(false);
  const [showAllAuthors, setShowAllAuthors] = useState(false);

  const router = useRouter();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteDraft = async () => {
    if (!item || item.status !== 'DRAFT') return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await studentPreprintApi.delete(item.id);
      setShowDeleteModal(false);
      router.push(workspacePath);
      router.refresh();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Không thể xóa bản nháp.');
      setIsDeleting(false);
    }
  };

  const handleCopyDoi = () => {
    if (!item?.doi) return;
    navigator.clipboard.writeText(item.doi);
    setCopiedDoi(true);
    setTimeout(() => setCopiedDoi(false), 2000);
  };

  // Deduplicate institutions for the author byline
  const { uniqueAffiliations, authorAffiliationIndices } = useMemo(() => {
    if (!item?.authors || item.authors.length === 0) {
      return { uniqueAffiliations: [], authorAffiliationIndices: [] };
    }
    const affiliations: string[] = [];
    const indices: number[] = [];

    item.authors.forEach((author) => {
      const inst = author.institution?.trim() || 'Học giả độc lập';
      let idx = affiliations.indexOf(inst);
      if (idx === -1) {
        affiliations.push(inst);
        idx = affiliations.length - 1;
      }
      indices.push(idx + 1);
    });

    return { uniqueAffiliations: affiliations, authorAffiliationIndices: indices };
  }, [item?.authors]);

  const renderStatusBadge = (status: PreprintStatus) => {
    switch (status) {
      case 'PUBLISHED':
        return (
          <span className="student-status-badge student-status-badge--published">
            <span className="student-status-dot" />
            Đã xuất bản
          </span>
        );
      case 'APPROVED':
        return (
          <span className="student-status-badge student-status-badge--approved">
            <span className="student-status-dot" />
            Đã duyệt
          </span>
        );
      case 'NEEDS_REVISION':
        return (
          <span className="student-status-badge student-status-badge--revision">
            <span className="student-status-dot" />
            Cần chỉnh sửa
          </span>
        );
      case 'UNDER_REVIEW':
        return (
          <span className="student-status-badge student-status-badge--review">
            <span className="student-status-dot" />
            Đang thẩm định
          </span>
        );
      case 'DRAFT':
        return (
          <span className="student-status-badge student-status-badge--draft">
            <span className="student-status-dot" />
            Bản nháp
          </span>
        );
      case 'WITHDRAWN':
        return (
          <span className="student-status-badge student-status-badge--withdrawn">
            <span className="student-status-dot" />
            Đã rút
          </span>
        );
      default:
        return (
          <span className="student-status-badge">
            <span className="student-status-dot" />
            {status}
          </span>
        );
    }
  };

  const { t } = useTranslation();
  const shellTitle = item?.title
    ? (item.title.length > 35 ? item.title.substring(0, 35) + '…' : item.title)
    : t('student.preprints.detailsTitle');

  return (
    <PreprintDetailShell isLecturer={isLecturer} title={shellTitle}>
      {loading && <DetailSkeleton />}

      {error && (
        <div className="student-error-banner">
          <strong>Không thể tải bản thảo:</strong> {error.message}
        </div>
      )}

      {item && (
        <div className="student-detail-wrap">
          {/* 1. Hero Article Header */}
          <section className="student-paper-hero">
            <h1 className="student-paper-hero__title">{item.title}</h1>

            {/* Authors Byline */}
            {item.authors && item.authors.length > 0 && (
              <div className="student-paper-hero__byline">
                <div className="student-paper-hero__authors-wrap">
                  {(showAllAuthors ? item.authors : item.authors.slice(0, 3)).map((author, index) => {
                    const affIdx = authorAffiliationIndices[index] || 1;
                    const isLastVisible = index === (showAllAuthors ? item.authors.length : Math.min(3, item.authors.length)) - 1;
                    return (
                      <span key={index} className="student-paper-hero__author">
                        <span className="student-paper-hero__author-name">{author.name}</span>
                        <sup className="student-paper-hero__author-sup">{affIdx}</sup>
                        {author.isPrimary && <span className="student-author-tag student-author-tag--primary">Tác giả chính</span>}
                        {author.isCorresponding && (
                          <span className="student-author-tag student-author-tag--corr" title={`Tác giả liên hệ: ${author.email}`}>
                            ✉
                          </span>
                        )}
                        {!isLastVisible && <span className="student-paper-hero__sep">,</span>}
                      </span>
                    );
                  })}

                  {item.authors.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setShowAllAuthors(!showAllAuthors)}
                      style={{
                        marginLeft: '8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'none',
                        border: 'none',
                        padding: '2px 0',
                        cursor: 'pointer',
                        color: '#64748b',
                        fontSize: '12px',
                        fontWeight: 500,
                        verticalAlign: 'middle',
                      }}
                    >
                      <span>{showAllAuthors ? 'Thu gọn' : 'Xem chi tiết'}</span>
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: showAllAuthors ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease',
                        }}
                        aria-hidden="true"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Deduplicated Affiliation Footnotes */}
                {uniqueAffiliations.length > 0 && (
                  <div className="student-paper-hero__affiliations">
                    {uniqueAffiliations.map((aff, idx) => (
                      <span key={idx} className="student-paper-hero__aff-item">
                        <sup>{idx + 1}</sup> {aff}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Metadata Strip & Quick Actions */}
            <div className="student-paper-hero__meta-row">
              <div className="student-paper-hero__badges">
                {renderStatusBadge(item.status)}
                <span className="student-version-tag">Phiên bản {item.current_version}</span>
                {/* Card CC BY 4.0 removed per user request */}
                {item.doi && (
                  <button type="button" onClick={handleCopyDoi} className="student-doi-pill" title="Nhấp để sao chép DOI">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>DOI: {item.doi}</span>
                    {copiedDoi && <span className="student-doi-copied">Đã sao chép!</span>}
                  </button>
                )}
                <span className="student-paper-hero__date">
                  Cập nhật ngày {new Date(item.updated_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>

              <div className="student-paper-hero__actions">
                {activeDownloadUrl ? (
                  <a href={activeDownloadUrl} target="_blank" rel="noreferrer" className="student-btn student-btn--primary">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Tải tệp PDF</span>
                  </a>
                ) : (
                  <button type="button" className="student-btn student-btn--secondary" disabled style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                    <span>Đang xử lý PDF</span>
                  </button>
                )}

                <Link href={versionsPath} className="student-btn student-btn--ghost">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 14 14" />
                  </svg>
                  <span>Lịch sử phiên bản ({item.versions?.length || 1})</span>
                </Link>

                {item.status === 'NEEDS_REVISION' && (
                  <Link href={editPath} className="student-btn student-btn--warning">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <span>Chỉnh sửa bản thảo →</span>
                  </Link>
                )}

                {item.status === 'DRAFT' && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <Link href={editPath} className="student-btn student-btn--primary">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      <span>Tiếp tục bản nháp →</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(true)}
                      className="student-btn student-btn--danger"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        backgroundColor: '#fff',
                        color: '#dc2626',
                        borderColor: '#fca5a5',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                      <span>Xóa bản nháp</span>
                    </button>
                  </div>
                )}

                {(item.status === 'PUBLISHED' || item.status === 'APPROVED') && (
                  <Link
                    href={editPath}
                    className="student-btn student-btn--secondary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      borderColor: '#0071bc',
                      color: '#0071bc',
                      fontWeight: 700,
                    }}
                    title="Chỉnh sửa thông tin bài báo hoặc tải lên phiên bản mới"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <span>Cập nhật bài báo</span>
                  </Link>
                )}
              </div>
            </div>
          </section>

          {/* If Needs Revision: Alert Banner */}
          {item.status === 'NEEDS_REVISION' && item.reviews?.[0] && (
            <div className="student-revision-banner student-revision-banner--detail" style={{ marginBottom: '24px' }}>
              <div className="student-revision-banner__header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <strong>Thông báo yêu cầu chỉnh sửa từ {item.reviews[0].reviewer_name}</strong>
              </div>
              <p className="student-revision-banner__comment">
                &ldquo;{item.reviews[0].comments}&rdquo;
              </p>
              <div className="student-revision-banner__action">
                <Link href={editPath} className="student-btn student-btn--warning student-btn--sm">
                  <span>Mở trình chỉnh sửa bản thảo →</span>
                </Link>
                <button type="button" onClick={() => setActiveTab('REVIEWS')} className="student-btn student-btn--ghost student-btn--sm">
                  Xem toàn bộ nhận xét &amp; đánh giá
                </button>
              </div>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="student-detail-tabs" role="tablist">
            <button
              type="button"
              className={`student-detail-tab ${activeTab === 'OVERVIEW' ? 'student-detail-tab--active' : ''}`}
              onClick={() => setActiveTab('OVERVIEW')}
            >
              Tổng quan
            </button>
            <button
              type="button"
              className={`student-detail-tab ${activeTab === 'PDF_VIEW' ? 'student-detail-tab--active' : ''}`}
              onClick={() => setActiveTab('PDF_VIEW')}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span>Xem tệp PDF</span>
              </span>
            </button>
            <button
              type="button"
              className={`student-detail-tab ${activeTab === 'REVIEWS' ? 'student-detail-tab--active' : ''}`}
              onClick={() => setActiveTab('REVIEWS')}
            >
              Đánh giá của giảng viên {item.reviews?.filter((r) => r.decision !== 'PENDING' && r.assignmentRole !== 'SECONDARY').length ? `(${item.reviews.filter((r) => r.decision !== 'PENDING' && r.assignmentRole !== 'SECONDARY').length})` : ''}
            </button>
            <button
              type="button"
              className={`student-detail-tab ${activeTab === 'TIMELINE' ? 'student-detail-tab--active' : ''}`}
              onClick={() => setActiveTab('TIMELINE')}
            >
              Lịch sử phiên bản
            </button>
          </div>

          {/* Tab 1: Overview & Metadata */}
          {activeTab === 'OVERVIEW' && (
            <div className="student-tab-panel" style={{ marginTop: '20px' }}>
              <div className="student-panel-grid">
                {/* Left Column: Abstract & Keywords & Document Box */}
                <div className="student-panel-main">
                  <section className="student-section-card">
                    <h3 className="student-section-card__title">Abstract</h3>
                    <ExpandableAbstract text={item.abstract} locale="vi" />

                    {item.keywords && item.keywords.length > 0 && (
                      <div className="student-keywords-wrap">
                        <span className="student-keywords-label">Từ khóa:</span>
                        {item.keywords.map((kw) => (
                          <span key={kw} className="student-keyword-pill">
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                {/* Right Column: Metadata Sidebar */}
                <div className="student-panel-sidebar">
                  <div className="student-meta-card">
                    <h4 className="student-meta-card__title">Thông tin bản thảo</h4>
                    <div className="student-meta-list">
                      <div className="student-meta-item">
                        <span className="student-meta-key">Trạng thái:</span>
                        <span className="student-meta-val">{renderStatusBadge(item.status)}</span>
                      </div>
                      <div className="student-meta-item">
                        <span className="student-meta-key">Phiên bản hiện tại:</span>
                        <span className="student-meta-val">v{item.current_version}</span>
                      </div>
                      <div className="student-meta-item">
                        <span className="student-meta-key">Lĩnh vực nghiên cứu:</span>
                        <span className="student-meta-val">{item.discipline || 'Tổng quát'}</span>
                      </div>
                      {item.supervisor && (
                        <div className="student-meta-item">
                          <span className="student-meta-key">GVHD hướng dẫn:</span>
                          <span className="student-meta-val">{item.supervisor}</span>
                        </div>
                      )}
                      <div className="student-meta-item">
                        <span className="student-meta-key">Giấy phép:</span>
                        <span className="student-meta-val">Creative Commons CC BY 4.0</span>
                      </div>
                      {item.doi && (
                        <div className="student-meta-item">
                          <span className="student-meta-key">Mã định danh DOI:</span>
                          <span className="student-meta-val student-meta-val--code">{item.doi}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Manuscript PDF Direct Reader */}
          {activeTab === 'PDF_VIEW' && (
            <div className="student-tab-panel" style={{ marginTop: '20px' }}>
              {activeDownloadUrl ? (
                <NativePdfViewer
                  url={activeDownloadUrl}
                  fileName={item.file_name || `${item.title?.substring(0, 50) || 'manuscript'}.pdf`}
                />
              ) : (
                <div className="student-empty-card" style={{ padding: '60px 20px' }}>
                  <div className="student-empty-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#647381" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  </div>
                  <h3>Không có bản xem trước PDF</h3>
                  <p>Tệp PDF bản thảo hiện đang được xử lý hoặc lưu trữ trên hệ thống đám mây.</p>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Faculty Mentorship & Reviews */}
          {activeTab === 'REVIEWS' && (() => {
            const primaryReviews = (item.reviews || []).filter((r) => r.assignmentRole !== 'SECONDARY');
            const finalizedPrimaryReviews = primaryReviews.filter((r) => r.decision !== 'PENDING');
            const currentRoundReview = finalizedPrimaryReviews.find((r) => (r.round || 1) === item.current_version);
            const hasCurrentRoundReview = Boolean(currentRoundReview);

            return (
              <div className="student-tab-panel" style={{ marginTop: '20px' }}>
                {/* Active Round Box: Only shown if current round is UNDER_REVIEW and does not already have a finalized review */}
                {item.status === 'UNDER_REVIEW' && !hasCurrentRoundReview && (
                  !item.supervisor ? (
                    /* State A: Manuscript submitted, awaiting admin to assign a lecturer */
                    <article className="student-review-card" style={{ background: '#ffffff', marginBottom: '20px' }}>
                      <div className="student-review-header">
                        <div className="student-reviewer-avatar" style={{ background: '#64748b' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        </div>
                        <div className="student-reviewer-info">
                          <div className="student-reviewer-name-row">
                            <strong>Chờ phân công giảng viên</strong>
                            <span className="student-reviewer-badge" style={{ background: '#f1f5f9', color: '#475569' }}>Ban biên tập</span>
                          </div>
                          <span className="student-review-date">
                            Phiên bản v{item.current_version} · Chờ tiếp nhận hồ sơ
                          </span>
                        </div>
                        <div className="student-review-decision">
                          <span className="user-badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>CHỜ PHÂN CÔNG</span>
                        </div>
                      </div>
                      <div className="student-review-body" style={{ marginTop: '10px' }}>
                        <h4 className="student-review-subheading" style={{ color: '#0f172a' }}>Hồ sơ đang chờ xử lý</h4>
                        <p className="student-review-text" style={{ fontStyle: 'normal', color: '#475569' }}>
                          Bản thảo <strong>(Phiên bản v{item.current_version})</strong> đã được gửi lên hệ thống thành công. Ban biên tập đang tiến hành rà soát chuyên môn để phân công giảng viên hướng dẫn phù hợp.
                        </p>
                      </div>
                    </article>
                  ) : (
                    /* State B: Lecturer assigned and currently evaluating */
                    <article className="student-review-card" style={{ background: '#ffffff', marginBottom: '20px' }}>
                      <div className="student-review-header">
                        <div className="student-reviewer-avatar" style={{ background: '#0071bc' }}>
                          {getInitials(item.supervisor)}
                        </div>
                        <div className="student-reviewer-info">
                          <div className="student-reviewer-name-row">
                            <strong>{item.supervisor}</strong>
                          </div>
                          <span className="student-review-date">
                            Phiên bản v{item.current_version} · Đang thẩm định vòng {item.current_version}
                          </span>
                        </div>
                        <div className="student-review-decision">
                          <span className="user-badge user-badge--review">ĐANG THẨM ĐỊNH</span>
                        </div>
                      </div>
                      <div className="student-review-body" style={{ marginTop: '10px' }}>
                        <h4 className="student-review-subheading" style={{ color: '#0f172a' }}>Vòng thẩm định hiện tại (Phiên bản v{item.current_version})</h4>
                        <p className="student-review-text" style={{ fontStyle: 'normal', color: '#334155' }}>
                          Bản thảo <strong>(Phiên bản v{item.current_version})</strong> đã được phân công cho giảng viên <strong>{item.supervisor}</strong>. Giảng viên đang tiến hành thẩm định và đánh giá nội dung.
                        </p>
                      </div>
                    </article>
                  )
                )}

                {finalizedPrimaryReviews.length > 0 ? (
                  <div className="student-reviews-feed">
                    {finalizedPrimaryReviews.map((rev) => {
                    const reviewerInitials = getInitials(rev.reviewer_name);
                    const isHistoricalRound = item.current_version > (rev.round || 1);

                    return (
                      <article key={rev.id} className="student-review-card">
                        <div className="student-review-header">
                          <div className="student-reviewer-avatar">
                            {reviewerInitials}
                          </div>
                          <div className="student-reviewer-info">
                            <div className="student-reviewer-name-row">
                              <strong>{rev.reviewer_name}</strong>
                              <span className="student-version-tag" style={{ marginLeft: '6px' }}>v{rev.round || 1}</span>
                            </div>
                            <span className="student-review-date">
                              Đánh giá ghi nhận ngày {new Date(rev.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                            </span>
                          </div>
                          <div className="student-review-decision">
                            {rev.decision === 'APPROVED' ? (
                              <span className="student-decision-badge student-decision-badge--approved">
                                Đã duyệt xuất bản
                              </span>
                            ) : (
                              <span className="student-decision-badge student-decision-badge--revision">
                                Yêu cầu chỉnh sửa
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="student-review-body">
                          <h4 className="student-review-subheading">Nhận xét của giảng viên</h4>
                          <p className="student-review-text">&ldquo;{rev.comments}&rdquo;</p>

                          {rev.recommendations && rev.recommendations.length > 0 && (
                            <div className="student-review-recommendations">
                              <h4 className="student-review-subheading">Các điểm cần chỉnh sửa cụ thể:</h4>
                              <ul className="student-review-checklist">
                                {rev.recommendations.map((rec, i) => (
                                  <li key={i} className="student-review-checklist-item">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="10" />
                                      <line x1="12" y1="8" x2="12" y2="12" />
                                      <line x1="12" y1="16" x2="12.01" y2="16" />
                                    </svg>
                                    <span>{rec}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        {rev.decision === 'NEEDS_REVISION' && !isHistoricalRound && (
                          <div className="student-review-footer-action">
                            <Link href={editPath} className="student-btn student-btn--warning">
                              <span>Mở biểu mẫu nộp bản sửa đổi (Tải lên bản thảo mới) →</span>
                            </Link>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : item.status !== 'UNDER_REVIEW' ? (
                <div className="student-empty-card">
                  <div className="student-empty-icon">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <h3>Chưa có nhận xét của giảng viên</h3>
                  <p>
                    Bản thảo hiện tại chưa có nhận xét đánh giá chính thức từ giảng viên hướng dẫn.
                  </p>
                </div>
              ) : null}
            </div>
          );
        })()}

          {/* Tab 4: Provenance & Timeline */}
          {activeTab === 'TIMELINE' && (
            <div className="student-tab-panel" style={{ marginTop: '20px' }}>
              <div className="student-timeline-card">
                <h3 className="student-timeline-title">Nhật ký kiểm toán &amp; Xác thực bản thảo</h3>
                <p className="student-timeline-desc">
                  Mọi lượt nộp, sự kiện đánh giá và thay đổi phiên bản đều được ghi nhận bất biến cùng dấu thời gian và mã băm xác thực.
                </p>

                <div className="student-timeline-list">
                  {item.timeline && item.timeline.length > 0 ? (
                    item.timeline.map((event, idx) => (
                      <div key={event.id || idx} className="student-timeline-item">
                        <div className="student-timeline-indicator">
                          <div className="student-timeline-dot" />
                          {idx < (item.timeline?.length || 1) - 1 && <div className="student-timeline-line" />}
                        </div>
                        <div className="student-timeline-content">
                          <div className="student-timeline-meta">
                            <span className="student-timeline-timestamp">
                              {new Date(event.timestamp).toLocaleString('vi-VN', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span className="student-timeline-actor">bởi {event.actor}</span>
                          </div>
                          <h4 className="student-timeline-heading">{event.title}</h4>
                          <p className="student-timeline-text">{event.description}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="student-muted">Chưa có sự kiện nào được ghi nhận.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showDeleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
          onClick={() => {
            if (!isDeleting) setShowDeleteModal(false);
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              maxWidth: '440px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: '#fee2e2',
                  color: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#0f172a' }}>
                  Xác nhận xóa bản nháp
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                  Hành động này không thể hoàn tác.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="student-error-banner" style={{ marginBottom: '16px', fontSize: '13px' }}>
                {deleteError}
              </div>
            )}

            <p style={{ fontSize: '14px', color: '#334155', lineHeight: 1.5, marginBottom: '20px' }}>
              Bạn có chắc chắn muốn xóa bản nháp <strong>&ldquo;{item?.title}&rdquo;</strong> khỏi hệ thống không?
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="student-btn student-btn--ghost"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                style={{ padding: '8px 16px', fontSize: '13.5px' }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="student-btn student-btn--danger"
                onClick={handleDeleteDraft}
                disabled={isDeleting}
                style={{
                  padding: '8px 18px',
                  fontSize: '13.5px',
                  backgroundColor: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  opacity: isDeleting ? 0.7 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isDeleting ? (
                  <>
                    <span className="spinner-border spinner-border-sm" style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span>Đang xóa...</span>
                  </>
                ) : (
                  <span>Xóa bản nháp</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </PreprintDetailShell>
  );
}

export default PreprintDetailView;
