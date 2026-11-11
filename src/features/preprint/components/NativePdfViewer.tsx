'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { firebaseAuth } from '@/lib/firebase/client';
import { fetchPdfFromWorker } from '@/lib/cloudflare/worker-client';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface NativePdfViewerProps {
  url: string;
  fileName?: string;
}

export function NativePdfViewer({ url, fileName }: NativePdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState<number>(1.0);
  const [containerWidth, setContainerWidth] = useState<number>(850);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let createdObjectUrl: string | null = null;
    setPdfObjectUrl(null);
    setPdfError(null);
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
          if (firebaseAuth().currentUser) {
            blob = await fetchPdfFromWorker(key, publicationId);
          } else {
            const response = await fetch(parsed.toString(), { cache: 'no-store' });
            if (!response.ok) throw new Error(`PDF request failed (${response.status}).`);
            blob = await response.blob();
          }
        } else {
          const response = await fetch(parsed.toString(), { cache: 'no-store' });
          if (!response.ok) throw new Error(`PDF request failed (${response.status}).`);
          blob = await response.blob();
        }
        createdObjectUrl = URL.createObjectURL(blob);
        if (active) setPdfObjectUrl(createdObjectUrl);
        else URL.revokeObjectURL(createdObjectUrl);
      } catch (error) {
        if (active) setPdfError(error instanceof Error ? error.message : 'Could not load the PDF.');
      } finally {
        if (active) setPdfLoading(false);
      }
    }

    void loadPdf();
    return () => {
      active = false;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [url]);

  useEffect(() => {
    function updateWidth() {
      if (containerRef.current) {
        // Leave comfortable padding around the paper on mobile vs desktop
        const clientW = containerRef.current.clientWidth;
        const padding = clientW < 500 ? 16 : 48;
        const measured = clientW - padding;
        if (measured > 120) {
          setContainerWidth(Math.min(measured, 950));
        }
      }
    }

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  const zoomIn = () => setScale((prev) => Math.min(prev + 0.15, 2.0));
  const zoomOut = () => setScale((prev) => Math.max(prev - 0.15, 0.6));
  const resetZoom = () => setScale(1.0);

  return (
    <div className="native-pdf-wrapper" ref={containerRef}>
      {/* Clean Single-Row Document Control Bar */}
      <div className="native-pdf-toolbar">
        <div className="native-pdf-toolbar__left">
          <div className="native-pdf-toolbar__file-badge" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
          </div>
          <span className="native-pdf-toolbar__title" title={fileName || 'manuscript.pdf'}>
            {fileName || 'Tài liệu bản thảo'}
          </span>
          {numPages && (
            <span className="native-pdf-toolbar__pages">
              · {numPages} trang
            </span>
          )}
        </div>

        <div className="native-pdf-toolbar__right">
          {/* Zoom controls */}
          <div className="native-pdf-toolbar__zoom">
            <button
              type="button"
              className="native-pdf-btn native-pdf-btn--icon"
              onClick={zoomOut}
              disabled={scale <= 0.6}
              title="Thu nhỏ"
              aria-label="Thu nhỏ"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <span className="native-pdf-zoom-val">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="native-pdf-btn native-pdf-btn--icon"
              onClick={zoomIn}
              disabled={scale >= 2.0}
              title="Phóng to"
              aria-label="Phóng to"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          <div className="native-pdf-toolbar__divider" aria-hidden="true" />

          {/* Action buttons */}
          <div className="native-pdf-toolbar__actions">
            <a
              href={pdfObjectUrl || undefined}
              target="_blank"
              rel="noreferrer"
              className="native-pdf-btn native-pdf-btn--outline"
              aria-disabled={!pdfObjectUrl}
              onClick={(event) => { if (!pdfObjectUrl) event.preventDefault(); }}
              title="Mở PDF trong tab mới"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              <span className="native-pdf-btn__text">Mở tab mới</span>
            </a>

            <a
              href={pdfObjectUrl || undefined}
              download={fileName || 'manuscript.pdf'}
              className="native-pdf-btn native-pdf-btn--primary"
              aria-disabled={!pdfObjectUrl}
              onClick={(event) => { if (!pdfObjectUrl) event.preventDefault(); }}
              title="Tải xuống tệp PDF"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span className="native-pdf-btn__text">Tải xuống</span>
            </a>
          </div>
        </div>
      </div>

      {/* Direct Paper Stream on Clean Background */}
      <div className="native-pdf-document-canvas">
        {pdfLoading ? (
          <div className="native-pdf-loading">
            <div className="student-spinner" />
            <p>Loading PDF…</p>
          </div>
        ) : pdfError || !pdfObjectUrl ? (
          <div className="native-pdf-error">
            <p>{pdfError || 'Could not load the PDF.'}</p>
          </div>
        ) : (
        <Document
          file={pdfObjectUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="native-pdf-loading">
              <div className="student-spinner" />
              <p>Đang tải các trang bản thảo…</p>
            </div>
          }
          error={
            <div className="native-pdf-error">
              <p>Không thể hiển thị tệp PDF trực tiếp.</p>
              <a href={pdfObjectUrl || undefined} target="_blank" rel="noreferrer" className="student-btn student-btn--primary">
                Mở / Tải tệp PDF
              </a>
            </div>
          }
        >
          {numPages &&
            Array.from(new Array(numPages), (_, index) => (
              <div key={`page_${index + 1}`} className="native-pdf-page-card">
                <div className="native-pdf-page-badge">
                  Trang {index + 1} / {numPages}
                </div>
                <Page
                  pageNumber={index + 1}
                  width={containerWidth * scale}
                  renderAnnotationLayer={false}
                  renderTextLayer={true}
                  className="native-pdf-rendered-page"
                />
              </div>
            ))}
        </Document>
        )}
      </div>
    </div>
  );
}

export default NativePdfViewer;
