# Mail Master — 项目约定

macOS 多账号邮件客户端。Electron 44 + Vue 3 + TypeScript + electron-vite，
基于 IMAP / SMTP 通用协议。

## 工作节奏

**不要每次改完代码就打包 DMG。** 开发阶段只跑类型检查与测试：

```bash
npm run typecheck
npm run test:core          # MIME/SMTP/IMAP/错误还原（91 项）
npm run test:integration   # 真实 Electron + 假 IMAP 服务器（73 项）
npm run test:live          # 真实邮箱实测，需要先 npm run account:setup
```

只有用户明确说「打包」时，才执行 electron-builder 出安装包：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npx electron-builder --mac -c.mac.identity=null
```

## 产品思路：偏向小米的用户理念

做任何产品决策（功能取舍、文案、默认值、错误处理、交互）时按此优先级判断：

1. **让每个人都能享受科技的乐趣** —— 降低门槛优先于增加能力。IMAP、授权码、
   OAuth 这些概念必须由产品消化掉，不能甩给用户。
2. **和用户交朋友、参与感** —— 出问题时要让用户能轻松说清问题（一键诊断），
   而不是让用户自己描述技术细节。
3. **厚道** —— 不加广告、不锁功能、不做会员墙、不诱导。
4. **隐私是基本权利** —— 邮件正文与密码不经过任何第三方；数据本地且对用户透明；
   提供一键清除。
5. **专注、极致、快** —— 核心路径（看信、写信）保持极简。
6. **语气积极** —— 避免冷冰冰的错误码，要给出「下一步该怎么做」。

**明确不做**：广告位、会员墙、把用户数据用于推荐/画像、技术术语堆砌的错误提示、
需要看文档才能配好的流程、AI 自动替用户发送邮件。

### 界面设计原则

- **信息架构按「只读 vs 可操作」划分**：关于 = 叙事（版本、承诺、隐私声明），
  设置 = 用户能改的行为 + 数据管理。不要把危险操作混进只读页面。
- **不要过早展示帮助**。用户还没动手时给教程是噪音。帮助应做成**隐性提示**：
  默认只占一行（`hint-trigger`），点击才展开；出错时自动展开。
  典型例子是添加账号页——默认只有两个输入框。
- **阻断性错误必须醒目**：用 `alert-error`（红色区块 + 明确标题 + 下一步动作），
  固定在按钮上方保证滚动也可见。不要用浅色小字。
- 设置项必须真的影响运行时行为，否则不该出现在界面上；每项配一句
  「改了会怎样」而不是复述选项名。
- **能替用户省掉输入的就省掉**：添加账号时先选服务商、邮箱只填 `@` 前面，
  域名由服务商带出。这既少打字，也顺带消掉了「逐字输入中途把半成品当成最终值」
  这一类隐患——字段值由完整的两段拼出来，不存在中间状态。

### AI 能力的取向

端侧模型优先（隐私 + 快 + 不花钱的交集）。摘要、翻译、润色、发送前检查这类任务
7B 级模型足够。**不要搭中转服务器代用户调 AI**，那与「正文不经过第三方」直接冲突。

优先做「待办抽取」与「发送前检查」——价值高且对小模型友好。
不做「一句话生成整封邮件」：发信是高风险动作，用户不敢直接发，留存低。

## 凭据处理约定

- 需要真实账号实测时走 `npm run account:setup`（固定 profile `verify/dev-profile`，
  用户自己在界面里添加），再跑 `npm run test:live`，脚本全程不接触明文密码
- 任何时候都不要把凭据写入项目文件、测试脚本、README 或提交
- 若用户主动贴出凭据，提醒其测试后立即重置授权码

## 关键技术坑（踩过的）

- **imapflow**：服务器返回 NO/BAD 时统一抛 `Command failed`，真实原因在
  `responseText` / `executedCommand` / `authenticationFailed` 上，必须还原后展示
- **imapflow**：每次 SELECT / 重新打开邮箱都会因计数变化发 `exists`，不能直接用
  `prevCount` 判新邮件，必须与本地已知总数比对
- **imapflow**：服务器广告 SASL-IR 时会走 `AUTHENTICATE PLAIN` 并 base64 内联凭据，
  按字面匹配密码的脱敏抓不到，必须按协议语义脱敏（见 `mail/diagnostics.ts`）
- **网易 163/126 与 QQ**：要求客户端发送 IMAP `ID`，imapflow 的 `clientInfo` 自动处理
- **163 的 Coremail 不上报 `\Sent`**：文件夹识别必须做名称兜底
- **微软**：2024-09 起个人账号（outlook.com/hotmail.com/live.com）已停用 IMAP
  基础认证，密码登录必然失败，需 OAuth2（当前未支持）
- **Vue**：布尔属性白名单包含 `inert`，`:inert="false"` 会正确移除属性
- **Playwright + Electron 测试**：后台同步完成会触发侧栏重渲染，固定
  `waitForTimeout` 后点击会落空，必须轮询等待目标状态并在必要时重试
- **Vue 响应式 Proxy 过不了 contextBridge**：把 `form.value`、`ref([]).value`
  这类响应式对象传给 `window.api.*` 会抛 `An object could not be cloned.`。
  错误发生在 preload 代码执行之前，所以只能在渲染侧用 `lib/plain.ts` 的
  `plain()` 转成普通数据。
- **测试必须走真实界面路径**：直接 `window.api.accounts.add(普通对象)` 会绕过上面
  那个序列化问题——曾经因此出现「自动化测试全绿但界面添加账号报错」。
  添加账号与发信都必须通过 DOM 交互来测（用 `data-field` 选择器）。
- **测试要用 `pressSequentially` 而不是 `fill`**：`fill` 一次性赋值只触发一次
  input 事件，覆盖不到「输入过程中派生字段」的逻辑。曾经出现「逐字输入邮箱时，
  敲下 `@` 那一刻就把 `name@` 当成用户名，之后不再更新，导致 LOGIN 用截断的账号」——
  `fill` 完全测不出来。派生字段必须每次 input 都更新，不能只在值为空时赋值。
- **Electron 的 IPC 错误前缀要剥离**：主进程抛的错误到渲染侧会变成
  `Error invoking remote method '<channel>': Error: <原文>`，直接展示给用户是噪音。
  已在 preload 的 `cleanIpcError()` 里统一处理。
- **弹窗不要只用 `@click.self` 关闭**：从面板内部拖拽选中文字、在遮罩上松开时，
  click 事件的 target 是遮罩，会被误判成「点了背景」而关掉弹窗。而拖拽选中正是
  「复制」的常规动作，用户会以为是粘贴把窗口弄没了。`Modal.vue` 里改成
  「按下与松开都必须发生在遮罩上」才关闭。
- **hoodiecrow 自带证书已于 2025-02 过期**：应用侧因为测试时设了
  `NODE_TLS_REJECT_UNAUTHORIZED=0` 才没暴露，但测试进程自己发起的连接会直接
  报 `CERT_HAS_EXPIRED`。集成测试里改为传 `credentials: tls` 用自签的有效证书。
- **系统集成调用要包 try/catch**：Dock 角标、菜单栏图标、系统通知都属于
  OS 集成，失败（如未签名应用、图标资源异常）不应把应用带崩。
- **测试骨架要能在中断时输出已收集的结果**：结果原本只在末尾统一打印，
  一旦中途抛异常就什么都看不到，定位不到失败位置。已加 `uncaughtException`
  处理，中断时也会打印已跑过的检查项。
- **`package-lock.json` 必须指向公网源**：本机 `~/.npmrc` 指向公司私有 nexus，
  npm 会把下载地址写进 lockfile。GitHub Actions 的机器访问不到 nexus，
  `npm ci` 会直接失败。**改动依赖后记得检查** lockfile 里的 `resolved` 是否
  又变回 nexus，是的话替换前缀为 `https://registry.npmjs.org/`。
