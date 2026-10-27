import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { resolve, join } from 'path'
import { readdirSync, statSync } from 'fs'
import { loadCreds, saveCreds, clearCreds, type CloudflareCreds } from './services/crypto'
import { CloudflareAPI } from './services/cloudflare'
import { DeployEngine } from './services/deploy'
import { DnsEngine } from './services/dns'

let mainWindow: BrowserWindow | null = null

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
  return await loadCreds()
})

ipcMain.handle('creds:save', async (_e, creds: CloudflareCreds) => {
  return await saveCreds(creds)
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
  const api = new CloudflareAPI(creds)
  return await api.listProjects()
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
