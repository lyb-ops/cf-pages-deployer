import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // 凭据
  getCreds: () => ipcRenderer.invoke('creds:get'),
  saveCreds: (creds: any) => ipcRenderer.invoke('creds:save', creds),
  clearCreds: () => ipcRenderer.invoke('creds:clear'),
  testCreds: (creds: any) => ipcRenderer.invoke('creds:test', creds),

  // 文件对话框
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: (filters?: any) => ipcRenderer.invoke('dialog:openFile', filters),

  // 文件系统
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),

  // Pages
  listProjects: (creds: any) => ipcRenderer.invoke('pages:list', creds),
  createProject: (creds: any, name: string) => ipcRenderer.invoke('pages:create', creds, name),
  getProject: (creds: any, name: string) => ipcRenderer.invoke('pages:get', creds, name),
  addDomain: (creds: any, proj: string, domain: string) => ipcRenderer.invoke('pages:addDomain', creds, proj, domain),

  // Zone
  listZones: (creds: any) => ipcRenderer.invoke('zone:list', creds),
  getZone: (creds: any, name: string) => ipcRenderer.invoke('zone:get', creds, name),
  createZone: (creds: any, domain: string) => ipcRenderer.invoke('zone:create', creds, domain),

  // DNS
  listDns: (creds: any, zoneId: string) => ipcRenderer.invoke('dns:list', creds, zoneId),
  createDns: (creds: any, zoneId: string, record: any) => ipcRenderer.invoke('dns:create', creds, zoneId, record),
  deleteDns: (creds: any, zoneId: string, recordId: string) => ipcRenderer.invoke('dns:delete', creds, zoneId, recordId),
  updateDns: (creds: any, zoneId: string, recordId: string, rec: any) => ipcRenderer.invoke('dns:update', creds, zoneId, recordId, rec),

  // 批量操作
  batchDeploy: (creds: any, params: any) => ipcRenderer.invoke('deploy:batch', creds, params),
  batchDnsSetup: (creds: any, params: any) => ipcRenderer.invoke('dns:batchSetup', creds, params),

  // 日志流
  onDeployLog: (cb: (msg: string) => void) => {
    ipcRenderer.on('deploy:log', (_e, msg) => cb(msg))
  }
})
