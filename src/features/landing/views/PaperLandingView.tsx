import { PaperBrandLockup } from '../components/PaperBrandLockup';
import { PaperPortalShowcase } from '../components/PaperPortalShowcase';
import { PaperDisciplineSpotlight } from '../components/PaperDisciplineSpotlight';
import { PaperWorkflowSection } from '../components/PaperWorkflowSection';
import { ScrollRevealObserver } from '../components/ScrollRevealObserver';

const features = [
  {
    number: '01',
    title: 'Prepare & Cryptographic Timestamp',
    body: 'Register early manuscripts with immutable cryptographic hashes and timestamped records, securing your scientific priority without journal publication delays.',
    color: 'blue',
    icon: (
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <circle cx="12" cy="12" r="3" />
        <polyline points="12 10 12 12 14 13" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'Targeted Faculty Mentorship',
    body: 'Invite trusted faculty lecturers and research advisors into private review discussions before formal dissemination. Receive line-by-line methodological guidance.',
    color: 'sand',
    icon: (
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Institutional Editorial Governance',
    body: 'Maintain a transparent distinction between preprints, revision milestones, and peer-reviewed articles, backed by institutional administrative oversight.',
    color: 'navy',
    icon: (
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <line x1="12" y1="6" x2="16" y2="6" />
        <line x1="12" y1="10" x2="16" y2="10" />
      </svg>
    ),
  },
] as const;

const faqs = [
  {
    question: 'What is a preprint and does it prevent formal journal publication?',
    answer:
      'A preprint is an author-owned preliminary manuscript shared publicly before formal peer review. Major academic publishers (including IEEE, Elsevier, Springer Nature, and ACM) explicitly allow preprint sharing prior to journal submission. It establishes your scientific priority without forfeiting publication rights.',
  },
  {
    question: 'Who can submit a manuscript to HyperData Lab?',
    answer:
      'Undergraduate and graduate students, academic research assistants, and university faculty collaborators can submit work through the HyperData Lab workspace using an approved account and institutional email.',
  },
  {
    question: 'Can I update my manuscript after receiving reviewer feedback?',
    answer:
      'Yes. Academic research is iterative. When lecturers provide critique or revisions are needed, you can submit updated versions (e.g. v2.0). All previous versions remain chronologically preserved in your public audit timeline to maintain academic integrity.',
  },
  {
    question: 'How does faculty review and moderation work?',
    answer:
      'Submissions are assigned to qualified faculty lecturers who review manuscript methodology, clarity, and relevance. Lecturers provide revision notes or recommend readiness, while final repository indexing is moderated by administrators.',
  },
  {
    question: 'Is my research timestamped with an immutable record?',
    answer:
      'Yes. Each submitted manuscript receives a cryptographic SHA-256 hash and persistent timestamp in the repository, providing undeniable verification of when your findings were established.',
  },
  {
    question: 'Is there any fee to submit, read, or download preprints?',
    answer:
      'No. The HyperData Lab Publication Repository is 100% open-access and free for students, educators, and independent researchers. There are no Article Processing Charges (APCs) or access paywalls.',
  },
] as const;

const signInUrl = '/login?next=/student';
const submitUrl = '/login?next=/student/my-preprints/new';
const reviewerUrl = '/login?next=/lecturer/reviews';

export function PaperLandingView() {
  return (
    <div className="paper-landing">
      <ScrollRevealObserver />
      {/* Top Announcement Bar */}
      <div className="paper-announcement">
        <span className="paper-announcement-tag">NEW</span>
        <span>HyperData Lab Publication Repository • Open Academic Infrastructure for Student Scholars</span>
        <a href="#how-it-works">Learn how it works →</a>
      </div>

      {/* Sticky Header with Glassmorphism */}
      <header className="paper-site-header">
        <div className="paper-container paper-header-inner">
          <PaperBrandLockup />

          <nav className="paper-main-nav" aria-label="Main navigation">
            <a href="#portal">Portal</a>
            <a href="#disciplines">Disciplines</a>
            <a href="#workflow">Workflow</a>
            <a href="#features">Features</a>
            <a href="#advisory">Advisory</a>
            <a href="#faq">FAQ</a>
          </nav>

          <div className="paper-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <a className="paper-sign-in" href={signInUrl}>
              Sign in
            </a>
            <a className="paper-button paper-button-small" href={submitUrl}>
              <span>Start submission</span>
              <span className="paper-btn-arrow">→</span>
            </a>
          </div>

          <details className="paper-mobile-menu">
            <summary aria-label="Open navigation menu">
              <span />
              <span />
              <span />
            </summary>
            <div className="paper-mobile-menu-panel">
              <a href="#portal">Portal</a>
              <a href="#disciplines">Disciplines</a>
              <a href="#workflow">Workflow</a>
              <a href="#features">Features</a>
              <a href="#advisory">Advisory</a>
              <a href="#faq">FAQ</a>
              <hr />
              <a href={signInUrl}>Sign in</a>
              <a className="paper-button" href={submitUrl}>
                Create account
              </a>
            </div>
          </details>
        </div>
      </header>

      <main>
        {/* Centered Hero Section */}
        <section className="paper-hero paper-container" id="how-it-works">
          <div className="paper-hero-copy paper-reveal">
            <div className="paper-hero-badge">
              <span className="paper-hero-badge-dot" />
              <span>HyperData Lab Academic Gateway • 2026 Edition</span>
            </div>

            <h1>
              Discover research that moves your <span>ideas forward.</span>
            </h1>

            <p className="paper-hero-description">
              A dedicated publication workspace for student researchers, mentors, and academic collaborators to share, review,
              and timestamp findings with institutional integrity before formal journal publication.
            </p>

            <div className="paper-hero-actions">
              <a className="paper-button" href={submitUrl}>
                <span>Start a submission</span>
                <span className="paper-btn-arrow">→</span>
              </a>
              <a className="paper-button paper-button-quiet" href="#portal">
                <span>Explore the portal</span>
                <span className="paper-btn-arrow">↓</span>
              </a>
              <a className="paper-hero-text-link" href="#disciplines">
                Browse trending preprints →
              </a>
            </div>

            <div className="paper-hero-trust-bar">
              <span>✓ Zero Publication Fees</span>
              <span className="paper-trust-sep">•</span>
              <span>✓ IEEE &amp; Springer Compliant</span>
              <span className="paper-trust-sep">•</span>
              <span>✓ Author Retains Full Rights</span>
            </div>
          </div>
        </section>

        {/* High-Trust Institutional Metrics Strip */}
        <section className="paper-metrics-section">
          <div className="paper-container paper-metrics-grid">
            <div className="paper-metric-item paper-reveal">
              <span className="paper-metric-num">1,450+</span>
              <span className="paper-metric-label">Manuscripts Timestamped</span>
              <small>Preserved with SHA-256 cryptographic proofs</small>
            </div>
            <div className="paper-metric-item paper-reveal">
              <span className="paper-metric-num">320+</span>
              <span className="paper-metric-label">Verified Faculty Mentors</span>
              <small>University educators providing structured critique</small>
            </div>
            <div className="paper-metric-item paper-reveal">
              <span className="paper-metric-num">&lt; 48h</span>
              <span className="paper-metric-label">Median First Review</span>
              <small>Fast academic guidance to accelerate findings</small>
            </div>
            <div className="paper-metric-item paper-reveal">
              <span className="paper-metric-num">100%</span>
              <span className="paper-metric-label">Open Access Index</span>
              <small>No reader paywalls, citable permanent DOIs</small>
            </div>
          </div>
        </section>

        {/* Portal Showcase Section */}
        <section className="paper-portal-section paper-container" id="portal">
          <div className="paper-section-heading paper-reveal">
            <div>
              <p className="paper-eyebrow">Your Research, In Context</p>
              <h2>Everything You Need to Move an Idea Forward</h2>
            </div>
            <p>
              One unified workspace for manuscript versions, faculty review notes, and the academic collaborators helping your research become its best self.
            </p>
          </div>

          <PaperPortalShowcase />
        </section>

        {/* Discipline Explorer & Trending Preprints */}
        <PaperDisciplineSpotlight />

        {/* 4-Step Progressive Workflow */}
        <PaperWorkflowSection />

        {/* Bento Features Section */}
        <section className="paper-features-section paper-container" id="features">
          <div className="paper-section-heading paper-reveal">
            <div>
              <p className="paper-eyebrow">Designed Around The Work</p>
              <h2>Less Friction. More Signal.</h2>
            </div>
            <p>
              Academic research involves multiple drafts, mentors, and revisions. HyperData Lab gives every contribution a clear, citable place to land.
            </p>
          </div>

          <div className="paper-feature-grid">
            {features.map((item) => (
              <article className={'paper-feature-card ' + item.color} key={item.number}>
                <div className="paper-feature-top-row">
                  <span className="paper-feature-number">{item.number}</span>
                  <div className="paper-feature-icon-bubble">{item.icon}</div>
                </div>

                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <a href="#faq" className="paper-feature-link">
                  <span>Learn in FAQ</span>
                  <span>→</span>
                </a>
              </article>
            ))}
          </div>
        </section>

        {/* Faculty Advisory & Community Section */}
        <section className="paper-advisory-section paper-container" id="advisory">
          <div className="paper-advisory-card paper-reveal">
            <div className="paper-advisory-mark" aria-hidden="true">
              &ldquo;
            </div>
            <div className="paper-advisory-copy">
              <p className="paper-eyebrow">Built With The Research Community</p>
              <blockquote>
                Good research needs room to breathe, and the right people around it. HyperData Lab gives early ideas the care, rigorous faculty review, and momentum they deserve before journal submission.
              </blockquote>
              <div className="paper-advisory-author">
                <span className="paper-avatar paper-avatar-large">LT</span>
                <span>
                  <strong>Dr. Linh Tran</strong>
                  <small>Faculty Advisory Board • HyperData Lab &amp; VNU Data Systems</small>
                </span>
              </div>
            </div>
            <div className="paper-advisory-tags">
              <span>Open By Default</span>
              <span>Human Faculty Review</span>
              <span>Traceable Audit History</span>
              <span>Permanent Identifiers</span>
            </div>
          </div>

          {/* Participating Institutions Cloud */}
          <div className="paper-partners-strip paper-reveal">
            <span className="paper-partners-label">PARTNERING WITH RESEARCHERS &amp; EDUCATORS ACROSS</span>
            <div className="paper-partners-list">
              <span>Vietnam National University</span>
              <span>Ho Chi Minh City University of Technology (HCMUT)</span>
              <span>Hanoi University of Science &amp; Technology (HUST)</span>
              <span>University of Information Technology (UIT)</span>
              <span>Can Tho University</span>
            </div>
          </div>
        </section>

        {/* Interactive FAQ Section */}
        <section className="paper-faq-section paper-container" id="faq">
          <div className="paper-section-heading paper-reveal">
            <div>
              <p className="paper-eyebrow">Questions, Answered</p>
              <h2>Start With The Essentials</h2>
            </div>
            <p>
              New to student preprints or ready to submit? Here are the essential details on academic rights, peer review, and publisher guidelines.
            </p>
          </div>

          <div className="paper-faq-list">
            {faqs.map((faq, idx) => (
              <details className="paper-faq-item" key={faq.question} open={idx === 0}>
                <summary>
                  <span>{faq.question}</span>
                  <span className="paper-faq-icon">+</span>
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Pre-Footer Call to Action */}
        <section className="paper-cta-section paper-container">
          <div className="paper-cta-box paper-reveal">
            <div className="paper-cta-glow" aria-hidden="true" />
            <p className="paper-eyebrow">Ready to Share Your Research?</p>
            <h2>Give Your Findings an Official, Timestamped Record Today</h2>
            <p className="paper-cta-subtitle">
              Join over 1,400 student researchers and university faculty collaborating openly on HyperData Lab.
            </p>
            <div className="paper-cta-actions">
              <a className="paper-button paper-button-large" href={submitUrl}>
                <span>Submit Your Manuscript</span>
                <span className="paper-btn-arrow">→</span>
              </a>
              <a className="paper-button paper-button-quiet paper-button-large" href={reviewerUrl}>
                <span>Faculty Reviewer Access</span>
                <span className="paper-btn-arrow">→</span>
              </a>
            </div>
            <small className="paper-cta-footnote">
              Sign in with your approved account • Institutional email registration available
            </small>
          </div>
        </section>
      </main>

      {/* Modern Public Footer */}
      <footer className="paper-site-footer">
        <div className="paper-container paper-footer-grid">
          <div className="paper-footer-brand">
            <PaperBrandLockup />
            <p>
              HyperData Lab Publication Repository is an open academic gateway empowering student researchers with early timestamping, structured faculty mentorship, and scholarly transparency.
            </p>
            <div className="paper-footer-social">
              <span className="paper-open-badge">Open Access Initiative</span>
              <span className="paper-open-badge">DOI-Indexed</span>
            </div>
          </div>

          <div>
            <p className="paper-footer-label">Explore Repository</p>
            <a href="#portal">Workspace Portal</a>
            <a href="#disciplines">Trending Preprints</a>
            <a href="#workflow">4-Step Workflow</a>
            <a href="#features">Core Capabilities</a>
            <a href="#advisory">Faculty Advisory</a>
          </div>

          <div>
            <p className="paper-footer-label">Resources &amp; Access</p>
            <a href={signInUrl}>Student Sign In</a>
            <a href={submitUrl}>Submit Research</a>
            <a href={reviewerUrl}>Faculty Reviewer Portal</a>
            <a href="#faq">Preprint Guidelines &amp; FAQ</a>
            <a href="https://github.com/ResearchPulse/ResearchPulse-Publication-Repository-FE" target="_blank" rel="noreferrer">
              GitHub Repository
            </a>
          </div>
        </div>

        <div className="paper-container paper-footer-bottom">
          <span>© 2026 HyperData Lab Publication Repository • HyperData Lab Infrastructure.</span>
          <span>Open Academic Research • Preserved with SHA-256 Cryptographic Timestamping.</span>
        </div>
      </footer>
    </div>
  );
}
