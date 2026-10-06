import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, Link2, Loader2, Unplug } from 'lucide-react';
import { api, errorMessage as message } from '../types';
import { Modal } from './ui';

export function ConnectionModal({
  connected,
  baseUrl,
  close,
  disconnect,
  onConnected,
}: {
  connected: boolean;
  baseUrl: string;
  close: () => void;
  disconnect: () => Promise<void>;
  onConnected: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(baseUrl);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ baseUrl: string }>('/session', 'POST', {
        baseUrl: url,
        key,
      });
      setKey('');
      await onConnected(result.baseUrl);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={connected ? 'Manage connection' : 'Connect your proxy'}
      close={close}
    >
      <form onSubmit={submit}>
        <label>
          Proxy URL
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://localhost:8317"
            required
            autoFocus
          />
        </label>
        <label>
          Management key
          <input
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="Your management secret"
            autoComplete="off"
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {connected && (
            <button
              className="danger secondary"
              type="button"
              onClick={disconnect}
              disabled={busy}
            >
              <Unplug size={14} />
              Disconnect
            </button>
          )}
          <button className="primary" disabled={busy}>
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Link2 size={15} />
            )}
            {busy ? 'Connecting…' : 'Connect proxy'}
          </button>
        </div>
      </form>
      <a
        className="help-link"
        href="https://help.router-for.me/management/apiv8"
        target="_blank"
        rel="noreferrer"
      >
        Where do I find my management key?
        <ArrowUpRight size={12} />
      </a>
    </Modal>
  );
}
