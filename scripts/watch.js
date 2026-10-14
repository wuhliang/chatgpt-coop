// watch.js — 监视 ChatGPT 页面，捕获"新的、已生成完毕的"消息
//
// 两种模式:
//   node watch.js                     等待新的【助手(GPT)】完整回复   -> inbox.json { role: 'assistant' }
//   node watch.js --wait-user         等待【用户】在 GPT 输入框发出新消息 -> inbox.json { role: 'user' }
//
// 参数:
//   --timeout <分钟>   默认: 助手模式 12 / 等用户模式 60
//   --interval <秒>    默认 3
//
// 退出码: 0=捕获到(写 inbox.json)  2=超时  3=致命错误
//
// 注意: 后台长任务运行时【绝不要接 | head 等管道】——管道提前退出会 SIGPIPE 杀掉本进程。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withPage } = require('./cdp');

const DIR = __dirname;
const STATE_FILE = path.join(DIR, 'state.json');
const INBOX_FILE = path.join(DIR, 'inbox.json');

const args = process.argv.slice(2);
function argOf(name, dflt) { const i = args.indexOf(name); return i >= 0 ? parseFloat(args[i + 1]) : dflt; }
const WAIT_USER = args.includes('--wait-user');
const TIMEOUT_MIN = argOf('--timeout', WAIT_USER ? 60 : 12);
const INTERVAL_SEC = argOf('--interval', 3);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

// 页面内提取: 最后一条助手/用户消息全文 + 是否生成中 + 计数 + 输入框长度
const EXTRACT_FN = `(() => {
  const stopSels = ['button[data-testid="stop-button"]','button[aria-label="Stop generating"]','button[aria-label="Stop streaming"]','button[aria-label*="Stop"]','button[aria-label*="停止"]'];
  let generating = false;
  for (const s of stopSels) { const el = document.querySelector(s); if (el && el.offsetParent !== null) { generating = true; break; } }
  const asst = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const usr  = [...document.querySelectorAll('[data-message-author-role="user"]')];
  const lastA = asst[asst.length - 1];
  const lastU = usr[usr.length - 1];
  const composer = document.querySelector('#prompt-textarea');
  return {
    assistantText: lastA ? (lastA.innerText || '').trim() : '',
    userText: lastU ? (lastU.innerText || '').trim() : '',
    generating,
    assistantCount: asst.length,
    userCount: usr.length,
    composerLen: composer ? (composer.innerText || '').trim().length : -1,
    url: location.href,
  };
})()`;

// 判断助手回复是否在"问询用户"（需要人类拍板）
function detectQuestion(text) {
  const t = (text || '').trim();
  if (!t) return null;
  if (/\[\s*(问询用户|询问用户|ASK_USER|NEED_INPUT)\s*\]/i.test(t)) return 'marker';
  const tail = t.slice(-260);
  const confirmWords = ['请确认', '请你确认', '需要你确认', '等你确认', '等你答复', '等你回复',
    '请回复', '请你回复', '需要你决定', '请你决定', '你希望', '你觉得', '是否继续', '请你拍板', '需要你拍板'];
  for (const w of confirmWords) if (tail.includes(w)) return 'confirm-wording';
  if (/[？?]\s*$/.test(t) && t.length < 900) return 'ends-with-question';
  return null;
}

function writeInbox(obj) {
  fs.writeFileSync(INBOX_FILE, JSON.stringify(obj, null, 2));
  console.log('[watch] ✓ 已写入 inbox.json (role=' + obj.role + ', 长度 ' + (obj.text || '').length + ')');
}

(async () => {
  const deadline = Date.now() + TIMEOUT_MIN * 60000;
  const state = loadState();

  if (WAIT_USER) {
    // ---------- 模式 B: 等待用户在 GPT 输入框里答复 ----------
    const base = await withPage((cdp) => cdp.eval(EXTRACT_FN));
    const baseCount = base.userCount;
    console.log('[watch] 等待用户输入 | 基线 userCount=' + baseCount + ' | 超时 ' + TIMEOUT_MIN + ' 分钟');
    while (Date.now() < deadline) {
      let snap;
      try { snap = await withPage((cdp) => cdp.eval(EXTRACT_FN)); }
      catch (e) { console.log('[watch] 连接失败(2s 后重试):', e.message); await new Promise((r) => setTimeout(r, 2000)); continue; }

      if (snap.userCount > baseCount && !snap.generating && snap.composerLen === 0) {
        writeInbox({
          role: 'user', text: snap.userText, url: snap.url,
          capturedAt: new Date().toISOString(),
          userCount: snap.userCount, assistantCount: snap.assistantCount,
        });
        state.lastUserCount = snap.userCount;
        saveState(state);
        process.exit(0);
      }
      await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
    }
    console.log('[watch] 超时: ' + TIMEOUT_MIN + ' 分钟内用户未答复');
    process.exit(2);
  }

  // ---------- 模式 A: 等待新的助手完整回复 ----------
  console.log('[watch] 等待 GPT 回复 | 基线 hash: ' + (state.lastAssistantHash || '(无)') +
    ' | 超时 ' + TIMEOUT_MIN + ' 分钟 | 轮询 ' + INTERVAL_SEC + ' 秒');
  let lastText = '';
  let stableSince = 0;
  while (Date.now() < deadline) {
    let snap;
    try { snap = await withPage((cdp) => cdp.eval(EXTRACT_FN)); }
    catch (e) { console.log('[watch] 连接失败(2s 后重试):', e.message); await new Promise((r) => setTimeout(r, 2000)); continue; }

    const h = hash(snap.assistantText);
    if (snap.assistantText && h !== state.lastAssistantHash) {
      if (snap.assistantText === lastText) {
        if (!stableSince) stableSince = Date.now();
        if (!snap.generating && Date.now() - stableSince >= 4000) {
          const q = detectQuestion(snap.assistantText);
          writeInbox({
            role: 'assistant', text: snap.assistantText, url: snap.url,
            capturedAt: new Date().toISOString(), hash: h,
            assistantCount: snap.assistantCount, userCount: snap.userCount,
            isQuestion: !!q, questionType: q,
          });
          if (q) console.log('[watch] ⏸ 该回复含问询标记 (' + q + ') —— 应暂停并等待用户答复');
          state.lastAssistantHash = h;
          state.lastAssistantLen = snap.assistantText.length;
          state.lastCapturedAt = new Date().toISOString();
          saveState(state);
          process.exit(0);
        }
      } else {
        lastText = snap.assistantText;
        stableSince = Date.now();
        console.log('[watch] GPT 流式输出中... 当前长度 ' + snap.assistantText.length + ' | 生成中: ' + snap.generating);
      }
    } else {
      lastText = snap.assistantText;
      stableSince = 0;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
  }
  console.log('[watch] 超时: ' + TIMEOUT_MIN + ' 分钟内没有新的完整回复');
  process.exit(2);
})().catch((e) => { console.error('[watch] 致命错误:', e.message); process.exit(3); });
