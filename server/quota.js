const percent = (value) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value))
    ? Math.max(0, Math.min(100, Number(value)))
    : null;

export function resetTime(value, offset, now = Date.now()) {
  let timestamp =
    typeof value === 'number'
      ? value < 1e12
        ? value * 1000
        : value
      : Date.parse(value);
  if (
    !Number.isFinite(timestamp) &&
    Number.isFinite(Number(offset)) &&
    offset != null
  )
    timestamp = now + Number(offset) * 1000;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function claudeCreditModels(plan) {
  return typeof plan === 'string' && /^(?:claude[_ -])?pro$/i.test(plan.trim())
    ? ['Fable']
    : [];
}

export function normalizeQuota(
  provider,
  payload,
  now = Date.now(),
  accountPlan = null,
) {
  const plan = payload.plan_type ?? payload.planType ?? accountPlan;
  const creditModels = provider === 'claude' ? claudeCreditModels(plan) : [];
  const windows = [];
  const add = (id, label, used, reset, periodHours) =>
    windows.push({
      id,
      label,
      remaining: percent(used) === null ? null : 100 - percent(used),
      resetsAt: reset,
      periodHours,
    });
  if (provider === 'claude') {
    const labels = {
      five_hour: '5-hour limit',
      seven_day: '7-day limit',
      seven_day_sonnet: '7-day Sonnet',
      seven_day_opus: '7-day Opus',
      seven_day_oauth_apps: '7-day OAuth apps',
      seven_day_cowork: '7-day Cowork',
      iguana_necktie: 'Fable limit',
    };
    const scoped = Array.isArray(payload.limits) ? payload.limits : [];
    const fableScope = scoped.find((limit) =>
      /^fable\b/i.test(limit?.scope?.model?.display_name || ''),
    );
    for (const [key, label] of Object.entries(labels)) {
      const window = payload[key];
      const fable = key === 'iguana_necktie';
      if (fable && (creditModels.length || fableScope?.is_active === false))
        continue;
      if (window && typeof window === 'object' && window.is_active !== false)
        add(
          key,
          fable && fableScope?.kind === 'weekly_scoped' ? '7-day Fable' : label,
          window.utilization,
          resetTime(window.resets_at),
          key === 'five_hour'
            ? 5
            : fable && fableScope?.kind !== 'weekly_scoped'
              ? 0
              : 168,
        );
    }
    for (const [index, limit] of (Array.isArray(payload.limits)
      ? payload.limits
      : []
    ).entries()) {
      if (limit?.kind === 'weekly_scoped' && limit.is_active !== false) {
        const name = limit.scope?.model?.display_name || 'Model';
        if (creditModels.length && /^fable\b/i.test(name)) continue;
        if (windows.some((w) => w.label === `7-day ${name}`)) continue;
        add(
          `scoped-${index}`,
          `7-day ${name}`,
          limit.percent,
          resetTime(limit.resets_at),
          168,
        );
      }
    }
  } else if (provider === 'codex') {
    const limit = payload.rate_limit ?? payload.rateLimit;
    for (const [key, fallback, fallbackHours] of [
      ['primary_window', '5-hour limit', 5],
      ['secondary_window', '7-day limit', 168],
    ]) {
      const window =
        limit?.[key] ??
        limit?.[key === 'primary_window' ? 'primaryWindow' : 'secondaryWindow'];
      if (!window) continue;
      const seconds = Number(
        window.limit_window_seconds ?? window.limitWindowSeconds,
      );
      const hours = seconds > 0 ? seconds / 3600 : fallbackHours;
      const label =
        seconds > 0
          ? hours === 5
            ? '5-hour limit'
            : hours === 168
              ? '7-day limit'
              : hours >= 672 && hours <= 744
                ? 'Monthly limit'
                : `${hours}-hour limit`
          : fallback;
      const used = window.used_percent ?? window.usedPercent;
      add(
        key,
        label,
        used,
        resetTime(
          window.reset_at ?? window.resetAt,
          window.reset_after_seconds ?? window.resetAfterSeconds,
          now,
        ),
        hours,
      );
    }
  } else if (provider === 'xai') {
    const config = payload.config;
    if (config && config.creditUsagePercent != null) {
      const period = config.currentPeriod;
      const kind = period?.type?.replace(/^USAGE_PERIOD_TYPE_/, '');
      add(
        'subscription',
        kind === 'WEEKLY'
          ? 'Weekly limit'
          : kind === 'MONTHLY'
            ? 'Monthly limit'
            : 'Subscription limit',
        config.creditUsagePercent,
        resetTime(period?.end),
        kind === 'WEEKLY' ? 168 : kind === 'MONTHLY' ? 720 : 0,
      );
    }
  }
  return {
    windows,
    plan,
    ...(provider === 'claude' ? { creditModels } : {}),
    updatedAt: new Date(now).toISOString(),
    error: windows.length
      ? null
      : provider === 'xai'
        ? 'Grok has not reported a usage percentage yet.'
        : 'The provider returned no quota windows.',
  };
}

export function safeAccount(file) {
  return {
    id: String(file.auth_index || file.id || file.name),
    name: String(file.name || file.id),
    provider: String(file.provider || file.type || 'unknown').toLowerCase(),
    email: file.email || null,
    label: file.label || null,
    plan: file.plan_type || file.id_token?.plan_type || null,
    disabled: !!file.disabled,
    unavailable: !!file.unavailable,
    runtimeOnly: !!file.runtime_only,
    status: file.status || 'unknown',
    priority: Number(file.priority) || 0,
  };
}
