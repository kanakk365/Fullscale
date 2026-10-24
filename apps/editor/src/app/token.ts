// The studio token. "fullscale serve" prints a link with the token after "#", which never
// leaves the browser; the editor keeps it for this tab and removes it from the address bar.
const KEY = 'fullscale-token';

export function takeToken(): string | null {
  const match = /(?:^|[#&])token=([0-9a-f]{64})/.exec(location.hash);
  if (match) {
    sessionStorage.setItem(KEY, match[1]!);
    history.replaceState(null, '', location.pathname + location.search);
    return match[1]!;
  }
  return sessionStorage.getItem(KEY);
}

export function saveToken(token: string): void {
  sessionStorage.setItem(KEY, token.trim());
}

/** Headers for fetching the studio's files (models, pictures). */
export function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem(KEY);
  return token ? { authorization: `Bearer ${token}` } : {};
}
