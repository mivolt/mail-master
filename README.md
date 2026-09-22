# Mail Master

macOS 多账号邮件客户端。Electron + Vue 3 + TypeScript，基于 IMAP / SMTP 通用协议，
一套代码接入 QQ 邮箱、163/126、Gmail、企业自建邮箱等。

## 产品承诺

这三条不是宣传语，是可以被代码和测试验证的：

- **无广告** —— 界面里没有任何广告位，也不会为了推荐去分析你的邮件。
- **不限账号** —— 账号数量不设上限，所有功能默认可用，没有会员墙。
- **数据留在本机** —— 邮件正文、附件、密码只在这台电脑与你的邮箱服务器之间流动，
  不经过任何第三方。没有埋点统计、没有崩溃上报、没有用户画像。

产品取舍一律遵循「降低门槛优先于增加能力」：IMAP、授权码、两步验证这些概念
由界面消化掉，用户只需要照着编号步骤点。

## 功能

**添加账号（零门槛）**
- **先选服务商**（按钮组，五个选项一眼可见），再填邮箱
- 邮箱只需输入 `@` 之前的部分，域名后缀由服务商带出——多域名的服务商
  （QQ 的 qq.com/foxmail.com、163 的 126/yeah.net 等）后缀是一个小下拉
- 直接粘贴完整邮箱也能识别：会自动拆出域名并匹配到对应服务商
- 密码栏标签随服务商变化，直接告诉你该填「授权码」还是「应用专用密码」
- 帮助是**隐性提示**：邮箱拼完整后才出现一行「怎么拿到授权码」，
  点开才展开编号步骤与「打开官方页面」按钮
- 认证失败时自动展开步骤，并把错误换成醒目的红色区块
- 显示名称、登录用户名、服务器地址收在「高级设置」里，默认折叠

**出问题时**
- 错误是醒目的红色区块，固定在按钮上方（滚动也一定看得见），带明确标题
- 引用服务器原话并给出下一步动作，而不是技术错误码
- 「复制诊断」抓取完整 IMAP/SMTP 协议日志，**协议级脱敏**后复制到剪贴板

**设置**
- 每个文件夹保留邮件数、自动下载正文数量——直接影响磁盘占用与流量
- 默认不加载远程图片——防追踪像素，单封邮件上仍可临时放行
- 开机时自动启动
- 数据位置与占用统计、打开数据目录、一键清除全部本地数据（二次确认后重启）

**关于**
- 只放只读内容：三条承诺、隐私声明、版本信息
- 与「设置」的分工是：关于讲「我们怎么对待你的数据」，设置放「你想怎么用它」

**账号管理**
- 多账号并存，服务商预设自动填充服务器地址与端口
- 添加账号前先真实校验 IMAP 登录，配置错误立刻反馈
- 密码 / 授权码使用 macOS Keychain 加密后入库，不落明文
- 支持编辑服务器配置、移除账号

**收信**
- **快捷视图**：`所有收件箱`（跨账号聚合全部 INBOX）与 `所有未读`
  （跨账号、跨文件夹聚合未读，自动排除垃圾 / 已删除 / 草稿 / 已发送）
- 跨账号视图下每封邮件左侧色条标识来源账号，跨文件夹视图下额外标出所属文件夹
- 账号维度收件箱、任意文件夹（收件箱 / 已发送 / 草稿 / 垃圾 / 已删除 / 自定义）
- 文件夹识别同时支持 `special-use` 标记与常见中英文名称——部分服务器
  （如 163 的 Coremail）不上报标记，只靠标记会漏掉「已发送」
- 本地 SQLite 缓存，断网可浏览已同步内容
- IMAP IDLE 长连接，新邮件实时推送；断线自动重连（指数退避）
- 首屏同步最近 300 封邮件元数据，最近 40 封预取正文

**读信**
- HTML 正文在 `sandbox` iframe 中渲染，脚本无法执行
- 远程图片默认拦截（防追踪像素），一键「显示图片」加载
- `cid:` 内联图自动转 data URL，附件自动落盘
- 附件可打开或另存为
- 打开自动标记已读，并同步 `\Seen` 到服务器

**写信**
- 多收件人 / 抄送 / 密送，附件选择
- 密送只进 SMTP 信封，不出现在报文头部
- 回复 / 转发（自动补 `Re:` / `Fwd:` 前缀并引用原文）
- 发件人显示名按 RFC 2047 正确编码

