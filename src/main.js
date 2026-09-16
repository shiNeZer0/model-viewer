import { createPinia } from 'pinia'
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
// 查看器以暗色为主（同微软 3D 查看器的观感），index.html 的 <html class="dark"> 已开启
import 'element-plus/theme-chalk/dark/css-vars.css'

import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App)

app.use(createPinia())
app.use(ElementPlus)
app.use(router)
app.mount('#app')
