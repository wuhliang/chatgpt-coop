// cdp.js — 极简 Chrome DevTools Protocol 客户端（Node 22 内置 WebSocket，无第三方依赖）
// 通过 Edge 的远程调试端口（默认 9222）直连页面目标
const http = require('http');

function httpGetJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json from ' + url + ': ' + data.slice(0, 200))); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('http timeout: ' + url)));
    req.on('error', reject);
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.closed = false;
    ws.onmessage = (ev) => {
      let msg;
      const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.onclose = () => { this.closed = true; };
    ws.onerror = () => { this.closed = true; };
  }

  send(method, params = {}, timeoutMs = 15000) {
    if (this.closed) return Promise.reject(new Error('ws closed'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('cdp 超时: ' + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('page eval exception: ' + (d.exception && d.exception.description || d.text));
    }
    return r.result ? r.result.value : undefined;
  }

  close() { try { this.ws.close(); } catch {} }
}

// 找到 chatgpt 页面目标并返回 { cdp, target }
async function findPage(urlPattern = 'chatgpt.com|chat.openai.com') {
  const list = await httpGetJson('http://127.0.0.1:9222/json/list');
  const re = new RegExp(urlPattern);
  const page = list.find((t) => t.type === 'page' && re.test(t.url || ''));
  if (!page) {
    const urls = list.filter((t) => t.type === 'page').map((t) => t.url).join(' | ');
    throw new Error('未找到 chatgpt 页面目标。当前页面: ' + (urls || '(无)'));
  }
  return page;
}

// 打开到该页面的 CDP 连接（页面级 WebSocket，无需 sessionId）
async function connectPage(urlPattern) {
  const page = await findPage(urlPattern);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws connect timeout')), 8000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error('ws error: ' + (e.message || 'unknown'))); };
  });
  const cdp = new CDP(ws);
  cdp.target = page;
  return cdp;
}

// 便捷封装：连上页面 -> 执行 fn(cdp) -> 关闭（带整体超时，防止 CDP 调用挂死拖垮循环）
async function withPage(fn, urlPattern, timeoutMs = 25000) {
  const cdp = await connectPage(urlPattern);
  let timer;
  try {
    return await Promise.race([
      fn(cdp),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('withPage 整体超时 ' + timeoutMs + 'ms')), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
    cdp.close();
  }
}

module.exports = { CDP, connectPage, findPage, withPage, httpGetJson };