**快捷键**
| 快捷键 | 功能 |
| --- | --- |
| `⌘N` | 写邮件 |
| `⌘R` | 同步全部账号 |
| `⌘,` | 打开设置 |
| `J` / `K` | 下一封 / 上一封 |
| `Esc` | 关闭弹窗 |

## 各邮箱的准备步骤

程序里填的「密码」是**授权码**，不是登录密码。

| 邮箱 | 准备工作 |
| --- | --- |
| QQ / Foxmail | 网页版「设置 → 账号 → POP3/IMAP/SMTP 服务」开启 IMAP/SMTP，生成 16 位授权码 |
| 163 / 126 | 网页版「设置 → POP3/SMTP/IMAP」开启服务后获取授权码 |
| Gmail | 先开启两步验证，再生成「应用专用密码」（16 位）。需要本机能直连 Google |
| 企业邮箱 | 向管理员索取 IMAP/SMTP 服务器地址与端口；自签证书暂不支持 |
| Outlook / Hotmail | **个人账号已不可用**，见下方限制说明 |

服务器地址已按服务商预填，一般无需改动：

| 服务商 | IMAP | SMTP |
| --- | --- | --- |
| QQ / Foxmail | `imap.qq.com:993` SSL | `smtp.qq.com:465` SSL |
| 163 / 126 | `imap.163.com:993` SSL | `smtp.163.com:465` SSL |
| Gmail | `imap.gmail.com:993` SSL | `smtp.gmail.com:465` SSL |
| Outlook / Exchange | `outlook.office365.com:993` SSL | `smtp.office365.com:587` STARTTLS |

## 架构

```
src/
├── main/                     主进程（唯一拥有 Node 权限）
│   ├── index.ts              窗口、生命周期、单实例锁、权限拒绝
│   ├── ipc/index.ts          IPC 处理器（账号 / 邮件 / 附件 / 发信）
│   ├── mail/
│   │   ├── engine.ts         每账号一个 worker：同步 + IDLE 监听 + 重连
│   │   ├── imap.ts           imapflow 封装：文件夹、信封、原文、flags
│   │   ├── smtp.ts           nodemailer 封装，非 SSL 时强制 STARTTLS
│   │   └── parser.ts         MIME 解析 + HTML 净化 + 渲染文档生成
│   ├── db/                   node:sqlite（Electron 内置，无需原生编译）
│   └── security/vault.ts     safeStorage（Keychain）加解密凭据
├── preload/index.ts          contextBridge 窄接口，输出 CJS 以兼容 sandbox
├── shared/                   主/渲染共享类型、通道名、服务商预设
└── renderer/src/             Vue 3 三栏界面
```

**安全模型**

| 边界 | 措施 |
| --- | --- |
| 渲染进程 | `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false` |
| IPC | 仅通过 preload 暴露的固定方法，无任意通道调用 |
| 邮件正文 | `sandbox="allow-popups"` iframe + 主进程净化（剥离 script / 事件属性 / `javascript:`） |
| 远程图片 | 默认改写为占位图，原地址存 `data-blocked-src`，用户显式点击才加载 |
| 凭据 | Keychain 加密后存 SQLite；解密失败时提示重新输入而非静默失败 |
| 外链 | 一律 `shell.openExternal` 交给系统浏览器，窗口内禁止导航 |
| 权限 | `setPermissionRequestHandler` 拒绝全部（摄像头 / 定位等一概不用） |
| 传输 | TLS 1.2 起，证书默认严格校验；SMTP 非 SSL 时 `requireTLS` |

## 开发

```bash
npm install
npm run dev            # 开发模式（HMR）
npm run build          # 构建到 out/
npm run typecheck      # 主进程 tsc + 渲染层 vue-tsc
```

## 打包

```bash
npm run dist:mac        # 默认只出 arm64（跟随构建机架构）
npm run dist:mac:x64    # 需要 Intel 版时显式构建
npm run dist:mac:all    # 两个架构都出
```

