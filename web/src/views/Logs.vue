<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type LogItem } from '../api';
import { fmtTime, toast } from '../store';

const items = ref<LogItem[]>([]);

onMounted(async () => {
  try {
    items.value = await api.get<LogItem[]>('/send/logs?limit=100');
  } catch (e) {
    toast((e as Error).message, 'err');
  }
});
</script>

<template>
  <div class="mx-auto max-w-5xl p-4 md:p-8">
    <h1 class="mb-5 text-xl font-semibold text-ink-900">发信日志</h1>
    <div class="card overflow-hidden">
      <table class="table">
        <thead>
          <tr>
            <th class="w-32">时间</th>
            <th class="w-28">通道</th>
            <th class="w-40">收件人</th>
            <th>主题</th>
            <th class="w-20">状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in items" :key="l.id">
            <td class="text-xs text-ink-500">{{ fmtTime(l.created_at) }}</td>
            <td class="text-xs">{{ l.provider }}</td>
            <td class="truncate text-xs">{{ l.to_addr }}</td>
            <td class="truncate">{{ l.subject }}</td>
            <td>
              <span :class="l.status === 'success' ? 'chip-ok' : 'chip-err'" :title="l.error ?? ''">
                {{ l.status === 'success' ? '成功' : '失败' }}
              </span>
            </td>
          </tr>
          <tr v-if="!items.length">
            <td colspan="5" class="py-8 text-center text-sm text-ink-500">暂无发信记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
