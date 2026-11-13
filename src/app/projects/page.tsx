import { Suspense } from 'react';
import { ResearchProjectsView } from '@/features/projects/views/ResearchProjectsView';

export default function ProjectsPage() {
  return <Suspense fallback={<main style={{ padding: 32, color: '#64748b' }}>Loading…</main>}><ResearchProjectsView /></Suspense>;
}
