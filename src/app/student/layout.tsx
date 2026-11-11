import { AreaAccessGuard } from '@/features/auth/components/AreaAccessGuard';

export default function StudentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AreaAccessGuard area="student">{children}</AreaAccessGuard>;
}
