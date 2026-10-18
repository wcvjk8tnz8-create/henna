<script setup lang="ts">
/**
 * 根组件：只负责「渲染当前路由」+ 全局 Toast。
 *
 * 侧边栏、移动端顶栏、右下角写信按钮都在 views/Layout.vue 里，
 * 由路由决定是否挂载 —— 这样未登录的 /login 就不会被套进那层壳子。
 */
import { RouterView } from 'vue-router';
import { store } from './store';
</script>

<template>
  <RouterView />

  <!-- Toast：全局，登录页也要能用 -->
  <div
    v-if="store.toast"
    class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm shadow-lg"
    :class="store.toast.kind === 'ok' ? 'bg-jade-600 text-white' : 'bg-henna-600'"
    :style="store.toast.kind === 'ok' ? {} : { color: 'var(--brand-on, #fff)' }"
  >
    {{ store.toast.text }}
  </div>
</template>
