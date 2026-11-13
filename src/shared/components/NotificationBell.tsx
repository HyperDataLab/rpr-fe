'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications } from '../hooks/useNotifications';
import { AppNotification, NotificationType } from '../types/notification';
import { useTranslation } from '@/i18n';

interface NotificationBellProps {
  align?: 'left' | 'right';
  className?: string;
}

function formatRelativeTime(dateString: string, locale: string): string {
  try {
    const diff = (Date.now() - new Date(dateString).getTime()) / 1000;
    if (diff < 60) return locale === 'vi' ? 'Vừa xong' : 'Just now';
    if (diff < 3600) {
      const mins = Math.floor(diff / 60);
      return locale === 'vi' ? `${mins} phút trước` : `${mins}m ago`;
    }
    if (diff < 86400) {
      const hours = Math.floor(diff / 3600);
      return locale === 'vi' ? `${hours} giờ trước` : `${hours}h ago`;
    }
    const days = Math.floor(diff / 86400);
    return locale === 'vi' ? `${days} ngày trước` : `${days}d ago`;
  } catch {
    return '';
  }
}

function getNotificationIcon(type: NotificationType): { icon: ReactNode; bg: string; color: string } {
  switch (type) {
    case 'SUBMISSION_CREATED':
      return {
        bg: '#ecfdf5',
        color: '#059669',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        ),
      };
    case 'SUBMISSION_REVISED':
      return {
        bg: '#eef2ff',
        color: '#4f46e5',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        ),
      };
    case 'REVIEW_ASSIGNED':
      return {
        bg: '#f0f9ff',
        color: '#0284c7',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <polyline points="17 11 19 13 23 9" />
          </svg>
        ),
      };
    case 'REVIEW_COMPLETED':
      return {
        bg: '#f0fdf4',
        color: '#16a34a',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        ),
      };
    case 'PUBLICATION_APPROVED':
      return {
        bg: '#ecfdf5',
        color: '#059669',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 14 14" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        ),
      };
    case 'PUBLICATION_REJECTED':
      return {
        bg: '#fef2f2',
        color: '#dc2626',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ),
      };
    case 'REVISION_REQUESTED':
      return {
        bg: '#fffbeb',
        color: '#d97706',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        ),
      };
    case 'USER_REGISTERED':
      return {
        bg: '#faf5ff',
        color: '#9333ea',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
        ),
      };
    case 'PROJECT_INVITATION':
      return {
        bg: '#eff8ff',
        color: '#0071bc',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="8" r="3" />
            <circle cx="17" cy="9" r="2" />
            <path d="M3 20v-1a6 6 0 0 1 12 0v1M16 15a4 4 0 0 1 5 4v1" />
          </svg>
        ),
      };
    default:
      return {
        bg: '#f1f5f9',
        color: '#475569',
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        ),
      };
  }
}

type PopoverPhase = 'closed' | 'open' | 'closing';

export function NotificationBell({ align = 'right', className = '' }: NotificationBellProps) {
  const { locale } = useTranslation();
  const router = useRouter();
  const [phase, setPhase] = useState<PopoverPhase>('closed');
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    hasNewArrival,
    isLoading,
    markAsRead,
    markAllAsRead,
  } = useNotifications();

  const openPopover = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setPhase('open');
  };

  const closePopover = () => {
    setPhase((current) => {
      if (current === 'closed' || current === 'closing') return current;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setPhase('closed');
      }, 260);
      return 'closing';
    });
  };

  const togglePopover = () => {
    if (phase === 'open') {
      closePopover();
    } else {
      openPopover();
    }
  };

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (phase !== 'open') return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closePopover();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closePopover();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleItemClick = (item: AppNotification) => {
    if (!item.isRead) {
      markAsRead(item.id);
    }
    closePopover();
    if (item.link) {
      router.push(item.link);
    }
  };

  const handleMarkAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    markAllAsRead();
  };

  return (
    <div className={`student-topbar__notif-wrapper ${className}`} ref={containerRef}>
      <button
        type="button"
        className={`student-topbar__notif-btn ${hasNewArrival ? 'student-topbar__notif-btn--pulse' : ''}`}
        onClick={togglePopover}
        aria-label={`Thông báo (${unreadCount} chưa đọc)`}
        title={locale === 'vi' ? 'Thông báo' : 'Notifications'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {unreadCount > 0 && (
          <span className="student-topbar__notif-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {phase !== 'closed' && (
        <>
          <div
            className={`student-notif-backdrop ${phase === 'open' ? 'student-notif-backdrop--open' : 'student-notif-backdrop--closing'}`}
            onClick={closePopover}
            aria-hidden="true"
          />
          <div
            className={`student-topbar__notif-popover ${phase === 'open' ? 'student-topbar__notif-popover--open' : 'student-topbar__notif-popover--closing'}`}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget && phase === 'closing') {
                if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
                setPhase('closed');
              }
            }}
            style={{
              [align === 'left' ? 'left' : 'right']: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '13.5px', color: '#0f172a', fontWeight: 700 }}>
                {locale === 'vi' ? 'Thông báo' : 'Notifications'}
              </strong>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  className="student-notif-popover__mark-all-btn"
                  style={{ textDecoration: 'none' }}
                >
                  {locale === 'vi' ? 'Đã đọc tất cả' : 'Mark all read'}
                </button>
              )}

              <button
                type="button"
                onClick={closePopover}
                className="student-notif-popover__close-btn"
                aria-label={locale === 'vi' ? 'Đóng thông báo' : 'Close notifications'}
                title={locale === 'vi' ? 'Đóng' : 'Close'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* List */}
          <div
            className="student-notif-popover__list"
            style={{
              overflowY: 'auto',
              flex: 1,
            }}
          >
            {isLoading ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                {locale === 'vi' ? 'Đang tải thông báo...' : 'Loading notifications...'}
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: '36px 20px', textAlign: 'center', color: '#94a3b8' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 8px' }}>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                  {locale === 'vi' ? 'Bạn không có thông báo nào' : 'No notifications'}
                </p>
              </div>
            ) : (
              notifications.map((item) => {
                const { icon, bg, color } = getNotificationIcon(item.type);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`student-notif-item ${item.isRead ? '' : 'student-notif-item--unread'}`}
                  >
                    {/* Icon Badge */}
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: bg,
                        color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: '2px',
                      }}
                    >
                      {icon}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '2px' }}>
                        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: item.isRead ? 600 : 700, color: '#0f172a', lineHeight: 1.3 }}>
                          {item.title}
                        </h4>
                        {!item.isRead && <span className="student-notif-item__dot" />}
                      </div>

                      <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#475569', lineHeight: 1.4, wordBreak: 'break-word' }}>
                        {item.content}
                      </p>

                      <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>
                        {formatRelativeTime(item.createdAt, locale)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </>
    )}
    </div>
  );
}

export default NotificationBell;
