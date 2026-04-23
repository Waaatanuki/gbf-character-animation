<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type ThemeMode = 'light' | 'dark' | 'system'

const themeStorageKey = 'gbf-character-animation-theme'
const theme = ref<ThemeMode>('system')
const systemPrefersDark = ref(false)
let mediaQuery: MediaQueryList | null = null

const resolvedTheme = computed<'light' | 'dark'>(() => {
  if (theme.value === 'system')
    return systemPrefersDark.value ? 'dark' : 'light'

  return theme.value
})

const activeIndicatorStyle = computed(() => {
  const step = 'calc(1.75rem + 0.25rem)'

  if (theme.value === 'dark') {
    return {
      transform: `translateX(${step})`,
    }
  }

  if (theme.value === 'system') {
    return {
      transform: `translateX(calc(${step} * 2))`,
    }
  }

  return {
    transform: 'translateX(0rem)',
  }
})

function applyTheme(nextTheme: 'light' | 'dark') {
  document.documentElement.dataset.themeMode = theme.value
  document.documentElement.style.colorScheme = nextTheme
  document.documentElement.dataset.theme = nextTheme
}

function setTheme(nextTheme: ThemeMode) {
  theme.value = nextTheme
  window.localStorage.setItem(themeStorageKey, nextTheme)
}

function handleSystemThemeChange(event: MediaQueryListEvent) {
  systemPrefersDark.value = event.matches
}

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemPrefersDark.value = mediaQuery.matches
  mediaQuery.addEventListener('change', handleSystemThemeChange)

  const savedTheme = window.localStorage.getItem(themeStorageKey)
  const initialTheme: ThemeMode = savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system'
    ? savedTheme
    : 'system'

  setTheme(initialTheme)
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', handleSystemThemeChange)
})

watch(resolvedTheme, value => applyTheme(value), { immediate: true })
</script>

<template>
  <div class="theme-toggle-group" role="radiogroup" aria-label="主题模式">
    <span class="theme-toggle-indicator" :style="activeIndicatorStyle" aria-hidden="true" />
    <button
      type="button"
      role="radio"
      title="浅色模式"
      aria-label="浅色模式"
      :aria-checked="theme === 'light'"
      class="theme-toggle-option"
      :class="theme === 'light' ? 'theme-toggle-option-active' : ''"
      @click="setTheme('light')"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" class="theme-icon-stroke">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2.5" />
        <path d="M12 19.5V22" />
        <path d="M4.93 4.93l1.77 1.77" />
        <path d="M17.3 17.3l1.77 1.77" />
        <path d="M2 12h2.5" />
        <path d="M19.5 12H22" />
        <path d="M4.93 19.07l1.77-1.77" />
        <path d="M17.3 6.7l1.77-1.77" />
      </svg>
      <span class="sr-only">浅色模式</span>
    </button>
    <button
      type="button"
      role="radio"
      title="深色模式"
      aria-label="深色模式"
      :aria-checked="theme === 'dark'"
      class="theme-toggle-option"
      :class="theme === 'dark' ? 'theme-toggle-option-active' : ''"
      @click="setTheme('dark')"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" class="theme-icon-fill">
        <path d="M14.5 2.8a8.7 8.7 0 1 0 6.7 11.9 9.4 9.4 0 0 1-11.9-11.9 8.6 8.6 0 0 0 5.2 0Z" />
      </svg>
      <span class="sr-only">深色模式</span>
    </button>
    <button
      type="button"
      role="radio"
      title="跟随系统"
      aria-label="跟随系统"
      :aria-checked="theme === 'system'"
      class="theme-toggle-option"
      :class="theme === 'system' ? 'theme-toggle-option-active' : ''"
      @click="setTheme('system')"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" class="theme-icon-stroke">
        <rect x="5" y="6" width="14" height="10" rx="1.5" />
        <path d="M3 18h18" />
      </svg>
      <span class="sr-only">跟随系统</span>
    </button>
  </div>
</template>
