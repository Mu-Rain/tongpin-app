import App from './App'
import { createSSRApp } from 'vue'

// uni-app（Vue3）固定入口写法：必须导出 createApp
export function createApp() {
  const app = createSSRApp(App)
  // 以后在这里注册全局能力，例如：
  //   app.use(Pinia)
  //   app.config.globalProperties.$api = api
  return {
    app
  }
}
