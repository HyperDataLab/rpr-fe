import type { StudentPreprint, PreprintVersionInfo, ReviewNote, PreprintAnalysis, ReviewDecision } from '../types';
import { doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, collection } from 'firebase/firestore';
import { firebaseAuth, firestoreDb } from '@/lib/firebase/client';

export class ApiUnavailableError extends Error {
  code = 'API_NOT_AVAILABLE' as const;
}

export class PreprintApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'PreprintApiError';
    this.code = code;
    this.details = details;
  }
}

type BackendPublicationStatus = 'PROCESSING' | 'DRAFTING' | 'REVIEWING' | 'PUBLISHED' | 'REJECTED' | 'FAILED';
type BackendVersionStatus = BackendPublicationStatus | 'ARCHIVED' | 'NEEDS_REVISION' | 'APPROVED';

type BackendAuthor = {
  id?: string;
  name: string;
  email?: string | null;
  studentId?: string | null;
  role?: 'STUDENT' | 'LECTURER' | 'ADMIN';
  userId?: string | null;
  affiliation?: string | null;
  orderIndex?: number;
  isPrimary?: boolean;
  isCorresponding?: boolean;
  verificationStatus?: string;
  source?: string;
};

type BackendReview = {
  id: string;
  versionId?: string;
  reviewerId: string;
  round?: number;
  comment?: string | null;
  recommendation?: 'PUBLISH' | 'NEEDS_REVISION' | 'REJECT' | null;
  submittedAt?: string | null;
  createdAt: string;
  reviewer?: { id: string; email: string; name?: string | null };
  assignmentRole?: 'PRIMARY' | 'SECONDARY' | 'LEGACY';
};

type BackendVersion = {
  id: string;
  publicationId: string;
  version: number;
  versionLabel: string;
  title?: string | null;
  abstract?: string | null;
  doi?: string | null;
  publicationDate?: string | null;
  discipline?: string | null;
  keywords?: string[];
  fileName: string;
  fileSize?: number | null;
  sha256?: string | null;
  changeSummary?: string | null;
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  status: BackendVersionStatus;
  isCurrent: boolean;
  downloadUrl?: string | null;
  authors?: BackendAuthor[];
};

type BackendTimelineEvent = {
  id: string;
  type: 'DRAFT_CREATED' | 'FILE_UPLOADED' | 'SUBMITTED' | 'REVIEW_SUBMITTED' | 'REJECTED' | 'REOPENED' | 'PUBLISHED';
  title: string;
  description: string;
  actor: string;
  actorId?: string | null;
  version?: string | null;
  timestamp: string;
};

type BackendPublication = {
  id: string;
  title?: string | null;
  abstract?: string | null;
  doi?: string | null;
  publicationDate?: string | null;
  discipline?: string | null;
  keywords: string[];
  objectKey: string;
  fileSize?: number | null;
  sha256?: string | null;
  currentVersion?: {
    id: string;
    version: number;
    versionLabel: string;
    fileName: string;
    submittedAt?: string | null;
  } | null;
  status: BackendPublicationStatus;
  uploaderId: string;
  currentVersionId?: string | null;
  reviewRound?: number;
  audiences?: Array<'GUEST' | 'STUDENT' | 'LECTURER'>;
  isPrivate?: boolean;
  authors?: BackendAuthor[];
  uploader?: { id: string; email: string; name?: string | null };
  downloadUrl?: string;
  createdAt: string;
  updatedAt: string;
};

function formatFileSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return undefined;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameFromObjectKey(objectKey?: string) {
  if (!objectKey) return undefined;
  return objectKey.split('/').pop() || objectKey;
}

function mapStatus(status: BackendPublicationStatus): StudentPreprint['status'] {
  switch (status) {
    case 'DRAFTING':
      return 'DRAFT';
    case 'REVIEWING':
      return 'UNDER_REVIEW';
    case 'PUBLISHED':
      return 'PUBLISHED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return 'DRAFT';
  }
}

function mapVersionStatus(status: BackendVersionStatus): PreprintVersionInfo['status'] {
  if (status === 'ARCHIVED') return 'ARCHIVED';
  if (status === 'NEEDS_REVISION') return 'NEEDS_REVISION';
  if (status === 'APPROVED') return 'APPROVED';
  return mapStatus(status as BackendPublicationStatus);
}

function mapReview(review: BackendReview): ReviewNote {
  const isSubmitted = Boolean(review.submittedAt);
  const decision: ReviewDecision = review.recommendation === 'NEEDS_REVISION'
    ? 'NEEDS_REVISION'
    : review.recommendation === 'REJECT'
      ? 'REJECTED'
      : (review.recommendation === 'PUBLISH' || (isSubmitted && (review as any).decision === 'APPROVED'))
        ? 'APPROVED'
        : 'PENDING';

  return {
    id: review.id,
    reviewer_name: review.reviewer?.name || review.reviewer?.email || 'Giảng viên hướng dẫn',
    reviewer_title: 'Giảng viên hướng dẫn',
    decision,
    comments: review.comment || '',
    created_at: review.submittedAt || review.createdAt,
    round: review.round,
    assignmentRole: review.assignmentRole,
  };
}

function mapAnalysis(analysis: {
  title?: string | null;
  abstract?: string | null;
  doi?: string | null;
  publicationDate?: string | null;
  keywords: string[];
  authors: Array<BackendAuthor & {
    verification?: {
      status: 'VERIFIED' | 'UNREGISTERED' | 'MISSING_IDENTIFIER' | 'INACTIVE';
      reason?: string;
      user?: { id: string };
    };
  }>;
}): PreprintAnalysis {
  return {
    title: analysis.title,
    abstract: analysis.abstract,
    doi: analysis.doi,
    publicationDate: analysis.publicationDate,
    keywords: analysis.keywords || [],
    authors: analysis.authors.map((author, index) => ({
      name: author.name,
      email: author.email || '',
      studentId: author.studentId || undefined,
      role: author.role || 'STUDENT',
      userId: author.userId || author.verification?.user?.id,
      verificationStatus: author.verification?.status,
      verificationReason: author.verification?.reason,
      institution: author.affiliation || '',
      isPrimary: index === 0,
      isCorresponding: index === 0,
    })),
  };
}

