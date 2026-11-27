import type React from 'react';
import type {
  SpecAnnotationKind,
  SpecDeltaKind,
  SpecStatus,
  SpecTaskComputedState,
} from './spec-types.js';

export function getSpecStatusBadgeProps(
  status: SpecStatus,
  labels: {
    statusDraft: string;
    statusApproved: string;
    statusCompleted: string;
    statusArchived: string;
  },
): { text: string; className: string; style?: React.CSSProperties } {
  switch (status) {
    case 'approved':
      return { text: labels.statusApproved, className: 'nov-badge is-offline' };
    case 'completed':
      return { text: labels.statusCompleted, className: 'nov-badge is-accent' };
    case 'archived':
      return { text: labels.statusArchived, className: 'nov-badge' };
    case 'draft':
    default:
      return { text: labels.statusDraft, className: 'nov-badge is-network' };
  }
}

export function getTaskStateBadgeProps(
  state: SpecTaskComputedState,
  labels: {
    readyBadge: string;
    waitingBadge: string;
    doneBadge: string;
    inProgressBadge: string;
    blockedBadge: string;
  },
): { text: string; className: string; style?: React.CSSProperties } {
  switch (state) {
    case 'done':
      return { text: labels.doneBadge, className: 'nov-badge is-offline' };
    case 'in_progress':
      return { text: labels.inProgressBadge, className: 'nov-badge is-accent' };
    case 'blocked':
      return {
        text: labels.blockedBadge,
        className: 'nov-badge',
        style: {
          background: 'var(--nov-danger-soft)',
          color: 'var(--nov-danger)',
          borderColor: 'var(--nov-danger)',
        },
      };
    case 'waiting_deps':
      return { text: labels.waitingBadge, className: 'nov-badge is-network' };
    case 'ready':
    default:
      return {
        text: labels.readyBadge,
        className: 'nov-badge',
        style: {
          background: 'var(--nov-success-soft)',
          color: 'var(--nov-success)',
          borderColor: 'var(--nov-success)',
        },
      };
  }
}

export function getDeltaKindStyle(kind: SpecDeltaKind): React.CSSProperties {
  if (kind === 'added') {
    return {
      background: 'var(--nov-success-soft)',
      color: 'var(--nov-success)',
      borderColor: 'var(--nov-success)',
    };
  }
  if (kind === 'removed') {
    return {
      background: 'var(--nov-danger-soft)',
      color: 'var(--nov-danger)',
      borderColor: 'var(--nov-danger)',
    };
  }
  return {
    background: 'var(--nov-warn-soft)',
    color: 'var(--nov-warn)',
    borderColor: 'var(--nov-warn)',
  };
}

export function getAnnotationKindStyle(kind: SpecAnnotationKind): React.CSSProperties {
  if (kind === 'strike') {
    return {
      background: 'var(--nov-danger-soft)',
      color: 'var(--nov-danger)',
      borderColor: 'var(--nov-danger)',
    };
  }
  if (kind === 'replace') {
    return {
      background: 'var(--nov-warn-soft)',
      color: 'var(--nov-warn)',
      borderColor: 'var(--nov-warn)',
    };
  }
  return {
    background: 'var(--nov-accent-soft)',
    color: 'var(--nov-accent)',
    borderColor: 'var(--nov-accent)',
  };
}

export function getAnnotationBorderLeft(kind: SpecAnnotationKind): string {
  if (kind === 'strike') return '3px solid var(--nov-danger)';
  if (kind === 'replace') return '3px solid var(--nov-warn)';
  return '3px solid var(--nov-accent)';
}

export const SPEC_STYLES = {
  flexWrapCenterGap8: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
  } as React.CSSProperties,
  flexWrapCenterGap6: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
  } as React.CSSProperties,
  flexWrapGap6: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  } as React.CSSProperties,
  flexWrapGap8: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  } as React.CSSProperties,
  flexWrapGap6AlignCenter: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  } as React.CSSProperties,
  flexColGap4: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  } as React.CSSProperties,
  flexColGap6: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  } as React.CSSProperties,
  flexColGap8: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  } as React.CSSProperties,
  flexColGap10: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  } as React.CSSProperties,
  mono: {
    fontFamily: 'var(--nov-font-mono)',
  } as React.CSSProperties,
  monoXs: {
    fontFamily: 'var(--nov-font-mono)',
    fontSize: '10.5px',
  } as React.CSSProperties,
  writeLockBadgeOn: {
    background: 'var(--nov-danger-soft)',
    color: 'var(--nov-danger)',
    borderColor: 'var(--nov-danger)',
  } as React.CSSProperties,
  mutedParagraph: {
    margin: 0,
    color: 'var(--nov-text-2)',
  } as React.CSSProperties,
  codeBox: {
    border: '1px solid var(--nov-border)',
    borderRadius: '8px',
    overflow: 'hidden',
    background: 'var(--nov-bg-0)',
  } as React.CSSProperties,
  diffContainer: {
    border: '1px solid var(--nov-border)',
    borderRadius: '8px',
    overflow: 'hidden',
    background: 'var(--nov-bg-0)',
    fontFamily: 'var(--nov-font-mono)',
    fontSize: '12px',
  } as React.CSSProperties,
  diffSelect: {
    width: 'auto',
    minWidth: '88px',
    padding: '4px 8px',
  } as React.CSSProperties,
  diffAddedBadge: {
    background: 'var(--nov-success-soft)',
    color: 'var(--nov-success)',
    borderColor: 'var(--nov-success)',
    fontFamily: 'var(--nov-font-mono)',
  } as React.CSSProperties,
  diffRemovedBadge: {
    background: 'var(--nov-danger-soft)',
    color: 'var(--nov-danger)',
    borderColor: 'var(--nov-danger)',
    fontFamily: 'var(--nov-font-mono)',
  } as React.CSSProperties,
  diffLineNumLeft: {
    textAlign: 'right',
    padding: '1px 6px',
    color: 'var(--nov-text-2)',
    userSelect: 'none',
  } as React.CSSProperties,
  diffLineNumRight: {
    textAlign: 'right',
    padding: '1px 6px',
    color: 'var(--nov-text-2)',
    borderRight: '1px solid var(--nov-border)',
    userSelect: 'none',
  } as React.CSSProperties,
  suggestedPre: {
    borderColor: 'var(--nov-success)',
    background: 'var(--nov-success-soft)',
    color: 'var(--nov-text-0)',
  } as React.CSSProperties,
  modeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '8px',
  } as React.CSSProperties,
  deltaInputGrid: {
    display: 'grid',
    gridTemplateColumns: '120px 150px 1fr auto',
    gap: '6px',
    alignItems: 'center',
  } as React.CSSProperties,
  orderedUnorderedList: {
    margin: 0,
    paddingLeft: '18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    fontSize: '12px',
    color: 'var(--nov-text-1)',
  } as React.CSSProperties,
};
