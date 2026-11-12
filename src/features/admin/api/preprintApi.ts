'use client';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore';
import { firebaseAuth, firestoreDb } from '@/lib/firebase/client';
import { workerRequest } from '@/lib/cloudflare/worker-client';

export type AdminPublicationStatus = 'PROCESSING' | 'DRAFTING' | 'REVIEWING' | 'PUBLISHED' | 'REJECTED';
export type AdminDecisionStatus = 'PUBLISHED' | 'REJECTED' | 'DRAFTING';
export type AdminPublicationAudience = 'GUEST' | 'STUDENT' | 'LECTURER';

export type AdminUser = {
  id: string;
  email: string;
  workspaceEmail?: string | null;
  username?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  studentId?: string | null;
  major?: string | null;
  avatarUrl?: string | null;
  role: 'ADMIN' | 'LECTURER' | 'STUDENT';
  isActive: boolean;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
  attemptNumber?: number;
  rejectionHistory?: Array<{
    id: string;
    studentId?: string | null;
    name?: string | null;
    major?: string | null;
    attemptNumber: number;
    rejectedAt: string;
  }>;
};

export type AdminPublication = {
  id: string;
  title?: string | null;
  abstract?: string | null;
  doi?: string | null;
  publicationDate?: string | null;
  keywords: string[];
  objectKey?: string;
  fileSize?: number | null;
  downloadUrl?: string | null;
  status: AdminPublicationStatus;
  reviewRound?: number;
  audiences: AdminPublicationAudience[];
  isPrivate: boolean;
  uploader?: { id: string; name?: string | null; email: string; role?: 'ADMIN' | 'LECTURER' | 'STUDENT' | string; studentId?: string | null };
  authors?: Array<{ id?: string; name: string; email?: string | null; affiliation?: string | null; orderIndex?: number }>;
  currentVersion?: { id: string; version: number; versionLabel: string; fileName: string; submittedAt?: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminReview = {
  id: string;
  publicationId: string;
  reviewerId: string;
  versionId: string;
  round: number;
  comment?: string | null;
  recommendation?: 'PUBLISH' | 'NEEDS_REVISION' | 'REJECT' | null;
  assignmentRole?: 'PRIMARY' | 'SECONDARY' | 'LEGACY';
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  reviewer?: { id: string; name?: string | null; email: string };
  publication?: { id: string; title?: string | null; status: AdminPublicationStatus; currentVersionLabel?: string; uploader?: { id: string; name?: string | null; email: string; role?: 'ADMIN' | 'LECTURER' | 'STUDENT' | string; studentId?: string | null } };
};

export type AdminVersion = {
  id: string;
  publicationId: string;
  version: number;
  versionLabel: string;
  title?: string | null;
  fileName: string;
  fileSize?: number | null;
  sha256?: string | null;
  changeSummary?: string | null;
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  status: AdminPublicationStatus;
  isCurrent: boolean;
  downloadUrl?: string | null;
};

export type AdminTimelineEvent = { id: string; type: string; title: string; description: string; actor: string; actorId?: string | null; version?: string | null; timestamp: string };
export type AdminPagination = { page: number; limit: number; total: number; totalPages: number };
export type AdminUsersResponse = { users: AdminUser[]; pagination: AdminPagination };
export type AdminOverview = {
  metrics: { submitted: number; underReview: number; needsRevision: number; published: number; rejected: number; processing: number; facultySubmissions?: number; studentSubmissions?: number; total: number };
  byStatus: Record<string, number>;
  users: { total: number; lecturers: number; students: number };
  priorityQueue: Array<{ id: string; title: string; status: string; createdAt: string; updatedAt: string; uploader?: { id: string; name?: string | null; email: string; role?: string; studentId?: string | null } }>;
};

type RecordData = Record<string, unknown> & { id: string };
const db = () => firestoreDb();
const PROFILES = 'userProfiles';
const PUBLICATIONS = 'publications';
const REVIEWS = 'publicationReviews';
const VERSIONS = 'publicationVersions';
const EVENTS = 'publicationEvents';
const AUTHORS = 'authors';
const AUTHOR_LINKS = 'publicationAuthors';

function iso(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate as () => Date)().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return '';
}

function dataOf<T extends RecordData>(id: string, value: Record<string, unknown>): T {
  return { id, ...value } as T;
}

async function records(name: string, ...constraints: QueryConstraint[]): Promise<RecordData[]> {
  const snapshot = await getDocs(query(collection(db(), name), ...constraints));
  return snapshot.docs.map((item) => dataOf(item.id, item.data()));
}

async function record(name: string, id: string): Promise<RecordData | null> {
  const snapshot = await getDoc(doc(db(), name, id));
  return snapshot.exists() ? dataOf(snapshot.id, snapshot.data()) : null;
}

function workerPdfUrl(objectKey?: string | null, publicationId?: string) {
  const base = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
  if (!base || !objectKey || !publicationId) return null;
  const url = new URL(`${base}/r2/object`);
  url.searchParams.set('key', objectKey);
  url.searchParams.set('publicationId', publicationId);
  return url.toString();
}

function userFrom(id: string, item: Record<string, unknown>): AdminUser {
  return {
    id,
    email: String(item.email || ''),
    workspaceEmail: typeof item.workspaceEmail === 'string' ? item.workspaceEmail : null,
    username: typeof item.username === 'string' ? item.username : null,
    name: typeof item.name === 'string' ? item.name : null,
    phone: typeof item.phone === 'string' ? item.phone : null,
    studentId: typeof item.studentId === 'string' ? item.studentId : null,
    major: typeof item.major === 'string' ? item.major : null,
    avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
    role: item.role === 'ADMIN' || item.role === 'LECTURER' ? item.role : 'STUDENT',
    isActive: item.isActive === true,
    status: typeof item.status === 'string' ? item.status as AdminUser['status'] : 'PENDING',
    mustChangePassword: item.mustChangePassword === true,
    lastLoginAt: iso(item.lastLoginAt) || null,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
  };
}

async function profile(id: string) {
  const item = await record(PROFILES, id);
  return item ? userFrom(id, item) : null;
}

async function publicationFrom(item: RecordData): Promise<AdminPublication> {
  const [uploader, links, currentVersion] = await Promise.all([
    typeof item.uploaderId === 'string' ? profile(item.uploaderId) : Promise.resolve(null),
    records(AUTHOR_LINKS, where('publicationId', '==', item.id), orderBy('orderIndex', 'asc')),
    typeof item.currentVersionId === 'string' ? record(VERSIONS, item.currentVersionId) : Promise.resolve(null),
  ]);
  const authors = await Promise.all(links.map(async (link) => {
    const author = typeof link.authorId === 'string' ? await record(AUTHORS, link.authorId) : null;
    return {
      id: typeof link.authorId === 'string' ? link.authorId : undefined,
      name: String(link.name || author?.name || ''),
      email: (link.email || author?.email || null) as string | null,
      affiliation: (link.affiliation || author?.affiliation || null) as string | null,
      orderIndex: Number(link.orderIndex || 0),
    };
  }));
  const status = (typeof item.status === 'string' ? item.status : 'PROCESSING') as AdminPublicationStatus;
  const objectKey = typeof item.objectKey === 'string' ? item.objectKey : undefined;
  const versionObjectKey = typeof currentVersion?.objectKey === 'string' ? currentVersion.objectKey : undefined;
  const versionId = currentVersion?.id || String(item.currentVersionId || '');
  const versionNumber = Number(currentVersion?.versionNumber || 1);
  return {
    id: item.id,
    title: (item.title as string | null) ?? null,
    abstract: (item.abstract as string | null) ?? null,
    doi: (item.doi as string | null) ?? null,
    publicationDate: iso(item.publicationDate) || null,
    keywords: Array.isArray(item.keywords) ? item.keywords as string[] : [],
    objectKey,
    fileSize: typeof item.fileSize === 'number' ? item.fileSize : null,
    downloadUrl: workerPdfUrl(versionObjectKey || objectKey, item.id),
    status,
    reviewRound: Number(item.reviewRound || 0),
    audiences: Array.isArray(item.audiences) ? item.audiences as AdminPublicationAudience[] : [],
    isPrivate: item.isPrivate === true,
    uploader: uploader ? { id: uploader.id, name: uploader.name, email: uploader.email, role: uploader.role, studentId: uploader.studentId } : undefined,
    authors,
    currentVersion: currentVersion ? {
      id: versionId,
      version: versionNumber,
      versionLabel: `v${versionNumber}`,
      fileName: String(currentVersion.fileName || 'manuscript.pdf'),
      submittedAt: iso(currentVersion.submittedAt) || null,
    } : null,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
  };
}

function paginate<T>(items: T[], page = 1, limitValue = 20) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limitValue) || 20));
  const start = (safePage - 1) * safeLimit;
  return {
    items: items.slice(start, start + safeLimit),
    pagination: { page: safePage, limit: safeLimit, total: items.length, totalPages: Math.ceil(items.length / safeLimit) || 1 },
  };
}

