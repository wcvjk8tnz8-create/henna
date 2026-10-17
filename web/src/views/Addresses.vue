<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type Address } from '../api';
import { store, toast } from '../store';

const list = ref<Address[]>([]);
const local = ref('');
const domain = ref('');
const batchCount = ref(5);
const batchPrefix = ref('box');
const loading = ref(true);

const domains = () => store.config?.domains ?? [];

async function load() {
  loading.value = true;
  try {
    list.value = await api.get<Address[]>('/mailbox');
  } finally {
    loading.value = false;
  }
}

async function add() {
  if (!local.value) return toast('请填写地址前缀', 'err');
  try {
    await api.post('/mailbox', { local: local.value, domain: domain.value || undefined });
    local.value = '';
    toast('已创建');
    await load();
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function batch() {
  try {
    const r = await api.post<{ created: string[] }>('/mailbox/batch', {
      prefix: batchPrefix.value,
      count: batchCount.value,
      domain: domain.value || undefined,
    });
    toast(`已生成 ${r.created.length} 个地址`);
    await load();
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function toggle(a: Address) {
  await api.put(`/mailbox/${a.id}`, { enabled: a.enabled ? 0 : 1 });
  await load();
}

async function remove(a: Address) {
  if (!confirm(`删除地址 ${a.address}？`)) return;
  await api.del(`/mailbox/${a.id}`);
  toast('已删除');
  await load();
}

function copy(text: string) {
  navigator.clipboard?.writeText(text);
  toast('已复制');
}

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-4xl p-4 md:p-8">
    <h1 class="mb-5 text-xl font-semibold text-ink-900">邮箱地址 · 账号分发</h1>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="card p-5">
        <h2 class="mb-3 text-sm font-semibold text-ink-900">新建地址</h2>
        <div class="flex gap-2">
          <input v-model="local" class="input" placeholder="前缀，如 support" />
          <select v-if="domains().length > 1" v-model="domain" class="input w-40">
            <option v-for="d in domains()" :key="d" :value="d">@{{ d }}</option>
          </select>
          <button class="btn-primary shrink-0" @click="add">创建</button>
        </div>
        <p class="mt-2 text-xs text-ink-500">托管域名：{{ domains().join('、') || '未配置 MAIL_DOMAINS' }}</p>
      </div>

      <div class="card p-5">
        <h2 class="mb-3 text-sm font-semibold text-ink-900">批量分发</h2>
        <div class="flex flex-wrap gap-2">
          <input v-model="batchPrefix" class="input w-32" placeholder="前缀" />
          <input v-model.number="batchCount" type="number" min="1" max="100" class="input w-24" />
          <button class="btn-ghost shrink-0" @click="batch">批量生成</button>
        </div>
        <p class="mt-2 text-xs text-ink-500">一次性生成多个随机地址，适合分发给不同渠道 / 用户</p>
      </div>
    </div>

    <div class="card mt-4 overflow-hidden">
      <table class="table">
        <thead>
          <tr>
            <th>地址</th>
            <th v-if="store.me?.role === 'admin'">归属</th>
            <th class="w-24">状态</th>
            <th class="w-32 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in list" :key="a.id">
            <td class="font-mono text-[13px]">{{ a.address }}</td>
            <td v-if="store.me?.role === 'admin'" class="text-xs text-ink-500">{{ a.owner ?? '-' }}</td>
            <td>
              <span :class="a.enabled ? 'chip-ok' : 'chip-warn'">{{ a.enabled ? '启用' : '停用' }}</span>
            </td>
            <td class="text-right">
              <button class="mr-1 text-xs text-henna-600 hover:underline" @click="copy(a.address)">复制</button>
              <button class="mr-1 text-xs text-ink-500 hover:underline" @click="toggle(a)">
                {{ a.enabled ? '停用' : '启用' }}
              </button>
              <button class="text-xs text-henna-600 hover:underline" @click="remove(a)">删除</button>
            </td>
          </tr>
          <tr v-if="!list.length && !loading">
            <td colspan="4" class="py-8 text-center text-sm text-ink-500">还没有地址</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
