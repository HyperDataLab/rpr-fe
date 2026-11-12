'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StudentShell } from '../components';
import { LecturerShell } from '@/features/lecturer/components';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { studentPreprintApi } from '../api';
import type { StudentPreprint, PreprintVersionInfo } from '../types';
import { TimelineSkeleton } from '@/components/skeleton';
import { useTranslation } from '@/i18n';

interface PreprintVersionsViewProps {
  id: string;
}

function PreprintVersionsShell({
  isLecturer,
  title,
  actions,
  children,
}: {
  isLecturer: boolean;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return isLecturer ? (
    <LecturerShell active="submissions" title={title}>
      {actions && <div style={{ marginBottom: '20px' }}>{actions}</div>}
      {children}
    </LecturerShell>
  ) : (
    <StudentShell
      title={title}
      actions={actions}
    >
      {children}
    </StudentShell>
  );
}

export function PreprintVersionsView({ id }: PreprintVersionsViewProps) {
  const { t, locale } = useTranslation();
  const pathname = usePathname();
  const { user } = useAuth();
  const isLecturer = user?.role === 'LECTURER' || (pathname?.startsWith('/lecturer/') ?? false);
  const workspacePath = isLecturer ? '/lecturer/submissions' : '/student/my-preprints';
  const editPath = `${workspacePath}/${id}/edit`;
  const detailPath = `${workspacePath}/${id}`;

  const [item, setItem] = useState<StudentPreprint | null>(null);
  const [versions, setVersions] = useState<PreprintVersionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    studentPreprintApi.get(id)
      .then((res) => {
        if (!active) return;
        setItem(res);
        setVersions(res.versions || []);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err : new Error(locale === 'vi' ? 'Không thể tải lịch sử phiên bản.' : 'Failed to load version history.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id, locale]);

  const pageTitle = item
    ? `${t('student.preprints.versionsHistory')}: ${item.title}`
    : t('student.preprints.versionsHistory');

  return (
    <PreprintVersionsShell
      isLecturer={isLecturer}
      title={pageTitle}
      actions={
        item && (
          <div className="student-detail-top-actions">
            {(item.status === 'NEEDS_REVISION' || item.status === 'DRAFT') && (
              <Link href={editPath} className="student-btn student-btn--warning">
                <span>Nộp phiên bản mới →</span>
              </Link>
            )}
            {(item.status === 'PUBLISHED' || item.status === 'APPROVED') && (
              <Link
                href={editPath}
                className="student-btn student-btn--secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderColor: '#0071bc',
                  color: '#0071bc',
                  fontWeight: 700,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>{locale === 'vi' ? 'Cập nhật bài báo' : 'Update Paper'}</span>
              </Link>
            )}
            <Link href={detailPath} className="student-btn student-btn--secondary">
              <span>Quay lại bản thảo</span>
            </Link>
          </div>
        )
      }
    >
      {loading && <TimelineSkeleton count={3} />}

      {error && (
        <div className="student-error-banner">
          <strong>Lỗi khi tải phiên bản:</strong> {error.message}
        </div>
      )}

      {!loading && !error && (
        <div className="student-versions-container">
          <div className="student-versions-header-box">
            <h3>Lưu trữ phiên bản bất biến</h3>
            <p>
              Bản thảo không thể bị xóa sau khi đã phát hành. Mọi bản sửa đổi được lưu vĩnh viễn kèm theo dấu thời gian mật mã, tệp đính kèm và ghi chú phản hồi của tác giả.
            </p>
          </div>

          <div className="student-versions-timeline">
            {versions.map((ver, index) => {
              const isLatest = index === 0;

              return (
                <div key={ver.version} className={`student-version-card ${isLatest ? 'student-version-card--latest' : ''}`}>
                  <div className="student-version-badge-col">
                    <div className="student-version-pill">
                      {ver.version_label}
                    </div>
                    {isLatest && <span className="student-latest-tag">Hiện tại</span>}
                  </div>

                  <div className="student-version-main">
                    <div className="student-version-header-row">
                      <div className="student-version-title-group">
                        <strong className="student-version-title">Phát hành phiên bản {ver.version}</strong>
                        <span className="student-version-date">
                          Xác thực lúc {new Date(ver.created_at).toLocaleDateString('vi-VN', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                      <span className={`student-status-badge student-status-badge--${ver.status.toLowerCase().replace('_', '-')}`}>
                        {ver.status === 'PUBLISHED'
                          ? 'ĐÃ XUẤT BẢN'
                          : ver.status === 'APPROVED'
                          ? 'ĐÃ DUYỆT'
                          : ver.status === 'NEEDS_REVISION'
                          ? 'CẦN CHỈNH SỬA'
                          : ver.status === 'UNDER_REVIEW'
                          ? 'ĐANG THẨM ĐỊNH'
                          : ver.status === 'REJECTED'
                          ? 'ĐÃ TỪ CHỐI'
                          : ver.status === 'WITHDRAWN'
                          ? 'ĐÃ RÚT'
                          : 'BẢN NHÁP'}
                      </span>
                    </div>

                    {ver.change_summary && (
                      <div className="student-version-summary-box">
                        <span className="student-version-summary-label">Tóm tắt thay đổi:</span>
                        <p className="student-version-summary-text">{ver.change_summary}</p>
                      </div>
                    )}

                    <div className="student-version-file-box">
                      <div className="student-version-file-left">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span className="student-file-name">{ver.file_name}</span>
                        <span className="student-file-size">({ver.file_size})</span>
                      </div>

                      {ver.sha256 && (
                        <div className="student-version-hash">
                          <span>SHA-256:</span>
                          <code>{ver.sha256.substring(0, 16)}…</code>
                        </div>
                      )}

                      {ver.download_url ? (
                        <a
                          href={ver.download_url}
                          target="_blank"
                          rel="noreferrer"
                          className="student-action-link student-action-link--primary"
                        >
                          Tải tệp PDF
                        </a>
                      ) : (
                        <span className="student-action-link">Tệp PDF không khả dụng</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </PreprintVersionsShell>
  );
}

export default PreprintVersionsView;
