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
const ADMIN_ONLY = ['admin', 'analytics', 'system'];

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
      { path: 'compose', name: 'compose', component: () => import('./views/Compose.vue') },
      { path: 'addresses', name: 'addresses', component: () => import('./views/Addresses.vue'), meta: { admin: true } },
      { path: 'providers', name: 'providers', component: () => import('./views/Providers.vue'), meta: { admin: true } },
      { path: 'rules', name: 'rules', component: () => import('./views/Rules.vue'), meta: { admin: true } },
      { path: 'logs', name: 'logs', component: () => import('./views/Logs.vue'), meta: { admin: true } },
      { path: 'analytics', name: 'analytics', component: () => import('./views/Analytics.vue'), meta: { admin: true } },
      { path: 'admin', name: 'admin', component: () => import('./views/Admin.vue'), meta: { admin: true } },
      { path: 'system', name: 'system', component: () => import('./views/SystemSettings.vue'), meta: { admin: true } },
      { path: 'settings', name: 'settings', component: () => import('./views/Settings.vue') },
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
