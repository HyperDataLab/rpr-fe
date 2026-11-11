import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type QueryConstraint,
  where,
} from 'firebase/firestore';
import { firebaseAuth, firestoreDb } from '@/lib/firebase/client';

export type LecturerRecommendation = 'PUBLISH' | 'NEEDS_REVISION' | 'REJECT';

export type LecturerReview = {
  id: string;
  reviewerId: string;
  reviewer?: { id: string; name?: string | null; email: string };
  versionId?: string;
  round: number;
  comment?: string | null;
  recommendation?: LecturerRecommendation | null;
  assignmentRole?: 'PRIMARY' | 'SECONDARY' | 'LEGACY';
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LecturerPublication = {
  id: string;
  title?: string | null;
  abstract?: string | null;
  doi?: string | null;
  keywords?: string[];
  objectKey: string;
  fileSize?: number | null;
  status: 'PROCESSING' | 'DRAFTING' | 'REVIEWING' | 'PUBLISHED' | 'REJECTED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  currentVersion?: {
    id: string;
    version: number;
    versionLabel: string;
    fileName: string;
    submittedAt?: string | null;
  } | null;
  uploader?: {
    id: string;
    email: string;
    name?: string | null;
    role?: 'LECTURER' | 'STUDENT' | 'ADMIN';
    studentId?: string | null;
  };
  authors?: Array<{ id?: string; name: string; email?: string | null; affiliation?: string | null }>;
  discipline?: string | null;
  isPrivate?: boolean;
  audiences?: Array<'GUEST' | 'STUDENT' | 'LECTURER'>;
  downloadUrl?: string;
  myReview?: LecturerReview;
};

export type LecturerVersion = {
  id: string;
  version: number;
  versionLabel: string;
  fileName: string;
  fileSize?: number | null;
  sha256?: string | null;
  changeSummary?: string | null;
  submittedAt?: string | null;
  createdAt: string;
  isCurrent: boolean;
  downloadUrl?: string | null;
};

export type LecturerTimelineEvent = {
  id: string;
  type: string;
  title: string;
  description: string;
  actor: string;
  timestamp: string;
  version?: string | null;
};

export type LecturerReviewItem = LecturerPublication & {
  reviewStatus: 'AWAITING_REVIEW' | 'COMPLETED';
  myReview?: LecturerReview;
};

export type LecturerReviewDetail = {
  publication: LecturerPublication;
  reviews: LecturerReview[];
  versions: LecturerVersion[];
  timeline: LecturerTimelineEvent[];
};

export type LecturerStats = {
  completedReviews: number;
  reviewQueue: number;
  turnaroundSla: number;
  turnaroundSlaFormatted: string;
  totalAssigned?: number;
  onTimeReviews?: number;
};

const collections = {
  profiles: 'userProfiles',
  publications: 'publications',
  reviews: 'publicationReviews',
  versions: 'publicationVersions',
  publicationAuthors: 'publicationAuthors',
  events: 'publicationEvents',
} as const;

type Row = Record<string, any> & { id: string };

function currentUid() {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error('You need to sign in to continue.');
  return user.uid;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate as () => Date)().toISOString();
  }
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function workerUrl(key: string, publicationId: string): string | undefined {
  const baseUrl = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
  if (!baseUrl || !key) return undefined;
  const queryParams = new URLSearchParams({ key, publicationId });
  return `${baseUrl}/r2/object?${queryParams.toString()}`;
}

async function readRows(collectionName: string, ...constraints: QueryConstraint[]) {
  const ref = collection(firestoreDb(), collectionName);
  const result = constraints.length
    ? await getDocs(query(ref, ...constraints))
    : await getDocs(ref);
  return result.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() } as Row));
}

function reviewDocumentId(publicationId: string, reviewerId: string, round: number) {
  return `${encodeURIComponent(publicationId)}__${encodeURIComponent(reviewerId)}__${round}`;
}

async function getPublicationRecord(id: string): Promise<Row | null> {
  const snapshot = await getDoc(doc(firestoreDb(), collections.publications, id));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Row) : null;
}

