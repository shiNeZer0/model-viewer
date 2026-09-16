import { createRouter, createWebHashHistory } from 'vue-router'

// 用 hash 路由：桌面端（tauri://localhost）与任意静态托管的 Web 版都能直接刷新/深链，
// 不需要服务器做 history fallback 重写。
const routes = [
  {
    path: '/',
    name: 'Viewer',
    component: () => import('../views/Viewer.vue'),
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/Settings.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
