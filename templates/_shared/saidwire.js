// Small Saidwire client for Node 20.12+. Server side only: the API key must never reach a browser.

export const LIMITS = { maxFileBytes: 100 * 1024 * 1024, maxFileSeconds: 3600, fileRequestsAtOnce: 2, liveStreamsAtOnce: 4 };

export function loadEnv(path = '.env') {
  try { process.loadEnvFile(path); } catch { /* no .env file: use the real environment */ }
}

export function getConfig(env = process.env) {
  const apiKey = (env.SAIDWIRE_API_KEY || '').trim();
  const baseUrl = (env.SAIDWIRE_BASE_URL || 'https://api.saidwire.com').trim().replace(/\/+$/, '');
  if (!apiKey) throw new SaidwireError('SAIDWIRE_API_KEY is not set. Put it in .env. Get a key at https://saidwire.com/dev', { status: 0, code: 'NO_KEY' });
  return { apiKey, baseUrl };
}

export function liveUrl(baseUrl, params = {}) {
  const u = new URL('/v1/listen', baseUrl.replace(/^http/, 'ws'));
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

const HELP = {
  401: 'The API key was refused. Check SAIDWIRE_API_KEY. Get a key at https://saidwire.com/dev',
  402: 'This key has no audio hours left. Add a card at https://saidwire.com/dev',
  403: 'This key was revoked. Create a new one at https://saidwire.com/dev',
  413: 'The file is over the limit of 100 MB or 60 minutes per request. Split it first.',
};

export const explainStatus = (status) => HELP[status]
  || (status === 429 ? 'Too many streams or requests at once on this key. Try again shortly.' : `Saidwire refused the request (HTTP ${status}).`);

export class SaidwireError extends Error {
  constructor(message, { status, code, requestId, retryAfter } = {}) {
    super(message);
    this.name = 'SaidwireError';
    Object.assign(this, { status, code, requestId, retryAfter });
  }
}

async function toError(res) {
  const text = await res.text().catch(() => '');
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  const code = body.err_code || body.error?.code || `HTTP_${res.status}`;
  const detail = body.err_msg || body.error?.message || text.slice(0, 200);
  const quota = code === 'insufficient_quota' || code === 'QUOTA_EXCEEDED';
  const message = (quota ? HELP[402] : HELP[res.status]) || detail || `Saidwire returned HTTP ${res.status}`;
  const header = res.headers.get('retry-after');
  const retryAfter = header === null || Number.isNaN(Number(header)) ? undefined : Number(header);
  return new SaidwireError(message, { status: res.status, code, retryAfter, requestId: res.headers.get('x-request-id') || body.request_id });
}

function canRetry(err) {
  if (err.code === 'insufficient_quota' || err.code === 'QUOTA_EXCEEDED') return false;
  return err.status === 429 || err.status >= 500;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with the waits the API asks for: 429 and 5xx carry Retry-After. Nothing else is worth retrying.
async function send(url, init, { tries = 4, maxWaitSeconds = 60 } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try { res = await fetch(url, init); } catch (e) {
      if (attempt >= tries) throw new SaidwireError(`Could not reach Saidwire: ${e.cause?.code || e.message}`, { status: 0, code: 'NETWORK' });
      await sleep(1000 * attempt);
      continue;
    }
    if (res.ok) return res;
    const err = await toError(res);
    if (!canRetry(err) || attempt >= tries) throw err;
    await sleep(Math.min(err.retryAfter ?? attempt, maxWaitSeconds) * 1000);
  }
}

// POST /v1/listen with raw audio bytes. Waits for the whole result. Returns the parsed JSON.
export async function transcribeBytes(bytes, { contentType = 'application/octet-stream', params = {}, config = getConfig(), retry } = {}) {
  const u = new URL('/v1/listen', config.baseUrl);
  for (const [k, v] of Object.entries({ punctuate: true, ...params })) u.searchParams.set(k, String(v));
  const res = await send(u, { method: 'POST', headers: { Authorization: `Token ${config.apiKey}`, 'Content-Type': contentType }, body: bytes }, retry);
  return res.json();
}

// POST /v1/audio/transcriptions, for ready-made subtitle or text output. format: json, text, verbose_json, srt, vtt.
export async function transcribeToFormat(bytes, { filename = 'audio.mp3', format = 'srt', config = getConfig(), retry } = {}) {
  const form = new FormData();
  form.set('file', new Blob([bytes]), filename);
  form.set('model', 'saidwire-en');
  form.set('response_format', format);
  const res = await send(new URL('/v1/audio/transcriptions', config.baseUrl), { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body: form }, retry);
  return format === 'json' || format === 'verbose_json' ? res.json() : res.text();
}

export function firstAlternative(result) {
  return result?.results?.channels?.[0]?.alternatives?.[0] ?? { transcript: '', words: [] };
}

