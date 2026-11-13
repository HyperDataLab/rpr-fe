'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { HyperdataLogo } from '@/components/hyperdata-logo';
import { authApi } from '@/features/auth/api/authApi';
import '@/styles/public-landing.css';
import '@/styles/auth-forms.css';

function LoginForm() {
  const searchParams = useSearchParams();
  const requestedNextPath = searchParams.get('next');
  const nextPath = requestedNextPath?.startsWith('/') && !requestedNextPath.startsWith('//') && !requestedNextPath.includes('\\') ? requestedNextPath : null;
  const ssoRequestId = searchParams.get('sso_request') || undefined;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handlePasswordLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const data = await authApi.loginWithUsername(username, password);
    if (!data.success || !data.user) {
      setError(data.error || 'Username or password is incorrect.');
      setLoading(false);
      return;
    }
    if (nextPath) window.location.href = nextPath;
    else if (data.user.role === 'ADMIN') window.location.href = '/admin/dashboard';
    else if (data.user.role === 'LECTURER') window.location.href = '/lecturer/reviews';
    else window.location.href = '/student/my-preprints';
  };

  const handleWorkspaceLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await authApi.loginWithWorkspace(ssoRequestId);
      if (!data.success || !data.user) {
        setError(data.error || 'Google Workspace sign-in failed.');
        setLoading(false);
        return;
      }
      if (data.ssoRedirectUrl) window.location.assign(data.ssoRedirectUrl);
      else if (nextPath) window.location.href = nextPath;
      else if (data.user.role === 'ADMIN') window.location.href = '/admin/dashboard';
      else if (data.user.role === 'LECTURER') window.location.href = '/lecturer/reviews';
      else window.location.href = '/student/my-preprints';
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google Workspace sign-in failed.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-card" style={{ width: '100%', margin: '0 auto' }}>
      <div style={{ marginBottom: 22, textAlign: 'left' }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#122331', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Đăng nhập bằng Google Workspace
        </h2>
        <p style={{ fontSize: 13.5, color: '#647381', margin: 0, lineHeight: 1.5 }}>
          Sử dụng tài khoản @hyperdatalab.org đã được liên kết với hồ sơ của bạn.
        </p>
      </div>

      {error && (
        <div className="auth-alert-box" role="alert" style={{ marginBottom: 18 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>{error}</div>
        </div>
      )}

      {!ssoRequestId && <>
      <form onSubmit={(event) => void handlePasswordLogin(event)} style={{ display: 'grid', gap: 12, marginBottom: 22 }}>
        <label style={{ display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 650 }}>
          Username
          <input name="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} className="auth-input" placeholder="your.username" disabled={loading} />
        </label>
        <label style={{ display: 'grid', gap: 6, color: '#334155', fontSize: 13, fontWeight: 650 }}>
          Password
          <input name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="auth-input" placeholder="Enter your password" disabled={loading} />
        </label>
        <button type="submit" disabled={loading} aria-busy={loading} style={{ width: '100%', padding: '12px 16px', border: 0, borderRadius: 8, background: '#0071bc', color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 18px', color: '#94a3b8', fontSize: 12 }}>
        <span style={{ height: 1, background: '#e2e8f0', flex: 1 }} />OR<span style={{ height: 1, background: '#e2e8f0', flex: 1 }} />
      </div>
      </>}

      <button
        type="button"
        onClick={() => void handleWorkspaceLogin()}
        disabled={loading}
        aria-busy={loading}
        style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: '12px 16px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#0f172a', fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}
      >
        {loading ? (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
            </svg>
            Đang kết nối Google...
          </>
        ) : (
          <>
            <span aria-hidden="true" style={{ color: '#4285f4', fontWeight: 800, fontSize: 18 }}>G</span>
            Tiếp tục với Google Workspace
          </>
        )}
      </button>

      <p style={{ margin: '14px 0 0', color: '#647381', fontSize: 12.5, lineHeight: 1.5, textAlign: 'center' }}>
        Chỉ tài khoản Workspace đang hoạt động và đã được quản trị viên liên kết mới có thể đăng nhập.
      </p>

      <div className="auth-card__footer" style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid #e8eef2', fontSize: 13, color: '#647381', textAlign: 'center' }}>
        Chưa có tài khoản sinh viên?{' '}
        <Link href="/#register-section" style={{ color: '#0071bc', fontWeight: 700, textDecoration: 'none' }}>
          Gửi yêu cầu đăng ký
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="public-landing pl-page auth-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'hidden' }}>
      {/* Hiệu ứng Ambient Orbs nền phát sáng mờ ảo */}
      <div className="auth-ambient-glow auth-ambient-glow--1" />
      <div className="auth-ambient-glow auth-ambient-glow--2" />

      {/* Header chuẩn theo style Landing Page */}
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

          <div className="pl-header__actions">
            <Link href="/#register-section" className="pl-header-action pl-header-action--primary">
              Đăng ký sinh viên
            </Link>
          </div>

          <div className="pl-mobile-nav" id="login-mobile-menu">
            <button
              type="button"
              className="pl-mobile-nav__toggle"
              aria-label={mobileMenuOpen ? 'Đóng menu' : 'Mở menu điều hướng'}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
              )}
            </button>
            <div className={`pl-mobile-nav__panel ${mobileMenuOpen ? 'pl-mobile-nav__panel--open' : ''}`}>
              <Link href="/#register-section" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link pl-mobile-nav__link--cta">
                🎓 Đăng ký sinh viên
              </Link>
              <Link href="/#portal" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Cổng Lưu Trữ</Link>
              <Link href="/#features" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Tính Năng</Link>
              <Link href="/#faq" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Hỏi Đáp</Link>
            </div>
          </div>
        </div>
      </header>


      {/* Body: 2 Cột chuẩn như Landing Page Hero */}
      <main className="pl-hero" style={{ flex: 1, display: 'flex', padding: '60px 0', position: 'relative', zIndex: 1 }}>
        <div className="pl-container" style={{ display: 'flex', alignItems: 'center' }}>
          <div className="pl-hero__grid" style={{ width: '100%' }}>
            
            {/* Cột trái: Giới thiệu & Cổng đăng nhập học thuật */}
            <div className="pl-hero__main pl-reveal" style={{ textAlign: 'left' }}>
              <span className="pl-badge-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, background: '#eef6fc', color: '#0071bc', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>
                🎓 Cổng Xác thực Nghiên cứu Khoa học
              </span>

              <h1 className="pl-hero__title">
                Đăng nhập vào <br />
                <span className="pl-hero__highlight">Không gian Học thuật</span>
              </h1>

              <p className="pl-hero__desc">
                Hệ thống lưu trữ và bình duyệt sớm cho sinh viên. Đăng nhập để nộp bản thảo khoa học, theo dõi phản hồi phản biện và liên kết hướng dẫn cùng giảng viên.
              </p>

              {/* Danh sách cam kết bảo mật & quyền lợi */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
                <div className="auth-bullet-item">
                  <div className="auth-bullet-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <span>Tài khoản tự động gán theo Mã số sinh viên (MSSV)</span>
                </div>

                <div className="auth-bullet-item">
                  <div className="auth-bullet-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <span>Đăng nhập bằng tài khoản Google Workspace được cấp</span>
                </div>

                <div className="auth-bullet-item">
                  <div className="auth-bullet-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <span>Phê duyệt minh bạch từ Ban Quản trị học viện</span>
                </div>
              </div>
            </div>

            {/* Cột phải: Form Đăng nhập bọc Suspense */}
            <div className="pl-hero__form-wrap pl-reveal" style={{ '--delay': '120ms' } as React.CSSProperties}>
              <Suspense fallback={
                <div className="auth-card" style={{ width: '100%', margin: '0 auto', textAlign: 'center', padding: '40px' }}>
                  <p style={{ color: '#647381' }}>Đang tải biểu mẫu đăng nhập...</p>
                </div>
              }>
                <LoginForm />
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
