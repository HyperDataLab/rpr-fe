import { workerRequest } from '@/lib/cloudflare/worker-client';

export interface WorkspaceUser {
  id: string;
  primaryEmail: string;
  name: { givenName: string; familyName: string; fullName: string };
  suspended: boolean;
  orgUnitPath?: string;
  recoveryEmail?: string;
  recoveryPhone?: string;
  creationTime?: string;
  lastLoginTime?: string;
  changePasswordAtNextLogin?: boolean;
}

export interface WorkspaceConnectionStatus {
  connected: boolean;
  status: 'CONNECTED' | 'REVOKED' | 'DISCONNECTED';
  domain: string | null;
  adminEmail: string | null;
  connectedAt: string | null;
  scopes: string[];
  deleteEnabled: boolean;
}

interface ApiEnvelope<T> { success: true; data: T; message: string }
interface WorkspaceUsersPage { users: WorkspaceUser[]; nextPageToken: string | null; pageSize: number; total: number | null; etag: string | null }
type WorkspaceUserPatch = Partial<Pick<WorkspaceUser['name'], 'givenName' | 'familyName'>> & Pick<Partial<WorkspaceUser>, 'orgUnitPath' | 'recoveryEmail' | 'recoveryPhone'>;

const unwrap = <T>(value: ApiEnvelope<T>) => value.data;

export async function connectGoogleWorkspace(): Promise<void> {
  const result = unwrap(await workerRequest<ApiEnvelope<{ authorizationUrl: string }>>('/auth/google/start', { method: 'POST' }));
  window.location.assign(result.authorizationUrl);
}

export async function getWorkspaceConnectionStatus() {
  return unwrap(await workerRequest<ApiEnvelope<WorkspaceConnectionStatus>>('/auth/google/status'));
}

export async function disconnectGoogleWorkspace() {
  return unwrap(await workerRequest<ApiEnvelope<{ connected: boolean; status: string }>>('/auth/google/disconnect', { method: 'POST' }));
}

export async function listWorkspaceUsers(params: { pageSize?: number; pageToken?: string; query?: string; orderBy?: 'email' | 'givenName' | 'familyName'; sortOrder?: 'ASCENDING' | 'DESCENDING' } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value));
  return unwrap(await workerRequest<ApiEnvelope<WorkspaceUsersPage>>(`/api/workspace/users${query.size ? `?${query}` : ''}`));
}

export async function getWorkspaceUser(id: string) {
  return unwrap(await workerRequest<ApiEnvelope<WorkspaceUser>>(`/api/workspace/users/${encodeURIComponent(id)}`));
}

export async function createWorkspaceUser(payload: { email: string; firstName: string; lastName: string; changePasswordAtNextLogin?: boolean; orgUnitPath?: string }) {
  return unwrap(await workerRequest<ApiEnvelope<WorkspaceUser>>('/api/workspace/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
}

export interface WorkspaceProfile {
  id: string;
  email: string;
  workspaceEmail: string;
  name: string;
  role: 'ADMIN' | 'LECTURER' | 'STUDENT';
  status: 'APPROVED';
  isActive: true;
}

export async function createWorkspaceProfile(payload: {
  email: string;
  name?: string;
  role: WorkspaceProfile['role'];
  studentId?: string;
  major?: string;
}) {
  return unwrap(await workerRequest<ApiEnvelope<WorkspaceProfile>>('/api/workspace/profiles', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }));
}

export async function updateWorkspaceUser(id: string, payload: WorkspaceUserPatch) {
  return unwrap(await workerRequest<ApiEnvelope<WorkspaceUser>>(`/api/workspace/users/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
}

export async function suspendWorkspaceUser(id: string) {
  return unwrap(await workerRequest<ApiEnvelope<WorkspaceUser>>(`/api/workspace/users/${encodeURIComponent(id)}/suspend`, { method: 'PATCH' }));
}

export async function restoreWorkspaceUser(id: string) {
  return unwrap(await workerRequest<ApiEnvelope<WorkspaceUser>>(`/api/workspace/users/${encodeURIComponent(id)}/restore`, { method: 'PATCH' }));
}

export async function deleteWorkspaceUser(id: string, confirmEmail: string) {
  return unwrap(await workerRequest<ApiEnvelope<null>>(`/api/workspace/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmEmail }) }));
}
