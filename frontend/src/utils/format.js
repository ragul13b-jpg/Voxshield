export function riskColor(level) {
  switch (level) {
    case 'HIGH':
      return 'var(--signal-red)';
    case 'SUSPICIOUS':
      return 'var(--signal-amber)';
    case 'LOW':
    default:
      return 'var(--signal-green)';
  }
}

export function riskDimColor(level) {
  switch (level) {
    case 'HIGH':
      return 'var(--signal-red-dim)';
    case 'SUSPICIOUS':
      return 'var(--signal-amber-dim)';
    case 'LOW':
    default:
      return 'var(--signal-green-dim)';
  }
}

export function severityColor(sev) {
  switch (sev) {
    case 'HIGH':
      return 'var(--signal-red)';
    case 'MEDIUM':
      return 'var(--signal-amber)';
    default:
      return 'var(--signal-green)';
  }
}

export function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatPct(x) {
  return `${Math.round(x * 100)}%`;
}
