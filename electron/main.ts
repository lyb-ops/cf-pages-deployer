import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { resolve, join } from 'path'
import { readdirSync, statSync, appendFileSync } from 'fs'
import { loadCreds, saveCreds, clearCreds, type CloudflareCreds } from './services/crypto'
import { CloudflareAPI } from './services/cloudflare'
import { DeployEngine } from './services/deploy'
import { DnsEngine } from './services/dns'

// 调试日志（发布版可移除）
const LOG_FILE = '/tmp/cf-pages-deployer.log'
function dlog(...args: any[]) {
  try {
    const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`)
  } catch {}
}

let mainWindow: BrowserWindow | null = null

// 虚拟机/无真实GPU环境下防止窗口闪退
app.disableHardwareAcceleration()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: 'CF Pages Deployer',
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(resolve(__dirname, '../renderer/index.html'))
  }

  // 转发渲染进程 console 到日志文件
  mainWindow.webContents.on('console-message', (_e, _level, message) => {
    dlog('[renderer]', message)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    dlog('[renderer] 崩溃:', JSON.stringify(details))
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    dlog('[renderer] 加载失败:', code, desc)
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// =============== IPC Handlers ===============

// --- 凭据管理 ---
ipcMain.handle('creds:get', async () => {
  const c = await loadCreds()
  dlog('creds:get →', c ? Object.fromEntries(Object.entries(c).map(([k, v]) => [k, `${(v || '').length}字符`])) : 'null')
  return c
})

ipcMain.handle('creds:save', async (_e, creds: CloudflareCreds) => {
  const ok = await saveCreds(creds)
  dlog('creds:save →', ok ? '成功' : '失败', Object.fromEntries(Object.entries(creds || {}).map(([k, v]) => [k, `${(v as string || '').length}字符`])))
  return ok
})

ipcMain.handle('creds:clear', async () => {
  return await clearCreds()
})

ipcMain.handle('creds:test', async (_e, creds: CloudflareCreds) => {
  const api = new CloudflareAPI(creds)
  return await api.testConnection()
})

// --- 文件选择 ---
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:openFile', async (_e, filters?: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: filters || [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

// --- 文件系统 ---
ipcMain.handle('fs:readDir', async (_e, dirPath: string) => {
  try {
    const entries = readdirSync(dirPath)
    const result: { name: string; kind: 'zip' | 'dir' | 'file' }[] = []
    for (const name of entries) {
      const full = join(dirPath, name)
      try {
        const st = statSync(full)
        if (name.endsWith('.us.zip')) result.push({ name, kind: 'zip' })
        else if (st.isDirectory() && name.endsWith('.us')) result.push({ name, kind: 'dir' })
        else if (st.isFile()) result.push({ name, kind: 'file' })
      } catch {}
    }
    return result
  } catch (e: any) {
    return { error: e?.message || String(e) }
  }
})

// --- Pages 项目 ---
ipcMain.handle('pages:list', async (_e, creds: CloudflareCreds) => {
  dlog('pages:list 开始', `accountId=${(creds?.accountId || '').length}字符 apiToken=${(creds?.apiToken || '').length}字符 globalKey=${(creds?.globalKey || '').length}字符 email=${(creds?.email || '').length}字符`)
  const api = new CloudflareAPI(creds)
  try {
    const list = await api.listProjects()
    dlog('pages:list 成功, 项目数 =', list?.length)
    return list
  } catch (e: any) {
    dlog('pages:list 失败 →', e?.message || String(e))
    throw e
  }
})

ipcMain.handle('pages:create', async (_e, creds: CloudflareCreds, name: string) => {
  const api = new CloudflareAPI(creds)
  return await api.createProject(name)
})

ipcMain.handle('pages:get', async (_e, creds: CloudflareCreds, name: string) => {
  const api = new CloudflareAPI(creds)
  return await api.getProject(name)
})

ipcMain.handle('pages:addDomain', async (_e, creds: CloudflareCreds, projName: string, domain: string) => {
  const api = new CloudflareAPI(creds)
  return await api.addCustomDomain(projName, domain)
})

// --- Zone ---
ipcMain.handle('zone:list', async (_e, creds: CloudflareCreds) => {
  const api = new CloudflareAPI(creds)
  return await api.listZones()
})

ipcMain.handle('zone:get', async (_e, creds: CloudflareCreds, name: string) => {
  const api = new CloudflareAPI(creds)
  return await api.getZone(name)
})

// --- DNS ---
ipcMain.handle('dns:list', async (_e, creds: CloudflareCreds, zoneId: string) => {
  const api = new CloudflareAPI(creds)
  return await api.listDnsRecords(zoneId)
})

ipcMain.handle('dns:create', async (_e, creds: CloudflareCreds, zoneId: string, record: any) => {
  const api = new CloudflareAPI(creds)
  return await api.createDnsRecord(zoneId, record)
})

ipcMain.handle('dns:delete', async (_e, creds: CloudflareCreds, zoneId: string, recordId: string) => {
  const api = new CloudflareAPI(creds)
  return await api.deleteDnsRecord(zoneId, recordId)
})

ipcMain.handle('dns:update', async (_e, creds: CloudflareCreds, zoneId: string, recordId: string, record: any) => {
  const api = new CloudflareAPI(creds)
  return await api.updateDnsRecord(zoneId, recordId, record)
})

// --- Zone 创建（迁入新域名） ---
ipcMain.handle('zone:create', async (_e, creds: CloudflareCreds, domain: string) => {
  const api = new CloudflareAPI(creds)
  return await api.createZone(domain)
})

// --- 批量部署 ---
ipcMain.handle('deploy:batch', async (_e, creds: CloudflareCreds, params: {
  sourceDir: string
  projects: string[]
  appAdsTemplate?: string
  forceInjectTemplate?: boolean
}) => {
  const engine = new DeployEngine(creds, (msg) => {
    mainWindow?.webContents.send('deploy:log', msg)
  })
  return await engine.batchDeploy(params)
})

// --- DNS 批量清理+绑定 ---
ipcMain.handle('dns:batchSetup', async (_e, creds: CloudflareCreds, params: {
  sites: { project: string; domain: string }[]
}) => {
  const engine = new DnsEngine(creds, (msg) => {
    mainWindow?.webContents.send('deploy:log', msg)
  })
  return await engine.batchSetup(params)
})
