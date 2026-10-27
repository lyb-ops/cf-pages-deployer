import { contextBridge, ipcRenderer } from 'electron'

// Vue 响应式 Proxy 无法通过 IPC 结构化克隆，统一净化为纯对象
const clean = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

contextBridge.exposeInMainWorld('api', {
  // 凭据
  getCreds: () => ipcRenderer.invoke('creds:get'),
  saveCreds: (creds: any) => ipcRenderer.invoke('creds:save', clean(creds)),
  clearCreds: () => ipcRenderer.invoke('creds:clear'),
  testCreds: (creds: any) => ipcRenderer.invoke('creds:test', clean(creds)),

  // 文件对话框
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: (filters?: any) => ipcRenderer.invoke('dialog:openFile', clean(filters)),

  // 文件系统
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),

  // Pages
  listProjects: (creds: any) => ipcRenderer.invoke('pages:list', clean(creds)),
  createProject: (creds: any, name: string) => ipcRenderer.invoke('pages:create', clean(creds), name),
  getProject: (creds: any, name: string) => ipcRenderer.invoke('pages:get', clean(creds), name),
  addDomain: (creds: any, proj: string, domain: string) => ipcRenderer.invoke('pages:addDomain', clean(creds), proj, domain),

  // Zone
  listZones: (creds: any) => ipcRenderer.invoke('zone:list', clean(creds)),
  getZone: (creds: any, name: string) => ipcRenderer.invoke('zone:get', clean(creds), name),
  createZone: (creds: any, domain: string) => ipcRenderer.invoke('zone:create', clean(creds), domain),

  // DNS
  listDns: (creds: any, zoneId: string) => ipcRenderer.invoke('dns:list', clean(creds), zoneId),
  createDns: (creds: any, zoneId: string, record: any) => ipcRenderer.invoke('dns:create', clean(creds), zoneId, clean(record)),
  deleteDns: (creds: any, zoneId: string, recordId: string) => ipcRenderer.invoke('dns:delete', clean(creds), zoneId, recordId),
  updateDns: (creds: any, zoneId: string, recordId: string, rec: any) => ipcRenderer.invoke('dns:update', clean(creds), zoneId, recordId, clean(rec)),

  // 批量操作
  batchDeploy: (creds: any, params: any) => ipcRenderer.invoke('deploy:batch', clean(creds), clean(params)),
  batchDnsSetup: (creds: any, params: any) => ipcRenderer.invoke('dns:batchSetup', clean(creds), clean(params)),

  // 日志流
  onDeployLog: (cb: (msg: string) => void) => {
    ipcRenderer.on('deploy:log', (_e, msg) => cb(msg))
  }
})
