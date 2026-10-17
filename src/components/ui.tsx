import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { info, relative } from '../types';
import type { Window } from '../types';

// Three level meters at different readings: the deck, in miniature.
export function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <rect
        x=".5"
        y=".5"
        width="39"
        height="39"
        rx="6"
        fill="var(--panel)"
        stroke="var(--line-strong)"
      />
      <g strokeWidth="5" strokeDasharray="3 2">
        <path d="M9 12.5h22" stroke="var(--green)" />
        <path d="M9 20h12" stroke="var(--yellow)" />
        <path d="M9 27.5h17" stroke="var(--accent)" />
      </g>
    </svg>
  );
}

export function Brand({
  provider,
  small = false,
}: {
  provider: string;
  small?: boolean;
}) {
  const p = info(provider);
  return (
    <span
      className={`provider-mark ${small ? 'small' : ''} ${provider}`}
      aria-hidden="true"
    >
      {p.mark}
    </span>
  );
}

export function Meter({ window, now }: { window?: Window; now: number }) {
  const value = window?.remaining;
  const color =
    value == null
      ? 'muted'
      : value <= 20
        ? 'red'
        : value < 65
          ? 'yellow'
          : 'green';
  return (
    <div className="meter">
      <div className="meter-top">
        <span>{window?.label || 'Quota unavailable'}</span>
        <strong className={color}>
          {value == null ? '—' : `${Math.round(value)}%`}
        </strong>
      </div>
      <div
        className="track"
        role={value == null ? undefined : 'progressbar'}
        aria-label={`${window?.label} remaining quota`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value == null ? undefined : Math.round(value)}
      >
        <span className={color} style={{ width: `${value || 0}%` }} />
      </div>
      <div className="reset-label">
        {relative(window?.resetsAt, now).replace(/^in /, 'Resets in ')}
      </div>
    </div>
  );
}

export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal">
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
