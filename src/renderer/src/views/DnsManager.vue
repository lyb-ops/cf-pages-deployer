<template>
  <div>
    <div class="section-header">
      <div class="section-title">🔧 DNS 管理</div>
      <div class="toolbar">
        <button class="btn btn-primary btn-sm" @click="loadZones" :disabled="loading">🔄 刷新 Zones</button>
        <button class="btn btn-sm" @click="showAddZone = true">➕ 迁入新域名</button>
      </div>
    </div>

    <!-- Zone 选择 -->
    <div class="card">
      <div class="card-title">1️⃣ 选择 Zone</div>
      <select class="select" style="width:100%" v-model="selectedZoneId" @change="loadDns">
        <option value="">— 请选择 Zone —</option>
        <option v-for="z in zones" :key="z.id" :value="z.id">
          {{ z.name }} ({{ z.status }})
        </option>
      </select>
    </div>

    <!-- DNS 记录 -->
    <div class="card" v-if="selectedZoneId">
      <div class="card-title" style="display:flex; align-items:center; justify-content:space-between">
        <span>2️⃣ DNS 记录 ({{ dnsRecords.length }})</span>
        <button class="btn btn-sm" @click="showAddRecord = true">➕ 新增记录</button>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th style="width:60px">类型</th>
            <th>名称</th>
            <th>内容</th>
            <th style="width:60px">TTL</th>
            <th style="width:70px">Proxied</th>
            <th style="width:60px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in dnsRecords" :key="r.id">
            <td><span class="tag" :class="typeTag(r.type)">{{ r.type }}</span></td>
            <td><code>{{ r.name }}</code></td>
            <td style="word-break:break-all; max-width:400px">{{ r.content || r.data?.value || JSON.stringify(r.data).slice(0, 60) }}</td>
            <td>{{ r.ttl }}</td>
            <td>{{ r.proxied ? '✅' : '—' }}</td>
            <td>
              <button class="btn btn-sm btn-danger" @click="delRecord(r)">🗑️</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="empty-hint" v-if="!dnsRecords.length && !loadingDns">暂无 DNS 记录</div>
    </div>

    <!-- 新增 Zone 弹窗 -->
    <div v-if="showAddZone" style="position:fixed; inset:0; background:rgba(0,0,0,.3); display:flex; align-items:center; justify-content:center; z-index:100">
      <div style="background:#fff; padding:20px; border-radius:8px; width:380px">
        <div style="font-weight:600; margin-bottom:12px">➕ 迁入新域名到 Cloudflare</div>
        <p style="font-size:12px; color:#86909c; margin-bottom:12px">输入域名后，Cloudflare 会生成两个 NS 服务器，在 GoDaddy 那边把 NS 改掉即可。</p>
        <div class="form-row">
          <label class="form-label">域名</label>
          <div class="form-item">
            <input class="input wide" v-model="newZoneName" placeholder="如 doverfield.us" />
          </div>
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px">
          <button class="btn" @click="showAddZone = false">取消</button>
          <button class="btn btn-primary" @click="addZone">创建</button>
        </div>
      </div>
    </div>

    <!-- 新增 DNS 弹窗 -->
    <div v-if="showAddRecord" style="position:fixed; inset:0; background:rgba(0,0,0,.3); display:flex; align-items:center; justify-content:center; z-index:100">
      <div style="background:#fff; padding:20px; border-radius:8px; width:380px">
        <div style="font-weight:600; margin-bottom:12px">➕ 新增 DNS 记录</div>
        <div class="form-row">
          <label class="form-label">类型</label>
          <div class="form-item">
            <select class="select wide" v-model="newRec.type">
              <option>A</option><option>AAAA</option><option>CNAME</option>
              <option>TXT</option><option>MX</option><option>NS</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">名称</label>
          <div class="form-item">
            <input class="input wide" v-model="newRec.name" placeholder="www 或 @ (apex)" />
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">内容</label>
          <div class="form-item">
            <input class="input wide" v-model="newRec.content" placeholder="如 pages.dev 子域" />
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">Proxied</label>
          <div class="form-item">
            <input type="checkbox" v-model="newRec.proxied" /> <span style="font-size:12px">橙色云朵（推荐 CNAME 开启）</span>
          </div>
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px">
          <button class="btn" @click="showAddRecord = false">取消</button>
          <button class="btn btn-primary" @click="addRecord">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import api from '../ipc'

const props = defineProps<{ creds: any }>()

const zones = ref<any[]>([])
const selectedZoneId = ref('')
const dnsRecords = ref<any[]>([])
const loading = ref(false)
const loadingDns = ref(false)

const showAddZone = ref(false)
const newZoneName = ref('')

const showAddRecord = ref(false)
const newRec = reactive({ type: 'CNAME', name: '', content: '', proxied: true })

async function loadZones() {
  if (!props.creds) return
  loading.value = true
  zones.value = await api.listZones(props.creds)
  loading.value = false
}

async function loadDns() {
  if (!selectedZoneId.value || !props.creds) { dnsRecords.value = []; return }
  loadingDns.value = true
  dnsRecords.value = await api.listDns(props.creds, selectedZoneId.value)
  loadingDns.value = false
}

async function addZone() {
  if (!newZoneName.value.trim()) return
  const r = await api.createZone(props.creds, newZoneName.value.trim())
  if (r?.success) {
    const ns = r.result?.name_servers || []
    alert(`✅ Zone 已创建！\n请在域名注册商把 NS 改为：\n${ns.join('\n')}`)
    showAddZone.value = false
    newZoneName.value = ''
    loadZones()
  } else {
    alert('❌ ' + JSON.stringify(r?.errors || r))
  }
}

async function addRecord() {
  if (!props.creds || !selectedZoneId.value) return
  const rec: any = { type: newRec.type, name: newRec.name, content: newRec.content, proxied: newRec.proxied, ttl: 1 }
  const r = await api.createDns(props.creds, selectedZoneId.value, rec)
  if (r?.success) {
    showAddRecord.value = false
    newRec.type = 'CNAME'; newRec.name = ''; newRec.content = ''; newRec.proxied = true
    loadDns()
  } else {
    alert('❌ ' + JSON.stringify(r?.errors || r))
  }
}

async function delRecord(r: any) {
  if (!confirm(`确定删除 ${r.type} ${r.name} ?`)) return
  const res = await api.deleteDns(props.creds, selectedZoneId.value, r.id)
  if (res?.success) loadDns()
  else alert('❌ ' + JSON.stringify(res?.errors || res))
}

function typeTag(t: string) {
  if (t === 'CNAME') return 'tag-info'
  if (t === 'A' || t === 'AAAA') return 'tag-ok'
  if (t === 'TXT' || t === 'MX') return 'tag-err'
  return ''
}

onMounted(() => loadZones())
</script>
