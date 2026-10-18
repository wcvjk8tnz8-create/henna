<script setup lang="ts">
/**
 * 内置登录背景：晴空渐变 + 云。
 * 纯 SVG/CSS，不请求任何外部资源 —— 离线、零延迟、无隐私外泄。
 * 管理员可在「系统设置 → 个性化」换成自定义图片或每日一图接口。
 */
const props = withDefaults(defineProps<{ dim?: number }>(), { dim: 0 });
</script>

<template>
  <div class="absolute inset-0 overflow-hidden">
    <!-- 天空渐变 -->
    <div class="absolute inset-0 bg-[linear-gradient(180deg,#5aa9e6_0%,#87c5f0_38%,#c3e2f7_66%,#eaf6fd_100%)]" />

    <!-- 太阳光晕 -->
    <div
      class="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(255,246,214,.95)_0%,rgba(255,246,214,0)_70%)]"
    />

    <!-- 云：几团柔和白块，缓慢横向漂移 -->
    <svg
      class="absolute inset-x-0 bottom-[18%] h-[46%] w-[220%] animate-[drift_38s_linear_infinite]"
      viewBox="0 0 1200 300"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g fill="#fff">
        <ellipse cx="150" cy="190" rx="120" ry="46" opacity=".95" />
        <ellipse cx="235" cy="160" rx="86" ry="40" opacity=".95" />
        <ellipse cx="95" cy="205" rx="72" ry="34" opacity=".9" />
        <ellipse cx="560" cy="230" rx="150" ry="52" opacity=".92" />
        <ellipse cx="665" cy="200" rx="98" ry="42" opacity=".92" />
        <ellipse cx="470" cy="245" rx="88" ry="36" opacity=".88" />
        <ellipse cx="940" cy="175" rx="112" ry="44" opacity=".9" />
        <ellipse cx="1035" cy="150" rx="76" ry="34" opacity=".9" />
        <ellipse cx="1290" cy="225" rx="130" ry="48" opacity=".85" />
      </g>
    </svg>

    <svg
      class="absolute inset-x-0 top-[12%] h-[34%] w-[200%] animate-[drift_62s_linear_infinite_reverse]"
      viewBox="0 0 1200 300"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g fill="#fff">
        <ellipse cx="220" cy="120" rx="96" ry="34" opacity=".55" />
        <ellipse cx="310" cy="98" rx="62" ry="26" opacity=".55" />
        <ellipse cx="780" cy="140" rx="110" ry="38" opacity=".5" />
        <ellipse cx="880" cy="118" rx="70" ry="28" opacity=".5" />
      </g>
    </svg>

    <!-- 远景山丘，压住画面下缘 -->
    <svg
      class="absolute inset-x-0 bottom-0 h-[26%] w-full"
      viewBox="0 0 1200 200"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M0 200V120 Q180 60 360 118 T760 128 T1200 96V200Z" fill="#9ed3ef" opacity=".65" />
      <path d="M0 200V158 Q220 118 460 156 T900 162 T1200 140V200Z" fill="#cfe9f8" opacity=".8" />
    </svg>

    <!-- 统一压暗，保证右侧登录卡片的对比度 -->
    <div v-if="props.dim > 0" class="absolute inset-0 bg-ink-900" :style="{ opacity: props.dim }" />
  </div>
</template>

<style scoped>
@keyframes drift {
  from { transform: translateX(0); }
  to { transform: translateX(-45%); }
}
</style>
