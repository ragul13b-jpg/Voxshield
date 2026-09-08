// Base URL for the backend API. In local development this is left empty so
// requests go through Vite's dev proxy (see vite.config.js) to
// http://127.0.0.1:8000. For a production build, set VITE_API_BASE_URL
// (e.g. VITE_API_BASE_URL=https://api.example.com) and the app will call
// that host directly instead of relying on a dev-only proxy.
const BASE = import.meta.env.VITE_API_BASE_URL || '';

async function safeFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    // fetch() itself throws (network down, backend unreachable, CORS
    // rejected) rather than resolving with a bad status - normalize that
    // into the same kind of Error the rest of the app already handles.
    throw new Error('Could not reach the VoxShield backend. Check that it is running and reachable.');
  }
  return handle(res);
}

async function handle(res) {
  if (!res.ok) {
    let detail = res.statusText || `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // response wasn't JSON (e.g. a raw 502 from a proxy) - keep the status text
    }
    throw new Error(detail);
  }
  return res.json();
}

function appendMeta(form, { context, profileId, language, sourceLabel, sourceTag } = {}) {
  if (context) form.append('context', JSON.stringify(context));
  if (profileId) form.append('profile_id', profileId);
  if (language) form.append('language', language);
  if (sourceLabel) form.append('source_label', sourceLabel);
  if (sourceTag) form.append('source_tag', sourceTag);
}

export async function checkHealth() {
  return safeFetch(`${BASE}/health`);
}

export async function analyzeUpload(file, meta) {
  const form = new FormData();
  form.append('file', file);
  appendMeta(form, meta);
  return safeFetch(`${BASE}/api/analyze`, { method: 'POST', body: form });
}

export async function analyzeRecording(blob, meta, filename = 'recording.wav') {
  const form = new FormData();
  form.append('file', blob, filename);
  appendMeta(form, meta);
  return safeFetch(`${BASE}/api/analyze-record`, { method: 'POST', body: form });
}

export async function analyzeChunk(blob, chunkIndex) {
  const form = new FormData();
  form.append('file', blob, `chunk-${chunkIndex}.wav`);
  return safeFetch(`${BASE}/api/analyze-chunk?chunk_index=${chunkIndex}`, { method: 'POST', body: form });
}

export async function analyzeRecordFinal(blob, meta, filename = 'call-recording.wav') {
  return analyzeRecording(blob, meta, filename);
}

export async function getDemoSamples() {
  return safeFetch(`${BASE}/api/demo-samples`);
}

export async function analyzeDemo(key, meta) {
  const form = new FormData();
  appendMeta(form, meta);
  return safeFetch(`${BASE}/api/demo?key=${encodeURIComponent(key)}`, { method: 'POST', body: form });
}

export async function getHistory(limit = 50) {
  return safeFetch(`${BASE}/api/history?limit=${limit}`);
}

export async function getAnalysis(id) {
  return safeFetch(`${BASE}/api/analysis/${encodeURIComponent(id)}`);
}

export async function verifyIdentity(analysisId, verified) {
  const form = new FormData();
  form.append('analysis_id', analysisId);
  form.append('verified', verified ? 'true' : 'false');
  return safeFetch(`${BASE}/api/verify`, { method: 'POST', body: form });
}

export async function checkTransaction(analysisId, amountInr) {
  const form = new FormData();
  form.append('analysis_id', analysisId);
  if (amountInr != null) form.append('amount_inr', String(amountInr));
  return safeFetch(`${BASE}/api/transaction/check`, { method: 'POST', body: form });
}

export async function enrollProfile(blob, name, filename = 'reference.wav') {
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('name', name);
  return safeFetch(`${BASE}/api/enroll-profile`, { method: 'POST', body: form });
}

export async function listProfiles() {
  return safeFetch(`${BASE}/api/profiles`);
}

export async function getLanguages() {
  return safeFetch(`${BASE}/api/languages`);
}

export async function getPrivacyInfo() {
  return safeFetch(`${BASE}/api/privacy`);
}

export async function getTranscriptionStatus() {
  return safeFetch(`${BASE}/api/transcription-status`);
}
