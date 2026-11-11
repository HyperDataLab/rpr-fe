import {
  confirmPasswordReset,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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
      if (!user.isActive || user.status !== 'APPROVED') {
        await signOut(firebaseAuth());
        return { success: false, error: user.status === 'PENDING' ? 'Tài khoản đang chờ quản trị viên phê duyệt.' : 'Tài khoản chưa được kích hoạt.' };
      }
      return { success: true, user };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Đăng nhập thất bại.' };
    }
  },

  async register(params: { firstName: string; lastName: string; email: string; studentId: string; major: string; phone?: string }) {
    const workerUrl = process.env.NEXT_PUBLIC_R2_WORKER_URL;
    if (!workerUrl) throw new Error('Cloudflare Worker chưa được cấu hình để nhận yêu cầu đăng ký.');
    const response = await fetch(`${workerUrl.replace(/\/$/, '')}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    if (!response.ok) throw new Error(body?.message || body?.error || 'Không thể gửi yêu cầu đăng ký.');
    return body;
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

  async createPendingProfile(uid: string, input: { email: string; name?: string; firstName?: string; lastName?: string; studentId?: string; major?: string }) {
    const now = serverTimestamp();
    await setDoc(doc(firestoreDb(), USER_PROFILES, uid), {
      ...input,
      role: 'STUDENT',
      status: 'PENDING',
      isActive: false,
      createdAt: now,
      updatedAt: now,
    });
  },

  loginUrl: '/login',
  registerUrl: '/register',
  logoutUrl: '/login',
};

export default authApi;
