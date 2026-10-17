// Minimal CDP client for driving a running Kastrava instance and capturing
// preview screenshots. Requires Node >= 22 (global fetch + WebSocket).
'use strict';

const CDP_PORT = process.env.KAS_CDP_PORT || '9444';

async function targets() {
  return await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
}

async function connect() {
  const list = await targets();
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('no page target on :' + CDP_PORT);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  function send(method, params = {}) {
    return new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async function evaljs(expression, awaitPromise = true) {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('eval exception: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async function shot(file) {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
    if (!r.result || !r.result.data) throw new Error('screenshot failed: ' + JSON.stringify(r).slice(0, 300));
    require('fs').writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  }
  return { ws, send, evaljs, shot, close: () => ws.close() };
}

module.exports = { connect, targets };
