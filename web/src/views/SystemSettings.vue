<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, type SettingsMap, type StorageStatus } from '../api';
import { store, toast } from '../store';
import Toggle from '../components/Toggle.vue';
import Section from '../components/Section.vue';

const s = ref<SettingsMap>({});
const loading = ref(true);
const saving = ref(false);
const storage = ref<StorageStatus | null>(null);
const bgUploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

/* ── 布尔字段的读写助手 ─────────────────────────────── */
const flag = (k: string) => computed({
  get: () => s.value[k] === 'true',
  set: (v: boolean) => { s.value[k] = v ? 'true' : 'false'; },
});

const allowRegister = flag('allow_register');
const requireInvite = flag('require_invite');
const hideLoginDomain = flag('hide_login_domain');
const multiAddress = flag('multi_address');
const noticeEnabled = flag('site_notice_enabled');
const turnstileEnabled = flag('turnstile_enabled');
const turnstileLogin = flag('turnstile_login');
const turnstileRegister = flag('turnstile_register');
const github = flag('oauth_github_enabled');
const google = flag('oauth_google_enabled');
const linuxdo = flag('oauth_linuxdo_enabled');
const tg = flag('push_telegram_enabled');
const wh = flag('push_webhook_enabled');
const fwd = flag('push_forward_enabled');
const aiEnabled = flag('ai_enabled');

const isAdmin = computed(() => store.me?.role === 'admin');

async function load() {
  loading.value = true;
  try {
    s.value = await api.get<SettingsMap>('/system/settings');
    if (isAdmin.value) {
      storage.value = await api.get<StorageStatus>('/system/storage').catch(() => null);
    }
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    loading.value = false;
  }
}

async function save(keys?: string[]) {
  saving.value = true;
  try {
    const patch: SettingsMap = {};
    const src = keys ?? Object.keys(s.value);
    for (const k of src) patch[k] = s.value[k];
    const r = await api.put<{ settings: SettingsMap }>('/system/settings', patch);
    s.value = r.settings;
    toast('已保存', 'ok');
    if (keys?.some((k) => k.startsWith('storage_') || k.startsWith('s3_'))) {
      storage.value = await api.get<StorageStatus>('/system/storage').catch(() => null);
    }
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    saving.value = false;
  }
}

async function resetAll() {
  if (!confirm('确定要把所有设置恢复为默认值吗？密钥会被清空。')) return;
  try {
    const r = await api.post<{ settings: SettingsMap }>('/system/settings/reset');
    s.value = r.settings;
    toast('已恢复默认', 'ok');
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

/* ── 登录背景上传 ───────────────────────────────────── */
async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) return toast('图片不能超过 4MB', 'err');
  bgUploading.value = true;
  try {
    const b64 = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('读取失败'));
      fr.readAsDataURL(file);
    });
    const r = await api.post<{ url: string; hint?: string }>('/system/upload', {
      data: b64,
      mime: file.type,
    });
    s.value.login_bg = r.url;
    await save(['login_bg']);
    if (r.hint) toast(r.hint, 'err');
  } catch (err) {
    toast((err as Error).message, 'err');
  } finally {
    bgUploading.value = false;
    if (input) input.value = '';
  }
}

