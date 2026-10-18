<script setup lang="ts">
/**
 * 全部收件箱（仅管理员）
 *
 * 和「收件箱」是两回事：
 *  - 收件箱 `/` —— 每个人都只看自己的，管理员也不例外
 *  - 全部收件箱 `/all` —— 管理员专用，看全站所有人的收信
 *
 * 后端靠 `scope=all` 区分，且仅管理员生效（普通用户传了也按自己的返回）。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { api, type MailDetail, type MailItem } from '../api';
import { fmtSize, fmtTime, toast } from '../store';

const box = ref<'in' | 'out'>('in');
const starOnly = ref(false);
const items = ref<MailItem[]>([]);
const detail = ref<MailDetail | null>(null);
const q = ref('');
const loading = ref(false);
/** 只看某个用户的信，空 = 全部 */
const owner = ref('');

const owners = computed(() => {
  const set = new Set<string>();
  for (const m of items.value) if (m.owner) set.add(m.owner);
  return Array.from(set).sort();
});

const shown = computed(() => (owner.value ? items.value.filter((m) => m.owner === owner.value) : items.value));

async function load() {
  loading.value = true;
  try {
    const qs = new URLSearchParams({ box: box.value, q: q.value, scope: 'all' });
    if (starOnly.value) qs.set('star', '1');
    items.value = await api.get<MailItem[]>(`/message?${qs}`);
    if (owner.value && !owners.value.includes(owner.value)) owner.value = '';
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    loading.value = false;
  }
}

