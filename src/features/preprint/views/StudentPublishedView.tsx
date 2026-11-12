'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { StudentShell } from '../components';
import { SortDropdown } from '@/components/sort-dropdown';
import { useTranslation } from '@/i18n';
import { ExpandableAbstract } from '@/shared/components';
import { Skeleton, PublishedPaperCardSkeleton } from '@/components/skeleton';
import dynamic from 'next/dynamic';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { firestoreDb } from '@/lib/firebase/client';

const NativePdfViewer = dynamic(
  () => import('../components/NativePdfViewer').then((mod) => mod.NativePdfViewer),
  {
    ssr: false,
    loading: () => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', gap: '12px' }}>
        <div className="student-spinner" />
        <span style={{ fontSize: '14px', color: '#64748b' }}>Đang tải tài liệu PDF...</span>
      </div>
    ),
  }
);

export type PublicPublication = {
  id: string;
  title?: string | null;
  abstract?: string | null;
  discipline?: string | null;
  keywords?: string[];
  publishedAt?: Date | string | null;
  currentVersion?: { versionLabel: string; fileName: string } | null;
  authors?: Array<{
    name: string;
    affiliation?: string | null;
    isPrimary?: boolean;
    isCorresponding?: boolean;
    email?: string;
  }>;
  downloadUrl?: string;
  downloadCount?: number;
  viewCount?: number;
};

function toIso(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate as () => Date)().toISOString();
  }
  return null;
}

function workerDownloadUrl(objectKey: unknown, publicationId: string) {
  if (typeof objectKey !== 'string' || !objectKey) return undefined;
  const worker = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
  if (!worker) return undefined;
  const url = new URL(`${worker}/r2/object`);
  url.searchParams.set('key', objectKey);
  url.searchParams.set('publicationId', publicationId);
  return url.toString();
}

export async function loadPublicPublication(id: string): Promise<PublicPublication | null> {
  const db = firestoreDb();
  const snapshot = await getDoc(doc(db, 'publications', id));
  if (!snapshot.exists()) return null;
  const publication = snapshot.data();
  const audiences = Array.isArray(publication.audiences) ? publication.audiences : [];
  if (publication.status !== 'PUBLISHED' || publication.isPrivate === true || !audiences.includes('GUEST')) return null;

  const [currentVersionSnapshot, authorLinksSnapshot] = await Promise.all([
    publication.currentVersionId
      ? getDoc(doc(db, 'publicationVersions', String(publication.currentVersionId)))
      : Promise.resolve(null),
    getDocs(query(collection(db, 'publicationAuthors'), where('publicationId', '==', id))),
  ]);
  const version = currentVersionSnapshot?.exists() ? currentVersionSnapshot.data() : null;
  const authors = authorLinksSnapshot.docs
    .map((authorDoc) => authorDoc.data())
    .sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0))
    .map((author) => ({
      name: String(author.name || ''),
      affiliation: typeof author.affiliation === 'string' ? author.affiliation : null,
      isPrimary: author.isPrimary === true,
      isCorresponding: author.isCorresponding === true,
      email: typeof author.email === 'string' ? author.email : undefined,
    }))
    .filter((author) => author.name);
  const publishedAt = toIso(publication.publicationDate) || toIso(publication.updatedAt) || toIso(publication.createdAt);
  const objectKey = version?.objectKey || publication.objectKey;
  const versionNumber = Number(version?.versionNumber || 1);

  return {
    id: snapshot.id,
    title: typeof publication.title === 'string' ? publication.title : null,
    abstract: typeof publication.abstract === 'string' ? publication.abstract : null,
    discipline: typeof publication.discipline === 'string' ? publication.discipline : null,
    keywords: Array.isArray(publication.keywords) ? publication.keywords.filter((item: unknown): item is string => typeof item === 'string') : [],
    publishedAt,
    currentVersion: {
      versionLabel: `v${versionNumber}`,
      fileName: String(version?.fileName || String(objectKey || '').split('/').pop() || 'publication.pdf'),
    },
    authors,
    downloadUrl: workerDownloadUrl(objectKey, snapshot.id),
  };
}