async function currentAdminId() {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('An administrator must be signed in.');
  return user.uid;
}

async function notifyUser(userId: string, notification: { title: string; content: string; type: string; link: string; metadata?: Record<string, unknown> }) {
  await addDoc(collection(db(), 'notifications'), {
    userId,
    ...notification,
    isRead: false,
    createdAt: serverTimestamp(),
  });
}

export const preprintApi = {
  async overview(): Promise<AdminOverview> {
    const [publicationDocs, profiles] = await Promise.all([
      records(PUBLICATIONS, orderBy('updatedAt', 'desc'), limit(1000)),
      records(PROFILES, orderBy('createdAt', 'desc'), limit(1000)),
    ]);
    const counts: Record<string, number> = { PROCESSING: 0, DRAFTING: 0, REVIEWING: 0, PUBLISHED: 0, REJECTED: 0 };
    for (const item of publicationDocs) if (typeof item.status === 'string') counts[item.status] = (counts[item.status] || 0) + 1;
    const profileById = new Map(profiles.map((item) => [item.id, item]));
    const facultySubmissions = publicationDocs.filter((item) => profileById.get(String(item.uploaderId))?.role === 'LECTURER').length;
    const studentSubmissions = publicationDocs.filter((item) => profileById.get(String(item.uploaderId))?.role === 'STUDENT').length;
    const priorityDocs = publicationDocs.filter((item) => ['REVIEWING', 'DRAFTING', 'PROCESSING', 'PUBLISHED'].includes(String(item.status))).slice(0, 5);
    const priorityQueue = await Promise.all(priorityDocs.map(async (item) => {
      const uploader = profileById.get(String(item.uploaderId));
      return {
        id: item.id,
        title: String(item.title || 'Untitled submission'),
        status: String(item.status || 'PROCESSING'),
        createdAt: iso(item.createdAt),
        updatedAt: iso(item.updatedAt),
        uploader: uploader ? { id: uploader.id, name: uploader.name as string | undefined, email: String(uploader.email || ''), role: String(uploader.role || ''), studentId: uploader.studentId as string | undefined } : undefined,
      };
    }));
    const managedProfiles = profiles.filter((item) => item.status !== 'PENDING' && item.status !== 'REJECTED');
    const lecturerCount = managedProfiles.filter((item) => item.role === 'LECTURER' && item.isActive === true).length;
    const studentCount = managedProfiles.filter((item) => item.role === 'STUDENT').length;
    return {
      metrics: {
        submitted: counts.REVIEWING,
        underReview: counts.REVIEWING,
        needsRevision: counts.DRAFTING,
        published: counts.PUBLISHED,
        rejected: counts.REJECTED,
        processing: counts.PROCESSING,
        facultySubmissions,
        studentSubmissions,
        total: publicationDocs.length,
      },
      byStatus: counts,
      users: { total: managedProfiles.length, lecturers: lecturerCount, students: studentCount },
      priorityQueue,
    };
  },

  async listSubmissions(params: { page?: number; limit?: number; status?: AdminPublicationStatus; search?: string; uploaderRole?: 'LECTURER' | 'STUDENT' } = {}) {
    const constraints: QueryConstraint[] = [orderBy('updatedAt', 'desc'), limit(1000)];
    if (params.status) constraints.unshift(where('status', '==', params.status));
    const docs = await records(PUBLICATIONS, ...constraints);
    const publications = await Promise.all(docs.map(publicationFrom));
    const roleByUploader = new Map(publications.map((item) => [item.uploader?.id, item.uploader?.role]));
    const needle = params.search?.trim().toLocaleLowerCase();
    const filtered = publications.filter((item) => {
      if (params.uploaderRole && roleByUploader.get(item.uploader?.id) !== params.uploaderRole) return false;
      return !needle || [item.title, item.doi, item.uploader?.name, item.uploader?.email]
        .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle));
    });
    return paginate(filtered, params.page, params.limit);
  },

  async getSubmission(id: string) {
    const item = await record(PUBLICATIONS, id);
    if (!item) throw new Error('Publication was not found.');
    return publicationFrom(item);
  },

  async listAllReviews(params: { page?: number; limit?: number; recommendation?: string; search?: string } = {}) {
    let rows = await records(REVIEWS, orderBy('createdAt', 'desc'), limit(1000));
    if (params.recommendation && params.recommendation !== 'ALL') {
      rows = rows.filter((item) => params.recommendation === 'PENDING'
        ? item.submittedAt == null
        : item.recommendation === params.recommendation);
    }
    const publicationIds = [...new Set(rows.map((item) => String(item.publicationId)))];
    const publications = await Promise.all(publicationIds.map((idValue) => record(PUBLICATIONS, idValue)));
    const pubById = new Map(publications.filter((item): item is RecordData => Boolean(item)).map((item) => [item.id, item]));
    const reviewerIds = [...new Set(rows.map((item) => String(item.reviewerId)))];
    const reviewers = await Promise.all(reviewerIds.map((idValue) => profile(idValue)));
    const reviewerById = new Map(reviewers.filter((item): item is AdminUser => Boolean(item)).map((item) => [item.id, item]));
    const needle = params.search?.trim().toLocaleLowerCase();
    if (needle) rows = rows.filter((item) => {
      const reviewer = reviewerById.get(String(item.reviewerId));
      const publication = pubById.get(String(item.publicationId));
      return [reviewer?.name, reviewer?.email, publication?.title, item.comment]
        .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle));
    });
    const shaped = await Promise.all(rows.map(async (item) => {
      const publication = pubById.get(String(item.publicationId));
      const reviewer = reviewerById.get(String(item.reviewerId));
      const version = publication?.currentVersionId ? await record(VERSIONS, String(publication.currentVersionId)) : null;
      const uploader = publication?.uploaderId ? await profile(String(publication.uploaderId)) : null;
      return {
        id: item.id,
        publicationId: String(item.publicationId || ''),
        reviewerId: String(item.reviewerId || ''),
        versionId: String(item.versionId || ''),
        round: Number(item.round || 1),
        comment: (item.comment as string | null) ?? null,
        recommendation: (item.recommendation as AdminReview['recommendation']) ?? null,
        assignmentRole: item.assignmentRole as AdminReview['assignmentRole'],
        submittedAt: iso(item.submittedAt) || null,
        createdAt: iso(item.createdAt),
        updatedAt: iso(item.updatedAt),
        reviewer: reviewer ? { id: reviewer.id, name: reviewer.name, email: reviewer.email } : undefined,
        publication: publication ? {
          id: publication.id,
          title: publication.title as string | undefined,
          status: String(publication.status || 'PROCESSING') as AdminPublicationStatus,
          currentVersionLabel: version ? `v${Number(version.versionNumber || 1)}` : 'v1',
          uploader: uploader ? { id: uploader.id, name: uploader.name, email: uploader.email, role: uploader.role, studentId: uploader.studentId } : undefined,
        } : undefined,
      } satisfies AdminReview;
    }));
    const result = paginate(shaped, params.page, params.limit);
    return { items: result.items, pagination: result.pagination };
  },

  async getReviews(id: string, round?: 'current' | 'all' | number) {
    let rows = await records(REVIEWS, where('publicationId', '==', id), orderBy('createdAt', 'asc'), limit(500));
    const publication = await record(PUBLICATIONS, id);
    if (!publication) throw new Error('Publication was not found.');
    if (round === 'current') rows = rows.filter((item) => Number(item.round) === Math.max(1, Number(publication.reviewRound || 0)));
    else if (round !== 'all' && typeof round === 'number') rows = rows.filter((item) => Number(item.round) === round);
    const result = await Promise.all(rows.map(async (item) => {
      const reviewer = await profile(String(item.reviewerId || ''));
      return {
        id: item.id,
        publicationId: String(item.publicationId || id),
        reviewerId: String(item.reviewerId || ''),
        versionId: String(item.versionId || ''),
        round: Number(item.round || 1),
        comment: (item.comment as string | null) ?? null,
        recommendation: (item.recommendation as AdminReview['recommendation']) ?? null,
        assignmentRole: item.assignmentRole as AdminReview['assignmentRole'],
        submittedAt: iso(item.submittedAt) || null,
        createdAt: iso(item.createdAt),
        updatedAt: iso(item.updatedAt),
        reviewer: reviewer ? { id: reviewer.id, name: reviewer.name, email: reviewer.email } : undefined,
      } satisfies AdminReview;
    }));
    return result;
  },

  async getVersions(id: string) {
    const publication = await record(PUBLICATIONS, id);
    if (!publication) throw new Error('Publication was not found.');
    const rows = await records(VERSIONS, where('publicationId', '==', id), orderBy('versionNumber', 'desc'), limit(100));
    return rows.map((item) => {
      const version = Number(item.versionNumber || 1);
      return {
        id: item.id,
        publicationId: id,
        version,
        versionLabel: `v${version}`,
        title: (item.title as string | null) ?? null,
        fileName: String(item.fileName || 'manuscript.pdf'),
        fileSize: typeof item.fileSize === 'number' ? item.fileSize : null,
        sha256: (item.sha256 as string | null) ?? null,
        changeSummary: (item.changeSummary as string | null) ?? null,
        submittedAt: iso(item.submittedAt) || null,
        createdAt: iso(item.createdAt),
        updatedAt: iso(item.updatedAt),
        status: String(publication.status || 'PROCESSING') as AdminPublicationStatus,
        isCurrent: item.id === publication.currentVersionId,
        downloadUrl: workerPdfUrl(String(item.objectKey || ''), id),
      } satisfies AdminVersion;
    });
  },

  async getTimeline(id: string) {
    const rows = await records(EVENTS, where('publicationId', '==', id), orderBy('createdAt', 'desc'), limit(500));
    return Promise.all(rows.map(async (item) => {
      const actorId = typeof item.actorId === 'string' ? item.actorId : null;
      const actor = actorId ? await profile(actorId) : null;
      const payload = item.payload && typeof item.payload === 'object' ? item.payload as Record<string, unknown> : {};
      const type = String(item.type || '');
      const reason = typeof payload.reason === 'string' ? payload.reason : '';
      return {
        id: item.id,
        type,
        title: type.replaceAll('_', ' ').toLocaleLowerCase().replace(/^./, (letter) => letter.toUpperCase()),
        description: reason || '',
        actor: actor?.name || actor?.email || 'System',
        actorId,
        version: item.versionId ? String(item.versionId) : null,
        timestamp: iso(item.createdAt),
      } satisfies AdminTimelineEvent;
    }));
  },

  async listLecturers() {
    const users = await records(PROFILES, where('role', '==', 'LECTURER'), where('isActive', '==', true), orderBy('createdAt', 'desc'), limit(100));
    const result = users.map((item) => userFrom(item.id, item));
    return { users: result, pagination: { page: 1, limit: 100, total: result.length, totalPages: 1 } };
  },

  async assignReviewers(id: string, primaryReviewerId: string, secondaryReviewerIds: string[]) {
    const publication = await record(PUBLICATIONS, id);
    if (!publication) throw new Error('Publication was not found.');
    if (publication.status !== 'REVIEWING') throw new Error('Reviewers can only be assigned while a publication is under review.');
    if (publication.isPrivate === true) throw new Error('Private publications cannot be assigned for review.');
    const reviewerIds = [primaryReviewerId.trim(), ...new Set(secondaryReviewerIds.map((value) => value.trim()).filter(Boolean))];
    if (!reviewerIds[0] || reviewerIds.length !== 3 || new Set(reviewerIds).size !== 3) {
      throw new Error('Select exactly one primary and two distinct secondary lecturers.');
    }
    const lecturers = await Promise.all(reviewerIds.map((uid) => profile(uid)));
    if (lecturers.some((item) => !item || item.role !== 'LECTURER' || !item.isActive || item.status !== 'APPROVED')) {
      throw new Error('Only active, approved lecturers can review publications.');
    }
    const authorLinks = await records(AUTHOR_LINKS, where('publicationId', '==', id), limit(100));
    const authorIds = new Set([String(publication.uploaderId || ''), ...authorLinks.map((link) => String(link.userId || ''))]);
    if (reviewerIds.some((uid) => authorIds.has(uid))) throw new Error('Authors cannot review their own publication.');
    const currentVersionId = String(publication.currentVersionId || '');
    if (!currentVersionId) throw new Error('The publication has no current version to review.');
    const round = Math.max(1, Number(publication.reviewRound || 1));
    const now = serverTimestamp();
    const batch = writeBatch(db());
    const assigned: AdminReview[] = [];
    for (const [index, reviewerId] of reviewerIds.entries()) {
      const reviewId = `${encodeURIComponent(id)}__${encodeURIComponent(reviewerId)}__${round}`;
      const previous = await record(REVIEWS, reviewId);
      if (previous?.submittedAt) throw new Error('Reviewer assignments cannot be changed after a review is submitted.');
      const reviewData = {
        id: reviewId,
        publicationId: id,
        reviewerId,
        versionId: currentVersionId,
        round,
        assignmentRole: index === 0 ? 'PRIMARY' : 'SECONDARY',
        comment: previous?.comment ?? null,
        recommendation: previous?.recommendation ?? null,
        submittedAt: null,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      };
      batch.set(doc(db(), REVIEWS, reviewId), reviewData);
      const reviewer = lecturers[index]!;
      assigned.push({
        ...reviewData,
        createdAt: previous ? iso(previous.createdAt) : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        reviewer: { id: reviewer.id, name: reviewer.name, email: reviewer.email },
      } as AdminReview);
    }
    const eventId = crypto.randomUUID();
    batch.set(doc(db(), EVENTS, eventId), {
      id: eventId,
      publicationId: id,
      versionId: currentVersionId,
      actorId: await currentAdminId(),
      type: 'REVIEW_ASSIGNED',
      payload: { primaryReviewerId: reviewerIds[0], secondaryReviewerIds: reviewerIds.slice(1), round },
      createdAt: now,
    });
    batch.update(doc(db(), PUBLICATIONS, id), { updatedAt: now });
    await batch.commit();
    await Promise.all(assigned.map((review) => notifyUser(review.reviewerId, {
      title: 'Publication review assigned',
      content: `You have been assigned to review “${publication.title || 'a publication'}”.`,
      type: 'REVIEW_ASSIGNED',
      link: `/lecturer/reviews/${id}`,
      metadata: { publicationId: id, round },
    }))).catch(() => undefined);
    return assigned;
  },

  async changeStatus(id: string, status: AdminDecisionStatus, reason: string) {
    const publication = await record(PUBLICATIONS, id);
    if (!publication) throw new Error('Publication was not found.');
    if (publication.isPrivate === true) throw new Error('Admin cannot change the status of a private lecturer publication.');
    const transitions: Record<string, AdminDecisionStatus[]> = {
      DRAFTING: ['PUBLISHED'],
      PUBLISHED: [],
      REVIEWING: ['PUBLISHED', 'REJECTED', 'DRAFTING'],
      REJECTED: ['PUBLISHED', 'DRAFTING'],
      PROCESSING: [],
    };
    if (!transitions[String(publication.status)]?.includes(status)) {
      throw new Error(`Admin cannot move this publication from ${String(publication.status)} to ${status}.`);
    }
    if (!reason.trim()) throw new Error('A reason is required for an editorial decision.');
    const adminId = await currentAdminId();
    const now = serverTimestamp();
    const eventId = crypto.randomUUID();
    const batch = writeBatch(db());
    batch.update(doc(db(), PUBLICATIONS, id), { status, updatedAt: now });
    batch.set(doc(db(), EVENTS, eventId), {
      id: eventId,
      publicationId: id,
      versionId: publication.currentVersionId || null,
      actorId: adminId,
      type: status === 'PUBLISHED' ? 'PUBLISHED' : status === 'REJECTED' ? 'REJECTED' : 'REOPENED',
      payload: { fromStatus: publication.status, toStatus: status, reason },
      createdAt: now,
    });
    await batch.commit();
    if (publication.uploaderId) {
      const type = status === 'PUBLISHED' ? 'PUBLICATION_APPROVED' : status === 'REJECTED' ? 'PUBLICATION_REJECTED' : 'REVISION_REQUESTED';
      const title = status === 'PUBLISHED' ? 'Publication approved' : status === 'REJECTED' ? 'Publication rejected' : 'Revision requested';
      await notifyUser(String(publication.uploaderId), {
        title,
        content: status === 'PUBLISHED' ? `“${publication.title || 'Your publication'}” was published.` : `${publication.title || 'Your publication'}: ${reason.trim()}`,
        type,
        link: `/student/my-preprints/${id}`,
        metadata: { publicationId: id, reason: reason.trim() },
      }).catch(() => undefined);
    }
    return { id, title: publication.title as string | undefined, status, updatedAt: new Date().toISOString() };
  },

  async updateVisibility(id: string, audiences: AdminPublicationAudience[]) {
    const publication = await record(PUBLICATIONS, id);
    if (!publication) throw new Error('Publication was not found.');
    if (publication.isPrivate === true) throw new Error('Private lecturer publications do not have configurable audience visibility.');
    if (publication.status !== 'REVIEWING' && publication.status !== 'PUBLISHED') {
      throw new Error('Visibility can only be changed while a publication is under review or published.');
    }
    const allowed = new Set(['GUEST', 'STUDENT', 'LECTURER']);
    const normalized = [...new Set(audiences)];
    if (normalized.some((audience) => !allowed.has(audience))) throw new Error('Invalid publication audience.');
    const adminId = await currentAdminId();
    const now = serverTimestamp();
    const eventId = crypto.randomUUID();
    const batch = writeBatch(db());
    batch.update(doc(db(), PUBLICATIONS, id), { audiences: normalized, updatedAt: now });
    batch.set(doc(db(), EVENTS, eventId), {
      id: eventId,
      publicationId: id,
      actorId: adminId,
      versionId: publication.currentVersionId || null,
      type: 'VISIBILITY_UPDATED',
      payload: { audiences: normalized },
      createdAt: now,
    });
    await batch.commit();
    return { id, status: publication.status as AdminPublicationStatus, audiences: normalized, isPrivate: false, updatedAt: new Date().toISOString() };
  },

  async listUsers(params: { page?: number; limit?: number; role?: AdminUser['role']; search?: string; isActive?: boolean } = {}): Promise<AdminUsersResponse> {
    const users = (await records(PROFILES, orderBy('createdAt', 'desc'), limit(1000))).map((item) => userFrom(item.id, item));
    const needle = params.search?.trim().toLocaleLowerCase();
    const filtered = users.filter((item) => item.status !== 'PENDING' && item.status !== 'REJECTED'
      && (!params.role || item.role === params.role)
      && (typeof params.isActive !== 'boolean' || item.isActive === params.isActive)
      && (!needle || [item.name, item.email, item.username, item.studentId].some((value) => value?.toLocaleLowerCase().includes(needle))));
    const result = paginate(filtered, params.page, params.limit);
    return { users: result.items, pagination: result.pagination };
  },

  async getUser(id: string) {
    const item = await profile(id);
    if (!item) throw new Error('User profile was not found. Legacy accounts require migration to Firebase Auth.');
    return item;
  },

  async createUser(_input: { email: string; name?: string | null; username?: string | null; studentId?: string | null; major?: string | null; password?: string; role?: AdminUser['role'] }): Promise<AdminUser> {
    throw new Error('Creating another Firebase Auth account requires the authenticated Cloudflare Worker admin route; it is not enabled in this FE build.');
  },

  async updateUser(id: string, input: Partial<{ email: string; name: string | null; username: string | null; studentId: string | null; major: string | null; role: AdminUser['role']; password: string }>) {
    if (input.email || input.password) throw new Error('Changing another account’s email or password requires the Cloudflare Worker admin route.');
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(input).filter(([key]) => ['name', 'username', 'studentId', 'major', 'role'].includes(key)));
    if (Object.keys(patch).length === 0) return this.getUser(id);
    patch.updatedAt = serverTimestamp();
    await updateDoc(doc(db(), PROFILES, id), patch);
    return this.getUser(id);
  },

  async deleteUser(id: string, confirmEmail: string): Promise<void> {
    await workerRequest(`/api/workspace/app-users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmEmail }),
    });
  },

  async updateUserRole(id: string, role: AdminUser['role']) {
    const target = await profile(id);
    if (!target) throw new Error('User profile was not found. Legacy accounts require migration to Firebase Auth.');
    if (target.role === 'ADMIN' && role !== 'ADMIN') {
      const profiles = (await records(PROFILES, where('role', '==', 'ADMIN'), where('isActive', '==', true), limit(2)));
      if (profiles.length <= 1) throw new Error('Cannot demote the only remaining active administrator.');
    }
    await updateDoc(doc(db(), PROFILES, id), { role, updatedAt: serverTimestamp() });
    const updated = await profile(id);
    if (!updated) throw new Error('User profile could not be reloaded.');
    return updated;
  },

  async updateUserStatus(id: string, isActive: boolean) {
    const adminId = await currentAdminId();
    const target = await profile(id);
    if (!target) throw new Error('User profile was not found. Legacy accounts require migration to Firebase Auth.');
    if (id === adminId && !isActive) throw new Error('You cannot deactivate your own administrator account.');
    if (target.role === 'ADMIN' && !isActive) {
      const admins = await records(PROFILES, where('role', '==', 'ADMIN'), where('isActive', '==', true), limit(2));
      if (admins.length <= 1) throw new Error('Cannot deactivate the only remaining active administrator.');
    }
    await updateDoc(doc(db(), PROFILES, id), {
      isActive,
      status: isActive ? 'APPROVED' : 'SUSPENDED',
      updatedAt: serverTimestamp(),
    });
    const updated = await profile(id);
    if (!updated) throw new Error('User profile could not be reloaded.');
    return updated;
  },

  async listPendingUsers(params: { page?: number; limit?: number } = {}) {
    const users = (await records(PROFILES, where('status', '==', 'PENDING'), orderBy('createdAt', 'desc'), limit(1000))).map((item) => userFrom(item.id, item));
    const result = paginate(users, params.page, params.limit);
    return { users: result.items, pagination: result.pagination };
  },

  async approveUser(id: string, payload: {
    workspaceEmail: string;
    firstName: string;
    lastName: string;
    studentId?: string;
    major?: string;
  }): Promise<AdminUser & { onboardingEmailSent: boolean }> {
    const result = await workerRequest<{ data: { workspaceEmail: string; onboardingEmailSent: boolean } }>(
      `/api/workspace/registrations/${encodeURIComponent(id)}/approve`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id, ...payload }) },
    );
    return { ...(await this.getUser(id)), workspaceEmail: result.data.workspaceEmail, onboardingEmailSent: result.data.onboardingEmailSent };
  },

  async resendWorkspaceNotice(id: string) {
    return workerRequest<{ data: { profileUid: string; workspaceEmail: string; onboardingEmailSent: boolean; temporaryPasswordRotated: boolean } }>(
      `/api/workspace/registrations/${encodeURIComponent(id)}/resend`, { method: 'POST' },
    );
  },

  async rejectUser(id: string) {
    const target = await profile(id);
    const requestRef = doc(db(), 'registrationRequests', id);
    const request = await getDoc(requestRef);
    if (!target && !request.exists()) throw new Error('Registration request was not found.');
    if (target?.status === 'APPROVED' || target?.status === 'SUSPENDED') throw new Error('An approved account cannot be rejected as a pending application.');
    if (target?.status === 'REJECTED' || request.data()?.status === 'REJECTED') throw new Error('This application has already been rejected.');

    const adminId = await currentAdminId();
    if (request.exists()) {
      await updateDoc(requestRef, { status: 'REJECTED', reviewedAt: serverTimestamp(), reviewedById: adminId });
    }
    if (target?.status === 'PENDING') {
      await updateDoc(doc(db(), PROFILES, id), { status: 'REJECTED', isActive: false, updatedAt: serverTimestamp() });
    }
    return target ? this.getUser(id) : { id, status: 'REJECTED' as const };
  },
};

export const adminApi = preprintApi;
