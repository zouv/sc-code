'use strict';
const crypto = require('node:crypto');
// Actual WebView origins only; a local malicious website is not a trusted client.
const ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420']);
function isAuthorizedUpgrade(request, expectedToken) {
  if (!expectedToken || typeof request.url !== 'string') return false;
  const origin = request.headers.origin;
  if (origin && !ORIGINS.has(origin)) return false;
  if (!['localhost', '127.0.0.1'].includes(String(request.headers.host || '').split(':')[0])) return false;
  if (String(request.headers.upgrade || '').toLowerCase() !== 'websocket') return false;
  if (request.headers['sec-websocket-version'] !== '13') return false;
  let token;
  try { token = new URL(request.url, 'http://127.0.0.1').searchParams.get('token'); } catch { return false; }
  if (!token) return false;
  const actual = Buffer.from(token); const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
module.exports = { isAuthorizedUpgrade };
