import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { info, relative } from '../types';
import { hasIcon, ProviderIcon } from './icons';
import type { Window } from '../types';

export type Tone = 'green' | 'yellow' | 'red' | 'muted';
export const tone = (value: number | null | undefined): Tone =>
  value == null
    ? 'muted'
    : value <= 20
      ? 'red'
      : value < 65
        ? 'yellow'
        : 'green';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" className="logo-tile" />
      <rect
        x="10"
        y="7"
        width="14"
        height="10"
        rx="2.5"
        className="logo-back"
      />
      <rect x="8" y="11" width="14" height="10" rx="2.5" className="logo-mid" />
      <rect
        x="6"
        y="15"
        width="14"
        height="10"
        rx="2.5"
        className="logo-front"
      />
    </svg>
  );
}

export function Brand({
  provider,
  small = false,
  icon,
}: {
  provider: string;
  small?: boolean;
  icon?: string;
}) {
  return (
    <span
      className={`provider-mark ${small ? 'small' : ''} ${provider}`}
      aria-hidden="true"
    >
      <ProviderIcon provider={icon || provider} size={small ? 16 : 22} />
      {!hasIcon(icon || provider) && info(provider).mark}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Bar({ value }: { value: number | null | undefined }) {
  return (
    <div className="track">
      <span
        className={tone(value)}
        style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }}
      />
    </div>
  );
}

export function Meter({ window, now }: { window?: Window; now: number }) {
  const value = window?.remaining;
  const reset = window?.resetsAt ? relative(window.resetsAt, now) : '';
  return (
    <div className="meter">
      <div className="meter-top">
        <span>{window?.label || 'Quota unavailable'}</span>
        {reset && <small title={`Resets ${reset}`}>{reset}</small>}
        <strong className={tone(value)}>
          {value == null ? '—' : `${Math.round(value)}%`}
        </strong>
      </div>
      <div
        role={value == null ? undefined : 'progressbar'}
        aria-label={`${window?.label} remaining quota`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value == null ? undefined : Math.round(value)}
      >
        <Bar value={value} />
      </div>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={wide ? 'wide' : undefined}
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
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
