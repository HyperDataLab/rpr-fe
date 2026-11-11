'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Panel, StatusBadge } from '@hyperdata/design-system';
import { AdminShell, AdminPageHeader } from '../components';
import { DetailSkeleton } from '@/components/skeleton';
import { SortDropdown } from '@/components/sort-dropdown';
import { ExpandableAbstract } from '@/shared/components';
import { ProtectedPdfDownloadLink } from '@/features/preprint/components/ProtectedPdfDownloadLink';
import {
  adminApi,
  type AdminPublication,
  type AdminPublicationStatus,
  type AdminReview,
  type AdminTimelineEvent,
  type AdminVersion,
  type AdminUser,
  type AdminPublicationAudience,
} from '../api';
import type { PreprintStatus } from '@/shared/types';
import { ROUTES } from '@/app/router';

export interface AdminSubmissionDetailViewProps {
  id: string;
}

function badgeStatus(status: AdminPublicationStatus): PreprintStatus {
  switch (status) {
    case 'REVIEWING':
      return 'UNDER_REVIEW';
    case 'PUBLISHED':
      return 'PUBLISHED';
    case 'REJECTED':
      return 'REJECTED';
    case 'DRAFTING':
      return 'NEEDS_REVISION';
    case 'PROCESSING':
    default:
      return 'DRAFT';
  }
}

