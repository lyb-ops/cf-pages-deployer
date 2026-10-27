<template>
  <div class="app-container">
    <header class="app-header">
      <div class="logo">☁️ CF Pages Deployer</div>
      <div class="nav-tab" :class="{ active: tab === 'settings' }" @click="tab = 'settings'">⚙️ 设置</div>
      <div class="nav-tab" :class="{ active: tab === 'projects' }" @click="tab = 'projects'">📁 项目</div>
      <div class="nav-tab" :class="{ active: tab === 'deploy' }" @click="tab = 'deploy'">🚀 批量部署</div>
      <div class="nav-tab" :class="{ active: tab === 'dns' }" @click="tab = 'dns'">🔧 DNS管理</div>
      <div class="spacer"></div>
      <div class="status-dot" :class="credsOk ? 'ok' : 'bad'"></div>
      <span style="color:#86909c">{{ credsOk ? '已连接' : '未配置' }}</span>
    </header>
    <main class="app-content">
      <Settings v-if="tab === 'settings'" @saved="onCredsSaved" :creds="creds" />
      <Projects v-else-if="tab === 'projects'" :creds="creds" />
      <Deploy v-else-if="tab === 'deploy'" :creds="creds" />
      <DnsManager v-else-if="tab === 'dns'" :creds="creds" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from './ipc'
import Settings from './views/Settings.vue'
import Projects from './views/Projects.vue'
import Deploy from './views/Deploy.vue'
import DnsManager from './views/DnsManager.vue'

const tab = ref('settings')
const creds = ref<any>(null)
const credsOk = ref(false)

async function loadCreds() {
  const c = await api.getCreds()
  creds.value = c
  // API Token 或 邮箱+Global Key 任一种认证可用即算已配置
  credsOk.value = !!(c?.accountId && (c?.apiToken || (c?.email && c?.globalKey)))
  if (credsOk.value) tab.value = 'projects'
}

function onCredsSaved(c: any) {
  creds.value = c
  credsOk.value = true
}

onMounted(loadCreds)
</script>