function mapVersion(version: BackendVersion): PreprintVersionInfo {
  return {
    version: version.version,
    version_label: version.versionLabel,
    created_at: version.createdAt,
    change_summary: version.changeSummary || undefined,
    file_name: version.fileName,
    file_size: formatFileSize(version.fileSize) || 'Size unavailable',
    sha256: version.sha256 || undefined,
    status: mapVersionStatus(version.status),
    is_current: version.isCurrent,
    submitted_at: version.submittedAt || undefined,
    download_url: version.downloadUrl || undefined,
    authors: (version.authors || []).map((author, index) => ({
      name: author.name,
      email: author.email || '',
      studentId: author.studentId || undefined,
      role: author.role,
      userId: author.userId || undefined,
      institution: author.affiliation || '',
      isPrimary: index === 0,
      isCorresponding: index === 0,
    })),
  };
}

function normalizePublication(
  publication: BackendPublication,
  reviews: BackendReview[] = [],
  versions: BackendVersion[] = [],
  timeline: BackendTimelineEvent[] = [],
): StudentPreprint {
  const currentVersion = publication.currentVersion?.version || versions.find((version) => version.isCurrent)?.version || 1;
  const allReviews = reviews.length > 0 ? reviews : ((publication as any).reviews || []);
  // Only expose primary lecturer reviews to student
  const primaryReviews = allReviews.filter((r: any) => r.assignmentRole !== 'SECONDARY');
  const hasNeedsRevision = primaryReviews.some((r: any) => r.recommendation === 'NEEDS_REVISION' || r.decision === 'NEEDS_REVISION');
  const isDraftWithSubmission = publication.status === 'DRAFTING' && Boolean(publication.currentVersion?.submittedAt);
  const revisionRequired = publication.status === 'DRAFTING' && (isDraftWithSubmission || hasNeedsRevision);

  let status: StudentPreprint['status'] = mapStatus(publication.status);
  if (publication.status === 'DRAFTING' && (hasNeedsRevision || isDraftWithSubmission)) {
    status = 'NEEDS_REVISION';
  }

  const primaryReview = primaryReviews.find((r: any) => r.assignmentRole === 'PRIMARY') || primaryReviews[0];
  const lecturerAuthor = (publication.authors || []).find((a: any) => a.role === 'LECTURER' || (a as any).author?.role === 'LECTURER');
  const supervisorName = primaryReview?.reviewer?.name || (primaryReview as any)?.reviewer_name || lecturerAuthor?.name || (lecturerAuthor as any)?.author?.name;

  return {
    id: publication.id,
    title: publication.title || fileNameFromObjectKey(publication.objectKey) || 'Untitled manuscript',
    titleNeedsInput: !publication.title?.trim(),
    abstract: publication.abstract || undefined,
    discipline: publication.discipline || '',
    keywords: publication.keywords || [],
    audiences: publication.audiences || [],
    is_private: Boolean(publication.isPrivate ?? (publication as any).is_private),
    status,
    current_version: currentVersion,
    revision_required: revisionRequired,
    change_summary: (publication.currentVersion as any)?.changeSummary || versions.find((v) => v.isCurrent)?.changeSummary || undefined,
    authors: (publication.authors || []).map((author, index) => ({
      name: author.name,
      email: author.email || '',
      studentId: author.studentId || undefined,
      role: author.role,
      userId: author.userId || undefined,
      institution: author.affiliation || '',
      isPrimary: index === 0,
      isCorresponding: index === 0,
    })),
    supervisor: supervisorName || undefined,
    file_name: publication.currentVersion?.fileName || fileNameFromObjectKey(publication.objectKey),
    file_size: formatFileSize(publication.fileSize),
    sha256: publication.sha256 || undefined,
    doi: publication.doi || undefined,
    download_url: publication.downloadUrl || versions.find((v) => v.isCurrent)?.downloadUrl || versions[0]?.downloadUrl || (publication.currentVersion as any)?.downloadUrl,
    updated_at: publication.updatedAt,
    submitted_at: publication.status === 'DRAFTING' ? undefined : publication.updatedAt,
    reviews: primaryReviews.map(mapReview),
    timeline: timeline.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      description: event.description,
      actor: event.actor,
      timestamp: event.timestamp,
      version: event.version,
    })),
    versions: versions.map(mapVersion),
  };
}

const c = {
  profiles: 'userProfiles',
  publications: 'publications',
  authors: 'authors',
  publicationAuthors: 'publicationAuthors',
  reviews: 'publicationReviews',
  versions: 'publicationVersions',
  versionAuthors: 'publicationVersionAuthors',
  events: 'publicationEvents',
} as const;

type FirestoreRow = Record<string, any> & { id: string };

function dateIso(value: any): string {
  if (typeof value === 'string') return value;
  if (value?.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(0).toISOString();
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signedInUser() {
  const user = firebaseAuth().currentUser;
  if (!user) throw new PreprintApiError('Bạn cần đăng nhập để tiếp tục.', 'AUTH_REQUIRED');
  return user;
}

async function rows(collectionName: string, ...constraints: any[]) {
  const ref = collection(firestoreDb(), collectionName);
  const result = constraints.length
    ? await getDocs(query(ref, ...constraints))
    : await getDocs(ref);
  return result.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as FirestoreRow));
}

function workerBaseUrl() {
  const url = process.env.NEXT_PUBLIC_R2_WORKER_URL?.trim();
  if (!url) throw new PreprintApiError('Cloudflare Worker chưa được cấu hình.', 'WORKER_NOT_CONFIGURED');
  return url.replace(/\/$/, '');
}

