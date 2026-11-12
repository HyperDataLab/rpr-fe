'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '@/shared/types';

const areaRoles: Record<'admin' | 'lecturer' | 'student', Role[]> = {
  admin: ['ADMIN'],
  lecturer: ['LECTURER', 'ADMIN'],
  student: ['STUDENT', 'LECTURER', 'ADMIN'],
};

const homeForRole: Record<Role, string> = {
  ADMIN: '/admin/dashboard',
  LECTURER: '/lecturer/reviews',
  STUDENT: '/student/my-preprints',
};

export function AreaAccessGuard({ area, children }: {
  area: 'admin' | 'lecturer' | 'student';
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || `/${area}`)}`);
      return;
    }
    if (!user.isActive || user.status !== 'APPROVED') {
      router.replace('/login?reason=pending');
      return;
    }
    if (!user.role || !areaRoles[area].includes(user.role)) {
      router.replace(homeForRole[user.role || 'STUDENT']);
    }
  }, [area, loading, pathname, router, user]);

  if (loading || !user || !user.isActive || user.status !== 'APPROVED' || !user.role || !areaRoles[area].includes(user.role)) {
    return null;
  }
  return children;
}
