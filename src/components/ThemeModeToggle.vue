<script setup lang="ts">
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
      <span aria-hidden="true" class="i-lucide-sun-medium h-3.5 w-3.5" />
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
      <span aria-hidden="true" class="i-lucide-moon-star h-3.5 w-3.5" />
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
      <span aria-hidden="true" class="i-lucide-monitor h-3.5 w-3.5" />
      <span class="sr-only">跟随系统</span>
    </button>
  </div>
</template>
