/**
 * Vue 的响应式对象是 Proxy。contextBridge 在把参数从渲染世界送进隔离世界时
 * 无法序列化 Proxy，会抛 "An object could not be cloned." —— 这个错误发生在
 * preload 里任何代码执行之前，所以只能在渲染侧就传普通数据。
 *
 * 凡是传给 window.api 的对象或数组，都要先过一遍 plain()。
 * 基本类型无需处理，直接返回。
 */
export function plain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value)) as T
}
