/**
 * 提交前标准检查。
 *
 * 这里每一项都对应一次真实踩过的坑——不是风格偏好，是会导致构建失败、
 * 发布出错或泄露信息的问题。跑 `npm run preflight` 即可全量校验，
 * 它同时接在 `npm test` 与 CI 门禁里，所以不会「忘了检查」。
 *
 * 新增标准时：先想清楚它在什么情况下会失败、失败后怎么修，
 * 把修复提示写进 hint，否则报错只会让人困惑。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const results = []

/** okDetail 通过时展示，failDetail 失败时展示——两边都要能读懂 */
function check(name, hint) {
  return (condition, okDetail = '', failDetail = '') => {
    results.push({
      name,
      ok: Boolean(condition),
      detail: condition ? okDetail : failDetail,
      hint: condition ? '' : hint
    })
  }
}

function read(relative) {
  const path = join(root, relative)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function readJson(relative) {
  const raw = read(relative)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 锁文件来源
{
  const done = check(
    'package-lock.json 的下载源都是公网源',
    '本机 ~/.npmrc 指向私有 registry 时，npm 会把下载地址写进 lockfile，CI 访问不到会直接失败。\n' +
      '修复：npm install --package-lock-only --registry=https://registry.npmjs.org/'
  )
  const lock = readJson('package-lock.json')
  if (!lock) {
    done(false, '', '无法读取 package-lock.json')
  } else {
    // 允许 npm 官方源与 GitHub 直链，其余一律视为私有源
    const allowed = ['registry.npmjs.org', 'codeload.github.com', 'github.com']
    const hosts = new Set()
    const offenders = new Set()
    for (const pkg of Object.values(lock.packages ?? {})) {
      const resolved = pkg?.resolved
      if (typeof resolved !== 'string' || !resolved.includes('://')) continue
      const host = resolved.split('://')[1].split('/')[0]
      hosts.add(host)
      if (!allowed.includes(host)) offenders.add(host)
    }
    done(
      offenders.size === 0,
      `${hosts.size} 个来源：${[...hosts].join(', ')}`,
      `发现非公网源：${[...offenders].join(', ')}`
    )
  }
}

// ------------------------------------------------------------ 版本号三处一致
{
  const done = check(
    'package.json 与 package-lock.json 版本一致',
    '用 npm version <patch|minor|major> --no-git-tag-version 提升版本，它会同时更新两处'
  )
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  const a = pkg?.version
  const b = lock?.version
  const c = lock?.packages?.['']?.version
  done(
    a && a === b && a === c,
    `${a}`,
    `package.json=${a} lock=${b} lock.packages[""]=${c}`
  )
}

// ------------------------------------------------------ 打包脚本必须禁自动发布
{
  const done = check(
    'dist:* 脚本都带 --publish never',
    'electron-builder 在 CI 里检测到 git tag 会「隐式发布」，未设 GH_TOKEN 会直接失败；\n' +
      '而且产物其实已经构建成功了，报错位置很迷惑。发布统一由 workflow 的 publish job 负责'
  )
  const pkg = readJson('package.json')
  const scripts = Object.entries(pkg?.scripts ?? {}).filter(([key]) => key.startsWith('dist:'))
  const missing = scripts.filter(([, value]) => !value.includes('--publish never')).map(([key]) => key)
  done(
    scripts.length > 0 && missing.length === 0,
    `${scripts.length} 个脚本`,
    `缺少该参数：${missing.join(', ')}`
  )
}

// ------------------------------------------------------------ 产物名不含空格
{
  const done = check(
    'electron-builder.yml 的 artifactName 不含空格',
    'GitHub Actions 的 artifact 中转会把空格替换成点，发布出来的文件名与本地不一致。\n' +
      '用连字符，并且不要用 ${productName}（它的值带空格）'
  )
  const yml = read('electron-builder.yml')
  if (!yml) {
    done(false, '', '无法读取 electron-builder.yml')
  } else {
    const names = yml
      .split('\n')
      .map((line) => line.match(/^\s*artifactName:\s*(.+?)\s*$/))
      .filter(Boolean)
      .map((match) => match[1].replace(/^['"]|['"]$/g, ''))
    const bad = names.filter((name) => name.includes(' ') || name.includes('${productName}'))
    done(
      names.length > 0 && bad.length === 0,
      names.join(' | '),
      bad.length ? `有空格或用了 productName：${bad.join(' | ')}` : '未找到 artifactName'
    )
  }
}

// ---------------------------------------------------------------- 必需资源存在
{
  const done = check(
    '打包与图标所需的资源文件都存在',
    '缺资源会导致打包失败或图标丢失。用 npm run icons 重新生成'
  )
  const required = [
    'build/icon.icns', // macOS 应用图标
    'build/icon.ico', // Windows 应用图标
    'resources/trayTemplate@2x.png', // macOS 菜单栏（模板图）
    'resources/trayWindows@2x.png', // Windows 任务栏（彩色图）
    ...Array.from({ length: 9 }, (_, i) => `resources/badges/badge-${i + 1}.png`),
    'resources/badges/badge-9plus.png' // Windows 任务栏角标
  ]
  const missing = required.filter((file) => !existsSync(join(root, file)))
  done(missing.length === 0, `${required.length} 个文件`, `缺失：${missing.join(', ')}`)
}

// ------------------------------------------------------------ 图标已内联进产物
{
  const done = check(
    '主进程产物中的图标已内联（无运行时路径依赖）',
    '图标靠 Vite 内联成 data URL，这样开发与打包行为一致、不存在资源定位问题。\n' +
      '若产物里出现 resources/tray 路径，说明内联失效了'
  )
  const bundle = read('out/main/index.js')
  if (!bundle) {
    done(true, '未构建，跳过', '')
  } else {
    const inlined = (bundle.match(/data:image\/png;base64/g) ?? []).length
    const leaked = bundle.includes('resources/tray')
    done(
      inlined >= 2 && !leaked,
      `内联 ${inlined} 处`,
      leaked ? `内联 ${inlined} 处，但发现 resources/tray 路径引用` : `仅内联 ${inlined} 处，少于预期的 2 处`
    )
  }
}

// ------------------------------------------------------------- CI 与本地标准同步
{
  const done = check(
    'CI 里每处 electron-builder 调用都带 --publish never',
    'CI 里漏了它会让整个发布失败，而本地测不出来。检查 workflow 里所有调用行'
  )
  const workflow = read('.github/workflows/release.yml')
  if (!workflow) {
    done(false, '', '无法读取 .github/workflows/release.yml')
  } else {
    // 只挑真正的构建调用：排除注释与 --version 这类信息性命令
    const calls = workflow
      .split('\n')
      .filter(
        (line) =>
          /electron-builder/.test(line) && !/^\s*#/.test(line) && !/--version/.test(line)
      )
    const bad = calls.filter((line) => !line.includes('--publish never'))
    done(calls.length > 0 && bad.length === 0, `${calls.length} 处调用`, `缺少该参数：${bad.join(' | ')}`)
  }
}

// --------------------------------------------------- 敏感目录不会被提交进仓库
{
  const done = check(
    '.gitignore 覆盖了不该进仓库的目录',
    'verify/ 里有真实邮箱的截图与测试数据库、release/ 里有安装包，\n' +
      '它们都不能进公开仓库。缺哪个补哪个'
  )
  const ignore = read('.gitignore') ?? ''
  const lines = ignore.split('\n')
  const required = ['node_modules/', 'out/', 'release/', 'verify/']
  const missing = required.filter((entry) => !lines.includes(entry))
  done(missing.length === 0, `${required.length} 项`, `缺失：${missing.join(', ')}`)
}

// ---------------------------------------------------------------------- 输出
const failed = results.filter((item) => !item.ok)

for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  → ${item.detail}` : ''}`)
  if (!item.ok && item.hint) {
    console.log(`      ↳ ${item.hint.split('\n').join('\n        ')}`)
  }
}

console.log(`\n${results.length - failed.length}/${results.length} 项标准通过`)
if (failed.length > 0) {
  console.log(`\n未通过：${failed.map((item) => item.name).join('、')}`)
  process.exitCode = 1
}
