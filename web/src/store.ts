import { reactive, watch } from 'vue';
import { api, clearToken, type Me, type PublicConfig } from './api';
import { applyTheme, themeFromSettings } from './lib/theme';

interface State {
  me: Me | null;
  config: PublicConfig | null;
  toast: { text: string; kind: 'ok' | 'err' } | null;
}

export const store = reactive<State>({
  me: null,
  config: null,
  toast: null,
});

let timer: number | undefined;

export function toast(text: string, kind: 'ok' | 'err' = 'ok'): void {
  store.toast = { text, kind };
  window.clearTimeout(timer);
  timer = window.setTimeout(() => (store.toast = null), 3200);
}

export async function loadConfig(): Promise<void> {
  try {
    store.config = await api.get<PublicConfig>('/system/config');
  } catch {
    store.config = {
      appName: 'Henna Mail',
      domains: [],
      allowRegister: true,
      strategy: 'priority',
      attachments: false,
      settings: {},
    };
  }
}

/**
 * 配置变化即换肤。首次进入时也会触发一次，
 * 所以登录页在未登录状态下同样是站点设定的主题色。
 */
watch(
  () => store.config?.settings,
  (st) => applyTheme(themeFromSettings(st as Record<string, string> | undefined)),
  { immediate: true, deep: true },
);

export async function loadMe(): Promise<Me | null> {
  try {
    store.me = await api.get<Me>('/auth/me');
    return store.me;
  } catch {
    store.me = null;
    return null;
  }
}

export function logout(): void {
  clearToken();
  store.me = null;
  location.href = '/login';
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