function formatVersionLabel(versionLabel?: string | null, versionNumber?: number | null) {
  if (versionLabel) {
    return versionLabel.startsWith('v') ? versionLabel : `v${versionLabel}`;
  }
  if (typeof versionNumber === 'number') {
    return `v${versionNumber}`;
  }
  return 'v1.0';
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

function recommendationLabel(value?: AdminReview['recommendation']) {
  if (!value) return 'Not submitted';
  if (value === 'NEEDS_REVISION') return 'Needs revision';
  if (value === 'PUBLISH') return 'Recommend publish';
  return 'Recommend reject';
}

function formatFileSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return 'Size unavailable';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateHash(hash?: string | null) {
  if (!hash) return null;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function fileNameFromObjectKey(objectKey?: string) {
  if (!objectKey) return undefined;
  return objectKey.split('/').pop() || objectKey;
}

interface ReviewListProps {
  reviews: AdminReview[];
  round?: number;
  isPastRound?: boolean;
}

function ReviewCommentItem({ comment }: { comment: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = comment.length > 120 || comment.includes('\n');

  return (
    <div className="simple-reviewer-item__comment-wrapper">
      <div className={`simple-reviewer-item__comment ${isLong && !expanded ? 'simple-reviewer-item__comment--clamped' : ''}`}>
        &ldquo;{comment}&rdquo;
      </div>
      {isLong && (
        <button
          type="button"
          className="simple-reviewer-item__toggle-btn"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less ▴' : 'Show more ▾'}
        </button>
      )}
    </div>
  );
}

function ContributingAuthorsList({ authors }: { authors?: AdminPublication['authors'] }) {
  const [expanded, setExpanded] = useState(false);

  if (!authors || authors.length === 0) {
    return <p style={{ color: '#64748b', fontSize: '13.5px', margin: 0 }}>No author data available.</p>;
  }

  const visibleAuthors = expanded ? authors : authors.slice(0, 3);
  const remainingCount = authors.length - 3;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="authors-chip-grid">
        {visibleAuthors.map((author, idx) => (
          <div className="author-chip" key={author.id || idx}>
            <div className="author-chip-avatar">{author.name.charAt(0).toUpperCase()}</div>
            <div className="author-chip-info">
              <span className="author-chip-name">{author.name}</span>
              {author.affiliation && <span className="author-chip-affil">{author.affiliation}</span>}
            </div>
          </div>
        ))}
      </div>

      {authors.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'none',
            border: 'none',
            padding: '2px 0',
            cursor: 'pointer',
            color: '#64748b',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          <span>{expanded ? 'Hide details' : 'Show details'}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
    </div>
  );
}

function ReviewList({ reviews, round, isPastRound }: ReviewListProps) {
  if (!reviews.length) {
    return (
      <div className="preview-note" style={{ background: '#f8fafc', borderColor: '#e2e8f0', color: '#64748b', marginBottom: '20px' }}>
        No faculty mentor reviews have been submitted yet.
      </div>
    );
  }

  const totalReviews = reviews.length;
  const submittedReviews = reviews.filter((r) => Boolean(r.submittedAt || r.recommendation)).length;

  // Ensure Primary Lecturer appears at the top
  const sortedReviews = [...reviews].sort((a, b) => {
    if (a.assignmentRole === 'PRIMARY') return -1;
    if (b.assignmentRole === 'PRIMARY') return 1;
    return 0;
  });

  return (
    <div className="simple-reviewer-list">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '8px', borderBottom: '1px solid #e2e8f0' }}>
        <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {isPastRound ? `Committee · Round ${round || 1}` : 'Reviewers'}
        </span>
        <span style={{ fontSize: '11.5px', color: '#64748b' }}>
          {submittedReviews} of {totalReviews} submitted
        </span>
      </div>

      {sortedReviews.map((review) => {
        const isPrimary = review.assignmentRole === 'PRIMARY';
        const isNeedsRevision = review.recommendation === 'NEEDS_REVISION';
        const isPublish = review.recommendation === 'PUBLISH';
        const isReject = review.recommendation === 'REJECT';
        const initials = review.reviewer?.name
          ?.split(' ')
          .map((n) => n[0])
          .filter(Boolean)
          .slice(-2)
          .join('')
          .toUpperCase() || (isPrimary ? 'PL' : 'SR');

        return (
          <div className="simple-reviewer-item" key={review.id}>
            <div className="simple-reviewer-item__main">
              <div className="simple-reviewer-item__left">
                <div className="simple-reviewer-item__avatar">
                  {initials}
                </div>
                <div className="simple-reviewer-item__info">
                  <div className="simple-reviewer-item__name-line">
                    <span className="simple-reviewer-item__name">
                      {review.reviewer?.name || review.reviewer?.email || review.reviewerId}
                    </span>
                    <span
                      className={`simple-reviewer-item__role-tag ${
                        isPrimary
                          ? 'simple-reviewer-item__role-tag--primary'
                          : 'simple-reviewer-item__role-tag--secondary'
                      }`}
                    >
                      {isPrimary ? 'Primary' : 'Secondary'}
                    </span>
                  </div>
                  <p className="simple-reviewer-item__sub">
                    {isPrimary ? 'Decision Lead' : 'Independent Reviewer'} · {formatDate(review.submittedAt || review.updatedAt)}
                  </p>
                </div>
              </div>

              <div className="simple-reviewer-item__badge">
                {isNeedsRevision && (
                  <span className="user-badge user-badge--revision" style={{ fontSize: '10.5px', padding: '2px 7px' }}>
                    Needs Revision
                  </span>
                )}
                {isPublish && (
                  <span className="user-badge user-badge--approved" style={{ fontSize: '10.5px', padding: '2px 7px' }}>
                    Recommend Publish
                  </span>
                )}
                {isReject && (
                  <span className="user-badge user-badge--withdrawn" style={{ fontSize: '10.5px', padding: '2px 7px' }}>
                    Recommend Reject
                  </span>
                )}
                {!review.recommendation && (
                  <span style={{ fontSize: '11px', color: '#94a3b8', background: '#f8fafc', padding: '2px 6px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                    Pending
                  </span>
                )}
              </div>
            </div>

            {review.comment && (
              <ReviewCommentItem comment={review.comment} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function VersionList({ versions }: { versions: AdminVersion[] }) {
  if (!versions.length) {
    return <p style={{ color: '#64748b', fontSize: '13.5px' }}>No version history recorded.</p>;
  }

  return (
    <div className="version-card-list">
      {versions.map((version) => (
        <div className="version-card-item" key={version.id}>
          <div className="version-card-left">
            <span className={`version-pill ${version.isCurrent ? 'version-pill--current' : ''}`}>
              {version.versionLabel} {version.isCurrent ? '· Current' : '· Archived'}
            </span>
            <div>
              <h4 className="version-card-title">{version.fileName}</h4>
              <div className="version-card-meta">
                <span>{formatDate(version.createdAt)}</span>
                {version.fileSize && <span>· {formatFileSize(version.fileSize)}</span>}
                {version.sha256 && (
                  <span className="pdf-asset-hash" title={version.sha256}>
                    SHA: {truncateHash(version.sha256)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {version.downloadUrl && (
            <ProtectedPdfDownloadLink
              url={version.downloadUrl}
              fileName={version.fileName}
              className="student-btn student-btn--secondary student-btn--sm"
              title="Download PDF"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download</span>
            </ProtectedPdfDownloadLink>
          )}
        </div>
      ))}
    </div>
  );
}

interface TimelineRoundGroup {
  roundKey: string;
  roundLabel: string;
  versionLabel: string;
  isLatest: boolean;
  events: AdminTimelineEvent[];
}

function groupTimelineEvents(events: AdminTimelineEvent[]): TimelineRoundGroup[] {
  if (!events.length) return [];

  let currentRoundNum = 1;
  const annotated: { event: AdminTimelineEvent; round: number }[] = [];

  for (const ev of events) {
    if (ev.version) {
      const match = ev.version.match(/v?(\d+)/i);
      if (match) {
        const parsed = parseInt(match[1], 10);
        if (parsed > currentRoundNum) {
          currentRoundNum = parsed;
        }
      }
    }
    annotated.push({ event: ev, round: currentRoundNum });
  }

  const roundMap = new Map<number, AdminTimelineEvent[]>();
  for (const { event, round } of annotated) {
    if (!roundMap.has(round)) {
      roundMap.set(round, []);
    }
    roundMap.get(round)!.push(event);
  }

  const sortedRounds = Array.from(roundMap.keys()).sort((a, b) => b - a);
  const maxRound = sortedRounds.length > 0 ? Math.max(...sortedRounds) : 1;

  return sortedRounds.map((round) => ({
    roundKey: `round-${round}`,
    roundLabel: `Round ${round}`,
    versionLabel: `v${round}`,
    isLatest: round === maxRound,
    events: roundMap.get(round) || [],
  }));
}

function TimelineList({ events }: { events: AdminTimelineEvent[] }) {
  if (!events.length) {
    return <p style={{ color: '#64748b', fontSize: '13.5px' }}>No audit timeline events logged.</p>;
  }

  const groups = useMemo(() => groupTimelineEvents(events), [events]);
  const [openRounds, setOpenRounds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    if (groups.length > 0) {
      initial[groups[0].roundKey] = true;
    }
    return initial;
  });

  const toggleRound = (roundKey: string) => {
    setOpenRounds((prev) => ({ ...prev, [roundKey]: !prev[roundKey] }));
  };

  const allOpen = groups.length > 0 && groups.every((g) => openRounds[g.roundKey]);
  const toggleAll = () => {
    const nextState = !allOpen;
    const next: Record<string, boolean> = {};
    for (const g of groups) {
      next[g.roundKey] = nextState;
    }
    setOpenRounds(next);
  };

  if (groups.length <= 1) {
    return (
      <div className="audit-timeline-container">
        {events.map((event) => (
          <div className="audit-timeline-entry" key={event.id}>
            <div className="audit-timeline-node" />
            <div className="audit-timeline-header">
              <span className="audit-timeline-title">{event.title}</span>
              <span className="audit-timeline-actor">{event.actor}</span>
            </div>
            <p className="audit-timeline-desc">{event.description}</p>
            <span className="audit-timeline-time">{formatDate(event.timestamp)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="audit-timeline-accordion-wrapper">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <button
          type="button"
          onClick={toggleAll}
          style={{
            fontSize: '12px',
            color: '#0071bc',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 600,
            padding: '2px 4px',
          }}
        >
          {allOpen ? 'Collapse all rounds' : 'Expand all rounds'}
        </button>
      </div>
      <div className="audit-timeline-accordion-list">
        {groups.map((group) => {
          const isOpen = Boolean(openRounds[group.roundKey]);
          return (
            <div
              key={group.roundKey}
              className={`audit-timeline-round-card ${group.isLatest ? 'audit-timeline-round-card--latest' : ''}`}
            >
              <button
                type="button"
                className="audit-timeline-round-header"
                onClick={() => toggleRound(group.roundKey)}
                aria-expanded={isOpen}
              >
                <div className="audit-timeline-round-header__left">
                  <span
                    className={`audit-timeline-round-badge ${
                      group.isLatest ? 'audit-timeline-round-badge--current' : ''
                    }`}
                  >
                    {group.roundLabel} ({group.versionLabel})
                  </span>
                  {group.isLatest && (
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#059669',
                        background: '#d1fae5',
                        padding: '1px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      Current
                    </span>
                  )}
                  <span className="audit-timeline-round-count">
                    {group.events.length} event{group.events.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                    {isOpen ? 'Hide details' : 'Show details'}
                  </span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`audit-timeline-round-chevron ${isOpen ? 'audit-timeline-round-chevron--open' : ''}`}
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>
              {isOpen && (
                <div className="audit-timeline-round-body">
                  <div className="audit-timeline-container" style={{ margin: '6px 0 0' }}>
                    {group.events.map((event) => (
                      <div className="audit-timeline-entry" key={event.id}>
                        <div className="audit-timeline-node" />
                        <div className="audit-timeline-header">
                          <span className="audit-timeline-title">{event.title}</span>
                          <span className="audit-timeline-actor">{event.actor}</span>
                        </div>
                        <p className="audit-timeline-desc">{event.description}</p>
                        <span className="audit-timeline-time">{formatDate(event.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdminSubmissionDetailView({ id }: AdminSubmissionDetailViewProps) {
  const [publication, setPublication] = useState<AdminPublication | null>(null);
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [pastReviews, setPastReviews] = useState<AdminReview[]>([]);
  const [showPastReviews, setShowPastReviews] = useState(false);
  const [loadingPastReviews, setLoadingPastReviews] = useState(false);
  const [versions, setVersions] = useState<AdminVersion[]>([]);
  const [timeline, setTimeline] = useState<AdminTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [visibilityMessage, setVisibilityMessage] = useState<string | null>(null);
  const [lecturers, setLecturers] = useState<AdminUser[]>([]);
  const [primaryReviewerId, setPrimaryReviewerId] = useState('');
  const [secondaryReviewerIds, setSecondaryReviewerIds] = useState<string[]>([]);
  const [secondarySearchQuery, setSecondarySearchQuery] = useState('');
  const [audiences, setAudiences] = useState<AdminPublicationAudience[]>([]);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);

  // Decision Modal State
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [decisionAction, setDecisionAction] = useState<'PUBLISHED' | 'REJECTED' | 'DRAFTING' | null>(null);
  const [decisionReason, setDecisionReason] = useState('Editorial decision recorded by Admin backup.');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setHistoryError(null);

    Promise.allSettled([
      adminApi.getSubmission(id),
      adminApi.getReviews(id, 'current'),
      adminApi.getVersions(id),
      adminApi.getTimeline(id),
    ]).then(([publicationResult, reviewsResult, versionsResult, timelineResult]) => {
      if (!active) return;

      if (publicationResult.status === 'rejected') {
        setError(publicationResult.reason instanceof Error ? publicationResult.reason.message : 'Unable to load manuscript.');
      } else {
        setPublication(publicationResult.value);
      }

      const optionalFailures: string[] = [];
      if (reviewsResult.status === 'fulfilled') {
        setReviews(reviewsResult.value);
        const primary = reviewsResult.value.find((review) => review.assignmentRole === 'PRIMARY');
        const secondary = reviewsResult.value
          .filter((review) => review.assignmentRole === 'SECONDARY')
          .map((review) => review.reviewerId);
        setPrimaryReviewerId(primary?.reviewerId || '');
        setSecondaryReviewerIds(secondary);
      } else {
        optionalFailures.push('reviews');
      }
      if (versionsResult.status === 'fulfilled') setVersions(versionsResult.value);
      else optionalFailures.push('versions');
      if (timelineResult.status === 'fulfilled') setTimeline(timelineResult.value);
      else optionalFailures.push('timeline');

      if (optionalFailures.length) {
        setHistoryError(`Some panels are unavailable: ${optionalFailures.join(', ')}.`);
      }
      if (publicationResult.status === 'fulfilled') {
        setAudiences(publicationResult.value.audiences || []);
      }
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    adminApi.listLecturers()
      .then((result) => setLecturers(result.users))
      .catch(() => setLecturers([]));
  }, []);

  const authorUserIds = useMemo(() => {
    const ids = new Set<string>();
    if (publication?.uploader?.id) ids.add(publication.uploader.id);
    publication?.authors?.forEach((author) => {
      if (author.email) {
        const match = lecturers.find((l) => l.email?.toLowerCase() === author.email?.toLowerCase());
        if (match) ids.add(match.id);
      }
    });
    return ids;
  }, [publication, lecturers]);

  const uniqueLecturers = useMemo(() => {
    const seenEmails = new Set<string>();
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const result: AdminUser[] = [];
    for (const l of lecturers) {
      const emailKey = (l.email || '').toLowerCase().trim();
      const nameKey = (l.name || '').toLowerCase().trim();
      if (seenIds.has(l.id)) continue;
      if (emailKey && seenEmails.has(emailKey)) continue;
      if (nameKey && seenNames.has(nameKey)) continue;
      if (l.id) seenIds.add(l.id);
      if (emailKey) seenEmails.add(emailKey);
      if (nameKey) seenNames.add(nameKey);
      result.push(l);
    }
    return result;
  }, [lecturers]);

  const eligibleLecturers = useMemo(() => {
    return uniqueLecturers.filter((lecturer) => !authorUserIds.has(lecturer.id));
  }, [uniqueLecturers, authorUserIds]);

  const primaryLecturerOptions = useMemo(() => {
    return [
      { value: '', label: 'Select primary lecturer' },
      ...eligibleLecturers.map((lecturer) => ({
        value: lecturer.id,
        label: lecturer.name || lecturer.email,
        subLabel: lecturer.name ? lecturer.email : undefined,
        searchTerms: `${lecturer.name || ''} ${lecturer.email || ''}`.trim(),
      })),
    ];
  }, [eligibleLecturers]);

  const toggleSecondaryLecturer = (lecturerId: string) => {
    if (secondaryReviewerIds.includes(lecturerId)) {
      setSecondaryReviewerIds((prev) => prev.filter((id) => id !== lecturerId));
    } else {
      if (secondaryReviewerIds.length >= 2) return;
      if (primaryReviewerId === lecturerId) {
        setPrimaryReviewerId('');
      }
      setSecondaryReviewerIds((prev) => [...prev, lecturerId]);
    }
  };

  const openDecisionModal = (status: 'PUBLISHED' | 'REJECTED' | 'DRAFTING') => {
    setDecisionAction(status);
    setDecisionReason('Editorial decision recorded by Admin backup.');
    setDecisionModalOpen(true);
  };

  const executeDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publication || !decisionAction) return;

    const reason = decisionReason.trim();
    if (!reason) return;

    setBusy(true);
    setDecisionMessage(null);
    const status = decisionAction;
    
    try {
      const updated = await adminApi.changeStatus(id, status, reason);
      setPublication((current) => current ? { ...current, ...updated, status } : current);
      setDecisionMessage(`Manuscript successfully moved to ${status}.`);
      setDecisionModalOpen(false);
    } catch (error: unknown) {
      setDecisionMessage(error instanceof Error ? error.message : 'Unable to change manuscript status.');
    } finally {
      setBusy(false);
    }
  };

  const assignReviewers = async () => {
    if (!primaryReviewerId || secondaryReviewerIds.length !== 2) {
      setAssignmentMessage('Select exactly one primary lecturer and two secondary lecturers.');
      return;
    }
    setAssignmentBusy(true);
    setAssignmentMessage(null);
    try {
      const assigned = await adminApi.assignReviewers(id, primaryReviewerId, secondaryReviewerIds);
      setReviews(assigned);
      setPastReviews([]);
      setAssignmentMessage('Primary and secondary lecturers assigned for this review round.');
    } catch (reason: unknown) {
      setAssignmentMessage(reason instanceof Error ? reason.message : 'Unable to assign lecturers.');
    } finally {
      setAssignmentBusy(false);
    }
  };

  const togglePastReviews = async () => {
    if (showPastReviews) {
      setShowPastReviews(false);
      return;
    }
    setShowPastReviews(true);
    if (pastReviews.length === 0) {
      setLoadingPastReviews(true);
      try {
        const all = await adminApi.getReviews(id, 'all');
        setPastReviews(all);
      } catch {
        // Silent catch for history loading
      } finally {
        setLoadingPastReviews(false);
      }
    }
  };

  const currentRound = publication?.reviewRound || reviews[0]?.round || publication?.currentVersion?.version || 1;

  const pastRounds = useMemo(() => {
    if (!pastReviews.length) return [];
    const roundsMap = new Map<number, AdminReview[]>();
    for (const r of pastReviews) {
      if (r.round < currentRound) {
        const list = roundsMap.get(r.round) || [];
        list.push(r);
        roundsMap.set(r.round, list);
      }
    }
    return Array.from(roundsMap.entries()).sort(([a], [b]) => b - a);
  }, [pastReviews, currentRound]);

  const saveVisibility = async () => {
    setVisibilityBusy(true);
    setVisibilityMessage(null);
    try {
      const updated = await adminApi.updateVisibility(id, audiences);
      setPublication((current) => current ? { ...current, ...updated } : current);
      setVisibilityMessage('Audience visibility saved.');
    } catch (reason: unknown) {
      setVisibilityMessage(reason instanceof Error ? reason.message : 'Unable to save audience visibility.');
    } finally {
      setVisibilityBusy(false);
    }
  };

  const toggleSecondaryReviewer = (reviewerId: string) => {
    setSecondaryReviewerIds((current) => current.includes(reviewerId)
      ? current.filter((idValue) => idValue !== reviewerId)
      : current.length < 2 ? [...current, reviewerId] : current);
  };

  return (
    <AdminShell active="submissions" title="Submission detail">
      <AdminPageHeader
        eyebrow="Editorial record"
        title={publication?.title || 'Submission detail'}
        description="Read the manuscript record, monitor peer review progress, and exercise administrative backup controls when required."
      />
      <div className="admin-detail-top-nav">
        <Link className="admin-back-btn" href={ROUTES.ADMIN.SUBMISSIONS}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Back to submissions</span>
        </Link>
      </div>

      {loading && <DetailSkeleton />}
      {error && <div className="preview-note" role="alert">Unable to load manuscript: {error}</div>}
      {historyError && !error && <div className="preview-note" role="status">{historyError}</div>}

      {publication && (
        <div className="detail-grid">
          {/* Left Panel: Manuscript Record, Authors, Versions, Timeline */}
          <Panel className="detail-panel">
            <div className="manuscript-meta-strip">
              <div className="manuscript-meta-strip__left">
                <span className="manuscript-meta-pill">
                  {formatVersionLabel(publication.currentVersion?.versionLabel, publication.currentVersion?.version)}
                </span>
                <span className="manuscript-meta-date">
                  Updated {formatDate(publication.updatedAt)}
                </span>
                {publication.uploader?.email && (
                  <span className="manuscript-meta-uploader" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    Author: {publication.uploader?.name ? `${publication.uploader.name} (${publication.uploader.email})` : publication.uploader.email}
                  </span>
                )}
              </div>
              <div className="manuscript-meta-strip__right">
                <StatusBadge status={badgeStatus(publication.status)} />
              </div>
            </div>

            {/* Abstract */}
            <div className="manuscript-abstract-box">
              <div className="manuscript-abstract-label">Abstract</div>
              <ExpandableAbstract text={publication.abstract} locale="en" />
            </div>

            {/* Primary PDF Asset */}
            {publication.downloadUrl && (
              <div className="pdf-asset-card">
                <div className="pdf-asset-info">
                  <div className="pdf-asset-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="pdf-asset-name">
                      {publication.currentVersion?.fileName || fileNameFromObjectKey(publication.objectKey) || 'Manuscript PDF'}
                    </h4>
                    <div className="pdf-asset-meta">
                      <span>{formatFileSize(publication.fileSize)}</span>
                      {publication.currentVersion?.versionLabel && (
                        <span>· Version {publication.currentVersion.versionLabel}</span>
                      )}
                    </div>
                  </div>
                </div>
                <ProtectedPdfDownloadLink
                  url={publication.downloadUrl}
                  fileName={publication.currentVersion?.fileName || fileNameFromObjectKey(publication.objectKey) || 'manuscript.pdf'}
                  className="student-btn student-btn--primary student-btn--sm"
                  title="Download PDF"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Download PDF</span>
                </ProtectedPdfDownloadLink>
              </div>
            )}

            {/* Authors */}
            <h3>Contributing Authors</h3>
            <ContributingAuthorsList authors={publication.authors} />
            {/* Audit Timeline */}
            <h3>Audit Timeline</h3>
            <TimelineList events={timeline} />
          </Panel>

          {/* Right Panel: Review Progress & Admin Decision */}
          <div className="detail-grid__sidebar">
            <Panel className="detail-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h2 style={{ margin: 0 }}>Peer Review Progress</h2>
                <span className="manuscript-meta-pill" style={{ fontSize: '11px', padding: '2px 8px' }}>
                  Round {currentRound} · {formatVersionLabel(publication.currentVersion?.versionLabel, publication.currentVersion?.version || currentRound)}
                </span>
              </div>
              <p className="abstract">
                One primary lecturer decides the workflow; two secondary lecturers provide independent review evidence.
              </p>
              <ReviewList reviews={reviews} round={currentRound} />

              {(publication.currentVersion?.version || 1) > 1 && (
                <div style={{ marginTop: '16px', marginBottom: '18px' }}>
                  <button
                    type="button"
                    onClick={togglePastReviews}
                    className="student-btn student-btn--secondary student-btn--sm"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      padding: '8px 12px',
                      fontSize: '12.5px',
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{
                        transform: showPastReviews ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s ease',
                      }}
                      aria-hidden="true"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                    <span>
                      {showPastReviews ? 'Hide earlier review rounds' : `View earlier review rounds (${(publication.currentVersion?.version || 1) - 1} prior)`}
                    </span>
                  </button>

                  {showPastReviews && (
                    <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {loadingPastReviews && (
                        <div className="preview-note" style={{ fontSize: '12px', padding: '8px 12px' }}>
                          Loading previous review history…
                        </div>
                      )}
                      {!loadingPastReviews && pastRounds.length === 0 && (
                        <div className="preview-note" style={{ fontSize: '12px', padding: '8px 12px', background: '#f8fafc', color: '#64748b' }}>
                          No previous review rounds found.
                        </div>
                      )}
                      {!loadingPastReviews && pastRounds.map(([roundNum, roundReviews]) => (
                        <div
                          key={roundNum}
                          style={{
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            padding: '12px',
                            backgroundColor: '#f8fafc',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ fontWeight: 600, fontSize: '12.5px', color: '#334155' }}>
                              Round {roundNum} (v{roundNum}.0)
                            </span>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              {roundReviews.length} assignment{roundReviews.length > 1 ? 's' : ''}
                            </span>
                          </div>
                          <ReviewList reviews={roundReviews} round={roundNum} isPastRound />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {publication.status === 'REVIEWING' && !publication.isPrivate && reviews.length === 0 && (
                <div className="admin-decision-card" style={{ marginBottom: '18px' }}>
                  <h4 className="admin-decision-title">ASSIGN REVIEW TEAM</h4>
                  <p className="admin-decision-desc">
                    Select one primary lecturer and exactly two secondary lecturers. The primary lecturer can decide the publication status.
                  </p>
                  {eligibleLecturers.length < 3 && (
                    <div className="preview-note" style={{ marginBottom: '12px', background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412' }}>
                      Live assignment requires 3 active Lecturer accounts; only {eligibleLecturers.length} eligible lecturers are available{authorUserIds.size > 0 ? ' (author and co-authors excluded to prevent conflict of interest)' : ''}.
                    </div>
                  )}
                  <label className="student-field__label" htmlFor="primary-reviewer" style={{ display: 'block', marginBottom: '6px' }}>
                    Primary lecturer
                  </label>
                  <div style={{ marginBottom: '14px' }}>
                    <SortDropdown
                      id="primary-reviewer"
                      value={primaryReviewerId}
                      options={primaryLecturerOptions}
                      onChange={(val) => {
                        setPrimaryReviewerId(val);
                        setSecondaryReviewerIds((prev) => prev.filter((id) => id !== val));
                      }}
                      disabled={assignmentBusy}
                      ariaLabel="Select primary lecturer"
                      className="admin-primary-reviewer-dropdown"
                      searchable={true}
                      searchPlaceholder="Tìm kiếm theo tên hoặc email..."
                      emptyMessage="Không tìm thấy giảng viên phù hợp"
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', marginTop: '0' }}>
                    <p className="student-field__label" style={{ margin: 0 }}>
                      Secondary lecturers (choose 2)
                    </p>
                    <span style={{ fontSize: '11.5px', fontWeight: 600, color: secondaryReviewerIds.length === 2 ? '#059669' : '#d97706' }}>
                      {secondaryReviewerIds.length}/2 selected
                    </span>
                  </div>
                  
                  <div style={{ position: 'relative', marginBottom: '10px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                      <circle cx="11" cy="11" r="8"/>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                      type="text"
                      className="student-input"
                      placeholder="Tìm kiếm theo tên hoặc email..."
                      value={secondarySearchQuery}
                      onChange={(e) => setSecondarySearchQuery(e.target.value)}
                      style={{ paddingLeft: 30, paddingRight: 30, height: 36, fontSize: '12.5px' }}
                    />
                    {secondarySearchQuery && (
                      <button
                        type="button"
                        onClick={() => setSecondarySearchQuery('')}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: 4 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="admin-audience-list" style={{ maxHeight: '220px', overflowY: 'auto', paddingRight: '4px', marginBottom: '16px' }}>
                    {eligibleLecturers
                      .filter((lecturer) => lecturer.id !== primaryReviewerId)
                      .filter((lecturer) => {
                        const q = secondarySearchQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          (lecturer.name && lecturer.name.toLowerCase().includes(q)) ||
                          (lecturer.email && lecturer.email.toLowerCase().includes(q))
                        );
                      })
                      .map((lecturer) => {
                      const isChecked = secondaryReviewerIds.includes(lecturer.id);
                      const isMaxReached = !isChecked && secondaryReviewerIds.length >= 2;
                      return (
                        <label
                          key={lecturer.id}
                          className={`admin-audience-item ${isChecked ? 'admin-audience-item--selected' : ''}`}
                          style={isMaxReached ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                        >
                          <input
                            type="checkbox"
                            className="admin-audience-checkbox"
                            checked={isChecked}
                            onChange={() => toggleSecondaryLecturer(lecturer.id)}
                            disabled={assignmentBusy || isMaxReached}
                          />
                          <span className="admin-audience-custom-check" aria-hidden="true">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                          <div className="admin-audience-info" style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                            <span className="admin-audience-name" style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                              {lecturer.name || lecturer.email}
                            </span>
                            {lecturer.name && lecturer.email && (
                              <span className="admin-audience-desc" style={{ fontSize: '11.5px', color: '#64748b' }}>
                                {lecturer.email}
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                    
                    {eligibleLecturers.filter((lecturer) => lecturer.id !== primaryReviewerId).filter((lecturer) => {
                      const q = secondarySearchQuery.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        (lecturer.name && lecturer.name.toLowerCase().includes(q)) ||
                        (lecturer.email && lecturer.email.toLowerCase().includes(q))
                      );
                    }).length === 0 && (
                      <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
                        Không tìm thấy giảng viên phù hợp với từ khóa tìm kiếm.
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="admin-btn-save-audience"
                    disabled={assignmentBusy || secondaryReviewerIds.length !== 2 || !primaryReviewerId}
                    onClick={assignReviewers}
                  >
                    {assignmentBusy ? (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                        </svg>
                        <span>Assigning...</span>
                      </>
                    ) : (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Save Review Team</span>
                      </>
                    )}
                  </button>
                  {assignmentMessage && (
                    <p className="preview-note" style={{ marginTop: '12px', marginBottom: 0 }} role="status">{assignmentMessage}</p>
                  )}
                </div>
              )}

              {!publication.isPrivate && (publication.status === 'REVIEWING' || publication.status === 'PUBLISHED') && (
                <div className="admin-decision-card" style={{ marginBottom: '18px' }}>
                  <div className="admin-decision-card__header">
                    <h4 className="admin-decision-title">Audience Visibility</h4>
                    <span className="admin-decision-badge--info">
                      Access Scope
                    </span>
                  </div>
                  <p className="admin-decision-desc">
                    Admin selects multiple audiences. An empty selection means all authenticated Students and Lecturers; GUEST also exposes the published PDF on the landing page.
                  </p>
                  <div className="admin-audience-list">
                    {[
                      { key: 'GUEST', label: 'Guest & Public', desc: 'Exposed to unauthenticated visitors on Public Portal' },
                      { key: 'STUDENT', label: 'Students', desc: 'Registered & active university students' },
                      { key: 'LECTURER', label: 'Faculty & Lecturers', desc: 'Teaching faculty, reviewers & researchers' },
                    ].map((audience) => {
                      const isSelected = audiences.includes(audience.key as AdminPublicationAudience);
                      return (
                        <label key={audience.key} className={`admin-audience-item ${isSelected ? 'admin-audience-item--selected' : ''}`}>
                          <input
                            type="checkbox"
                            className="admin-audience-checkbox"
                            checked={isSelected}
                            onChange={() => setAudiences((current) => current.includes(audience.key as AdminPublicationAudience)
                              ? current.filter((item) => item !== audience.key)
                              : [...current, audience.key as AdminPublicationAudience])}
                            disabled={visibilityBusy}
                          />
                          <span className="admin-audience-custom-check" aria-hidden="true">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                          <div className="admin-audience-info">
                            <span className="admin-audience-name">{audience.label}</span>
                            <span className="admin-audience-desc">{audience.desc}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="admin-btn-save-audience"
                    disabled={visibilityBusy}
                    onClick={saveVisibility}
                  >
                    {visibilityBusy ? (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                        </svg>
                        <span>Saving Changes...</span>
                      </>
                    ) : (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Save Audience Settings</span>
                      </>
                    )}
                  </button>
                  {visibilityMessage && (
                    <p className="preview-note" style={{ marginTop: '12px', marginBottom: 0 }} role="status">{visibilityMessage}</p>
                  )}
                </div>
              )}

              {publication.isPrivate && (
                <div className="preview-note" style={{ marginBottom: '18px', background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412' }}>
                  Private Lecturer paper: Admin has read-only access and cannot assign reviewers, change visibility, change status, publish, or delete.
                </div>
              )}

              {/* Administrator Backup Decision Card - Only displayed when actionable (REVIEWING or REJECTED) */}
              {!publication.isPrivate && (publication.status === 'REVIEWING' || publication.status === 'REJECTED') && (
                <div className="admin-decision-card">
                  <div className="admin-decision-card__header">
                    <h4 className="admin-decision-title">Admin Backup Decision</h4>
                    <span className="admin-backup-pill">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      </svg>
                      <span>Backup Authority (Quyền dự phòng)</span>
                    </span>
                  </div>
                  <p className="admin-decision-desc">
                    Primary Lecturer holds direct decision authority. Use this backup override only for escalation or unresponsive review team.
                  </p>
                  {publication.status === 'REVIEWING' && (
                    <div className="admin-decision-buttons">
                      <button
                        type="button"
                        className="admin-btn-decision admin-btn-decision--publish"
                        disabled={busy}
                        onClick={() => openDecisionModal('PUBLISHED')}
                      >
                        <div className="admin-btn-decision__icon-wrap">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                        <div className="admin-btn-decision__label-group">
                          <span className="admin-btn-decision__title">Publish Paper</span>
                          <span className="admin-btn-decision__sub">Approve and release manuscript</span>
                        </div>
                      </button>
                      <div className="admin-decision-sub-row">
                        <button
                          type="button"
                          className="admin-btn-decision admin-btn-decision--revision"
                          disabled={busy}
                          onClick={() => openDecisionModal('DRAFTING')}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          <span>Request Revision</span>
                        </button>
                        <button
                          type="button"
                          className="admin-btn-decision admin-btn-decision--reject"
                          disabled={busy}
                          onClick={() => openDecisionModal('REJECTED')}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                          <span>Reject Paper</span>
                        </button>
                      </div>
                    </div>
                  )}
                  {publication.status === 'REJECTED' && (
                    <div className="admin-decision-buttons">
                      <button
                        type="button"
                        className="admin-btn-decision admin-btn-decision--reopen"
                        disabled={busy}
                        onClick={() => openDecisionModal('DRAFTING')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <polyline points="1 4 1 10 7 10" />
                          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                        <span>Reopen for Revision</span>
                      </button>
                    </div>
                  )}
                  {decisionMessage && <p className="preview-note" style={{ marginTop: '14px', marginBottom: 0 }} role="status">{decisionMessage}</p>}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {/* Custom Decision Confirmation Modal */}
      {decisionModalOpen && decisionAction && (
        <div className="admin-modal-backdrop" onClick={() => !busy && setDecisionModalOpen(false)}>
          <div 
            className="admin-modal-card" 
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-modal-title"
          >
            <form onSubmit={executeDecision}>
              <div className="admin-modal-header">
                <div className={`admin-modal-icon admin-modal-icon--${decisionAction.toLowerCase()}`}>
                  {decisionAction === 'PUBLISHED' && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {decisionAction === 'DRAFTING' && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  )}
                  {decisionAction === 'REJECTED' && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="15" y1="9" x2="9" y2="15"/>
                      <line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                  )}
                </div>
                <div>
                  <h3 id="decision-modal-title" className="admin-modal-title">
                    {decisionAction === 'PUBLISHED' ? 'Confirm Publication' : decisionAction === 'DRAFTING' ? 'Request Revision' : 'Reject Manuscript'}
                  </h3>
                  <p className="admin-modal-subtitle">
                    {decisionAction === 'PUBLISHED' ? 'You are about to publish this manuscript.' : decisionAction === 'DRAFTING' ? 'You are requesting the author to revise this manuscript.' : 'You are about to reject this manuscript.'} This action will be recorded in the audit timeline.
                  </p>
                </div>
                <button type="button" className="admin-modal-close" onClick={() => !busy && setDecisionModalOpen(false)} aria-label="Close" disabled={busy}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="admin-modal-body">
                <div className="admin-modal-field">
                  <label htmlFor="decision-reason" className="admin-modal-label">Admin backup reason (Required)</label>
                  <textarea
                    id="decision-reason"
                    className="admin-modal-textarea"
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    placeholder="Enter reason for this decision..."
                    required
                    disabled={busy}
                    rows={4}
                  />
                  <p className="admin-modal-hint">Please provide a clear reason for the audit log.</p>
                </div>
              </div>

              <div className="admin-modal-footer">
                <button 
                  type="button" 
                  className="admin-btn-cancel" 
                  onClick={() => setDecisionModalOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className={`admin-btn-confirm admin-btn-confirm--${decisionAction.toLowerCase()}`}
                  disabled={busy || !decisionReason.trim()}
                >
                  {busy ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                      </svg>
                      Processing...
                    </>
                  ) : (
                    <>
                      {decisionAction === 'PUBLISHED' ? 'Publish Manuscript' : decisionAction === 'DRAFTING' ? 'Confirm Revision' : 'Confirm Rejection'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

export default AdminSubmissionDetailView;
