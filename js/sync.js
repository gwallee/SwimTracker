// SwimTracker sync: keeps the store in one JSON file in a (private) GitHub repo, using a
// fine-grained token the user enters on each device. The token is kept only in this browser.
// Read-only tokens can load; read/write tokens also save.
(function (root) {
  const KEY = 'swimtracker.sync';
  const API = 'https://api.github.com';
  const DEFAULTS = { owner: 'gwallee', repo: 'SwimTracker-data', branch: 'main', path: 'store.json', token: '' };

  function getConfig() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return Object.assign({}, DEFAULTS); }
  }
  function setConfig(c) {
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
  }
  const enabled = c => !!(c && c.token && c.owner && c.repo);

  async function gh(c, method, path, body) {
    const res = await fetch(API + path, {
      method, cache: 'no-store',
      headers: Object.assign({ Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const e = new Error(explain(res.status, data && data.message));
      e.status = res.status; throw e;
    }
    return data;
  }
  function explain(status, msg) {
    if (status === 401) return 'The token was not accepted (expired or mistyped).';
    if (status === 403) return 'The token does not have access to this repository' + (msg ? ' (' + msg + ')' : '') + '.';
    if (status === 404) return 'Repository or file not found, or the token cannot see it.';
    if (status === 409 || status === 422) return 'The synced copy changed at the same time; try again.';
    return 'GitHub returned ' + status + (msg ? ': ' + msg : '');
  }
  const repoPath = c => '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo);
  const filePath = c => repoPath(c) + '/contents/' + c.path.split('/').map(encodeURIComponent).join('/');

  // UTF-8 safe base64 for the contents API.
  function toB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromB64(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
  }

  // Checks the token: can it see the repo, and can it write?
  async function test(c) {
    const r = await gh(c, 'GET', repoPath(c));
    return { canWrite: !!(r.permissions && (r.permissions.push || r.permissions.admin)), private: !!r.private, fullName: r.full_name };
  }

  // Returns { store, sha } of the synced file; store is null when the file does not exist yet.
  async function pull(c) {
    try {
      const f = await gh(c, 'GET', filePath(c) + '?ref=' + encodeURIComponent(c.branch));
      return { store: JSON.parse(fromB64(f.content)), sha: f.sha };
    } catch (e) {
      if (e.status === 404) return { store: null, sha: null };
      throw e;
    }
  }

  // Writes the store (sha = the version it was based on; null to create the file).
  async function push(c, store, sha, message) {
    const body = { message: message || 'SwimTracker update', content: toB64(JSON.stringify(store)), branch: c.branch };
    if (sha) body.sha = sha;
    try {
      return (await gh(c, 'PUT', filePath(c), body)).content.sha;
    } catch (e) {
      // A brand-new empty repo has no branch yet: create the first commit on its default branch.
      if (sha || (e.status !== 404 && e.status !== 422)) throw e;
      delete body.branch;
      return (await gh(c, 'PUT', filePath(c), body)).content.sha;
    }
  }

  const api = { getConfig, setConfig, enabled, test, pull, push, DEFAULTS };
  root.SwimSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
