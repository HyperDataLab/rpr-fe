'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { StudentShell } from '../components';
import { useTranslation } from '@/i18n';
import { ExpandableAbstract } from '@/shared/components';
import { ProtectedPdfDownloadLink } from '../components/ProtectedPdfDownloadLink';
import { DetailSkeleton } from '@/components/skeleton';
import { loadPublicPublication, type PublicPublication } from './StudentPublishedView';

const NativePdfViewer = dynamic(
  () => import('../components/NativePdfViewer').then((mod) => mod.NativePdfViewer),
  {
    ssr: false,
    loading: () => (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '400px' }}>
        <div className="student-spinner" />
      </div>
    ),
  }
);

export interface StudentPublishedDetailViewProps {
  id: string;
}

export function StudentPublishedDetailView({ id }: StudentPublishedDetailViewProps) {
  const { t, locale } = useTranslation();
  const [paper, setPaper] = useState<PublicPublication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [citationFormat, setCitationFormat] = useState<'APA' | 'IEEE' | 'BibTeX'>('APA');
  const [citationCopied, setCitationCopied] = useState(false);
  const searchParams = useSearchParams();
  const defaultTab = searchParams?.get('tab') === 'pdf' ? 'pdf' : 'overview';
  const [activeTab, setActiveTab] = useState<'overview' | 'pdf'>(defaultTab);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    loadPublicPublication(id)
      .then((data) => {
        if (!data) {
          throw new Error(locale === 'vi' ? 'Không tìm thấy bài báo hoặc bài báo chưa được xuất bản.' : 'Publication not found or not published.');
        }
        if (active) setPaper(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load paper.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, locale]);

  const getFormattedCitation = (pub: PublicPublication, format: 'APA' | 'IEEE' | 'BibTeX') => {
    const authorsStr = pub.authors?.map((a) => a.name).join(', ') || (locale === 'vi' ? 'Tác giả' : 'Author');
    const year = pub.publishedAt ? new Date(pub.publishedAt).getFullYear() : new Date().getFullYear();
    const title = pub.title || (locale === 'vi' ? 'Bản thảo nghiên cứu' : 'Research Preprint');
    if (format === 'APA') {
      return `${authorsStr} (${year}). ${title}. HyperData Lab Academic Repository, ${pub.currentVersion?.versionLabel || 'v1.0'}. https://hyperdatalab.org/preprints/${pub.id}`;
    }
    if (format === 'IEEE') {
      return `[1] ${authorsStr}, "${title}," HyperData Lab Preprint Rep., vol. 1, no. 1, ${year}.`;
    }
    return `@article{hyperdatalab_${pub.id.slice(0, 8)},\n  title={${title}},\n  author={${authorsStr}},\n  journal={HyperData Lab Preprints},\n  year={${year}}\n}`;
  };

  const copyCitation = () => {
    if (!paper) return;
    navigator.clipboard.writeText(getFormattedCitation(paper, citationFormat));
    setCitationCopied(true);
    setTimeout(() => setCitationCopied(false), 2200);
  };

  return (
    <StudentShell title={paper?.title || t('student.topbar.publishedTitle')} showStandardHeader={false}>
      {/* Back Button */}
      <div style={{ marginBottom: '20px' }}>
        <Link
          href="/student/published"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: '#0071bc',
            fontWeight: 600,
            fontSize: '13.5px',
            textDecoration: 'none',
            padding: '6px 12px',
            borderRadius: '8px',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#0071bc';
            e.currentTarget.style.background = '#f0f9ff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#e2e8f0';
            e.currentTarget.style.background = '#ffffff';
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>{locale === 'vi' ? 'Quay lại Kho bài báo công khai' : 'Back to Published Papers'}</span>
        </Link>
      </div>

      {loading && <DetailSkeleton />}

      {error && !loading && (
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '48px 24px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
            {locale === 'vi' ? 'Không thể tải bài báo' : 'Unable to load publication'}
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', maxWidth: '460px', margin: '0 auto 20px' }}>
            {error}
          </p>
          <Link
            href="/student/published"
            style={{
              display: 'inline-flex',
              padding: '10px 20px',
              background: '#0071bc',
              color: '#ffffff',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '14px',
              textDecoration: 'none',
            }}
          >
            {locale === 'vi' ? 'Về danh sách bài báo' : 'Back to Repository'}
          </Link>
        </div>
      )}

      {paper && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '24px', alignItems: 'start' }}>
          {/* Main Article Content */}
          <div style={{ background: '#ffffff', borderRadius: '16px', padding: '32px', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)' }}>
            {/* Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '4px 10px', borderRadius: '6px' }}>
                {paper.currentVersion?.versionLabel || 'v1.0'}
              </span>
            </div>

            {/* Title */}
            <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', lineHeight: 1.4, margin: '0 0 16px 0' }}>
              {paper.title}
            </h1>

            {/* Authors */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '24px', paddingBottom: '20px', borderBottom: '1px solid #f1f5f9' }}>
              {(paper.authors && paper.authors.length > 0) ? (
                paper.authors.map((author, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#0071bc', color: '#fff', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {author.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', display: 'block' }}>{author.name}</span>
                      {author.affiliation && <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>{author.affiliation}</span>}
                    </div>
                  </div>
                ))
              ) : (
                <span style={{ fontSize: '13.5px', color: '#64748b' }}>{locale === 'vi' ? 'Tác giả ẩn danh' : 'Unknown Author'}</span>
              )}
            </div>

            {/* Tabs */}
            <div className="student-detail-tabs" role="tablist" style={{ marginBottom: '28px' }}>
              <button
                type="button"
                className={`student-detail-tab ${activeTab === 'overview' ? 'student-detail-tab--active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  <span>{locale === 'vi' ? 'Tổng quan' : 'Overview'}</span>
                </span>
              </button>
              {paper.downloadUrl && (
                <button
                  type="button"
                  className={`student-detail-tab ${activeTab === 'pdf' ? 'student-detail-tab--active' : ''}`}
                  onClick={() => setActiveTab('pdf')}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    </svg>
                    <span>{locale === 'vi' ? 'Đọc trực tuyến (PDF)' : 'Read Online (PDF)'}</span>
                  </span>
                </button>
              )}
            </div>

            {activeTab === 'overview' && (
              <>
                {/* Abstract */}
                <div style={{ marginBottom: '28px' }}>
                  <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                    <h3 style={{ fontSize: '12.5px', textTransform: 'uppercase', color: '#0071bc', margin: '0 0 8px 0', fontWeight: 800, letterSpacing: '0.05em' }}>
                      {locale === 'vi' ? 'Tóm tắt nghiên cứu (Abstract)' : 'Abstract'}
                    </h3>
                    <ExpandableAbstract text={paper.abstract} locale={locale} fontSize="14.5px" />
                  </div>
                </div>

                {/* Keywords */}
                {paper.keywords && paper.keywords.length > 0 && (
                  <div style={{ marginBottom: '28px' }}>
                    <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
                      {locale === 'vi' ? 'Từ khóa nghiên cứu (Keywords):' : 'Keywords:'}
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {paper.keywords.map((kw) => (
                        <span
                          key={kw}
                          title={`#${kw}`}
                          style={{
                            fontSize: '12.5px',
                            background: '#f1f5f9',
                            color: '#334155',
                            padding: '4px 12px',
                            borderRadius: '16px',
                            fontWeight: 500,
                            border: '1px solid #e2e8f0',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'inline-block',
                          }}
                        >
                          #{kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Citation Box */}
                <div style={{ background: '#f0fdf4', padding: '20px', borderRadius: '14px', border: '1px solid #bbf7d0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13.5px', fontWeight: 700, color: '#166534' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                      <span>{locale === 'vi' ? 'Trích dẫn bài báo khoa học này:' : 'Cite this publication:'}</span>
                    </div>
                    <div style={{ display: 'inline-flex', gap: '4px' }}>
                      {(['APA', 'IEEE', 'BibTeX'] as const).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => setCitationFormat(fmt)}
                          className={`student-citation-fmt-btn ${citationFormat === fmt ? 'student-citation-fmt-btn--active' : ''}`}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ position: 'relative' }}>
                    <pre style={{ margin: 0, padding: '14px 44px 14px 14px', background: '#ffffff', border: '1px solid #86efac', borderRadius: '8px', fontSize: '12.5px', color: '#14532d', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                      {getFormattedCitation(paper, citationFormat)}
                    </pre>
                    <button
                      type="button"
                      onClick={copyCitation}
                      className="student-citation-copy-btn"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                      }}
                      title={locale === 'vi' ? 'Sao chép trích dẫn' : 'Copy citation'}
                    >
                      {citationCopied ? (
                        <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                          <span>{locale === 'vi' ? 'Đã sao chép' : 'Copied'}</span>
                        </>
                      ) : (
                        <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                          <span>{locale === 'vi' ? 'Sao chép' : 'Copy'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'pdf' && paper.downloadUrl && (
              <div className="student-tab-panel" style={{ marginTop: '20px' }}>
                <NativePdfViewer
                  url={paper.downloadUrl}
                  fileName={paper.currentVersion?.fileName || `${paper.title?.substring(0, 50) || 'manuscript'}.pdf`}
                />
              </div>
            )}
          </div>

          {/* Sidebar Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Download PDF Action Card */}
            <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                {locale === 'vi' ? 'Tài liệu toàn văn (PDF)' : 'Full Manuscript PDF'}
              </h3>
              
              {paper.downloadUrl ? (
                <ProtectedPdfDownloadLink
                  url={paper.downloadUrl}
                  fileName={paper.currentVersion?.fileName || `${paper.title || 'publication'}.pdf`}
                  className="student-detail-download-btn"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span>{locale === 'vi' ? 'Tải bản PDF gốc' : 'Download PDF Document'}</span>
                </ProtectedPdfDownloadLink>
              ) : (
                <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px', color: '#64748b', fontSize: '13px', textAlign: 'center' }}>
                  {locale === 'vi' ? 'Đang chuẩn bị file tải...' : 'File download unavailable'}
                </div>
              )}

              {paper.currentVersion?.fileName && (
                <div style={{ marginTop: '12px', fontSize: '12px', color: '#64748b', wordBreak: 'break-all' }}>
                  📄 {paper.currentVersion.fileName}
                </div>
              )}
            </div>

            {/* Publication Details */}
            <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', margin: '0 0 16px 0' }}>
                {locale === 'vi' ? 'Thông tin xuất bản' : 'Publication Details'}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                  <span style={{ color: '#64748b' }}>{locale === 'vi' ? 'Mã định danh (ID):' : 'Preprint ID:'}</span>
                  <span style={{ fontWeight: 600, color: '#0f172a', fontFamily: 'monospace' }}>{paper.id.slice(0, 8)}...</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                  <span style={{ color: '#64748b' }}>{locale === 'vi' ? 'Phiên bản:' : 'Version:'}</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{paper.currentVersion?.versionLabel || 'v1.0'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                  <span style={{ color: '#64748b' }}>{locale === 'vi' ? 'Trạng thái:' : 'Status:'}</span>
                  <span style={{ fontWeight: 700, color: '#059669' }}>{locale === 'vi' ? 'Đã xuất bản' : 'Published'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>{locale === 'vi' ? 'Kho lưu trữ:' : 'Repository:'}</span>
                  <span style={{ fontWeight: 600, color: '#0071bc' }}>HyperData Lab</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </StudentShell>
  );
}

export default StudentPublishedDetailView;
