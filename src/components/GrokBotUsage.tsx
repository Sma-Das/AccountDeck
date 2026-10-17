import { useCallback, useEffect, useState } from 'react';
import { EyeOff, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../types';
import type { Window } from '../types';
import type { LimitDisplay } from '../limit-display';
import { Meter } from './ui';

type Usage = {
  connected: boolean;
  plan: string | null;
  windows: Window[];
  updatedAt?: string | null;
  error: string | null;
};
const empty: Usage = { connected: false, plan: null, windows: [], error: null };
export const grokBotId = 'grok-bot-subscription';

function age(updatedAt: string, now: number) {
  const minutes = Math.max(
    0,
    Math.round((now - Date.parse(updatedAt)) / 60000),
  );
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

// Grok Bot is a separate subscription from the Grok Build accounts on the
// proxy. Its limit is read from the desktop app's own usage cache on this Mac.
export function GrokBotUsage({
  summary = false,
  display,
}: {
  summary?: boolean;
  display: LimitDisplay;
}) {
  const [usage, setUsage] = useState<Usage>(empty);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    setBusy(true);
    try {
      setUsage(await api<Usage>('/grok-bot'));
    } catch (error) {
      setUsage((current) => ({ ...current, error: errorMessage(error) }));
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => clearInterval(timer);
  }, [load]);
  if (!usage.connected && !usage.error) return null;
  const setting = display.accounts[grokBotId];
  const hidden = display.providers.includes('grok-bot') || setting?.hidden;
  const windows = usage.windows.filter(
    (window) => !setting?.windows.includes(window.id),
  );
  const stale =
    !!usage.updatedAt && now - Date.parse(usage.updatedAt) > 6 * 3600000;
  return (
    <section
      className={`grok-bot-usage ${summary ? 'summary-card' : 'provider-panel'}`}
    >
      <div className="cursor-heading">
        <span className="provider-mark small xai" aria-hidden="true">
          𝕏
        </span>
        <h2>Grok Bot</h2>
        <span className="badge">{usage.plan || 'Subscription'}</span>
        <button
          className="icon-button"
          disabled={busy}
          onClick={() => void load()}
          aria-label="Reload Grok Bot usage"
          title="Reload Grok Bot usage"
        >
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
        </button>
      </div>
      {hidden ? (
        <p>
          <EyeOff size={14} /> Limits hidden
        </p>
      ) : (
        windows.length > 0 && (
          <div className="cursor-meters">
            {windows.map((window) => (
              <Meter key={window.id} window={window} now={now} />
            ))}
          </div>
        )
      )}
      {usage.error ? (
        <p className="form-error" role="alert">
          {usage.error}
        </p>
      ) : (
        usage.updatedAt && (
          <p className={`field-help ${stale ? 'stale' : ''}`}>
            Grok Bot saved this reading {age(usage.updatedAt, now)}.
            {stale && ' Open Grok Bot to update it.'}
          </p>
        )
      )}
    </section>
  );
}
