import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Network,
} from 'lucide-react';
import {
  api,
  info,
  localSubscriptions,
  providerInfo,
  errorMessage as message,
} from '../types';
import { Brand, Modal } from './ui';

export function OAuthModal({
  provider,
  connected,
  setProvider,
  close,
  connect,
  finished,
}: {
  provider: string;
  connected: boolean;
  setProvider: (provider: string) => void;
  close: () => void;
  connect: () => void;
  finished: () => Promise<void>;
}) {
  const [login, setLogin] = useState<{
    url: string;
    state: string;
    userCode: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [callback, setCallback] = useState('');
  const completed = useRef(false);
  useEffect(() => {
    setLogin(null);
    setError('');
    completed.current = false;
  }, [provider]);
  useEffect(() => {
    if (!login) return;
    let cancelled = false;
    let pending = false;
    const timer = setInterval(async () => {
      if (pending || completed.current) return;
      pending = true;
      try {
        const result = await api<{ status: string; error?: string }>(
          `/oauth/${encodeURIComponent(login.state)}`,
        );
        if (cancelled) return;
        if (result.status === 'ok') {
          completed.current = true;
          await finished();
        } else if (result.status === 'error') {
          setError(result.error || 'Login failed. Start a new login.');
          clearInterval(timer);
        }
      } catch (error) {
        if (!cancelled) {
          setError(message(error));
          clearInterval(timer);
        }
      } finally {
        pending = false;
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [login, finished]);
  async function start() {
    setBusy(true);
    setError('');
    try {
      setLogin(await api('/oauth', 'POST', { provider }));
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (login && !completed.current) {
      try {
        await api(`/oauth/${encodeURIComponent(login.state)}`, 'DELETE');
      } catch (error) {
        setError(message(error));
        return;
      }
    }
    close();
  }
  return (
    <Modal title="Connect an account" close={cancel}>
      <label>
        Provider
        <select
          value={provider}
          disabled={!!login}
          onChange={(event) => setProvider(event.target.value)}
        >
          {Object.keys(providerInfo)
            .filter((id) => !localSubscriptions.includes(id))
            .map((id) => (
              <option key={id} value={id}>
                {info(id).name}
              </option>
            ))}
        </select>
      </label>
      {!connected ? (
        <div className="connect-first">
          <Network size={32} />
          <h3>Connect your proxy first</h3>
          <button className="primary" onClick={connect}>
            Connect proxy
            <ArrowRight size={16} />
          </button>
        </div>
      ) : login ? (
        <>
          <div className="oauth-ready">
            <Brand provider={provider} />
            <h3>Your login link is ready</h3>
            {login.userCode && (
              <p>
                Device code: <code>{login.userCode}</code>
              </p>
            )}
            <a
              className="primary"
              href={login.url}
              target="_blank"
              rel="noreferrer"
            >
              Continue with {info(provider).name}
              <ExternalLink size={16} />
            </a>
            <span>
              <Loader2 size={15} className="spin" />
              Waiting for sign-in…
            </span>
          </div>
          <details>
            <summary>Signing in from a different machine?</summary>
            <p className="field-help">
              If the browser cannot reach the callback, paste the full
              redirected URL below.
            </p>
            <label>
              Callback URL
              <input
                value={callback}
                onChange={(event) => setCallback(event.target.value)}
                placeholder="http://localhost:…?code=…&state=…"
              />
            </label>
            <button
              className="secondary"
              disabled={busy || !callback}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api(
                    `/oauth/${encodeURIComponent(login.state)}/callback`,
                    'POST',
                    { redirectUrl: callback },
                  );
                } catch (error) {
                  setError(message(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Submit callback
            </button>
          </details>
        </>
      ) : (
        <>
          <div className="modal-actions">
            <button className="primary" onClick={start} disabled={busy}>
              {busy ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <ArrowUpRight size={17} />
              )}
              Start {info(provider).name} login
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
