import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { info, masked, errorMessage as message } from '../types';
import type { Account } from '../types';
import { Brand, Modal } from './ui';
import { CreditAccessNote } from './CreditAccessNote';
import type { AccountLimitDisplay } from '../limit-display';

export function AccountModal({
  account,
  reveal,
  close,
  update,
  originalPriority,
  limitDisplay,
  providerLimitsHidden,
  saveLimitDisplay,
}: {
  account: Account;
  reveal: boolean;
  originalPriority?: number;
  limitDisplay: AccountLimitDisplay;
  providerLimitsHidden: boolean;
  saveLimitDisplay: (display: AccountLimitDisplay) => void;
  close: () => void;
  update: (
    account: Account,
    changes: { disabled?: boolean; priority?: number },
  ) => Promise<void>;
}) {
  const [priority, setPriority] = useState(
    originalPriority ?? account.priority,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [display, setDisplay] = useState(limitDisplay);
  async function save(changes: { disabled?: boolean; priority?: number }) {
    setBusy(true);
    setError('');
    try {
      await update(account, changes);
      close();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Manage account" close={close}>
      <div className="modal-account">
        <Brand provider={account.provider} />
        <div>
          <strong>
            {reveal
              ? account.email || account.name
              : masked(account.email || account.name)}
          </strong>
          <p>
            {info(account.provider).name} · {account.plan || 'OAuth account'}
            {account.nativeSource && ` · ${account.nativeSource}`}
          </p>
        </div>
      </div>
      <CreditAccessNote account={account} />
      <label>
        Routing priority
        <input
          type="number"
          min="-100"
          max="100"
          step="1"
          value={priority}
          onChange={(event) => setPriority(Number(event.target.value))}
        />
      </label>
      <p className="field-help">
        {originalPriority !== undefined
          ? `Auto-prioritized at P${account.priority}. This priority resumes after the boost.`
          : 'Higher priorities receive new sessions first. Affinity keeps existing sessions bound.'}
      </p>
      <fieldset className="limit-options">
        <legend>Limit display</legend>
        <p className="field-help">
          {providerLimitsHidden
            ? 'Limits are hidden for this provider. Change Limit display on the quota page to show them.'
            : 'Hide limits for frontier or unlimited access. Saved in this browser.'}
        </p>
        <label className="limit-option">
          <span>Hide all limits for this account</span>
          <input
            type="checkbox"
            checked={display.hidden}
            disabled={providerLimitsHidden}
            onChange={(event) =>
              setDisplay({ ...display, hidden: event.target.checked })
            }
          />
        </label>
        {(account.quota?.windows || []).map((window) => (
          <label className="limit-option" key={window.id}>
            <span>Hide {window.label}</span>
            <input
              type="checkbox"
              checked={display.windows.includes(window.id)}
              disabled={providerLimitsHidden || display.hidden}
              onChange={(event) =>
                setDisplay({
                  ...display,
                  windows: event.target.checked
                    ? [...display.windows, window.id]
                    : display.windows.filter((id) => id !== window.id),
                })
              }
            />
          </label>
        ))}
        <button className="secondary" onClick={() => saveLimitDisplay(display)}>
          Save limit display
        </button>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => save({ disabled: !account.disabled })}
        >
          {account.disabled ? <Play size={14} /> : <Pause size={14} />}
          {account.disabled ? 'Resume account' : 'Pause account'}
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            !Number.isInteger(priority) ||
            priority < -100 ||
            priority > 100
          }
          onClick={() => save({ priority })}
        >
          Save priority
        </button>
      </div>
    </Modal>
  );
}
