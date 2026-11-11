import { AreaAccessGuard } from '@/features/auth/components/AreaAccessGuard';

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AreaAccessGuard area="admin">{children}</AreaAccessGuard>;
}
