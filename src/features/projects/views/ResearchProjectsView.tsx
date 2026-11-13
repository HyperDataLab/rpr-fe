'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { firebaseAuth } from '@/lib/firebase/client';
import { useTranslation } from '@/i18n';
import { AdminShell } from '@/features/admin/components/AdminShell';
import { LecturerShell } from '@/features/lecturer/components/LecturerShell';
import { StudentDashboardLayout } from '@/features/preprint/components/StudentDashboardLayout';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { researchProjectApi, type ResearchProject, type ResearchProjectMember, type ResearchUser } from '../api/researchProjectApi';

const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid #cbd5e1', borderRadius: 10, padding: '12px 14px', font: 'inherit', color: '#172b3a', background: '#fff' };
const primaryStyle: React.CSSProperties = { border: 0, borderRadius: 9, padding: '11px 16px', background: '#0071bc', color: '#fff', fontWeight: 700, cursor: 'pointer' };
const secondaryStyle: React.CSSProperties = { border: '1px solid #d7e0e8', borderRadius: 9, padding: '10px 14px', background: '#fff', color: '#34475a', fontWeight: 600, cursor: 'pointer' };

export function ResearchProjectsView() {
  const { user } = useAuth();
  const { locale } = useTranslation();
  const isVi = locale === 'vi';
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get('project');
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [invitations, setInvitations] = useState<ResearchProject[]>([]);
  const [detail, setDetail] = useState<(ResearchProject & { members: ResearchProjectMember[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [researchArea, setResearchArea] = useState('');
  const [inviteQuery, setInviteQuery] = useState('');
  const [matchedUser, setMatchedUser] = useState<ResearchUser | null>(null);

  const refresh = useCallback(async (preferredId?: string | null) => {
    setLoading(true);
    setError('');
    try {
      const result = await researchProjectApi.list();
      setProjects(result.projects);
      setInvitations(result.invitations);
      const target = preferredId || detail?.id;
      if (target && result.projects.some((item) => item.id === target)) setDetail(await researchProjectApi.detail(target));
      else setDetail(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : (isVi ? 'Không tải được danh sách dự án.' : 'Could not load projects.')); }
    finally { setLoading(false); }
  }, [detail?.id, isVi]);

  useEffect(() => { void refresh(selectedFromUrl); }, [refresh, selectedFromUrl]);

  const openProject = async (project: ResearchProject) => {
    setError('');
    try {
      setDetail(await researchProjectApi.detail(project.id));
      router.replace(`/projects?project=${encodeURIComponent(project.id)}`, { scroll: false });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open project.'); }
  };

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const created = await researchProjectApi.create({ title, description, researchArea });
      setShowCreate(false); setTitle(''); setDescription(''); setResearchArea('');
      await refresh(created.id);
      router.replace(`/projects?project=${encodeURIComponent(created.id)}`, { scroll: false });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create project.'); }
    finally { setBusy(false); }
  };

  const lookupUser = async () => {
    setError(''); setMatchedUser(null); setBusy(true);
    try {
      const result = await researchProjectApi.findUser(inviteQuery.trim());
      setMatchedUser(result.user);
      if (!result.user) setNotice(isVi ? 'Không tìm thấy user đang hoạt động.' : 'No active user found.');
      else setNotice('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not find user.'); }
    finally { setBusy(false); }
  };

  const inviteUser = async () => {
    if (!detail || !matchedUser) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await researchProjectApi.invite(detail.id, matchedUser.username || matchedUser.email);
      setNotice(result.emailSent && result.notificationSent
        ? (isVi ? 'Đã gửi lời mời trong ứng dụng và qua email.' : 'Invitation sent in app and by email.')
        : (isVi ? 'Đã tạo lời mời nhưng một kênh thông báo gửi thất bại.' : 'Invitation created, but a notification channel failed.'));
      setMatchedUser(null); setInviteQuery('');
      await refresh(detail.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send invitation.'); }
    finally { setBusy(false); }
  };

  const respond = async (project: ResearchProject, action: 'accept' | 'decline') => {
    const uid = firebaseAuth().currentUser?.uid;
    if (!uid) return;
    setBusy(true); setError('');
    try { await researchProjectApi.respond(project.id, uid, action); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not respond to invitation.'); }
    finally { setBusy(false); }
  };

  const removeMember = async (member: ResearchProjectMember) => {
    if (!detail || !window.confirm(isVi ? 'Xóa thành viên này khỏi dự án?' : 'Remove this member from the project?')) return;
    setBusy(true); setError('');
    try { await researchProjectApi.removeMember(detail.id, member.userUid); await refresh(detail.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove member.'); }
    finally { setBusy(false); }
  };

  const content = <main style={{ maxWidth: 1240, margin: '0 auto', padding: '28px clamp(16px, 3vw, 36px)', color: '#172b3a' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 22, flexWrap: 'wrap' }}>
      <div><h1 style={{ margin: 0, fontSize: 28 }}>{isVi ? 'Dự án nghiên cứu' : 'Research projects'}</h1><p style={{ margin: '7px 0 0', color: '#64748b' }}>{isVi ? 'Tạo dự án và cộng tác cùng các thành viên.' : 'Create projects and collaborate with members.'}</p></div>
      <button style={primaryStyle} onClick={() => setShowCreate((value) => !value)}>{isVi ? '+ Tạo dự án' : '+ Create project'}</button>
    </header>
    {error && <div role="alert" style={{ marginBottom: 16, padding: 12, borderRadius: 9, background: '#fff1f2', color: '#b42318' }}>{error}</div>}
    {notice && <div role="status" style={{ marginBottom: 16, padding: 12, borderRadius: 9, background: '#eff8ff', color: '#175cd3' }}>{notice}</div>}
    {showCreate && <form onSubmit={createProject} style={{ display: 'grid', gap: 14, padding: 20, border: '1px solid #dbe5ed', borderRadius: 14, background: '#fff', marginBottom: 22 }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{isVi ? 'Thông tin dự án mới' : 'New project details'}</h2>
      <label>{isVi ? 'Tên dự án *' : 'Project title *'}<input required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} style={{ ...inputStyle, marginTop: 6 }} /></label>
      <label>{isVi ? 'Lĩnh vực nghiên cứu' : 'Research area'}<input maxLength={160} value={researchArea} onChange={(event) => setResearchArea(event.target.value)} style={{ ...inputStyle, marginTop: 6 }} /></label>
      <label>{isVi ? 'Mô tả' : 'Description'}<textarea maxLength={5000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} style={{ ...inputStyle, marginTop: 6, resize: 'vertical' }} /></label>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button type="button" style={secondaryStyle} onClick={() => setShowCreate(false)}>{isVi ? 'Hủy' : 'Cancel'}</button><button disabled={busy} style={primaryStyle}>{isVi ? 'Tạo dự án' : 'Create project'}</button></div>
    </form>}

    {invitations.length > 0 && <section style={{ marginBottom: 24 }}><h2 style={{ fontSize: 19 }}>{isVi ? 'Lời mời đang chờ' : 'Pending invitations'} <span style={{ color: '#64748b', fontSize: 14 }}>({invitations.length})</span></h2>
      <div style={{ display: 'grid', gap: 10 }}>{invitations.map((project) => <article key={project.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: '#fff', border: '1px solid #dbe5ed', borderRadius: 12, padding: 16 }}><div><b>{project.title}</b><div style={{ color: '#64748b', marginTop: 4 }}>{isVi ? 'Được mời bởi' : 'Invited by'} {project.owner?.name || project.owner?.email || '—'}</div></div><div style={{ display: 'flex', gap: 8 }}><button disabled={busy} style={secondaryStyle} onClick={() => void respond(project, 'decline')}>{isVi ? 'Từ chối' : 'Decline'}</button><button disabled={busy} style={primaryStyle} onClick={() => void respond(project, 'accept')}>{isVi ? 'Chấp nhận' : 'Accept'}</button></div></article>)}</div>
    </section>}

    <div style={{ display: 'grid', gridTemplateColumns: detail ? 'minmax(260px, 0.8fr) minmax(0, 1.5fr)' : '1fr', gap: 20, alignItems: 'start' }}>
      <section><h2 style={{ fontSize: 19 }}>{isVi ? 'Dự án của tôi' : 'My projects'}</h2>
        {loading ? <p style={{ color: '#64748b' }}>{isVi ? 'Đang tải…' : 'Loading…'}</p> : projects.length === 0 ? <div style={{ padding: 28, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 14, background: '#fff', color: '#64748b' }}>{isVi ? 'Bạn chưa tham gia dự án nào.' : 'You are not part of any projects yet.'}</div> : <div style={{ display: 'grid', gap: 10 }}>{projects.map((project) => <button key={project.id} onClick={() => void openProject(project)} style={{ textAlign: 'left', padding: 16, borderRadius: 12, border: detail?.id === project.id ? '1px solid #0071bc' : '1px solid #dbe5ed', background: '#fff', cursor: 'pointer', color: '#172b3a' }}><b>{project.title}</b><div style={{ marginTop: 5, color: '#64748b', fontSize: 13 }}>{project.researchArea || (isVi ? 'Chưa có lĩnh vực' : 'No research area')} · {project.membershipRole === 'OWNER' ? (isVi ? 'Owner' : 'Owner') : (isVi ? 'Thành viên' : 'Member')}</div></button>)}</div>}
      </section>
      {detail && <section style={{ background: '#fff', border: '1px solid #dbe5ed', borderRadius: 14, padding: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{detail.title}</h2><p style={{ margin: '0 0 8px', color: '#0071bc', fontWeight: 600 }}>{detail.researchArea || (isVi ? 'Chưa chỉ định lĩnh vực' : 'Research area not specified')}</p><p style={{ whiteSpace: 'pre-wrap', color: '#526579' }}>{detail.description || (isVi ? 'Chưa có mô tả.' : 'No description.')}</p>
        {detail.membershipRole === 'OWNER' && <div style={{ borderTop: '1px solid #e5edf3', paddingTop: 18, marginTop: 18 }}><h3 style={{ marginTop: 0 }}>{isVi ? 'Mời thành viên' : 'Invite a member'}</h3><div style={{ display: 'flex', gap: 8 }}><input value={inviteQuery} onChange={(event) => { setInviteQuery(event.target.value); setMatchedUser(null); }} placeholder={isVi ? 'Username hoặc email' : 'Username or email'} style={inputStyle} /><button disabled={busy || inviteQuery.trim().length < 3} onClick={() => void lookupUser()} style={secondaryStyle}>{isVi ? 'Tìm' : 'Find'}</button></div>
          {matchedUser && <div style={{ marginTop: 10, padding: 12, background: '#f8fafc', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><span><b>{matchedUser.name}</b><br /><small style={{ color: '#64748b' }}>{matchedUser.username || matchedUser.email} · {matchedUser.role}</small></span><button disabled={busy} style={primaryStyle} onClick={() => void inviteUser()}>{isVi ? 'Gửi lời mời' : 'Send invitation'}</button></div>}
        </div>}
        <div style={{ borderTop: '1px solid #e5edf3', paddingTop: 16, marginTop: 18 }}><h3 style={{ marginTop: 0 }}>{isVi ? 'Thành viên' : 'Members'} ({detail.members.filter((member) => member.status === 'ACTIVE').length})</h3><div style={{ display: 'grid', gap: 10 }}>{detail.members.map((member) => <div key={member.userUid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}><span><b>{member.user?.name || member.user?.username || member.userUid}</b><br /><small style={{ color: '#64748b' }}>{member.user?.email || ''} · {member.role === 'OWNER' ? 'Owner' : member.status === 'INVITED' ? (isVi ? 'Đang chờ' : 'Invited') : (isVi ? 'Thành viên' : 'Member')}{member.status === 'INVITED' && member.invitationEmailStatus === 'FAILED' ? ` · ${isVi ? 'Email lỗi' : 'Email failed'}` : ''}</small></span>{detail.membershipRole === 'OWNER' && member.role !== 'OWNER' && member.status === 'ACTIVE' && <button style={secondaryStyle} disabled={busy} onClick={() => void removeMember(member)}>{isVi ? 'Xóa' : 'Remove'}</button>}</div>)}</div></div>
      </section>}
    </div>
  </main>;

  if (user?.role === 'ADMIN') return <AdminShell active="projects" title={isVi ? 'Dự án nghiên cứu' : 'Research projects'}>{content}</AdminShell>;
  if (user?.role === 'LECTURER') return <LecturerShell active="projects" title={isVi ? 'Dự án nghiên cứu' : 'Research projects'}>{content}</LecturerShell>;
  return <StudentDashboardLayout title={isVi ? 'Dự án nghiên cứu' : 'Research projects'}>{content}</StudentDashboardLayout>;
}