国内网络需要加镜像变量，否则 electron-builder 会在下载二进制时超时：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist:mac
```

### 关于 Intel 版本

**在 Apple 芯片上不要装 x64 版本。** macOS 26 起，运行基于 Intel 的 App 会弹出
「对基于 Intel 的 App 的支持即将结束，该 App 或它使用的某个组件将无法在
macOS 28 中运行」的警告——因为 Intel 版本要通过 Rosetta 转译运行。

确认自己装的是哪个架构：

```bash
lipo -archs "/Applications/Mail Master.app/Contents/MacOS/Mail Master"
# 期望输出：arm64
```

arm64 包已核实为纯净：包内 13 个 Mach-O 二进制全部是 arm64，不含任何 Intel 组件。

只有确实要支持 Intel Mac 时才用 `dist:mac:x64`；两个架构都出会让使用者容易装错。

### 未签名与未公证

本机构建的镜像不带 quarantine 属性，自己装没问题；但通过浏览器或 IM 传给别人后，
Gatekeeper 会拦下它，对方需要右键「打开」，或执行
`xattr -dr com.apple.quarantine "/Applications/Mail Master.app"`。

要正式分发，需要 Apple Developer 账号，并在 `electron-builder.yml` 里配置
`mac.identity` 与 `mac.notarize`（`build/entitlements.mac.plist` 已备好）。

### 打包产物的端到端验证

打包出来之后不要只看「能启动」，要验证真实操作路径：

```bash
npm run verify:package                                       # 启动、版本、safeStorage、IPC 加账号
MM_TEST_EMAIL=... MM_TEST_SECRET=... \
  npm run verify:package-ui "release/mac-arm64/Mail Master.app"   # 走界面加账号 + 同步
```

`verify:package-ui` 会按真实界面路径操作（点「添加邮箱账号」→ 逐字输入邮箱 → 点「添加账号」），
再同步一次确认能连上 IMAP。**这一步是必需的**：曾经出现过自动化测试全绿、
但打包后从界面添加账号报 `An object could not be cloned.` 的情况——原因是测试直接调
IPC 传普通对象，绕过了 Vue 响应式 Proxy 无法跨 contextBridge 的问题；
也出现过「逐字输入邮箱时用户名被截断成 `name@`」的问题，而 `fill` 一次性赋值测不出来。


## 应用图标

`build/icon.icns` 由 `scripts/make-icon.py` 生成：从 `build/icon-source.png`
按 B−R 通道差提取信封的软 alpha 遮罩，配自绘的垂直渐变重新合成——生成服务叠加
在底图右下角的品牌水印因此被整块替换掉——再套 macOS 的 superellipse 圆角遮罩，
按 Apple 图标网格（824 / 1024）排布，最后经 `iconutil` 打包成含 16~512@2x 的 icns。

```bash
"$MIMO_PYTHON" scripts/make-icon.py
```

## 排查连接问题

连不上时，先用诊断脚本把真实的协议交互打出来——它会逐条打印 IMAP 往返，
以及服务端返回的原始错误文本：

```bash
node scripts/diag-provider.mjs imap.163.com smtp.163.com you@163.com '<授权码>'
```

判断要点：

| 现象 | 含义 |
| --- | --- |
| `LOGIN` 返回 `NO` | 认证被拒。多为密码栏填了登录密码而非授权码，或邮箱设置里未开启 IMAP/SMTP |
| `Invalid greeting` 且问候语里出现 `IMAP` | 端口或地址填错，多半是 SMTP 连到了 IMAP 服务上 |
| 连接超时 / `ECONNREFUSED` | 网络不通、端口被防火墙拦截，或地址写错 |
| 日志里看到 `ID` 命令被接受 | 正常。网易、QQ 要求客户端发送 `ID`，已通过 `clientInfo` 自动处理 |

界面上的报错会直接引用服务端原文（例如 163 的 `LOGIN Login error or password error`）
并附上可操作提示，而不是笼统的「连接失败」——imapflow 把真实原因藏在
`responseText` / `executedCommand` 上，`describeMailError()` 负责还原。

## 测试

```bash
npm run test:core          # MIME 解析 + SMTP 发信 + IMAP 同步 + 错误还原（92 项）
npm run test:integration   # 真实 Electron + 假 IMAP/SMTP 服务器走完整界面流程（95 项）
npm test                   # 类型检查 + 上面两项
```

两套自动化测试都不依赖真实邮箱账号。另有针对真实服务商的手动实测流程：

```bash
npm run account:setup   # 用独立 profile 打开应用，你自己添加测试邮箱
npm run test:live       # 对该账号跑完整链路实测
```

`account:setup` 打开的窗口使用 `verify/dev-profile`，与日常使用完全隔离。
密码只进入 macOS 系统钥匙串，不会写入任何项目文件，也不会出现在终端输出里。

`test:live` 会验证：真实 IMAP 同步 → 文件夹与特殊用途识别 → 读信（正文渲染、
script 剥离、附件落盘）→ 星标与已读回写服务器（测完恢复原状）→ 真实服务商上的
诊断报告脱敏效果 → SMTP 发信（发一封带附件的自测邮件给自己并确认收到）。
自测邮件主题形如 `[Mail Master 自测] 20260921143000`，可直接删除。

**测完请到邮箱设置里重置授权码。**

### 打包产物的端到端验证

打包出来之后不要只看「能启动」，要验证真实操作路径：

```bash
npm run verify:package                                       # 启动、版本、safeStorage、IPC 加账号
MM_TEST_EMAIL=... MM_TEST_SECRET=... \
  npm run verify:package-ui "release/mac-arm64/Mail Master.app"   # 走界面加账号 + 同步