- **跨平台图标有两套**：macOS 菜单栏用模板图（纯黑 + alpha，系统当遮罩用，
  自动适配深浅色）；**Windows 不支持模板图**，必须用彩色实心图标，否则深色
  任务栏上看不见。见 `resources/trayTemplate*` 与 `resources/trayWindows*`。
- **Windows 没有 Dock 角标**，要用 `win.setOverlayIcon()`；而它只能给图片，
  主进程又没有 canvas，所以数字是预先生成在 `resources/badges/` 下的。
- **Windows 目标可在 macOS 上交叉构建**，产出 NSIS 安装包不需要 wine
  （已实测）。但**无法在本机验证它真能运行**，需要 Windows 机器实测。
- **环境**：用户 `~/.npmrc` 是私有 nexus 源，会剥掉 electron 包的 `scripts` 字段
  导致二进制不下载，需手动跑 `node node_modules/electron/install.js` 并设 `ELECTRON_MIRROR`
- **生图服务**会在图片右下角叠加品牌水印，`image_edit` 去不掉（属服务端后处理），
  需程序化重建背景（见 `scripts/make-icon.py`）

## 架构决策

- 用 `node:sqlite` 而非 better-sqlite3：Electron 44 内置 Node 24 已提供，
  省掉原生编译与 electron-rebuild
- preload 显式构建为 CJS：`sandbox: true` 的 preload 不支持 ESM
- 邮件正文在 `sandbox="allow-popups"` iframe 中渲染，主进程负责净化
- 远程图片默认拦截并改写为占位图，原地址存 `data-blocked-src`，用户显式点击才加载
- TypeScript 锁 5.9：TS 7 是 Go 重写版，与 vue-tsc / Volar 的兼容性未验证
