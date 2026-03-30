export function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'たった今';
  if (mins < 60) return `${mins}分前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}時間前`;
  return `${Math.floor(hrs / 24)}日前`;
}

export function formatDuration(startIso?: string, closeIso?: string): string {
  if (!startIso) return '';
  const end = closeIso ? new Date(closeIso) : new Date();
  const secs = Math.floor((end.getTime() - new Date(startIso).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatNextRun(iso: string | undefined): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return '間もなく';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}分後`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs < 24) return remMins > 0 ? `${hrs}時間${remMins}分後` : `${hrs}時間後`;
  return `${Math.floor(hrs / 24)}日後`;
}
