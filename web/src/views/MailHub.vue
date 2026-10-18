<script setup lang="ts">
/**
 * 邮箱 · 汇总页
 *
 * 把「邮箱地址」「发信日志」「分析」合并到一处，用 tab 切换。
 * 这三件事本来就是同一条链路：先有地址 → 用它发信 → 看发出去的效果。
 * 分开成三个菜单项时，要在侧边栏来回跳才能看全。
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Addresses from './Addresses.vue';
import Logs from './Logs.vue';
import Analytics from './Analytics.vue';

type Tab = 'addresses' | 'logs' | 'analytics';

const route = useRoute();
const router = useRouter();

const tabs: { key: Tab; label: string; hint: string }[] = [
  { key: 'addresses', label: '邮箱地址', hint: '管理发件地址、批量分发' },
  { key: 'logs', label: '发信日志', hint: '每次发信的通道与结果' },
  { key: 'analytics', label: '分析', hint: '趋势、通道分布、成功率' },
];

function tabFromQuery(): Tab {
  const t = String(route.query.tab ?? '');
  return (['addresses', 'logs', 'analytics'] as const).includes(t as Tab) ? (t as Tab) : 'addresses';
}

const tab = ref<Tab>(tabFromQuery());

watch(
  () => route.query.tab,
  () => {
    const next = tabFromQuery();
    if (next !== tab.value) tab.value = next;
  },
);

function pick(t: Tab) {
  tab.value = t;
  // 写进 query，刷新和分享链接都能回到同一个 tab
  router.replace({ query: { ...route.query, tab: t } });
}

const current = computed(() => tabs.find((t) => t.key === tab.value) ?? tabs[0]);
</script>

<template>
  <div class="mx-auto max-w-5xl p-4 md:p-8">
    <header class="mb-4">
      <h1 class="text-xl font-semibold text-ink-900">邮箱</h1>
      <p class="mt-1 text-xs text-ink-500">{{ current.hint }}</p>
    </header>

    <div class="mb-4 flex gap-1 rounded-lg bg-sand-100 p-1">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="rounded-md px-3.5 py-1.5 text-sm font-medium transition"
        :class="tab === t.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'"
        @click="pick(t.key)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 子页面自带标题，这里统一隐藏，避免和上方标题重复 -->
    <div class="hub">
      <Addresses v-if="tab === 'addresses'" />
      <Logs v-else-if="tab === 'logs'" />
      <Analytics v-else />
    </div>
  </div>
</template>

<style scoped>
.hub :deep(h1) {
  display: none;
}
/* 子页面自带的外层容器边距/宽度，合并后由父级统一控制 */
.hub :deep(> div) {
  padding: 0;
  max-width: none;
  margin: 0;
}
</style>
