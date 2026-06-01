export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }

  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} 天`;
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks} 周`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} 月`;
  }

  return `${Math.floor(days / 365)} 年`;
}