async function getPublicationRecordIfReadable(id: string): Promise<Row | null> {
  try {
    return await getPublicationRecord(id);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'permission-denied') return null;
    throw error;
  }
}

async function getCurrentAssignment(publication: Row, uid: string): Promise<Row | null> {
  const round = Math.max(1, Number(publication.reviewRound || 1));
  const snapshot = await getDoc(doc(firestoreDb(), collections.reviews, reviewDocumentId(publication.id, uid, round)));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Row) : null;
}

async function readReviews(publication: Row, uid: string): Promise<LecturerReview[]> {
  const round = Math.max(1, Number(publication.reviewRound || 1));
  const assignment = await getCurrentAssignment(publication, uid);
  const isPrimary = assignment?.assignmentRole === 'PRIMARY';
  const constraints = isPrimary
    ? [where('publicationId', '==', publication.id), where('round', '==', round)]
    : [where('publicationId', '==', publication.id), where('reviewerId', '==', uid)];
  const rows = await readRows(collections.reviews, ...constraints);
  const visible = isPrimary ? rows.filter((item) => Number(item.round) === round) : rows;
  const currentUser = firebaseAuth().currentUser;
  return visible.map((review) => ({
    id: review.id,
    reviewerId: String(review.reviewerId || ''),
    versionId: review.versionId || undefined,
    round: Number(review.round || 1),
    comment: review.comment ?? null,
    recommendation: review.recommendation ?? null,
    assignmentRole: review.assignmentRole,
    submittedAt: review.submittedAt ? iso(review.submittedAt) : null,
    createdAt: iso(review.createdAt),
    updatedAt: iso(review.updatedAt),
    reviewer: review.reviewerId === uid ? {
      id: uid,
      name: currentUser?.displayName || null,
      email: currentUser?.email || '',
    } : undefined,
  }));
}

async function readPublicationAuthors(publicationId: string) {
  const links = await readRows(collections.publicationAuthors,
    where('publicationId', '==', publicationId), orderBy('orderIndex', 'asc'));
  return links.map((link) => ({
    id: link.authorId || link.id,
    name: String(link.name || ''),
    email: link.email ?? null,
    affiliation: link.affiliation ?? null,
  }));
}

async function readVersions(publication: Row): Promise<LecturerVersion[]> {
  const versions = await readRows(collections.versions,
    where('publicationId', '==', publication.id), orderBy('versionNumber', 'desc'));
  return versions.map((version) => ({
    id: version.id,
    version: Number(version.versionNumber || 1),
    versionLabel: `v${Number(version.versionNumber || 1)}`,
    fileName: String(version.fileName || version.objectKey?.split('/').pop() || 'publication.pdf'),
    fileSize: version.fileSize ?? null,
    sha256: version.sha256 ?? null,
    changeSummary: version.changeSummary ?? null,
    submittedAt: version.submittedAt ? iso(version.submittedAt) : null,
    createdAt: iso(version.createdAt),
    isCurrent: version.id === publication.currentVersionId,
    downloadUrl: workerUrl(String(version.objectKey || ''), publication.id),
  }));
}

async function readTimeline(publicationId: string): Promise<LecturerTimelineEvent[]> {
  const currentUidValue = currentUid();
  const events = await readRows(collections.events,
    where('publicationId', '==', publicationId), orderBy('createdAt', 'asc'));
  return events.map((event) => {
    const payload = (event.payload || {}) as Record<string, unknown>;
    const type = String(event.type || 'UPDATED');
    const titles: Record<string, string> = {
      DRAFT_CREATED: 'Draft created', FILE_UPLOADED: 'File uploaded', SUBMITTED: 'Submitted for review',
      REVIEW_SUBMITTED: 'Review submitted', REJECTED: 'Publication rejected', REOPENED: 'Revision requested',
      PUBLISHED: 'Published', REVIEW_ASSIGNED: 'Reviewers assigned',
    };
    return {
      id: event.id,
      type,
      title: titles[type] || 'Publication updated',
      description: String(payload.changeSummary || payload.fileName || payload.reason || titles[type] || 'Publication updated'),
      actor: event.actorId === currentUidValue ? (firebaseAuth().currentUser?.displayName || 'You') : 'System',
      timestamp: iso(event.createdAt),
      version: payload.versionNumber ? `v${payload.versionNumber}` : null,
    };
  });
}

