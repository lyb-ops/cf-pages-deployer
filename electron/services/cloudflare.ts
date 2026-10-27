import https from 'https'
import { URL } from 'url'
import { createHash } from 'crypto'
import type { CloudflareCreds } from './crypto'

const CF_API = 'https://api.cloudflare.com/client/v4'

export class CloudflareAPI {
  private creds: CloudflareCreds

  constructor(creds: CloudflareCreds) {
    this.creds = creds
  }

  /**
   * 通用 HTTP 请求到 Cloudflare API
   */
  async request<T = any>(
    path: string,
    method: string = 'GET',
    data?: any,
    authType: 'bearer' | 'global' | 'none' = 'global',
    contentType: string = 'application/json',
    extraHeaders: Record<string, string> = {}
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(CF_API + path)
      const headers: Record<string, string> = { ...extraHeaders, 'Content-Type': contentType }

      if (authType === 'bearer') {
        headers['Authorization'] = `Bearer ${this.creds.apiToken}`
      } else if (authType === 'global') {
        headers['X-Auth-Email'] = this.creds.email
        headers['X-Auth-Key'] = this.creds.globalKey
      }

      let body: Buffer | undefined
      if (data !== undefined) {
        if (contentType === 'application/json') {
          body = Buffer.from(JSON.stringify(data))
        } else if (data instanceof Buffer) {
          body = data
        } else if (typeof data === 'string') {
          body = Buffer.from(data)
        } else {
          body = Buffer.from(JSON.stringify(data))
        }
        headers['Content-Length'] = body.length.toString()
      }

      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 60000
      }, (res) => {
        let buf = ''
        res.on('data', (c) => buf += c)
        res.on('end', () => {
          try { resolve(JSON.parse(buf) as T) }
          catch { resolve(buf as any) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      if (body) req.write(body)
      req.end()
    })
  }

  /** 使用自定义 Authorization header (JWT) */
  async requestWithHeader<T = any>(
    path: string,
    method: string,
    data?: any,
    headers: Record<string, string> = {}
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(CF_API + path)
      const body = data !== undefined ? (typeof data === 'string' ? Buffer.from(data) : Buffer.from(JSON.stringify(data))) : undefined
      const finalHeaders = { ...headers }
      if (body) finalHeaders['Content-Length'] = body.length.toString()

      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: finalHeaders,
        timeout: 120000
      }, (res) => {
        let buf = ''
        res.on('data', (c) => buf += c)
        res.on('end', () => {
          try { resolve(JSON.parse(buf) as T) }
          catch { resolve(buf as any) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      if (body) req.write(body)
      req.end()
    })
  }

  async testConnection(): Promise<{ success: boolean; msg: string }> {
    try {
      const r = await this.request('/zones?per_page=1')
      if ((r as any).success) return { success: true, msg: '连接成功' }
      return { success: false, msg: JSON.stringify((r as any).errors) }
    } catch (e: any) {
      return { success: false, msg: e?.message || String(e) }
    }
  }

  // ============ Pages ============
  async listProjects(): Promise<any[]> {
    // 优先 Bearer Token；失败且配置了 Global Key 时自动降级重试
    let r: any
    try {
      r = await this.request(`/accounts/${this.creds.accountId}/pages/projects`, 'GET', undefined, 'bearer')
    } catch {
      r = null
    }
    if (!r?.success && this.creds.globalKey && this.creds.email) {
      r = await this.request(`/accounts/${this.creds.accountId}/pages/projects`, 'GET', undefined, 'global')
    }
    if (!r?.success) {
      throw new Error(r?.errors?.[0]?.message || `拉取项目失败: ${JSON.stringify(r?.errors || r).slice(0, 200)}`)
    }
    return r?.result || []
  }

  async createProject(name: string): Promise<any> {
    return this.request(`/accounts/${this.creds.accountId}/pages/projects`, 'POST', { name, production_branch: 'main' }, 'global')
  }

  async getProject(name: string): Promise<any> {
    return this.request(`/accounts/${this.creds.accountId}/pages/projects/${name}`, 'GET', undefined, 'bearer')
  }

  async addCustomDomain(projName: string, domain: string): Promise<any> {
    return this.request(`/accounts/${this.creds.accountId}/pages/projects/${projName}/domains`, 'POST', { name: domain }, 'global')
  }

  // ============ Zone ============
  async listZones(): Promise<any[]> {
    const r: any = await this.request('/zones?per_page=100', 'GET', undefined, 'global')
    return r?.result || []
  }

  async getZone(name: string): Promise<any | null> {
    const r: any = await this.request(`/zones?name=${encodeURIComponent(name)}`, 'GET', undefined, 'global')
    return r?.result?.[0] || null
  }

  async createZone(domain: string): Promise<any> {
    return this.request('/zones', 'POST', { name: domain, account: { id: this.creds.accountId } }, 'global')
  }

  // ============ DNS ============
  async listDnsRecords(zoneId: string): Promise<any[]> {
    const r: any = await this.request(`/zones/${zoneId}/dns_records?per_page=100`, 'GET', undefined, 'global')
    return r?.result || []
  }

  async createDnsRecord(zoneId: string, record: any): Promise<any> {
    return this.request(`/zones/${zoneId}/dns_records`, 'POST', record, 'global')
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<any> {
    return this.request(`/zones/${zoneId}/dns_records/${recordId}`, 'DELETE', undefined, 'global')
  }

  async updateDnsRecord(zoneId: string, recordId: string, record: any): Promise<any> {
    return this.request(`/zones/${zoneId}/dns_records/${recordId}`, 'PUT', record, 'global')
  }

  // ============ Pages Direct Upload ============

  /** 获取上传用 JWT */
  async getUploadJwt(projName: string): Promise<string> {
    const r: any = await this.request(
      `/accounts/${this.creds.accountId}/pages/projects/${projName}/upload-token`,
      'GET', undefined, 'bearer'
    )
    if (!r?.result?.jwt) throw new Error(`getUploadJwt 失败: ${JSON.stringify(r?.errors || r)}`)
    return r.result.jwt
  }

  /** SHA-256 hash */
  hash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex')
  }

  /** 检查哪些 hash 缺失（需上传） */
  async checkMissing(jwt: string, hashes: string[]): Promise<string[]> {
    if (!hashes.length) return []
    const r: any = await this.requestWithHeader(
      '/pages/assets/check-missing',
      'POST',
      JSON.stringify({ hashes }),
      { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' }
    )
    return Array.isArray(r) ? r : []
  }

  /** 上传文件（base64） */
  async uploadAssets(jwt: string, files: { key: string; value: Buffer; contentType: string }[]): Promise<any> {
    if (!files.length) return { ok: true }
    const payload = files.map(f => ({
      key: f.key,
      value: f.value.toString('base64'),
      metadata: { contentType: f.contentType },
      base64: true
    }))
    return this.requestWithHeader(
      '/pages/assets/upload',
      'POST',
      JSON.stringify(payload),
      { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' }
    )
  }

  /** upsert hash 缓存 */
  async upsertHashes(jwt: string, hashes: string[]): Promise<any> {
    if (!hashes.length) return
    try {
      await this.requestWithHeader(
        '/pages/assets/upsert-hashes',
        'POST',
        JSON.stringify({ hashes }),
        { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' }
      )
    } catch { /* ignore */ }
  }

  /** 创建部署（multipart/form-data 带 manifest） */
  async createDeployment(
    projName: string,
    manifest: Record<string, string>,
    branch: string = 'main'
  ): Promise<any> {
    const boundary = '----cfdeploy' + Date.now()
    const parts: string[] = []

    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${JSON.stringify(manifest)}\r\n`)
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="branch"\r\n\r\n${branch}\r\n`)
    parts.push(`--${boundary}--\r\n`)

    const body = Buffer.concat(parts.map(p => Buffer.from(p)))

    return new Promise((resolve, reject) => {
      const url = new URL(`${CF_API}/accounts/${this.creds.accountId}/pages/projects/${projName}/deployments`)
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.creds.apiToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString()
      }
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: 30000
      }, (res) => {
        let buf = ''
        res.on('data', (c) => buf += c)
        res.on('end', () => {
          try { resolve(JSON.parse(buf)) } catch { resolve(buf) }
        })
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }
}
