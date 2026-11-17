'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AdminPageHeader, AdminShell } from '../components';
import { adminApi, type AdminUser, type ResearcherProfile } from '../api';
import { useTranslation } from '@/i18n';

type ProfileForm = Omit<ResearcherProfile, 'updatedAt' | 'researchAreas' | 'keywords' | 'education' | 'employment' | 'selectedPublications' | 'projectsAndFunding' | 'awardsAndService'> & {
  researchAreas: string; keywords: string; education: string; employment: string;
  selectedPublications: string; projectsAndFunding: string; awardsAndService: string;
};
type ProfileSection = 'identity' | 'career' | 'output' | 'identifiers';
type ProfileFormKey = Extract<keyof ProfileForm, string>;

const emptyForm: ProfileForm = {
  academicTitle: '', department: '', affiliation: '', biography: '', researchAreas: '', keywords: '',
  orcid: '', scopusAuthorId: '', googleScholarUrl: '', openAlexId: '', website: '', education: '',
  employment: '', selectedPublications: '', projectsAndFunding: '', awardsAndService: '',
};

function splitLines(value: string) { return value.split(/\n|;/).map((entry) => entry.trim()).filter(Boolean); }
function initials(name?: string | null, email?: string) {
  const parts = (name || email?.split('@')[0] || 'U').trim().split(/[\s._-]+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : (parts[0] || 'U').slice(0, 2).toUpperCase();
}
function toForm(profile: ResearcherProfile | null): ProfileForm {
  if (!profile) return { ...emptyForm };
  return {
    academicTitle: profile.academicTitle, department: profile.department, affiliation: profile.affiliation,
    biography: profile.biography, researchAreas: profile.researchAreas.join('\n'), keywords: profile.keywords.join(', '),
    orcid: profile.orcid, scopusAuthorId: profile.scopusAuthorId, googleScholarUrl: profile.googleScholarUrl,
    openAlexId: profile.openAlexId, website: profile.website, education: profile.education.join('\n'),
    employment: profile.employment.join('\n'), selectedPublications: profile.selectedPublications.join('\n'),
    projectsAndFunding: profile.projectsAndFunding.join('\n'), awardsAndService: profile.awardsAndService.join('\n'),
  };
}

export function AdminResearcherProfilesView() {
  const { locale } = useTranslation();
  const vi = locale === 'vi';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'ALL' | AdminUser['role']>('ALL');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [section, setSection] = useState<ProfileSection>('identity');
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [profileLoading, setProfileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    adminApi.listUsers({ page: 1, limit: 1000 }).then((result) => {
      if (live) setUsers(result.users);
    }).catch((reason: unknown) => {
      if (live) setError(reason instanceof Error ? reason.message : (vi ? 'Không tải được danh sách tài khoản.' : 'Unable to load accounts.'));
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [vi]);

  const visibleUsers = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return users.filter((user) => (role === 'ALL' || user.role === role)
      && (!needle || [user.name, user.email, user.username, user.studentId].some((value) => value?.toLocaleLowerCase().includes(needle))))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }, [users, search, role]);
  const existingCount = users.filter((user) => user.hasResearchProfile).length;

  const selectUser = async (user: AdminUser) => {
    setSelected(user); setSection('identity'); setNotice(''); setError(''); setProfileLoading(true); setForm({ ...emptyForm });
    try { setForm(toForm(await adminApi.getResearcherProfile(user.id))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : (vi ? 'Không tải được hồ sơ.' : 'Unable to load profile.')); }
    finally { setProfileLoading(false); }
  };

  const updateField = (key: keyof ProfileForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setNotice(''); setError('');
    const profile: Omit<ResearcherProfile, 'updatedAt'> = {
      academicTitle: form.academicTitle.trim(), department: form.department.trim(), affiliation: form.affiliation.trim(),
      biography: form.biography.trim(), researchAreas: splitLines(form.researchAreas), keywords: form.keywords.split(/[,;\n]/).map((entry) => entry.trim()).filter(Boolean),
      orcid: form.orcid.trim(), scopusAuthorId: form.scopusAuthorId.trim(), googleScholarUrl: form.googleScholarUrl.trim(),
      openAlexId: form.openAlexId.trim(), website: form.website.trim(), education: splitLines(form.education),
      employment: splitLines(form.employment), selectedPublications: splitLines(form.selectedPublications),
      projectsAndFunding: splitLines(form.projectsAndFunding), awardsAndService: splitLines(form.awardsAndService),
    };
    try {
      await adminApi.saveResearcherProfile(selected.id, profile);
      setUsers((current) => current.map((user) => user.id === selected.id ? { ...user, hasResearchProfile: true } : user));
      setSelected((current) => current ? { ...current, hasResearchProfile: true } : current);
      setNotice(vi ? 'Đã lưu hồ sơ nghiên cứu.' : 'Research profile saved.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : (vi ? 'Không thể lưu hồ sơ.' : 'Unable to save profile.')); }
    finally { setSaving(false); }
  };

  const field = (key: ProfileFormKey, label: string, placeholder = '', multiline = false, wide = multiline) => (
    <label className={`research-profile-field ${wide ? 'research-profile-field--wide' : ''}`} key={key}>
      <span>{label}</span>
      {multiline
        ? <textarea value={form[key]} onChange={(event) => updateField(key, event.target.value)} placeholder={placeholder} rows={key === 'biography' ? 4 : 3} />
        : <input value={form[key]} onChange={(event) => updateField(key, event.target.value)} placeholder={placeholder} />}
    </label>
  );

  return (
    <AdminShell active="researcherProfiles" title={vi ? 'Hồ sơ nghiên cứu' : 'Research profiles'}>
      <div className="admin-research-profiles">
        <AdminPageHeader
          eyebrow={vi ? 'HỆ THỐNG' : 'SYSTEM'}
          title={vi ? 'Hồ sơ nhà nghiên cứu' : 'Researcher profiles'}
          description={vi ? 'Quản lý thông tin học thuật riêng cho từng tài khoản.' : 'Manage an academic profile for each account.'}
          actions={<div className="research-profile-quick-stats"><span><strong>{users.length}</strong> {vi ? 'tài khoản' : 'accounts'}</span><span><strong>{existingCount}</strong> {vi ? 'hồ sơ đã tạo' : 'profiles started'}</span></div>}
        />
        <div className="research-profile-workspace">
          <section className="research-profile-directory" aria-label={vi ? 'Danh sách tài khoản' : 'Account directory'}>
            <div className="research-profile-directory__head">
              <div><h2>{vi ? 'Tài khoản' : 'Accounts'}</h2><span>{visibleUsers.length} {vi ? 'kết quả' : 'results'}</span></div>
              <input aria-label={vi ? 'Tìm tài khoản' : 'Search accounts'} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={vi ? 'Tìm tên, email, mã số…' : 'Search name, email, ID…'} />
              <div className="research-profile-role-filter">
                {(['ALL', 'STUDENT', 'LECTURER', 'ADMIN'] as const).map((item) => <button type="button" key={item} className={role === item ? 'is-active' : ''} onClick={() => setRole(item)}>{item === 'ALL' ? (vi ? 'Tất cả' : 'All') : item === 'STUDENT' ? (vi ? 'Sinh viên' : 'Students') : item === 'LECTURER' ? (vi ? 'Giảng viên' : 'Lecturers') : (vi ? 'Quản trị' : 'Admins')}</button>)}
              </div>
            </div>
            <div className="research-profile-user-list">
              {loading ? <div className="research-profile-empty">{vi ? 'Đang tải tài khoản…' : 'Loading accounts…'}</div>
                : visibleUsers.length === 0 ? <div className="research-profile-empty">{vi ? 'Không tìm thấy tài khoản.' : 'No matching accounts.'}</div>
                  : visibleUsers.map((user) => <button type="button" className={`research-profile-user ${selected?.id === user.id ? 'is-selected' : ''}`} key={user.id} onClick={() => void selectUser(user)}>
                    <span className="research-profile-user__avatar">{initials(user.name, user.email)}</span>
                    <span className="research-profile-user__identity"><strong>{user.name || user.email}</strong><small>{user.email}</small></span>
                    <span className={`research-profile-user__status ${user.hasResearchProfile ? 'is-done' : ''}`}>{user.hasResearchProfile ? (vi ? 'Đã tạo' : 'Started') : (vi ? 'Chưa có' : 'Empty')}</span>
                  </button>)}
            </div>
          </section>

          <section className="research-profile-editor" aria-label={vi ? 'Trình chỉnh sửa hồ sơ nghiên cứu' : 'Research profile editor'}>
            {!selected ? <div className="research-profile-placeholder"><span className="research-profile-placeholder__icon">✳</span><h2>{vi ? 'Chọn một tài khoản' : 'Choose an account'}</h2><p>{vi ? 'Hồ sơ nghiên cứu được lưu riêng, gắn với tài khoản đã chọn.' : 'Each research profile is stored separately with its account.'}</p></div>
              : <>
                <div className="research-profile-editor__heading">
                  <span className="research-profile-user__avatar">{initials(selected.name, selected.email)}</span>
                  <div><span className="research-profile-kicker">{vi ? 'HỒ SƠ CỦA' : 'PROFILE FOR'}</span><h2>{selected.name || selected.email}</h2><p>{selected.email} · {selected.role}</p></div>
                  <button type="button" className="research-profile-close" onClick={() => setSelected(null)} aria-label={vi ? 'Đóng hồ sơ' : 'Close profile'}>×</button>
                </div>
                <div className="research-profile-tabs" role="tablist" aria-label={vi ? 'Nhóm thông tin hồ sơ' : 'Profile sections'}>
                  {([
                    ['identity', vi ? 'Học thuật' : 'Academic'],
                    ['career', vi ? 'Đào tạo & công tác' : 'Career'],
                    ['output', vi ? 'Công trình' : 'Research output'],
                    ['identifiers', vi ? 'Định danh' : 'Identifiers'],
                  ] as const).map(([key, label]) => <button type="button" role="tab" aria-selected={section === key} className={section === key ? 'is-active' : ''} key={key} onClick={() => { setSection(key); setNotice(''); setError(''); }}>{label}</button>)}
                </div>
                {profileLoading ? <div className="research-profile-empty">{vi ? 'Đang tải hồ sơ…' : 'Loading profile…'}</div> : <form onSubmit={(event) => void handleSave(event)}>
                  {section === 'identity' && <div className="research-profile-section"><h3>{vi ? 'Danh tính học thuật' : 'Academic identity'}</h3><div className="research-profile-form-grid">
                    {field('academicTitle', vi ? 'Học hàm / học vị' : 'Academic title', vi ? 'Ví dụ: TS., PGS.TS.' : 'e.g. PhD, Associate Professor')}
                    {field('department', vi ? 'Khoa / bộ môn' : 'Department')}
                    {field('affiliation', vi ? 'Cơ quan công tác' : 'Institution / affiliation')}
                    {field('website', vi ? 'Trang cá nhân' : 'Personal website', 'https://')}
                    {field('biography', vi ? 'Giới thiệu nghiên cứu' : 'Research biography', vi ? 'Tóm tắt chuyên môn, hướng nghiên cứu và kinh nghiệm…' : 'Summarize expertise, research focus and experience…', true)}
                    {field('researchAreas', vi ? 'Lĩnh vực nghiên cứu' : 'Research areas', vi ? 'Mỗi dòng một lĩnh vực' : 'One research area per line', true, false)}
                    {field('keywords', vi ? 'Từ khóa chuyên môn' : 'Research keywords', vi ? 'Phân tách bằng dấu phẩy' : 'Separate with commas')}
                  </div></div>}
                  {section === 'career' && <div className="research-profile-section"><h3>{vi ? 'Đào tạo và quá trình công tác' : 'Education and appointments'}</h3><div className="research-profile-form-grid">
                    {field('education', vi ? 'Đào tạo / bằng cấp' : 'Education / qualifications', vi ? 'Mỗi dòng: Bằng cấp · Trường · Năm' : 'One per line: Degree · Institution · Year', true, false)}
                    {field('employment', vi ? 'Quá trình công tác' : 'Employment history', vi ? 'Mỗi dòng: Chức vụ · Đơn vị · Thời gian' : 'One per line: Role · Institution · Dates', true, false)}
                  </div></div>}
                  {section === 'output' && <div className="research-profile-section"><h3>{vi ? 'Công trình và hoạt động khoa học' : 'Research output and activity'}</h3><div className="research-profile-form-grid">
                    {field('selectedPublications', vi ? 'Công trình tiêu biểu' : 'Selected publications', vi ? 'Mỗi dòng một công trình; nên ghi DOI hoặc năm' : 'One publication per line; include DOI or year', true, false)}
                    {field('projectsAndFunding', vi ? 'Dự án và tài trợ' : 'Projects and funding', vi ? 'Mỗi dòng một dự án / nguồn tài trợ' : 'One project or funding source per line', true, false)}
                    {field('awardsAndService', vi ? 'Giải thưởng và hoạt động học thuật' : 'Awards and academic service', vi ? 'Giải thưởng, hội đồng, phản biện, hội nghề nghiệp…' : 'Awards, editorial work, reviewing, memberships…', true)}
                  </div></div>}
                  {section === 'identifiers' && <div className="research-profile-section"><h3>{vi ? 'Mã định danh học thuật' : 'Scholarly identifiers'}</h3><div className="research-profile-form-grid">
                    {field('orcid', 'ORCID iD', '0000-0000-0000-0000')}
                    {field('scopusAuthorId', 'Scopus Author ID')}
                    {field('openAlexId', 'OpenAlex ID')}
                    {field('googleScholarUrl', 'Google Scholar', 'https://scholar.google.com/…')}
                  </div></div>}
                  {error && <p className="research-profile-alert research-profile-alert--error" role="alert">{error}</p>}
                  {notice && <p className="research-profile-alert research-profile-alert--success" role="status">{notice}</p>}
                  <div className="research-profile-savebar"><span>{vi ? 'Hồ sơ được lưu trên tài khoản này.' : 'This profile is saved to this account.'}</span><button type="submit" disabled={saving}>{saving ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu hồ sơ' : 'Save profile')}</button></div>
                </form>}
              </>}
          </section>
        </div>
      </div>
    </AdminShell>
  );
}
