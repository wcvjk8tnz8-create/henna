<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { clearToken, loadConfig, loadMe, logout, store } from '../store';

const route = useRoute();
const router = useRouter();

/** 侧边栏折叠状态，记在本地，换设备互不影响 */
const COLLAPSE_KEY = 'henna.sidebar.collapsed';
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1');
function toggleSidebar() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0');
}

const isAdmin = computed(() => store.me?.role === 'admin');

/**
 * 导航项按角色区分。
 * 普通用户只给「收件箱 / 写信 / 账户设置」三样 —— 邮箱地址、服务商、
 * 规则、日志这些都是站点级的运维入口，不该暴露给普通用户。
 * 后端对管理接口另有 adminOnly 中间件，这里只是收窄入口。
 */
const navs = computed(() => [
  { to: '/', label: '收件箱', icon: 'inbox' },
  { to: '/compose', label: '写信', icon: 'send' },
  ...(isAdmin.value
    ? [
        { to: '/addresses', label: '邮箱地址', icon: 'at' },
        { to: '/providers', label: '发信服务商', icon: 'plug' },
        { to: '/rules', label: '分发规则', icon: 'route' },
        { to: '/logs', label: '发信日志', icon: 'list' },
        { to: '/analytics', label: '分析', icon: 'chart' },
        { to: '/admin', label: '管理后台', icon: 'shield' },
      ]
    : []),
  { to: '/settings', label: '账户设置', icon: 'gear' },
  ...(isAdmin.value ? [{ to: '/system', label: '系统设置', icon: 'sliders' }] : []),
]);

onMounted(async () => {
  await loadConfig();
  const me = await loadMe();
  // 兜底：token 失效时 /auth/me 会 401，这里把用户踢回登录页，
  // 避免顶着空侧边栏停在半死不活的状态
  if (!me) {
    clearToken();
    location.replace('/login');
  }
});

/** 写信页自己有「发送」，右下角按钮只在别的页面出现 */
const showComposeFab = computed(() => route.path !== '/compose');

const paths: Record<string, string> = {
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13l4-7h8l4 7v6H4v-6z',
  send: 'M3 11l18-7-7 18-2.5-7.5L3 11z',
  at: 'M12 15a3 3 0 100-6 3 3 0 000 6zm9-3v6a9 9 0 11-3.5-7.1',
  plug: 'M9 3v4M15 3v4M7 7h10v3a5 5 0 01-10 0V7zM12 15v6',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zm12-10a2 2 0 100-4 2 2 0 000 4zM8 17h8a4 4 0 000-8h-2',
  list: 'M4 6h16M4 12h16M4 18h10',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zm8-3a8 8 0 00-.2-1.7l1.7-1.3-1.7-3-2 .8a8 8 0 00-2.9-1.7L14.5 3h-3.4l-.4 2.1a8 8 0 00-2.9 1.7l-2-.8-1.7 3 1.7 1.3A8 8 0 004 12c0 .6.1 1.2.2 1.7l-1.7 1.3 1.7 3 2-.8a8 8 0 002.9 1.7l.4 2.1h3.4l.4-2.1a8 8 0 002.9-1.7l2 .8 1.7-3-1.7-1.3c.1-.5.2-1.1.2-1.7z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M20 16v4',
  collapse: 'M15 6l-6 6 6 6',
  expand: 'M9 6l6 6-6 6',
};
</script>

