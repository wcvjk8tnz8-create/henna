<script setup lang="ts">
/**
 * 收信通道
 *
 * 域名托管在 Cloudflare → Email Routing 直接收。
 * 域名没托管到 Cloudflare → 走发信商的 inbound webhook，或者自己的接口 POST 进来。
 * 这里把两条路的 URL、密钥、配置指引、测试与日志集中在一处。
 */
import { computed, onMounted, ref } from 'vue';
import { api, type InboundConfig, type InboundLogItem, type SettingsMap } from '../api';
import { fmtDate, toast } from '../store';

const cfg = ref<InboundConfig | null>(null);
const logs = ref<InboundLogItem[]>([]);
const s = ref<SettingsMap>({});
const loading = ref(true);
const pulling = ref(false);
const testing = ref(false);
const regenerating = ref(false);
const showSecret = ref(false);
const openSource = ref<string>('resend');
const testResult = ref<string>('');
const pullResult = ref<string>('');

const statusLabel: Record<string, string> = {
  ok: '已入库',
  dropped: '已丢弃',
  duplicate: '重复',
  rejected: '垃圾拦截',
  error: '出错',
};

async function load() {
  loading.value = true;
  try {
    [cfg.value, logs.value, s.value] = await Promise.all([
      api.get<InboundConfig>('/inbound/config'),
      api.get<InboundLogItem[]>('/inbound/log?limit=30').catch(() => []),
      api.get<SettingsMap>('/system/settings'),
    ]);
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    loading.value = false;
  }
}

function copy(text: string, what = '已复制') {
  navigator.clipboard?.writeText(text);
  toast(what);
}

async function regen() {
  if (!confirm('重新生成密钥会让已填到发信商的旧 URL 立即失效，确定吗？')) return;
  regenerating.value = true;
  try {
    const r = await api.post<{ secret: string }>('/inbound/secret');
    toast('已生成新密钥，记得更新发信商那边的 webhook URL');
    await load();
    showSecret.value = true;
    void r;
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    regenerating.value = false;
  }
}