const opacityPercent = computed({
  get: () => Math.round(Number(s.value.login_opacity || 0.92) * 100),
  set: (v: number) => { s.value.login_opacity = String(v / 100); },
});

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-3xl p-5 md:p-8">
    <header class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-lg font-semibold text-ink-900">系统设置</h1>
        <p class="mt-0.5 text-xs text-ink-500">站点外观、登录方式、人机验证与存储配置</p>
      </div>
      <div class="flex shrink-0 gap-2">
        <button class="btn-ghost" :disabled="saving" @click="load">重新加载</button>
        <button class="btn-primary" :disabled="saving" @click="save()">
          {{ saving ? '保存中…' : '保存全部' }}
        </button>
      </div>
    </header>

    <p v-if="loading" class="py-10 text-center text-sm text-ink-500">加载中…</p>

    <div v-else class="space-y-4">
      <!-- ── 基本设置 ─────────────────────────────── -->
      <Section title="基本设置" desc="控制注册与邮箱地址的分配方式">
        <div class="mb-3">
          <label class="label">网站标题</label>
          <input v-model="s.site_title" class="input" placeholder="Henna Mail" />
        </div>
        <div class="space-y-0.5">
          <Toggle v-model="allowRegister" label="开放用户注册" hint="关闭后新用户无法自助注册" />
          <Toggle v-model="requireInvite" label="注册需邀请码" />
          <Toggle v-model="hideLoginDomain" label="隐藏登录域名" hint="邮箱地址列表中不显示域名部分" />
          <Toggle v-model="multiAddress" label="多号模式" hint="允许用户创建多个邮箱地址" />
        </div>
        <div v-if="multiAddress" class="mt-3">
          <label class="label">每用户地址上限</label>
          <input v-model="s.multi_address_limit" class="input w-32" type="number" min="1" max="999" />
        </div>
      </Section>

      <!-- ── 网站公告 ─────────────────────────────── -->
      <Section title="网站公告" desc="开启后用户登录时弹出提示">
        <Toggle v-model="noticeEnabled" label="启用公告弹窗" />
        <textarea
          v-if="noticeEnabled"
          v-model="s.site_notice_content"
          class="input mt-3 min-h-[88px]"
          placeholder="公告内容，支持纯文本"
        />
      </Section>

      <!-- ── 个性化 ───────────────────────────────── -->
      <Section title="个性化" desc="登录页左半边的背景与右侧面板样式">
        <div class="mb-3">
          <label class="label">登录背景</label>
          <select v-model="s.login_bg_mode" class="input">
            <option value="builtin">内置晴空（默认，无需联网）</option>
            <option value="custom">自定义图片（链接或上传）</option>
            <option value="api">每日一图（外部接口）</option>
          </select>
        </div>

        <template v-if="s.login_bg_mode === 'custom'">
          <label class="label">图片地址</label>
          <div class="flex flex-wrap items-center gap-2">
            <input v-model="s.login_bg" class="input flex-1" placeholder="在线图片链接，或点击下方上传" />
            <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onPickFile" />
            <button class="btn-ghost" :disabled="bgUploading" @click="fileInput?.click()">
              {{ bgUploading ? '上传中…' : '本地上传' }}
            </button>
          </div>
          <div v-if="s.login_bg" class="mt-3 overflow-hidden rounded-lg border border-sand-200">
            <img :src="s.login_bg" alt="登录背景预览" class="h-32 w-full object-cover" />
          </div>
          <p class="mt-1.5 text-[11px] text-ink-500">
            上传优先写入对象存储；未配置存储时小图（≤512KB）会内联保存。加载失败会自动回退到内置晴空。
          </p>
        </template>

        <div v-else-if="s.login_bg_mode === 'api'" class="space-y-1.5">
          <label class="label">图片接口地址</label>
          <input v-model="s.login_bg_api" class="input" placeholder="https://..." />
          <p class="text-[11px] leading-relaxed text-ink-500">
            返回一张图片的公开接口即可，每次刷新都会重新请求。
            注意：这会向第三方暴露访客 IP，介意的话请用前两种。
          </p>
        </div>

        <!-- 内置云层的配色与动态 -->
        <template v-if="s.login_bg_mode === 'builtin'">
          <div class="mt-4 rounded-lg border border-sand-200 p-3">
            <p class="mb-3 text-[11px] leading-relaxed text-ink-500">
              内置背景是 WebGL 云层（Aceternity UI · Cloud Shader）。
              不支持 WebGL 的设备会自动回退到 CSS 版晴空，不会白屏。
            </p>
            <div class="grid gap-3 md:grid-cols-3">
              <div>
                <label class="label">天空顶部</label>
                <div class="flex items-center gap-2">
                  <input v-model="s.login_shader_sky_top" type="color" class="h-8 w-8 shrink-0 rounded border border-sand-300" />
                  <input v-model="s.login_shader_sky_top" class="input" placeholder="#3876ba" />
                </div>
              </div>
              <div>
                <label class="label">天空底部</label>
                <div class="flex items-center gap-2">
                  <input v-model="s.login_shader_sky_bottom" type="color" class="h-8 w-8 shrink-0 rounded border border-sand-300" />
                  <input v-model="s.login_shader_sky_bottom" class="input" placeholder="#8cbfe8" />
                </div>
              </div>
              <div>
                <label class="label">云朵颜色</label>
                <div class="flex items-center gap-2">
                  <input v-model="s.login_shader_cloud" type="color" class="h-8 w-8 shrink-0 rounded border border-sand-300" />
                  <input v-model="s.login_shader_cloud" class="input" placeholder="#fbf8f2" />
                </div>
              </div>
            </div>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label class="label">云朵数量 · {{ s.login_shader_count || '6' }}</label>
                <input v-model="s.login_shader_count" type="range" min="1" max="6" step="1" class="w-full accent-henna-500" />
              </div>
              <div>
                <label class="label">漂移速度 · {{ s.login_shader_speed || '1' }}×</label>
                <input v-model="s.login_shader_speed" type="range" min="0" max="3" step="0.1" class="w-full accent-henna-500" />
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                class="btn-ghost !px-2.5 !py-1 text-xs"
                @click="s.login_shader_sky_top = '#3876ba'; s.login_shader_sky_bottom = '#8cbfe8'; s.login_shader_cloud = '#fbf8f2'"
              >
                默认晴空
              </button>
              <button
                class="btn-ghost !px-2.5 !py-1 text-xs"
                @click="s.login_shader_sky_top = '#1b2a4a'; s.login_shader_sky_bottom = '#5b7aa8'; s.login_shader_cloud = '#dfe6f2'"
              >
                暮色
              </button>
              <button
                class="btn-ghost !px-2.5 !py-1 text-xs"
                @click="s.login_shader_sky_top = '#b4462f'; s.login_shader_sky_bottom = '#e8a87c'; s.login_shader_cloud = '#fdf3ea'"
              >
                暖赭（品牌色）
              </button>
            </div>
          </div>
        </template>

        <div class="mt-4">
          <label class="label">右侧面板不透明度 · {{ opacityPercent }}%</label>
          <input v-model.number="opacityPercent" type="range" min="40" max="100" class="w-full accent-henna-500" />
        </div>
      </Section>

      <!-- ── Turnstile ────────────────────────────── -->
      <Section title="Turnstile 人机验证" desc="由 Cloudflare 提供，密钥在 Cloudflare 控制台申请">
        <Toggle v-model="turnstileEnabled" label="启用人机验证" />
        <template v-if="turnstileEnabled">
          <div class="mt-2 space-y-0.5">
            <Toggle v-model="turnstileLogin" label="登录时验证" />
            <Toggle v-model="turnstileRegister" label="注册时验证" />
          </div>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label class="label">Site Key</label>
              <input v-model="s.turnstile_site_key" class="input" placeholder="0x4AAAAAAA..." />
            </div>
            <div>
              <label class="label">Secret Key</label>
              <input v-model="s.turnstile_secret_key" class="input" placeholder="0x4AAAAAAA..." />
              <p class="mt-1 text-[11px] text-ink-500">保存后仅显示后四位</p>
            </div>
          </div>
        </template>
      </Section>

      <!-- ── OAuth2 ───────────────────────────────── -->
      <Section title="OAuth2 第三方登录" desc="回调地址填 https://你的域名/api/oauth/&lt;provider&gt;/callback">
        <div class="space-y-4">
          <div class="rounded-lg border border-sand-200 p-3">
            <Toggle v-model="github" label="GitHub" />
            <div v-if="github" class="mt-2 grid gap-2 md:grid-cols-2">
              <input v-model="s.oauth_github_client_id" class="input" placeholder="Client ID" />
              <input v-model="s.oauth_github_secret" class="input" placeholder="Client Secret" />
            </div>
          </div>
          <div class="rounded-lg border border-sand-200 p-3">
            <Toggle v-model="google" label="Google" />
            <div v-if="google" class="mt-2 grid gap-2 md:grid-cols-2">
              <input v-model="s.oauth_google_client_id" class="input" placeholder="Client ID" />
              <input v-model="s.oauth_google_secret" class="input" placeholder="Client Secret" />
            </div>
          </div>
          <div class="rounded-lg border border-sand-200 p-3">
            <Toggle v-model="linuxdo" label="LinuxDo" />
            <div v-if="linuxdo" class="mt-2 grid gap-2 md:grid-cols-2">
              <input v-model="s.oauth_linuxdo_client_id" class="input" placeholder="Client ID" />
              <input v-model="s.oauth_linuxdo_secret" class="input" placeholder="Client Secret" />
            </div>
          </div>
        </div>
      </Section>

      <!-- ── 消息推送 ─────────────────────────────── -->
      <Section title="消息推送" desc="全局默认通道，用户的分发规则优先于此">
        <div class="space-y-4">
          <div class="rounded-lg border border-sand-200 p-3">
            <Toggle v-model="tg" label="Telegram 机器人" />
            <div v-if="tg" class="mt-2 grid gap-2 md:grid-cols-2">
              <input v-model="s.telegram_bot_token" class="input" placeholder="Bot Token" />
              <input v-model="s.telegram_chat_id" class="input" placeholder="Chat ID" />
            </div>
          </div>
          <div class="rounded-lg border border-sand-200 p-3">
            <Toggle v-model="wh" label="Webhook" />
            <input v-if="wh" v-model="s.webhook_url" class="input mt-2" placeholder="https://..." />
          </div>
          <div class="rounded-lg border border-sand-200 p-3">
            <Toggle v-model="fwd" label="转发到第三方邮箱" />
            <template v-if="fwd">
              <div class="mt-2 grid gap-2 md:grid-cols-2">
                <input v-model="s.forward_email" class="input" placeholder="目标邮箱" />
                <select v-model="s.forward_mode" class="input">
                  <option value="rule">仅按规则转发</option>
                  <option value="all">全部转发</option>
                </select>
              </div>
            </template>
          </div>
        </div>
      </Section>

      <!-- ── 对象存储 ─────────────────────────────── -->
      <Section title="对象存储" desc="附件与登录背景的存放位置">
        <div class="mb-3">
          <label class="label">存储类型</label>
          <select v-model="s.storage_type" class="input">
            <option value="r2">R2（Cloudflare 绑定）</option>
            <option value="s3">S3 兼容</option>
            <option value="none">不启用</option>
          </select>
        </div>
        <div v-if="storage" class="mb-3 rounded-lg bg-sand-100 p-3 text-[11px] leading-relaxed">
          <div>
            当前生效：
            <span :class="storage.effective === 'none' ? 'chip-warn' : 'chip-ok'">
              {{ storage.effective === 'none' ? '未启用' : storage.effective === 'r2' ? 'R2' : 'S3' }}
            </span>
            <span class="ml-2 text-ink-500">R2 绑定：{{ storage.r2Bound ? '是' : '否' }}</span>
          </div>
          <p class="mt-1 text-ink-500">{{ storage.hint }}</p>
        </div>
        <div class="mb-3">
          <label class="label">访问域名</label>
          <input v-model="s.storage_public_domain" class="input" placeholder="https://img.example.com" />
        </div>
        <div v-if="s.storage_type === 's3'" class="grid gap-3 md:grid-cols-2">
          <div>
            <label class="label">端点</label>
            <input v-model="s.s3_endpoint" class="input" placeholder="https://xxx.r2.cloudflarestorage.com" />
          </div>
          <div>
            <label class="label">区域</label>
            <input v-model="s.s3_region" class="input" placeholder="auto" />
          </div>
          <div>
            <label class="label">桶名</label>
            <input v-model="s.s3_bucket" class="input" />
          </div>
          <div>
            <label class="label">Access Key</label>
            <input v-model="s.s3_access_key" class="input" />
          </div>
          <div class="md:col-span-2">
            <label class="label">Secret Key</label>
            <input v-model="s.s3_secret_key" class="input" />
          </div>
        </div>
      </Section>

      <!-- ── Workers AI ───────────────────────────── -->
      <Section title="Workers AI" desc="用 AI 识别登录验证码图片的内容">
        <Toggle v-model="aiEnabled" label="启用验证码识别" />
        <template v-if="aiEnabled">
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label class="label">模型</label>
              <input v-model="s.ai_model" class="input" placeholder="@cf/llava-hf/llava-1.5-7b-hf" />
            </div>
            <div>
              <label class="label">Account ID</label>
              <input v-model="s.ai_account_id" class="input" placeholder="留空用环境变量" />
            </div>
            <div class="md:col-span-2">
              <label class="label">API Token</label>
              <input v-model="s.ai_api_token" class="input" placeholder="留空用环境变量" />
            </div>
          </div>
        </template>
      </Section>

      <!-- ── 关于 ─────────────────────────────────── -->
      <Section title="关于">
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between border-b border-sand-100 pb-2">
            <dt class="text-ink-500">版本</dt>
            <dd class="font-medium">v1.0.0</dd>
          </div>
          <div class="flex justify-between border-b border-sand-100 pb-2">
            <dt class="text-ink-500">发信调度</dt>
            <dd>{{ store.config?.strategy ?? 'priority' }}</dd>
          </div>
          <div class="flex justify-between border-b border-sand-100 pb-2">
            <dt class="text-ink-500">托管域名</dt>
            <dd>{{ store.config?.domains?.join('、') || '未配置' }}</dd>
          </div>
        </dl>
        <div class="mt-4 flex flex-wrap gap-2">
          <a class="btn-ghost" href="https://github.com/wcvjk8tnz8-create/henna" target="_blank" rel="noreferrer">Github</a>
          <button class="btn-ghost" @click="resetAll">恢复默认设置</button>
        </div>
      </Section>
    </div>
  </div>
</template>
