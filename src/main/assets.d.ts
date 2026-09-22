declare module '*.png' {
  const url: string
  export default url
}

/**
 * Vite 的 import.meta.glob —— 主进程构建同样支持，
 * 但主进程的 tsconfig 不加载 vite/client，这里补上声明。
 */
interface ImportMeta {
  glob(
    pattern: string,
    options?: { eager?: boolean; import?: string; query?: string }
  ): Record<string, string>
}
