'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '../api/notificationApi';
import type { ListNotificationsResponse } from '../types/notification';
import { useAuth } from '@/features/auth/hooks/useAuth';

export const NOTIFICATIONS_LIST_QUERY_KEY = ['notifications-list'];
export const UNREAD_COUNT_QUERY_KEY = ['notifications-unread-count'];

export function useNotifications(options: { page?: number; limit?: number; autoConnect?: boolean } = {}) {
  const { page = 1, limit = 20, autoConnect = true } = options;
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [hasNewArrival, setHasNewArrival] = useState(false);
  const newArrivalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = user?.id;
  const unreadKey = useMemo(() => [...UNREAD_COUNT_QUERY_KEY, uid || 'signed-out'], [uid]);
  const listKey = useMemo(() => [...NOTIFICATIONS_LIST_QUERY_KEY, uid || 'signed-out', { page, limit }], [uid, page, limit]);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: unreadKey,
    queryFn: () => notificationApi.getUnreadCount(uid),
    enabled: Boolean(uid) && !authLoading,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const {
    data: listData,
    isLoading: listLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: listKey,
    queryFn: () => notificationApi.listNotifications({ page, limit, userId: uid }),
    enabled: Boolean(uid) && !authLoading,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [...NOTIFICATIONS_LIST_QUERY_KEY, uid || 'signed-out'] });
      const old = queryClient.getQueryData<ListNotificationsResponse>(listKey);
      queryClient.setQueryData<ListNotificationsResponse>(listKey, (current) => current && ({
        ...current,
        unreadCount: Math.max(0, current.unreadCount - (current.items.some((item) => item.id === id && !item.isRead) ? 1 : 0)),
        items: current.items.map((item) => item.id === id ? { ...item, isRead: true } : item),
      }));
      queryClient.setQueryData<number>(unreadKey, (count) => Math.max(0, (count || 0) - 1));
      return { old };
    },
    onError: (_error, _id, context) => {
      if (context?.old) queryClient.setQueryData(listKey, context.old);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: unreadKey });
      queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const old = queryClient.getQueryData<ListNotificationsResponse>(listKey);
      queryClient.setQueryData<ListNotificationsResponse>(listKey, (current) => current && ({
        ...current,
        unreadCount: 0,
        items: current.items.map((item) => ({ ...item, isRead: true })),
      }));
      queryClient.setQueryData(unreadKey, 0);
      return { old };
    },
    onError: (_error, _variables, context) => {
      if (context?.old) queryClient.setQueryData(listKey, context.old);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: unreadKey });
      queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  useEffect(() => {
    if (!autoConnect || !uid || authLoading) return;
    let firstSnapshot = true;
    const recentIds = new Set<string>();

    const stopList = notificationApi.subscribe(uid, (response, snapshot) => {
      const hasAdded = !firstSnapshot && snapshot.docChanges().some((change) => change.type === 'added' && !recentIds.has(change.doc.id));
      snapshot.docs.forEach((item) => recentIds.add(item.id));
      firstSnapshot = false;
      queryClient.setQueryData(listKey, response);
      if (hasAdded) {
        setHasNewArrival(true);
        if (newArrivalTimer.current) clearTimeout(newArrivalTimer.current);
        newArrivalTimer.current = setTimeout(() => setHasNewArrival(false), 3000);
      }
    }, () => {
      queryClient.invalidateQueries({ queryKey: listKey });
    }, page, limit);

    const stopUnread = notificationApi.subscribeUnreadCount(uid, (count) => {
      queryClient.setQueryData(unreadKey, count);
    }, () => {
      queryClient.invalidateQueries({ queryKey: unreadKey });
    });

    return () => {
      stopList();
      stopUnread();
      if (newArrivalTimer.current) clearTimeout(newArrivalTimer.current);
    };
  }, [autoConnect, authLoading, limit, listKey, page, queryClient, uid, unreadKey]);

  const markAsRead = useCallback((id: string) => markReadMutation.mutate(id), [markReadMutation]);
  const markAllAsRead = useCallback(() => markAllReadMutation.mutate(), [markAllReadMutation]);

  return {
    notifications: listData?.items || [],
    unreadCount,
    pagination: listData?.pagination,
    isLoading: authLoading || (Boolean(uid) && listLoading),
    isError,
    hasNewArrival,
    refetch,
    markAsRead,
    markAllAsRead,
  };
}
