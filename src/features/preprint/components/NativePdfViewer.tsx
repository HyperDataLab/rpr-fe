'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Document, Page, Thumbnail, pdfjs } from 'react-pdf';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { firebaseAuth } from '@/lib/firebase/client';
import { fetchPdfFromWorker } from '@/lib/cloudflare/worker-client';

// Keep the PDF.js worker local and version-matched with the installed package.
// A CDN worker previously terminated repeatedly in Edge when the document was rendered.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface NativePdfViewerProps {
  url: string;
  fileName?: string;
}

type FitMode = 'width' | 'page';

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const PDF_OPTIONS = {};

function escapeHtml(value: string) {
  const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (character) => escapes[character] || character);
}

function PdfIcon({ name }: { name: 'file' | 'minus' | 'plus' | 'previous' | 'next' | 'width' | 'page' | 'external' | 'download' | 'fullscreen' | 'exitFullscreen' | 'sidebar' | 'search' | 'refresh' }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  if (name === 'file') return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></svg>;
  if (name === 'minus') return <svg {...common}><path d="M5 12h14" /></svg>;
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === 'previous') return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
  if (name === 'next') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  if (name === 'width') return <svg {...common}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10M7 12l3-3m-3 3 3 3m10-3-3-3m3 3-3 3" /></svg>;
  if (name === 'page') return <svg {...common}><path d="M4 3h16v18H4zM8 7h8M8 11h8M8 15h5" /></svg>;
  if (name === 'external') return <svg {...common}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>;
  if (name === 'download') return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v4h16v-4" /></svg>;
  if (name === 'fullscreen') return <svg {...common}><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" /></svg>;
  if (name === 'exitFullscreen') return <svg {...common}><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3m13-5h-3a2 2 0 0 0-2 2v3" /></svg>;
  if (name === 'sidebar') return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>;
  if (name === 'search') return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>;
  return <svg {...common}><path d="M20 11a8 8 0 0 0-14-5L4 8" /><path d="M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2" /><path d="M20 20v-4h-4" /></svg>;
}