async function workerRequest(path: string, init: RequestInit = {}) {
  const user = await signedInUser();
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${workerBaseUrl()}${path}`, { ...init, headers, cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new PreprintApiError(body?.message || body?.error || `Cloudflare Worker request failed (${response.status}).`, `WORKER_${response.status}`);
  }
  return response;
}

async function uploadPdfToWorker(file: File) {
  const path = `/r2/upload?fileName=${encodeURIComponent(file.name)}`;
  const response = await workerRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  });
  const body = await response.json() as { data?: { objectKey?: string } };
  if (!body.data?.objectKey) throw new PreprintApiError('Worker không trả về object key hợp lệ.', 'R2_UPLOAD_FAILED');
  return body.data.objectKey;
}

function grobidBaseUrl() {
  const url = process.env.NEXT_PUBLIC_GROBID_URL?.trim() || 'https://grobid.hyperdatalab.org';
  return url.replace(/\/$/, '');
}

function parseTei(teiXml: string): Parameters<typeof mapAnalysis>[0] {
  const xml = new DOMParser().parseFromString(teiXml, 'application/xml');
  if (xml.querySelector('parsererror')) throw new PreprintApiError('GROBID trả về TEI XML không hợp lệ.', 'GROBID_INVALID_RESPONSE');
  const elements = (name: string) => Array.from(xml.getElementsByTagNameNS('*', name));
  const text = (node?: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const title = text(elements('title')[0]);
  const abstract = text(elements('abstract')[0]);
  const doi = elements('idno').map((node) => ({ type: node.getAttribute('type'), value: text(node) }))
    .find((item) => item.type?.toLowerCase() === 'doi')?.value;
  const dateNode = elements('date').find((node) => node.getAttribute('when') || node.getAttribute('from'));
  const publicationDate = dateNode?.getAttribute('when') || dateNode?.getAttribute('from') || undefined;
  const keywords = elements('keyword').map(text).filter(Boolean);
  const authors = elements('author').map((author, index) => {
    const person = author.getElementsByTagNameNS('*', 'persName')[0];
    const forenames = Array.from(person?.getElementsByTagNameNS('*', 'forename') || []).map(text).filter(Boolean);
    const surnames = Array.from(person?.getElementsByTagNameNS('*', 'surname') || []).map(text).filter(Boolean);
    const name = [...forenames, ...surnames].join(' ').trim() || text(person) || text(author);
    const email = text(author.getElementsByTagNameNS('*', 'email')[0]);
    const affiliation = text(author.getElementsByTagNameNS('*', 'orgName')[0]);
    return { name, email: email || undefined, affiliation: affiliation || undefined, orderIndex: index, role: 'STUDENT' as const };
  }).filter((author) => author.name);
  return { title: title || undefined, abstract: abstract || undefined, doi, publicationDate, keywords, authors };
}

async function analyzeWithGrobid(file: File): Promise<Parameters<typeof mapAnalysis>[0]> {
  const form = new FormData();
  form.append('input', file, file.name);
  form.append('consolidateHeader', '0');
  try {
    const response = await fetch(`${grobidBaseUrl()}/api/processHeaderDocument`, {
      method: 'POST',
      headers: { Accept: 'application/xml' },
      body: form,
      cache: 'no-store',
    });
    if (!response.ok) {
      const details = (await response.text().catch(() => '')).slice(0, 500);
      throw new PreprintApiError(
        details || `GROBID request failed (${response.status}).`,
        `GROBID_${response.status}`,
      );
    }
    const teiXml = await response.text();
    if (!teiXml.trim()) throw new PreprintApiError('GROBID không trích xuất được dữ liệu từ PDF này.', 'GROBID_EMPTY_RESPONSE');
    const parsed = parseTei(teiXml);
    if (!parsed.authors.length) {
      const user = await signedInUser();
      const profile = await getDoc(doc(firestoreDb(), c.profiles, user.uid));
      const data = profile.data() || {};
      parsed.authors = [{
        name: String(data.name || [data.firstName, data.lastName].filter(Boolean).join(' ') || user.displayName || user.email || 'Author'),
        email: user.email || undefined,
        studentId: typeof data.studentId === 'string' ? data.studentId : undefined,
        role: data.role === 'LECTURER' ? 'LECTURER' : 'STUDENT',
        userId: user.uid,
      }];
    }
    return parsed;
  } catch (error) {
    if (error instanceof PreprintApiError) throw error;
    const message = error instanceof Error ? error.message : 'Không kết nối được dịch vụ GROBID.';
    throw new PreprintApiError(`Không thể trích xuất PDF bằng GROBID: ${message}`, 'GROBID_UNAVAILABLE');
  }
}

function downloadUrl(objectKey?: string, publicationId?: string) {
  if (!objectKey || !publicationId) return undefined;
  return `${workerBaseUrl()}/r2/object?key=${encodeURIComponent(objectKey)}&publicationId=${encodeURIComponent(publicationId)}`;
}

async function getPublication(id: string): Promise<BackendPublication | null> {
  const snapshot = await getDoc(doc(firestoreDb(), c.publications, id));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as BackendPublication) : null;
}

async function getPublicationAuthors(publicationId: string): Promise<BackendAuthor[]> {
  const links = await rows(c.publicationAuthors, where('publicationId', '==', publicationId), orderBy('orderIndex', 'asc'));
  // Publication links already carry the display fields. The global authors
  // collection is intentionally admin-only, so client reads must use the
  // publication-scoped copy instead of fetching author records.
  return links.map((link) => ({
    id: link.authorId,
    name: String(link.name || ''),
    email: link.email ?? null,
    studentId: link.studentId ?? null,
    role: link.role,
    userId: link.userId ?? null,
    affiliation: link.affiliation ?? null,
    orderIndex: Number(link.orderIndex || 0),
  } as BackendAuthor));
}

async function getReviews(publicationId: string): Promise<BackendReview[]> {
  const reviews = await rows(c.reviews, where('publicationId', '==', publicationId));
  return Promise.all(reviews.map(async (review) => {
    let reviewer: Record<string, any> = {};
    if (review.reviewerId) {
      try {
        const profile = await getDoc(doc(firestoreDb(), c.profiles, String(review.reviewerId)));
        reviewer = profile.exists() ? profile.data() : {};
      } catch {
        // A hidden profile must not make an otherwise-readable review fail.
      }
    }
    return {
      ...review,
      createdAt: dateIso(review.createdAt),
      submittedAt: review.submittedAt ? dateIso(review.submittedAt) : null,
      reviewer: reviewer ? { id: String(review.reviewerId), name: reviewer.name || '', email: reviewer.email || '' } : undefined,
    } as BackendReview;
  }));
}

async function getVersions(publicationId: string, currentStatus: BackendPublicationStatus): Promise<BackendVersion[]> {
  const versions = await rows(c.versions, where('publicationId', '==', publicationId), orderBy('versionNumber', 'desc'));
  return Promise.all(versions.map(async (version) => {
    const versionAuthors = await rows(c.versionAuthors, where('publicationVersionId', '==', version.id), orderBy('orderIndex', 'asc'));
    const isCurrent = version.id === (await getPublication(publicationId))?.currentVersionId;
    return {
      ...version,
      version: Number(version.versionNumber || 1),
      versionLabel: `v${Number(version.versionNumber || 1)}`,
      createdAt: dateIso(version.createdAt),
      updatedAt: dateIso(version.updatedAt),
      submittedAt: version.submittedAt ? dateIso(version.submittedAt) : null,
      status: isCurrent ? currentStatus : 'ARCHIVED',
      isCurrent,
      fileName: String(version.fileName || fileNameFromObjectKey(version.objectKey) || 'publication.pdf'),
      downloadUrl: downloadUrl(version.objectKey, publicationId),
      authors: versionAuthors as BackendAuthor[],
    } as BackendVersion;
  }));
}

async function getTimeline(publicationId: string): Promise<BackendTimelineEvent[]> {
  const events = await rows(c.events, where('publicationId', '==', publicationId), orderBy('createdAt', 'asc'));
  return Promise.all(events.map(async (event) => {
    let actor: Record<string, any> = {};
    if (event.actorId) {
      try {
        const profile = await getDoc(doc(firestoreDb(), c.profiles, String(event.actorId)));
        actor = profile.exists() ? profile.data() : {};
      } catch {
        // Event visibility does not depend on reading another user's profile.
      }
    }
    const payload = (event.payload || {}) as Record<string, unknown>;
    const type = String(event.type || 'FILE_UPLOADED');
    const titleByType: Record<string, string> = {
      DRAFT_CREATED: 'Draft created', FILE_UPLOADED: 'File uploaded', SUBMITTED: 'Submitted for review',
      REVIEW_SUBMITTED: 'Review submitted', REJECTED: 'Publication rejected', REOPENED: 'Revision requested',
      PUBLISHED: 'Published', REVIEW_ASSIGNED: 'Reviewers assigned',
    };
    return {
      id: event.id,
      type: type as BackendTimelineEvent['type'],
      title: titleByType[type] || 'Publication updated',
      description: String(payload.changeSummary || payload.fileName || payload.reason || titleByType[type] || 'Publication updated'),
      actor: String(actor?.name || actor?.email || 'System'),
      actorId: event.actorId || null,
      version: payload.versionNumber ? `v${payload.versionNumber}` : null,
      timestamp: dateIso(event.createdAt),
    } as BackendTimelineEvent;
  }));
}

async function aggregatePublication(id: string): Promise<{ publication: BackendPublication; reviews: BackendReview[]; versions: BackendVersion[]; timeline: BackendTimelineEvent[] } | null> {
  const publication = await getPublication(id);
  if (!publication) return null;
  const [authors, reviews, timeline] = await Promise.all([
    getPublicationAuthors(id),
    getReviews(id),
    getTimeline(id),
  ]);
  const currentVersionDoc = publication.currentVersionId
    ? await getDoc(doc(firestoreDb(), c.versions, publication.currentVersionId))
    : null;
  const currentVersionData = currentVersionDoc?.exists() ? currentVersionDoc.data() : null;
  const versions = await getVersions(id, publication.status);
  let uploader: Record<string, any> = {};
  if (publication.uploaderId) {
    try {
      const profile = await getDoc(doc(firestoreDb(), c.profiles, publication.uploaderId));
      uploader = profile.exists() ? profile.data() : {};
    } catch {
      // Profile visibility may be narrower than publication visibility.
    }
  }
  const currentVersion = currentVersionData ? {
    id: currentVersionDoc!.id,
    version: Number(currentVersionData.versionNumber || 1),
    versionLabel: `v${Number(currentVersionData.versionNumber || 1)}`,
    fileName: currentVersionData.fileName,
    submittedAt: currentVersionData.submittedAt ? dateIso(currentVersionData.submittedAt) : null,
    changeSummary: currentVersionData.changeSummary || null,
    downloadUrl: downloadUrl(currentVersionData.objectKey, id),
  } : null;
  return {
    publication: {
      ...publication,
      publicationDate: publication.publicationDate ? dateIso(publication.publicationDate) : null,
      createdAt: dateIso(publication.createdAt),
      updatedAt: dateIso(publication.updatedAt),
      fileName: currentVersionData?.fileName || fileNameFromObjectKey(publication.objectKey),
      currentVersion,
      downloadUrl: downloadUrl(publication.objectKey, id),
      authors,
      uploader: { id: publication.uploaderId, email: uploader?.email || '', name: uploader?.name || '' },
    } as BackendPublication,
    reviews,
    versions,
    timeline,
  };
}

async function addAuthorsToBatch(batch: ReturnType<typeof writeBatch>, publicationId: string, versionId: string, authors: BackendAuthor[]) {
  for (const [index, author] of authors.entries()) {
    if (!author.name.trim()) continue;
    const authorId = crypto.randomUUID();
    const linkId = `${encodeURIComponent(publicationId)}__${encodeURIComponent(authorId)}`;
    const authorData = {
      id: authorId,
      name: author.name.trim(),
      email: author.email?.trim().toLowerCase() || null,
      studentId: author.studentId?.trim() || null,
      role: author.role || 'STUDENT',
      userId: author.userId || null,
      affiliation: author.affiliation?.trim() || null,
      source: author.source || 'USER',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(doc(firestoreDb(), c.publicationAuthors, linkId), {
      ...authorData,
      id: linkId,
      publicationId,
      authorId,
      orderIndex: author.orderIndex ?? index,
      isPrimary: author.isPrimary ?? index === 0,
      isCorresponding: author.isCorresponding ?? index === 0,
      verificationStatus: author.userId ? 'VERIFIED' : 'UNLINKED',
    });
    const versionAuthorId = crypto.randomUUID();
    batch.set(doc(firestoreDb(), c.versionAuthors, versionAuthorId), {
      id: versionAuthorId,
      authorId,
      publicationVersionId: versionId,
      name: authorData.name,
      email: authorData.email,
      studentId: authorData.studentId,
      role: authorData.role,
      userId: authorData.userId,
      affiliation: authorData.affiliation,
      orderIndex: author.orderIndex ?? index,
      isPrimary: author.isPrimary ?? index === 0,
      isCorresponding: author.isCorresponding ?? index === 0,
      verificationStatus: authorData.userId ? 'VERIFIED' : 'UNLINKED',
      source: authorData.source || 'USER',
      createdAt: serverTimestamp(),
    });
  }
}

async function appendEvent(publicationId: string, actorId: string, type: string, payload: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  await setDoc(doc(firestoreDb(), c.events, id), {
    id,
    publicationId,
    actorId,
    type,
    payload,
    createdAt: serverTimestamp(),
  });
}

async function savePublicationMetadata(id: string, payload: Record<string, any>, userId: string) {
  const snapshot = await getDoc(doc(firestoreDb(), c.publications, id));
  if (!snapshot.exists()) throw new PreprintApiError('Không tìm thấy bài báo.', 'PUBLICATION_NOT_FOUND');
  const current = snapshot.data();
  if (current.uploaderId !== userId) throw new PreprintApiError('Bạn chỉ có thể sửa bài báo của mình.', 'FORBIDDEN');
  if (current.status !== 'DRAFTING' && current.status !== 'PUBLISHED') {
    throw new PreprintApiError('Bài báo không ở trạng thái có thể chỉnh sửa.', 'INVALID_STATUS');
  }
  if (current.status === 'PUBLISHED' && (Array.isArray(payload.authors) || payload.isPrivate !== undefined)) {
    throw new PreprintApiError('Authors and privacy settings on a published paper require an editorial workflow.', 'INVALID_STATUS');
  }
  const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
  for (const key of ['title', 'abstract', 'doi', 'discipline', ...(current.status === 'DRAFTING' ? ['isPrivate'] : [])]) {
    if (payload[key] !== undefined) update[key] = typeof payload[key] === 'string' ? payload[key].trim() : payload[key];
  }
  if (payload.publicationDate !== undefined) update.publicationDate = payload.publicationDate ? new Date(payload.publicationDate) : null;
  if (payload.keywords !== undefined) update.keywords = payload.keywords.map((value: string) => value.trim()).filter(Boolean);
  const currentVersionId = String(current.currentVersionId || '');
  if (currentVersionId && current.status === 'DRAFTING') {
    const versionPatch = Object.fromEntries(Object.entries(update).filter(([key]) => key !== 'updatedAt'));
    if (Object.keys(versionPatch).length) {
      await updateDoc(doc(firestoreDb(), c.versions, currentVersionId), { ...versionPatch, updatedAt: serverTimestamp() });
    }
  }
  await updateDoc(doc(firestoreDb(), c.publications, id), update);
  if (Array.isArray(payload.authors)) {
    const existing = await rows(c.publicationAuthors, where('publicationId', '==', id));
    const existingVersionAuthors = currentVersionId
      ? await rows(c.versionAuthors, where('publicationVersionId', '==', currentVersionId))
      : [];
    const batch = writeBatch(firestoreDb());
    existing.forEach((link) => batch.delete(doc(firestoreDb(), c.publicationAuthors, link.id)));
    existingVersionAuthors.forEach((author) => batch.delete(doc(firestoreDb(), c.versionAuthors, author.id)));
    const normalized = payload.authors.filter((author: BackendAuthor) => author.name?.trim()).map((author: BackendAuthor, index: number) => ({ ...author, orderIndex: author.orderIndex ?? index }));
    await addAuthorsToBatch(batch, id, currentVersionId, normalized);
    await batch.commit();
  }
  await appendEvent(id, userId, 'FILE_UPLOADED', { changeSummary: payload.changeSummary || 'Metadata updated' });
}

export const studentPreprintApi = {
  listMine: async (): Promise<{ items: StudentPreprint[] }> => {
    const user = await signedInUser();
    const publications = await rows(c.publications, where('uploaderId', '==', user.uid), orderBy('updatedAt', 'desc'));
    const items = await Promise.all(publications.map(async (item) => {
      const aggregate = await aggregatePublication(item.id);
      return aggregate ? normalizePublication(aggregate.publication, aggregate.reviews, aggregate.versions, aggregate.timeline) : null;
    }));
    return { items: items.filter((item): item is StudentPreprint => Boolean(item)) };
  },

  get: async (id: string): Promise<StudentPreprint> => {
    const aggregate = await aggregatePublication(id);
    if (!aggregate) throw new PreprintApiError('Không tìm thấy bài báo.', 'PUBLICATION_NOT_FOUND');
    return normalizePublication(aggregate.publication, aggregate.reviews, aggregate.versions, aggregate.timeline);
  },

  analyze: async (file: File): Promise<PreprintAnalysis> => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new PreprintApiError('Chỉ chấp nhận tệp PDF.', 'INVALID_FILE_TYPE');
    }
    if (!file.size) throw new PreprintApiError('Tệp PDF rỗng.', 'EMPTY_FILE');
    return mapAnalysis(await analyzeWithGrobid(file));
  },

  upload: async (
    file: File,
    intent: 'DRAFT' | 'SUBMIT',
    metadata: {
      title?: string;
      abstract?: string;
      doi?: string;
      publicationDate?: string;
      discipline?: string;
      keywords: string[];
      isPrivate?: boolean;
      authors: Array<{
        name: string;
        email?: string;
        studentId?: string;
        role?: 'STUDENT' | 'LECTURER' | 'ADMIN';
        affiliation?: string;
        orderIndex?: number;
        userId?: string | null;
        isPrimary?: boolean;
        isCorresponding?: boolean;
      }>;
    },
  ): Promise<StudentPreprint> => {
    const user = await signedInUser();
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new PreprintApiError('Chỉ chấp nhận tệp PDF.', 'INVALID_FILE_TYPE');
    if (!file.size || file.size > 50 * 1024 * 1024) throw new PreprintApiError('Tệp PDF phải có dung lượng từ 1 byte đến 50 MB.', 'INVALID_FILE_SIZE');
    const authors = metadata.authors.filter((author) => author.name?.trim()).map((author, index) => ({ ...author, name: author.name.trim(), orderIndex: author.orderIndex ?? index }));
    if (intent === 'SUBMIT' && (!metadata.title?.trim() || !metadata.discipline?.trim() || !authors.length)) {
      throw new PreprintApiError('Cần nhập tiêu đề, lĩnh vực nghiên cứu và ít nhất một tác giả trước khi nộp.', 'SUBMISSION_INCOMPLETE');
    }
    if (intent === 'SUBMIT' && authors.filter((author) => author.isPrimary).length > 1) {
      throw new PreprintApiError('Chỉ được chọn một tác giả chính.', 'INVALID_PRIMARY_AUTHOR');
    }
    if (authors.length && !authors.some((author) => author.isPrimary)) authors[0]!.isPrimary = true;
    if (authors.length && !authors.some((author) => author.isCorresponding)) authors[0]!.isCorresponding = true;
    const objectKey = await uploadPdfToWorker(file);
    const db = firestoreDb();
    const publicationId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const now = new Date();
    const date = toDate(metadata.publicationDate);
    const title = metadata.title?.trim() || null;
    const status: BackendPublicationStatus = intent === 'SUBMIT' ? 'REVIEWING' : 'DRAFTING';
    const batch = writeBatch(db);
    batch.set(doc(db, c.publications, publicationId), {
      id: publicationId, title, abstract: metadata.abstract?.trim() || null, doi: metadata.doi?.trim() || null,
      publicationDate: date, keywords: metadata.keywords.map((keyword) => keyword.trim()).filter(Boolean),
      objectKey, fileSize: file.size, status, rawTeiXml: null, uploaderId: user.uid,
      createdAt: now, updatedAt: now, reviewRound: intent === 'SUBMIT' ? 1 : 0, currentVersionId: versionId,
      discipline: metadata.discipline?.trim() || null, audiences: [], isPrivate: metadata.isPrivate === true,
    });
    batch.set(doc(db, c.versions, versionId), {
      id: versionId, publicationId, versionNumber: 1, title, abstract: metadata.abstract?.trim() || null,
      doi: metadata.doi?.trim() || null, publicationDate: date, keywords: metadata.keywords.map((keyword) => keyword.trim()).filter(Boolean),
      objectKey, fileName: file.name, fileSize: file.size, sha256: await hashFile(file), rawTeiXml: null,
      changeSummary: null, submittedAt: intent === 'SUBMIT' ? now : null, createdById: user.uid,
      createdAt: now, updatedAt: now, discipline: metadata.discipline?.trim() || null,
    });
    await addAuthorsToBatch(batch, publicationId, versionId, authors as BackendAuthor[]);
    const eventTypes = ['DRAFT_CREATED', 'FILE_UPLOADED', ...(intent === 'SUBMIT' ? ['SUBMITTED'] : [])];
    eventTypes.forEach((type) => {
      const eventId = crypto.randomUUID();
      batch.set(doc(db, c.events, eventId), {
        id: eventId, publicationId, versionId, actorId: user.uid, type,
        payload: { source: 'direct-upload', intent, fileName: file.name },
        createdAt: new Date(now.getTime() + eventTypes.indexOf(type)),
      });
    });
    await batch.commit();
    return studentPreprintApi.get(publicationId);
  },

  uploadRevision: async (id: string, file: File, changeSummary?: string): Promise<StudentPreprint> => {
    const user = await signedInUser();
    const publicationSnapshot = await getDoc(doc(firestoreDb(), c.publications, id));
    if (!publicationSnapshot.exists()) throw new PreprintApiError('Không tìm thấy bài báo.', 'PUBLICATION_NOT_FOUND');
    const publication = publicationSnapshot.data();
    if (publication.uploaderId !== user.uid) throw new PreprintApiError('Bạn chỉ có thể tạo phiên bản mới cho bài báo của mình.', 'FORBIDDEN');
    if (publication.status !== 'DRAFTING') throw new PreprintApiError('Published papers need the new-version workflow before they can receive revisions.', 'INVALID_STATUS');
    const objectKey = await uploadPdfToWorker(file);
    const analysis = await analyzeWithGrobid(file);
    const versions = await rows(c.versions, where('publicationId', '==', id), orderBy('versionNumber', 'desc'));
    const latest = versions[0];
    const currentVersion = versions.find((version) => version.id === publication.currentVersionId) || latest;
    const previousAuthors = currentVersion ? await rows(c.versionAuthors, where('publicationVersionId', '==', currentVersion.id), orderBy('orderIndex', 'asc')) : [];
    const authors = analysis.authors.length ? analysis.authors : previousAuthors;
    const versionId = crypto.randomUUID();
    const versionNumber = Number(latest?.versionNumber || 0) + 1;
    const now = new Date();
    const useExtracted = Boolean(analysis.title || analysis.abstract || analysis.doi || analysis.keywords.length);
    const values = {
      title: (useExtracted && analysis.title) || currentVersion?.title || publication.title || null,
      abstract: (useExtracted && analysis.abstract) || currentVersion?.abstract || publication.abstract || null,
      doi: (useExtracted && analysis.doi) || currentVersion?.doi || publication.doi || null,
      publicationDate: (useExtracted && analysis.publicationDate) || currentVersion?.publicationDate || publication.publicationDate || null,
      keywords: (useExtracted && analysis.keywords.length ? analysis.keywords : currentVersion?.keywords || publication.keywords || []),
      discipline: currentVersion?.discipline || publication.discipline || null,
    };
    const batch = writeBatch(firestoreDb());
    batch.set(doc(firestoreDb(), c.versions, versionId), {
      id: versionId, publicationId: id, versionNumber, ...values, objectKey, fileName: file.name,
      fileSize: file.size, sha256: await hashFile(file), rawTeiXml: null,
      changeSummary: changeSummary?.trim() || null, submittedAt: null, createdById: user.uid,
      createdAt: now, updatedAt: now,
    });
    await addAuthorsToBatch(batch, id, versionId, authors as BackendAuthor[]);
    if (publication.status !== 'PUBLISHED') {
      batch.update(doc(firestoreDb(), c.publications, id), { ...values, objectKey, fileSize: file.size, currentVersionId: versionId, updatedAt: now });
    }
    const eventId = crypto.randomUUID();
    batch.set(doc(firestoreDb(), c.events, eventId), {
      id: eventId, publicationId: id, versionId, actorId: user.uid, type: 'FILE_UPLOADED',
      payload: { fileName: file.name, versionNumber, changeSummary: changeSummary?.trim() || null }, createdAt: now,
    });
    await batch.commit();
    return studentPreprintApi.get(id);
  },

  retry: async (objectKey: string, fileName: string): Promise<StudentPreprint> => {
    const matches = await rows(c.publications, where('objectKey', '==', objectKey));
    const publication = matches[0];
    if (!publication) throw new PreprintApiError('Không tìm thấy bản tải lên cần xử lý lại.', 'UPLOAD_NOT_FOUND');
    const user = await signedInUser();
    if (publication.uploaderId !== user.uid) throw new PreprintApiError('Bạn chỉ có thể xử lý lại tệp của mình.', 'FORBIDDEN');
    const response = await workerRequest(`/r2/object?key=${encodeURIComponent(objectKey)}&publicationId=${encodeURIComponent(publication.id)}`);
    const file = new File([await response.blob()], fileName || fileNameFromObjectKey(objectKey) || 'publication.pdf', { type: 'application/pdf' });
    const analysis = await analyzeWithGrobid(file);
    const currentVersionId = String(publication.currentVersionId || '');
    const batch = writeBatch(firestoreDb());
    const values = {
      title: analysis.title || publication.title || null,
      abstract: analysis.abstract || publication.abstract || null,
      doi: analysis.doi || publication.doi || null,
      publicationDate: analysis.publicationDate ? new Date(analysis.publicationDate) : publication.publicationDate || null,
      keywords: analysis.keywords.length ? analysis.keywords : publication.keywords || [],
      fileSize: file.size,
      status: 'DRAFTING',
      updatedAt: serverTimestamp(),
    };
    batch.update(doc(firestoreDb(), c.publications, publication.id), values);
    if (currentVersionId) batch.update(doc(firestoreDb(), c.versions, currentVersionId), { ...values, updatedAt: serverTimestamp() });
    await batch.commit();
    return studentPreprintApi.get(publication.id);
  },

  update: async (
    id: string,
    payload: {
      title?: string;
      abstract?: string;
      doi?: string;
      publicationDate?: string;
      discipline?: string;
      keywords?: string[];
      authors?: Array<{ name: string; email?: string; studentId?: string; role?: 'STUDENT' | 'LECTURER' | 'ADMIN'; affiliation?: string; orderIndex?: number }>;
      changeSummary?: string;
      isPrivate?: boolean;
    }
  ): Promise<StudentPreprint> => {
    const user = await signedInUser();
    await savePublicationMetadata(id, payload, user.uid);
    return studentPreprintApi.get(id);
  },

  setPrivate: async (id: string, isPrivate: boolean): Promise<void> => {
    const user = await signedInUser();
    const publication = await getPublication(id);
    if (!publication) throw new PreprintApiError('Không tìm thấy bài báo.', 'PUBLICATION_NOT_FOUND');
    if (publication.uploaderId !== user.uid) throw new PreprintApiError('Bạn chỉ có thể thay đổi bài báo của mình.', 'FORBIDDEN');
    const profile = await getDoc(doc(firestoreDb(), c.profiles, user.uid));
    if (profile.data()?.role !== 'LECTURER' || publication.status !== 'DRAFTING') {
      throw new PreprintApiError('Only a lecturer owner can change privacy while the publication is a draft.', 'FORBIDDEN');
    }
    await updateDoc(doc(firestoreDb(), c.publications, id), { isPrivate, updatedAt: serverTimestamp() });
    await appendEvent(id, user.uid, isPrivate ? 'PRIVATE_ENABLED' : 'PRIVATE_DISABLED');
  },

  submit: async (id: string): Promise<StudentPreprint> => {
    const user = await signedInUser();
    const publication = await getPublication(id);
    if (!publication) throw new PreprintApiError('Không tìm thấy bài báo.', 'PUBLICATION_NOT_FOUND');
    if (publication.uploaderId !== user.uid) throw new PreprintApiError('Bạn chỉ có thể nộp bài báo của mình.', 'FORBIDDEN');
    if (!publication.title?.trim() || !publication.discipline?.trim()) throw new PreprintApiError('Cần nhập tiêu đề và lĩnh vực nghiên cứu trước khi nộp.', 'SUBMISSION_INCOMPLETE');
    if (publication.isPrivate) throw new PreprintApiError('Tắt chế độ riêng tư trước khi nộp bài.', 'PRIVATE_SUBMISSION');
    const authors = await getPublicationAuthors(id);
    if (!authors.length) throw new PreprintApiError('Cần thêm ít nhất một tác giả trước khi nộp.', 'SUBMISSION_INCOMPLETE');
    const now = new Date();
    const currentVersionId = String(publication.currentVersionId || '');
    const previousRound = Math.max(1, Number((publication as any).reviewRound || 1));
    const nextRound = Math.max(1, Number((publication as any).reviewRound || 0) + 1);
    const previousAssignments = previousRound < nextRound
      ? (await rows(c.reviews, where('publicationId', '==', id), where('round', '==', previousRound)))
        .filter((review) => ['PRIMARY', 'SECONDARY'].includes(String(review.assignmentRole)))
      : [];
    const batch = writeBatch(firestoreDb());
    batch.update(doc(firestoreDb(), c.publications, id), {
      status: 'REVIEWING', reviewRound: nextRound, updatedAt: now,
    });
    if (currentVersionId) batch.update(doc(firestoreDb(), c.versions, currentVersionId), { submittedAt: now, updatedAt: now });
    for (const assignment of previousAssignments) {
      const reviewerId = String(assignment.reviewerId || '');
      if (!reviewerId) continue;
      const reviewId = `${encodeURIComponent(id)}__${encodeURIComponent(reviewerId)}__${nextRound}`;
      batch.set(doc(firestoreDb(), c.reviews, reviewId), {
        id: reviewId,
        publicationId: id,
        reviewerId,
        round: nextRound,
        versionId: currentVersionId,
        assignmentRole: assignment.assignmentRole,
        comment: null,
        recommendation: null,
        submittedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    const eventId = crypto.randomUUID();
    if (previousAssignments.length) {
      const assignmentEventId = crypto.randomUUID();
      batch.set(doc(firestoreDb(), c.events, assignmentEventId), {
        id: assignmentEventId,
        publicationId: id,
        versionId: currentVersionId || null,
        actorId: user.uid,
        type: 'REVIEW_ASSIGNED',
        payload: {
          source: 'carry-forward',
          fromRound: previousRound,
          toRound: nextRound,
          reviewerIds: previousAssignments.map((assignment) => assignment.reviewerId),
        },
        createdAt: now,
      });
    }
    batch.set(doc(firestoreDb(), c.events, eventId), {
      id: eventId, publicationId: id, versionId: currentVersionId || null, actorId: user.uid,
      type: 'SUBMITTED', payload: { fromStatus: publication.status, toStatus: 'REVIEWING', reviewRound: nextRound }, createdAt: now,
    });
    await batch.commit();
    return studentPreprintApi.get(id);
  },

  mockSubmit: async (_id: string): Promise<StudentPreprint> => {
    throw new PreprintApiError('Bỏ qua xác minh tác giả chỉ có ở API thử nghiệm cũ; không hỗ trợ trên luồng Firebase trực tiếp.', 'DEV_BYPASS_DISABLED');
  },

  versions: async (id: string): Promise<PreprintVersionInfo[]> => {
    const publication = await getPublication(id);
    if (!publication) throw new PreprintApiError('Không tìm thấy bài báo.', 'PUBLICATION_NOT_FOUND');
    return (await getVersions(id, publication.status)).map(mapVersion);
  },

  timeline: async (id: string): Promise<StudentPreprint['timeline']> => {
    return (await getTimeline(id)).map((event) => ({
      id: event.id, type: event.type, title: event.title, description: event.description,
      actor: event.actor, timestamp: event.timestamp, version: event.version,
    }));
  },

  delete: async (id: string): Promise<void> => {
    const user = await signedInUser();
    const publication = await getPublication(id);
    if (!publication) return;
    if (publication.uploaderId !== user.uid || publication.status !== 'DRAFTING') {
      throw new PreprintApiError('Chỉ người nộp mới được xóa bài nháp.', 'FORBIDDEN');
    }
    const versions = await rows(c.versions, where('publicationId', '==', id));
    const [authorLinks, reviewRows, eventRows, versionAuthorRows] = await Promise.all([
      rows(c.publicationAuthors, where('publicationId', '==', id)),
      rows(c.reviews, where('publicationId', '==', id)),
      rows(c.events, where('publicationId', '==', id)),
      Promise.all(versions.map((version) => rows(c.versionAuthors, where('publicationVersionId', '==', version.id)))),
    ]);
    const objectKeys = new Set([publication.objectKey, ...versions.map((version) => version.objectKey)].filter((key): key is string => typeof key === 'string'));
    for (const key of objectKeys) {
      await workerRequest(`/r2/object?key=${encodeURIComponent(key)}&publicationId=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
    }
    const refs = [
      ...authorLinks.map((item) => doc(firestoreDb(), c.publicationAuthors, item.id)),
      ...reviewRows.map((item) => doc(firestoreDb(), c.reviews, item.id)),
      ...eventRows.map((item) => doc(firestoreDb(), c.events, item.id)),
      ...versionAuthorRows.flat().map((item) => doc(firestoreDb(), c.versionAuthors, item.id)),
      ...versions.map((version) => doc(firestoreDb(), c.versions, version.id)),
      // Remove the parent last so batches larger than Firestore's write limit
      // can still authorize the remaining child deletions against the draft.
      doc(firestoreDb(), c.publications, id),
    ];
    for (let offset = 0; offset < refs.length; offset += 450) {
      const batch = writeBatch(firestoreDb());
      refs.slice(offset, offset + 450).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  },
};

export default studentPreprintApi;
