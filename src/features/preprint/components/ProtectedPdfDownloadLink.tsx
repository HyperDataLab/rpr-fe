'use client';

import { useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { firebaseAuth } from '@/lib/firebase/client';
import { fetchPdfFromWorker } from '@/lib/cloudflare/worker-client';

interface ProtectedPdfDownloadLinkProps {
  url: string;
  fileName?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
  onError?: (error: Error) => void;
}

async function fetchPdf(url: string): Promise<Blob> {
  const parsed = new URL(url, window.location.href);
  const workerBase = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
  if (workerBase && parsed.origin === new URL(workerBase).origin && parsed.pathname === '/r2/object') {
    const key = parsed.searchParams.get('key') || '';
    const publicationId = parsed.searchParams.get('publicationId') || '';
    if (!key || !publicationId) throw new Error('PDF link is missing its file reference.');
    if (firebaseAuth().currentUser) return fetchPdfFromWorker(key, publicationId);
  }
  const response = await fetch(parsed.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error(`PDF download failed (${response.status}).`);
  return response.blob();
}

export function ProtectedPdfDownloadLink({
  url,
  fileName = 'publication.pdf',
  className,
  style,
  title,
  children,
  onError,
}: ProtectedPdfDownloadLinkProps) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (loading) return;
    setErrorMessage(null);
    setLoading(true);
    try {
      const blob = await fetchPdf(url);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (error) {
      console.error('Could not download publication PDF', error);
      const normalizedError = error instanceof Error ? error : new Error('Could not download the PDF.');
      setErrorMessage(normalizedError.message);
      onError?.(normalizedError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <a href={url} className={className} style={style} title={title} onClick={handleClick} aria-busy={loading}>
        {loading ? 'Downloading…' : children}
      </a>
      {errorMessage && <span role="alert">{errorMessage}</span>}
    </>
  );
}

export default ProtectedPdfDownloadLink;
