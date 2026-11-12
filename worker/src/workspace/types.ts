export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}

export interface WorkspaceEnv {
  DB: D1Database;
  PUBLICATION_PDFS?: { delete(keys: string | string[]): Promise<void> };
  FIREBASE_PROJECT_ID: string;
  FIREBASE_WEB_API_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  GOOGLE_WORKSPACE_DOMAIN: string;
  GOOGLE_ADMIN_EMAILS: string;
  TOKEN_ENCRYPTION_KEYS: string;
  TOKEN_ENCRYPTION_KEY_VERSION: string;
  FRONTEND_URL: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  ALLOWED_ORIGINS?: string;
  FRONTEND_ORIGINS?: string;
  WORKSPACE_DELETE_ENABLED?: string;
}

export interface WorkspaceIdentity {
  uid: string;
  role: 'ADMIN' | 'LECTURER' | 'STUDENT';
  email?: string;
  emailVerified?: boolean;
  signInProvider?: string;
}

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

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: unknown = null) {
    super(message);
    this.name = 'ApiError';
  }
}