export async function listPublicPublications(): Promise<PublicPublication[]> {
  const db = firestoreDb();
  const publications = await getDocs(query(
    collection(db, 'publications'),
    where('status', '==', 'PUBLISHED'),
    where('isPrivate', '==', false),
    where('audiences', 'array-contains', 'GUEST'),
  ));
  const rows = await Promise.all(publications.docs.map((item) => loadPublicPublication(item.id)));
  return rows.filter((item): item is PublicPublication => item !== null)
    .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
}

export function StudentPublishedView() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<PublicPublication[]>([]);
  const [selected, setSelected] = useState<PublicPublication | null>(null);
  const [modalTab, setModalTab] = useState<'overview' | 'pdf'>('overview');
  const { data: serverItems = [], isLoading: loading, error: queryError } = useQuery<PublicPublication[], Error>({
    queryKey: ['public-publications'],
    queryFn: async () => {
      return listPublicPublications();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes fresh
    gcTime: 15 * 60 * 1000,
  });

  const error = queryError ? queryError.message : null;

  const [searchQuery, setSearchQuery] = useState(searchParams?.get('search') || searchParams?.get('q') || '');
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [citationFormat, setCitationFormat] = useState<'APA' | 'IEEE' | 'BibTeX'>('APA');
  const [citationCopied, setCitationCopied] = useState(false);

  // 1. Sync from URL
  useEffect(() => {
    const q = searchParams?.get('search') || searchParams?.get('q') || '';
    setSearchQuery(q);
  }, [searchParams]);

  // 2. Bi-directional sync: listen to search changes from Topbar
  useEffect(() => {
    const handleSearchChange = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      if (typeof customEvent.detail === 'string') {
        setSearchQuery(customEvent.detail);
      }
    };
    window.addEventListener('student-search-change', handleSearchChange);
    return () => window.removeEventListener('student-search-change', handleSearchChange);
  }, []);

  const handleLocalSearchChange = (val: string) => {
    setSearchQuery(val);
    window.dispatchEvent(new CustomEvent('student-search-change', { detail: val }));
    const newUrl = val.trim() ? `/student/published?search=${encodeURIComponent(val.trim())}` : '/student/published';
    window.history.replaceState(null, '', newUrl);
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (selected) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      };
    }
  }, [selected]);

  useEffect(() => {
    setItems(serverItems);
  }, [serverItems]);

  const handleSelectPaper = async (paper: PublicPublication) => {
    setSelected(paper);
    setModalTab('overview');
    try {
      const detail = await loadPublicPublication(paper.id);
      if (detail?.downloadUrl) setSelected((prev) => (prev && prev.id === paper.id ? detail : prev));
    } catch {
      // keep basic paper data if detail fetch fails
    }
  };

  const isJunkDiscipline = (d?: string | null) => {
    if (!d) return true;
    const trimmed = d.trim().toLowerCase();
    if (trimmed.length < 3) return true;
    return ['dsd', 'da', 'ds', 'test', 'abc'].includes(trimmed);
  };

  const disciplineOptions = useMemo(() => {
    const defaultDisciplines = [
      'Khoa học Máy tính & Trí tuệ nhân tạo',
      'Hệ thống Thông tin',
      'Kỹ thuật Phần mềm',
      'Khoa học Dữ liệu',
      'Kinh tế & Quản lý',
      'Công nghệ Thông tin & Truyền thông',
    ];

    const set = new Set<string>(defaultDisciplines);
    items.forEach((item) => {
      if (item.discipline && !isJunkDiscipline(item.discipline)) {
        set.add(item.discipline.trim());
      }
    });

    const options = [
      {
        value: 'ALL',
        label: locale === 'vi' ? 'Tất cả lĩnh vực' : 'All Disciplines',
      },
    ];

    Array.from(set).forEach((disc) => {
      options.push({
        value: disc,
        label: disc,
      });
    });

    return options;
  }, [items, locale]);

  const displayItems = useMemo(() => {
    return items.filter((item) => {
      if (activeCategory !== 'ALL' && item.discipline !== activeCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title?.toLowerCase().includes(q);
        const matchAbstract = item.abstract?.toLowerCase().includes(q);
        const matchKeywords = item.keywords?.some((k) => k.toLowerCase().includes(q));
        const matchAuthors = item.authors?.some((a) => a.name.toLowerCase().includes(q));
        if (!matchTitle && !matchAbstract && !matchKeywords && !matchAuthors) return false;
      }
      return true;
    });
  }, [items, activeCategory, searchQuery]);

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

  const copyCitation = (pub: PublicPublication) => {
    navigator.clipboard.writeText(getFormattedCitation(pub, citationFormat));
    setCitationCopied(true);
    setTimeout(() => setCitationCopied(false), 2200);
  };

  return (
    <StudentShell title={t('student.topbar.publishedTitle')} showStandardHeader={false}>
      {/* Page Header */}
      <div className="student-page-header">
        <div className="student-page-header__content">
          <h1 className="student-page-header__title">{locale === 'vi' ? 'Kho bài báo công khai' : 'Published Papers'}</h1>
          <p className="student-page-header__subtitle">
            {locale === 'vi'
              ? 'Khám phá và tham khảo các công trình nghiên cứu của cộng đồng sinh viên và giảng viên đã được xuất bản chính thức.'
              : 'Explore, read, and cite officially published scientific preprints from our academic community.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="dashboard-alert-banner" style={{ marginBottom: '20px' }}>
          <div className="dashboard-alert-banner__content">
            <strong className="dashboard-alert-banner__title">Error loading papers</strong>
            <p className="dashboard-alert-banner__desc">{error}</p>
          </div>
        </div>
      )}

      {/* Metrics Strip */}
      <div className="student-metrics-grid student-metrics-grid--3" style={{ marginBottom: '24px' }}>
        <div className="student-metric-card">
          <div className="student-metric-info">
            <span className="student-metric-value">{loading ? <Skeleton width={36} height={26} style={{ display: 'inline-block' }} /> : items.length}</span>
            <span className="student-metric-label">{locale === 'vi' ? 'Tổng số bài báo xuất bản' : 'Total Published Papers'}</span>
          </div>
        </div>

        <div className="student-metric-card">
          <div className="student-metric-info">
            <span className="student-metric-value">{loading ? <Skeleton width={36} height={26} style={{ display: 'inline-block' }} /> : Math.max(1, disciplineOptions.length - 1)}</span>
            <span className="student-metric-label">{locale === 'vi' ? 'Lĩnh vực nghiên cứu' : 'Academic Disciplines'}</span>
          </div>
        </div>

        <div className="student-metric-card">
          <div className="student-metric-info">
            <span className="student-metric-value">{loading ? <Skeleton width={36} height={26} style={{ display: 'inline-block' }} /> : displayItems.length}</span>
            <span className="student-metric-label">{locale === 'vi' ? 'Kết quả hiển thị' : 'Matching Results'}</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="student-filter-toolbar" style={{ justifyContent: 'flex-end', gap: '16px' }}>
        {/* Search & Discipline Filter */}
        <div className="student-toolbar-actions">
          <div className="student-sort-box" style={{ gap: '8px' }}>
            <span className="student-sort-label" style={{ fontWeight: 600, color: '#475569', fontSize: '12px' }}>
              {locale === 'vi' ? 'Lĩnh vực:' : 'Discipline:'}
            </span>
            <SortDropdown
              value={activeCategory}
              onChange={(val) => setActiveCategory(val)}
              options={disciplineOptions}
              style={{ width: '270px' }}
              ariaLabel={locale === 'vi' ? 'Lọc theo lĩnh vực nghiên cứu' : 'Filter by academic discipline'}
            />
          </div>

          <div className="student-search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={locale === 'vi' ? 'Tìm bài báo, tác giả, từ khóa...' : 'Search title, author, keyword...'}
              value={searchQuery}
              onChange={(e) => handleLocalSearchChange(e.target.value)}
              className="student-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleLocalSearchChange('')}
                className="student-search-clear"
                aria-label="Xóa tìm kiếm"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results Grid */}
      {loading ? (
        <div className="student-pub-grid">
          <PublishedPaperCardSkeleton count={6} />
        </div>
      ) : displayItems.length > 0 ? (
        <div className="student-pub-grid">
          {displayItems.map((item) => (
            <div
              key={item.id}
              onClick={() => handleSelectPaper(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelectPaper(item);
                }
              }}
              className="student-pub-card"
            >
              <div>
                <div className="student-pub-card__header">
                  <span className="student-pub-card__discipline">
                    {!isJunkDiscipline(item.discipline)
                      ? item.discipline
                      : (locale === 'vi' ? 'Khoa học tổng quát' : 'General Science')}
                  </span>
                  <span className="student-pub-card__version">
                    {item.currentVersion?.versionLabel || 'v1.0'}
                  </span>
                </div>

                <h3 className="student-pub-card__title">
                  {item.title}
                </h3>

                <div className="student-pub-card__author">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span className="student-pub-card__author-name">
                    {item.authors?.map((a) => a.name).join(', ') || (locale === 'vi' ? 'Tác giả ẩn danh' : 'Unknown Author')}
                  </span>
                </div>

                {item.abstract && (
                  <p className="student-pub-card__abstract">
                    {item.abstract}
                  </p>
                )}
              </div>

              <div>
                {item.keywords && item.keywords.length > 0 && (
                  <div className="student-pub-card__tags">
                    {item.keywords.slice(0, 3).map((kw) => (
                      <span key={kw} className="student-pub-card__tag" title={`#${kw}`}>
                        #{kw}
                      </span>
                    ))}
                    {item.keywords.length > 3 && (
                      <span className="student-pub-card__tag-more">+{item.keywords.length - 3}</span>
                    )}
                  </div>
                )}

                <div className="student-pub-card__footer">
                  <span className="student-pub-card__date">
                    {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US') : ''}
                  </span>
                  <span className="student-pub-card__action">
                    {locale === 'vi' ? 'Xem & Trích dẫn' : 'View & Cite'}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="student-empty-card" style={{ marginTop: '20px' }}>
          <div className="student-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <h3>{locale === 'vi' ? 'Không có bài báo nào phù hợp' : 'No published papers found'}</h3>
          <p>
            {locale === 'vi' ? 'Hãy thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc.' : 'Try adjusting your search criteria or clearing active filters.'}
          </p>
          {(activeCategory !== 'ALL' || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setActiveCategory('ALL');
                setSearchQuery('');
              }}
              className="student-btn student-btn--primary"
              style={{ marginTop: '16px' }}
            >
              {locale === 'vi' ? 'Xóa bộ lọc' : 'Clear filters'}
            </button>
          )}
        </div>
      )}

      {/* Modal Detail & Citation */}
      {mounted && selected && createPortal(
        <div
          className="pl-published-modal-backdrop"
          data-lenis-prevent="true"
          onWheel={(e) => e.stopPropagation()}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
            overscrollBehavior: 'contain',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            data-lenis-prevent="true"
            onWheel={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: modalTab === 'pdf' ? '980px' : '680px',
              transition: 'max-width 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
              padding: '32px',
              position: 'relative',
              boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
            }}
          >
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="student-modal-close-btn"
              title={locale === 'vi' ? 'Đóng' : 'Close'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>

            <div style={{ marginBottom: '20px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#0071bc', background: '#f0f7fc', padding: '4px 10px', borderRadius: '6px', display: 'inline-block', marginBottom: '12px' }}>
                {!isJunkDiscipline(selected.discipline) ? selected.discipline : (locale === 'vi' ? 'Khoa học tổng quát' : 'General Science')}
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: '0 0 12px 0', lineHeight: 1.4 }}>
                {selected.title}
              </h2>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', color: '#64748b', fontSize: '13.5px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  <span>{selected.authors?.map((a) => a.name).join(' · ') || (locale === 'vi' ? 'Tác giả ẩn danh' : 'Unknown')}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  <span>{selected.currentVersion?.versionLabel || 'v1.0'}</span>
                </div>
              </div>
            </div>

            {modalTab === 'pdf' ? (
              <div style={{ marginTop: 16 }}>
                {selected.downloadUrl ? (
                  <NativePdfViewer
                    url={selected.downloadUrl}
                    fileName={selected.currentVersion?.fileName || `${selected.title?.substring(0, 50) || 'manuscript'}.pdf`}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 350, gap: 12 }}>
                    <div className="student-spinner" />
                    <span style={{ fontSize: 14, color: '#64748b' }}>{locale === 'vi' ? 'Đang chuẩn bị tài liệu PDF...' : 'Loading PDF document...'}</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ fontSize: '12.5px', textTransform: 'uppercase', color: '#0071bc', margin: '0 0 8px 0', fontWeight: 800, letterSpacing: '0.05em' }}>
                    {locale === 'vi' ? 'Tóm tắt nghiên cứu (Abstract)' : 'Abstract'}
                  </h4>
                  <ExpandableAbstract text={selected.abstract} locale={locale} fontSize="14.5px" />

                  {selected.keywords && selected.keywords.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' }}>
                      {selected.keywords.map((kw) => (
                        <span
                          key={kw}
                          title={`#${kw}`}
                          style={{
                            fontSize: '12px',
                            background: '#e2e8f0',
                            color: '#475569',
                            padding: '3px 10px',
                            borderRadius: '16px',
                            fontWeight: 600,
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
                  )}
                </div>

                {/* Citation Box */}
                <div style={{ background: '#f0fdf4', padding: '18px', borderRadius: '12px', marginBottom: '24px', border: '1px solid #bbf7d0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#166534' }}>
                      <span>{locale === 'vi' ? 'Trích dẫn bài báo này:' : 'Cite this paper:'}</span>
                      <div style={{ display: 'inline-flex', gap: '4px', marginLeft: '6px' }}>
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

                    <button
                      type="button"
                      onClick={() => copyCitation(selected)}
                      className="student-citation-copy-btn"
                      style={{
                        color: citationCopied ? '#15803d' : '#0071bc',
                      }}
                    >
                      {citationCopied ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                          <span>{locale === 'vi' ? 'Đã sao chép!' : 'Copied!'}</span>
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                          <span>{locale === 'vi' ? 'Sao chép trích dẫn' : 'Copy Citation'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div style={{ fontSize: '13px', color: '#14532d', background: '#ffffff', padding: '10px 14px', borderRadius: '8px', border: '1px solid #dcfce7', fontFamily: 'monospace', lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                    {getFormattedCitation(selected, citationFormat)}
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '20px' }}>
              {modalTab === 'pdf' ? (
                <>
                  <button type="button" onClick={() => setModalTab('overview')} className="student-modal-btn-dismiss" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                    {locale === 'vi' ? 'Quay lại tóm tắt' : 'Back to summary'}
                  </button>
                  <button type="button" onClick={() => setSelected(null)} className="student-modal-btn-dismiss">
                    {locale === 'vi' ? 'Đóng' : 'Close'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setSelected(null)} className="student-modal-btn-dismiss">
                    {locale === 'vi' ? 'Đóng' : 'Close'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalTab('pdf')}
                    className="student-modal-btn-detail"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: 'none', cursor: 'pointer' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    {locale === 'vi' ? 'Xem chi tiết bài báo (PDF)' : 'View Full Paper (PDF)'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </StudentShell>
  );
}

export default StudentPublishedView;
