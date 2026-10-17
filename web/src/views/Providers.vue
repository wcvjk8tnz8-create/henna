<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type ProviderItem, type ProviderMeta } from '../api';
import { store, toast } from '../store';

const items = ref<ProviderItem[]>([]);
const metas = ref<ProviderMeta[]>([]);
const showAdd = ref(false);
const editing = ref<ProviderItem | null>(null);
const kind = ref('resend');
const name = ref('');
const form = ref<Record<string, string>>({});
const weight = ref(100);
const testTo = ref('');

const isAdmin = computed(() => store.me?.role === 'admin');
const meta = computed(() => metas.value.find((m) => m.kind === kind.value));

async function load() {
  try {
    items.value = await api.get<ProviderItem[]>('/provider');
    if (!metas.value.length) metas.value = await api.get<ProviderMeta[]>('/provider/meta');
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

function resetForm() {
  kind.value = 'resend';
  name.value = '';
  form.value = {};
  weight.value = 100;
}

async function create() {
  if (!meta.value) return;
  for (const f of meta.value.fields) {
    if (f.required && !form.value[f.key]) return toast(`缺少必填项：${f.label}`, 'err');
  }
  try {
    await api.post('/provider', { name: name.value, kind: kind.value, config: form.value, weight: weight.value, enabled: 1 });
    showAdd.value = false;
    resetForm();
    toast('服务商已添加');
    await load();
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

function startEdit(p: ProviderItem) {
  editing.value = p;
  form.value = { ...p.config };
  weight.value = p.weight;
  name.value = p.name;
}

async function saveEdit() {
  if (!editing.value) return;
  try {
    await api.put(`/provider/${editing.value.id}`, { name: name.value, config: form.value, weight: weight.value });
    editing.value = null;
    toast('已保存');
    await load();
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function toggle(p: ProviderItem) {
  await api.put(`/provider/${p.id}`, { enabled: p.enabled ? 0 : 1 });
  await load();
}

async function remove(p: ProviderItem) {
  if (!confirm(`删除服务商 ${p.name}？`)) return;
  await api.del(`/provider/${p.id}`);
  toast('已删除');
  await load();
}

async function test(p: ProviderItem) {
  if (!testTo.value) return toast('请填写测试收件人', 'err');
  try {
    const r = await api.post<{ success: boolean; error?: string }>(`/provider/${p.id}/test`, { to: testTo.value });
    toast(r.success ? `${p.name} 连通正常` : `失败：${r.error}`, r.success ? 'ok' : 'err');
    await load();
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-4xl p-4 md:p-8">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-ink-900">发信服务商</h1>
        <p class="mt-1 text-xs text-ink-500">
          调度策略：<b class="text-henna-600">{{ store.config?.strategy === 'round_robin' ? '轮询平摊' : '优先级 + 自动故障转移' }}</b>
          · 失败会自动切换到下一个可用通道
        </p>
      </div>
      <button v-if="isAdmin" class="btn-primary" @click="showAdd = true">添加服务商</button>
    </div>

    <div class="card mb-4 p-4">
      <label class="label">发送连通性测试的目标邮箱</label>
      <div class="flex gap-2">
        <input v-model="testTo" class="input" placeholder="test@example.com" />
      </div>
    </div>

    <!-- 通道卡片 -->
    <div class="grid gap-3 md:grid-cols-2">
      <div v-for="p in items" :key="p.id" class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-ink-900">{{ p.name }}</span>
              <span :class="p.enabled ? 'chip-ok' : 'chip-warn'">{{ p.enabled ? '启用' : '停用' }}</span>
            </div>
            <div class="mt-0.5 text-xs text-ink-500">{{ p.label }} · 权重 {{ p.weight }}</div>
          </div>
          <span class="shrink-0 rounded-lg bg-sand-100 px-2 py-1 text-xs text-ink-700">今日 {{ p.daily_used }} 封</span>
        </div>

        <p v-if="p.last_error" class="mt-2 truncate text-xs text-henna-600" :title="p.last_error">
          最近错误：{{ p.last_error }}
        </p>

        <div v-if="isAdmin" class="mt-3 flex flex-wrap gap-1.5">
          <button class="btn-ghost !px-2.5 !py-1 text-xs" @click="startEdit(p)">编辑</button>
          <button class="btn-ghost !px-2.5 !py-1 text-xs" @click="toggle(p)">{{ p.enabled ? '停用' : '启用' }}</button>
          <button class="btn-ghost !px-2.5 !py-1 text-xs" @click="test(p)">测试</button>
          <button class="btn-danger !px-2.5 !py-1 text-xs" @click="remove(p)">删除</button>
        </div>
      </div>
      <div v-if="!items.length" class="card p-8 text-center text-sm text-ink-500 md:col-span-2">
        还没有配置发信服务商，添加后即可发信
      </div>
    </div>

    <!-- 新增面板 -->
    <div v-if="showAdd" class="fixed inset-0 z-40 grid place-items-center bg-ink-900/40 p-4" @click.self="showAdd = false">
      <div class="card w-full max-w-md p-5">
        <h2 class="mb-4 text-base font-semibold">添加发信服务商</h2>
        <div class="space-y-3">
          <div>
            <label class="label">类型</label>
            <select v-model="kind" class="input" @change="form = {}">
              <option v-for="m in metas" :key="m.kind" :value="m.kind">{{ m.label }}</option>
            </select>
          </div>
          <div>
            <label class="label">备注名称</label>
            <input v-model="name" class="input" :placeholder="meta?.label" />
          </div>
          <div v-for="f in meta?.fields ?? []" :key="f.key">
            <label class="label">{{ f.label }}<span v-if="f.required" class="text-henna-500"> *</span></label>
            <select v-if="f.type === 'select'" v-model="form[f.key]" class="input">
              <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <input v-else v-model="form[f.key]" class="input" :type="f.type" :placeholder="f.placeholder" />
            <p v-if="f.hint" class="mt-1 text-[11px] text-ink-500">{{ f.hint }}</p>
          </div>
          <div>
            <label class="label">权重（越大越优先）</label>
            <input v-model.number="weight" type="number" class="input" />
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn-ghost" @click="showAdd = false">取消</button>
          <button class="btn-primary" @click="create">保存</button>
        </div>
      </div>
    </div>

    <!-- 编辑面板 -->
    <div v-if="editing" class="fixed inset-0 z-40 grid place-items-center bg-ink-900/40 p-4" @click.self="editing = null">
      <div class="card w-full max-w-md p-5">
        <h2 class="mb-4 text-base font-semibold">编辑 · {{ editing.name }}</h2>
        <div class="space-y-3">
          <div>
            <label class="label">备注名称</label>
            <input v-model="name" class="input" />
          </div>
          <div>
            <label class="label">权重</label>
            <input v-model.number="weight" type="number" class="input" />
          </div>
          <template v-for="m in metas.filter((x) => x.kind === editing?.kind)" :key="m.kind">
            <div v-for="f in m.fields" :key="f.key">
              <label class="label">{{ f.label }}</label>
              <select v-if="f.type === 'select'" v-model="form[f.key]" class="input">
                <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <input v-else v-model="form[f.key]" class="input" :type="f.type" :placeholder="f.placeholder" />
              <p class="mt-1 text-[11px] text-ink-500">密钥留空表示不修改</p>
            </div>
          </template>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn-ghost" @click="editing = null">取消</button>
          <button class="btn-primary" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