async function formatPublication(record: Row, uid: string, assignment?: Row | null): Promise<LecturerPublication> {
  const currentVersionSnapshot = record.currentVersionId
    ? await getDoc(doc(firestoreDb(), collections.versions, String(record.currentVersionId)))
    : null;
  const version = currentVersionSnapshot?.exists() ? currentVersionSnapshot.data() : null;
  const isReviewerView = record.uploaderId !== uid && Boolean(assignment);
  // Reviewer clients cannot read another user's profile to determine the uploader role.
  // Mask every assigned publication to preserve double-blind privacy safely.
  const maskAuthorIdentity = isReviewerView;
  const authors = maskAuthorIdentity ? [] : await readPublicationAuthors(record.id);
  const ownProfile = record.uploaderId === uid
    ? await getDoc(doc(firestoreDb(), collections.profiles, uid))
    : null;
  const profile = ownProfile?.exists() ? ownProfile.data() : null;
  const myReviewRow = assignment || await getCurrentAssignment(record, uid);
  const myReview = myReviewRow ? {
    id: myReviewRow.id,
    reviewerId: String(myReviewRow.reviewerId || uid),
    round: Number(myReviewRow.round || 1),
    versionId: myReviewRow.versionId,
    assignmentRole: myReviewRow.assignmentRole,
    comment: myReviewRow.comment ?? null,
    recommendation: myReviewRow.recommendation ?? null,
    submittedAt: myReviewRow.submittedAt ? iso(myReviewRow.submittedAt) : null,
    createdAt: iso(myReviewRow.createdAt),
    updatedAt: iso(myReviewRow.updatedAt),
    reviewer: { id: uid, name: firebaseAuth().currentUser?.displayName, email: firebaseAuth().currentUser?.email || '' },
  } satisfies LecturerReview : undefined;
  const uploaderId = String(record.uploaderId || '');
  return {
    id: record.id,
    title: record.title ?? null,
    abstract: record.abstract ?? null,
    doi: record.doi ?? null,
    keywords: Array.isArray(record.keywords) ? record.keywords : [],
    objectKey: String(version?.objectKey || record.objectKey || ''),
    fileSize: version?.fileSize ?? record.fileSize ?? null,
    status: record.status,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    currentVersion: version ? {
      id: String(record.currentVersionId),
      version: Number(version.versionNumber || 1),
      versionLabel: `v${Number(version.versionNumber || 1)}`,
      fileName: String(version.fileName || version.objectKey?.split('/').pop() || 'publication.pdf'),
      submittedAt: version.submittedAt ? iso(version.submittedAt) : null,
    } : null,
    uploader: {
      id: uploaderId,
      email: maskAuthorIdentity ? '' : String(profile?.email || ''),
      name: maskAuthorIdentity ? 'Anonymous Author' : (profile?.name ?? null),
      role: maskAuthorIdentity ? undefined : profile?.role,
      studentId: maskAuthorIdentity ? null : profile?.studentId,
    },
    authors: maskAuthorIdentity ? [{ name: 'Anonymous Author', affiliation: 'Double-Blind Peer Review' }] : authors,
    discipline: record.discipline ?? null,
    isPrivate: record.isPrivate === true,
    audiences: Array.isArray(record.audiences) ? record.audiences : [],
    downloadUrl: workerUrl(String(version?.objectKey || record.objectKey || ''), record.id),
    myReview,
  };
}

function withReviewStatus(publication: LecturerPublication, review?: LecturerReview): LecturerReviewItem {
  const isAwaiting = publication.status === 'REVIEWING' && (!review || !review.submittedAt);
  return { ...publication, reviewStatus: isAwaiting ? 'AWAITING_REVIEW' : 'COMPLETED', myReview: review };
}

