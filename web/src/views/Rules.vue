<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type RuleItem } from '../api';
import { toast } from '../store';

const list = ref<RuleItem[]>([]);
const showAdd = ref(false);
const form = ref({
  name: '',
  match_address: '',
  match_from: '',
  match_subject: '',
  action: 'webhook',
  target: '',
  enabled: 1,
});

const ACTIONS = [
  { value: 'webhook', label: 'Webhook（POST JSON）', hint: '填写完整 URL，收到匹配邮件时推送' },
  { value: 'telegram', label: 'Telegram 机器人', hint: '格式：<botToken>:<chatId>' },
  { value: 'forward', label: '转发到外部邮箱', hint: '填写目标邮箱地址，使用已配置通道转发' },
];

async function load() {
  try {
    list.value = await api.get<RuleItem[]>('/rule');
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function add() {
  if (!form.value.name || !form.value.target) return toast('名称与目标必填', 'err');
  try {
    await api.post('/rule', form.value);
    showAdd.value = false;
    form.value = { name: '', match_address: '', match_from: '', match_subject: '', action: 'webhook', target: '', enabled: 1 };
    toast('规则已创建');
    await load();
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function toggle(r: RuleItem) {
  await api.put(`/rule/${r.id}`, { enabled: r.enabled ? 0 : 1 });
  await load();
}

async function remove(r: RuleItem) {
  if (!confirm(`删除规则 ${r.name}？`)) return;
  await api.del(`/rule/${r.id}`);
  toast('已删除');
  await load();
}

const hint = () => ACTIONS.find((a) => a.value === form.value.action)?.hint ?? '';

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-4xl p-4 md:p-8">
    <div class="mb-5 flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-ink-900">分发规则</h1>
        <p class="mt-1 text-xs text-ink-500">收到邮件后按条件自动推送到 Telegram / Webhook / 外部邮箱</p>
      </div>
      <button class="btn-primary" @click="showAdd = true">新建规则</button>
    </div>

    <div class="grid gap-3">
      <div v-for="r in list" :key="r.id" class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-ink-900">{{ r.name }}</span>
              <span :class="r.enabled ? 'chip-ok' : 'chip-warn'">{{ r.enabled ? '启用' : '停用' }}</span>
              <span class="chip bg-sand-100 text-ink-700">
                {{ ACTIONS.find((a) => a.value === r.action)?.label ?? r.action }}
              </span>
            </div>
            <div class="mt-1.5 space-y-0.5 text-xs text-ink-500">
              <p v-if="r.match_address">收件地址包含：<b>{{ r.match_address }}</b></p>
              <p v-if="r.match_from">发件人包含：<b>{{ r.match_from }}</b></p>
              <p v-if="r.match_subject">主题包含：<b>{{ r.match_subject }}</b></p>
              <p class="truncate">目标：{{ r.target }}</p>
            </div>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <button class="btn-ghost !px-2.5 !py-1 text-xs" @click="toggle(r)">{{ r.enabled ? '停用' : '启用' }}</button>
            <button class="btn-danger !px-2.5 !py-1 text-xs" @click="remove(r)">删除</button>
          </div>
        </div>
      </div>
      <div v-if="!list.length" class="card p-8 text-center text-sm text-ink-500">
        还没有规则。新建一条，让收到的邮件自动分发到指定渠道。
      </div>
    </div>

    <div v-if="showAdd" class="fixed inset-0 z-40 grid place-items-center bg-ink-900/40 p-4" @click.self="showAdd = false">
      <div class="card w-full max-w-md p-5">
        <h2 class="mb-4 text-base font-semibold">新建分发规则</h2>
        <div class="space-y-3">
          <div>
            <label class="label">规则名称</label>
            <input v-model="form.name" class="input" placeholder="验证码转发到 Telegram" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="label">收件地址包含</label>
              <input v-model="form.match_address" class="input" placeholder="可留空" />
            </div>
            <div>
              <label class="label">发件人包含</label>
              <input v-model="form.match_from" class="input" placeholder="可留空" />
            </div>
          </div>
          <div>
            <label class="label">主题包含</label>
            <input v-model="form.match_subject" class="input" placeholder="如：验证码" />
          </div>
          <div>
            <label class="label">动作</label>
            <select v-model="form.action" class="input">
              <option v-for="a in ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
          </div>
          <div>
            <label class="label">目标</label>
            <input v-model="form.target" class="input" :placeholder="hint()" />
            <p class="mt-1 text-[11px] text-ink-500">{{ hint() }}</p>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn-ghost" @click="showAdd = false">取消</button>
          <button class="btn-primary" @click="add">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
