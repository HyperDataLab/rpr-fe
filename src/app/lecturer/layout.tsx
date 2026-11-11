import { AreaAccessGuard } from '@/features/auth/components/AreaAccessGuard';

export default function LecturerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AreaAccessGuard area="lecturer">{children}</AreaAccessGuard>;
}
