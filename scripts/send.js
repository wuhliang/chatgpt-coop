// send.js — 向 ChatGPT 对话框输入文本并发送
// 用法:
//   node send.js --file <文本文件>            实际发送
//   node send.js --file <文本文件> --dry-run  只输入+截图+清空，不发送(用于测试)
const fs = require('fs');
const path = require('path');
const { withPage } = require('./cdp');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const fileIdx = args.indexOf('--file');
if (fileIdx < 0) { console.error('缺少 --file 参数'); process.exit(1); }
const text = fs.readFileSync(path.resolve(args[fileIdx + 1]), 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
if (!text.trim()) { console.error('文本为空'); process.exit(1); }
console.log('[send] 待发送文本长度:', text.length, '| dry-run:', DRY);

// 生成中检测 + 等待完成
const WAIT_IDLE_FN = `(() => {
  const stopSels = ['button[data-testid="stop-button"]','button[aria-label="Stop generating"]','button[aria-label="Stop streaming"]','button[aria-label*="Stop"]','button[aria-label*="停止"]','button[aria-label*="停止生成"]'];
  for (const s of stopSels) { const el = document.querySelector(s); if (el && el.offsetParent !== null) return true; }
  return false;
})()`;

// 输入文本: 聚焦 -> (有内容则 Ctrl+A 全选) -> 逐行 insertText, 行间 Shift+Enter
const INSERT_FN = `(() => {
  const el = document.querySelector('#prompt-textarea');
  if (!el) return { ok: false, error: 'composer #prompt-textarea not found' };
  el.focus();
  const hasText = (el.innerText || '').trim().length > 0;
  if (hasText) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: true, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: true, bubbles: true }));
  }
  const lines = ${JSON.stringify(text.split('\n'))};
  for (let i = 0; i < lines.length; i++) {
    el.focus();
    const okIns = document.execCommand('insertText', false, lines[i]);
    if (!okIns && i === 0) return { ok: false, error: 'insertText 失败(第一次插入即无效)' };
    if (i < lines.length - 1) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true }));
    }
  }
  return { ok: true, composerLen: (el.innerText || '').length, composerHead: (el.innerText || '').slice(0, 60) };
})()`;

const CLEAR_FN = `(() => {
  const el = document.querySelector('#prompt-textarea');
  if (!el) return { ok: false };
  el.focus();
  const sel = window.getSelection();
  sel.selectAllChildren(el);
  sel.deleteFromDocument();
  return { ok: true, composerLen: (el.innerText || '').length };
})()`;

const SEND_FN = `(() => {
  const sels = ['button[data-testid="send-button"]','button[aria-label="Send prompt"]','button[aria-label*="Send"]','button[aria-label*="发送"]','#composer-submit-button'];
  for (const s of sels) {
    const b = document.querySelector(s);
    if (b && !b.disabled && b.offsetParent !== null) { b.click(); return { ok: true, via: 'button ' + s }; }
  }
  const el = document.querySelector('#prompt-textarea');
  if (el) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    return { ok: true, via: 'enter-key' };
  }
  return { ok: false, error: '找不到发送按钮也无输入框' };
})()`;

const USER_COUNT_FN = `document.querySelectorAll('[data-message-author-role="user"]').length`;
const COMPOSER_LEN_FN = `(() => { const el = document.querySelector('#prompt-textarea'); return el ? (el.innerText||'').trim().length : -1; })()`;

(async () => {
  // 1. 等待 ChatGPT 生成完成(最多 3 分钟)
  let waited = 0;
  while (waited < 180) {
    const busy = await withPage((cdp) => cdp.eval(WAIT_IDLE_FN));
    if (!busy) break;
    console.log('[send] ChatGPT 正在生成中，等待...', waited, 's');
    await new Promise((r) => setTimeout(r, 5000));
    waited += 5;
  }

  const before = await withPage(async (cdp) => ({
    userCount: await cdp.eval(USER_COUNT_FN),
    composerLen: await cdp.eval(COMPOSER_LEN_FN),
  }));
  console.log('[send] 发送前: user 消息数 =', before.userCount, '| 输入框长度 =', before.composerLen);

  // 2. 输入文本
  const ins = await withPage((cdp) => cdp.eval(INSERT_FN));
  if (!ins.ok) { console.error('[send] 输入失败:', ins.error); process.exit(1); }
  console.log('[send] 已输入, 输入框内容长度 =', ins.composerLen);

  // 3. 截图留证
  try {
    const shot = await withPage((cdp) => cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }));
    fs.writeFileSync(path.join(__dirname, 'screenshot-insert.jpg'), Buffer.from(shot.data, 'base64'));
    console.log('[send] 已保存输入后截图: screenshot-insert.jpg');
  } catch (e) { console.log('[send] 截图失败(不影响发送):', e.message); }

  if (DRY) {
    // 探测发送按钮选择器(不点击)
    const probe = await withPage((cdp) => cdp.eval(`(() => {
      const sels = ['button[data-testid="send-button"]','button[aria-label="Send prompt"]','button[aria-label*="Send"]','button[aria-label*="发送"]','#composer-submit-button'];
      const found = [];
      for (const s of sels) { const b = document.querySelector(s); if (b) found.push(s + ' visible=' + (b.offsetParent !== null) + ' disabled=' + b.disabled); }
      return found;
    })()`));
    console.log('[send] 发送按钮探测:', JSON.stringify(probe));
    await withPage((cdp) => cdp.eval(CLEAR_FN));
    console.log('[send] dry-run 模式: 已清空输入框，未发送');
    process.exit(0);
  }

  // 4. 发送
  const snd = await withPage((cdp) => cdp.eval(SEND_FN));
  console.log('[send] 发送动作:', JSON.stringify(snd));

  // 5. 验证: 等 4 秒后检查 user 消息数是否 +1、输入框是否清空
  await new Promise((r) => setTimeout(r, 4000));
  const after = await withPage(async (cdp) => ({
    userCount: await cdp.eval(USER_COUNT_FN),
    composerLen: await cdp.eval(COMPOSER_LEN_FN),
  }));
  const ok = after.userCount === before.userCount + 1;
  console.log('[send] 发送后: user 消息数 =', after.userCount, '| 输入框长度 =', after.composerLen, '| 结果:', ok ? '成功' : '未确认(请人工检查)');
  process.exit(ok ? 0 : 4);
})().catch((e) => { console.error('[send] 致命错误:', e.message); process.exit(3); });
