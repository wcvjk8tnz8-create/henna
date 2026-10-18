<script setup lang="ts">
import { computed } from 'vue';
import { api } from '../api';
import { fmtTime, logout, store, toast } from '../store';

const me = computed(() => store.me);
const quotaPct = computed(() => (me.value ? Math.min(100, Math.round((me.value.used / Math.max(1, me.value.quota)) * 100)) : 0));

async function newKey() {
  const r = await api.post<{ api_key: string }>('/auth/api-key');
  if (store.me) store.me.api_key = r.api_key;
  toast('已重新生成 API Key');
}

function copy(text: string) {
  navigator.clipboard?.writeText(text);
  toast('已复制');
}

const curl = computed(() => `curl -X POST ${location.origin}/api/send \\
  -H "X-Api-Key: ${me.value?.api_key ?? '<your key>'}" \\
  -H 'Content-Type: application/json' \\
  -d '{"from":"${store.config?.domains?.[0] ? 'you@' + store.config.domains[0] : 'you@example.com'}","to":["a@b.com"],"subject":"hi","html":"<b>hi</b>"}'`);
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 md:p-8">
    <h1 class="mb-5 text-xl font-semibold text-ink-900">账户设置</h1>

    <div class="card p-5">
      <div class="flex items-center gap-3">
        <div class="grid h-11 w-11 place-items-center rounded-full bg-henna-100 text-base font-semibold text-henna-600">
          {{ (me?.email ?? '?')[0]?.toUpperCase() }}
        </div>
        <div>
          <div class="text-sm font-semibold text-ink-900">{{ me?.email }}</div>
          <div class="text-xs text-ink-500">{{ me?.role }} · 注册于 {{ me ? fmtTime(me.id && Date.now()) : '' }}</div>
        </div>
      </div>

      <div class="mt-5">
        <div class="mb-1 flex justify-between text-xs text-ink-500">
          <span>今日发信配额</span>
          <span>{{ me?.used }} / {{ me?.quota }}</span>
        </div>
        <div class="h-2 overflow-hidden rounded-full bg-sand-200">
          <div class="h-full bg-henna-500" :style="{ width: `${quotaPct}%` }"></div>
        </div>
      </div>
    </div>

    <div class="card mt-4 p-5">
      <h2 class="mb-2 text-sm font-semibold text-ink-900">API Key</h2>
      <p class="mb-3 text-xs text-ink-500">用于开放接口调用，请求头带上 <code class="rounded bg-sand-100 px-1">X-Api-Key</code></p>
      <div class="flex gap-2">
        <input :value="me?.api_key ?? ''" readonly class="input font-mono text-xs" />
        <button class="btn-ghost shrink-0" @click="copy(me?.api_key ?? '')">复制</button>
        <button class="btn-ghost shrink-0" @click="newKey">重新生成</button>
      </div>
      <pre class="mt-3 overflow-auto rounded-lg bg-sand-100 p-3 text-[11px] leading-relaxed">{{ curl }}</pre>
    </div>

    <div v-if="!store.config?.attachments" class="card mt-4 border-clay-400/40 bg-clay-500/5 p-5">
      <h2 class="mb-2 text-sm font-semibold text-ink-900">附件存储未启用</h2>
      <p class="mb-3 text-xs leading-relaxed text-ink-500">
        当前没有绑定 R2，收到的邮件附件只保存文件名与大小，不保存内容。
        收信、发信、规则分发不受影响。绑一个 R2 桶再重新部署一次即可开启。
      </p>
      <pre class="overflow-auto rounded-lg bg-sand-100 p-3 text-[11px] leading-relaxed"># 仓库 Secrets 里加一行
R2_BUCKET_NAME = henna-mail-r2      # 你的桶名，留空则自动创建

# 然后重新运行 deploy 工作流</pre>
    </div>

    <div class="card mt-4 p-5">
      <h2 class="mb-3 text-sm font-semibold text-ink-900">系统信息</h2>
      <dl class="space-y-2 text-xs">
        <div class="flex justify-between border-b border-sand-100 pb-2">
          <dt class="text-ink-500">托管域名</dt>
          <dd>{{ store.config?.domains?.join('、') || '-' }}</dd>
        </div>
        <div class="flex justify-between border-b border-sand-100 pb-2">
          <dt class="text-ink-500">调度策略</dt>
          <dd>{{ store.config?.strategy }}</dd>
        </div>
        <div class="flex justify-between border-b border-sand-100 pb-2">
          <dt class="text-ink-500">附件存储（R2）</dt>
          <dd>
            <span :class="store.config?.attachments ? 'chip-ok' : 'chip-warn'">
              {{ store.config?.attachments ? '已启用' : '未启用' }}
            </span>
          </dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-ink-500">运行环境</dt>
          <dd>Cloudflare Workers · D1 / KV / R2</dd>
        </div>
      </dl>
    </div>

    <button class="btn-danger mt-4 w-full" @click="logout">退出登录</button>
  </div>
</template>
