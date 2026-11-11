import { firebaseAuth } from '@/lib/firebase/client';

export interface R2UploadResult {
  objectKey: string;
  fileName: string;
  size: number;
}

export async function workerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('Cloudflare Worker URL is not configured.');
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('Sign in before using the document service.');
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `Cloudflare Worker request failed (${response.status}).`);
  }
  return await response.json() as T;
}

export async function uploadPdfToWorker(file: File): Promise<R2UploadResult> {
  const baseUrl = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('Cloudflare Worker URL is not configured.');
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('Sign in before uploading a document.');
  const token = await user.getIdToken();
  const url = new URL(`${baseUrl}/r2/upload`);
  url.searchParams.set('fileName', file.name);
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': file.type || 'application/pdf' },
    body: file,
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null) as { data?: R2UploadResult; message?: string } | null;
  if (!response.ok || !body?.data) throw new Error(body?.message || `PDF upload failed (${response.status}).`);
  return body.data;
}

export async function fetchPdfFromWorker(objectKey: string, publicationId: string): Promise<Blob> {
  const baseUrl = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('Cloudflare Worker URL is not configured.');
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('Sign in before opening a document.');
  const token = await user.getIdToken();
  const url = new URL(`${baseUrl}/r2/object`);
  url.searchParams.set('key', objectKey);
  url.searchParams.set('publicationId', publicationId);
  let response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  // The Worker independently checks that anonymous requests point to a published,
  // non-private GUEST publication. Retry without auth so pending accounts can
  // still read public PDFs; access to restricted objects remains denied there.
  if (response.status === 401 || response.status === 403) {
    response = await fetch(url, { cache: 'no-store' });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `PDF download failed (${response.status}).`);
  }
  return response.blob();
}

export async function parsePdfWithWorker(file: File): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
  if (!baseUrl) throw new Error('Cloudflare Worker URL is not configured.');
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('Sign in before analyzing a document.');
  const formData = new FormData();
  formData.append('input', file, file.name);
  const response = await fetch(`${baseUrl}/api/processHeaderDocument`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await user.getIdToken()}`, accept: 'application/xml' },
    body: formData,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`PDF analysis failed (${response.status}).`);
  return response.text();
}
