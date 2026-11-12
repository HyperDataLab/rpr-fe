'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HyperdataLogo } from './hyperdata-logo';
import { PublicPortalShowcase } from './public-portal-showcase';
import { ScrollRevealObserver } from './scroll-reveal';
import { useTranslation } from '@/i18n';
import { smoothScrollTo } from '@/app/providers/SmoothScrollProvider';
import { authApi } from '@/features/auth/api/authApi';

// Helper for Vietnamese diacritic removal for live username preview
const VIETNAMESE_MAP: Record<string, string> = {
  à: 'a', á: 'a', ả: 'a', ã: 'a', ạ: 'a',
  ă: 'a', ắ: 'a', ằ: 'a', ẳ: 'a', ẵ: 'a', ặ: 'a',
  â: 'a', ấ: 'a', ầ: 'a', ẩ: 'a', ẫ: 'a', ậ: 'a',
  è: 'e', é: 'e', ẻ: 'e', ẽ: 'e', ẹ: 'e',
  ê: 'e', ế: 'e', ề: 'e', ể: 'e', ễ: 'e', ệ: 'e',
  ì: 'i', í: 'i', ỉ: 'i', ĩ: 'i', ị: 'i',
  ò: 'o', ó: 'o', ỏ: 'o', õ: 'o', ọ: 'o',
  ô: 'o', ố: 'o', ồ: 'o', ổ: 'o', ỗ: 'o', ộ: 'o',
  ơ: 'o', ớ: 'o', ờ: 'o', ở: 'o', ỡ: 'o', ợ: 'o',
  ù: 'u', ú: 'u', ủ: 'u', ũ: 'u', ụ: 'u',
  ư: 'u', ứ: 'u', ừ: 'u', ử: 'u', ữ: 'u', ự: 'u',
  ỳ: 'y', ý: 'y', ỷ: 'y', ỹ: 'y', ỵ: 'y',
  đ: 'd',
};

function removeTones(str: string): string {
  return str.split('').map((c) => VIETNAMESE_MAP[c.toLowerCase()] ?? c).join('');
}

function scrollToRegister(e?: React.MouseEvent) {
  if (e) e.preventDefault();
  const el = document.getElementById('register-section');
  if (!el) return;

  smoothScrollTo(el, {
    offset: -96,
    duration: 1.1,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    onComplete: () => {
      const input = el.querySelector('input');
      if (input) input.focus({ preventScroll: true });
    },
  });
}

