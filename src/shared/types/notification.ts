export type NotificationType =
  | 'SUBMISSION_CREATED'
  | 'SUBMISSION_REVISED'
  | 'REVIEW_ASSIGNED'
  | 'REVIEW_COMPLETED'
  | 'PUBLICATION_APPROVED'
  | 'PUBLICATION_REJECTED'
  | 'REVISION_REQUESTED'
  | 'USER_REGISTERED'
  | 'PROJECT_INVITATION'
  | 'SYSTEM';

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  content: string;
  type: NotificationType;
  link?: string | null;
  isRead: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListNotificationsResponse {
  items: AppNotification[];
  unreadCount: number;
  pagination: NotificationPagination;
}
