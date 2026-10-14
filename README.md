# chatgpt-coop — 让 ChatGPT 指挥、WorkBuddy 干活的协作回环

一个 WorkBuddy 技能。触发后：ChatGPT 网页版当**指挥端**下达结构化指令，WorkBuddy 当**执行端**在本机读写文件、跑命令、操作浏览器并回报结果，自动循环；需要人类拍板时由 ChatGPT 提出问询，用户在它的输入框答复后继续。

## 安装（新机器一条命令）

公开仓库：

```powershell
iex (irm "https://raw.githubusercontent.com/wuhliang/chatgpt-coop/main/install.ps1")
```

私有仓库（推荐，避免暴露本机路径与习惯）：

```powershell
$env:GITHUB_TOKEN = 'ghp_xxxxxxxxxxxxxxxxxxxx'
iex (irm "https://raw.githubusercontent.com/wuhliang/chatgpt-coop/main/install.ps1")
```

安装命令里的仓库地址已预设为 `wuhliang/chatgpt-coop`；如果你 fork 到了自己的账号下，
用 `-Repo "<你的用户名>/chatgpt-coop"` 覆盖即可：

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/wuhliang/chatgpt-coop/main/install.ps1"))) -Repo "you/chatgpt-coop"
```

安装器会：下载仓库 → 安装到 `%USERPROFILE%\.workbuddy\skills\chatgpt-coop\`
（已存在则自动备份为 `.bak-<时间戳>`）→ 调用 `scripts\setup.ps1` 完成环境部署。
如果你在网络代理后面，加 `-Proxy "http://127.0.0.1:10809"` 之类的参数。

## 使用

1. 双击桌面快捷方式 `ChatGPT-Coop`（由 setup.ps1 生成）启动带调试端口的 Edge
2. 首次在新窗口登录一次 ChatGPT（profile 持久化，之后免登录）
3. 对 WorkBuddy 说「ChatGPT 协作」即可触发全流程

## 目录结构

```
SKILL.md                技能主文档：触发词、8 步流程、决策表、风险门禁、12 条踩坑清单
README.md               本文件
install.ps1             一键安装器
scripts/
  setup.ps1             环境部署：探测 Edge 与代理 → 写启动器 → 建桌面快捷方式
  launch-edge.ps1       经 explorer.exe 拉起 Edge 调试实例，等待 9222 就绪
  status.js             体检：CDP / 登录状态 / 对话计数
  watch.js              监视器：等 GPT 回复；--wait-user 等用户答复
  send.js               向 ChatGPT 输入框写入并发送
  cdp.js                极简 CDP 客户端（Node 内置 WebSocket，零第三方依赖）
  split-screen.ps1      像素级左右分屏
  backup-skill.ps1      把技能打包备份到本地/OneDrive
  identity-card.txt     发给 ChatGPT 的身份卡模板
```

运行时产物 `inbox.json`、`state.json`、`screenshot-insert.jpg`、`msg-*.txt` 不入版本库（见 `.gitignore`）。

## 协议一览

| 项目 | 约定 |
|---|---|
| 指令格式 | `[TASK]` 目标 / `[RISK]` 自动·确认·需输入 / `[STEPS]` 步骤 / `[VERIFY]` 完成判据 |
| 风险门禁 | 自动=只读可逆直接执行；确认=有副作用先呈报；需输入=缺信息先提问 |
| 问询暂停 | ChatGPT 标 `[问询用户]` → 执行端停手 → 用户在 ChatGPT 输入框答复 → 继续 |
| 收尾 | ChatGPT 输出 `[任务结束]` |
| 安全裁量 | 即使标「自动」，执行端判断有不可逆风险也可升级为「确认」 |

## 换机注意

- Node 绝对路径写死在 `SKILL.md` 的命令速查表，受管 Node 版本变更需同步
- `split-screen.ps1` 按窗口标题匹配 ChatGPT 的 Edge、按进程名 `WorkBuddy` 匹配宿主
- 分屏脚本已内置 DPI 感知与隐形边框补偿，换分辨率或缩放比无需改动
