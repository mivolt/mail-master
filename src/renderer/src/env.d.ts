/// <reference types="vite/client" />

import type { MailMasterApi } from '@shared/api'

declare global {
  interface Window {
    api: MailMasterApi
  }
}

export {}
