<script setup lang="ts">
/**
 * 站点管理 · 汇总页
 *
 * 把「发信服务商」「分发规则」「管理后台」「系统设置」合并到一处。
 * 这四块都是站点级运维入口，本来就该在同一个地方；之前分成四个菜单项，
 * 侧边栏一半都是管理项。
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Providers from './Providers.vue';
import Rules from './Rules.vue';
import Admin from './Admin.vue';
import SystemSettings from './SystemSettings.vue';

type Tab = 'providers' | 'rules' | 'admin' | 'system';

const route = useRoute();
const router = useRouter();

const tabs: { key: Tab; label: string; hint: string }[] = [
  { key: 'providers', label: '发信服务商', hint: 'Resend / SMTP 等通道，可设优先级与故障切换' },
  { key: 'rules', label: '分发规则', hint: '收信后推 Telegram / Webhook / 转发' },
  { key: 'admin', label: '用户与统计', hint: '用户列表、配额、站点数据' },
  { key: 'system', label: '系统设置', hint: '主题、登录背景、OAuth2、对象存储' },
];

function tabFromQuery(): Tab {
  const t = String(route.query.tab ?? '');
  return (['providers', 'rules', 'admin', 'system'] as const).includes(t as Tab) ? (t as Tab) : 'providers';
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
  router.replace({ query: { ...route.query, tab: t } });
}

const current = computed(() => tabs.find((t) => t.key === tab.value) ?? tabs[0]);
</script>

<template>
  <div class="mx-auto max-w-5xl p-4 md:p-8">
    <header class="mb-4">
      <h1 class="text-xl font-semibold text-ink-900">站点管理</h1>
      <p class="mt-1 text-xs text-ink-500">{{ current.hint }}</p>
    </header>

    <div class="mb-4 flex flex-wrap gap-1 rounded-lg bg-sand-100 p-1">
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

    <div class="hub">
      <Providers v-if="tab === 'providers'" />
      <Rules v-else-if="tab === 'rules'" />
      <Admin v-else-if="tab === 'admin'" />
      <SystemSettings v-else />
    </div>
  </div>
</template>

<style scoped>
.hub :deep(h1) {
  display: none;
}
.hub :deep(> div) {
  padding: 0;
  max-width: none;
  margin: 0;
}
</style>
