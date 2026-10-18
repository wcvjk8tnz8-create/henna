<script setup lang="ts">
/** 开关组件：暖赭色，不用蓝紫渐变 */
const props = defineProps<{ modelValue: boolean; label?: string; hint?: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
function toggle() {
  emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <label class="flex cursor-pointer items-center justify-between gap-3 py-1.5">
    <span class="min-w-0">
      <span class="block text-sm text-ink-900">{{ label }}</span>
      <span v-if="hint" class="mt-0.5 block text-[11px] leading-snug text-ink-500">{{ hint }}</span>
    </span>
    <button
      type="button"
      class="relative h-6 w-11 shrink-0 rounded-full transition"
      :class="modelValue ? 'bg-henna-500' : 'bg-sand-300'"
      :aria-pressed="modelValue"
      @click.prevent="toggle"
    >
      <span
        class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
        :class="modelValue ? 'left-[22px]' : 'left-0.5'"
      />
    </button>
  </label>
</template>
