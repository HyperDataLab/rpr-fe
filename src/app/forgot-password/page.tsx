'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { HyperdataLogo } from '@/components/hyperdata-logo';
import { authApi } from '@/features/auth/api/authApi';
import '@/styles/public-landing.css';
import '@/styles/auth-forms.css';

function ForgotPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialToken = searchParams.get('oobCode') || searchParams.get('token') || '';

  // Mode: 'request' (enter email) vs 'reset' (enter new password)
  const [mode, setMode] = useState<'request' | 'reset'>(initialToken ? 'reset' : 'request');
  
  // Step 1 states
  const [identifier, setIdentifier] = useState('');
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccessMessage, setRequestSuccessMessage] = useState<string | null>(null);
  const [devTokenData, setDevTokenData] = useState<{ devToken?: string; devResetLink?: string; email?: string } | null>(null);

  // Step 2 states
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // Sync token from URL param if query changes
  useEffect(() => {
    if (initialToken) {
      setToken(initialToken);
      setMode('reset');
    }
  }, [initialToken]);

  // Countdown timer redirect when resetSuccess is true
  useEffect(() => {
    if (!resetSuccess) return;

    if (countdown <= 0) {
      router.push('/login');
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [resetSuccess, countdown, router]);

  // Password strength calculation
  const hasMinLength = newPassword.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^a-zA-Z0-9]/.test(newPassword);

  let strengthScore = 0;
  if (hasMinLength) strengthScore += 1;
  if (hasLetter && hasNumber) strengthScore += 1;
  if (hasSpecial) strengthScore += 1;

  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;

  // Handle Step 1: Request reset link
  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError(null);
    setRequestSuccessMessage(null);
    setDevTokenData(null);
    setRequestLoading(true);

    try {
      const res = await authApi.sendPasswordReset(identifier.trim()).then(() => new Response(
        JSON.stringify({ message: 'Yêu cầu đã được ghi nhận. Vui lòng kiểm tra hộp thư.' }),
        { status: 200 },
      ));

      const data = await res.json();
      if (!res.ok) {
        setRequestError(data.error || 'Yêu cầu thất bại. Vui lòng kiểm tra lại thông tin.');
        setRequestLoading(false);
        return;
      }

      setRequestSuccessMessage(data.message || 'Yêu cầu đã được ghi nhận. Vui lòng kiểm tra hòm thư.');
      if (data.devToken || data.devResetLink) {
        setDevTokenData({
          devToken: data.devToken,
          devResetLink: data.devResetLink,
          email: data.email,
        });
      }
      setRequestLoading(false);
    } catch {
      setRequestError('Không thể kết nối đến máy chủ xác thực.');
      setRequestLoading(false);
    }
  };

  // Handle Step 2: Reset password
  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setResetError('Mã xác thực (Token) không được để trống.');
      return;
    }

    if (!hasMinLength) {
      setResetError('Mật khẩu mới phải có ít nhất 8 ký tự.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setResetError('Mật khẩu xác nhận không trùng khớp.');
      return;
    }

    setResetError(null);
    setResetLoading(true);

    try {
      const res = await authApi.confirmPasswordReset(token.trim(), newPassword).then(() => new Response('{}', { status: 200 }));

      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error || 'Đặt lại mật khẩu thất bại. Mã xác thực có thể đã hết hạn.');
        setResetLoading(false);
        return;
      }

      setResetSuccess(true);
      setResetLoading(false);
    } catch {
      setResetError('Không thể kết nối đến máy chủ.');
      setResetLoading(false);
    }
  };

  return (
    <div className="auth-card" style={{ maxWidth: 480, margin: '0 auto' }}>
      {resetSuccess ? (
        /* Success Screen with Auto-redirect */
        <div className="auth-success-view">
          <div className="auth-success-icon">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="auth-title" style={{ fontSize: 24, textAlign: 'center', marginBottom: 4 }}>
            Đổi mật khẩu thành công!
          </h2>
          <p className="auth-subtitle" style={{ textAlign: 'center', marginBottom: 12 }}>
            Mật khẩu tài khoản của bạn đã được cập nhật an toàn. Mọi phiên đăng nhập cũ đã được đăng xuất để bảo vệ quyền riêng tư.
          </p>

          <div className="auth-countdown-card">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" style={{ animation: 'spin 2s linear infinite' }}>
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
            </svg>
            <span>Tự động chuyển về trang Đăng nhập sau <strong>{countdown}s</strong>...</span>
          </div>

          <div style={{ width: '100%', marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="auth-btn auth-btn--primary"
            >
              Đến trang Đăng nhập ngay
            </button>
            <Link
              href="/"
              style={{
                display: 'block',
                textAlign: 'center',
                fontSize: 13,
                color: '#647381',
                textDecoration: 'none',
                fontWeight: 600,
                padding: '6px',
              }}
            >
              Về trang chủ HyperData Lab
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Header Title */}
          <div style={{ marginBottom: 20, textAlign: 'left' }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#122331', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
              {mode === 'request' ? 'Quên mật khẩu' : 'Thiết lập mật khẩu mới'}
            </h2>
            <p style={{ fontSize: 13, color: '#647381', margin: 0, lineHeight: 1.5 }}>
              {mode === 'request'
                ? 'Nhập Email hoặc Tên đăng nhập học vụ của bạn để nhận liên kết xác thực.'
                : 'Nhập mã xác thực cùng mật khẩu mới an toàn cho tài khoản.'}
            </p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="auth-mode-switch">
            <button
              type="button"
              className={`auth-mode-tab ${mode === 'request' ? 'auth-mode-tab--active' : ''}`}
              onClick={() => {
                setMode('request');
                setRequestError(null);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              1. Nhận mã
            </button>
            <button
              type="button"
              className={`auth-mode-tab ${mode === 'reset' ? 'auth-mode-tab--active' : ''}`}
              onClick={() => {
                setMode('reset');
                setResetError(null);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              2. Đổi mật khẩu
            </button>
          </div>

          {/* ───────────── MODE 1: Request Reset Link ───────────── */}
          {mode === 'request' && (
            <div>
              {requestError && (
                <div className="auth-alert-box" role="alert" style={{ marginBottom: 16 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <div>{requestError}</div>
                </div>
              )}

              {requestSuccessMessage && (
                <div style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#166534',
                  padding: '14px',
                  borderRadius: 12,
                  fontSize: 13,
                  lineHeight: 1.5,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 2 }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <div>
                    <strong>Đã tiếp nhận yêu cầu!</strong>
                    <div style={{ marginTop: 2 }}>{requestSuccessMessage}</div>
                  </div>
                </div>
              )}

              {/* Dev Helper Box (Visible when backend provides dev token in local dev) */}
              {devTokenData && devTokenData.devToken && (
                <div style={{
                  background: '#eff6ff',
                  border: '1px dashed #93c5fd',
                  borderRadius: 12,
                  padding: '14px',
                  marginBottom: 16,
                  textAlign: 'left',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    ⚡ Tiện ích kiểm thử Dev (Local Testing):
                  </div>
                  <p style={{ fontSize: 12, color: '#3b82f6', margin: '0 0 10px' }}>
                    Hệ thống đã tạo mã đặt lại mật khẩu cho <strong>{devTokenData.email}</strong>. Bạn có thể chuyển sang bước đổi mật khẩu ngay:
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setToken(devTokenData.devToken || '');
                      setMode('reset');
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    🚀 Điền mật khẩu mới với mã này ngay
                  </button>
                </div>
              )}

              <form onSubmit={handleRequestSubmit} className="auth-form" style={{ gap: 16 }}>
                <div className="auth-field" style={{ gap: 6, textAlign: 'left' }}>
                  <label className="auth-label" htmlFor="req-identifier" style={{ fontSize: 13, fontWeight: 700, color: '#122331' }}>
                    Email đăng ký hoặc Tên đăng nhập (MSSV) *
                  </label>
                  <input
                    id="req-identifier"
                    type="text"
                    className="auth-input"
                    placeholder="ví dụ: student@hyperdata.org hoặc MinhNVSE150000"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    disabled={requestLoading}
                    required
                  />
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    💡 Hệ thống sẽ gửi email chứa đường link xác thực đến hộp thư đã liên kết với tài khoản này.
                  </span>
                </div>

                <button
                  type="submit"
                  className="auth-btn auth-btn--primary"
                  style={{ padding: '13px 20px', fontSize: 15, fontWeight: 700, marginTop: 4 }}
                  disabled={requestLoading}
                >
                  {requestLoading ? (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                      </svg>
                      <span>Đang xử lý yêu cầu...</span>
                    </>
                  ) : (
                    <span>Gửi link đặt lại mật khẩu</span>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* ───────────── MODE 2: Reset with New Password ───────────── */}
          {mode === 'reset' && (
            <div>
              {resetError && (
                <div className="auth-alert-box" role="alert" style={{ marginBottom: 16 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <div>{resetError}</div>
                </div>
              )}

              <form onSubmit={handleResetSubmit} className="auth-form" style={{ gap: 16 }}>
                {/* Token Field */}
                <div className="auth-field" style={{ gap: 6, textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="auth-label" htmlFor="reset-token" style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                      Mã xác thực (Reset Token) *
                    </label>
                    {token && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11.5,
                        color: '#16a34a',
                        fontWeight: 700,
                        background: '#f0fdf4',
                        padding: '2px 8px',
                        borderRadius: 6,
                        border: '1px solid #bbf7d0',
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Đã nhận mã hợp lệ
                      </span>
                    )}
                  </div>
                  
                  {/* Styled Token Input */}
                  <div style={{ position: 'relative' }}>
                    <input
                      id="reset-token"
                      type="text"
                      className="auth-input"
                      placeholder="Dán mã token từ email hoặc link xác thực"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      disabled={resetLoading}
                      required
                      style={{
                        fontFamily: token ? 'monospace' : 'inherit',
                        fontSize: token ? 13 : 14,
                        letterSpacing: token ? '0.02em' : 'normal',
                        background: token ? '#f8fafc' : '#ffffff',
                        borderColor: token ? '#93c5fd' : '#cbd5e1',
                      }}
                    />
                  </div>

                  {!token && (
                    <span style={{ fontSize: 11.5, color: '#e11d48', marginTop: 2 }}>
                      ⚠️ Bạn cần có mã token được gửi qua email để thiết lập mật khẩu mới.
                    </span>
                  )}
                </div>

                {/* New Password Input */}
                <div className="auth-field" style={{ gap: 6, textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="auth-label" htmlFor="new-password" style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                      Mật khẩu mới *
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#0071bc',
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {showNewPassword ? 'Ẩn' : 'Hiện'}
                    </button>
                  </div>
                  <input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="auth-input"
                    placeholder="Nhập mật khẩu mới (tối thiểu 8 ký tự)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={resetLoading}
                    required
                  />

                  {/* Password Strength Meter */}
                  {newPassword && (
                    <div className="password-strength-container" style={{ marginTop: 2 }}>
                      <div className="password-strength-bar" style={{ height: 4 }}>
                        <div className={`password-strength-segment ${strengthScore >= 1 ? (strengthScore === 1 ? 'password-strength-segment--weak' : strengthScore === 2 ? 'password-strength-segment--medium' : 'password-strength-segment--strong') : ''}`} />
                        <div className={`password-strength-segment ${strengthScore >= 2 ? (strengthScore === 2 ? 'password-strength-segment--medium' : 'password-strength-segment--strong') : ''}`} />
                        <div className={`password-strength-segment ${strengthScore >= 3 ? 'password-strength-segment--strong' : ''}`} />
                      </div>
                      <div className="password-strength-text" style={{ fontSize: 11.5, marginTop: 4 }}>
                        <span style={{ color: strengthScore === 1 ? '#ef4444' : strengthScore === 2 ? '#f59e0b' : '#16a34a' }}>
                          {strengthScore === 1 ? 'Độ bảo mật: Yếu' : strengthScore === 2 ? 'Độ bảo mật: Trung bình' : 'Độ bảo mật: Mạnh & An toàn'}
                        </span>
                        <span style={{ color: '#94a3b8' }}>{newPassword.length}/8+ ký tự</span>
                      </div>
                    </div>
                  )}

                  {/* Clean 2-column Requirements Checklist */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    marginTop: 4,
                    padding: '8px 12px',
                    background: '#f8fafc',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: hasMinLength ? '#16a34a' : '#64748b',
                      fontWeight: hasMinLength ? 700 : 500,
                      transition: 'all 0.2s',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                        {hasMinLength ? <polyline points="20 6 9 17 4 12" /> : <circle cx="12" cy="12" r="7" strokeWidth="2" />}
                      </svg>
                      <span>Tối thiểu 8 ký tự</span>
                    </div>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: (hasLetter && hasNumber) ? '#16a34a' : '#64748b',
                      fontWeight: (hasLetter && hasNumber) ? 700 : 500,
                      transition: 'all 0.2s',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                        {(hasLetter && hasNumber) ? <polyline points="20 6 9 17 4 12" /> : <circle cx="12" cy="12" r="7" strokeWidth="2" />}
                      </svg>
                      <span>Gồm cả chữ & số</span>
                    </div>
                  </div>
                </div>

                {/* Confirm Password Input */}
                <div className="auth-field" style={{ gap: 6, textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="auth-label" htmlFor="confirm-password" style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                      Xác nhận mật khẩu mới *
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#0071bc',
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {showConfirmPassword ? 'Ẩn' : 'Hiện'}
                    </button>
                  </div>
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="auth-input"
                    placeholder="Nhập lại mật khẩu mới"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={resetLoading}
                    required
                  />
                  {confirmPassword && (
                    <div style={{
                      fontSize: 12,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 2,
                      color: passwordsMatch ? '#16a34a' : '#ef4444',
                    }}>
                      {passwordsMatch ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                          <span>Mật khẩu xác nhận trùng khớp</span>
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                          <span>Mật khẩu xác nhận chưa trùng khớp</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  className="auth-btn auth-btn--primary"
                  style={{ padding: '13px 20px', fontSize: 15, fontWeight: 700, marginTop: 6 }}
                  disabled={resetLoading || !token.trim() || !hasMinLength || !passwordsMatch}
                >
                  {resetLoading ? (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                      </svg>
                      <span>Đang cập nhật mật khẩu...</span>
                    </>
                  ) : (
                    <span>Xác nhận đổi mật khẩu</span>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* Footer Back to Login */}
          <div className="auth-card__footer" style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid #e8eef2', fontSize: 13, color: '#647381', textAlign: 'center' }}>
            Nhớ lại mật khẩu?{' '}
            <Link href="/login" style={{ color: '#0071bc', fontWeight: 700, textDecoration: 'none' }}>
              Quay lại Đăng nhập
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function ForgotPasswordPage() {

  return (
    <div className="public-landing pl-page auth-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'hidden' }}>
      {/* Ambient Orbs */}
      <div className="auth-ambient-glow auth-ambient-glow--1" />
      <div className="auth-ambient-glow auth-ambient-glow--2" />

      {/* Header đồng bộ với Landing Page và Login */}
      <header className="pl-header" style={{ position: 'relative', zIndex: 10 }}>
        <div className="pl-container pl-header__inner">
          <Link href="/" className="pl-brand" aria-label="Trang chủ HyperData Lab">
            <HyperdataLogo size={34} />
          </Link>

          <nav className="pl-nav" aria-label="Điều hướng">
            <Link href="/#portal" className="pl-nav__link">Cổng Lưu trữ</Link>
            <Link href="/#features" className="pl-nav__link">Tính năng</Link>
            <Link href="/#faq" className="pl-nav__link">Hỏi đáp</Link>
          </nav>

          <div className="pl-header__actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Link href="/login" className="pl-header-action pl-header-action--primary">
              Đăng nhập
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content: 2 Cột chuẩn như Landing Page Hero */}
      <main className="pl-hero" style={{ flex: 1, display: 'flex', padding: '60px 0', position: 'relative', zIndex: 1 }}>
        <div className="pl-container" style={{ display: 'flex', alignItems: 'center' }}>
          <div className="pl-hero__grid" style={{ alignItems: 'flex-start', gap: '48px', width: '100%' }}>
            
            {/* Cột trái: Thông tin bảo mật học thuật & hướng dẫn khôi phục */}
            <div className="pl-hero__content pl-reveal" style={{ textAlign: 'left', paddingTop: '24px' }}>
              <span className="pl-badge-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, background: '#eef6fc', color: '#0071bc', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>
                🔑 Cổng Khôi phục Quyền truy cập
              </span>

              <h1 className="pl-hero__title" style={{ fontSize: '2.5rem', lineHeight: 1.2, marginBottom: 16 }}>
                Khôi phục Mật khẩu <br />
                <span className="pl-hero__highlight">Nhanh chóng & An toàn</span>
              </h1>

              <p className="pl-hero__desc" style={{ fontSize: '1.05rem', color: '#4b5563', lineHeight: 1.6, marginBottom: 28, maxWidth: 520 }}>
                Hệ thống xác thực học thuật HyperData Lab bảo vệ mọi công trình và dữ liệu bản thảo khoa học của bạn. Thực hiện đặt lại mật khẩu để tiếp tục quản lý tài liệu và kết nối phản biện.
              </p>

              {/* Danh sách cam kết bảo mật & quyền lợi */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
                <div className="auth-bullet-item">
                  <div className="auth-bullet-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <span>Hỗ trợ tra cứu bằng cả Mã số sinh viên (MSSV) hoặc Email</span>
                </div>

                <div className="auth-bullet-item">
                  <div className="auth-bullet-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <span>Mã xác thực bảo mật một lần, hiệu lực trong 24 giờ</span>
                </div>

                <div className="auth-bullet-item">
                  <div className="auth-bullet-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <span>Tự động vô hiệu hóa các phiên đăng nhập cũ nhằm bảo vệ dữ liệu</span>
                </div>
              </div>
            </div>

            {/* Cột phải: Form Quên mật khẩu & Đổi mật khẩu */}
            <div className="pl-hero__form-wrap pl-reveal" style={{ '--delay': '120ms' } as React.CSSProperties}>
              <Suspense fallback={
                <div className="auth-card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '40px' }}>
                  <p style={{ color: '#647381' }}>Đang tải biểu mẫu...</p>
                </div>
              }>
                <ForgotPasswordContent />
              </Suspense>
            </div>

          </div>
        </div>
      </main>

      {/* Footer chuẩn đồng bộ với Landing Page */}
      <footer className="pl-footer">
        <div className="pl-container pl-footer__inner">
          <div className="pl-footer__brand">
            <HyperdataLogo size={32} />
            <p className="pl-footer__tagline">
              Hạ tầng học thuật mở hỗ trợ nghiên cứu sớm cho sinh viên, đồng hành cùng giảng viên và minh bạch hóa quy trình công bố khoa học.
            </p>
          </div>

          <div className="pl-footer__links">
            <div className="pl-footer__col">
              <h4>Nền tảng</h4>
              <Link href="/#portal" className="pl-link">Cổng lưu trữ</Link>
              <Link href="/#features" className="pl-link">Tính năng cốt lõi</Link>
            </div>
            <div className="pl-footer__col">
              <h4>Tài nguyên</h4>
              <Link href="/#faq" className="pl-link">Hỏi đáp & Hướng dẫn</Link>
              <Link href="/#register-section" className="pl-link">Đăng ký sinh viên</Link>
            </div>
            <div className="pl-footer__col">
              <h4>Truy cập</h4>
              <Link href="/#register-section" className="pl-link">Tạo tài khoản</Link>
              <Link href="/login" className="pl-link">Đăng nhập</Link>
            </div>
          </div>
        </div>

        <div className="pl-container pl-footer__bottom">
          <p>© {new Date().getFullYear()} HyperData Lab. Tất cả các quyền được bảo lưu.</p>
          <p className="pl-footer__disclaimer">
            Nền tảng công bố học thuật phi lợi nhuận phục vụ sinh viên và nhà nghiên cứu trẻ.
          </p>
        </div>
      </footer>
    </div>
  );
}
