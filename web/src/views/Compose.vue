<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Address, type ProviderItem } from '../api';
import { toast } from '../store';

const route = useRoute();
const router = useRouter();
const draftId = ref<number | undefined>(undefined);
const savingDraft = ref(false);

const addresses = ref<Address[]>([]);
const providers = ref<ProviderItem[]>([]);
const from = ref('');
const to = ref('');
const subject = ref('');
const body = ref('');
const mode = ref<'html' | 'text'>('html');
const bulk = ref(false);
const providerId = ref<number | undefined>(undefined);
const sending = ref(false);
const result = ref<{ success: boolean; provider: string; error?: string; attempts?: unknown } | null>(null);

onMounted(async () => {
  try {
    // scope=mine：只列自己的地址。管理员默认会拿到全站地址，
    // 那样发件人下拉里会出现别人的邮箱（后端现在也会拒绝，但选不到更干净）。
    addresses.value = await api.get<Address[]>('/mailbox?scope=mine');
    if (addresses.value[0]) from.value = addresses.value[0].address;
    providers.value = await api.get<ProviderItem[]>('/provider');

    // 从草稿箱跳转过来：回填内容
    const d = route.query.draft;
    if (d) {
      draftId.value = Number(d);
      to.value = String(route.query.to ?? '');
      subject.value = String(route.query.subject ?? '');
      body.value = String(route.query.body ?? '');
      toast('已载入草稿');
    }
  } catch (e) {
    toast((e as Error).message, 'err');
  }
});

/** 保存草稿（有 id 则更新，否则新建） */
async function saveDraft() {
  if (!to.value && !subject.value && !body.value) return toast('内容为空，无需保存', 'err');
  savingDraft.value = true;
  try {
    const r = await api.post<{ id: number }>('/message/draft', {
      id: draftId.value,
      to: to.value,
      subject: subject.value,
      from: from.value,
      text: mode.value === 'text' ? body.value : undefined,
      html: mode.value === 'html' ? body.value : undefined,
    });
    draftId.value = r.id;
    toast('草稿已保存', 'ok');
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    savingDraft.value = false;
  }
}

/** 发送成功后清掉草稿 */
async function dropDraft() {
  if (!draftId.value) return;
  await api.del(`/message/draft/${draftId.value}`).catch(() => undefined);
  draftId.value = undefined;
}

const recipients = () =>
  to.value
    .split(/[\s,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

async function send() {
  const list = recipients();
  if (!from.value) return toast('请选择发件地址', 'err');
  if (!list.length) return toast('请填写收件人', 'err');
  if (!subject.value) return toast('请填写主题', 'err');
  sending.value = true;
  result.value = null;
  try {
    const payload = {
      from: from.value,
      to: list,
      subject: subject.value,
      html: mode.value === 'html' ? body.value : undefined,
      text: mode.value === 'text' ? body.value : undefined,
      providerId: providerId.value,
    };
    if (bulk.value && list.length > 1) {
      const r = await api.post<{ total: number; success: number; failed: number }>('/send/bulk', payload);
      result.value = { success: r.failed === 0, provider: `批量 ${r.success}/${r.total} 成功` };
      toast(`群发完成：成功 ${r.success} / 失败 ${r.failed}`, r.failed === 0 ? 'ok' : 'err');
    } else {
      const r = await api.post<{ success: boolean; provider: string; error?: string; attempts?: unknown }>('/send', payload);
      result.value = r;
      toast(r.success ? '发送成功' : `发送失败：${r.error ?? '未知错误'}`, r.success ? 'ok' : 'err');
      if (r.success) {
        await dropDraft();
        router.push('/');
      }
    }
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl p-4 md:p-8">
    <h1 class="mb-5 text-xl font-semibold text-ink-900">写信 · 邮件分发</h1>

    <div class="card p-5">
      <div class="grid gap-4 md:grid-cols-2">
        <div>
          <label class="label">发件地址</label>
          <select v-model="from" class="input">
            <option v-for="a in addresses" :key="a.id" :value="a.address">{{ a.address }}</option>
          </select>
          <p v-if="!addresses.length" class="mt-1 text-xs text-clay-600">还没有可用地址，请先到「邮箱 → 邮箱地址」创建</p>
        </div>
        <div>
          <label class="label">发信服务商</label>
          <select v-model="providerId" class="input">
            <option :value="undefined">按策略自动选择</option>
            <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}（{{ p.label }}）</option>
          </select>
        </div>
      </div>

      <div class="mt-4">
        <label class="label">收件人（逗号 / 换行分隔，可多个）</label>
        <textarea v-model="to" rows="2" class="input resize-y" placeholder="a@example.com, b@example.com"></textarea>
        <p class="mt-1 text-xs text-ink-500">已识别 {{ recipients().length }} 个收件人</p>
      </div>

      <div class="mt-4">
        <label class="label">主题</label>
        <input v-model="subject" class="input" placeholder="邮件主题" />
      </div>

      <div class="mt-4">
        <div class="mb-1 flex items-center justify-between">
          <label class="label !mb-0">正文</label>
          <div class="flex gap-1 rounded-lg bg-sand-100 p-0.5">
            <button
              class="rounded px-2.5 py-1 text-xs font-medium"
              :class="mode === 'html' ? 'bg-white text-ink-900' : 'text-ink-500'"
              @click="mode = 'html'"
            >
              HTML
            </button>
            <button
              class="rounded px-2.5 py-1 text-xs font-medium"
              :class="mode === 'text' ? 'bg-white text-ink-900' : 'text-ink-500'"
              @click="mode = 'text'"
            >
              纯文本
            </button>
          </div>
        </div>
        <textarea v-model="body" rows="10" class="input resize-y font-mono text-[13px]" placeholder="<p>你好</p>"></textarea>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-4">
        <label class="flex items-center gap-2 text-sm text-ink-700">
          <input v-model="bulk" type="checkbox" class="accent-henna-500" />
          逐个分发（收件人互不可见）
        </label>
        <button class="btn-primary ml-auto" :disabled="sending" @click="send">
          {{ sending ? '发送中…' : bulk ? '开始群发' : '发送' }}
        </button>
        <button class="btn-ghost" :disabled="savingDraft" @click="saveDraft">
          {{ savingDraft ? '保存中…' : '存草稿' }}
        </button>
      </div>
    </div>

    <div v-if="result" class="card mt-4 p-4 text-sm">
      <div class="flex items-center gap-2">
        <span :class="result.success ? 'chip-ok' : 'chip-err'">{{ result.success ? '成功' : '失败' }}</span>
        <span class="text-ink-700">使用通道：{{ result.provider }}</span>
      </div>
      <p v-if="result.error" class="mt-2 text-xs text-henna-600">{{ result.error }}</p>
      <details v-if="result.attempts" class="mt-2">
        <summary class="cursor-pointer text-xs text-ink-500">查看尝试明细</summary>
        <pre class="mt-2 overflow-auto rounded bg-sand-100 p-2 text-[11px]">{{ result.attempts }}</pre>
      </details>
    </div>
  </div>
</template>
