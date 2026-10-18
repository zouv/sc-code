const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isAuthorizedUpgrade } = require('./transport-auth.cjs');
const token = crypto.randomUUID();
function request(url=`/?token=${token}`, origin='https://tauri.localhost') {
  return { url, headers: { origin, host:'127.0.0.1:1234', upgrade:'websocket', 'sec-websocket-version':'13' } };
}
test('accepts native credential and supported webview origins',()=>{
  assert.equal(isAuthorizedUpgrade(request(), token), true);
  assert.equal(isAuthorizedUpgrade(request(undefined,'http://localhost:1420'), token), true);
});
test('rejects absent, invalid and similar credentials',()=>{
  for(const url of ['/', '/?token=bad', `/?token=${token.slice(0,-1)}x`]) assert.equal(isAuthorizedUpgrade(request(url),token),false);
});
test('rejects arbitrary web origins, host rebinding and non-WebSocket upgrades',()=>{
  assert.equal(isAuthorizedUpgrade(request(undefined,'https://evil.example'),token),false);
  const req=request(); req.headers.host='evil.example'; assert.equal(isAuthorizedUpgrade(req,token),false);
  const req2=request(); req2.headers.upgrade='h2c'; assert.equal(isAuthorizedUpgrade(req2,token),false);
});
