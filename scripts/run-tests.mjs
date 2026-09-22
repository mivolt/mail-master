import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'

const COMMON = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  alias: { '@shared': './src/shared' },
  external: [
    'imapflow',
    'mailparser',
    'nodemailer',
    'node-html-parser',
    'smtp-server',
    'hoodiecrow-imap'
  ],
  logLevel: 'warning'
}

const TARGETS = [
  { entry: 'scripts/mail-tests.ts', out: 'verify/mail-tests.mjs', label: 'MIME 解析与 SMTP 发信' },
  { entry: 'scripts/imap-tests.ts', out: 'verify/imap-tests.mjs', label: 'IMAP 同步与标记' }
]

let failed = false

for (const target of TARGETS) {
  console.log(`\n===== ${target.label} =====`)
  await build({ ...COMMON, entryPoints: [target.entry], outfile: target.out })

  const result = spawnSync(process.execPath, [target.out], {
    stdio: 'inherit',
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
  })

  if (result.status !== 0) failed = true
}

process.exit(failed ? 1 : 0)