async function assignmentsForCurrentUser() {
  const uid = currentUid();
  const rows = await readRows(collections.reviews, where('reviewerId', '==', uid));
  return rows.sort((a, b) => iso(b.createdAt).localeCompare(iso(a.createdAt)));
}

async function queryPublished(audience: 'GUEST' | 'LECTURER') {
  return readRows(collections.publications,
    where('status', '==', 'PUBLISHED'), where('isPrivate', '==', false),
    where('audiences', 'array-contains', audience));
}

export const lecturerReviewApi = {
  async getStats(): Promise<LecturerStats> {
    const uid = currentUid();
    const assignments = await assignmentsForCurrentUser();
    const publications = await Promise.all([...new Set(assignments.map((row) => String(row.publicationId)))].map(getPublicationRecordIfReadable));
    const byId = new Map(publications.filter((row): row is Row => Boolean(row)).map((row) => [row.id, row]));
    const completed = assignments.filter((assignment) => assignment.submittedAt != null);
    const queue = assignments.filter((assignment) => {
      const publication = byId.get(String(assignment.publicationId));
      return assignment.submittedAt == null && publication?.status === 'REVIEWING'
        && Number(assignment.round) === Math.max(1, Number(publication.reviewRound || 1))
        && publication.uploaderId !== uid;
    }).length;
    const onTime = completed.filter((assignment) => {
      const start = new Date(iso(assignment.createdAt)).getTime();
      const end = new Date(iso(assignment.submittedAt)).getTime();
      return end >= start && end - start <= 48 * 60 * 60 * 1000;
    }).length;
    const turnaroundSla = completed.length ? Math.round(onTime / completed.length * 1000) / 10 : 100;
    return {
      completedReviews: completed.length,
      reviewQueue: queue,
      turnaroundSla,
      turnaroundSlaFormatted: `${turnaroundSla}%`,
      totalAssigned: assignments.length,
      onTimeReviews: onTime,
    };
  },

  async list(): Promise<{ items: LecturerReviewItem[]; total: number }> {
    const uid = currentUid();
    const assignments = await assignmentsForCurrentUser();
    const publicationIds = [...new Set(assignments.map((row) => String(row.publicationId)))];
    const records = (await Promise.all(publicationIds.map(getPublicationRecordIfReadable))).filter((row): row is Row => Boolean(row));
    const currentAssignments = assignments.filter((assignment) => {
      const publication = records.find((record) => record.id === String(assignment.publicationId));
      return publication?.status === 'REVIEWING'
        && Number(assignment.round) === Math.max(1, Number(publication.reviewRound || 1))
        && publication.uploaderId !== uid;
    });
    const uniqueAssignments = new Map<string, Row>();
    currentAssignments.forEach((assignment) => {
      if (!uniqueAssignments.has(String(assignment.publicationId))) uniqueAssignments.set(String(assignment.publicationId), assignment);
    });
    const items = await Promise.all([...uniqueAssignments.entries()].map(async ([id, assignment]) => {
      const publication = records.find((record) => record.id === id)!;
      const formatted = await formatPublication(publication, uid, assignment);
      return withReviewStatus(formatted, formatted.myReview);
    }));
    return { items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), total: items.length };
  },

  async get(id: string): Promise<LecturerReviewDetail> {
    const uid = currentUid();
    const publication = await getPublicationRecord(id);
    if (!publication) throw new Error('Publication not found.');
    const assignment = await getCurrentAssignment(publication, uid);
    if (!assignment) throw new Error('You are not assigned to review this publication.');
    const [formatted, reviews, versions, timeline] = await Promise.all([
      formatPublication(publication, uid, assignment),
      readReviews(publication, uid),
      readVersions(publication),
      readTimeline(id),
    ]);
    return { publication: formatted, reviews, versions, timeline };
  },

  async submit(id: string, payload: { comment: string; recommendation: LecturerRecommendation }): Promise<LecturerReview> {
    const uid = currentUid();
    const comment = payload.comment.trim();
    if (!comment) throw new Error('Review comment is required.');
    if (!['PUBLISH', 'NEEDS_REVISION', 'REJECT'].includes(payload.recommendation)) throw new Error('Invalid review recommendation.');
    const publication = await getPublicationRecord(id);
    if (!publication) throw new Error('Publication not found.');
    if (publication.status !== 'REVIEWING') throw new Error('Reviews can only be submitted while the publication is under review.');
    const database = firestoreDb();
    const publicationRef = doc(database, collections.publications, id);
    const eventId = crypto.randomUUID();
    const result = await runTransaction(database, async (transaction) => {
      const currentPublication = await transaction.get(publicationRef);
      if (!currentPublication.exists()) throw new Error('Publication not found.');
      const currentRound = Math.max(1, Number(currentPublication.get('reviewRound') || 1));
      if (currentPublication.get('status') !== 'REVIEWING') {
        throw new Error('Reviews can only be submitted while the publication is under review.');
      }
      const assignmentRef = doc(database, collections.reviews, reviewDocumentId(id, uid, currentRound));
      const assignmentSnapshot = await transaction.get(assignmentRef);
      if (!assignmentSnapshot.exists() || !['PRIMARY', 'SECONDARY'].includes(String(assignmentSnapshot.get('assignmentRole')))) {
        throw new Error('You are not assigned to review this publication.');
      }
      if (assignmentSnapshot.get('submittedAt') != null) throw new Error('This review has already been submitted.');
      const now = serverTimestamp();
      transaction.update(assignmentRef, { comment, recommendation: payload.recommendation, submittedAt: now, updatedAt: now });
      transaction.update(publicationRef, { updatedAt: now });
      transaction.set(doc(database, collections.events, eventId), {
        id: eventId, publicationId: id, versionId: assignmentSnapshot.get('versionId') || currentPublication.get('currentVersionId') || null,
        actorId: uid, type: 'REVIEW_SUBMITTED', payload: { round: currentRound, recommendation: payload.recommendation }, createdAt: now,
      });
      return { id: assignmentSnapshot.id, existing: assignmentSnapshot.data(), round: currentRound };
    });
    return {
      id: result.id, reviewerId: uid, versionId: result.existing.versionId,
      round: result.round, assignmentRole: result.existing.assignmentRole, comment, recommendation: payload.recommendation,
      submittedAt: new Date().toISOString(), createdAt: iso(result.existing.createdAt), updatedAt: new Date().toISOString(),
      reviewer: { id: uid, name: firebaseAuth().currentUser?.displayName, email: firebaseAuth().currentUser?.email || '' },
    };
  },

  async changeStatus(id: string, status: 'PUBLISHED' | 'DRAFTING' | 'REJECTED', reason?: string) {
    const uid = currentUid();
    if ((status === 'DRAFTING' || status === 'REJECTED') && !reason?.trim()) {
      throw new Error('A reason is required for this decision.');
    }
    const database = firestoreDb();
    const publicationRef = doc(database, collections.publications, id);
    const eventId = crypto.randomUUID();
    const type = status === 'PUBLISHED' ? 'PUBLISHED' : status === 'REJECTED' ? 'REJECTED' : 'REOPENED';
    const publication = await runTransaction(database, async (transaction) => {
      const currentPublication = await transaction.get(publicationRef);
      if (!currentPublication.exists()) throw new Error('Publication not found.');
      if (currentPublication.get('status') !== 'REVIEWING') {
        throw new Error('Only publications under review can receive a reviewer decision.');
      }
      const round = Math.max(1, Number(currentPublication.get('reviewRound') || 1));
      const assignmentRef = doc(database, collections.reviews, reviewDocumentId(id, uid, round));
      const assignment = await transaction.get(assignmentRef);
      if (!assignment.exists() || assignment.get('assignmentRole') !== 'PRIMARY') {
        throw new Error('Only the primary reviewer can decide the publication status.');
      }
      const now = serverTimestamp();
      transaction.update(publicationRef, { status, updatedAt: now });
      transaction.set(doc(database, collections.events, eventId), {
        id: eventId, publicationId: id, versionId: currentPublication.get('currentVersionId') || null,
        actorId: uid, type, payload: { reason: reason?.trim() || null, fromStatus: 'REVIEWING', toStatus: status }, createdAt: now,
      });
      return { title: currentPublication.get('title') as string | undefined };
    });
    return { id, title: publication.title, status, updatedAt: new Date().toISOString() };
  },
};

