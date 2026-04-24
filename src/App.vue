<script setup lang="ts">
const defaultCharacterId = '3040638000'
const characterIdInput = ref(defaultCharacterId)
const activeCharacterId = ref(defaultCharacterId)
const characterStageKey = ref(0)

function applyCharacterId() {
  const nextCharacterId = characterIdInput.value.trim()
  if (nextCharacterId) {
    activeCharacterId.value = nextCharacterId
    characterStageKey.value += 1
  }
}
</script>

<template>
  <div class="bg-page text-ink min-h-svh">
    <header class="apple-nav-shell">
      <nav class="mx-auto h-12 max-w-[980px] flex items-center justify-between px-5 text-[12px] leading-[1.33] tracking-[-0.12px]">
        <a href="#overview" class="font-500 no-underline">GBF Character Animation</a>
        <div class="flex items-center gap-3">
          <a
            href="https://github.com/Waaatanuki/gbf-character-animation"
            target="_blank"
            rel="noreferrer"
            aria-label="查看 GitHub 仓库"
            title="查看 GitHub 仓库"
            class="apple-nav-icon"
          >
            <span class="i-simple-icons-github h-4 w-4" aria-hidden="true" />
            <span class="sr-only">GitHub 仓库</span>
          </a>
          <ThemeModeToggle />
        </div>
      </nav>
    </header>

    <main>
      <section id="overview" class="bg-page px-5 py-12 sm:py-16">
        <div class="mx-auto max-w-[980px]">
          <p class="m-0 apple-kicker text-muted">
            Overview
          </p>
          <h1 class="m-0 mt-4 apple-display-section text-ink">
            预览角色动作与导出 GIF。
          </h1>
          <div class="mt-8 flex flex-col gap-4 apple-card-wide sm:flex-row sm:items-center sm:justify-between">
            <p class="apple-body-compact text-ink">
              输入角色 ID 后加载本地角色资源。
            </p>

            <form class="flex flex-col gap-3 sm:max-w-[420px] sm:w-full sm:flex-row sm:items-center" @submit.prevent="applyCharacterId">
              <label class="sr-only" for="character-id-input">角色 ID</label>
              <input
                id="character-id-input"
                v-model="characterIdInput"
                type="text"
                inputmode="numeric"
                placeholder="例如 3040638000"
                class="apple-input"
              >
              <button type="submit" class="apple-cta shrink-0">
                加载角色
              </button>
            </form>
          </div>
        </div>
      </section>

      <section id="studio" class="bg-page pb-12 sm:pb-16">
        <CharacterStage :key="characterStageKey" :character-id="activeCharacterId" />
      </section>
    </main>

    <footer class="bg-page px-5 pb-8 pt-0">
      <div class="mx-auto max-w-[980px] fc gap-2 border-t border-line pt-5 text-[12px] text-muted leading-[1.33] tracking-[-0.12px]">
        <span>Powered by Waaatanuki.</span>
      </div>
    </footer>
  </div>
</template>
