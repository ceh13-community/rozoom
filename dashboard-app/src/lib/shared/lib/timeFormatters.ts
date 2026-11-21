export const getTimeDifference = (isoDate = new Date()) =>
  formatAgeMs(Date.now() - new Date(isoDate).getTime());

/** Age label for a duration in ms: "12s", "3m", "5h", "2d". Negative counts as 0s. */
export const formatAgeMs = (elapsedMs: number) => {
  const diffMs = Math.max(0, elapsedMs);
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays >= 1) {
    return `${diffDays}d`;
  }
  if (diffHours >= 1) {
    return `${diffHours}h`;
  }
  if (diffMinutes >= 1) {
    return `${diffMinutes}m`;
  }
  return `${diffSeconds}s`;
};

export const timeAgo = (timestamp: Date) => {
  const now = new Date();
  const past = new Date(timestamp);
  const diffMs = now.getTime() - past.getTime();

  // const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(diffMs / (1000 * 60)) % 60;
  const hours = Math.floor(diffMs / (1000 * 60 * 60)) % 24;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  // if (seconds) parts.push(`${seconds}s`);

  return parts.length ? `${parts.join(" ")} ago` : "just now";
};
