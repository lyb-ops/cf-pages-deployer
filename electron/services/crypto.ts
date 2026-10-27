// keytar 动态加载：electron-builder 会把它复制到 extraResources/keytar/
// 开发时用 node_modules，生产时用 resourcesPath
import { app } from 'electron'
import { join } from 'path'

function loadKeytar(): any {
  // 1. 正常 require（开发模式）
  try {
    return require('keytar')
  } catch {}
  // 2. extraResources 路径（打包后）
  try {
    const p = join(app.getPath('resourcesPath'), 'keytar')
    return require(p)
  } catch {}
  // 3. resources 同级
  try {
    const p = join(app.getAppPath(), '..', 'keytar')
    return require(p)
  } catch {}
  throw new Error('keytar not found - please rebuild with electron-builder install-app-deps')
}

const keytar = loadKeytar()

export interface CloudflareCreds {
  accountId: string
  email: string
  apiToken: string    // Bearer token (Direct Upload)
  globalKey: string    // Global API Key (DNS 管理)
}

const SERVICE_NAME = 'cf-pages-deployer'

export async function saveCreds(creds: CloudflareCreds): Promise<boolean> {
  try {
    await keytar.setPassword(SERVICE_NAME, 'accountId', creds.accountId)
    await keytar.setPassword(SERVICE_NAME, 'email', creds.email)
    await keytar.setPassword(SERVICE_NAME, 'apiToken', creds.apiToken)
    await keytar.setPassword(SERVICE_NAME, 'globalKey', creds.globalKey)
    return true
  } catch (e) {
    console.error('saveCreds failed:', e)
    return false
  }
}

export async function loadCreds(): Promise<CloudflareCreds | null> {
  try {
    const accountId = await keytar.getPassword(SERVICE_NAME, 'accountId')
    const email = await keytar.getPassword(SERVICE_NAME, 'email')
    const apiToken = await keytar.getPassword(SERVICE_NAME, 'apiToken')
    const globalKey = await keytar.getPassword(SERVICE_NAME, 'globalKey')
    if (!accountId || !email || !apiToken || !globalKey) return null
    return { accountId, email, apiToken, globalKey }
  } catch (e) {
    console.error('loadCreds failed:', e)
    return null
  }
}

export async function clearCreds(): Promise<boolean> {
  try {
    await keytar.deletePassword(SERVICE_NAME, 'accountId')
    await keytar.deletePassword(SERVICE_NAME, 'email')
    await keytar.deletePassword(SERVICE_NAME, 'apiToken')
    await keytar.deletePassword(SERVICE_NAME, 'globalKey')
    return true
  } catch (e) {
    console.error('clearCreds failed:', e)
    return false
  }
}
