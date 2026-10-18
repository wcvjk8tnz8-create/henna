import { createRouter, createWebHistory } from 'vue-router';
import { getToken } from './api';

/**
 * 路由结构要点：
 *
 * `/login` 是**顶层路由**，不挂在任何 layout 下。
 * 之前它是平铺的兄弟路由，而 App.vue 是根组件、永远渲染，
 * 于是登录页也被套进了「侧边栏 + 移动端顶栏 + 右下角写信按钮」的壳子里
 * —— 未登录却能看到侧边栏，就是这个原因。
 *
 * 现在只有 `/` 及其子路由走 App.vue 布局。
 */

/** admin 才能进的页面 */
const ADMIN_ONLY = ['admin', 'analytics', 'system', 'mail', 'manage', 'invites', 'addresses', 'providers', 'rules', 'logs'];

const routes = [
  {
    path: '/login',
    component: () => import('./views/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('./views/Layout.vue'),
    children: [
      { path: '', name: 'inbox', component: () => import('./views/Inbox.vue') },
      { path: 'all', name: 'all-inbox', component: () => import('./views/AllInbox.vue'), meta: { admin: true } },
      { path: 'compose', name: 'compose', component: () => import('./views/Compose.vue') },
      { path: 'settings', name: 'settings', component: () => import('./views/Settings.vue') },

      /*
       * 管理向页面已合并：
       *   /mail    = 邮箱地址 + 发信日志 + 分析
       *   /manage  = 发信服务商 + 分发规则 + 用户与统计 + 系统设置
       *   /invites = 邀请码（独立）
       * 旧路径保留重定向，收藏夹和旧链接不会 404。
       */
      { path: 'mail', name: 'mail', component: () => import('./views/MailHub.vue'), meta: { admin: true } },
      { path: 'manage', name: 'manage', component: () => import('./views/ManageHub.vue'), meta: { admin: true } },
      { path: 'invites', name: 'invites', component: () => import('./views/Invites.vue'), meta: { admin: true } },

      { path: 'addresses', redirect: '/mail?tab=addresses' },
      { path: 'logs', redirect: '/mail?tab=logs' },
      { path: 'analytics', redirect: '/mail?tab=analytics' },
      { path: 'providers', redirect: '/manage?tab=providers' },
      { path: 'rules', redirect: '/manage?tab=rules' },
      { path: 'admin', redirect: '/manage?tab=admin' },
      { path: 'system', redirect: '/manage?tab=system' },
    ],
  },
  // 兜底：未知路径回首页（会再经守卫判断登录态）
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/** 读一下缓存的角色，用于路由守卫的初步判断 */
function cachedRole(): string {
  try {
    const raw = localStorage.getItem('henna.role');
    return raw ?? '';
  } catch {
    return '';
  }
}

router.beforeEach((to) => {
  // 未登录：除公开页外一律去登录页，并记住原本想去哪
  if (!to.meta.public && !getToken()) {
    return { path: '/login', query: { r: to.fullPath } };
  }
  // 已登录就别再看登录页了
  if (to.path === '/login' && getToken()) return { path: '/' };

  // 角色不够：重定向到收件箱。
  // 这里只是前端拦截，真正的权限由后端 adminOnly 中间件保证。
  const seg = to.path.split('/')[1] ?? '';
  if (ADMIN_ONLY.includes(seg) || to.meta.admin) {
    if (cachedRole() !== 'admin') return { path: '/' };
  }
  return true;
});
