<script setup lang="ts">
/**
 * 邮箱输入：local part + 域名后缀。
 *
 * 域名数量为 1 时后缀固定显示在框内右侧（不可选）；
 * 多于 1 时变成下拉，默认收起、点箭头展开 —— 照 Cloud Mail 的交互。
 *
 * 一旦用户自己输入了 `@`，就切到「完整地址」模式：后缀提示收起，
 * 以用户输入的为准（他要登录外部域名邮箱时不会被拼接破坏）。
 */
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    domains?: string[];
    /** 隐藏域名（站点设置 hide_login_domain） */
    hideDomain?: boolean;
    placeholder?: string;
    autocomplete?: string;
    id?: string;
  }>(),
  { domains: () => [], autocomplete: 'username' },
);

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const list = computed(() => (props.domains ?? []).filter((d) => !!d));
const multi = computed(() => list.value.length > 1);
const hasDomain = computed(() => list.value.length > 0 && !props.hideDomain);

/** 用户看到/编辑的部分：完整地址模式下就是整串 */
const typed = ref('');
const domain = ref(list.value[0] ?? '');
const open = ref(false);

/** 是否已经输入了 @ —— 有则视为完整地址 */
const isFull = computed(() => typed.value.includes('@'));

/** 是否展示后缀（有域名、未隐藏、且不是完整地址模式） */
const showSuffix = computed(() => hasDomain.value && !isFull.value);

watch(
  () => props.domains,
  (d) => {
    const l = (d ?? []).filter((x) => !!x);
    if (!l.includes(domain.value)) domain.value = l[0] ?? '';
  },
  { immediate: true, deep: true },
);

/** 外部赋值（如切换登录/注册模式后清空）时同步进来 */
watch(
  () => props.modelValue,
  (v) => {
    if (v === compose()) return;
    if (!v) {
      typed.value = '';
      return;
    }
    const at = v.lastIndexOf('@');
    if (at > 0 && list.value.includes(v.slice(at + 1))) {
      typed.value = v.slice(0, at);
      domain.value = v.slice(at + 1);
    } else {
      typed.value = v;
    }
  },
  { immediate: true },
);

function compose(): string {
  const t = typed.value.trim();
  if (!t) return '';
  if (t.includes('@')) return t;
  return showSuffix.value ? `${t}@${domain.value}` : t;
}

function onInput(e: Event) {
  typed.value = (e.target as HTMLInputElement).value;
  emit('update:modelValue', compose());
}

function pick(d: string) {
  domain.value = d;
  open.value = false;
  emit('update:modelValue', compose());
}

const suffixText = computed(() => `@${domain.value}`);

/** 下拉里的每一项 */
function isActive(d: string) {
  return d === domain.value;
}
</script>

<template>
  <div class="relative">
    <input
      :id="id"
      :value="typed"
      :placeholder="placeholder || (showSuffix ? '用户名' : 'you@example.com')"
      :autocomplete="autocomplete"
      class="input"
      :class="showSuffix && multi ? 'pr-24' : showSuffix ? 'pr-[var(--suffix-w)]' : ''"
      :style="showSuffix && !multi ? ({ '--suffix-w': `${suffixText.length * 8 + 20}px` } as Record<string, string>) : undefined"
      type="text"
      inputmode="email"
      autocapitalize="off"
      spellcheck="false"
      @input="onInput"
      @keydown.esc="open = false"
    />

    <!-- 单域名：固定后缀，不可点 -->
    <span
      v-if="showSuffix && !multi"
      data-testid="suffix"
      class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-sm text-ink-500"
    >
      {{ suffixText }}
    </span>

    <!-- 多域名：默认收起，点箭头展开 -->
    <div v-else-if="showSuffix && multi" class="absolute inset-y-0 right-0 flex items-center">
      <button
        type="button"
        class="flex h-full items-center gap-0.5 rounded-r-lg pl-2 pr-2.5 text-sm text-ink-700 transition hover:bg-sand-100"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span data-testid="suffix" class="max-w-[7rem] truncate">{{ suffixText }}</span>
        <svg
          viewBox="0 0 24 24"
          class="h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform"
          :class="open ? 'rotate-180' : ''"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M6 9l6 6 6-6" stroke-linecap="round" />
        </svg>
      </button>

      <Transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="opacity-0 -translate-y-1"
        leave-active-class="transition duration-75 ease-in"
        leave-to-class="opacity-0"
      >
        <ul
          v-if="open"
          class="absolute right-0 top-full z-20 mt-1 max-h-52 w-48 overflow-y-auto rounded-lg border border-sand-200 bg-white py-1 shadow-lg"
        >
          <li v-for="d in list" :key="d">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-sand-100"
              :class="isActive(d) ? 'text-henna-600' : 'text-ink-700'"
              @click="pick(d)"
            >
              <span class="truncate">@{{ d }}</span>
              <svg
                v-if="isActive(d)"
                viewBox="0 0 24 24"
                class="h-3.5 w-3.5 shrink-0"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
              >
                <path d="M5 13l4 4L19 7" stroke-linecap="round" />
              </svg>
            </button>
          </li>
        </ul>
      </Transition>
    </div>

    <!-- 点击面板其他地方收起 -->
    <div v-if="open" class="fixed inset-0 z-10" @click="open = false" />
  </div>
</template>
