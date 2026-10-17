<script setup lang="ts">
import { onMounted, ref } from 'vue';
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

onMounted(loadConfig);

async function submit() {
  if (!email.value || !password.value) return toast('请填写邮箱与密码', 'err');
  loading.value = true;
  try {
    const path = mode.value === 'login' ? '/auth/login' : '/auth/register';
    const body = mode.value === 'login' ? { email: email.value, password: password.value } : { email: email.value, password: password.value, code: code.value };
    const data = await api.post<{ token: string; user: Me }>(path, body);
    setToken(data.token);
    await loadMe();
    toast(mode.value === 'login' ? '欢迎回来' : '注册成功');
    router.push((route.query.r as string) || '/');
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-full place-items-center bg-sand-50 px-4 py-10">
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

      <div class="card p-6">
        <div class="mb-5 flex gap-1 rounded-lg bg-sand-100 p-1">
          <button
            class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition"
            :class="mode === 'login' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
            @click="mode = 'login'"
          >
            登录
          </button>
          <button
            v-if="store.config?.allowRegister !== false"
            class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition"
            :class="mode === 'register' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
            @click="mode = 'register'"
          >
            注册
          </button>
        </div>

        <form class="space-y-3.5" @submit.prevent="submit">
          <div>
            <label class="label">邮箱</label>
            <input v-model="email" class="input" type="email" placeholder="you@example.com" autocomplete="username" />
          </div>
          <div>
            <label class="label">密码</label>
            <input v-model="password" class="input" type="password" placeholder="至少 6 位" autocomplete="current-password" />
          </div>
          <div v-if="mode === 'register'">
            <label class="label">邀请码（若站点要求）</label>
            <input v-model="code" class="input" placeholder="可留空" />
          </div>

          <button class="btn-primary w-full" :disabled="loading">
            {{ loading ? '处理中…' : mode === 'login' ? '登录' : '注册' }}
          </button>
        </form>

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
