export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Compares "1.2.3" style versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a, b) {
  const pa = String(a || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
