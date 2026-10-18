<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, setToken, type Me } from '../api';
import { loadConfig, loadMe, store, toast } from '../store';

const router = useRouter();
const route = useRoute();
const mode = ref<'login' | 'register'>('login');
const email = ref('');
const password = ref('');
const code = ref('');
const loading = ref(false);
const turnstileToken = ref('');
const showNotice = ref(false);

const st = computed(() => store.config?.settings ?? {});
const bg = computed(() => st.value.login_bg || '');
const opacity = computed(() => Number(st.value.login_opacity || 0.92));

/** 隐藏登录域名：邮箱输入框不给域名提示 */
const emailPlaceholder = computed(() =>
  st.value.hide_login_domain === 'true' ? '请输入邮箱' : 'you@example.com',
);

const oauthList = computed(() => [
  { key: 'github', label: 'GitHub', on: st.value.oauth_github_enabled === 'true' },
  { key: 'google', label: 'Google', on: st.value.oauth_google_enabled === 'true' },
  { key: 'linuxdo', label: 'LinuxDo', on: st.value.oauth_linuxdo_enabled === 'true' },
].filter((x) => x.on));

const needTurnstile = computed(() => {
  if (st.value.turnstile_enabled !== 'true') return false;
  if (!st.value.turnstile_site_key) return false;
  return mode.value === 'login' ? st.value.turnstile_login === 'true' : st.value.turnstile_register === 'true';
});

/* ── Turnstile 挂载 ────────────────────────────────── */
const tsEl = ref<HTMLDivElement | null>(null);
let tsWidgetId: string | null = null;

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement | string, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
    };
  }
}

function mountTurnstile() {
  if (!needTurnstile.value || !tsEl.value) return;
  const render = () => {
    if (!window.turnstile || !tsEl.value) return;
    tsWidgetId = window.turnstile.render(tsEl.value, {
      sitekey: st.value.turnstile_site_key,
      theme: 'light',
      callback: (t: string) => { turnstileToken.value = t; },
      'error-callback': () => { turnstileToken.value = ''; },
      'expired-callback': () => { turnstileToken.value = ''; },
    });
  };
  if (window.turnstile) return render();
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  script.async = true;
  script.onload = render;
  document.head.appendChild(script);
}

onMounted(async () => {
  await loadConfig();
  if (st.value.site_notice_enabled === 'true' && st.value.site_notice_content) {
    showNotice.value = true;
  }
  mountTurnstile();
});

async function submit() {
  if (!email.value || !password.value) return toast('请填写邮箱与密码', 'err');
  if (needTurnstile.value && !turnstileToken.value) return toast('请先完成人机验证', 'err');
  loading.value = true;
  try {
    const path = mode.value === 'login' ? '/auth/login' : '/auth/register';
    const body =
      mode.value === 'login'
        ? { email: email.value, password: password.value, turnstileToken: turnstileToken.value }
        : { email: email.value, password: password.value, code: code.value, turnstileToken: turnstileToken.value };
    const data = await api.post<{ token: string; user: Me }>(path, body);
    setToken(data.token);
    await loadMe();
    toast(mode.value === 'login' ? '欢迎回来' : '注册成功');
    router.push((route.query.r as string) || '/');
  } catch (e) {
    toast((e as Error).message, 'err');
    if (window.turnstile && tsWidgetId) window.turnstile.reset(tsWidgetId);
  } finally {
    loading.value = false;
  }
}

function switchMode(m: 'login' | 'register') {
  mode.value = m;
  turnstileToken.value = '';
  if (window.turnstile && tsWidgetId) window.turnstile.reset(tsWidgetId);
}

function oauthLogin(key: string) {
  window.location.href = `/api/oauth/${key}/authorize`;
}
</script>

<template>
  <div class="relative grid min-h-full place-items-center px-4 py-10">
    <!-- 登录背景 -->
    <div
      v-if="bg"
      class="fixed inset-0 -z-10 bg-cover bg-center"
      :style="{ backgroundImage: `url(${bg})` }"
    />
    <div v-if="bg" class="fixed inset-0 -z-10 bg-sand-900/20" />
    <div v-else class="fixed inset-0 -z-10 bg-sand-50" />

    <!-- 网站公告 -->
    <div
      v-if="showNotice"
      class="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 p-4"
      @click.self="showNotice = false"
    >
      <div class="card max-w-md p-5">
        <h2 class="mb-2 text-sm font-semibold text-ink-900">站点公告</h2>
        <p class="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{{ st.site_notice_content }}</p>
        <button class="btn-primary mt-4 w-full" @click="showNotice = false">知道了</button>
      </div>
    </div>

    <div class="w-full max-w-sm">
      <div class="mb-6 flex items-center justify-center gap-3">
        <div class="grid h-11 w-11 place-items-center rounded-xl bg-henna-500 text-white shadow-sm">
          <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7h18v10H3z" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </div>
        <div class="text-left leading-tight">
          <h1 class="text-lg font-semibold text-ink-900">{{ store.config?.appName ?? 'Henna Mail' }}</h1>
          <p class="text-xs text-ink-500">Cloudflare Workers · 邮箱分发系统</p>
        </div>
      </div>

      <div class="card p-6" :style="bg ? { backgroundColor: `rgba(255,255,255,${opacity})`, backdropFilter: 'blur(8px)' } : {}">
        <div class="mb-5 flex gap-1 rounded-lg bg-sand-100 p-1">
          <button
            class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition"
            :class="mode === 'login' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            v-if="store.config?.allowRegister !== false"
            class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition"
            :class="mode === 'register' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>

        <form class="space-y-3.5" @submit.prevent="submit">
          <div>
            <label class="label">邮箱</label>
            <input v-model="email" class="input" type="email" :placeholder="emailPlaceholder" autocomplete="username" />
          </div>
          <div>
            <label class="label">密码</label>
            <input v-model="password" class="input" type="password" placeholder="至少 6 位" autocomplete="current-password" />
          </div>
          <div v-if="mode === 'register'">
            <label class="label">邀请码（若站点要求）</label>
            <input v-model="code" class="input" placeholder="可留空" />
          </div>

          <div v-show="needTurnstile" ref="tsEl" class="flex justify-center"></div>

          <button class="btn-primary w-full" :disabled="loading">
            {{ loading ? '处理中…' : mode === 'login' ? '登录' : '注册' }}
          </button>
        </form>

        <div v-if="oauthList.length" class="mt-4">
          <div class="mb-2 flex items-center gap-2">
            <span class="h-px flex-1 bg-sand-200" />
            <span class="text-[11px] text-ink-500">或使用第三方登录</span>
            <span class="h-px flex-1 bg-sand-200" />
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="o in oauthList"
              :key="o.key"
              class="btn-ghost flex-1"
              @click="oauthLogin(o.key)"
            >
              {{ o.label }}
            </button>
          </div>
        </div>

        <p v-if="mode === 'register'" class="mt-4 text-center text-xs text-ink-500">
          首个注册的账号将自动成为管理员
        </p>
      </div>

      <p class="mt-5 text-center text-[11px] text-ink-500">
        Workers · D1 · KV · R2 · 多服务商发信
      </p>
    </div>
  </div>
</template>
