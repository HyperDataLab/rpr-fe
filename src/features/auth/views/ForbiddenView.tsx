'use client';

import Link from 'next/link';
import { Button, Panel, PageHeader } from '@hyperdata/design-system';
import { ROUTES } from '@/app/router';
import { authApi } from '@/features/auth/api/authApi';

export function ForbiddenView() {
  return (
    <main className="content forbidden-page">
      <Panel className="section-panel">
        <PageHeader
          title="You do not have access to this workspace."
          description="Your account does not have the role required for this workspace. Return to the public gateway or sign in with an approved account."
        />
        <div className="review-actions">
          <Link href={ROUTES.HOME}>
            <Button variant="secondary">Back to gateway</Button>
          </Link>
          <Button onClick={() => void authApi.logout()}>Sign out</Button>
        </div>
      </Panel>
    </main>
  );
}

export default ForbiddenView;
