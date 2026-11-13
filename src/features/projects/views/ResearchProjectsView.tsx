'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { firebaseAuth } from '@/lib/firebase/client';
import { useTranslation } from '@/i18n';
import { AdminShell } from '@/features/admin/components/AdminShell';
import { LecturerShell } from '@/features/lecturer/components/LecturerShell';
import { StudentDashboardLayout } from '@/features/preprint/components/StudentDashboardLayout';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { researchProjectApi, type ResearchProject, type ResearchProjectMember, type ResearchUser } from '../api/researchProjectApi';
import styles from './ResearchProjectsView.module.css';

type ViewMode = 'projects' | 'invitations';

function ProjectMark({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.75 6.75 12 3l7.25 3.75v10.5L12 21l-7.25-3.75V6.75Z" /><path d="m4.75 6.75 7.25 4 7.25-4M12 10.75V21" /></svg>;
}

function SearchMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

function MemberMark() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M17 8h4m-2-2v4" /></svg>;
}

export function ResearchProjectsView() {
  const { user, loading: authLoading } = useAuth();
  const { locale } = useTranslation();
  const isVi = locale === 'vi';
  const isAdmin = user?.role === 'ADMIN';
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get('project');
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [invitations, setInvitations] = useState<ResearchProject[]>([]);
  const [detail, setDetail] = useState<(ResearchProject & { members: ResearchProjectMember[] }) | null>(null);
  const [mode, setMode] = useState<ViewMode>('projects');
  const [search, setSearch] = useState('');
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

  const text = useMemo(() => isVi ? {
    title: 'Dự án nghiên cứu', subtitle: 'Không gian cộng tác cho các nhóm nghiên cứu khoa học.', create: 'Tạo dự án',
    projects: 'Dự án của tôi', invitations: 'Lời mời', search: 'Tìm theo tên hoặc lĩnh vực', active: 'Đang tham gia', owner: 'Chủ dự án', member: 'Thành viên',
    createTitle: 'Tạo dự án nghiên cứu', createHelp: 'Bắt đầu bằng thông tin cơ bản. Bạn có thể mời thành viên sau khi tạo.', name: 'Tên dự án', namePlaceholder: 'Ví dụ: Phân tích xu hướng công bố khoa học', area: 'Lĩnh vực nghiên cứu', areaPlaceholder: 'Ví dụ: Khoa học dữ liệu', description: 'Mô tả dự án', descriptionPlaceholder: 'Mục tiêu, phạm vi hoặc nội dung chính của dự án', cancel: 'Hủy', save: 'Tạo dự án', saving: 'Đang tạo…',
    pending: 'Đang chờ phản hồi', invitedBy: 'Người mời', accept: 'Chấp nhận lời mời', decline: 'Từ chối', noProjects: 'Chưa có dự án nào', noProjectsHelp: isAdmin ? 'Tạo dự án nghiên cứu đầu tiên, sau đó mời các thành viên cùng tham gia.' : 'Các dự án bạn tham gia sẽ xuất hiện tại đây.', noInvites: 'Không có lời mời đang chờ', noInvitesHelp: 'Khi có người mời bạn vào dự án, lời mời sẽ hiển thị tại đây.',
    selectProject: 'Chọn một dự án', selectProjectHelp: 'Chọn dự án trong danh sách để xem thông tin và thành viên.', members: 'Thành viên dự án', invite: 'Mời thành viên', inviteHelp: 'Tìm tài khoản HyperData Lab bằng username hoặc email.', lookup: 'Tìm tài khoản', lookupBusy: 'Đang tìm…', invitePlaceholder: 'Username hoặc email', sendInvite: 'Gửi lời mời', sending: 'Đang gửi…', activeMembers: 'Đang tham gia', invited: 'Đã mời', emailFailed: 'Gửi email thất bại', remove: 'Gỡ khỏi dự án', removeConfirm: 'Bạn có chắc muốn gỡ thành viên này khỏi dự án?', retry: 'Thử lại', loading: 'Đang tải dự án…', projectCreated: 'Đã tạo dự án.', inviteDelivered: 'Đã gửi lời mời qua ứng dụng và email.', invitePartial: 'Đã tạo lời mời, nhưng có kênh thông báo chưa gửi được.', lookupEmpty: 'Không tìm thấy tài khoản đang hoạt động.',
  } : {
    title: 'Research projects', subtitle: 'A shared workspace for scientific research teams.', create: 'Create project',
    projects: 'My projects', invitations: 'Invitations', search: 'Search by project or research area', active: 'Active', owner: 'Project owner', member: 'Member',
    createTitle: 'Create a research project', createHelp: 'Start with the essentials. You can invite members after creating the project.', name: 'Project name', namePlaceholder: 'e.g. Trends in scientific publishing', area: 'Research area', areaPlaceholder: 'e.g. Data science', description: 'Project description', descriptionPlaceholder: 'Goals, scope, or a short project overview', cancel: 'Cancel', save: 'Create project', saving: 'Creating…',
    pending: 'Waiting for your response', invitedBy: 'Invited by', accept: 'Accept invitation', decline: 'Decline', noProjects: 'No projects yet', noProjectsHelp: isAdmin ? 'Create your first research project, then invite collaborators to join.' : 'Projects you join will appear here.', noInvites: 'No pending invitations', noInvitesHelp: 'Invitations to join research projects will appear here.',
    selectProject: 'Select a project', selectProjectHelp: 'Choose a project from the list to see its details and members.', members: 'Project members', invite: 'Invite a member', inviteHelp: 'Find a HyperData Lab account by username or email.', lookup: 'Find account', lookupBusy: 'Searching…', invitePlaceholder: 'Username or email', sendInvite: 'Send invitation', sending: 'Sending…', activeMembers: 'Active', invited: 'Invited', emailFailed: 'Email failed', remove: 'Remove from project', removeConfirm: 'Are you sure you want to remove this member from the project?', retry: 'Try again', loading: 'Loading projects…', projectCreated: 'Project created.', inviteDelivered: 'Invitation sent in app and by email.', invitePartial: 'Invitation created, but one notification channel could not deliver it.', lookupEmpty: 'No active account found.',
  }, [isAdmin, isVi]);

  const refresh = useCallback(async (preferredId?: string | null, preserveSelection = true) => {
    setLoading(true);
    setError('');
    try {
      const result = await researchProjectApi.list();
      setProjects(result.projects);
      setInvitations(result.invitations);
      const target = preferredId || (preserveSelection ? detail?.id : null);
      if (target && result.projects.some((item) => item.id === target)) setDetail(await researchProjectApi.detail(target));
      else setDetail(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (isVi ? 'Không tải được danh sách dự án.' : 'Could not load projects.'));
    } finally { setLoading(false); }
  }, [detail?.id, isVi]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      router.replace('/login');
      return;
    }
    void refresh(selectedFromUrl);
  }, [authLoading, user?.id, refresh, selectedFromUrl, router]);

  const openProject = async (project: ResearchProject) => {
    setError('');
    setMode('projects');
    try {
      setDetail(await researchProjectApi.detail(project.id));
      router.replace(`/projects?project=${encodeURIComponent(project.id)}`, { scroll: false });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open project.'); }
  };

  const closeDetail = () => {
    setDetail(null);
    router.replace('/projects', { scroll: false });
  };

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await researchProjectApi.create({ title, description, researchArea });
      setShowCreate(false); setTitle(''); setDescription(''); setResearchArea('');
      setNotice(text.projectCreated);
      await refresh(created.id, false);
      router.replace(`/projects?project=${encodeURIComponent(created.id)}`, { scroll: false });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create project.'); }
    finally { setBusy(false); }
  };

  const lookupUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(''); setNotice(''); setMatchedUser(null); setBusy(true);
    try {
      const result = await researchProjectApi.findUser(inviteQuery.trim());
      setMatchedUser(result.user);
      if (!result.user) setNotice(text.lookupEmpty);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not find user.'); }
    finally { setBusy(false); }
  };

  const inviteUser = async () => {
    if (!detail || !matchedUser || detail.membershipRole !== 'OWNER') return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await researchProjectApi.invite(detail.id, matchedUser.username || matchedUser.email);
      setNotice(result.emailSent && result.notificationSent ? text.inviteDelivered : text.invitePartial);
      setMatchedUser(null); setInviteQuery('');
      await refresh(detail.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send invitation.'); }
    finally { setBusy(false); }
  };

  const respond = async (project: ResearchProject, action: 'accept' | 'decline') => {
    const uid = firebaseAuth().currentUser?.uid;
    if (!uid) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await researchProjectApi.respond(project.id, uid, action);
      if (action === 'accept') {
        setMode('projects');
        await refresh(project.id, false);
        router.replace(`/projects?project=${encodeURIComponent(project.id)}`, { scroll: false });
      } else await refresh(null, false);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not respond to invitation.'); }
    finally { setBusy(false); }
  };

  const removeMember = async (member: ResearchProjectMember) => {
    if (!detail || !window.confirm(text.removeConfirm)) return;
    setBusy(true); setError('');
    try { await researchProjectApi.removeMember(detail.id, member.userUid); await refresh(detail.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove member.'); }
    finally { setBusy(false); }
  };

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => !query || `${project.title} ${project.researchArea} ${project.description}`.toLowerCase().includes(query));
  }, [projects, search]);
  const visibleInvitations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invitations.filter((project) => !query || `${project.title} ${project.researchArea} ${project.owner?.name || ''} ${project.owner?.email || ''}`.toLowerCase().includes(query));
  }, [invitations, search]);
  const currentItems = mode === 'projects' ? visibleProjects : visibleInvitations;

  const content = <div className={styles.page}>
    <header className={styles.pageHeader}>
      <div className={styles.headingGroup}>
        <span className={styles.headingIcon}><ProjectMark size={22} /></span>
        <div><h1 className={styles.pageTitle}>{text.title}</h1><p className={styles.pageSubtitle}>{text.subtitle}</p></div>
      </div>
      {isAdmin && <button type="button" className={styles.primaryButton} onClick={() => { setShowCreate((value) => !value); setNotice(''); }} aria-expanded={showCreate}>
        <span aria-hidden="true">{showCreate ? '−' : '+'}</span>{text.create}
      </button>}
    </header>

    {showCreate && isAdmin && <form className={styles.createForm} onSubmit={createProject}>
      <div className={styles.formHeading}><div><h2>{text.createTitle}</h2><p>{text.createHelp}</p></div><button type="button" className={styles.iconButton} onClick={() => setShowCreate(false)} aria-label={text.cancel}>×</button></div>
      <div className={styles.formGrid}>
        <label className={styles.field}>{text.name}<span className={styles.required}>*</span><input autoFocus required maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={text.namePlaceholder} /></label>
        <label className={styles.field}>{text.area}<input maxLength={160} value={researchArea} onChange={(event) => setResearchArea(event.target.value)} placeholder={text.areaPlaceholder} /></label>
        <label className={`${styles.field} ${styles.fieldWide}`}>{text.description}<textarea maxLength={5000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={text.descriptionPlaceholder} /></label>
      </div>
      <div className={styles.formFooter}><span>{title.length}/180</span><div><button type="button" className={styles.secondaryButton} onClick={() => setShowCreate(false)}>{text.cancel}</button><button type="submit" className={styles.primaryButton} disabled={busy || !title.trim()}>{busy ? text.saving : text.save}</button></div></div>
    </form>}

    {(error || notice) && <div className={`${styles.feedback} ${error ? styles.feedbackError : styles.feedbackSuccess}`} role={error ? 'alert' : 'status'}>
      <span>{error || notice}</span>{error && <button type="button" onClick={() => void refresh(selectedFromUrl)}>{text.retry}</button>}
    </div>}

    <section className={styles.projectWorkspace} aria-label={text.title}>
      <div className={`${styles.listPane} ${detail ? styles.listPaneHiddenOnMobile : ''}`}>
        <div className={styles.listToolbar}>
          <div className={styles.tabs} role="group" aria-label={text.title}>
            <button type="button" aria-pressed={mode === 'projects'} className={mode === 'projects' ? styles.tabActive : styles.tab} onClick={() => { setMode('projects'); setSearch(''); setDetail(null); router.replace('/projects', { scroll: false }); }}>
              {text.projects}<span>{projects.length}</span>
            </button>
            <button type="button" aria-pressed={mode === 'invitations'} className={mode === 'invitations' ? styles.tabActive : styles.tab} onClick={() => { setMode('invitations'); setSearch(''); setDetail(null); router.replace('/projects', { scroll: false }); }}>
              {text.invitations}<span>{invitations.length}</span>
            </button>
          </div>
          <label className={styles.searchBox}><SearchMark /><span className={styles.visuallyHidden}>{text.search}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text.search} /></label>
        </div>

        <div className={styles.listContent}>
          {loading ? <div className={styles.skeletonList} aria-label={text.loading}><span /><span /><span /></div>
            : error && currentItems.length === 0 ? <div className={styles.emptyList}><p>{error}</p><button type="button" className={styles.secondaryButton} onClick={() => void refresh(selectedFromUrl)}>{text.retry}</button></div>
              : currentItems.length === 0 ? <div className={styles.emptyList}>
                <span className={styles.emptyMark}><ProjectMark size={23} /></span>
                <h2>{search ? (isVi ? 'Không tìm thấy kết quả' : 'No matching projects') : mode === 'projects' ? text.noProjects : text.noInvites}</h2>
                <p>{search ? (isVi ? 'Thử một từ khóa khác.' : 'Try another search term.') : mode === 'projects' ? text.noProjectsHelp : text.noInvitesHelp}</p>
                {mode === 'projects' && isAdmin && !search && <button className={styles.primaryButton} type="button" onClick={() => setShowCreate(true)}><span aria-hidden="true">+</span>{text.create}</button>}
              </div>
                : <ul className={styles.projectList}>{currentItems.map((project) => mode === 'invitations'
                  ? <li className={styles.projectRow} key={project.id}><article className={styles.invitationItem}>
                    <div className={styles.projectIdentity}><span className={styles.projectIcon}><ProjectMark /></span><div className={styles.projectText}><h3>{project.title}</h3><p>{text.invitedBy} {project.owner?.name || project.owner?.email || '—'}</p>{project.researchArea && <small>{project.researchArea}</small>}</div></div>
                    <div className={styles.invitationActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void respond(project, 'decline')}>{text.decline}</button><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void respond(project, 'accept')}>{text.accept}</button></div>
                  </article></li>
                  : <li className={styles.projectRow} key={project.id}><button type="button" className={`${styles.projectItem} ${detail?.id === project.id ? styles.projectItemSelected : ''}`} onClick={() => void openProject(project)} aria-pressed={detail?.id === project.id}>
                    <span className={styles.projectIcon}><ProjectMark /></span><span className={styles.projectText}><strong>{project.title}</strong><span>{project.researchArea || (isVi ? 'Chưa có lĩnh vực' : 'No research area')}</span></span><span className={styles.roleTag}>{project.membershipRole === 'OWNER' ? text.owner : text.member}</span>
                  </button></li>)}</ul>}
        </div>
      </div>

      <section className={`${styles.detailPane} ${detail ? styles.detailPaneVisibleOnMobile : ''}`} aria-label={detail?.title || text.selectProject}>
        {detail ? <>
          <div className={styles.detailHeader}>
            <button type="button" className={`${styles.backButton} ${styles.mobileOnly}`} onClick={closeDetail}>← <span>{text.projects}</span></button>
            <div className={styles.detailTitleRow}><span className={styles.detailIcon}><ProjectMark size={25} /></span><div><h2>{detail.title}</h2><p>{detail.researchArea || (isVi ? 'Chưa chỉ định lĩnh vực' : 'Research area not specified')}</p></div></div>
            <div className={styles.projectMeta}><span className={styles.statusDot} />{text.active}<span className={styles.metaDivider} /><MemberMark />{detail.members.filter((member) => member.status === 'ACTIVE').length} {isVi ? 'thành viên' : 'members'}</div>
          </div>
          <div className={styles.detailBody}>
            <section className={styles.descriptionSection}><h3>{text.description}</h3><p>{detail.description || (isVi ? 'Chưa có mô tả cho dự án này.' : 'No description has been added to this project.')}</p></section>
            {detail.membershipRole === 'OWNER' && <section className={styles.inviteSection}>
              <div className={styles.sectionHeading}><div><h3>{text.invite}</h3><p>{text.inviteHelp}</p></div><span className={styles.sectionIcon}><MemberMark /></span></div>
              <form className={styles.lookupForm} onSubmit={lookupUser}><label className={styles.visuallyHidden} htmlFor="project-invite-search">{text.invitePlaceholder}</label><input id="project-invite-search" value={inviteQuery} onChange={(event) => { setInviteQuery(event.target.value); setMatchedUser(null); setNotice(''); }} placeholder={text.invitePlaceholder} /><button className={styles.secondaryButton} disabled={busy || inviteQuery.trim().length < 3}>{busy ? text.lookupBusy : text.lookup}</button></form>
              {matchedUser && <div className={styles.matchRow}><div className={styles.memberAvatar}>{(matchedUser.name || matchedUser.username || 'U').slice(0, 1).toUpperCase()}</div><div className={styles.memberText}><strong>{matchedUser.name}</strong><span>{matchedUser.username || matchedUser.email} · {matchedUser.role}</span></div><button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void inviteUser()}>{busy ? text.sending : text.sendInvite}</button></div>}
            </section>}
            <section className={styles.membersSection}>
              <div className={styles.sectionHeading}><div><h3>{text.members}</h3><p>{detail.members.filter((member) => member.status === 'ACTIVE').length} {text.activeMembers.toLowerCase()}</p></div><span className={styles.memberCount}>{detail.members.filter((member) => member.status === 'ACTIVE').length}</span></div>
              {detail.members.length === 0 ? <p className={styles.memberEmpty}>{isVi ? 'Chưa có thành viên khác trong dự án.' : 'No other members have joined this project.'}</p> : <ul className={styles.memberList}>{detail.members.map((member) => <MemberRow key={member.userUid} member={member} isOwner={detail.membershipRole === 'OWNER'} busy={busy} isVi={isVi} text={text} onRemove={() => void removeMember(member)} />)}</ul>}
            </section>
          </div>
        </> : <div className={styles.detailEmpty}><span className={styles.detailEmptyIcon}><ProjectMark size={28} /></span><h2>{text.selectProject}</h2><p>{text.selectProjectHelp}</p></div>}
      </section>
    </section>
  </div>;

  if (user?.role === 'ADMIN') return <AdminShell active="projects" title={text.title}>{content}</AdminShell>;
  if (user?.role === 'LECTURER') return <LecturerShell active="projects" title={text.title}>{content}</LecturerShell>;
  return <StudentDashboardLayout title={text.title}>{content}</StudentDashboardLayout>;
}

