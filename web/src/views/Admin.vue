<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type AdminUser, type Stats } from '../api';
import { fmtTime, store, toast } from '../store';

const stats = ref<Stats | null>(null);
const users = ref<AdminUser[]>([]);
/** admin@ 前缀的账号恒为管理员 */
function isProtected(email: string): boolean {
  return String(email ?? '').trim().toLowerCase().split('@')[0] === 'admin';
}


const maxTrend = computed(() => Math.max(1, ...(stats.value?.trend ?? []).map((t) => t.n)));

async function load() {
  try {
    stats.value = await api.get<Stats>('/admin/stats');
    users.value = await api.get<AdminUser[]>('/admin/users');
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function updateUser(u: AdminUser, patch: Record<string, unknown>) {
  await api.put(`/admin/users/${u.id}`, patch);
  toast('已更新');
  await load();
}

async function removeUser(u: AdminUser) {
  if (!confirm(`删除用户 ${u.email}？其邮箱地址也会一并删除。`)) return;
  await api.del(`/admin/users/${u.id}`);
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
  <div class="mx-auto max-w-5xl p-4 md:p-8">
    <h1 class="mb-5 text-xl font-semibold text-ink-900">管理后台</h1>

    <!-- 统计 -->
    <div v-if="stats" class="grid grid-cols-2 gap-3 md:grid-cols-3">
      <div v-for="c in [
        { k: '用户', v: stats.users },
        { k: '收信', v: stats.inbox },
        { k: '发信', v: stats.outbox },
        { k: '邮箱地址', v: stats.addresses },
        { k: '可用通道', v: stats.providers },
        { k: '失败记录', v: stats.failed },
      ]" :key="c.k" class="card p-4">
        <div class="text-xs text-ink-500">{{ c.k }}</div>
        <div class="mt-1 text-2xl font-semibold text-ink-900">{{ c.v }}</div>
      </div>
    </div>

    <!-- 趋势 -->
    <div v-if="stats?.trend?.length" class="card mt-4 p-5">
      <h2 class="mb-3 text-sm font-semibold text-ink-900">近 14 日邮件量</h2>
      <div class="flex h-28 items-end gap-1.5">
        <div v-for="t in stats.trend" :key="t.d" class="flex flex-1 flex-col items-center gap-1">
          <div
            class="w-full rounded-t bg-henna-500"
            :style="{ height: `${Math.max(4, (t.n / maxTrend) * 88)}px` }"
            :title="`${t.d}: ${t.n}`"
          ></div>
          <span class="text-[10px] text-ink-500">{{ t.d.slice(5) }}</span>
        </div>
      </div>
    </div>

    <!-- 用户 -->
    <div class="card mt-4 overflow-hidden">
      <div class="border-b border-sand-200 px-4 py-3">
        <h2 class="text-sm font-semibold text-ink-900">用户</h2>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>邮箱</th>
            <th class="w-24">角色</th>
            <th class="w-28">配额</th>
            <th class="w-24">状态</th>
            <th class="w-24">注册</th>
            <th class="w-28 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="truncate">{{ u.email }}</td>
            <td>
              <select
                class="rounded border border-sand-200 px-1.5 py-1 text-xs"
                :value="u.role"
                :disabled="isProtected(u.email) || u.id === store.me?.id"
                :title="isProtected(u.email) ? 'admin@ 前缀的账号恒为管理员，不可降级' : u.id === store.me?.id ? '不能修改自己的角色' : undefined"
                @change="updateUser(u, { role: ($event.target as HTMLSelectElement).value })"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </td>
            <td class="text-xs">{{ u.used }} / <input class="w-14 rounded border border-sand-200 px-1 text-xs" :value="u.quota" @change="updateUser(u, { quota: Number(($event.target as HTMLInputElement).value) })" /></td>
            <td>
              <span :class="u.status === 'active' ? 'chip-ok' : 'chip-err'">{{ u.status }}</span>
            </td>
            <td class="text-xs text-ink-500">{{ fmtTime(u.created_at) }}</td>
            <td class="text-right">
              <button v-if="u.id !== store.me?.id" class="text-xs text-henna-600 hover:underline" @click="removeUser(u)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
