import { useEffect, useState } from 'react';
import { ArrowDownUp, Network, Settings2 } from 'lucide-react';
import { masked, errorMessage as message } from '../types';
import type { Account, Routing } from '../types';
import { Brand } from './ui';

export function RoutingPage({
  routing,
  accounts,
  connected,
  reveal,
  save,
  manage,
  notify,
}: {
  routing: Routing;
  accounts: Account[];
  connected: boolean;
  reveal: boolean;
  save: (routing: Routing) => Promise<void>;
  manage: (account: Account) => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [draft, setDraft] = useState(routing);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(routing), [routing]);
  const changed =
    draft.strategy !== routing.strategy || draft.affinity !== routing.affinity;
  return (
    <div className="routing-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>Account selection</h2>
          <Network size={18} />
        </div>
        <div className="strategy-options">
          {[
            ['round-robin', 'Round robin', 'Distribute requests evenly.'],
            ['fill-first', 'Fill first', 'Use the first available account.'],
            [
              'weighted-round-robin',
              'Weighted round robin',
              'Use configured account weights.',
            ],
          ].map(([id, title, description]) => (
            <label
              className={`strategy-option ${draft.strategy === id ? 'selected' : ''}`}
              key={id}
            >
              <input
                type="radio"
                name="strategy"
                value={id}
                checked={draft.strategy === id}
                onChange={() => setDraft({ ...draft, strategy: id })}
              />
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="affinity-setting">
          <div>
            <h3>Session affinity</h3>
            <p>Keep conversations on the same account.</p>
          </div>
          <button
            className={`switch ${draft.affinity ? 'on' : ''}`}
            role="switch"
            aria-checked={draft.affinity}
            aria-label="Session affinity"
            onClick={() => setDraft({ ...draft, affinity: !draft.affinity })}
          >
            <span />
          </button>
        </div>
        <p className="field-help">Binding lifetime: {routing.ttl}</p>
        <div className="panel-actions">
          {!connected && <span>Demo only</span>}
          <button
            className="primary"
            disabled={!changed || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await save(draft);
              } catch (error) {
                notify(message(error), true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save routing'}
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Account priorities</h2>
          <ArrowDownUp size={18} />
        </div>
        <p>Higher priorities receive new sessions first.</p>
        <div className="priority-list">
          {[...accounts]
            .sort((a, b) => b.priority - a.priority)
            .map((account) => (
              <button key={account.id} onClick={() => manage(account)}>
                <Brand provider={account.provider} small />
                <span>
                  {reveal
                    ? account.email || account.name
                    : masked(account.email || account.name)}
                </span>
                <small>
                  {account.disabled ? 'Paused' : `P${account.priority}`}
                </small>
                <Settings2 size={14} />
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}
