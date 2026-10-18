<script setup lang="ts">
/**
 * 邀请码 · 账号分发（独立页）
 *
 * 之前这些控件塞在「管理后台」里，和用户列表、统计混在一起。
 * 现在单独成页 —— 分发是高频操作，不该每次都翻过一堆统计卡片去找。
 */
import { computed, onMounted, ref } from 'vue';
import { api, type Invite } from '../api';
import { fmtTime, toast } from '../store';

const invites = ref<Invite[]>([]);
const loading = ref(true);
const form = ref({ count: 5, quota: 50, role: 'user', maxUse: 1, days: 7 });
const justCodes = ref<string[]>([]);
/** 筛选：全部 / 未用完 / 已用完 / 已过期 */
const filter = ref<'all' | 'active' | 'used' | 'expired'>('all');

const now = Date.now();

function stateOf(i: Invite): 'active' | 'used' | 'expired' {
  if (i.expire_at && i.expire_at < now) return 'expired';
  if (i.used >= i.max_use) return 'used';
  return 'active';
}

const shown = computed(() =>
  filter.value === 'all' ? invites.value : invites.value.filter((i) => stateOf(i) === filter.value),
);

const counts = computed(() => ({
  all: invites.value.length,
  active: invites.value.filter((i) => stateOf(i) === 'active').length,
  used: invites.value.filter((i) => stateOf(i) === 'used').length,
  expired: invites.value.filter((i) => stateOf(i) === 'expired').length,
}));

async function load() {
  loading.value = true;
  try {
    invites.value = await api.get<Invite[]>('/admin/invite');
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    loading.value = false;
  }
}

async function gen() {
  try {
    const r = await api.post<{ codes: string[] }>('/admin/invite', form.value);
    justCodes.value = r.codes;
    toast(`已生成 ${r.codes.length} 个邀请码`);
    await load();
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function remove(i: Invite) {
  await api.del(`/admin/invite/${i.id}`);
  await load();
}

async function clearAll() {
  if (!confirm('清空全部邀请码？已发出的码会立即失效，此操作不可撤销。')) return;
  const r = await api.post<{ deleted: number }>('/admin/invite/clear');
  justCodes.value = [];
  toast(`已清空 ${r.deleted} 个邀请码`);
  await load();
}

function copy(text: string) {
  navigator.clipboard?.writeText(text);
  toast('已复制');
}

async function copyAll() {
  const text = justCodes.value.length ? justCodes.value.join('\n') : shown.value.map((i) => i.code).join('\n');
  if (!text) return toast('没有可复制的邀请码', 'err');
  navigator.clipboard?.writeText(text);
  toast(`已复制 ${text.split('\n').length} 个`);
}

const label: Record<string, string> = { active: '可用', used: '已用完', expired: '已过期' };

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-4xl p-4 md:p-8">
    <header class="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-ink-900">邀请码 · 账号分发</h1>
        <p class="mt-1 text-xs text-ink-500">批量生成带配额和有效期的邀请码，用来开放注册。</p>
      </div>
      <button v-if="invites.length" class="btn-danger !py-1.5 text-xs" @click="clearAll">清空全部</button>
    </header>

    <!-- 生成 -->
    <div class="card p-5">
      <h2 class="mb-3 text-sm font-semibold text-ink-900">生成</h2>
      <div class="flex flex-wrap items-end gap-2">
        <div>
          <label class="label">数量</label>
          <input v-model.number="form.count" type="number" min="1" max="200" class="input w-20" />
        </div>
        <div>
          <label class="label">配额(封/日)</label>
          <input v-model.number="form.quota" type="number" class="input w-24" />
        </div>
        <div>
          <label class="label">角色</label>
          <select v-model="form.role" class="input w-24">
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div>
          <label class="label">可用次数</label>
          <input v-model.number="form.maxUse" type="number" min="1" class="input w-20" />
        </div>
        <div>
          <label class="label">有效期(天)</label>
          <input v-model.number="form.days" type="number" class="input w-20" />
        </div>
        <button class="btn-primary" @click="gen">生成</button>
      </div>

      <div v-if="justCodes.length" class="mt-4 rounded-lg border border-henna-200 bg-henna-50 p-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-semibold text-henna-600">本次生成（点击复制）</span>
          <button class="text-xs text-ink-500 hover:text-henna-600" @click="copyAll">复制全部</button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="c in justCodes"
            :key="c"
            class="rounded-lg border border-sand-200 bg-white px-2.5 py-1 font-mono text-xs text-ink-700 hover:border-henna-300"
            @click="copy(c)"
          >
            {{ c }}
          </button>
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div class="card mt-4 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-sand-200 px-4 py-3">
        <div class="flex gap-1 rounded-lg bg-sand-100 p-1">
          <button
            v-for="k in (['all', 'active', 'used', 'expired'] as const)"
            :key="k"
            class="rounded-md px-3 py-1 text-xs font-medium"
            :class="filter === k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
            @click="filter = k"
          >
            {{ k === 'all' ? '全部' : label[k] }} {{ counts[k] }}
          </button>
        </div>
        <button v-if="shown.length" class="text-xs text-ink-500 hover:text-henna-600" @click="copyAll">
          复制当前列表
        </button>
      </div>

      <div v-if="!shown.length" class="p-8 text-center">
        <svg viewBox="0 0 24 24" class="mx-auto h-10 w-10 text-sand-300" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M15 3h4a2 2 0 012 2v4M9 21H5a2 2 0 01-2-2v-4" />
          <path d="M10 17l6-6M16 11h-4v4" />
        </svg>
        <p class="mt-3 text-sm text-ink-500">{{ loading ? '加载中…' : '暂无邀请码' }}</p>
      </div>

      <table v-else class="table">
        <thead>
          <tr>
            <th class="w-40">邀请码</th>
            <th class="w-20">状态</th>
            <th class="w-24">已用/上限</th>
            <th class="w-20">角色</th>
            <th class="w-24">配额</th>
            <th>有效期至</th>
            <th class="w-16"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in shown" :key="i.id">
            <td>
              <button class="font-mono text-xs text-henna-600 hover:underline" @click="copy(i.code)">
                {{ i.code }}
              </button>
            </td>
            <td>
              <span
                class="chip"
                :class="stateOf(i) === 'active' ? 'chip-ok' : stateOf(i) === 'used' ? 'chip-plain' : 'chip-err'"
              >
                {{ label[stateOf(i)] }}
              </span>
            </td>
            <td class="text-xs text-ink-600">{{ i.used }} / {{ i.max_use }}</td>
            <td class="text-xs text-ink-600">{{ i.role }}</td>
            <td class="text-xs text-ink-600">{{ i.quota }}</td>
            <td class="text-xs text-ink-500">{{ i.expire_at ? fmtTime(i.expire_at) : '长期有效' }}</td>
            <td>
              <button class="text-xs text-ink-400 hover:text-henna-600" @click="remove(i)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
