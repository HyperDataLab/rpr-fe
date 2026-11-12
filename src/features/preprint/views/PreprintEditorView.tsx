'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { StudentShell } from '../components';
import { LecturerShell } from '@/features/lecturer/components';
import { useTranslation } from '@/i18n';
import { studentPreprintApi } from '../api';
import type { StudentPreprint, PreprintAnalysis } from '../types';
import { FormSkeleton } from '@/components/skeleton';
import { usePreprintDraft } from '@/lib/hooks/use-preprint-draft';

const DISCIPLINES = [
  'Computer Science & Artificial Intelligence',
  'Information Technology & Software Engineering',
  'Data Science & Machine Learning',
  'Electrical & Electronics Engineering',
  'Mathematics & Applied Statistics',
  'Physics & Materials Science',
  'Biological & Medical Sciences',
  'Environmental & Earth Sciences',
  'Social Sciences & Economics',
  'Interdisciplinary Scientific Research',
];

interface SearchableDisciplineSelectProps {
  value: string;
  onChange: (val: string) => void;
}

function SearchableDisciplineSelect({ value, onChange }: SearchableDisciplineSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filtered = DISCIPLINES.filter((d) =>
    d.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const handleToggle = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      setSearchQuery('');
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  };

  const handleSelect = (item: string) => {
    onChange(item);
    setIsOpen(false);
  };

  return (
    <div className="student-searchable-select" ref={containerRef}>
      <button
        type="button"
        id="field-discipline"
        className={`student-searchable-select__trigger ${isOpen ? 'student-searchable-select__trigger--open' : ''}`}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={value ? 'student-searchable-select__value' : 'student-searchable-select__placeholder'}>
          {value || 'Chọn chuyên ngành nghiên cứu'}
        </span>
        <svg
          className={`student-searchable-select__arrow ${isOpen ? 'student-searchable-select__arrow--open' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className="student-searchable-select__dropdown" role="listbox">
          <div className="student-searchable-select__search-wrapper">
            <svg
              className="student-searchable-select__search-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              className="student-searchable-select__search-input"
              placeholder="Tìm kiếm chuyên ngành..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <ul className="student-searchable-select__options">
            {filtered.length > 0 ? (
              filtered.map((item) => {
                const isSelected = item === value;
                return (
                  <li
                    key={item}
                    role="option"
                    aria-selected={isSelected}
                    className={`student-searchable-select__option ${
                      isSelected ? 'student-searchable-select__option--selected' : ''
                    }`}
                    onClick={() => handleSelect(item)}
                  >
                    <span>{item}</span>
                    {isSelected && (
                      <svg
                        className="student-searchable-select__check"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </li>
                );
              })
            ) : (
              <li className="student-searchable-select__option--empty">
                Không tìm thấy chuyên ngành phù hợp
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

interface PreprintEditorViewProps {
  id?: string;
}

function PreprintWorkspaceShell({
  isLecturer,
  title,
  children,
}: {
  isLecturer: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return isLecturer
    ? <LecturerShell active="submissions" title={title}>{children}</LecturerShell>
    : <StudentShell title={title}>{children}</StudentShell>;
}

export function PreprintEditorView({ id }: PreprintEditorViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const isEditing = Boolean(id);
  const isLecturerRoute = pathname?.startsWith('/lecturer/') ?? false;
  const isLecturer = (user?.role === 'LECTURER') || isLecturerRoute;
  const workspacePath = isLecturer ? '/lecturer/submissions' : '/student/my-preprints';
  const devMockSubmitEnabled = process.env.NEXT_PUBLIC_DEV_MOCK_SUBMIT === 'true';

  // Form states
  const [title, setTitle] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [abstractText, setAbstractText] = useState('');
  const [keywordsInput, setKeywordsInput] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [changeSummary, setChangeSummary] = useState('');
  const [changeSummaryError, setChangeSummaryError] = useState<string | null>(null);

  // Authors are extracted from the uploaded PDF. New contributors can be added
  // before submission and are sent through the metadata update endpoint.
  const [authors, setAuthors] = useState<StudentPreprint['authors']>([]);
  const [newAuthorName, setNewAuthorName] = useState('');
  const [newAuthorEmail, setNewAuthorEmail] = useState('');
  const [newAuthorStudentId, setNewAuthorStudentId] = useState('');
  const [newAuthorRole, setNewAuthorRole] = useState<'STUDENT' | 'LECTURER'>(isLecturerRoute ? 'LECTURER' : 'STUDENT');
  const [newAuthorInst, setNewAuthorInst] = useState('');
  const [showAddAuthor, setShowAddAuthor] = useState(false);

  // Edit Author Modal State
  const [editingAuthorIndex, setEditingAuthorIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStudentId, setEditStudentId] = useState('');
  const [editRole, setEditRole] = useState<'STUDENT' | 'LECTURER'>('STUDENT');
  const [editInstitution, setEditInstitution] = useState('');
  const [editIsPrimary, setEditIsPrimary] = useState(false);

  // File Upload State
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // UI status
  const [loadingInitial, setLoadingInitial] = useState(isEditing);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [originalItem, setOriginalItem] = useState<StudentPreprint | null>(null);
  const [analysis, setAnalysis] = useState<PreprintAnalysis | null>(null);

  // Load existing data if editing
  useEffect(() => {
    if (!id) return;
    let active = true;
    studentPreprintApi.get(id)
      .then((item) => {
        if (!active) return;
        setOriginalItem(item);
        setTitle(item.titleNeedsInput ? '' : item.title || '');
        if (item.discipline) setDiscipline(item.discipline);
        setAbstractText(item.abstract || '');
        if (item.keywords?.length) setKeywordsInput(item.keywords.join(', '));
        setIsPrivate(Boolean((item as StudentPreprint & { is_private?: boolean }).is_private));
        if (item.file_name) {
          setFileName(item.file_name);
          setFileSize(item.file_size || null);
          setFileHash(item.sha256 || null);
        }
        if (item.change_summary) setChangeSummary(item.change_summary);
        setAuthors(item.authors || []);
      })
      .catch((err) => {
        if (active) setFormError(err instanceof Error ? err.message : 'Failed to load preprint draft.');
      })
      .finally(() => {
        if (active) setLoadingInitial(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  // Preprint Draft (Auto-save in Browser Storage)
  const { draft, saveDraft, clearDraft, hasSavedDraft } = usePreprintDraft();
  const [draftRestored, setDraftRestored] = useState(false);
  const [showDraftNotice, setShowDraftNotice] = useState(false);

  // Restore draft if creating a new preprint and draft exists
  useEffect(() => {
    if (id || draftRestored || !draft) return;
    if (hasSavedDraft()) {
      if (draft.title && !title) setTitle(draft.title);
      if (draft.discipline && !discipline) setDiscipline(draft.discipline);
      if (draft.abstractText && !abstractText) setAbstractText(draft.abstractText);
      if (draft.keywordsInput && !keywordsInput) setKeywordsInput(draft.keywordsInput);
      if (draft.isPrivate !== undefined) setIsPrivate(Boolean(draft.isPrivate));
      if (draft.authors && draft.authors.length > 0 && authors.length === 0) {
        setAuthors(draft.authors as StudentPreprint['authors']);
      }
      setDraftRestored(true);
      setShowDraftNotice(true);
    }
  }, [id, draftRestored, hasSavedDraft, draft, title, discipline, abstractText, keywordsInput, authors.length]);

  // Auto-save draft on form change (debounced 600ms)
  useEffect(() => {
    if (id) return;
    if (!title.trim() && !abstractText.trim() && !discipline && !keywordsInput.trim() && authors.length === 0) return;

    const timer = setTimeout(() => {
      saveDraft({
        title,
        discipline,
        abstractText,
        keywordsInput,
        isPrivate,
        authors: authors.map((a) => ({
          name: a.name,
          email: a.email,
          studentId: a.studentId,
          role: a.role as 'STUDENT' | 'LECTURER' | 'ADMIN',
          institution: a.institution,
          isPrimary: a.isPrimary ?? false,
        })),
      });
    }, 600);

    return () => clearTimeout(timer);
  }, [id, title, discipline, abstractText, keywordsInput, isPrivate, authors, saveDraft]);

  const handleFile = async (selectedFile: File) => {
    const isPdf = selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setFormError('Only PDF files are accepted.');
      return;
    }
    if (selectedFile.size > 50 * 1024 * 1024) {
      setFormError('PDF file size cannot exceed 50MB.');
      return;
    }

    setFormError(null);
    setFile(selectedFile);
    setFileName(selectedFile.name);
    setFileSize(`${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB`);
    setAnalysis(null);
    setIsAnalyzing(true);

    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', await selectedFile.arrayBuffer());
      setFileHash(Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(''));
    } catch {
      setFileHash(null);
    }

    try {
      const result = await studentPreprintApi.analyze(selectedFile);
      setAnalysis(result);
      setTitle(result.title || '');
      setAbstractText(result.abstract || '');
      setKeywordsInput(result.keywords?.length ? result.keywords.join(', ') : '');
      setDiscipline(isEditing ? discipline : '');

      // Smart populate: automatically link uploader student profile to primary author
      const rawAuthors = result.authors || [];
      const updatedAuthors = rawAuthors.map((author, index) => {
        const isSelf = user && (
          (user.studentId && author.studentId && user.studentId.toUpperCase() === author.studentId.toUpperCase()) ||
          (user.email && author.email && user.email.toLowerCase() === author.email.toLowerCase()) ||
          index === 0
        );
        const resolvedRole = isLecturerRoute
          ? 'LECTURER'
          : ((author.role || user?.role || 'STUDENT') as 'STUDENT' | 'LECTURER' | 'ADMIN');

        if (isSelf && user) {
          return {
            ...author,
            name: author.name || user.name || '',
            email: author.email || user.email || '',
            studentId: author.studentId || user.studentId || undefined,
            role: resolvedRole,
            userId: user.id,
            verificationStatus: 'VERIFIED' as const,
          };
        }
        if (isLecturerRoute && index === 0) {
          return {
            ...author,
            role: 'LECTURER' as const,
          };
        }
        return author;
      });

      setAuthors(updatedAuthors);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to analyze the selected PDF.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files?.[0]) void handleFile(event.dataTransfer.files[0]);
  };

  const addCoAuthor = () => {
    if (!newAuthorName.trim()) return;
    if (newAuthorRole === 'STUDENT' && !newAuthorStudentId.trim()) return;
    if (newAuthorRole !== 'STUDENT' && !newAuthorEmail.trim()) return;
    setAuthors([
      ...authors,
      {
        name: newAuthorName.trim(),
        email: newAuthorEmail.trim(),
        studentId: newAuthorStudentId.trim() || undefined,
        role: newAuthorRole,
        institution: newAuthorInst.trim() || 'Institution unavailable',
        isPrimary: false,
      },
    ]);
    setNewAuthorName('');
    setNewAuthorEmail('');
    setNewAuthorStudentId('');
    setNewAuthorRole(isLecturerRoute ? 'LECTURER' : 'STUDENT');
    setNewAuthorInst('');
    setShowAddAuthor(false);
  };

  const removeCoAuthor = (index: number) => {
    setAuthors(authors.filter((_, authorIndex) => authorIndex !== index + 1));
  };

  const moveAuthorUp = (index: number) => {
    if (index === 0) return;
    const newAuthors = [...authors];
    const temp = newAuthors[index];
    newAuthors[index] = newAuthors[index - 1];
    newAuthors[index - 1] = temp;
    newAuthors.forEach(a => a.isPrimary = false);
    if (newAuthors[0]) newAuthors[0].isPrimary = true;
    setAuthors(newAuthors);
  };

  const moveAuthorDown = (index: number) => {
    if (index >= authors.length - 1) return;
    const newAuthors = [...authors];
    const temp = newAuthors[index];
    newAuthors[index] = newAuthors[index + 1];
    newAuthors[index + 1] = temp;
    newAuthors.forEach(a => a.isPrimary = false);
    if (newAuthors[0]) newAuthors[0].isPrimary = true;
    setAuthors(newAuthors);
  };

  const inviteAuthor = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    showError(`Đã gửi lời mời tham gia tới tác giả ${authors[index]?.name || ''}. (Mô phỏng)`);
  };

  const openEditAuthorModal = (index: number) => {
    const author = authors[index] || (index === 0 ? {
      name: primaryAuthorName,
      email: primaryAuthorEmail,
      studentId: primaryAuthorStudentId,
      role: isLecturer ? ('LECTURER' as const) : ('STUDENT' as const),
      institution: primaryAuthorInst,
      isPrimary: true,
    } : null);

    if (!author) return;
    setEditingAuthorIndex(index);
    setEditName(author.name || '');
    setEditEmail(author.email || '');
    setEditStudentId(author.studentId || '');
    const detectedRole = isLecturerRoute
      ? (author.role === 'STUDENT' && index !== 0 ? 'STUDENT' : 'LECTURER')
      : (author.role === 'LECTURER' ? 'LECTURER' : 'STUDENT');
    setEditRole(detectedRole);
    setEditInstitution(author.institution || '');
    setEditIsPrimary(Boolean(author.isPrimary || index === 0));
  };

  const handleUseMyInfo = () => {
    if (!user) return;
    setEditName(user.name || '');
    setEditEmail(user.email || '');
    if (user.studentId) setEditStudentId(user.studentId);
    setEditRole(user.role === 'LECTURER' ? 'LECTURER' : 'STUDENT');
    if (user.affiliation && !editInstitution) {
      setEditInstitution(user.affiliation);
    }
  };

  const saveEditedAuthor = () => {
    if (!editName.trim()) {
      showError('Vui lòng nhập họ và tên tác giả.');
      return;
    }
    if (editingAuthorIndex === null) return;

    const currentList = authors.length > 0 ? [...authors] : [{
      name: primaryAuthorName,
      email: primaryAuthorEmail,
      studentId: primaryAuthorStudentId,
      role: isLecturer ? ('LECTURER' as const) : ('STUDENT' as const),
      institution: primaryAuthorInst,
      isPrimary: true,
      isCorresponding: true,
    }];

    const targetAuthor = currentList[editingAuthorIndex] || {
      name: editName.trim(),
      email: editEmail.trim(),
      institution: editInstitution.trim() || 'Institution unavailable',
    };

    const isMatchUser = user && (
      (editStudentId && user.studentId && editStudentId.toUpperCase() === user.studentId.toUpperCase()) ||
      (editEmail && user.email && editEmail.toLowerCase() === user.email.toLowerCase())
    );

    const updatedAuthor: StudentPreprint['authors'][number] = {
      ...targetAuthor,
      name: editName.trim(),
      email: editEmail.trim(),
      studentId: editStudentId.trim() || undefined,
      role: editRole,
      institution: editInstitution.trim() || 'Institution unavailable',
      isPrimary: editIsPrimary,
      userId: isMatchUser ? user.id : targetAuthor.userId,
      verificationStatus: isMatchUser || editStudentId.trim() || editEmail.trim() ? 'VERIFIED' : 'MISSING_IDENTIFIER',
    };

    currentList[editingAuthorIndex] = updatedAuthor;

    // If marked as primary author and wasn't at index 0, move to top
    if (editIsPrimary && editingAuthorIndex > 0) {
      const [promoted] = currentList.splice(editingAuthorIndex, 1);
      currentList.forEach((a) => { a.isPrimary = false; });
      promoted.isPrimary = true;
      currentList.unshift(promoted);
    }

    setAuthors(currentList);
    setEditingAuthorIndex(null);
  };

  const isPublished = originalItem?.status === 'PUBLISHED' || originalItem?.status === 'APPROVED';
  const isRevisionMode = originalItem?.status === 'NEEDS_REVISION' || originalItem?.revision_required === true;
  const isReadOnly = Boolean(originalItem && (originalItem.status === 'UNDER_REVIEW' || originalItem.status === 'REJECTED' || originalItem.status === 'WITHDRAWN'));
  const latestReview = originalItem?.reviews?.[0];

  const showError = (msg: string) => {
    setFormError(msg);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (submitNow: boolean, useMockSubmit = false) => {
    if (isReadOnly) {
      setFormError('Bản thảo đã nộp và đang trong quá trình xét duyệt, không thể chỉnh sửa.');
      return;
    }

    if (isAnalyzing) {
      showError('Please wait for GROBID extraction to finish before saving or submitting.');
      return;
    }

    setFormError(null);
    setChangeSummaryError(null);

    if (submitNow) {
      if (isRevisionMode && !changeSummary.trim()) {
        const errorMsg = 'Vui lòng nhập tóm tắt các điểm chỉnh sửa (phản hồi người phản biện) trước khi nộp.';
        setChangeSummaryError(errorMsg);
        showError(errorMsg);
        const el = document.getElementById('field-changes');
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }

      if (!isEditing && !file) {
        showError('Vui lòng đính kèm tệp bản thảo PDF trước khi gửi xét duyệt.');
        return;
      }
    }

    if (!isEditing && !file) {
      showError('Vui lòng đính kèm tệp bản thảo PDF trước khi lưu bản nháp.');
      return;
    }

    const basePrimaryAuthor: StudentPreprint['authors'][number] = {
      name: primaryAuthorName,
      email: primaryAuthorEmail,
      studentId: isLecturer ? undefined : (user?.studentId || ''),
      role: isLecturer ? ('LECTURER' as const) : ('STUDENT' as const),
      institution: primaryAuthorInst,
      isPrimary: true,
      isCorresponding: true,
      verificationStatus: 'VERIFIED',
      source: 'ACCOUNT',
    };
    const sourceAuthors = authors.length > 0 ? authors : [basePrimaryAuthor];
    const uniqueAuthors = sourceAuthors.filter((author, index, list) => (
      list.findIndex((candidate) => {
        if (candidate.email && author.email && candidate.email.toLowerCase() === author.email.toLowerCase()) return true;
        if (candidate.studentId && author.studentId && candidate.studentId.toUpperCase() === author.studentId.toUpperCase()) return true;
        return false;
      }) === index || list.findIndex(c => c === author) === index
    ));

    if (submitNow) {
      if (!useMockSubmit) {
        const hasMissingName = uniqueAuthors.some(author => !author.name?.trim());
        if (hasMissingName) {
          showError('Tất cả các tác giả đều phải có họ và tên hợp lệ.');
          return;
        }
      }
      if (!discipline.trim()) {
        showError('Vui lòng chọn Lĩnh vực nghiên cứu trước khi nộp.');
        return;
      }
      if (!title.trim()) {
        showError('Vui lòng nhập Tiêu đề bản thảo trước khi nộp.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const keywords = keywordsInput.split(',').map((keyword) => keyword.trim()).filter(Boolean);
      const metadata = {
        title: title.trim() || undefined,
        abstract: abstractText.trim() || undefined,
        discipline: discipline.trim() || undefined,
        keywords,
        isPrivate: isLecturer ? isPrivate : undefined,
        authors: uniqueAuthors.map((author, index) => ({
          name: author.name.trim(),
          email: author.email?.trim() || undefined,
          studentId: author.studentId?.trim() || undefined,
          role: author.role || (author.studentId ? 'STUDENT' as const : 'LECTURER' as const),
          affiliation: author.institution?.trim() || undefined,
          orderIndex: index,
          isPrimary: Boolean(author.isPrimary),
          isCorresponding: Boolean(author.isCorresponding),
          verificationStatus: author.verificationStatus || 'UNLINKED',
          source: author.source || 'USER',
        })),
      };

      if (!isEditing) {
        const uploadedPublication = await studentPreprintApi.upload(file!, submitNow && !useMockSubmit ? 'SUBMIT' : 'DRAFT', metadata);
        if (useMockSubmit) await studentPreprintApi.mockSubmit(uploadedPublication.id);
        router.push(`${workspacePath}/${uploadedPublication.id}`);
        router.refresh();
        return;
      }

      const publicationId = id!;
      if (file) {
        const uploadedPublication = await studentPreprintApi.uploadRevision(publicationId, file, changeSummary.trim() || undefined);
        setFileName(uploadedPublication.file_name || fileName);
        setFileSize(uploadedPublication.file_size || fileSize);
        setFileHash(uploadedPublication.sha256 || fileHash);
      }

      await studentPreprintApi.update(publicationId, {
        ...metadata,
        changeSummary: (isRevisionMode || (isPublished && file)) ? changeSummary.trim() || undefined : undefined,
      });
      if (submitNow) {
        if (useMockSubmit) await studentPreprintApi.mockSubmit(publicationId);
        else await studentPreprintApi.submit(publicationId);
      }

      if (!id) clearDraft();

      router.push(`${workspacePath}/${publicationId}`);
      router.refresh();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Đã xảy ra lỗi trong quá trình lưu bản thảo.');
    } finally {
      setIsSubmitting(false);
    }
  };



  const primaryAuthor = authors[0] || originalItem?.authors?.[0];
  const primaryAuthorName = primaryAuthor?.name || user?.name || user?.email?.split('@')[0] || (isLecturer ? 'Giảng viên' : 'Sinh viên');
  const primaryAuthorEmail = primaryAuthor?.email || user?.email || (isLecturer ? 'lecturer@university.edu.vn' : 'student@university.edu.vn');
  const primaryAuthorStudentId = primaryAuthor?.studentId || user?.studentId || '';
  const primaryAuthorInst = primaryAuthor?.institution || 'Khoa Nghiên cứu Đại học';
  const primaryInitials = primaryAuthorName
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || (isLecturer ? 'GV' : 'ST');

  if (authLoading) {
    return (
      <main
        role="status"
        aria-live="polite"
        style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px', color: '#64748b' }}
      >
        Đang tải không gian làm việc…
      </main>
    );
  }

  if (isLecturerRoute && user?.role !== 'LECTURER') {
    return (
      <main
        role="alert"
        style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px', color: '#b91c1c' }}
      >
        Không gian này yêu cầu tài khoản Giảng viên.
      </main>
    );
  }

  return (
    <PreprintWorkspaceShell
      isLecturer={isLecturer}
      title={
        isReadOnly
          ? `${t('student.preprints.manuscriptPrefix')}: ${originalItem?.status === 'UNDER_REVIEW' ? t('student.preprints.underReview') : (originalItem?.status || '')}`
          : isPublished
            ? `Cập nhật bài báo: ${originalItem?.title || ''}`
            : isRevisionMode
              ? `${t('student.preprints.submitRevision')}: v${Number((originalItem?.current_version || 1) + 0.1).toFixed(1)}`
              : isEditing
                ? t('student.preprints.editDraft')
                : t('student.topbar.newPreprintButton')
      }
    >
      {loadingInitial ? (
        <FormSkeleton />
      ) : (
        <div className="student-editor-container">
          {showDraftNotice && !id && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              marginBottom: '20px',
              fontSize: '13px',
              color: '#166534',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>💾</span>
                <span>Bản nháp soạn thảo đã được tự động khôi phục từ trình duyệt.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => {
                    clearDraft();
                    setTitle('');
                    setDiscipline('');
                    setAbstractText('');
                    setKeywordsInput('');
                    setIsPrivate(false);
                    setAuthors([]);
                    setShowDraftNotice(false);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#dc2626',
                    fontWeight: 600,
                    fontSize: '12.5px',
                    cursor: 'pointer',
                    padding: '2px',
                    textDecoration: 'underline'
                  }}
                >
                  Xóa bản nháp
                </button>
                <button
                  type="button"
                  onClick={() => setShowDraftNotice(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#166534',
                    fontSize: '18px',
                    cursor: 'pointer',
                    padding: '0',
                    lineHeight: 1,
                  }}
                  title="Đóng thông báo"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          {/* Read-only Alert Banner */}
          {isReadOnly && (
            <div
              className="student-editor-status-banner"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                padding: '16px 20px',
                marginBottom: '20px',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '10px',
                color: '#1e40af',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div>
                  <strong style={{ fontSize: '15px', display: 'block', marginBottom: '2px', color: '#1e3a8a' }}>
                    Bản thảo đang trong trạng thái {originalItem?.status === 'UNDER_REVIEW' ? 'Đang xét duyệt (Under Review)' : originalItem?.status}
                  </strong>
                  <span style={{ fontSize: '13.5px', color: '#3b82f6' }}>
                    Bản thảo đã nộp không thể chỉnh sửa trực tiếp. Dữ liệu bản thảo được khóa trong quá trình thẩm định.
                  </span>
                </div>
              </div>
              <Link
                href={`${workspacePath}/${originalItem?.id || id}`}
                className="student-btn student-btn--primary"
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                Xem chi tiết bản thảo →
              </Link>
            </div>
          )}

          {/* Published Preprint Update Notice */}
          {isPublished && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 18px',
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: '10px',
              marginBottom: '20px',
              color: '#0369a1',
              fontSize: '13.5px',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div>
                <strong>Quy trình cập nhật bài báo đã xuất bản:</strong> Khi bạn nộp bản cập nhật (thay đổi thông tin hoặc PDF mới), bài báo sẽ chuyển sang vòng xét duyệt mới để giảng viên/quản trị viên phê duyệt. Trong suốt quá trình xét duyệt, phiên bản cũ của bài báo <strong>vẫn được giữ nguyên và công khai bình thường</strong>.
              </div>
            </div>
          )}

          {/* Reviewer Feedback Callout for Revisions */}
          {isRevisionMode && latestReview && (
            <div className="student-editor-revision-alert">
              <div className="student-editor-revision-alert__header">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div>
                  <h4>Nhận xét cần chỉnh sửa từ {latestReview.reviewer_name}</h4>
                  <p className="student-subtext">{latestReview.reviewer_title}</p>
                </div>
              </div>
              <blockquote className="student-editor-revision-alert__quote">
                &ldquo;{latestReview.comments}&rdquo;
              </blockquote>
              {latestReview.recommendations && latestReview.recommendations.length > 0 && (
                <div className="student-editor-revision-alert__recs">
                  <strong>Các điểm cần khắc phục:</strong>
                  <ul>
                    {latestReview.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Form Error Banner */}
          {formError && (
            <div className="student-error-banner" role="alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{formError}</span>
            </div>
          )}

          <form
            className="student-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isReadOnly) handleSubmit(false);
            }}
          >
            {/* Step 01: Upload Manuscript PDF */}
            <div className="student-form-section">
              <div className="student-form-section__header">
                <span className="student-step-number">01</span>
                <div>
                  <h3 className="student-form-section__title">Tải lên bản thảo PDF</h3>
                </div>
              </div>

              {!fileName ? (
                <div
                  className={`student-dropzone ${isDragging ? 'student-dropzone--active' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    id="file-upload"
                    className="student-dropzone__input"
                    onChange={(e) => {
                      if (e.target.files?.[0]) void handleFile(e.target.files[0]);
                    }}
                  />
                  <label htmlFor="file-upload" className="student-dropzone__content">
                    <div className="student-dropzone__icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <strong className="student-dropzone__cta">Chọn tệp PDF hoặc kéo thả vào đây</strong>
                    <span className="student-dropzone__specs">Tệp PDF dung lượng tối đa 50MB. Bao gồm hình vẽ, bảng biểu và tài liệu tham khảo.</span>
                  </label>
                </div>
              ) : (
                <div className="student-file-selected-card">
                  <div className="student-file-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className="student-file-details">
                    <strong className="student-file-title">{fileName}</strong>
                    <div className="student-file-meta">
                      <span>{fileSize}</span>
                      <span className="student-separator">•</span>
                      <span className="student-file-hash-tag">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {fileHash ? `SHA-256: ${fileHash.substring(0, 14)}…` : 'Đã xác thực mã băm'}
                      </span>
                    </div>
                  </div>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        setFileName(null);
                        setFileSize(null);
                        setFileHash(null);
                      }}
                      className="student-file-remove-btn"
                    >
                      Thay tệp khác
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* If Revision: Summary of Revisions (Author Response) */}
            {isRevisionMode && (
              <div className="student-form-section student-form-section--highlight">
                <div className="student-form-section__header">
                  <span className="student-step-number student-step-number--amber">★</span>
                  <div>
                    <h3 className="student-form-section__title">Tóm tắt các điểm chỉnh sửa (Phản hồi tác giả)</h3>
                  </div>
                </div>

                <div className={`student-field ${changeSummaryError ? 'student-field--error' : ''}`}>
                  <label htmlFor="field-changes" className="student-field__label">
                    Phản hồi người phản biện &amp; Ghi chú thay đổi <span className="student-required">*</span>
                  </label>
                  <textarea
                    id="field-changes"
                    className={`student-textarea ${changeSummaryError ? 'student-textarea--error' : ''}`}
                    rows={4}
                    placeholder="Ví dụ: Đã bổ sung bảng kiểm định ANOVA ở Mục 3.2, làm rõ phương pháp so sánh tại Phụ lục A và tính toán lại khoảng tin cậy."
                    value={changeSummary}
                    onChange={(e) => {
                      setChangeSummary(e.target.value);
                      if (changeSummaryError && e.target.value.trim()) {
                        setChangeSummaryError(null);
                      }
                    }}
                    aria-invalid={Boolean(changeSummaryError)}
                    aria-describedby={changeSummaryError ? 'field-changes-error' : undefined}
                    style={changeSummaryError ? { borderColor: '#ef4444', boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.15)' } : undefined}
                    required
                  />
                  {changeSummaryError && (
                    <div id="field-changes-error" className="student-field__error" style={{ color: '#dc2626', fontSize: '13px', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{changeSummaryError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* If Published & New File Uploaded: Summary of Changes */}
            {isPublished && Boolean(file) && (
              <div className="student-form-section student-form-section--highlight">
                <div className="student-form-section__header">
                  <span className="student-step-number student-step-number--amber">★</span>
                  <div>
                    <h3 className="student-form-section__title">Ghi chú phiên bản sửa đổi mới</h3>
                  </div>
                </div>

                <div className="student-field">
                  <label htmlFor="field-changes-published" className="student-field__label">
                    Mô tả các thay đổi trong tệp PDF mới (Tùy chọn)
                  </label>
                  <textarea
                    id="field-changes-published"
                    className="student-textarea"
                    rows={3}
                    placeholder="Ví dụ: Đã cập nhật bổ sung số liệu biểu đồ và chỉnh sửa định dạng theo chuẩn..."
                    value={changeSummary}
                    onChange={(e) => setChangeSummary(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="student-form-section">
              <div className="student-form-section__header">
                <span className="student-step-number">02</span>
                <div>
                  <h3 className="student-form-section__title">Tác giả &amp; Đóng góp</h3>
                </div>
              </div>

              {/* Primary Author */}
              <div
                className="student-author-card student-author-card--primary"
                style={{ cursor: !isReadOnly ? 'pointer' : 'default', transition: 'all 0.2s', position: 'relative' }}
                onClick={!isReadOnly ? () => openEditAuthorModal(0) : undefined}
                title={!isReadOnly ? 'Bấm để chỉnh sửa thông tin tác giả chính' : undefined}
              >
                <div className="student-author-avatar">{primaryInitials}</div>
                <div className="student-author-info">
                  <div className="student-author-name-row">
                    <strong className="student-author-name">{primaryAuthorName}</strong>
                    <span className="student-author-pill">Tác giả chính</span>
                    <span className="student-author-pill">Tác giả liên hệ</span>
                  </div>
                  <span className="student-author-meta">
                    {[
                      primaryAuthorEmail,
                      primaryAuthorStudentId
                        ? ((authors[0]?.role || (isLecturer ? 'LECTURER' : 'STUDENT')) === 'LECTURER'
                            ? `MSGV: ${primaryAuthorStudentId}`
                            : `MSSV: ${primaryAuthorStudentId}`)
                        : (isLecturer ? 'Giảng viên' : null),
                      primaryAuthorInst,
                    ].filter(Boolean).join(' • ')}
                  </span>
                  <span className={`student-author-verification student-author-verification--${authors[0]?.verificationStatus || 'UNLINKED'}`}>
                    {authors[0]?.verificationStatus === 'VERIFIED' || (!isEditing && !authors[0])
                      ? 'Tài khoản đã xác thực'
                      : 'Tác giả ngoài hệ thống (Chưa liên kết)'}
                  </span>
                </div>
                {!isReadOnly && (
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, zIndex: 2 }}>
                    {authors.length > 1 && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveAuthorDown(0); }} className="student-btn student-btn--sm student-btn--secondary" title="Chuyển xuống">↓</button>
                    )}
                    {authors[0]?.verificationStatus === 'UNLINKED' && (
                      <button type="button" onClick={(e) => inviteAuthor(e, 0)} className="student-btn student-btn--sm student-btn--secondary" style={{ color: '#2563eb' }}>
                        ✉ Mời
                      </button>
                    )}
                    <button
                      type="button"
                      className="student-btn student-btn--sm student-btn--secondary"
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditAuthorModal(0);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      <span>Chỉnh sửa</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Co-authors list */}
              {authors.slice(1).map((ca, idx) => (
                <div
                  key={idx}
                  className="student-author-card"
                  style={{ cursor: !isReadOnly ? 'pointer' : 'default', transition: 'all 0.2s', position: 'relative' }}
                  onClick={!isReadOnly ? () => openEditAuthorModal(idx + 1) : undefined}
                  title={!isReadOnly ? 'Bấm để chỉnh sửa thông tin đồng tác giả' : undefined}
                >
                  <div className="student-author-avatar student-author-avatar--co">CA</div>
                  <div className="student-author-info">
                    <div className="student-author-name-row">
                      <strong className="student-author-name">{ca.name}</strong>
                      <span className="student-author-pill student-author-pill--co">Đồng tác giả</span>
                    </div>
                    <span className="student-author-meta">
                      {[
                        ca.email || 'Email chưa nhập',
                        ca.studentId
                          ? (ca.role === 'LECTURER' ? `MSGV: ${ca.studentId}` : `MSSV: ${ca.studentId}`)
                          : null,
                        ca.institution,
                      ].filter(Boolean).join(' • ')}
                    </span>
                    <span className={`student-author-verification student-author-verification--${ca.verificationStatus || 'UNLINKED'}`}>
                      {ca.verificationStatus === 'VERIFIED' ? 'Tài khoản đã xác thực' : 'Tác giả ngoài hệ thống (Chưa liên kết)'}
                    </span>
                  </div>
                  {!isReadOnly && (
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, zIndex: 2 }}>
                      <button type="button" onClick={(e) => { e.stopPropagation(); moveAuthorUp(idx + 1); }} className="student-btn student-btn--sm student-btn--secondary" title="Chuyển lên">↑</button>
                      {idx + 1 < authors.length - 1 && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); moveAuthorDown(idx + 1); }} className="student-btn student-btn--sm student-btn--secondary" title="Chuyển xuống">↓</button>
                      )}
                      {ca.verificationStatus === 'UNLINKED' && (
                        <button type="button" onClick={(e) => inviteAuthor(e, idx + 1)} className="student-btn student-btn--sm student-btn--secondary" style={{ color: '#2563eb' }}>
                          ✉ Mời
                        </button>
                      )}
                      <button
                        type="button"
                        className="student-btn student-btn--sm student-btn--secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditAuthorModal(idx + 1);
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        <span>Chỉnh sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCoAuthor(idx);
                        }}
                        className="student-author-remove"
                        title="Xóa tác giả"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Add Co-author Box */}
              {!isReadOnly && (showAddAuthor ? (
                <div className="student-add-author-box">
                  <h4>Thêm đồng tác giả</h4>
                  <div className="student-form-row">
                    <input
                      type="text"
                      className="student-input"
                      placeholder="Họ và tên tác giả"
                      value={newAuthorName}
                      onChange={(e) => setNewAuthorName(e.target.value)}
                    />
                    <input
                      type="email"
                      className="student-input"
                      placeholder="Email trường đại học"
                      value={newAuthorEmail}
                      onChange={(e) => setNewAuthorEmail(e.target.value)}
                    />
                    <input
                      type="text"
                      className="student-input"
                      placeholder={newAuthorRole === 'LECTURER' ? 'Mã Số Giảng Viên (MSGV)' : 'Mã số sinh viên (MSSV)'}
                      value={newAuthorStudentId}
                      onChange={(e) => setNewAuthorStudentId(e.target.value)}
                    />
                    <select
                      className="student-select"
                      value={newAuthorRole}
                      onChange={(e) => setNewAuthorRole(e.target.value as 'STUDENT' | 'LECTURER')}
                    >
                      <option value="STUDENT">Sinh viên</option>
                      <option value="LECTURER">Giảng viên</option>
                    </select>
                    <input
                      type="text"
                      className="student-input"
                      placeholder="Đơn vị / Trường (ví dụ: ĐHBK, ĐHQG)"
                      value={newAuthorInst}
                      onChange={(e) => setNewAuthorInst(e.target.value)}
                    />
                  </div>
                  <div className="student-add-author-actions">
                    <button type="button" onClick={addCoAuthor} className="student-btn student-btn--sm student-btn--primary">
                      Thêm đồng tác giả
                    </button>
                    <button type="button" onClick={() => setShowAddAuthor(false)} className="student-btn student-btn--sm student-btn--secondary">
                      Hủy
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddAuthor(true)}
                  className="student-add-author-btn"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>Thêm đồng tác giả đóng góp</span>
                </button>
              ))}
            </div>

            {/* Step 03: Manuscript Metadata & Discipline */}
            <div className="student-form-section">
              <div className="student-form-section__header">
                <span className="student-step-number">03</span>
                <div>
                  <h3 className="student-form-section__title">Dữ liệu bản thảo &amp; Lĩnh vực nghiên cứu</h3>
                </div>
              </div>

              {/* Extraction notice */}
              {isAnalyzing ? (
                <div className="student-extraction-notice student-extraction-notice--waiting">
                  <span className="student-spinner" aria-hidden="true" />
                  <span><strong>Đang phân tích PDF bằng GROBID…</strong> Tệp chưa được lưu lên máy chủ. Bạn có thể lưu hoặc nộp sau khi phân tích xong.</span>
                </div>
              ) : analysis ? (
                <div className="student-extraction-notice student-extraction-notice--success">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>
                    <strong>Đã trích xuất thông tin qua GROBID:</strong> Tệp <em>{fileName}</em> đang được giữ tại trình duyệt này. Vui lòng rà soát và chỉnh sửa dữ liệu bên dưới trước khi lưu hoặc nộp.
                  </span>
                </div>
              ) : (
                <div className="student-extraction-notice student-extraction-notice--waiting">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0071bc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>
                    <strong>Chờ tải tệp bản thảo:</strong> Hãy chọn tệp PDF để tự động trích xuất tiêu đề, tóm tắt và danh sách tác giả. Lĩnh vực nghiên cứu và từ khóa do bạn tự nhập.
                  </span>
                </div>
              )}

              <div className="student-field">
                <label htmlFor="field-title" className="student-field__label">
                  Tiêu đề bản thảo <span className="student-required">*</span>
                </label>
                <input
                  id="field-title"
                  type="text"
                  className="student-input"
                  placeholder="Ví dụ: Khảo sát năng lực xử lý dữ liệu trong nghiên cứu STEM bậc đại học"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>

              <div className="student-field">
                <label htmlFor="field-discipline" className="student-field__label">
                  Lĩnh vực nghiên cứu <span className="student-required">*</span>
                </label>

                <input
                  id="field-discipline"
                  type="text"
                  className="student-input"
                  placeholder="Ví dụ: Khoa học máy tính, Kỹ thuật y sinh, Khoa học dữ liệu..."
                  value={discipline}
                  onChange={(e) => setDiscipline(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>

              <div className="student-field">
                <label htmlFor="field-keywords" className="student-field__label">
                  Từ khóa (phân cách bằng dấu phẩy)
                </label>
                <input
                  id="field-keywords"
                  type="text"
                  className="student-input"
                  placeholder="Ví dụ: Xử lý ngôn ngữ tự nhiên, Trí tuệ nhân tạo, Học sâu"
                  value={keywordsInput}
                  onChange={(e) => setKeywordsInput(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>

              <div className="student-field">
                <div className="student-field__label-row">
                  <label htmlFor="field-abstract" className="student-field__label">
                    Tóm tắt nghiên cứu
                  </label>
                  <span className="student-char-count">{abstractText.length} ký tự</span>
                </div>
                <textarea
                  id="field-abstract"
                  className="student-textarea"
                  rows={6}
                  placeholder="Tóm tắt câu hỏi nghiên cứu cốt lõi, phương pháp thực nghiệm, kết quả chính và ý nghĩa khoa học..."
                  value={abstractText}
                  onChange={(e) => setAbstractText(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>

              {isLecturer && (
                <div
                  className={`lecturer-privacy-card ${isPrivate ? 'lecturer-privacy-card--active' : ''}`}
                  onClick={!isReadOnly ? () => setIsPrivate(!isPrivate) : undefined}
                  role="button"
                  tabIndex={isReadOnly ? -1 : 0}
                  style={isReadOnly ? { cursor: 'default', opacity: 0.85 } : undefined}
                  onKeyDown={(e) => {
                    if (!isReadOnly && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setIsPrivate(!isPrivate);
                    }
                  }}
                >
                  <div className="lecturer-privacy-card__main">
                    <div className="lecturer-privacy-card__icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <div className="lecturer-privacy-card__content">
                      <div className="lecturer-privacy-card__title-row">
                        <span className="lecturer-privacy-card__title">Lưu trữ bản thảo trong kho lưu trữ riêng của giảng viên</span>
                        <span className={`lecturer-privacy-card__badge ${isPrivate ? 'lecturer-privacy-card__badge--private' : ''}`}>
                          {isPrivate ? 'Bản nháp riêng' : 'Quy trình thẩm định tiêu chuẩn'}
                        </span>
                      </div>
                      <p className="lecturer-privacy-card__desc">
                        Khi bật, bản thảo này hoàn toàn bảo mật trong không gian giảng viên của bạn. Bản thảo sẽ không được gửi tới hội đồng thẩm định hay hiển thị với người khác cho đến khi bạn thay đổi quyền hiển thị.
                      </p>
                    </div>
                  </div>
                  <label
                    className="lecturer-toggle-switch"
                    htmlFor="toggle-private-manuscript"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      id="toggle-private-manuscript"
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                      disabled={isReadOnly}
                      className="lecturer-toggle-switch__input"
                      role="switch"
                      aria-checked={isPrivate}
                    />
                    <span className="lecturer-toggle-switch__slider" />
                  </label>
                </div>
              )}
            </div>

            {/* Sticky/Bottom Action Bar */}
            <div className="student-form-actions-bar">
              <Link href={workspacePath} className="student-btn student-btn--secondary">
                Hủy
              </Link>

              <div className="student-form-actions-right">
                {isReadOnly ? (
                  <Link
                    href={`${workspacePath}/${originalItem?.id || id}`}
                    className="student-btn student-btn--primary"
                  >
                    <span>Xem chi tiết bản thảo</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </Link>
                ) : (
                  <>
                    {!isPublished && (
                      <button
                        type="button"
                        onClick={() => handleSubmit(false)}
                        disabled={isSubmitting || isAnalyzing}
                        className="student-btn student-btn--secondary"
                      >
                        {isAnalyzing ? 'Đang phân tích…' : isSubmitting ? 'Đang lưu…' : 'Lưu bản nháp'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleSubmit(true)}
                      disabled={isSubmitting || isAnalyzing}
                      className="student-btn student-btn--primary"
                    >
                      <span>
                        {isAnalyzing ? 'Đang phân tích…' 
                          : isSubmitting ? (isPublished ? 'Đang gửi cập nhật…' : 'Đang nộp…')
                          : isPublished ? 'Gửi bản cập nhật để xét duyệt'
                          : isRevisionMode ? 'Nộp bản sửa đổi' 
                          : 'Nộp bản thảo để xét duyệt'}
                      </span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </button>

                    {devMockSubmitEnabled && !isPublished && (
                      <button
                        type="button"
                        onClick={() => handleSubmit(true, true)}
                        disabled={isSubmitting || isAnalyzing}
                        className="student-btn student-btn--secondary"
                        title="Development-only: bypass author account verification"
                      >
                        {isSubmitting ? 'Đang nộp giả lập…' : 'Nộp giả lập (dev)'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Edit Author Modal */}
      {editingAuthorIndex !== null && (
        <div
          className="author-modal-backdrop"
          onClick={() => setEditingAuthorIndex(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="author-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="author-modal-header">
              <div>
                <h3 className="author-modal-title">
                  {editingAuthorIndex === 0 ? 'Chỉnh sửa tác giả chính' : `Chỉnh sửa đồng tác giả #${editingAuthorIndex}`}
                </h3>
                <p className="author-modal-subtitle">
                  Cập nhật thông tin tác giả để hệ thống liên kết tài khoản và tự động xác minh.
                </p>
              </div>
              <button
                type="button"
                className="author-modal-close"
                onClick={() => setEditingAuthorIndex(null)}
                aria-label="Đóng"
              >
                &times;
              </button>
            </div>

            <div className="author-modal-body">
              {user && (
                <div className="author-modal-quickfill">
                  <div className="author-modal-quickfill-text">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                    <span>Bạn là tác giả này? Dùng hồ sơ tài khoản hiện tại</span>
                  </div>
                  <button
                    type="button"
                    className="student-btn student-btn--sm student-btn--secondary"
                    onClick={handleUseMyInfo}
                  >
                    Điền nhanh
                  </button>
                </div>
              )}

              <div className="student-field">
                <label className="student-field__label">Họ và tên tác giả *</label>
                <input
                  type="text"
                  className="student-input"
                  placeholder="Ví dụ: Lê Hữu Duy"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="student-field">
                  <label className="student-field__label">Vai trò</label>
                  <select
                    className="student-select"
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as 'STUDENT' | 'LECTURER')}
                  >
                    <option value="STUDENT">Sinh viên</option>
                    <option value="LECTURER">Giảng viên</option>
                  </select>
                </div>

                <div className="student-field">
                  <label className="student-field__label">
                    {editRole === 'LECTURER' ? 'Mã Số Giảng Viên (MSGV)' : 'Mã số sinh viên (MSSV)'}
                  </label>
                  <input
                    type="text"
                    className="student-input"
                    placeholder={editRole === 'LECTURER' ? 'Ví dụ: MSGV0042' : 'Ví dụ: SE170123'}
                    value={editStudentId}
                    onChange={(e) => setEditStudentId(e.target.value)}
                  />
                  <span className="student-field__hint">
                    {editRole === 'LECTURER'
                      ? 'Dùng để tự động match và liên kết hồ sơ giảng viên'
                      : 'Dùng để tự động match tài khoản sinh viên'}
                  </span>
                </div>
              </div>

              <div className="student-field">
                <label className="student-field__label">Email trường / tổ chức</label>
                <input
                  type="email"
                  className="student-input"
                  placeholder="Ví dụ: student@hyperdata.org"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </div>

              <div className="student-field">
                <label className="student-field__label">Đơn vị / Trường đại học (Institution)</label>
                <input
                  type="text"
                  className="student-input"
                  placeholder="Ví dụ: Đại học FPT TP.HCM"
                  value={editInstitution}
                  onChange={(e) => setEditInstitution(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id="modal-is-primary"
                  checked={editIsPrimary}
                  onChange={(e) => setEditIsPrimary(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="modal-is-primary" style={{ fontSize: 13.5, color: '#334155', cursor: 'pointer' }}>
                  Đặt làm tác giả chính (Primary Author / Corresponding)
                </label>
              </div>
            </div>

            <div className="author-modal-footer">
              <button
                type="button"
                className="student-btn student-btn--secondary"
                onClick={() => setEditingAuthorIndex(null)}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="student-btn student-btn--primary"
                onClick={saveEditedAuthor}
                disabled={!editName.trim()}
              >
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}
    </PreprintWorkspaceShell>
  );
}

export default PreprintEditorView;