async function open(id: number) {
  try {
    detail.value = await api.get<MailDetail>(`/message/${id}`);
    const it = items.value.find((i) => i.id === id);
    if (it) it.is_read = 1;
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function remove(id: number) {
  if (!confirm('确认删除该邮件？此操作不可撤销。')) return;
  await api.del(`/message/${id}`);
  detail.value = null;
  toast('已删除');
  await load();
}

async function star() {
  if (!detail.value) return;
  const next = detail.value.is_star ? 0 : 1;
  await api.post(`/message/${detail.value.id}/star`, { star: next });
  detail.value.is_star = next;
}

function initial(owner?: string) {
  return (owner ?? '?')[0]?.toUpperCase() ?? '?';
}

const safeHtml = computed(() => detail.value?.html_body ?? '');

const emptyText = computed(() => {
  if (starOnly.value) return '还没有星标邮件';
  if (box.value === 'out') return '还没有发送记录';
  return '暂无邮件';
});

watch([box, starOnly], load);
onMounted(load);
</script>

<template>
  <div class="flex h-full">
    <!-- 列表 -->
    <section class="flex w-full flex-col md:w-[380px] md:shrink-0 md:border-r md:border-sand-200">
      <div class="border-b border-sand-200 bg-white px-4 py-3">
        <div class="flex items-center gap-2">
          <div class="flex gap-1 rounded-lg bg-sand-100 p-1">
            <button
              class="rounded-md px-3 py-1 text-xs font-medium"
              :class="box === 'in' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
              @click="box = 'in'"
            >
              收信
            </button>
            <button
              class="rounded-md px-3 py-1 text-xs font-medium"
              :class="box === 'out' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
              @click="box = 'out'"
            >
              发信
            </button>
          </div>
          <button
            class="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition"
            :class="starOnly ? 'border-clay-400 bg-clay-500/10 text-clay-600' : 'border-sand-200 text-ink-500'"
            @click="starOnly = !starOnly"
          >
            ★ 星标
          </button>
        </div>

        <div class="mt-2 flex items-center gap-2">
          <input v-model="q" class="input !py-1.5 text-xs" placeholder="搜索主题 / 地址" @keyup.enter="load" />
          <select v-if="owners.length" v-model="owner" class="input !py-1.5 !text-xs">
            <option value="">全部用户</option>
            <option v-for="o in owners" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>

        <p class="mt-2 text-[11px] text-ink-500">共 {{ shown.length }} 封 · {{ owners.length }} 个用户</p>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="!shown.length && !loading" class="p-8 text-center">
          <svg viewBox="0 0 24 24" class="mx-auto h-12 w-12 text-sand-300" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
          </svg>
          <p class="mt-3 text-sm text-ink-500">{{ emptyText }}</p>
        </div>
        <button
          v-for="m in shown"
          :key="m.id"
          class="block w-full border-b border-sand-100 px-4 py-3 text-left transition hover:bg-sand-100"
          :class="detail?.id === m.id ? 'bg-henna-50' : ''"
          @click="open(m.id)"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="truncate text-sm" :class="m.is_read ? 'font-normal text-ink-700' : 'font-semibold text-ink-900'">
              {{ box === 'in' ? m.from_name || m.from_addr : m.to_addr }}
            </span>
            <span class="shrink-0 text-[11px] text-ink-500">{{ fmtTime(m.created_at) }}</span>
          </div>
          <div class="mt-0.5 truncate text-sm text-ink-700">{{ m.subject || '(无主题)' }}</div>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
            <span class="chip-plain">{{ m.owner ?? '—' }}</span>
            <span>{{ fmtSize(m.size) }}</span>
            <span v-if="m.is_star" class="text-clay-500">★</span>
            <span v-if="!m.is_read" class="chip-warn">未读</span>
          </div>
        </button>
      </div>
    </section>

    <!-- 详情 -->
    <section class="hidden min-w-0 flex-1 flex-col md:flex">
      <div v-if="!detail" class="grid flex-1 place-items-center px-6 text-center text-sm text-ink-500">
        <div>
          <svg viewBox="0 0 24 24" class="mx-auto mb-3 h-10 w-10 text-sand-300" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7h18v10H3z" /><path d="M3 7l9 6 9-6" />
          </svg>
          选择一封邮件查看内容
        </div>
      </div>
      <template v-else>
        <div class="flex items-start justify-between gap-4 border-b border-sand-200 bg-white px-6 py-4">
          <div class="flex min-w-0 items-start gap-3">
            <div
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-henna-100 text-xs font-semibold text-henna-600"
            >
              {{ initial(detail.owner) }}
            </div>
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold text-ink-900">{{ detail.subject || '(无主题)' }}</h2>
              <p class="mt-1 text-xs text-ink-500">
                发件人 {{ detail.from_name || detail.from_addr }} &lt;{{ detail.from_addr }}&gt; · 收件人
                {{ detail.to_addr }}
              </p>
              <p v-if="detail.owner" class="mt-0.5 text-xs text-ink-500">归属账号 {{ detail.owner }}</p>
            </div>
          </div>
          <div class="flex shrink-0 gap-2">
            <button class="btn-ghost !px-2.5 !py-1.5 text-xs" @click="star">
              {{ detail.is_star ? '取消星标' : '星标' }}
            </button>
            <button class="btn-danger !px-2.5 !py-1.5 text-xs" @click="remove(detail.id)">删除</button>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-6">
          <div
            v-if="detail.html_body"
            class="prose prose-sm max-w-none rounded-card border border-sand-200 bg-white p-5"
            v-html="safeHtml"
          ></div>
          <pre v-else class="whitespace-pre-wrap rounded-card border border-sand-200 bg-white p-5 font-sans text-sm">{{ detail.text_body }}</pre>

          <div v-if="detail.attachments?.length" class="mt-4 card p-4">
            <div class="mb-2 text-xs font-semibold text-ink-500">附件 {{ detail.attachments.length }}</div>
            <a
              v-for="a in detail.attachments"
              :key="a.id"
              :href="`/api/message/attachment/${a.id}`"
              target="_blank"
              class="mr-2 inline-block rounded-lg border border-sand-200 px-3 py-1.5 text-xs text-henna-600 hover:bg-henna-50"
            >
              {{ a.name }} · {{ fmtSize(a.size) }}
            </a>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>