<template>
  <div class="flex h-full">
    <!-- 侧边栏（桌面，可折叠） -->
    <aside
      class="hidden shrink-0 flex-col border-r border-sand-200 bg-white transition-[width] duration-200 md:flex"
      :class="collapsed ? 'w-[68px]' : 'w-60'"
    >
      <!-- 头部：logo + 折叠按钮 -->
      <div class="flex items-center gap-2.5 px-4 py-5" :class="collapsed ? 'justify-center px-2' : ''">
        <img src="/logo-512.png" alt="Henna Mail" class="h-9 w-auto shrink-0" />
        <div v-if="!collapsed" class="min-w-0 flex-1 leading-tight">
          <div class="truncate text-sm font-semibold text-ink-900">{{ store.config?.appName ?? 'Henna Mail' }}</div>
          <div class="text-[11px] text-ink-500">邮箱分发系统</div>
        </div>
      </div>

      <nav class="flex-1 space-y-1 px-3">
        <RouterLink
          v-for="n in navs"
          :key="n.to"
          :to="n.to"
          class="nav-item"
          :class="{ 'nav-item-active': route.path === n.to, 'justify-center !px-0': collapsed }"
         :title="collapsed ? n.label : undefined"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8">
            <path :d="paths[n.icon]" stroke-linecap="round" />
          </svg>
          <span v-if="!collapsed">{{ n.label }}</span>
        </RouterLink>
      </nav>

      <!-- 折叠开关 -->
      <div class="border-t border-sand-200 p-2">
        <button
          class="nav-item w-full"
          :class="collapsed ? 'justify-center !px-0' : ''"
          :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="toggleSidebar"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8">
            <path :d="collapsed ? paths.expand : paths.collapse" stroke-linecap="round" />
          </svg>
          <span v-if="!collapsed">收起侧边栏</span>
        </button>
      </div>

      <div class="border-t border-sand-200 p-3">
        <div v-if="store.me" class="mb-2 px-1">
          <div v-if="!collapsed" class="truncate text-sm font-medium text-ink-900">{{ store.me.email }}</div>
          <div v-else class="mx-auto mb-1 grid h-8 w-8 place-items-center rounded-full bg-henna-50 text-[11px] font-semibold text-henna-600">
            {{ (store.me.email[0] ?? '?').toUpperCase() }}
          </div>
          <div v-if="!collapsed" class="text-[11px] text-ink-500">
            配额 {{ store.me.used }} / {{ store.me.quota }} · {{ store.me.role }}
          </div>
        </div>
        <button class="btn-ghost w-full" :class="collapsed ? '!px-0' : ''" :title="collapsed ? '退出登录' : undefined" @click="logout">
          <svg v-if="collapsed" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M15 17l5-5-5-5M20 12H9M12 3H5v18h7" stroke-linecap="round" />
          </svg>
          <span v-else>退出登录</span>
        </button>
      </div>
    </aside>

    <!-- 主区 -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 移动端顶栏 -->
      <header class="flex items-center justify-between border-b border-sand-200 bg-white px-4 py-3 md:hidden">
        <div class="flex items-center gap-2">
          <div class="grid h-8 w-8 place-items-center rounded-lg bg-henna-500" style="color: var(--brand-on, #fff)">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 7h18v10H3z" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </div>
          <span class="text-sm font-semibold">{{ store.config?.appName ?? 'Henna Mail' }}</span>
        </div>
        <button class="btn-ghost !px-2 !py-1 text-xs" @click="logout">退出</button>
      </header>

      <!-- 移动端横向导航 -->
      <nav class="flex gap-1 overflow-x-auto border-b border-sand-200 bg-white px-2 py-2 md:hidden">
        <RouterLink
          v-for="n in navs"
          :key="n.to"
          :to="n.to"
          class="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-ink-500"
          :class="route.path === n.to ? 'bg-henna-50 text-henna-600' : 'hover:bg-sand-100'"
        >
          {{ n.label }}
        </RouterLink>
      </nav>

      <main class="min-h-0 flex-1 overflow-y-auto">
        <RouterView />
      </main>
    </div>

    <!-- 右下角写信按钮（Gmail 风格） -->
    <button
      v-if="showComposeFab"
      class="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-henna-500 px-4 py-3 text-sm font-medium shadow-lg transition hover:bg-henna-600 active:bg-henna-700 md:bottom-8 md:right-8"
      style="color: var(--brand-on, #fff)"
      title="写信"
      @click="router.push('/compose')"
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14" stroke-linecap="round" />
      </svg>
      <span class="hidden sm:inline">写信</span>
    </button>
  </div>
</template>
