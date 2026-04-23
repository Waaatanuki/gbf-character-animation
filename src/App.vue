<script setup lang="ts">
import CharacterStage from './components/CharacterStage.vue'
import ThemeModeToggle from './components/ThemeModeToggle.vue'
</script>

<template>
  <div class="bg-page text-ink min-h-svh">
    <header class="apple-nav-shell">
      <nav class="mx-auto h-12 max-w-[980px] flex items-center justify-between px-5 text-[12px] leading-[1.33] tracking-[-0.12px]">
        <a href="#overview" class="font-500 no-underline">GBF Character Animation</a>
        <ThemeModeToggle />
      </nav>
    </header>

    <main>
      <section id="overview" class="bg-page px-5 py-12 sm:py-16">
        <div class="mx-auto max-w-[980px]">
          <p class="apple-kicker m-0 text-muted">
            Overview
          </p>
          <h1 class="apple-display-section m-0 mt-4 text-ink">
            预览角色动作与导出 GIF。
          </h1>
        </div>
      </section>

      <section id="studio" class="bg-page pb-12 sm:pb-16">
        <CharacterStage />
      </section>
    </main>

    <footer class="bg-page px-5 pb-8 pt-0">
      <div class="mx-auto max-w-[980px] flex flex-col gap-2 border-t border-line pt-5 text-[12px] text-muted leading-[1.33] tracking-[-0.12px] sm:flex-row sm:items-center sm:justify-between">
        <span>Powered by CreateJS and Vue 3.</span>
        <a class="apple-link" href="https://createjs.com/" target="_blank" rel="noreferrer">CreateJS 官网 ></a>
      </div>
    </footer>
  </div>
</template>
