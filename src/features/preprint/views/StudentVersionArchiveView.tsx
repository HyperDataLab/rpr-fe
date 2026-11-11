'use client';
 
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { StudentShell } from '../components';
import { TimelineSkeleton } from '@/components/skeleton';
import { SortDropdown } from '@/components/sort-dropdown';
import { usePreprintList } from '../hooks';
import { studentPreprintApi } from '../api';
import type { PreprintVersionInfo } from '../types';
import { useTranslation } from '@/i18n';
import { ProtectedPdfDownloadLink } from '../components/ProtectedPdfDownloadLink';

export function StudentVersionArchiveView() {
  const { t, locale } = useTranslation();
  const { items, loading: listLoading } = usePreprintList();
  const [selectedManuscriptId, setSelectedManuscriptId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [expandedManuscripts, setExpandedManuscripts] = useState<Record<string, boolean>>({});

  const {
    data: versionsByPublication = {},
    isLoading: versionsLoading,
    error: versionsQueryError,
  } = useQuery<Record<string, PreprintVersionInfo[]>>({
    queryKey: ['student-all-versions', items.map((i) => i.id).join(',')],
    queryFn: async () => {
      if (items.length === 0) return {};
      const results = await Promise.allSettled(
        items.map(async (item) => [item.id, await studentPreprintApi.versions(item.id)] as const),
      );
      const entries = results
        .filter((result): result is PromiseFulfilledResult<readonly [string, PreprintVersionInfo[]]> => result.status === 'fulfilled')
        .map((result) => result.value);
      return Object.fromEntries(entries);
    },
    enabled: !listLoading && items.length > 0,
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const versionsError = versionsQueryError ? (versionsQueryError as Error).message : null;

  const toggleManuscript = (id: string) => {
    setExpandedManuscripts((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const manuscriptsWithVersions = useMemo(() => {
    return items.map((item) => ({
      ...item,
      versions: versionsByPublication[item.id] || [],
    }));
  }, [items, versionsByPublication]);

  const filteredManuscripts = useMemo(() => {
    let list = selectedManuscriptId === 'ALL'
      ? manuscriptsWithVersions
      : manuscriptsWithVersions.filter((item) => item.id === selectedManuscriptId);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.discipline?.toLowerCase().includes(q) ||
          m.doi?.toLowerCase().includes(q) ||
          m.versions?.some(
            (v) =>
              v.sha256?.toLowerCase().includes(q) ||
              v.change_summary?.toLowerCase().includes(q) ||
              v.file_name?.toLowerCase().includes(q),
          ),
      );
    }
    return list;
  }, [manuscriptsWithVersions, selectedManuscriptId, searchQuery]);

  const isAllExpanded = useMemo(() => {
    if (filteredManuscripts.length === 0) return false;
    return filteredManuscripts.every((m) => expandedManuscripts[m.id]);
  }, [filteredManuscripts, expandedManuscripts]);

  const toggleAllCollapse = () => {
    if (isAllExpanded) {
      setExpandedManuscripts({});
    } else {
      const all: Record<string, boolean> = {};
      filteredManuscripts.forEach((m) => {
        all[m.id] = true;
      });
      setExpandedManuscripts(all);
    }
  };

  return (
    <StudentShell title={t('nav.versions')} showStandardHeader={false}>
      {/* 1. Filter & Search Toolbar */}
      <div className="student-filter-toolbar">
        {/* Left: Dropdown select manuscript */}
        <div className="student-sort-box" style={{ gap: '8px' }}>
          <span className="student-sort-label" style={{ fontWeight: 600, color: '#475569' }}>
            {t('student.preprints.tableManuscript')}:
          </span>
          <SortDropdown
            value={selectedManuscriptId}
            onChange={(val) => setSelectedManuscriptId(val)}
            options={[
              { value: 'ALL', label: locale === 'vi' ? `Tất cả bản thảo (${items.length})` : `All Manuscripts (${items.length})` },
              ...items.map((m) => ({
                value: m.id,
                label: m.title || (locale === 'vi' ? 'Bản thảo chưa đặt tên' : 'Untitled manuscript'),
              })),
            ]}
            style={{ width: '280px' }}
            ariaLabel={locale === 'vi' ? 'Lọc phiên bản theo bản thảo' : 'Filter versions by manuscript'}
          />
        </div>

        {/* Right: Search Input & Toggle All Button */}
        <div className="student-toolbar-actions">
          <div className="student-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder={t('common.searchArchive')}
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

          <button
            type="button"
            className="student-btn student-btn--secondary archive-toggle-all-btn"
            onClick={toggleAllCollapse}
            aria-label={isAllExpanded ? (locale === 'vi' ? 'Thu gọn tất cả phiên bản bản thảo' : 'Collapse all manuscript versions') : (locale === 'vi' ? 'Mở rộng tất cả phiên bản bản thảo' : 'Expand all manuscript versions')}
          >
            <span>{isAllExpanded ? (locale === 'vi' ? 'Thu gọn tất cả' : 'Collapse all') : (locale === 'vi' ? 'Mở rộng tất cả' : 'Expand all')}</span>
          </button>
        </div>
      </div>

      {/* 2. Version Lineages Content Stream */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {(listLoading || versionsLoading) && (
          <TimelineSkeleton count={3} />
        )}

        {versionsError && (
          <div className="student-error" role="alert">
            {versionsError}
          </div>
        )}

        {!listLoading && !versionsLoading && filteredManuscripts.length === 0 && (
          <div className="student-empty-card">
            <div className="student-empty-icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h3>
              {searchQuery ? 'Không tìm thấy phiên bản lưu trữ phù hợp' : 'Chưa có bản lưu trữ nào'}
            </h3>
            <p>
              {searchQuery
                ? `Không có lịch sử phiên bản nào khớp với "${searchQuery}". Hãy thử tìm kiếm theo tiêu đề, DOI hoặc mã băm SHA-256.`
                : 'Bạn chưa nộp bản thảo preprint nào. Hãy nộp bản thảo đầu tiên để xác lập dấu thời gian phiên bản mật mã và xuất xứ vĩnh viễn.'}
            </p>
            <div className="student-empty-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
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
        )}

        {!listLoading && !versionsLoading && filteredManuscripts.map((manuscript) => {
          const isExpanded = Boolean(expandedManuscripts[manuscript.id]);

          return (
            <article key={manuscript.id} className="archive-manuscript-card">
              {/* Manuscript Header */}
              <div className="archive-manuscript-header">
                <div className="archive-manuscript-meta">
                  <h3 className="archive-manuscript-title">
                    <Link href={`/student/my-preprints/${manuscript.id}`} title={manuscript.title}>
                      {manuscript.title}
                    </Link>
                  </h3>
                  <div className="archive-manuscript-subinfo">
                    {manuscript.doi && (
                      <>
                        <span>
                          <strong>DOI:</strong> {manuscript.doi}
                        </span>
                        <span className="archive-subinfo-bullet">&bull;</span>
                      </>
                    )}
                    <span>
                      {manuscript.versions?.length || 0} phiên bản lưu trữ vĩnh viễn
                    </span>
                  </div>
                </div>

                <div className="archive-manuscript-actions">
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
                    title={isExpanded ? 'Thu gọn các phiên bản' : 'Mở rộng các phiên bản'}
                    aria-label="Thu gọn hoặc mở rộng danh sách phiên bản"
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

              {/* Version Lineage Timeline (Git-Style Lineage) */}
              {isExpanded && (
                <div className="archive-git-timeline">
                  {manuscript.versions && manuscript.versions.length > 0 ? (
                    manuscript.versions.map((ver, idx) => {
                      const isLatest = idx === 0;

                      return (
                        <div
                          key={ver.version}
                          className={`archive-git-entry ${isLatest ? 'archive-git-entry--latest' : ''}`}
                        >
                          {/* Git Node */}
                          <div className="archive-git-node">
                            v{ver.version}
                          </div>

                          {/* Git Body */}
                          <div className="archive-git-body">
                            {/* Row 1: Release label, summary, date, status */}
                            <div className="archive-git-header">
                              <div className="archive-git-summary-line">
                                <span className="archive-git-version-tag">
                                  Phát hành phiên bản {ver.version_label || `v${ver.version}`}
                                </span>
                                <span className="archive-git-summary-text" title={ver.change_summary}>
                                  · {ver.change_summary || 'Phiên bản hoàn chỉnh ban đầu được gửi lưu trữ.'}
                                </span>
                              </div>

                              <div className="archive-git-meta-group">
                                {ver.created_at && (
                                  <span className="archive-git-date">
                                    {new Date(ver.created_at).toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                                  </span>
                                )}
                                <span
                                  className={`user-badge ${
                                    ver.status === 'APPROVED' || ver.status === 'PUBLISHED'
                                      ? 'user-badge--approved'
                                      : ver.status === 'NEEDS_REVISION'
                                      ? 'user-badge--revision'
                                      : ver.status === 'UNDER_REVIEW'
                                      ? 'user-badge--review'
                                      : ver.status === 'REJECTED' || ver.status === 'WITHDRAWN'
                                      ? 'user-badge--withdrawn'
                                      : ver.status === 'ARCHIVED'
                                      ? 'user-badge--archived'
                                      : 'user-badge--draft'
                                  }`}
                                >
                                  {ver.status === 'APPROVED'
                                    ? 'ĐÃ DUYỆT'
                                    : ver.status === 'PUBLISHED'
                                    ? 'ĐÃ XUẤT BẢN'
                                    : ver.status === 'NEEDS_REVISION'
                                    ? 'CẦN CHỈNH SỬA'
                                    : ver.status === 'UNDER_REVIEW'
                                    ? 'ĐANG THẨM ĐỊNH'
                                    : ver.status === 'REJECTED'
                                    ? 'ĐÃ TỪ CHỐI'
                                    : ver.status === 'WITHDRAWN'
                                    ? 'ĐÃ RÚT'
                                    : ver.status === 'ARCHIVED'
                                    ? 'LƯU TRỮ'
                                    : 'BẢN NHÁP'}
                                </span>
                              </div>
                            </div>

                            {/* Row 2: File pill, SHA checksum copy, Download PDF */}
                            <div className="archive-git-files-bar">
                              <span className="archive-file-tag">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                </svg>
                                {ver.file_name} ({ver.file_size || 'Kích thước không khả dụng'})
                              </span>

                              <div className="archive-git-actions-row">
                                {ver.sha256 && (
                                  <button
                                    type="button"
                                    className={`archive-sha-pill ${copiedHash === ver.sha256 ? 'archive-sha-pill--copied' : ''}`}
                                    onClick={() => handleCopyHash(ver.sha256!)}
                                    title={`Nhấp để sao chép SHA-256: ${ver.sha256}`}
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      {copiedHash === ver.sha256 ? (
                                        <polyline points="20 6 9 17 4 12" />
                                      ) : (
                                        <>
                                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </>
                                      )}
                                    </svg>
                                    <span>
                                      {copiedHash === ver.sha256 ? 'Đã sao chép SHA!' : `SHA: ${ver.sha256.substring(0, 7)}…${ver.sha256.substring(ver.sha256.length - 4)}`}
                                    </span>
                                  </button>
                                )}

                                {ver.download_url && (
                                  <ProtectedPdfDownloadLink
                                    url={ver.download_url}
                                    fileName={ver.file_name}
                                    className="archive-download-btn"
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                      <polyline points="7 10 12 15 17 10" />
                                      <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                    <span>Tải tệp PDF</span>
                                  </ProtectedPdfDownloadLink>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ fontSize: '13px', color: '#64748b', fontStyle: 'italic', padding: '8px 0' }}>
                      Chưa có lịch sử phiên bản nào được ghi nhận cho bản thảo này.
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </StudentShell>
  );
}

export default StudentVersionArchiveView;
