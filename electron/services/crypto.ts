// 凭据存储：使用 Electron 内置 safeStorage（Win=DPAPI / mac=Keychain 加密密钥）
// 相比 keytar 优势：零授权弹窗、无 native 模块、跨平台一致
import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'

export interface CloudflareCreds {
  accountId: string
  email: string
  apiToken: string    // Bearer token (Direct Upload)
  globalKey: string   // Global API Key (DNS 管理)
}

function credsFile(): string {
  return join(app.getPath('userData'), 'creds.enc')
}

export async function saveCreds(creds: CloudflareCreds): Promise<boolean> {
  try {
    const json = JSON.stringify(creds)
    if (safeStorage.isEncryptionAvailable()) {
      writeFileSync(credsFile(), safeStorage.encryptString(json))
    } else {
      // 无加密能力时明文降级（仅本地用户可读）
      writeFileSync(credsFile(), Buffer.from(json, 'utf-8'))
    }
    return true
  } catch (e) {
    console.error('saveCreds failed:', e)
    return false
  }
}

export async function loadCreds(): Promise<Partial<CloudflareCreds> | null> {
  try {
    const p = credsFile()
    if (!existsSync(p)) return null
    const buf = readFileSync(p)
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
    const c = JSON.parse(json)
    if (!c || typeof c !== 'object') return null
    // 只要有任一字段就返回，不强求全部填写
    if (!c.accountId && !c.email && !c.apiToken && !c.globalKey) return null
    return { accountId: c.accountId || '', email: c.email || '', apiToken: c.apiToken || '', globalKey: c.globalKey || '' }
  } catch (e) {
    console.error('loadCreds failed:', e)
    return null
  }
}

export async function clearCreds(): Promise<boolean> {
  try {
    const p = credsFile()
    if (existsSync(p)) unlinkSync(p)
    return true
  } catch (e) {
    console.error('clearCreds failed:', e)
    return false
  }
}
