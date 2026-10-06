import { useState } from 'react';
import { info } from '../types';
import type { LimitDisplay } from '../limit-display';
import { Brand, Modal } from './ui';

export function LimitDisplayModal({
  providers,
  display,
  save,
  close,
}: {
  providers: string[];
  display: LimitDisplay;
  save: (display: LimitDisplay) => void;
  close: () => void;
}) {
  const [hidden, setHidden] = useState(display.providers);
  return (
    <Modal title="Limit display" close={close}>
      <p className="field-help">
        Hide limits for providers where you have frontier or unlimited access.
        Manage an account to hide individual model limits. Saved in this
        browser.
      </p>
      <div className="limit-options">
        {providers.map((provider) => (
          <label className="limit-option" key={provider}>
            <Brand provider={provider} small />
            <span>Hide {info(provider).name} limits</span>
            <input
              type="checkbox"
              checked={hidden.includes(provider)}
              onChange={(event) =>
                setHidden(
                  event.target.checked
                    ? [...hidden, provider]
                    : hidden.filter((id) => id !== provider),
                )
              }
            />
          </label>
        ))}
      </div>
      <div className="modal-actions">
        <button className="secondary" onClick={close}>
          Cancel
        </button>
        <button
          className="primary"
          onClick={() => save({ ...display, providers: hidden })}
        >
          Save display
        </button>
      </div>
    </Modal>
  );
}
