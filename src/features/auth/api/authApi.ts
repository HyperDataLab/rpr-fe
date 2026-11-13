import {
  confirmPasswordReset,
  GoogleAuthProvider,
  signInWithCustomToken,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { User } from '@/shared/types';
import { firebaseAuth, firestoreDb } from '@/lib/firebase/client';

export const USER_PROFILES = 'userProfiles';

function profileFromData(id: string, data: Record<string, unknown>): User {
  const toIso = (value: unknown) => {
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
      return (value.toDate as () => Date)().toISOString();
    }
    return typeof value === 'string' ? value : undefined;
  };
  return {
    id,
    email: String(data.email || ''),
    workspaceEmail: typeof data.workspaceEmail === 'string' ? data.workspaceEmail : undefined,
    name: typeof data.name === 'string' ? data.name : undefined,
    firstName: typeof data.firstName === 'string' ? data.firstName : undefined,
    lastName: typeof data.lastName === 'string' ? data.lastName : undefined,
    studentId: typeof data.studentId === 'string' ? data.studentId : undefined,
    major: typeof data.major === 'string' ? data.major : undefined,
    affiliation: typeof data.affiliation === 'string' ? data.affiliation : undefined,
    avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : undefined,
    role: data.role === 'ADMIN' || data.role === 'LECTURER' ? data.role : 'STUDENT',
    status: typeof data.status === 'string' ? data.status : 'PENDING',
    isActive: data.isActive === true,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export async function loadUserProfile(uid: string): Promise<User | null> {
  const snapshot = await getDoc(doc(firestoreDb(), USER_PROFILES, uid));
  return snapshot.exists() ? profileFromData(uid, snapshot.data()) : null;
}

export const authApi = {
  async me(): Promise<User | null> {
    const currentUser = firebaseAuth().currentUser;
    return currentUser ? loadUserProfile(currentUser.uid) : null;
  },

  async loginWithUsername(username: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
    const workerUrl = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
    if (!workerUrl) return { success: false, error: 'Cloudflare Worker URL is not configured.' };
    try {
      const response = await fetch(`${workerUrl}/auth/username-login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }), cache: 'no-store',
      });
      const result = await response.json().catch(() => null) as { data?: { customToken?: string }; error?: { message?: string } } | null;
      if (!response.ok || !result?.data?.customToken) throw new Error(result?.error?.message || 'Username or password is incorrect.');
      const credential = await signInWithCustomToken(firebaseAuth(), result.data.customToken);
      const user = await loadUserProfile(credential.user.uid);
      if (!user || !user.isActive || user.status !== 'APPROVED') {
        await signOut(firebaseAuth());
        return { success: false, error: 'This account is not active. Contact an administrator.' };
      }
      return { success: true, user };
    } catch (error) {
      await signOut(firebaseAuth()).catch(() => undefined);
      return { success: false, error: error instanceof Error ? error.message : 'Username or password is incorrect.' };
    }
  },

  async login(identifier: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
    const email = identifier.trim().toLowerCase();
    if (!email.includes('@')) {
      return { success: false, error: 'Hãy đăng nhập bằng địa chỉ email. Tên đăng nhập cũ cần được chuyển đổi sang Firebase Auth.' };
    }
    try {
      const credential = await signInWithEmailAndPassword(firebaseAuth(), email, password);
      const user = await loadUserProfile(credential.user.uid);
      if (!user) {
        await signOut(firebaseAuth());
        return { success: false, error: 'Tài khoản chưa được chuyển sang hồ sơ Firebase. Vui lòng liên hệ quản trị viên.' };
      }
      if (user.workspaceEmail) {
        await signOut(firebaseAuth());
        return { success: false, error: `Tài khoản này đăng nhập bằng Google Workspace (${user.workspaceEmail}), không dùng email cá nhân và mật khẩu.` };
      }
      if (!user.isActive || user.status !== 'APPROVED') {
        await signOut(firebaseAuth());
        return { success: false, error: user.status === 'PENDING' ? 'Tài khoản đang chờ quản trị viên phê duyệt.' : 'Tài khoản chưa được kích hoạt.' };
      }
      return { success: true, user };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Đăng nhập thất bại.' };
    }
  },

  async loginWithWorkspace(ssoRequestId?: string): Promise<{ success: boolean; user?: User; error?: string; ssoRedirectUrl?: string }> {
    const auth = firebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      hd: process.env.NEXT_PUBLIC_GOOGLE_WORKSPACE_DOMAIN || 'hyperdatalab.org',
      prompt: 'select_account',
    });
    try {
      const googleCredential = await signInWithPopup(auth, provider);
      const workerUrl = process.env.NEXT_PUBLIC_R2_WORKER_URL?.replace(/\/$/, '');
      if (!workerUrl) throw new Error('Cloudflare Worker URL is not configured.');
      const response = await fetch(`${workerUrl}/auth/workspace/exchange`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await googleCredential.user.getIdToken()}`,
          'content-type': 'application/json',
        },
        body: '{}',
        cache: 'no-store',
      });
      const result = await response.json().catch(() => null) as {
        data?: { customToken?: string };
        error?: { message?: string };
      } | null;
      if (!response.ok || !result?.data?.customToken) {
        throw new Error(result?.error?.message || 'Tài khoản Google này chưa được liên kết với hồ sơ ứng dụng.');
      }

      const credential = await signInWithCustomToken(auth, result.data.customToken);
      const user = await loadUserProfile(credential.user.uid);
      if (!user?.workspaceEmail || !user.isActive || user.status !== 'APPROVED') {
        await signOut(auth);
        return { success: false, error: 'Hồ sơ ứng dụng chưa được kích hoạt cho Google Workspace.' };
      }
      if (user.workspaceEmail.toLowerCase() !== googleCredential.user.email?.toLowerCase()) {
        await signOut(auth);
        return { success: false, error: 'Email Google đăng nhập không khớp email Workspace đã được cấp.' };
      }
      if (ssoRequestId) {
        const completeResponse = await fetch(`${workerUrl.replace(/\/$/, '')}/api/sso/authorize/complete`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await credential.user.getIdToken()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ requestId: ssoRequestId }),
          cache: 'no-store',
        });
        const completed = await completeResponse.json().catch(() => null) as {
          data?: { redirectUrl?: string }; error?: { message?: string };
        } | null;
        if (!completeResponse.ok || !completed?.data?.redirectUrl) {
          throw new Error(completed?.error?.message || 'Could not complete the external sign-in request.');
        }
        return { success: true, user, ssoRedirectUrl: completed.data.redirectUrl };
      }
      return { success: true, user };
    } catch (error) {
      await signOut(auth).catch(() => undefined);
      return { success: false, error: error instanceof Error ? error.message : 'Đăng nhập Google Workspace thất bại.' };
    }
  },

  async register(params: { firstName: string; lastName: string; email: string; studentId: string; major: string; phone?: string }) {
    const workerUrl = process.env.NEXT_PUBLIC_R2_WORKER_URL?.trim();
    if (!workerUrl) throw new Error('Cloudflare Worker URL is not configured for registration.');
    let response: Response;
    try {
      response = await fetch(`${workerUrl.replace(/\/$/, '')}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    } catch {
      throw new Error('Cannot reach the Cloudflare Worker. Check the network and try again.');
    }
    const rawBody = await response.text();
    let body: {
      success?: boolean;
      message?: string;
      requestId?: string;
      user?: { email?: string; name?: string };
      error?: string | { message?: string };
    } | null = null;
    try {
      body = rawBody ? JSON.parse(rawBody) as {
        success?: boolean;
        message?: string;
        requestId?: string;
        user?: { email?: string; name?: string };
        error?: string | { message?: string };
      } : null;
    } catch { /* The Worker may return a plain-text error. */ }
    const errorMessage = typeof body?.error === 'string' ? body.error : body?.error?.message;
    if (!response.ok) {
      throw new Error(body?.message || errorMessage || rawBody.trim() || `Registration request failed (HTTP ${response.status}).`);
    }
    if (!body?.success || !body.user?.email || !body.user.name) throw new Error('The server returned an invalid registration response.');
    return { ...body, success: true, user: { email: body.user.email, name: body.user.name } };
  },
  async sendPasswordReset(email: string) {
    const auth = firebaseAuth();
    const actionCodeSettings = typeof window === 'undefined' ? undefined : {
      url: `${window.location.origin}/forgot-password`,
      handleCodeInApp: false,
    };
    await sendPasswordResetEmail(auth, email.trim().toLowerCase(), actionCodeSettings);
  },

  async confirmPasswordReset(code: string, newPassword: string) {
    await confirmPasswordReset(firebaseAuth(), code, newPassword);
  },

  async updateProfile(params: {
    name?: string;
    firstName?: string;
    lastName?: string;
    studentId?: string;
    major?: string;
    avatarUrl?: string;
  }): Promise<{ success: boolean; message?: string; user?: User }> {
    const currentUser = firebaseAuth().currentUser;
    if (!currentUser) throw new Error('Bạn cần đăng nhập để cập nhật hồ sơ.');
    const patch = { ...params, updatedAt: serverTimestamp() };
    await updateDoc(doc(firestoreDb(), USER_PROFILES, currentUser.uid), patch);
    if (params.name !== undefined || params.avatarUrl !== undefined) {
      await updateFirebaseProfile(currentUser, {
        displayName: params.name,
        photoURL: params.avatarUrl,
      });
    }
    return { success: true, user: await loadUserProfile(currentUser.uid) ?? undefined };
  },

  async logout() {
    await signOut(firebaseAuth());
    if (typeof window !== 'undefined') window.location.href = '/login';
  },

  loginUrl: '/login',
  registerUrl: '/register',
  logoutUrl: '/login',
};

export default authApi;