export function NativePdfViewer({ url, fileName }: NativePdfViewerProps) {
  const viewerId = useId().replace(/:/g, '');
  const wrapperRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchGenerationRef = useRef(0);
  const [scale, setScale] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>('width');
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [pageRatio, setPageRatio] = useState(0.707);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchPages, setSearchPages] = useState<number[]>([]);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const downloadName = fileName || 'manuscript.pdf';

  useEffect(() => {
    let active = true;
    let createdObjectUrl: string | null = null;
    searchGenerationRef.current += 1;
    setPdfObjectUrl(null);
    setPdfError(null);
    setPageCount(0);
    setCurrentPage(1);
    setPageInput('1');
    setPdfDocument(null);
    setSearchTerm('');
    setSearchPages([]);
    setSearchMatchCount(0);
    setSearchError('');
    setPdfLoading(true);

    async function loadPdf() {
      try {
        const parsed = new URL(url, window.location.href);
        const workerBase = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
        let blob: Blob;

        if (workerBase && parsed.origin === new URL(workerBase).origin && parsed.pathname === '/r2/object') {
          const key = parsed.searchParams.get('key') || '';
          const publicationId = parsed.searchParams.get('publicationId') || '';
          if (!key || !publicationId) throw new Error('PDF link is missing its file reference.');
          const user = firebaseAuth().currentUser;
          if (user) {
            blob = await fetchPdfFromWorker(key, publicationId);
          } else {
            const response = await fetch(parsed.toString(), { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
            if (!response.ok) throw new Error(`PDF request failed (${response.status}).`);
            blob = await response.blob();
          }
        } else {
          const response = await fetch(parsed.toString(), { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
          if (!response.ok) throw new Error(`PDF request failed (${response.status}).`);
          blob = await response.blob();
        }

        if (blob.type && blob.type !== 'application/pdf') throw new Error('The file returned by storage is not a PDF.');
        createdObjectUrl = URL.createObjectURL(blob);
        if (active) setPdfObjectUrl(createdObjectUrl);
        else URL.revokeObjectURL(createdObjectUrl);
      } catch (error) {
        if (active) {
          setPdfError(
            error instanceof DOMException && error.name === 'TimeoutError'
              ? 'Tải PDF quá thời gian chờ. Kiểm tra kết nối rồi thử lại.'
              : error instanceof Error ? error.message : 'Không thể tải tệp PDF.',
          );
        }
      } finally {
        if (active) setPdfLoading(false);
      }
    }

    void loadPdf();
    return () => {
      active = false;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [url, retryKey]);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, [pdfObjectUrl, showThumbnails, isFullscreen]);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node || !pageCount) return;
    const pages = node.querySelectorAll<HTMLElement>('[data-pdf-page]');
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const page = Number((visible.target as HTMLElement).dataset.pdfPage);
      if (Number.isInteger(page) && page > 0) setCurrentPage(page);
    }, { root: node, rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.2, 0.5, 0.8] });
    pages.forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [pageCount, pdfObjectUrl, showThumbnails]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    const index = searchPages.indexOf(currentPage);
    if (index >= 0) setActiveSearchIndex(index);
  }, [currentPage, searchPages]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const onDocumentLoadSuccess = useCallback(async (pdf: PDFDocumentProxy) => {
    setPdfDocument(pdf);
    setPageCount(pdf.numPages);
    try {
      const firstPage = await pdf.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });
      if (viewport.width && viewport.height) setPageRatio(viewport.width / viewport.height);
    } catch {
      // Keep the standard A4 ratio fallback when page dimensions are unavailable.
    }
  }, []);

  const customTextRenderer = useCallback(({ str }: { str: string }) => {
    if (!searchTerm) return str;
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(`(${escaped})`, 'gi');
    return str.split(matcher).map((part, index) => index % 2
      ? `<mark class="native-pdf-search-hit">${escapeHtml(part)}</mark>`
      : escapeHtml(part)).join('');
  }, [searchTerm]);

  const basePageWidth = useMemo(() => {
    if (!containerSize.width) return 800;
    const horizontalPadding = containerSize.width < 600 ? 24 : 72;
    const availableWidth = Math.max(240, containerSize.width - horizontalPadding);
    if (fitMode === 'page' && containerSize.height > 0) {
      return Math.min(availableWidth, Math.max(220, (containerSize.height - 40) * pageRatio));
    }
    return availableWidth;
  }, [containerSize, fitMode, pageRatio]);
  const pageWidth = Math.min(1600, Math.round(basePageWidth * scale));

  const goToPage = useCallback((page: number) => {
    const nextPage = Math.max(1, Math.min(pageCount || 1, Math.trunc(page)));
    setCurrentPage(nextPage);
    setPageInput(String(nextPage));
    document.getElementById(`pdf-${viewerId}-page-${nextPage}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pageCount, viewerId]);

  const submitPageInput = useCallback(() => {
    const requested = Number(pageInput);
    if (!Number.isFinite(requested)) {
      setPageInput(String(currentPage));
      return;
    }
    goToPage(requested);
    pageInputRef.current?.blur();
  }, [currentPage, goToPage, pageInput]);

  const runSearch = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchInput.trim();
    const pdf = pdfDocument;
    if (!query || !pdf) {
      setSearchTerm('');
      setSearchPages([]);
      setSearchMatchCount(0);
      return;
    }

    const generation = ++searchGenerationRef.current;
    setIsSearching(true);
    setSearchError('');
    setSearchTerm(query);
    setSearchPages([]);
    setSearchMatchCount(0);
    setActiveSearchIndex(0);
    const hits: number[] = [];
    let totalMatches = 0;
    const normalizedQuery = query.toLocaleLowerCase();

    try {
      for (let page = 1; page <= pdf.numPages; page += 1) {
        const text = await (await pdf.getPage(page)).getTextContent();
        let pageHasHit = false;
        for (const item of text.items) {
          if (!('str' in item)) continue;
          const value = item.str.toLocaleLowerCase();
          let offset = 0;
          while ((offset = value.indexOf(normalizedQuery, offset)) !== -1) {
            totalMatches += 1;
            pageHasHit = true;
            offset += normalizedQuery.length;
          }
        }
        if (pageHasHit) hits.push(page);
        if (generation !== searchGenerationRef.current) return;
      }

      if (generation !== searchGenerationRef.current) return;
      setSearchPages(hits);
      setSearchMatchCount(totalMatches);
      if (hits.length) goToPage(hits[0]);
    } catch (error) {
      setSearchError(error instanceof Error ? `Không thể tìm trong PDF: ${error.message}` : 'Không thể tìm trong PDF.');
    } finally {
      if (generation === searchGenerationRef.current) setIsSearching(false);
    }
  }, [goToPage, pdfDocument, searchInput]);

  const moveSearchResult = useCallback((direction: -1 | 1) => {
    if (!searchPages.length) return;
    const next = (activeSearchIndex + direction + searchPages.length) % searchPages.length;
    setActiveSearchIndex(next);
    goToPage(searchPages[next]);
  }, [activeSearchIndex, goToPage, searchPages]);

  function openPdfInNewTab() {
    if (pdfObjectUrl) window.open(pdfObjectUrl, '_blank', 'noopener,noreferrer');
  }

  function downloadPdf() {
    if (!pdfObjectUrl) return;
    const link = document.createElement('a');
    link.href = pdfObjectUrl;
    link.download = downloadName;
    link.click();
  }

  function changeZoom(direction: -1 | 1) {
    setScale((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((value + direction * ZOOM_STEP) * 10) / 10)));
  }

  async function toggleFullscreen() {
    if (!wrapperRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapperRef.current.requestFullscreen();
    } catch {
      // Fullscreen is optional and may be denied by the browser context.
    }
  }

  function onPageLoadSuccess(page: PDFPageProxy) {
    if (page.pageNumber !== 1) return;
    const viewport = page.getViewport({ scale: 1 });
    if (viewport.width && viewport.height) setPageRatio(viewport.width / viewport.height);
  }

  const fitButton = (mode: FitMode, label: string, icon: 'width' | 'page') => (
    <button
      type="button"
      className={`native-pdf-btn native-pdf-btn--icon${fitMode === mode && scale === 1 ? ' is-active' : ''}`}
      onClick={() => { setFitMode(mode); setScale(1); }}
      title={label}
      aria-label={label}
      aria-pressed={fitMode === mode && scale === 1}
    ><PdfIcon name={icon} /></button>
  );

  return (
    <section ref={wrapperRef} className={`native-pdf-wrapper${isFullscreen ? ' native-pdf-wrapper--fullscreen' : ''}`} aria-label="Trình đọc tài liệu PDF">
      <div className="native-pdf-toolbar">
        <div className="native-pdf-toolbar__left">
          <span className="native-pdf-toolbar__file-badge" aria-hidden="true"><PdfIcon name="file" /></span>
          <span className="native-pdf-toolbar__title" title={downloadName}>{downloadName}</span>
        </div>

        <div className="native-pdf-toolbar__reading" aria-label="Điều khiển đọc PDF">
          <button type="button" className={`native-pdf-btn native-pdf-btn--icon${showThumbnails ? ' is-active' : ''}`} onClick={() => setShowThumbnails((value) => !value)} title={showThumbnails ? 'Ẩn danh sách trang' : 'Hiện danh sách trang'} aria-label={showThumbnails ? 'Ẩn danh sách trang' : 'Hiện danh sách trang'} aria-pressed={showThumbnails} disabled={!pageCount}>
            <PdfIcon name="sidebar" />
          </button>
          <span className="native-pdf-toolbar__divider" aria-hidden="true" />
          <div className="native-pdf-control-group native-pdf-page-controls" aria-label="Điều hướng trang">
            <button type="button" className="native-pdf-btn native-pdf-btn--icon" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1 || !pageCount} title="Trang trước" aria-label="Trang trước"><PdfIcon name="previous" /></button>
            <label className="native-pdf-page-position">
              <span className="sr-only">Trang hiện tại</span>
              <input ref={pageInputRef} type="number" min={1} max={pageCount || 1} value={pageInput} onChange={(event) => setPageInput(event.target.value)} onBlur={submitPageInput} onKeyDown={(event) => { if (event.key === 'Enter') submitPageInput(); }} disabled={!pageCount} aria-label="Số trang hiện tại" />
              <span aria-hidden="true">/ {pageCount || '—'}</span>
            </label>
            <button type="button" className="native-pdf-btn native-pdf-btn--icon" onClick={() => goToPage(currentPage + 1)} disabled={!pageCount || currentPage >= pageCount} title="Trang tiếp" aria-label="Trang tiếp"><PdfIcon name="next" /></button>
          </div>
          <span className="native-pdf-toolbar__divider" aria-hidden="true" />
          <div className="native-pdf-control-group" aria-label="Thu phóng">
            <button type="button" className="native-pdf-btn native-pdf-btn--icon" onClick={() => changeZoom(-1)} disabled={scale <= MIN_ZOOM} title="Thu nhỏ" aria-label="Thu nhỏ"><PdfIcon name="minus" /></button>
            <span className="native-pdf-zoom-val" aria-live="polite">{Math.round(scale * 100)}%</span>
            <button type="button" className="native-pdf-btn native-pdf-btn--icon" onClick={() => changeZoom(1)} disabled={scale >= MAX_ZOOM} title="Phóng to" aria-label="Phóng to"><PdfIcon name="plus" /></button>
          </div>
          <span className="native-pdf-toolbar__divider native-pdf-toolbar__fit-divider" aria-hidden="true" />
          <div className="native-pdf-control-group native-pdf-fit-controls" aria-label="Cách hiển thị trang">
            {fitButton('width', 'Vừa chiều rộng', 'width')}
            {fitButton('page', 'Vừa trang', 'page')}
          </div>
        </div>

        <div className="native-pdf-toolbar__actions" aria-label="Tác vụ tài liệu">
          <button type="button" className={`native-pdf-btn native-pdf-btn--icon${searchOpen ? ' is-active' : ''}`} onClick={() => setSearchOpen((value) => !value)} disabled={!pdfObjectUrl || !pdfDocument} title="Tìm trong PDF" aria-label="Tìm trong PDF" aria-pressed={searchOpen}><PdfIcon name="search" /></button>
          <button type="button" className="native-pdf-btn native-pdf-btn--icon" onClick={toggleFullscreen} title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'} aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}><PdfIcon name={isFullscreen ? 'exitFullscreen' : 'fullscreen'} /></button>
          <button type="button" className="native-pdf-btn native-pdf-btn--icon" onClick={openPdfInNewTab} disabled={!pdfObjectUrl} title="Mở PDF trong tab mới" aria-label="Mở PDF trong tab mới"><PdfIcon name="external" /></button>
          <button type="button" className="native-pdf-btn native-pdf-btn--icon" onClick={downloadPdf} disabled={!pdfObjectUrl} title="Tải PDF xuống" aria-label="Tải PDF xuống"><PdfIcon name="download" /></button>
        </div>
      </div>

      {searchOpen && pdfDocument && (
        <form className="native-pdf-search" role="search" onSubmit={runSearch}>
          <label htmlFor={`pdf-${viewerId}-search`}>Tìm trong tài liệu</label>
          <input ref={searchInputRef} id={`pdf-${viewerId}-search`} type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Nhập từ khóa…" />
          <button type="submit" className="native-pdf-search__submit" disabled={isSearching || !searchInput.trim()}>{isSearching ? 'Đang tìm…' : 'Tìm'}</button>
          <span className="native-pdf-search__count" aria-live="polite">
            {isSearching ? 'Đang quét các trang…' : searchError || (searchMatchCount ? `${activeSearchIndex + 1}/${searchPages.length} trang · ${searchMatchCount} kết quả` : searchTerm ? 'Không tìm thấy kết quả' : '')}
          </span>
          <button type="button" className="native-pdf-btn native-pdf-btn--icon" onClick={() => moveSearchResult(-1)} disabled={!searchPages.length} title="Kết quả trước" aria-label="Kết quả trước"><PdfIcon name="previous" /></button>
          <button type="button" className="native-pdf-btn native-pdf-btn--icon" onClick={() => moveSearchResult(1)} disabled={!searchPages.length} title="Kết quả tiếp" aria-label="Kết quả tiếp"><PdfIcon name="next" /></button>
        </form>
      )}

      {pdfLoading ? (
        <div className="native-pdf-document-canvas native-pdf-loading" role="status" aria-live="polite">
          <div className="native-pdf-loading__page" aria-hidden="true"><span /><span /><span /><span /><span /></div>
          <p>Đang tải tài liệu…</p>
        </div>
      ) : pdfError || !pdfObjectUrl ? (
        <div className="native-pdf-document-canvas native-pdf-error" role="alert">
          <p>{pdfError || 'Không thể tải tệp PDF.'}</p>
          <button type="button" className="native-pdf-btn native-pdf-btn--retry" onClick={() => setRetryKey((value) => value + 1)}><PdfIcon name="refresh" /> Thử tải lại</button>
        </div>
      ) : (
        <Document
          className={`native-pdf-document${showThumbnails ? ' native-pdf-document--with-thumbnails' : ''}`}
          file={pdfObjectUrl}
          options={PDF_OPTIONS}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(error) => setPdfError(`Không thể đọc tệp PDF: ${error.message}`)}
          loading={<div className="native-pdf-document-canvas native-pdf-loading" role="status"><div className="native-pdf-loading__page" aria-hidden="true"><span /><span /><span /><span /><span /></div><p>Đang đọc cấu trúc PDF…</p></div>}
          error={<div className="native-pdf-document-canvas native-pdf-error" role="alert"><p>Không thể hiển thị tệp PDF.</p><button type="button" className="native-pdf-btn native-pdf-btn--retry" onClick={() => setRetryKey((value) => value + 1)}>Thử tải lại</button></div>}
          noData={<div className="native-pdf-document-canvas native-pdf-error" role="alert"><p>Tệp PDF trống hoặc không hợp lệ.</p></div>}
          suspense={false}
        >
          {showThumbnails && (
            <aside className="native-pdf-thumbnails" aria-label="Danh sách trang PDF">
              {Array.from({ length: pageCount }, (_, index) => {
                const page = index + 1;
                return (
                  <button key={page} type="button" className={`native-pdf-thumbnail${currentPage === page ? ' is-active' : ''}`} onClick={() => goToPage(page)} aria-label={`Mở trang ${page}`} aria-current={currentPage === page ? 'page' : undefined}>
                    <Thumbnail pageNumber={page} width={112} />
                    <span>Trang {page}</span>
                  </button>
                );
              })}
            </aside>
          )}
          <div ref={canvasRef} className="native-pdf-document-canvas" onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); }
            if ((event.ctrlKey || event.metaKey) && (event.key === '+' || event.key === '=')) { event.preventDefault(); changeZoom(1); }
            if ((event.ctrlKey || event.metaKey) && event.key === '-') { event.preventDefault(); changeZoom(-1); }
            if ((event.ctrlKey || event.metaKey) && event.key === '0') { event.preventDefault(); setScale(1); setFitMode('width'); }
            if (event.key === 'PageDown') { event.preventDefault(); goToPage(currentPage + 1); }
            if (event.key === 'PageUp') { event.preventDefault(); goToPage(currentPage - 1); }
          }} tabIndex={0} aria-label="Các trang của tài liệu PDF">
            <div className="native-pdf-pages" style={{ width: `${pageWidth}px` }}>
              {Array.from({ length: pageCount }, (_, index) => {
                const page = index + 1;
                return (
                  <article key={page} id={`pdf-${viewerId}-page-${page}`} data-pdf-page={page} className="native-pdf-page-card" aria-label={`Trang ${page} trên ${pageCount}`}>
                    <Page
                      pageNumber={page}
                      width={pageWidth}
                      renderAnnotationLayer
                      renderTextLayer
                      customTextRenderer={customTextRenderer}
                      className="native-pdf-rendered-page"
                      onLoadSuccess={onPageLoadSuccess}
                      loading={<div className="native-pdf-page-skeleton" aria-hidden="true" />}
                    />
                  </article>
                );
              })}
            </div>
          </div>
        </Document>
      )}
    </section>
  );
}

export default NativePdfViewer;
