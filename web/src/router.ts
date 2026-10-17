import { createRouter, createWebHistory } from 'vue-router';
import { getToken } from './api';

const routes = [
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/', component: () => import('./views/Inbox.vue') },
  { path: '/compose', component: () => import('./views/Compose.vue') },
  { path: '/addresses', component: () => import('./views/Addresses.vue') },
  { path: '/providers', component: () => import('./views/Providers.vue') },
  { path: '/rules', component: () => import('./views/Rules.vue') },
  { path: '/logs', component: () => import('./views/Logs.vue') },
  { path: '/admin', component: () => import('./views/Admin.vue') },
  { path: '/settings', component: () => import('./views/Settings.vue') },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (!to.meta.public && !getToken()) return { path: '/login', query: { r: to.fullPath } };
  return true;
});
