// status.js — 体检: Edge 调试端口是否通 / 是否找到 ChatGPT 页面 / 是否登录 / 对话计数
// 用法: node status.js
// 退出码: 0=就绪  1=未就绪(见 kind 字段)  3=致命错误
const { withPage, httpGetJson } = require('./cdp');

const EXTRACT_FN = `(() => {
  const stopSels = ['button[data-testid="stop-button"]','button[aria-label="Stop generating"]','button[aria-label="Stop streaming"]','button[aria-label*="Stop"]','button[aria-label*="停止"]'];
  let generating = false;
  for (const s of stopSels) { const el = document.querySelector(s); if (el && el.offsetParent !== null) { generating = true; break; } }
  const asst = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const usr  = [...document.querySelectorAll('[data-message-author-role="user"]')];
  const lastA = asst[asst.length - 1];
  const composer = document.querySelector('#prompt-textarea');
  // 登录判定: 存在输入框 且 页面上没有登录/注册按钮
  const loginBtn = [...document.querySelectorAll('button,a')].some((b) => {
    const t = (b.innerText || '').trim();
    return /^(Log in|登录|Sign up|注册)$/.test(t) && b.offsetParent !== null;
  });
  return {
    url: location.href,
    title: document.title,
    hasComposer: !!composer,
    loggedIn: !!composer && !loginBtn,
    generating,
    assistantCount: asst.length,
    userCount: usr.length,
    composerLen: composer ? (composer.innerText || '').trim().length : -1,
    lastAssistantHead: lastA ? (lastA.innerText || '').trim().slice(0, 120) : '',
  };
})()`;

(async () => {
  let version;
  try {
    version = await httpGetJson('http://127.0.0.1:9222/json/version', 5000);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, kind: 'no-cdp', hint: 'Edge 调试实例未运行，请用户双击桌面「ChatGPT 协作」快捷方式', detail: e.message }));
    process.exit(1);
  }

  let snap;
  try {
    snap = await withPage((cdp) => cdp.eval(EXTRACT_FN));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, kind: 'no-chatgpt-page', browser: version.Browser, hint: 'CDP 已通但没找到 chatgpt.com 页面，请在 Edge 里打开 chatgpt.com', detail: e.message }));
    process.exit(1);
  }

  if (!snap.loggedIn) {
    console.log(JSON.stringify({ ok: false, kind: 'not-logged-in', browser: version.Browser, url: snap.url, hint: '请在 Edge 窗口里登录 ChatGPT' }));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true, browser: version.Browser, url: snap.url, title: snap.title,
    loggedIn: true, generating: snap.generating,
    userCount: snap.userCount, assistantCount: snap.assistantCount,
    composerLen: snap.composerLen, lastAssistantHead: snap.lastAssistantHead,
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(JSON.stringify({ ok: false, kind: 'fatal', detail: e.message })); process.exit(3); });