async function saveInbound() {
  try {
    await api.put('/system/settings', {
      inbound_resend_api_key: s.value.inbound_resend_api_key ?? '',
      inbound_poll_enabled: s.value.inbound_poll_enabled ?? 'false',
    });
    toast('已保存');
    await load();
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function test(spam = false) {
  testing.value = true;
  testResult.value = '';
  try {
    const r = await api.post<{ status: string; reason?: string; to: string; note?: string }>(
      '/inbound/test',
      { spam },
    );
    testResult.value = r.status === 'ok'
      ? `✓ 已投递到 ${r.to}（${spam ? '垃圾箱' : '收件箱'}）`
      : `✗ ${r.reason ?? r.status}`;
    await load();
  } catch (e) {
    testResult.value = `✗ ${(e as Error).message}`;
  } finally {
    testing.value = false;
  }
}

async function pull() {
  pulling.value = true;
  pullResult.value = '';
  try {
    const r = await api.post<{ fetched: number; results: { status: string }[] }>('/inbound/pull', { limit: 20 });
    const added = r.results.filter((x) => x.status === 'ok').length;
    const dup = r.results.filter((x) => x.status === 'duplicate').length;
    pullResult.value = `拉取 ${r.fetched} 封 · 新入库 ${added} · 重复 ${dup}`;
    await load();
  } catch (e) {
    pullResult.value = `✗ ${(e as Error).message}`;
  } finally {
    pulling.value = false;
  }
}

const curlExample = computed(() => {
  if (!cfg.value) return '';
  const u = cfg.value.sources.find((x) => x.key === 'generic')?.url ?? '';
  return `curl -X POST '${u}' \\
  -H 'Content-Type: application/json' \\
  -d '{"from":"someone@example.com","to":["you@your.domain"],"subject":"Hello","text":"郵件內容"}'`;
});

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <!-- 说明 -->
    <div class="rounded-card border border-henna-200 bg-henna-50 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="chip chip-ok">Cloudflare Email Routing</span>
        <span class="text-xs text-ink-500">域名托管在 CF 时走这条，不用配置</span>
      </div>
      <p class="mt-2 text-sm text-ink-700">
        域名<strong>没有</strong>托管到 Cloudflare？把下面任意一个 webhook 地址填到发信商，
        或者用自己的服务器 POST 到「自建接口」——信照样进收件箱，AI 垃圾侦测、附件、分发规则全部照常生效。
      </p>
    </div>

    <div v-if="loading" class="card p-8 text-center text-sm text-ink-500">加载中…</div>

    <template v-else-if="cfg">
      <!-- 密钥 -->
      <div class="card p-5">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold text-ink-900">Webhook 密钥</h2>
            <p class="mt-0.5 text-xs text-ink-500">
              {{ cfg.usingJwtFallback ? '当前复用 JWT_SECRET，开箱即用。生成独立密钥后可单独轮换，不影响登录会话。' : '独立密钥，已包含在下方各 URL 中。' }}
            </p>
          </div>
          <button class="btn-ghost !py-1.5 text-xs" :disabled="regenerating" @click="regen">
            {{ regenerating ? '生成中…' : '重新生成' }}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <code class="min-w-0 flex-1 truncate rounded-lg bg-sand-100 px-3 py-2 font-mono text-xs text-ink-700">
            {{ showSecret ? cfg.secret : '•'.repeat(Math.min(32, cfg.secret.length)) }}
          </code>
          <button class="btn-ghost !py-1.5 text-xs" @click="showSecret = !showSecret">
            {{ showSecret ? '隐藏' : '显示' }}
          </button>
          <button class="btn-ghost !py-1.5 text-xs" @click="copy(cfg.secret, '密钥已复制')">复制</button>
        </div>
        <p class="mt-2 text-[11px] text-ink-500">
          也支持请求头 <code>X-Inbound-Key</code> 或 <code>Authorization: Bearer</code>（URL 不方便带 query 时用）。
        </p>
      </div>

      <!-- 各家 webhook -->
      <div class="card overflow-hidden">
        <div class="border-b border-sand-200 px-5 py-3">
          <h2 class="text-sm font-semibold text-ink-900">发信商 webhook 地址</h2>
          <p class="mt-0.5 text-xs text-ink-500">点开看 DNS 与后台的具体配置步骤</p>
        </div>
        <div v-for="src in cfg.sources" :key="src.key" class="border-b border-sand-100 last:border-0">
          <button
            class="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-sand-50"
            @click="openSource = openSource === src.key ? '' : src.key"
          >
            <span class="flex items-center gap-2">
              <span class="chip-plain">{{ src.label }}</span>
              <span class="text-xs text-ink-500">{{ src.where }}</span>
            </span>
            <span class="text-xs text-ink-400">{{ openSource === src.key ? '收起 ▲' : '展开 ▼' }}</span>
          </button>
          <div v-if="openSource === src.key" class="bg-sand-50 px-5 pb-4 pt-1">
            <div class="flex flex-wrap items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-[11px] text-ink-700">{{ src.url }}</code>
              <button class="btn-ghost !py-1.5 text-xs" @click="copy(src.url, 'URL 已复制')">复制</button>
            </div>
            <dl class="mt-3 space-y-1.5 text-xs">
              <div class="flex gap-2"><dt class="w-16 shrink-0 text-ink-500">DNS / MX</dt><dd class="text-ink-700">{{ src.mx }}</dd></div>
              <div class="flex gap-2"><dt class="w-16 shrink-0 text-ink-500">后台位置</dt><dd class="text-ink-700">{{ src.where }}</dd></div>
              <div class="flex gap-2"><dt class="w-16 shrink-0 text-ink-500">备注</dt><dd class="text-ink-700">{{ src.note }}</dd></div>
            </dl>
            <div v-if="src.key === 'generic'" class="mt-3">
              <p class="mb-1 text-xs font-semibold text-ink-700">curl 示例</p>
              <pre class="overflow-x-auto rounded-lg bg-ink-900 p-3 font-mono text-[11px] leading-relaxed text-sand-100">{{ curlExample }}</pre>
            </div>
          </div>
        </div>
      </div>

      <!-- Resend 回拉 -->
      <div class="card p-5">
        <h2 class="text-sm font-semibold text-ink-900">Resend 正文回拉</h2>
        <p class="mt-1 text-xs text-ink-500">
          Resend 的 <code>email.received</code> 事件只给元数据，正文和附件要另调 API。
          留空会自动复用已配置的 Resend 发信服务商 API Key。
        </p>
        <div class="mt-3 flex flex-wrap items-end gap-2">
          <div class="min-w-0 flex-1">
            <label class="label">Resend API Key（可选）</label>
            <input v-model="s.inbound_resend_api_key" class="input" placeholder="留空 = 从发信服务商自动取" />
          </div>
          <label class="mb-2 flex items-center gap-2 text-xs text-ink-600">
            <input v-model="s.inbound_poll_enabled" type="checkbox" true-value="true" false-value="false" class="accent-henna-500" />
            定时拉取（每日）
          </label>
          <button class="btn-primary" @click="saveInbound">保存</button>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span class="chip" :class="cfg.resendKeyConfigured ? 'chip-ok' : 'chip-warn'">
            {{ cfg.resendKeyConfigured ? `已配置（${cfg.resendKeySource}）` : '未配置：只存元数据' }}
          </span>
          <button class="btn-ghost !py-1.5 text-xs" :disabled="pulling" @click="pull">
            {{ pulling ? '拉取中…' : '立即拉取最近 20 封' }}
          </button>
          <span v-if="pullResult" class="text-xs text-ink-600">{{ pullResult }}</span>
        </div>
      </div>

      <!-- 测试 -->
      <div class="card p-5">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold text-ink-900">端到端测试</h2>
            <p class="mt-0.5 text-xs text-ink-500">走一遍完整链路：归属匹配 → AI 侦测 → 入库 → 分发</p>
          </div>
          <div class="flex gap-2">
            <button class="btn-ghost !py-1.5 text-xs" :disabled="testing" @click="test(false)">发正常邮件</button>
            <button class="btn-ghost !py-1.5 text-xs" :disabled="testing" @click="test(true)">发垃圾邮件</button>
          </div>
        </div>
        <p v-if="testResult" class="text-xs" :class="testResult.startsWith('✓') ? 'text-henna-600' : 'text-clay-600'">{{ testResult }}</p>
      </div>

      <!-- 日志 -->
      <div class="card overflow-hidden">
        <div class="flex items-center justify-between border-b border-sand-200 px-5 py-3">
          <h2 class="text-sm font-semibold text-ink-900">入站日志</h2>
          <button class="text-xs text-ink-500 hover:text-henna-600" @click="load">刷新</button>
        </div>
        <p v-if="!logs.length" class="p-8 text-center text-sm text-ink-500">还没有收到过 webhook 投递</p>
        <table v-else class="table">
          <thead>
            <tr>
              <th class="w-28">时间</th>
              <th class="w-20">来源</th>
              <th>发件人 → 收件人</th>
              <th class="w-20">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in logs" :key="l.id">
              <td class="text-xs text-ink-500">{{ fmtDate(l.created_at) }}</td>
              <td><span class="chip-plain">{{ l.source }}</span></td>
              <td class="text-xs">
                <div class="truncate text-ink-700">{{ l.from_addr || '—' }} → {{ l.to_addr || '—' }}</div>
                <div class="truncate text-ink-500">{{ l.subject || '(无主题)' }}<span v-if="l.reason"> · {{ l.reason }}</span></div>
              </td>
              <td>
                <span class="chip" :class="l.status === 'ok' ? 'chip-ok' : l.status === 'duplicate' ? 'chip-plain' : 'chip-err'">
                  {{ statusLabel[l.status] ?? l.status }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
