<script setup lang="ts">
/** 设置区块容器：标题 + 说明 + 内容 */
defineProps<{ title: string; desc?: string }>();
</script>

<template>
  <section class="card p-5">
    <header class="mb-4">
      <h2 class="text-sm font-semibold text-ink-900">{{ title }}</h2>
      <p v-if="desc" class="mt-0.5 text-[11px] leading-relaxed text-ink-500">{{ desc }}</p>
    </header>
    <slot />
  </section>
</template>
