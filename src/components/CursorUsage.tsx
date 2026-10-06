import { useEffect, useState } from 'react';
import { ArrowUpRight, EyeOff, RefreshCw } from 'lucide-react';
import { api, errorMessage, relative } from '../types';
import type { Window } from '../types';
import type { LimitDisplay } from '../limit-display';
import { Meter, Modal } from './ui';

type Usage = {
  connected: boolean;
  plan?: string | null;
  unlimited?: boolean;
  windows: (Window & { usedUsd: number | null; limitUsd: number | null })[];
  updatedAt?: string | null;
  error: string | null;
};
const empty: Usage = { connected: false, windows: [], error: null };
const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    value,
  );

export function CursorUsage({
  summary = false,
  active,
  display,
  saveDisplay,
}: {
  summary?: boolean;
  active: boolean;
  display: LimitDisplay;
  saveDisplay: (display: LimitDisplay) => void;
}) {
  const [usage, setUsage] = useState<Usage>(empty);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [hiddenWindows, setHiddenWindows] = useState<string[]>([]);
  const hidden =
    display.providers.includes('cursor') ||
    display.accounts['cursor-subscription']?.hidden;
  const windows = usage.windows.filter(
    (window) =>
      !display.accounts['cursor-subscription']?.windows.includes(window.id),
  );
  const allHidden = hidden || (usage.windows.length > 0 && !windows.length);
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setUsage(empty);
      return;
    }
    const load = () =>
      api<Usage>('/cursor')
        .then((data) => {
          if (!cancelled) setUsage(data);
        })
        .catch((error) => {
          if (!cancelled)
            setUsage((current) => ({ ...current, error: errorMessage(error) }));
        });
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);
  async function request(method: string, path = '/cursor', body?: unknown) {
    setBusy(true);
    setError('');
    try {
      const data = await api<Usage>(path, method, body);
      setUsage(data);
      if (method !== 'POST' || path === '/cursor') {
        setOpen(false);
        setToken('');
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function manage() {
    setToken('');
    setError('');
    setHiddenWindows(display.accounts['cursor-subscription']?.windows || []);
    setOpen(true);
  }
  return (
    <section
      className={
        summary ? 'summary-card cursor-usage' : 'provider-panel cursor-usage'
      }
    >
      <div className="cursor-heading">
        <span className="provider-mark small" aria-hidden="true">
          C
        </span>
        <h2>Cursor</h2>
        <span className="badge">{usage.plan || 'Subscription'}</span>
        <button className="text-button" onClick={manage} disabled={!active}>
          {usage.connected ? 'Manage subscription' : 'Connect Cursor'}
        </button>
        {usage.connected && (
          <button
            className="icon-button"
            disabled={busy}
            onClick={() => request('POST', '/cursor/refresh')}
            aria-label="Refresh Cursor subscription"
          >
            <RefreshCw size={15} className={busy ? 'spin' : ''} />
          </button>
        )}
      </div>
      {usage.connected ? (
        allHidden ? (
          <p>
            <EyeOff size={14} /> Limits hidden
          </p>
        ) : (
          <>
            {usage.unlimited && <p>Unlimited access reported by Cursor</p>}
            <div className="cursor-meters">
              {windows.map((window) => (
                <div key={window.id}>
                  <Meter window={window} now={Date.now()} />
                  {(window.usedUsd !== null || window.limitUsd !== null) && (
                    <p className="field-help">
                      {window.usedUsd !== null
                        ? `${money(window.usedUsd)} used`
                        : 'Usage unavailable'}
                      {window.limitUsd !== null
                        ? ` of ${money(window.limitUsd)}`
                        : ' · No spending limit reported'}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {!windows.length && !usage.unlimited && (
              <p>Cursor has not reported usage limits for this subscription.</p>
            )}
            {usage.updatedAt && (
              <p className="field-help">
                Updated {new Date(usage.updatedAt).toLocaleTimeString()} ·
                Billing reset {relative(usage.windows[0]?.resetsAt)}
              </p>
            )}
          </>
        )
      ) : (
        <p>
          Connect your Cursor dashboard session to track Enterprise or personal
          subscription usage here.
        </p>
      )}
      {usage.error && (
        <p className="form-error" role="alert">
          {usage.error}
        </p>
      )}
      {!open && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <a
        className="text-button"
        href="https://cursor.com/dashboard?tab=usage"
        target="_blank"
        rel="noreferrer"
      >
        Open Cursor dashboard <ArrowUpRight size={14} />
      </a>
      {open && (
        <Modal
          title="Cursor subscription"
          close={() => {
            setOpen(false);
            setToken('');
          }}
        >
          <p className="field-help">
            Connect with your own dashboard session, including Enterprise
            accounts. The session is saved privately on this Mac.
          </p>
          <ol className="cursor-instructions">
            <li>
              Sign in at{' '}
              <a
                href="https://cursor.com/dashboard"
                target="_blank"
                rel="noreferrer"
              >
                cursor.com/dashboard
              </a>
              .
            </li>
            <li>
              Open browser developer tools, then Application → Cookies →
              https://cursor.com.
            </li>
            <li>
              Copy the value of WorkosCursorSessionToken into the field below.
            </li>
          </ol>
          <label>
            Cursor session token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="WorkosCursorSessionToken value"
            />
          </label>
          <p className="field-help">
            Enterprise usage includes available personal and pooled team limits.
            Reconnect here when your dashboard session expires.
          </p>
          {usage.connected && usage.windows.length > 0 && (
            <fieldset className="limit-options">
              <legend>Hide model or spending limits</legend>
              {usage.windows.map((window) => (
                <label className="limit-option" key={window.id}>
                  <span>Hide {window.label}</span>
                  <input
                    type="checkbox"
                    checked={hiddenWindows.includes(window.id)}
                    onChange={(event) =>
                      setHiddenWindows(
                        event.target.checked
                          ? [...hiddenWindows, window.id]
                          : hiddenWindows.filter((id) => id !== window.id),
                      )
                    }
                  />
                </label>
              ))}
              <button
                className="secondary"
                onClick={() => {
                  saveDisplay({
                    ...display,
                    accounts: {
                      ...display.accounts,
                      'cursor-subscription': {
                        hidden: false,
                        windows: hiddenWindows,
                      },
                    },
                  });
                  setOpen(false);
                }}
              >
                Save limit display
              </button>
            </fieldset>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            {usage.connected && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => request('DELETE')}
              >
                Disconnect Cursor
              </button>
            )}
            <button
              className="primary"
              disabled={busy || !token.trim()}
              onClick={() =>
                request('POST', '/cursor', { sessionToken: token.trim() })
              }
            >
              {busy
                ? 'Connecting…'
                : usage.connected
                  ? 'Reconnect Cursor'
                  : 'Connect subscription'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
