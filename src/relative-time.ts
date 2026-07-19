const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

/**
 * Formats a creation timestamp using day and hour units only.
 * Future timestamps are treated as clock skew and clamped to zero.
 */
export function formatRelativeTime(
  createdAt: number,
  now: number = Date.now(),
): string {
  const elapsed = Math.max(0, now - createdAt);
  const days = Math.floor(elapsed / DAY);
  const hours = Math.floor((elapsed % DAY) / HOUR);
  return `${days}d ${hours}h`;
}
