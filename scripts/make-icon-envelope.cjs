/**
 * 把项目 logo 信封（用户提供并指定的 SVG）渲染成白色透明底位图，
 * 供 make-icon.py 合成渐变背景与 squircle 遮罩。
 *
 * 运行：NODE_PATH="$MIMO_NODE_MODULES" node scripts/make-icon-envelope.cjs
 * （sharp 在共享 node_modules 里，ESM 不走 NODE_PATH，因此用 CJS）
 */

const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const root = path.dirname(path.dirname(path.resolve(__filename)))
const out = path.join(root, 'build', 'envelope-alpha.png')

// 用户指定的信封图形（1024 viewBox），fill 白色、背景透明
const ENVELOPE_PATH =
  'M858.656 192 165.344 192C109.472 192 64 237.44 64 293.312l0 469.376C64 818.56 109.472 864 ' +
  '165.344 864l693.312 0C914.528 864 960 818.56 960 762.688L960 293.312C960 237.44 914.528 192 ' +
  '858.656 192zM858.656 800 165.344 800C144.736 800 128 783.264 128 762.688L128 293.312C128 ' +
  '272.736 144.736 256 165.344 256l684.544 0-307.488 279.808c-14.592 14.56-38.272 14.528-54.752' +
  '-1.792l-244.256-206.752C229.856 315.84 209.664 317.504 198.272 331.008c-11.424 13.472-9.76 ' +
  '33.664 3.744 45.088l242.304 204.96c19.904 19.904 46.048 29.792 72.032 29.792 25.632 0 51.136' +
  '-9.632 70.176-28.736L896 300.544l0 462.144C896 783.264 879.264 800 858.656 800z'

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
  `<path d="${ENVELOPE_PATH}" fill="#ffffff"/></svg>`

// 图形在 viewBox 里占 896 宽；目标在最终图标里约 640px 宽 → 渲染 731×731 后居中放置
const TARGET_WIDTH = 640
const size = Math.round((TARGET_WIDTH * 1024) / 896)

sharp(Buffer.from(svg))
  .resize(size, size)
  .png()
  .toFile(out)
  .then((info) => console.log(`已写出 ${out}（${info.width}x${info.height}）`))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
