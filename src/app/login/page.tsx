'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { HyperdataLogo } from '@/components/hyperdata-logo';
import { authApi } from '@/features/auth/api/authApi';
import '@/styles/public-landing.css';
import '@/styles/auth-forms.css';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') || '/student/my-preprints';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [quickLoadingRole, setQuickLoadingRole] = useState<'admin' | 'lecturer' | 'student' | null>(null);

  const handleWorkspaceLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await authApi.loginWithWorkspace();
      if (!data.success || !data.user) {
        setError(data.error || 'Google Workspace sign-in failed.');
        setLoading(false);
        return;
      }
      if (data.user.role === 'ADMIN') window.location.href = '/admin/dashboard';
      else if (data.user.role === 'LECTURER') window.location.href = '/lecturer/reviews';
      else window.location.href = nextPath;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google Workspace sign-in failed.');
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await authApi.login(identifier, password);
      if (!data.success || !data.user) {
        setError(data.error || 'Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin.');
        setLoading(false);
        return;
      }

      if (data.user.role === 'ADMIN') {
        window.location.href = '/admin/dashboard';
      } else if (data.user.role === 'LECTURER') {
        window.location.href = '/lecturer/reviews';
      } else {
        window.location.href = nextPath;
      }
    } catch {
      setError('Không thể kết nối đến máy chủ xác thực.');
      setLoading(false);
    }
  };

  const handleQuickLogin = async (email: string, role: 'admin' | 'lecturer' | 'student') => {
    setIdentifier(email);
    setPassword('Password@123');
    setError(null);
    setQuickLoadingRole(role);
    setLoading(true);

    try {
      const data = await authApi.login(email, 'Password@123');
      if (!data.success || !data.user) {
        setError(data.error || 'Đăng nhập không thành công.');
        setLoading(false);
        setQuickLoadingRole(null);
        return;
      }

      if (data.user.role === 'ADMIN') {
        window.location.href = '/admin/dashboard';
      } else if (data.user.role === 'LECTURER') {
        window.location.href = '/lecturer/reviews';
      } else {
        window.location.href = nextPath;
      }
    } catch {
      setError('Không thể kết nối đến máy chủ xác thực.');
      setLoading(false);
      setQuickLoadingRole(null);
    }
  };

  return (
    <div className="auth-card" style={{ width: '100%', margin: '0 auto' }}>
      <div style={{ marginBottom: 22, textAlign: 'left' }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#122331', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Thông tin đăng nhập
        </h2>
        <p style={{ fontSize: 13.5, color: '#647381', margin: 0, lineHeight: 1.5 }}>
          Nhập Tên đăng nhập học vụ (hoặc Email) cùng mật khẩu để tiếp tục.
        </p>
      </div>

      {/* 3 Nút Đăng nhập nhanh để Test (Dev Quick Test) */}
      <p style={{ margin: '-12px 0 14px', color: '#475569', fontSize: 13, lineHeight: 1.5 }}>
        Approved users sign in with their existing Google Workspace account. Personal email is for contact only.
      </p>
      <button
        type="button"
        onClick={() => void handleWorkspaceLogin()}
        disabled={loading}
        style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: '12px 16px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#0f172a', fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', marginBottom: 14 }}
      >
        <span aria-hidden="true" style={{ color: '#4285f4', fontWeight: 800, fontSize: 18 }}>G</span>
        Continue with Google Workspace
      </button>

      {(process.env.NEXT_PUBLIC_ENABLE_QUICK_LOGIN !== undefined
        ? process.env.NEXT_PUBLIC_ENABLE_QUICK_LOGIN === 'true' 
        : process.env.NODE_ENV !== 'production') && (
        <div style={{
          marginBottom: 20,
          padding: '12px 14px',
          background: '#f8fafc',
          borderRadius: 10,
          border: '1px dashed #cbd5e1',
          textAlign: 'left'
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
            ⚡ Đăng nhập nhanh để test:
          </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <button
            type="button"
            onClick={() => handleQuickLogin('phuonglhk@gmail.com', 'admin')}
            disabled={loading}
            style={{
              padding: '7px 8px',
              fontSize: 12,
              fontWeight: 700,
              color: quickLoadingRole === 'admin' ? '#0071bc' : '#0f172a',
              background: quickLoadingRole === 'admin' ? '#f0f7fc' : '#ffffff',
              border: `1px solid ${quickLoadingRole === 'admin' ? '#0071bc' : '#cbd5e1'}`,
              borderRadius: 6,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => { if (!loading) e.currentTarget.style.borderColor = '#0071bc'; }}
            onMouseOut={(e) => { if (!loading && quickLoadingRole !== 'admin') e.currentTarget.style.borderColor = '#cbd5e1'; }}
          >
            {quickLoadingRole === 'admin' ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
                Đang vào...
              </>
            ) : (
              <>👑 Admin</>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleQuickLogin('phuonglhk@fpt.edu.vn', 'lecturer')}
            disabled={loading}
            style={{
              padding: '7px 8px',
              fontSize: 12,
              fontWeight: 700,
              color: quickLoadingRole === 'lecturer' ? '#0071bc' : '#0f172a',
              background: quickLoadingRole === 'lecturer' ? '#f0f7fc' : '#ffffff',
              border: `1px solid ${quickLoadingRole === 'lecturer' ? '#0071bc' : '#cbd5e1'}`,
              borderRadius: 6,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => { if (!loading) e.currentTarget.style.borderColor = '#0071bc'; }}
            onMouseOut={(e) => { if (!loading && quickLoadingRole !== 'lecturer') e.currentTarget.style.borderColor = '#cbd5e1'; }}
          >
            {quickLoadingRole === 'lecturer' ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
                Đang vào...
              </>
            ) : (
              <>🎓 Lecturer</>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleQuickLogin('duyga544@gmail.com', 'student')}
            disabled={loading}
            style={{
              padding: '7px 8px',
              fontSize: 12,
              fontWeight: 700,
              color: quickLoadingRole === 'student' ? '#0071bc' : '#0f172a',
              background: quickLoadingRole === 'student' ? '#f0f7fc' : '#ffffff',
              border: `1px solid ${quickLoadingRole === 'student' ? '#0071bc' : '#cbd5e1'}`,
              borderRadius: 6,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => { if (!loading) e.currentTarget.style.borderColor = '#0071bc'; }}
            onMouseOut={(e) => { if (!loading && quickLoadingRole !== 'student') e.currentTarget.style.borderColor = '#cbd5e1'; }}
          >
            {quickLoadingRole === 'student' ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
                Đang vào...
              </>
            ) : (
              <>📖 Student</>
            )}
          </button>
        </div>
      </div>
      )}

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 14px', color: '#94a3b8', fontSize: 11 }}>
        <span style={{ height: 1, flex: 1, background: '#e2e8f0' }} />
        <span>LEGACY / DEVELOPMENT ACCOUNTS</span>
        <span style={{ height: 1, flex: 1, background: '#e2e8f0' }} />
      </div>

      <form onSubmit={handleSubmit} className="auth-form" style={{ gap: 16 }}>
        <div className="auth-field" style={{ gap: 6, textAlign: 'left' }}>
          <label className="auth-label" htmlFor="identifier" style={{ fontSize: 13, fontWeight: 700, color: '#122331' }}>
            Tên đăng nhập hoặc Email *
          </label>
          <input
            id="identifier"
            type="text"
            autoComplete="username"
            className="auth-input"
            placeholder="MinhNVSE150000 hoặc student@fpt.edu.vn"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <div className="auth-field" style={{ gap: 6, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="auth-label" htmlFor="password" style={{ fontSize: 13, fontWeight: 700, color: '#122331' }}>
              Mật khẩu *
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Link href="/forgot-password" className="auth-forgot-link">
                Quên mật khẩu?
              </Link>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#0071bc',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  borderRadius: 4,
                  transition: 'color 0.2s, background 0.2s',
                }}
              >
                {showPassword ? 'Ẩn' : 'Hiện'}
              </button>
            </div>
          </div>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="auth-input"
            placeholder="Nhập mật khẩu của bạn"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <button
          type="submit"
          className="auth-btn auth-btn--primary"
          style={{
            padding: '13px 20px',
            fontSize: 15,
            fontWeight: 700,
            marginTop: 6,
          }}
          disabled={loading}
        >
          {loading ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
              </svg>
              <span>Đang xác thực tài khoản...</span>
            </>
          ) : (
            <span>Đăng nhập</span>
          )}
        </button>
      </form>

      <div className="auth-card__footer" style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid #e8eef2', fontSize: 13, color: '#647381', textAlign: 'center' }}>
        Chưa có tài khoản sinh viên?{' '}
        <Link href="/#register-section" style={{ color: '#0071bc', fontWeight: 700, textDecoration: 'none' }}>
          Đăng ký tài khoản ngay
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
                  <span>Mật khẩu bảo mật gửi trực tiếp qua Email sinh viên</span>
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
