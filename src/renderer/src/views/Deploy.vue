<template>
  <div>
    <div class="section-header">
      <div class="section-title">🚀 批量部署</div>
    </div>

    <div class="card">
      <div class="card-title">1️⃣ 选择源目录</div>
      <div class="form-row">
        <div class="form-item" style="flex:1; display:flex; gap:8px">
          <input class="input" style="flex:1" :value="sourceDir" placeholder="点击右边选择 zip 所在目录" readonly />
          <button class="btn btn-primary btn-sm" @click="pickDir">📂 选择目录</button>
        </div>
      </div>

      <div v-if="sourceDir && availableZips.length">
        <div style="margin-top:12px; margin-bottom:6px; color:#4e5969">检测到以下可部署项目：</div>
        <div class="checkbox-list">
          <label class="checkbox-item" @click="toggleAll">
            <input type="checkbox" :checked="allSelected" @click.stop="toggleAll" />
            <b>全选 / 反选</b> ({{ selectedProjects.length }}/{{ availableZips.length }})
          </label>
          <label class="checkbox-item" v-for="p in availableZips" :key="p.name">
            <input type="checkbox" :value="p.projName" v-model="selectedProjects" />
            <span><code>{{ p.projName }}.us</code></span>
            <span class="tag tag-info" style="margin-left:auto">{{ p.kind }}</span>
          </label>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">2️⃣ app-ads.txt 模板</div>
      <div class="form-row">
        <label class="form-label">模板文件</label>
        <div class="form-item" style="display:flex; gap:8px">
          <input class="input" style="flex:1" :value="appAdsTemplate" placeholder="留空则不注入，新项目默认保留站点内原文件" readonly />
          <button class="btn btn-sm" @click="pickTmpl">选择文件</button>
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">注入策略</label>
        <div class="form-item">
          <select class="select" style="width:100%" v-model="injectMode">
            <option value="new-only">仅新项目注入（推荐）</option>
            <option value="force-overwrite">强制覆盖所有站点</option>
            <option value="skip">不注入，全部保留站点内原文件</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">3️⃣ 开始部署</div>
      <div style="display:flex; gap:8px; margin-bottom:10px">
        <button class="btn btn-primary" @click="startDeploy" :disabled="deploying || !selectedProjects.length">
          {{ deploying ? '部署中...' : `🚀 部署选中 ${selectedProjects.length} 个项目` }}
        </button>
        <button class="btn" @click="runDnsSetup" :disabled="!selectedProjects.length">🔧 自动 DNS 绑定</button>
        <button class="btn btn-danger btn-sm" @click="clearLog">🗑️ 清日志</button>
      </div>
      <div class="log-area" ref="logRef" v-html="logHtml"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import api from '../ipc'

const props = defineProps<{ creds: any }>()

const sourceDir = ref('')
const appAdsTemplate = ref('')
const injectMode = ref('new-only')
const selectedProjects = ref<string[]>([])
const deploying = ref(false)
const log = ref<string[]>([])
const logRef = ref<HTMLElement | null>(null)

interface DirEntry { name: string; kind: 'zip' | 'dir' | 'file' }

interface ProjectItem { projName: string; kind: string }

const availableZips = ref<ProjectItem[]>([])

async function scanDir(dirPath: string) {
  const entries: DirEntry[] = await api.readDir(dirPath)
  if (Array.isArray(entries)) {
    const zips: ProjectItem[] = entries
      .filter((e: DirEntry) => e.kind === 'zip')
      .map((e: DirEntry) => ({ projName: e.name.replace(/\.us\.zip$/, ''), kind: 'zip' }))
    const dirs: ProjectItem[] = entries
      .filter((e: DirEntry) => e.kind === 'dir' && e.name.endsWith('.us'))
      .map((e: DirEntry) => ({ projName: e.name.replace(/\.us$/, ''), kind: 'dir' }))
    availableZips.value = [...zips, ...dirs].sort((a, b) => a.projName.localeCompare(b.projName))
  }
}

watch(sourceDir, (v) => { if (v) scanDir(v) })

function appendMsg(msg: string) {
  const line = msg
    .replace(/✅/g, '<span class="log-ok">✅</span>')
    .replace(/❌/g, '<span class="log-err">❌</span>')
    .replace(/⚠️/g, '<span class="log-warn">⚠️</span>')
    .replace(/🆕/g, '<span class="log-ok">🆕</span>')
    .replace(/📄/g, '<span class="log-ok">📄</span>')
  log.value.push(line)
  nextTick(() => {
    if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight
  })
}

const allSelected = computed(() =>
  availableZips.value.length > 0 && selectedProjects.value.length === availableZips.value.length
)

function toggleAll() {
  if (allSelected.value) selectedProjects.value = []
  else selectedProjects.value = availableZips.value.map(z => z.projName)
}

async function pickDir() {
  const d = await api.openDirectory()
  if (d) {
    sourceDir.value = d
    selectedProjects.value = []
  }
}

async function pickTmpl() {
  const f = await api.openFile([{ name: 'TXT', extensions: ['txt'] }])
  if (f) appAdsTemplate.value = f
}

async function startDeploy() {
  if (!props.creds || !selectedProjects.value.length) return
  deploying.value = true
  log.value = []
  const params: any = {
    sourceDir: sourceDir.value,
    projects: selectedProjects.value,
    appAdsTemplate: injectMode.value === 'skip' ? undefined : appAdsTemplate.value,
    forceInjectTemplate: injectMode.value === 'force-overwrite'
  }
  try {
    const r = await api.batchDeploy(props.creds, params)
    appendMsg(`\n✅ 部署完成！成功 ${r.results.filter((x: any) => x.success).length} / 失败 ${r.errors.length}`)
  } catch (e: any) {
    appendMsg(`\n❌ 部署异常: ${e?.message || e}`)
  } finally {
    deploying.value = false
  }
}

async function runDnsSetup() {
  if (!props.creds || !selectedProjects.value.length) return
  const domains = selectedProjects.value.map(p => ({ project: p, domain: p + '.us' }))
  log.value.push('\n--- DNS 绑定开始 ---')
  const r = await api.batchDnsSetup(props.creds, { sites: domains })
  log.value.push(`--- DNS 完成，失败 ${r.errors.length} 个 ---`)
}

const logHtml = computed(() => log.value.join('\n'))

function clearLog() { log.value = [] }

// 监听主进程日志流
;api.onDeployLog && api.onDeployLog((msg: string) => appendMsg(msg))
</script>