```

`verify:package-ui` 会按真实界面路径操作（点「添加邮箱账号」→ 填表 → 点「添加账号」），
再同步一次确认能连上 IMAP。**这一步是必需的**：曾经出现过自动化测试全绿、
但打包后从界面添加账号报 `An object could not be cloned.` 的情况——原因是测试直接调
IPC 传普通对象，绕过了 Vue 响应式 Proxy 无法跨 contextBridge 的问题。

### 三套测试分别覆盖什么

- `scripts/mail-tests.ts` — 用 nodemailer 的 MailComposer 生成真实 MIME 报文
  （含中文主题、附件、cid 内联图、script 注入、远程追踪像素），验证解析与净化；
  再起一个本地 TLS SMTP 服务器验证发信全链路，含密送隐私与错误密码拒绝；
  以及 `describeMailError()` 对 imapflow / nodemailer 各种错误形状的还原。
- `scripts/imap-tests.ts` — 起 `hoodiecrow-imap` 假服务器，验证连接、列文件夹、
  信封解析、BODYSTRUCTURE 附件检测、批量拉原文、flags 双向同步、认证失败识别。
- `scripts/integration.mjs` — 假 IMAP + 假 TLS SMTP 服务器 + 真实 Electron 进程，
  **通过界面操作**走完整「添加账号 → 同步 → 列表 → 读信 → 显示图片 → 写信发送」流程，
  并覆盖欢迎页、快捷视图、零门槛引导、关于与设置、一键诊断与脱敏。
  截图输出到 `verify/`。

自动化测试均使用独立 `--user-data-dir`，不会污染真实应用数据。

## 已知限制

- **Outlook / Hotmail 个人账号无法登录。** 微软已于 2024 年 9 月对
  `outlook.com` / `hotmail.com` / `live.com` 全面停用 IMAP 基础认证，密码或
  应用专用密码都会失败。这类账号需要 OAuth2 授权，当前版本未实现（界面里已
  给出明确提示）。企业 / 学校账号若管理员未关闭基础认证仍可用。
- **自签证书的企业邮箱无法连接。** TLS 严格校验，未提供跳过校验的开关——这是
  有意的，避免在无意中降级传输安全。
- **发信后不主动 APPEND 到「已发送」。** 依赖服务器自身的自动保存行为
  （Gmail、QQ、163 都会自动保存）。
- **搜索是本地 `LIKE` 匹配**，范围限于已同步的邮件，不是服务端全文检索。
- **草稿箱只读。** 写信过程中关闭窗口内容会丢失，尚未接入 IMAP APPEND 保存草稿。
- **未实现 OAuth2**，因此 Gmail 需应用专用密码，且账号安全策略更严格的企业
  邮箱可能拒绝基础认证。
- 仅适配 macOS（使用 `hiddenInset` 标题栏、Keychain、`.app` 打包），
  未做 Windows / Linux 适配。

## 技术选型说明

- **`node:sqlite` 而非 better-sqlite3** — Electron 44 内置 Node 24 已提供
  `node:sqlite`，省掉原生模块编译与 `electron-rebuild` 整个环节，安装更快、
  产物更简单。
- **preload 输出 CJS** — `sandbox: true` 的 preload 不支持 ESM，因此在
  `electron.vite.config.ts` 中显式指定 preload 构建为 `.cjs`。
- **TypeScript 锁定 5.9** — TS 7 是 Go 重写版，移除了 `baseUrl` 等选项，
  Volar / vue-tsc 对其编译器 JS API 的兼容性尚未验证。