export type LecturerPublicationScope = 'ALL' | 'PUBLIC' | 'FACULTY_ONLY' | 'CAMPUS' | 'ASSIGNED' | 'MINE';

export interface ListPublicationsParams {
  scope?: LecturerPublicationScope | string;
  discipline?: string;
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export const lecturerPublicationApi = {
  async list(params?: ListPublicationsParams): Promise<{ items: LecturerPublication[]; total: number }> {
    const uid = currentUid();
    const scope = params?.scope || 'ALL';
    if (scope === 'CAMPUS') {
      throw new Error('Campus-only publications are not readable by lecturer accounts under the current Firestore rules.');
    }
    const candidates = new Map<string, Row>();
    const add = (rows: Row[]) => rows.forEach((row) => candidates.set(row.id, row));
    if (scope === 'ALL' || scope === 'PUBLIC') add(await queryPublished('GUEST'));
    if (scope === 'ALL' || scope === 'FACULTY_ONLY') add(await queryPublished('LECTURER'));
    if (scope === 'ALL' || scope === 'MINE') add(await readRows(collections.publications, where('uploaderId', '==', uid)));
    if (scope === 'ALL' || scope === 'ASSIGNED') {
      const assignments = await assignmentsForCurrentUser();
      const ids = [...new Set(assignments.map((assignment) => String(assignment.publicationId)))];
      const assigned = await Promise.all(ids.map(getPublicationRecordIfReadable));
      assigned.filter((row): row is Row => Boolean(row)).forEach((row) => candidates.set(row.id, row));
    }
    let rows = [...candidates.values()];
    if (scope === 'PUBLIC') rows = rows.filter((row) => row.status === 'PUBLISHED' && row.audiences?.includes('GUEST'));
    if (scope === 'FACULTY_ONLY') rows = rows.filter((row) => row.status === 'PUBLISHED' && row.audiences?.includes('LECTURER') && !row.audiences?.includes('GUEST'));
    if (scope === 'MINE') rows = rows.filter((row) => row.uploaderId === uid);
    if (scope === 'ASSIGNED') {
      const assignments = await assignmentsForCurrentUser();
      const current = new Set(assignments.map((assignment) => String(assignment.publicationId)));
      rows = rows.filter((row) => current.has(row.id));
    }
    if (params?.status) rows = rows.filter((row) => row.status === params.status);
    if (params?.discipline && params.discipline !== 'ALL') rows = rows.filter((row) => String(row.discipline || '').toLowerCase() === params.discipline!.toLowerCase());
    if (params?.search) {
      const needle = params.search.toLowerCase();
      rows = rows.filter((row) => [row.title, row.abstract, row.doi].some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))
        || (Array.isArray(row.keywords) && row.keywords.some((keyword: string) => keyword.toLowerCase().includes(needle))));
    }
    rows.sort((a, b) => iso(b.createdAt).localeCompare(iso(a.createdAt)));
    const total = rows.length;
    const page = Math.max(1, params?.page || 1);
    const pageSize = Math.min(100, Math.max(1, params?.limit || 100));
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
    const assignments = await assignmentsForCurrentUser();
    const items = await Promise.all(rows.map(async (row) => {
      const assignment = assignments.find((item) => item.publicationId === row.id);
      return formatPublication(row, uid, assignment);
    }));
    return { items, total };
  },

  async get(id: string): Promise<LecturerPublication> {
    const uid = currentUid();
    const record = await getPublicationRecord(id);
    if (!record) throw new Error('Publication not found.');
    const currentAssignment = await getCurrentAssignment(record, uid);
    const history = currentAssignment ? [] : await readRows(collections.reviews,
      where('publicationId', '==', id), where('reviewerId', '==', uid));
    const assignment = currentAssignment || history.sort((a, b) => Number(b.round) - Number(a.round))[0] || null;
    return formatPublication(record, uid, assignment);
  },
};

