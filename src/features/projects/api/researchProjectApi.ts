import { workerRequest } from '@/lib/cloudflare/worker-client';

export interface ResearchUser {
  uid: string;
  username: string;
  email: string;
  name: string;
  role: string;
}

export interface ResearchProject {
  id: string;
  title: string;
  description: string;
  researchArea: string;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
  membershipRole: 'OWNER' | 'MEMBER';
  membershipStatus?: 'ACTIVE' | 'INVITED';
  owner: ResearchUser | null;
}

export interface ResearchProjectMember {
  userUid: string;
  role: 'OWNER' | 'MEMBER';
  status: 'ACTIVE' | 'INVITED';
  invitationEmailStatus: 'PENDING' | 'SENT' | 'FAILED';
  createdAt: string;
  user: ResearchUser | null;
}

interface Envelope<T> { success: true; data: T; message: string }
const unwrap = <T,>(result: Envelope<T>) => result.data;
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const researchProjectApi = {
  list: async () => unwrap(await workerRequest<Envelope<{ projects: ResearchProject[]; invitations: ResearchProject[] }>>('/api/research-projects')),
  create: async (payload: { title: string; description: string; researchArea: string }) => unwrap(await workerRequest<Envelope<ResearchProject>>('/api/research-projects', json(payload))),
  findUser: async (query: string) => unwrap(await workerRequest<Envelope<{ user: ResearchUser | null }>>(`/api/research-projects/users?query=${encodeURIComponent(query)}`)),
  detail: async (id: string) => unwrap(await workerRequest<Envelope<ResearchProject & { members: ResearchProjectMember[] }>>(`/api/research-projects/${encodeURIComponent(id)}`)),
  invite: async (id: string, usernameOrEmail: string) => unwrap(await workerRequest<Envelope<{ invited: boolean; notificationSent: boolean; emailSent: boolean }>>(`/api/research-projects/${encodeURIComponent(id)}/invitations`, json({ usernameOrEmail }))),
  resendInvitation: async (projectId: string, uid: string) => unwrap(await workerRequest<Envelope<{ emailSent: boolean }>>(`/api/research-projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(uid)}/resend`, json({}))),
  respond: async (projectId: string, uid: string, action: 'accept' | 'decline') => unwrap(await workerRequest<Envelope<{ status: string }>>(`/api/research-projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(uid)}/${action}`, json({}))),
  removeMember: async (projectId: string, uid: string) => unwrap(await workerRequest<Envelope<{ removed: boolean }>>(`/api/research-projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(uid)}`, { method: 'DELETE' })),
};
