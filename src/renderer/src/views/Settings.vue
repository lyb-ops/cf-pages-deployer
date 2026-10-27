<template>
  <div style="max-width: 520px">
    <div class="card">
      <div class="card-title">🔐 Cloudflare 凭据配置</div>
      <p style="color:#86909c; margin-bottom:16px; font-size:12px">
        凭据使用系统安全存储（Windows DPAPI / macOS Keychain），不会明文保存到任何文件。
      </p>

      <div class="form-row">
        <label class="form-label">Account ID</label>
        <div class="form-item">
          <input class="input wide" v-model="form.accountId" placeholder="a7a5e49a..." />
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">邮箱</label>
        <div class="form-item">
          <input class="input wide" v-model="form.email" placeholder="you@example.com" />
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">API Token</label>
        <div class="form-item">
          <input class="input wide" type="password" v-model="form.apiToken" placeholder="cfut_..." />
          <div style="font-size:11px; color:#86909c; margin-top:2px">Bearer Token（wrangler 部署用）</div>
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">Global Key</label>
        <div class="form-item">
          <input class="input wide" type="password" v-model="form.globalKey" placeholder="cfk_..." />
          <div style="font-size:11px; color:#86909c; margin-top:2px">Global API Key（DNS 管理用）</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; margin-top:16px">
        <button class="btn btn-primary" @click="save" :disabled="saving">💾 保存</button>
        <button class="btn" @click="test" :disabled="testing">🔌 测试连接</button>
        <button class="btn btn-danger" @click="clear">🗑️ 清除</button>
        <span v-if="msg" :style="{ color: msgOk ? '#00b42a' : '#f53f3f', marginLeft: '8px', lineHeight: '28px' }">{{ msg }}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📝 Token 获取指引</div>
      <ol style="padding-left:18px; line-height:1.9; color:#4e5969; font-size:12px">
        <li>登录 Cloudflare Dashboard → <code>My Profile</code> → <code>API Tokens</code></li>
        <li>创建两个 Token：
          <ul style="padding-left:16px; margin-top:4px">
            <li><b>API Token</b>：<code>Create Custom Token</code> → <code>Account: Pages:Edit</code> + <code>Account: Pages:Read</code></li>
            <li><b>Global Key</b>：在 API Keys 页面 <code>View Global API Key</code>（用于 DNS 增删）</li>
          </ul>
        </li>
        <li>Account ID：Dashboard 右上角头像 → <code>My Profile</code> → <code>Accounts</code> → 选中账户 → Account ID 在页面顶部</li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import api from '../ipc'

const props = defineProps<{ creds: any }>()
const emit = defineEmits<{ saved: [c: any] }>()

const form = reactive({
  accountId: props.creds?.accountId || '',
  email: props.creds?.email || '',
  apiToken: props.creds?.apiToken || '',
  globalKey: props.creds?.globalKey || ''
})

const msg = ref('')
const msgOk = ref(true)
const saving = ref(false)
const testing = ref(false)

async function save() {
  saving.value = true
  const ok = await api.saveCreds({ ...form })
  saving.value = false
  if (ok) {
    msg.value = '✅ 已保存到系统安全存储'
    msgOk.value = true
    emit('saved', { ...form })
  } else {
    msg.value = '❌ 保存失败'
    msgOk.value = false
  }
}

async function test() {
  testing.value = true
  const r = await api.testCreds({ ...form })
  testing.value = false
  msg.value = r.success ? `✅ ${r.msg}` : `❌ ${r.msg}`
  msgOk.value = r.success
}

async function clear() {
  if (!confirm('确定清除所有已保存的凭据？')) return
  await api.clearCreds()
  Object.assign(form, { accountId: '', email: '', apiToken: '', globalKey: '' })
  msg.value = '已清除'
  msgOk.value = true
}
</script>