export default function PublicPreprintLanding() {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [major, setMajor] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{ email: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);

  useEffect(() => {
    // Only kept for any non-Lenis side effects if needed, 
    // but anchor clicking and smooth scrolling is now handled globally in SmoothScrollProvider.
  }, []);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lastName.trim() || !firstName.trim() || !studentId.trim() || !email.trim() || !major.trim()) {
      setError('Vui lòng điền đầy đủ các thông tin bắt buộc.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await authApi.register({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          studentId: studentId.trim().toUpperCase(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          major: major.trim(),
      }).then((data) => new Response(JSON.stringify(data), { status: 201 }));

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Đăng ký không thành công. Vui lòng kiểm tra lại.');
        setLoading(false);
        return;
      }

      setSuccessData({
        email: data.user.email,
        name: data.user.name,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to submit the registration request.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="public-landing">
      <ScrollRevealObserver />
      <a className="pl-skip-link" href="#main-content">Chuyển đến nội dung chính</a>

      {/* Modern Sticky Glassmorphism Header */}
      <header className="pl-header">
        <div className="pl-container pl-header__inner">
          <Link href="/" className="pl-brand" aria-label="Trang chủ HyperData Lab">
            <HyperdataLogo size={34} />
          </Link>

          <nav className="pl-nav" aria-label="Thanh điều hướng chính">
            <a href="#register-section" onClick={scrollToRegister} className="pl-nav__link">Đăng Ký</a>
            <a href="#portal" className="pl-nav__link">Cổng Lưu Trữ</a>
            <a href="#features" className="pl-nav__link">Tính Năng</a>
            <a href="#workflow" className="pl-nav__link">Quy Trình</a>
            <a href="#faq" className="pl-nav__link">Hỏi Đáp</a>
            <div
              className="pl-tools-menu"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setToolsMenuOpen(false);
                  event.currentTarget.querySelector('button')?.focus();
                }
              }}
            >
              <button
                type="button"
                className="pl-nav__link pl-tools-menu__toggle"
                aria-haspopup="true"
                aria-expanded={toolsMenuOpen}
                aria-controls="pl-tools-menu-panel"
                onClick={() => setToolsMenuOpen((open) => !open)}
              >
                Công Cụ
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {toolsMenuOpen && (
                <div className="pl-tools-menu__panel" id="pl-tools-menu-panel" aria-label="Công cụ HyperDataLab">
                  <div className="pl-tools-menu__content">
                    <div className="pl-tools-menu__intro">
                      <h2>Công cụ nghiên cứu</h2>
                      <p>Khám phá các nền tảng hỗ trợ quy trình nghiên cứu và xuất bản học thuật.</p>
                    </div>
                    <div className="pl-tools-menu__grid">
                      <a href="https://slr.hyperdatalab.org" target="_blank" rel="noopener noreferrer" className="pl-tools-menu__item">
                        <span className="pl-tools-menu__icon" aria-hidden="true">⌕</span>
                        <span className="pl-tools-menu__item-copy"><strong>Systematic Literature Review</strong><span>Quản lý và sàng lọc nghiên cứu tổng quan có hệ thống.</span></span>
                        <span className="pl-tools-menu__external" aria-hidden="true">↗</span>
                      </a>
                      <a href="https://hyperdatalab-writing-bank.web.app" target="_blank" rel="noopener noreferrer" className="pl-tools-menu__item">
                        <span className="pl-tools-menu__icon" aria-hidden="true">✎</span>
                        <span className="pl-tools-menu__item-copy"><strong>Writing Bank</strong><span>Tham khảo tài nguyên và hướng dẫn viết học thuật.</span></span>
                        <span className="pl-tools-menu__external" aria-hidden="true">↗</span>
                      </a>
                      <a href="https://aprkb.hyperdatalab.org" target="_blank" rel="noopener noreferrer" className="pl-tools-menu__item">
                        <span className="pl-tools-menu__icon" aria-hidden="true">▤</span>
                        <span className="pl-tools-menu__item-copy"><strong>Academic Publication Repository</strong><span>Tra cứu kho công bố và tài liệu nghiên cứu học thuật.</span></span>
                        <span className="pl-tools-menu__external" aria-hidden="true">↗</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </nav>

          <div className="pl-header__actions">
            <Link href="/login" className="pl-header-action pl-header-action--secondary">
              Đăng Nhập
            </Link>
            <a href="#register-section" onClick={scrollToRegister} className="pl-header-action pl-header-action--primary">
              Đăng Ký Ngay
            </a>
          </div>

          <div className="pl-mobile-nav" id="pl-mobile-menu">
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
              <a href="#register-section" onClick={(e) => { setMobileMenuOpen(false); scrollToRegister(e); }} className="pl-mobile-nav__link pl-mobile-nav__link--cta">
                🎓 Đăng Ký Sinh Viên
              </a>
              <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link" style={{ color: '#0071bc', fontWeight: 800 }}>Đăng Nhập</Link>
              <a href="#portal" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Cổng Lưu Trữ</a>
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Tính Năng</a>
              <a href="#workflow" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Quy Trình</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Hỏi Đáp</a>
              <div className="pl-mobile-nav__tools">
                <span className="pl-mobile-nav__tools-title">Công Cụ HyperDataLab</span>
                <a href="https://slr.hyperdatalab.org" target="_blank" rel="noopener noreferrer" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Systematic Literature Review</a>
                <a href="https://hyperdatalab-writing-bank.web.app" target="_blank" rel="noopener noreferrer" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Writing Bank</a>
                <a href="https://aprkb.hyperdatalab.org" target="_blank" rel="noopener noreferrer" onClick={() => setMobileMenuOpen(false)} className="pl-mobile-nav__link">Academic Publication Repository</a>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section with Embedded Registration Form */}
      <section id="main-content" className="pl-section pl-hero">
        <div className="pl-container">
          <div className="pl-hero__grid">
            {/* Left Column: Value Proposition */}
            <div className="pl-hero__main pl-reveal">
              <span className="pl-badge-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, background: '#eef6fc', color: '#0071bc', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>
                🎓 Cổng Nghiên Cứu Khoa Học Sinh Viên
              </span>
              <h1 className="pl-hero__title">
                Khám Phá &amp; Công Bố Công Trình Nghiên Cứu{' '}
                <span className="pl-hero__highlight">Vững Chắc Tương Lai.</span>
              </h1>

              <p className="pl-hero__desc">
                HyperData Lab kết nối sinh viên học thuật với hội đồng giảng viên. Lưu trữ bản thảo sớm, nhận phản hồi bình duyệt bài viết và xây dựng hồ sơ học thuật xác thực.
              </p>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 24, fontSize: 14, color: '#647381' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  <span>Tự Động Sinh Tên Đăng Nhập Theo MSSV</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  <span>Mật Khẩu Bảo Mật Gửi Qua Email</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  <span>Phê Duyệt Minh Bạch Từ Ban Quản Trị</span>
                </div>
              </div>

              <div style={{ marginTop: 28 }}>
                <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: '#0071bc', textDecoration: 'none' }}>
                  <span>Đã Có Tài Khoản Sinh Viên? Đăng Nhập Ngay</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                </Link>
              </div>
            </div>

            {/* Right Column: Embedded Registration Card */}
            <div id="register-section" className="pl-hero__form-wrap pl-reveal" style={{ '--delay': '100ms' } as React.CSSProperties}>
              <div className="auth-card" style={{ maxWidth: '100%', margin: '0 auto', boxShadow: '0 16px 48px rgba(0, 113, 188, 0.12), 0 2px 8px rgba(18, 35, 49, 0.04)' }}>
                {successData ? (
                  <div className="auth-success-view">
                    <div className="auth-success-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>

                    <h2 className="auth-title" style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>
                      Gửi Yêu Cầu Thành Công!
                    </h2>
                    <p className="auth-subtitle" style={{ fontSize: 13, color: '#647381', marginBottom: 18, lineHeight: 1.5 }}>
                      Cảm ơn <strong>{successData.name}</strong>. Yêu cầu của bạn đã được ghi nhận.
                    </p>

                    <div className="auth-notice-box" style={{ width: '100%', textAlign: 'left', marginBottom: 20, fontSize: 12.5, boxSizing: 'border-box', lineHeight: 1.5 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <div>
                        Yêu cầu cấp tài khoản của bạn sẽ được Ban Quản trị xem xét. Chúng tôi sẽ liên hệ qua <strong>{successData.email}</strong> để hướng dẫn các bước tiếp theo.
                      </div>
                    </div>

                    {/* Clean, perfectly proportioned actions */}
                    <div className="auth-success-actions">
                      <p className="auth-subtitle" style={{ fontSize: 13, color: '#647381', margin: '0 0 14px', lineHeight: 1.5 }}>
                        {'Ch\u01b0a t\u1ea1o t\u00e0i kho\u1ea3n \u0111\u0103ng nh\u1eadp. B\u1ea1n ch\u1ec9 c\u00f3 th\u1ec3 \u0111\u0103ng nh\u1eadp sau khi Ban Qu\u1ea3n tr\u1ecb duy\u1ec7t h\u1ed3 s\u01a1 v\u00e0 li\u00ean k\u1ebft email Workspace.'}
                      </p>

                      <button
                        type="button"
                        onClick={() => {
                          setSuccessData(null);
                          setLastName('');
                          setFirstName('');
                          setStudentId('');
                          setEmail('');
                          setPhone('');
                          setMajor('');
                        }}
                        className="auth-btn-success-secondary"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <line x1="19" y1="8" x2="19" y2="14" />
                          <line x1="22" y1="11" x2="16" y2="11" />
                        </svg>
                        <span>Gửi Thêm Yêu Cầu Khác</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: 18 }}>
                      <h2 className="auth-title" style={{ fontSize: 20 }}>Đăng Ký Tài Khoản Sinh Viên</h2>
                      <p className="auth-subtitle" style={{ fontSize: 13, margin: 0 }}>
                        Điền thông tin để gửi yêu cầu cấp tài khoản nghiên cứu đến Ban Quản trị.
                      </p>
                    </div>

                    {error && (
                      <div className="auth-alert-box" role="alert" style={{ marginBottom: 14, fontSize: 12, padding: '10px 12px' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <div>{error}</div>
                      </div>
                    )}

                    <form onSubmit={handleRegisterSubmit} className="auth-form" style={{ gap: 12 }}>
                      <div className="auth-row" style={{ gap: 10 }}>
                        <div className="auth-field" style={{ gap: 4 }}>
                          <label className="auth-label" htmlFor="hero-lastName" style={{ fontSize: 12 }}>
                            Họ &amp; Tên Đệm *
                          </label>
                          <input
                            id="hero-lastName"
                            type="text"
                            className="auth-input"
                            style={{ padding: '9px 12px', fontSize: 13 }}
                            placeholder="Nguyễn Văn"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            disabled={loading}
                            required
                          />
                        </div>

                        <div className="auth-field" style={{ gap: 4 }}>
                          <label className="auth-label" htmlFor="hero-firstName" style={{ fontSize: 12 }}>
                            Tên *
                          </label>
                          <input
                            id="hero-firstName"
                            type="text"
                            className="auth-input"
                            style={{ padding: '9px 12px', fontSize: 13 }}
                            placeholder="Minh"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            disabled={loading}
                            required
                          />
                        </div>
                      </div>

                      <div className="auth-row" style={{ gap: 10 }}>
                        <div className="auth-field" style={{ gap: 4 }}>
                          <label className="auth-label" htmlFor="hero-studentId" style={{ fontSize: 12 }}>
                            Mã Số Sinh Viên (MSSV) *
                          </label>
                          <input
                            id="hero-studentId"
                            type="text"
                            className="auth-input"
                            style={{ padding: '9px 12px', fontSize: 13 }}
                            placeholder="SE150000"
                            value={studentId}
                            onChange={(e) => setStudentId(e.target.value)}
                            disabled={loading}
                            required
                          />
                        </div>

                        <div className="auth-field" style={{ gap: 4 }}>
                          <label className="auth-label" htmlFor="hero-major" style={{ fontSize: 12 }}>
                            Chuyên Ngành *
                          </label>
                          <input
                            id="hero-major"
                            type="text"
                            className="auth-input"
                            style={{ padding: '9px 12px', fontSize: 13 }}
                            placeholder="Kỹ thuật phần mềm"
                            value={major}
                            onChange={(e) => setMajor(e.target.value)}
                            disabled={loading}
                            required
                          />
                        </div>
                      </div>

                      <div className="auth-row" style={{ gap: 10 }}>
                        <div className="auth-field" style={{ gap: 4 }}>
                          <label className="auth-label" htmlFor="hero-email" style={{ fontSize: 12 }}>
                            Địa Chỉ Email *
                          </label>
                          <input
                            id="hero-email"
                            type="email"
                            className="auth-input"
                            style={{ padding: '9px 12px', fontSize: 13 }}
                            placeholder="student@fpt.edu.vn"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={loading}
                            required
                          />
                        </div>

                        <div className="auth-field" style={{ gap: 4 }}>
                          <label className="auth-label" htmlFor="hero-phone" style={{ fontSize: 12 }}>
                            Số Điện Thoại
                          </label>
                          <input
                            id="hero-phone"
                            type="tel"
                            className="auth-input"
                            style={{ padding: '9px 12px', fontSize: 13 }}
                            placeholder="0912345678"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            disabled={loading}
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="auth-btn auth-btn--primary"
                        style={{ padding: '11px 16px', fontSize: 14, marginTop: 4 }}
                        disabled={loading}
                      >
                        {loading ? 'Đang Gửi Yêu Cầu...' : 'Gửi Yêu Cầu Đăng Ký'}
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Layered Showcase Mockup */}
          <div id="portal" className="pl-hero__showcase-wrap pl-reveal" style={{ '--delay': '120ms', marginTop: 64 } as React.CSSProperties}>
            <PublicPortalShowcase />
          </div>


          {/* 3 Bento Feature Cards */}
          <div id="features" className="pl-bento-grid">
            <div className="pl-bento-card pl-reveal" style={{ '--delay': '0ms' } as React.CSSProperties}>
              <div className="pl-bento-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <h3 className="pl-bento-title">Tải Lên &amp; Đóng Dấu Bản Thảo</h3>
              <p className="pl-bento-desc">
                Đăng ký bản thảo sớm với mã SHA-256 xác thực, khẳng định quyền ưu tiên học thuật mà không làm mất bản quyền công bố tạp chí.
              </p>
              <a href="#register-section" onClick={scrollToRegister} className="pl-bento-link">
                <span>Tạo Tài Khoản Nộp Bài</span>
                <svg className="pl-bento-link__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12h16M14 6l6 6-6 6" />
                </svg>
              </a>
            </div>

            <div className="pl-bento-card pl-reveal" style={{ '--delay': '120ms' } as React.CSSProperties}>
              <div className="pl-bento-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 className="pl-bento-title">Đồng Hành Cùng Giảng Viên</h3>
              <p className="pl-bento-desc">
                Nhận phản hồi nhận xét phương pháp luận và hướng dẫn từng mục từ giảng viên trường để nâng cao chất lượng nghiên cứu.
              </p>
              <a href="#faq" className="pl-bento-link">
                <span>Xem Quy Trình Bình Duyệt</span>
                <svg className="pl-bento-link__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12h16M14 6l6 6-6 6" />
                </svg>
              </a>
            </div>

            <div className="pl-bento-card pl-reveal" style={{ '--delay': '240ms' } as React.CSSProperties}>
              <div className="pl-bento-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3 className="pl-bento-title">Kiểm Duyệt &amp; Quản Trị</h3>
              <p className="pl-bento-desc">
                Phân định rõ ràng giữa bản thảo Preprint và công trình đã xuất bản chính thức, được bảo chứng bởi hội đồng quản trị học viện.
              </p>
              <a href="#faq" className="pl-bento-link">
                <span>Tìm Hiểu Trong Hỏi &amp; Đáp</span>
                <svg className="pl-bento-link__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12h16M14 6l6 6-6 6" />
                </svg>
              </a>
            </div>
          </div>

          {/* Academic Trust & Community Banner */}
          <div id="advisory" className="pl-trust-banner pl-reveal">
            <div className="pl-trust-quote">
              <div className="pl-trust-avatar" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5.5h16v13H4z" />
                  <path d="M8 9h8M8 13h5M8 16h3" />
                </svg>
              </div>
              <div>
                <p className="pl-trust-text">
                  &ldquo;Từ một ý tưởng ban đầu đến một công trình hoàn chỉnh, HyperData Lab đồng hành cùng sinh viên và giảng viên trong từng bước của quá trình nghiên cứu.&rdquo;
                </p>
                <span className="pl-trust-author">HỌC TẬP • NGHIÊN CỨU • CÔNG BỐ</span>
              </div>
            </div>
            <div className="pl-trust-labels">
              <span className="pl-trust-label-head">CHUYÊN NGÀNH TIÊU BIỂU</span>
              <div className="pl-trust-tags">
                <span>Khoa Học Máy Tính</span>
                <span>Khoa Học Dữ Liệu</span>
                <span>Công Nghệ Thông Tin</span>
                <span>Kỹ Thuật Phần Mềm</span>
              </div>
            </div>
          </div>

          {/* Streamlined Publication Workflow Roadmap */}
          <div id="workflow" className="pl-workflow-section-wrap pl-reveal" style={{ '--delay': '80ms' } as React.CSSProperties}>
            <div className="pl-workflow-head">
              <span className="pl-workflow-pill">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                {t('workflow.roadmapPill', 'Lộ Trình Xuất Bản Khép Kín')}
              </span>
              <h2 className="pl-workflow-title">{t('workflow.roadmapTitle', 'Quy Trình Đăng Bài Trong Hệ Thống')}</h2>
              <p className="pl-workflow-desc">
                Hành trình 6 bước liền mạch và minh bạch, kết nối tác giả với hội đồng giảng viên từ khâu để lại thông tin đến khi công trình chính thức công bố mở.
              </p>
            </div>

            <div className="pl-workflow-timeline-wrapper">
              {/* Transition Divider: Giai đoạn 1 */}
              <div className="pl-workflow-divider" style={{ marginBottom: '16px' }}>
                <div className="pl-workflow-divider-line"></div>
                <div className="pl-workflow-divider-pill">
                  <span className="pl-workflow-divider-dot"></span>
                  <span>{t('workflow.phase1', 'Giai Đoạn 1: Khởi Tạo & Kích Hoạt Tài Khoản Tác Giả')}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                </div>
                <div className="pl-workflow-divider-line"></div>
              </div>

              {/* Row 1: Giai đoạn 1 - Khởi tạo & Kích hoạt */}
              <div className="pl-workflow-row pl-workflow-row--1">
                {/* Step 01 */}
                <div className="pl-workflow-card pl-workflow-card--1">
                  <div className="pl-workflow-card-header">
                    <div className="pl-workflow-step-badge">
                      <span className="pl-workflow-step-num">01</span>
                      <span className="pl-workflow-step-name">KHỞI TẠO</span>
                    </div>
                    <div className="pl-workflow-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="pl-workflow-card-title">{t('workflow.step1Title', 'Để Lại Thông Tin')}</h3>
                  <p className="pl-workflow-card-desc">
                    {t('workflow.step1Desc', 'Sinh viên đăng ký trực tuyến với Họ tên, Mã số sinh viên (MSSV), Chuyên ngành và Email học tập để bắt đầu thiết lập hồ sơ tác giả.')}
                  </p>
                  <a href="#register-section" onClick={scrollToRegister} className="pl-workflow-card-action" style={{ textDecoration: 'none' }}>
                    <span>{t('workflow.step1Action', 'Khởi Tạo Hồ Sơ Trực Tuyến')}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </a>
                </div>

                {/* Connector 01 -> 02 */}
                <div className="pl-workflow-connector-inline" aria-hidden="true">
                  <div className="pl-workflow-connector-line"></div>
                  <div className="pl-workflow-connector-arrow">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>

                {/* Step 02 */}
                <div className="pl-workflow-card pl-workflow-card--2">
                  <div className="pl-workflow-card-header">
                    <div className="pl-workflow-step-badge">
                      <span className="pl-workflow-step-num">02</span>
                      <span className="pl-workflow-step-name">KẾT NỐI</span>
                    </div>
                    <div className="pl-workflow-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="pl-workflow-card-title">{t('workflow.step2Title', 'HyperData Lab Liên Hệ')}</h3>
                  <p className="pl-workflow-card-desc">
                    {t('workflow.step2Desc', 'HyperData Lab hoặc Ban cố vấn khoa học kết nối trực tiếp với sinh viên nhằm xác minh thông tin và định hướng phạm vi đề tài nghiên cứu.')}
                  </p>
                  <div className="pl-workflow-card-action">
                    <span>{t('workflow.step2Action', 'Tư Vấn & Thẩm Định Sơ Bộ')}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>

                {/* Connector 02 -> 03 */}
                <div className="pl-workflow-connector-inline" aria-hidden="true">
                  <div className="pl-workflow-connector-line"></div>
                  <div className="pl-workflow-connector-arrow">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>

                {/* Step 03 */}
                <div className="pl-workflow-card pl-workflow-card--3">
                  <div className="pl-workflow-card-header">
                    <div className="pl-workflow-step-badge">
                      <span className="pl-workflow-step-num">03</span>
                      <span className="pl-workflow-step-name">KÍCH HOẠT</span>
                    </div>
                    <div className="pl-workflow-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="pl-workflow-card-title">{t('workflow.step3Title', 'Cung Cấp Tài Khoản')}</h3>
                  <p className="pl-workflow-card-desc">
                    {t('workflow.step3Desc', 'Quản trị viên (Admin) phê duyệt cấp tài khoản. Tên đăng nhập được tự động đồng bộ theo chuẩn MSSV và mật khẩu tạm thời được gửi về email trường.')}
                  </p>
                  <div className="pl-workflow-card-action">
                    <span>{t('workflow.step3Action', 'Kích Hoạt Quyền Tác Giả')}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>
              </div>

              {/* Transition Divider: Giai đoạn 2 */}
              <div className="pl-workflow-divider">
                <div className="pl-workflow-divider-line"></div>
                <div className="pl-workflow-divider-pill">
                  <span className="pl-workflow-divider-dot"></span>
                  <span>{t('workflow.phase2', 'Giai Đoạn 2: Nộp Bản Thảo & Bình Duyệt Học Thuật')}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                </div>
                <div className="pl-workflow-divider-line"></div>
              </div>

              {/* Row 2: Giai đoạn 2 - Nộp bài, Review & Publish */}
              <div className="pl-workflow-row pl-workflow-row--2">
                {/* Step 04 */}
                <div className="pl-workflow-card pl-workflow-card--4">
                  <div className="pl-workflow-card-header">
                    <div className="pl-workflow-step-badge">
                      <span className="pl-workflow-step-num">04</span>
                      <span className="pl-workflow-step-name">TẢI LÊN</span>
                    </div>
                    <div className="pl-workflow-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="pl-workflow-card-title">{t('workflow.step4Title', 'Gửi Bài Nghiên Cứu')}</h3>
                  <p className="pl-workflow-card-desc">
                    {t('workflow.step4Desc', 'Tác giả tải lên file bản thảo PDF. Nền tảng tự động bóc tách siêu dữ liệu học thuật qua GROBID và đóng dấu SHA-256 xác lập bản quyền sớm.')}
                  </p>
                  <div className="pl-workflow-card-action">
                    <span>{t('workflow.step4Action', 'Bóc Tách PDF & Đóng Dấu Hash')}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>

                {/* Connector 04 -> 05 */}
                <div className="pl-workflow-connector-inline" aria-hidden="true">
                  <div className="pl-workflow-connector-line"></div>
                  <div className="pl-workflow-connector-arrow">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>

                {/* Step 05 */}
                <div className="pl-workflow-card pl-workflow-card--5">
                  <div className="pl-workflow-card-header">
                    <div className="pl-workflow-step-badge">
                      <span className="pl-workflow-step-num">05</span>
                      <span className="pl-workflow-step-name">PHẢN BIỆN</span>
                    </div>
                    <div className="pl-workflow-icon-box">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="pl-workflow-card-title">{t('workflow.step5Title', 'Hội Đồng Chuyên Môn Review')}</h3>
                  <p className="pl-workflow-card-desc">
                    {t('workflow.step5Desc', 'Hội đồng chuyên môn trực tiếp thẩm định phương pháp luận, cho điểm phản biện và hỗ trợ sinh viên sửa đổi, nâng cấp phiên bản (v2.0, v3.0).')}
                  </p>
                  <div className="pl-workflow-card-action">
                    <span>{t('workflow.step5Action', 'Bình Duyệt & Hướng Dẫn Sửa Đổi')}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>

                {/* Connector 05 -> 06 */}
                <div className="pl-workflow-connector-inline" aria-hidden="true">
                  <div className="pl-workflow-connector-line pl-workflow-connector-line--success"></div>
                  <div className="pl-workflow-connector-arrow pl-workflow-connector-arrow--success">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                </div>

                {/* Step 06 - Highlighted Destination */}
                <div className="pl-workflow-card pl-workflow-card--6 pl-workflow-card--final">
                  <div className="pl-workflow-card-header">
                    <div className="pl-workflow-step-badge pl-workflow-step-badge--final">
                      <span className="pl-workflow-step-num">06</span>
                      <span className="pl-workflow-step-name">XUẤT BẢN</span>
                    </div>
                    <div className="pl-workflow-icon-box pl-workflow-icon-box--final">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="pl-workflow-card-title">{t('workflow.step6Title', 'Công Bố (Publish)')}</h3>
                  <p className="pl-workflow-card-desc">
                    {t('workflow.step6Desc', 'Bản thảo chính thức được cấp quyền truy cập mở, xuất hiện trên kho lưu trữ HyperData Lab và sẵn sàng cho việc trích dẫn học thuật vĩnh viễn.')}
                  </p>
                  <div className="pl-workflow-card-action pl-workflow-card-action--final">
                    <span>{t('workflow.step6Action', 'Lưu Trữ Mở & Trích Dẫn Toàn Cầu')}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Call to Action Banner inside Roadmap */}
            <div className="pl-workflow-banner pl-reveal" style={{ '--delay': '160ms' } as React.CSSProperties}>
              <div className="pl-workflow-banner-content">
                <h4>Bắt Đầu Công Trình Nghiên Cứu Đầu Tiên Của Bạn</h4>
                <p>Chỉ mất 2 phút để hoàn tất đăng ký thông tin ban đầu và nhận hướng dẫn trực tiếp từ giảng viên.</p>
              </div>
              <a href="#register-section" onClick={scrollToRegister} className="pl-workflow-banner-btn">
                <span>Đăng Ký Tham Gia Ngay</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Pre-Footer FAQ Section */}
      <section id="faq" className="pl-section pl-section--alt pl-faq-prefooter pl-reveal">
        <div className="pl-container pl-container--narrow">
          <div className="pl-section-head">
            <h2 className="pl-section-title">Câu Hỏi Thường Gặp</h2>
            <p className="pl-section-subtitle">
              Mọi điều bạn cần biết về bản thảo nghiên cứu sinh viên, quy trình phản biện và quyền tác giả.
            </p>
          </div>

          <div className="pl-faq-list">
            <details className="pl-faq-item" open>
              <summary className="pl-faq-question">
                <span>Bản thảo Preprint là gì và có ảnh hưởng đến việc xuất bản tạp chí không?</span>
                <span className="pl-faq-icon" aria-hidden="true">+</span>
              </summary>
              <div className="pl-faq-answer">
                Preprint là bản thảo sơ bộ do tác giả sở hữu, được chia sẻ trước khi bình duyệt chính thức. Hầu hết các nhà xuất bản uy tín (IEEE, Elsevier, Springer, ACM...) đều cho phép công bố preprint trước khi gửi bài chính thức.
              </div>
            </details>

            <details className="pl-faq-item">
              <summary className="pl-faq-question">
                <span>Ai có thể đăng ký tài khoản và gửi bản thảo?</span>
                <span className="pl-faq-icon" aria-hidden="true">+</span>
              </summary>
              <div className="pl-faq-answer">
                Sinh viên, học viên cao học và giảng viên đều có thể đăng ký trực tiếp bằng Mã số sinh viên (MSSV) và Email học tập. Tài khoản sẽ được kích hoạt sau khi Quản trị viên (Admin) phê duyệt.
              </div>
            </details>

            <details className="pl-faq-item">
              <summary className="pl-faq-question">
                <span>Tôi có thể cập nhật bản thảo sau khi đã tải lên không?</span>
                <span className="pl-faq-icon" aria-hidden="true">+</span>
              </summary>
              <div className="pl-faq-answer">
                Có. Khi nhận được góp ý từ giảng viên hoặc hoàn thiện thêm kết quả, bạn có thể tải lên các phiên bản sửa đổi (v2.0, v3.0...). Mọi phiên bản đều được lưu vết minh bạch theo thời gian.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* Public Footer */}
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
              <h4>Nền Tảng</h4>
              <a href="#portal" className="pl-link">Cổng Lưu Trữ</a>
              <a href="#features" className="pl-link">Tính Năng Cốt Lõi</a>
              <a href="#workflow" className="pl-link">Quy Trình Xuất Bản</a>
              <a href="#advisory" className="pl-link">Hội Đồng Cố Vấn</a>
            </div>
            <div className="pl-footer__col">
              <h4>Tài Nguyên</h4>
              <a href="#faq" className="pl-link">Hỏi Đáp &amp; Hướng Dẫn</a>
              <Link href="/login" className="pl-link">Cổng Đăng Nhập</Link>
              <a href="#register-section" onClick={scrollToRegister} className="pl-link">Đăng Ký Sinh Viên</a>
            </div>
            <div className="pl-footer__col">
              <h4>Truy Cập</h4>
              <a href="#register-section" onClick={scrollToRegister} className="pl-link">Tạo Tài Khoản</a>
              <Link href="/login" className="pl-link">Đăng Nhập</Link>
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