function MemberRow({ member, isOwner, busy, isVi, text, onRemove }: { member: ResearchProjectMember; isOwner: boolean; busy: boolean; isVi: boolean; text: Record<string, string>; onRemove: () => void }) {
  const person = member.user;
  const initials = (person?.name || person?.username || person?.email || 'U').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const ownerLabel = isVi ? 'Chủ dự án' : 'Project owner';
  return <li className={styles.memberRow}>
    <span className={`${styles.memberAvatar} ${member.role === 'OWNER' ? styles.ownerAvatar : ''}`}>{initials}</span>
    <div className={styles.memberText}><strong>{person?.name || person?.username || person?.email || member.userUid}</strong><span>{person?.email || (member.status === 'INVITED' ? text.pending : '')}</span></div>
    <div className={styles.memberActions}><span className={`${styles.memberState} ${member.role === 'OWNER' ? styles.ownerState : member.status === 'INVITED' ? styles.pendingState : ''}`}>{member.role === 'OWNER' ? ownerLabel : member.status === 'INVITED' ? text.invited : text.member}{member.status === 'INVITED' && member.invitationEmailStatus === 'FAILED' ? ` · ${text.emailFailed}` : ''}</span>
      {isOwner && member.role !== 'OWNER' && member.status === 'ACTIVE' && <button type="button" className={styles.removeButton} disabled={busy} onClick={onRemove}>{text.remove}</button>}
    </div>
  </li>;
}
