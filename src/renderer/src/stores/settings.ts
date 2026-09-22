import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'

export const useSettingsStore = defineStore('settings', () => {
  const values = ref<AppSettings>({ ...DEFAULT_SETTINGS })
  const loaded = ref(false)
  const saving = ref(false)

  async function load(): Promise<void> {
    try {
      values.value = await window.api.settings.get()
    } catch {
      values.value = { ...DEFAULT_SETTINGS }
    } finally {
      loaded.value = true
    }
  }

  async function update(key: keyof AppSettings, raw: string | boolean): Promise<void> {
    saving.value = true
    try {
      values.value = await window.api.settings.set(key, String(raw))
    } finally {
      saving.value = false
    }
  }

  const blockRemoteImages = computed(() => values.value.blockRemoteImages)

  return { values, loaded, saving, blockRemoteImages, load, update }
})
