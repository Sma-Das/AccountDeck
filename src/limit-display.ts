import type { Account, Window } from './types';

export type AccountLimitDisplay = { hidden: boolean; windows: string[] };
export type LimitDisplay = {
  providers: string[];
  accounts: Record<string, AccountLimitDisplay>;
};
export const emptyLimitDisplay: LimitDisplay = { providers: [], accounts: {} };

export function readLimitDisplay(key: string): LimitDisplay {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (!value || !Array.isArray(value.providers) || !value.accounts)
      return emptyLimitDisplay;
    return {
      providers: value.providers.filter(
        (id: unknown) => typeof id === 'string',
      ),
      accounts: Object.fromEntries(
        Object.entries(value.accounts).filter(([, entry]) => {
          const setting = entry as AccountLimitDisplay | null;
          return (
            setting &&
            typeof setting.hidden === 'boolean' &&
            Array.isArray(setting.windows) &&
            setting.windows.every((id) => typeof id === 'string')
          );
        }),
      ) as LimitDisplay['accounts'],
    };
  } catch {
    return emptyLimitDisplay;
  }
}

export function limitsHidden(account: Account, display: LimitDisplay) {
  return (
    display.providers.includes(account.provider) ||
    !!display.accounts[account.id]?.hidden
  );
}

export function visibleWindows(
  account: Account,
  display: LimitDisplay,
): Window[] {
  if (limitsHidden(account, display)) return [];
  const hidden = display.accounts[account.id]?.windows || [];
  return (account.quota?.windows || []).filter(
    (window) => !hidden.includes(window.id),
  );
}

export function displayWindow(account: Account, display: LimitDisplay) {
  const windows = visibleWindows(account, display);
  return (
    windows.find(
      (window) => window.id === 'seven_day' || window.id === 'week',
    ) ||
    windows.find((window) => window.periodHours >= 168) ||
    windows[0]
  );
}
