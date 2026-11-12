'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { StudentDashboardLayout } from './StudentDashboardLayout';

interface StudentShellProps {
  title?: string;
  actions?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  showStandardHeader?: boolean;
  children: ReactNode;
}

export function StudentShell({
  title,
  actions,
  breadcrumbs,
  showStandardHeader = false,
  children,
}: StudentShellProps) {
  return (
    <StudentDashboardLayout title={title}>
      {/* Breadcrumbs if provided */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="student-breadcrumbs" aria-label="Breadcrumb" style={{ marginBottom: '16px' }}>
          {breadcrumbs.map((crumb, idx) => (
            <span key={crumb.label} className="student-breadcrumb-item">
              {idx > 0 && <span className="student-breadcrumb-separator">/</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="student-breadcrumb-link">
                  {crumb.label}
                </Link>
              ) : (
                <span className="student-breadcrumb-current">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Standard Page Title Header if enabled */}
      {showStandardHeader && title && (
        <div className="student-view-header">
          <div>
            <h1 className="student-page-title">{title}</h1>
          </div>
          {actions && <div className="student-view-actions">{actions}</div>}
        </div>
      )}

      {/* Children View Content */}
      <div className="student-content">{children}</div>
    </StudentDashboardLayout>
  );
}

export default StudentShell;
