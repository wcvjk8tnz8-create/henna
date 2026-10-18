<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type Stats } from '../api';
import { toast } from '../store';

const s = ref<Stats | null>(null);
const loading = ref(true);
const days = ref(14);

async function load() {
  loading.value = true;
  try {
    s.value = await api.get<Stats>('/admin/stats');
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    loading.value = false;
  }
}

const rate = computed(() => {
  if (!s.value?.totalLogs) return 0;
  return Math.round((s.value.okLogs / s.value.totalLogs) * 1000) / 10;
});

/** 趋势图：纯 SVG 折线 + 面积，不用第三方图表库 */
const trend = computed(() => s.value?.trend ?? []);
const maxN = computed(() => Math.max(1, ...trend.value.map((t) => t.n)));

function points(kind: 'line' | 'area'): string {
  const w = 100;
  const h = 40;
  const n = trend.value.length;
  if (n === 0) return '';
  const step = n > 1 ? w / (n - 1) : w;
  const pts = trend.value.map((t, i) => {
    const x = (i * step).toFixed(2);
    const y = (h - (t.n / maxN.value) * h).toFixed(2);
    return `${x},${y}`;
  });
  if (kind === 'line') return pts.join(' ');
  return `0,${h} ${pts.join(' ')} ${w},${h}`;
}

const maxProvider = computed(() => Math.max(1, ...(s.value?.byProvider ?? []).map((p) => p.n)));
const maxDomain = computed(() => Math.max(1, ...(s.value?.topDomains ?? []).map((d) => d.n)));
const maxAddr = computed(() => Math.max(1, ...(s.value?.topAddresses ?? []).map((a) => a.n)));

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-4xl p-5 md:p-8">
    <header class="mb-6">
      <h1 class="text-lg font-semibold text-ink-900">分析</h1>
      <p class="mt-0.5 text-xs text-ink-500">收信、发信与服务商使用概况</p>
    </header>

    <p v-if="loading" class="py-10 text-center text-sm text-ink-500">加载中…</p>

    <div v-else-if="s" class="space-y-4">
      <!-- 概览卡片 -->
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div class="card p-4">
          <div class="text-[11px] text-ink-500">收信总数</div>
          <div class="mt-1 text-xl font-semibold text-ink-900">{{ s.inbox }}</div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] text-ink-500">发信总数</div>
          <div class="mt-1 text-xl font-semibold text-ink-900">{{ s.outbox }}</div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] text-ink-500">今日发信</div>
          <div class="mt-1 text-xl font-semibold text-ink-900">{{ s.today }}</div>
        </div>
        <div class="card p-4">
          <div class="text-[11px] text-ink-500">发信成功率</div>
          <div class="mt-1 text-xl font-semibold" :class="rate >= 95 ? 'text-jade-600' : rate >= 80 ? 'text-clay-600' : 'text-henna-600'">
            {{ rate }}%
          </div>
        </div>
      </div>

      <!-- 趋势 -->
      <section class="card p-5">
        <h2 class="mb-3 text-sm font-semibold text-ink-900">近 {{ days }} 日邮件趋势</h2>
        <div v-if="trend.length" class="relative">
          <svg viewBox="0 0 100 42" preserveAspectRatio="none" class="h-40 w-full">
            <polygon :points="points('area')" fill="#b4462f" fill-opacity="0.08" />
            <polyline :points="points('line')" fill="none" stroke="#b4462f" stroke-width="1" vector-effect="non-scaling-stroke" />
          </svg>
          <div class="mt-2 flex justify-between text-[10px] text-ink-500">
            <span v-if="trend[0]">{{ trend[0].d }}</span>
            <span v-if="trend.length > 1">{{ trend[trend.length - 1].d }}</span>
          </div>
        </div>
        <p v-else class="py-6 text-center text-xs text-ink-500">暂无数据</p>
      </section>

      <div class="grid gap-4 md:grid-cols-2">
        <!-- 服务商 -->
        <section class="card p-5">
          <h2 class="mb-3 text-sm font-semibold text-ink-900">服务商使用分布</h2>
          <div v-if="s.byProvider.length" class="space-y-2.5">
            <div v-for="p in s.byProvider" :key="p.provider">
              <div class="mb-1 flex justify-between text-xs">
                <span class="truncate">{{ p.provider }}</span>
                <span class="shrink-0 text-ink-500">{{ p.n }}</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-sand-100">
                <div class="h-full rounded-full bg-henna-500" :style="{ width: (p.n / maxProvider) * 100 + '%' }" />
              </div>
            </div>
          </div>
          <p v-else class="py-6 text-center text-xs text-ink-500">还没有发信记录</p>
        </section>

        <!-- 来源域名 -->
        <section class="card p-5">
          <h2 class="mb-3 text-sm font-semibold text-ink-900">发件域名 Top</h2>
          <div v-if="s.topDomains.length" class="space-y-2.5">
            <div v-for="d in s.topDomains" :key="d.domain">
              <div class="mb-1 flex justify-between text-xs">
                <span class="truncate">{{ d.domain }}</span>
                <span class="shrink-0 text-ink-500">{{ d.n }}</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-sand-100">
                <div class="h-full rounded-full bg-clay-500" :style="{ width: (d.n / maxDomain) * 100 + '%' }" />
              </div>
            </div>
          </div>
          <p v-else class="py-6 text-center text-xs text-ink-500">暂无数据</p>
        </section>
      </div>

      <!-- 活跃地址 -->
      <section class="card p-5">
        <h2 class="mb-3 text-sm font-semibold text-ink-900">收信最多的地址</h2>
        <div v-if="s.topAddresses.length" class="space-y-2.5">
          <div v-for="a in s.topAddresses" :key="a.address">
            <div class="mb-1 flex justify-between text-xs">
              <span class="truncate">{{ a.address }}</span>
              <span class="shrink-0 text-ink-500">{{ a.n }}</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-sand-100">
              <div class="h-full rounded-full bg-jade-500" :style="{ width: (a.n / maxAddr) * 100 + '%' }" />
            </div>
          </div>
        </div>
        <p v-else class="py-6 text-center text-xs text-ink-500">暂无数据</p>
      </section>

      <!-- 其他 -->
      <div class="grid grid-cols-3 gap-3">
        <div class="card p-4 text-center">
          <div class="text-xl font-semibold text-ink-900">{{ s.users }}</div>
          <div class="mt-0.5 text-[11px] text-ink-500">用户</div>
        </div>
        <div class="card p-4 text-center">
          <div class="text-xl font-semibold text-ink-900">{{ s.addresses }}</div>
          <div class="mt-0.5 text-[11px] text-ink-500">邮箱地址</div>
        </div>
        <div class="card p-4 text-center">
          <div class="text-xl font-semibold" :class="s.failed ? 'text-henna-600' : 'text-ink-900'">{{ s.failed }}</div>
          <div class="mt-0.5 text-[11px] text-ink-500">失败记录</div>
        </div>
      </div>
    </div>
  </div>
</template>
