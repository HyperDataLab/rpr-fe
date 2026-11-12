import {
  collection,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
  writeBatch,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  type DocumentData,
  type QueryConstraint,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import type { AppNotification, ListNotificationsResponse } from '../types/notification';
import { firebaseAuth, firestoreDb } from '@/lib/firebase/client';

const COLLECTION = 'notifications';
const MAX_PAGE_SIZE = 50;
const BATCH_SIZE = 450;

function currentUserId(userId?: string) {
  const uid = firebaseAuth().currentUser?.uid;
  if (userId && uid && userId !== uid) throw new Error('Cannot read notifications for another account.');
  if (!uid) throw new Error('Bạn cần đăng nhập để xem thông báo.');
  return uid;
}

function toIso(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return (value.toDate() as Date).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function mapNotification(id: string, data: DocumentData): AppNotification {
  return {
    id,
    userId: String(data.userId || ''),
    title: String(data.title || ''),
    content: String(data.content || ''),
    type: data.type || 'SYSTEM',
    link: typeof data.link === 'string' ? data.link : null,
    isRead: data.isRead === true,
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : null,
    createdAt: toIso(data.createdAt),
  };
}

function notificationsQuery(uid: string, unreadOnly = false) {
  const constraints: QueryConstraint[] = [where('userId', '==', uid)];
  if (unreadOnly) constraints.push(where('isRead', '==', false));
  constraints.push(orderBy('createdAt', 'desc'));
  return query(collection(firestoreDb(), COLLECTION), ...constraints);
}

function responseFromSnapshot(snapshot: QuerySnapshot<DocumentData>, page: number, pageSize: number): ListNotificationsResponse {
  const all = snapshot.docs.map((item) => mapNotification(item.id, item.data()));
  const start = (page - 1) * pageSize;
  return {
    items: all.slice(start, start + pageSize),
    unreadCount: all.filter((item) => !item.isRead).length,
    pagination: {
      page,
      limit: pageSize,
      total: all.length,
      totalPages: Math.ceil(all.length / pageSize),
    },
  };
}

export const notificationApi = {
  async listNotifications(params?: { page?: number; limit?: number; unreadOnly?: boolean; userId?: string }): Promise<ListNotificationsResponse> {
    const page = Math.max(1, Number(params?.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params?.limit) || 20));
    const snapshot = await getDocs(notificationsQuery(currentUserId(params?.userId), params?.unreadOnly));
    return responseFromSnapshot(snapshot, page, pageSize);
  },

  async getUnreadCount(userId?: string): Promise<number> {
    const snapshot = await getDocs(notificationsQuery(currentUserId(userId), true));
    return snapshot.size;
  },

  async markAsRead(id: string): Promise<boolean> {
    const uid = currentUserId();
    const reference = doc(firestoreDb(), COLLECTION, id);
    const snapshot = await getDoc(reference);
    if (!snapshot.exists() || snapshot.data().userId !== uid || snapshot.data().isRead === true) return false;
    await updateDoc(reference, { isRead: true });
    return true;
  },

  async markAllAsRead(): Promise<number> {
    const uid = currentUserId();
    const snapshot = await getDocs(notificationsQuery(uid, true));
    for (let index = 0; index < snapshot.docs.length; index += BATCH_SIZE) {
      const batch = writeBatch(firestoreDb());
      snapshot.docs.slice(index, index + BATCH_SIZE).forEach((item) => batch.update(item.ref, { isRead: true }));
      await batch.commit();
    }
    return snapshot.size;
  },

  subscribe(
    userId: string,
    onItems: (response: ListNotificationsResponse, snapshot: QuerySnapshot<DocumentData>) => void,
    onError: (error: Error) => void,
    page = 1,
    pageSize = 20,
  ): Unsubscribe {
    const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
    return onSnapshot(
      query(notificationsQuery(currentUserId(userId)), firestoreLimit(safePageSize * page)),
      (snapshot) => onItems(responseFromSnapshot(snapshot, page, safePageSize), snapshot),
      onError,
    );
  },

  subscribeUnreadCount(userId: string, onCount: (count: number) => void, onError: (error: Error) => void): Unsubscribe {
    return onSnapshot(notificationsQuery(currentUserId(userId), true), (snapshot) => onCount(snapshot.size), onError);
  },
};
