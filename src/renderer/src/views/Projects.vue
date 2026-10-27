<template>
  <div>
    <div class="section-header">
      <div class="section-title">📁 Pages 项目列表</div>
      <div class="toolbar">
        <button class="btn btn-primary btn-sm" @click="refresh" :disabled="loading">🔄 刷新</button>
        <button class="btn btn-sm" @click="showCreate = true">➕ 新建项目</button>
      </div>
    </div>

    <div class="card" v-if="projects.length">
      <table class="table">
        <thead>
          <tr>
            <th>项目名</th>
            <th>Subdomain</th>
            <th>分支</th>
            <th>生产部署</th>
            <th>状态</th>
            <th style="width:100px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in projects" :key="p.name">
            <td><code>{{ p.name }}</code></td>
            <td>{{ p.subdomain }}</td>
            <td>{{ p.production_branch }}</td>
            <td>{{ p.latest_deployment_id ? '✅' : '-' }}</td>
            <td><span class="tag tag-ok">{{ p.status || 'ready' }}</span></td>
            <td>
              <button class="btn btn-sm" @click="quickDeploy(p)">快速部署</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="card empty-hint" v-else-if="!loading">暂无项目，点击"新建项目"创建</div>

    <!-- 新建项目弹窗 -->
    <div v-if="showCreate" style="position:fixed; inset:0; background:rgba(0,0,0,.3); display:flex; align-items:center; justify-content:center; z-index:100">
      <div style="background:#fff; padding:20px; border-radius:8px; width:360px">
        <div style="font-weight:600; margin-bottom:12px">➕ 新建 Pages 项目</div>
        <div class="form-row">
          <label class="form-label">项目名</label>
          <div class="form-item">
            <input class="input wide" v-model="newName" placeholder="如 orixyrennixs" />
          </div>
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px">
          <button class="btn" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" @click="createProject">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{ creds: any }>()

const projects = ref<any[]>([])
const loading = ref(false)
const showCreate = ref(false)
const newName = ref('')

async function refresh() {
  if (!props.creds) return
  loading.value = true
  const list = await (window as any).api.listProjects(props.creds)
  projects.value = list
  loading.value = false
}

async function createProject() {
  if (!newName.value.trim()) return
  const r = await (window as any).api.createProject(props.creds, newName.value.trim())
  if (r?.success) {
    alert(`✅ 已创建 ${newName.value}`)
    showCreate.value = false
    newName.value = ''
    refresh()
  } else {
    alert('❌ ' + JSON.stringify(r?.errors || r))
  }
}

async function quickDeploy(p: any) {
  alert(`快速部署功能在"批量部署"Tab，选择包含 ${p.name}.us.zip 的目录即可`)
}

onMounted(refresh)
</script>
