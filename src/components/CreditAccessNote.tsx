import type { Account } from '../types';

export function CreditAccessNote({ account }: { account: Account }) {
  const models = account.quota?.creditModels ?? account.creditModels ?? [];
  if (!models.length) return null;
  return (
    <p className="credit-access">
      {models.join(', ')} uses usage credits on{' '}
      {account.quota?.plan || account.plan || 'this plan'}.{' '}
      <a
        href="https://claude.ai/settings/usage"
        target="_blank"
        rel="noreferrer"
      >
        View credit balance in Claude ↗
      </a>
    </p>
  );
}
