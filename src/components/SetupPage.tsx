import { useEffect, useState } from 'react';
import { ArrowUpRight, Copy, Link2, Terminal } from 'lucide-react';
import { api, info, masked, errorMessage as message } from '../types';
import type { Account, Model } from '../types';
import { Brand } from './ui';

export function SetupPage({
  baseUrl,
  accounts,
  connected,
  notify,
}: {
  baseUrl: string;
  accounts: Account[];
  connected: boolean;
  notify: (text: string, error?: boolean) => void;
}) {
  const [client, setClient] = useState('claude');
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [clientKey, setClientKey] = useState('');
  const [modelAccount, setModelAccount] = useState('');
  useEffect(() => {
    let cancelled = false;
    const account =
      accounts.find((a) => a.id === modelAccount) ||
      accounts.find(
        (a) =>
          a.provider === (client === 'claude' ? 'claude' : 'codex') &&
          !a.disabled,
      ) ||
      accounts.find((a) => !a.disabled);
    if (!connected) {
      const values =
        client === 'claude'
          ? [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet' }]
          : [{ id: 'gpt-5.4', name: 'GPT-5.4' }];
      setModels(values);
      setModel(values[0].id);
      return;
    }
    if (!account) {
      setModels([]);
      setModel('');
      return;
    }
    setLoading(true);
    setModels([]);
    setModel('');
    api<{ models: Model[] }>(
      `/models?account=${encodeURIComponent(account.id)}`,
    )
      .then((result) => {
        if (!cancelled) {
          setModels(result.models);
          setModel(result.models[0]?.id || '');
        }
      })
      .catch((error) => {
        if (!cancelled) notify(message(error), true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, connected, accounts, modelAccount, notify]);
  const q = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
  const key = clientKey || 'YOUR_PROXY_API_KEY';
  const selectedModel = model || 'YOUR_MODEL_ID';
  const snippet =
    client === 'claude'
      ? `export ANTHROPIC_BASE_URL=${q(baseUrl)}\nexport ANTHROPIC_AUTH_TOKEN=${q(key)}\nexport ANTHROPIC_MODEL=${q(selectedModel)}\n\nclaude`
      : client === 'codex'
        ? `# Add to ~/.codex/config.toml\nmodel = ${JSON.stringify(selectedModel)}\nmodel_provider = "cliproxy"\n\n[model_providers.cliproxy]\nname = "CLIProxyAPI"\nbase_url = ${JSON.stringify(`${baseUrl}/v1`)}\nenv_key = "CLIPROXY_API_KEY"\nwire_api = "responses"\nrequires_openai_auth = false`
        : `curl ${q(`${baseUrl}/v1/chat/completions`)} \\\n  -H ${q(`Authorization: Bearer ${key}`)} \\\n  -H 'Content-Type: application/json' \\\n  -d ${q(JSON.stringify({ model: selectedModel, messages: [{ role: 'user', content: 'Say hello in one sentence.' }] }, null, 2))}`;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify('Copied to clipboard.');
    } catch {
      notify(
        'Clipboard access was blocked. Select and copy the configuration manually.',
        true,
      );
    }
  }
  return (
    <>
      <div className="client-tabs">
        {[
          ['claude', 'Claude Code'],
          ['codex', 'Codex'],
          ['api', 'API / cURL'],
        ].map(([id, label]) => (
          <button
            className={client === id ? 'active' : ''}
            key={id}
            onClick={() => {
              setClient(id);
              setModelAccount('');
            }}
          >
            {id === 'api' ? (
              <Terminal size={20} />
            ) : (
              <Brand provider={id} small />
            )}
            {label}
          </button>
        ))}
      </div>
      <div className="setup-layout">
        <section className="panel">
          <div className="panel-title">
            <h2>Connection settings</h2>
            <Link2 size={21} />
          </div>
          <label>
            API endpoint
            <div className="readonly-input">
              <code>
                {baseUrl}
                {client === 'claude' ? '' : '/v1'}
              </code>
              <button
                className="icon-button"
                onClick={() =>
                  copy(`${baseUrl}${client === 'claude' ? '' : '/v1'}`)
                }
                aria-label="Copy endpoint"
              >
                <Copy size={16} />
              </button>
            </div>
          </label>
          {connected && (
            <label>
              Models from account
              <select
                aria-label="Models from account"
                value={modelAccount}
                onChange={(event) => setModelAccount(event.target.value)}
              >
                <option value="">Select automatically</option>
                {accounts
                  .filter((a) => !a.disabled)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {info(account.provider).name} ·{' '}
                      {masked(account.email || account.name)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Model
            <select
              aria-label="Client model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={loading || !models.length}
            >
              {!models.length && (
                <option value="">
                  {loading ? 'Loading models…' : 'No models available'}
                </option>
              )}
              {models.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name} · {m.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Proxy API key
            <input
              type="password"
              autoComplete="off"
              value={clientKey}
              onChange={(event) => setClientKey(event.target.value)}
              placeholder="Enter a client API key"
            />
          </label>
          <p className="field-help">
            Use a client API key, not the management key.
          </p>
        </section>
        <section className="panel code-panel">
          <div className="panel-title">
            <h2>
              {client === 'codex'
                ? 'Configure Codex'
                : client === 'claude'
                  ? 'Start Claude Code'
                  : 'Test your endpoint'}
            </h2>
            <span className="badge">
              {client === 'codex' ? 'TOML' : 'SHELL'}
            </span>
          </div>
          {client === 'codex' && <p>Add to your existing configuration.</p>}
          <div className="code-block">
            <div>
              <span>
                {client === 'codex' ? '~/.codex/config.toml' : 'Terminal'}
              </span>
              <button className="text-button" onClick={() => copy(snippet)}>
                <Copy size={15} />
                Copy
              </button>
            </div>
            <pre>
              <code>{snippet}</code>
            </pre>
          </div>
          {client === 'codex' && (
            <div className="code-block">
              <div>
                <span>Terminal</span>
                <button
                  className="text-button"
                  onClick={() =>
                    copy(`export CLIPROXY_API_KEY=${q(key)}\ncodex`)
                  }
                >
                  <Copy size={15} />
                  Copy
                </button>
              </div>
              <pre>
                <code>{`export CLIPROXY_API_KEY=${q(key)}\ncodex`}</code>
              </pre>
            </div>
          )}
          <a
            className="help-link"
            href={
              client === 'codex'
                ? 'https://developers.openai.com/codex/config-reference/'
                : 'https://help.router-for.me/agent-client/claude-code'
            }
            target="_blank"
            rel="noreferrer"
          >
            Read the setup documentation
            <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
    </>
  );
}
