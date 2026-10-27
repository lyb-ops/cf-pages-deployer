import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import AdmZip from 'adm-zip'
import { CloudflareAPI } from './cloudflare'
import type { CloudflareCreds } from './crypto'

export interface BatchDeployParams {
  sourceDir: string
  projects: string[]
  appAdsTemplate?: string
  forceInjectTemplate?: boolean
}

export type LogFn = (msg: string) => void

interface FileContainer {
  hash: string
  value: Buffer
  contentType: string
  size: number
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
    '.rss': 'application/rss+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.map': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.appads': 'text/plain; charset=utf-8',
  }
  return types[ext] || 'application/octet-stream'
}

export class DeployEngine {
  private api: CloudflareAPI
  private log: LogFn

  constructor(creds: CloudflareCreds, log: LogFn) {
    this.api = new CloudflareAPI(creds)
    this.log = log
  }

  async batchDeploy(params: BatchDeployParams): Promise<{ results: any[]; errors: string[] }> {
    const { sourceDir, projects, appAdsTemplate, forceInjectTemplate } = params
    const results: any[] = []
    const errors: string[] = []

    for (const proj of projects) {
      try {
        this.log(`\n=== ${proj} ===`)

        // 1) 解压 / 提平
        const inputPath = path.join(sourceDir, proj + '.us.zip')
        const inputDirPath = path.join(sourceDir, proj + '.us')
        const tmpDir = path.join(os.tmpdir(), `cfdeploy-${proj}-${Date.now()}`)
        fs.mkdirSync(tmpDir, { recursive: true })

        if (fs.existsSync(inputPath) && inputPath.endsWith('.zip')) {
          this.log(`  解压 ${proj}.us.zip ...`)
          const zip = new AdmZip(inputPath)
          zip.extractAllTo(tmpDir, true)
        } else if (fs.existsSync(inputDirPath)) {
          this.log(`  使用已解压目录 ${proj}.us ...`)
          fs.cpSync(inputDirPath, path.join(tmpDir, proj + '.us'), { recursive: true })
        } else {
          throw new Error(`找不到源文件：${proj}.us.zip 或 ${proj}.us/`)
        }

        // 提平
        const finalDir = path.join(tmpDir, 'final')
        fs.mkdirSync(finalDir, { recursive: true })
        const nested = path.join(tmpDir, proj + '.us')
        if (fs.existsSync(nested) && fs.readdirSync(nested).length > 0) {
          this.copyRecursive(nested, finalDir)
        } else {
          for (const f of fs.readdirSync(tmpDir)) {
            const src = path.join(tmpDir, f)
            if (f !== 'final') this.copyRecursive(src, finalDir)
          }
        }

        if (!fs.existsSync(path.join(finalDir, 'index.html'))) {
          throw new Error('提平后无 index.html')
        }
        this.log(`  ✅ 提平完成`)

        // 2) 判断项目新旧
        const existing = await this.api.getProject(proj)
        const isNew = !existing?.success

        if (isNew) {
          this.log(`  🆕 新项目，创建 Pages project`)
          const r = await this.api.createProject(proj)
          if (!r?.success && r?.errors?.[0]?.code !== 8000002) {
            throw new Error(`创建项目失败: ${JSON.stringify(r?.errors)}`)
          }
        } else {
          this.log(`  📌 已有项目 (更新)`)
        }

        // 3) app-ads.txt：仅新项目或强制时注入模板；更新时保留站点现有文件
        if (appAdsTemplate && (isNew || forceInjectTemplate)) {
          const tmpl = fs.readFileSync(appAdsTemplate)
          fs.writeFileSync(path.join(finalDir, 'app-ads.txt'), tmpl)
          this.log(`  📄 注入 app-ads.txt (${tmpl.length} bytes)`)
        } else if (!fs.existsSync(path.join(finalDir, 'app-ads.txt'))) {
          // zip 里没有 app-ads.txt → 从线上站点取回，避免更新时丢失
          const live = await this.fetchLiveAppAds(proj)
          if (live) {
            fs.writeFileSync(path.join(finalDir, 'app-ads.txt'), live)
            this.log(`  🔒 已从线上保留 app-ads.txt (${live.length} bytes)`)
          } else {
            this.log(`  ⚠️ zip 与线上均无 app-ads.txt`)
          }
        } else {
          this.log(`  🔒 保留 zip 内 app-ads.txt`)
        }

        // 4) 构建文件清单
        const files = this.collectFiles(finalDir)
        const fileContainers: FileContainer[] = []
        const manifest: Record<string, string> = {}

        for (const [relPath, content] of files) {
          const hash = this.api.hash(content)
          const contentType = guessContentType(relPath)
          const size = content.length
          manifest[relPath] = hash
          fileContainers.push({ hash, value: content, contentType, size })
        }
        this.log(`  📦 共 ${fileContainers.length} 个文件，总 ${(fileContainers.reduce((a, f) => a + f.size, 0) / 1024).toFixed(1)} KB`)

        // 5) Direct Upload 流程
        this.log(`  🔑 获取 upload JWT ...`)
        const jwt = await this.api.getUploadJwt(proj)

        const allHashes = fileContainers.map(f => f.hash)
        this.log(`  🔍 检查已缓存文件 ...`)
        const missingHashes = await this.api.checkMissing(jwt, allHashes)

        const missingFiles = fileContainers.filter(f => missingHashes.includes(f.hash))
        this.log(`  📤 需上传 ${missingFiles.length} 个文件 (${allHashes.length - missingFiles.length} 已缓存)`)

        if (missingFiles.length > 0) {
          // Cloudflare 限制 batch size，分批上传
          const BATCH = 50
          for (let i = 0; i < missingFiles.length; i += BATCH) {
            const batch = missingFiles.slice(i, i + BATCH)
            await this.api.uploadAssets(jwt, batch.map(f => ({
              key: f.hash, value: f.value, contentType: f.contentType
            })))
            this.log(`    上传 ${Math.min(i + BATCH, missingFiles.length)}/${missingFiles.length}`)
          }
        }

        await this.api.upsertHashes(jwt, allHashes)

        // 6) 创建部署
        this.log(`  🚀 创建部署 ...`)
        const deployRes = await this.api.createDeployment(proj, manifest, 'main')
        if (!deployRes?.success) {
          throw new Error(`createDeployment 失败: ${JSON.stringify(deployRes?.errors)}`)
        }
        const sub = (existing as any)?.result?.subdomain || proj + '.pages.dev'
        this.log(`  ✨ 部署成功: https://${sub}`)

        results.push({ project: proj, success: true, subdomain: sub })

        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch (e: any) {
        this.log(`  ❌ ${proj} 失败: ${e?.message || String(e)}`)
        errors.push(`${proj}: ${e?.message || String(e)}`)
        results.push({ project: proj, success: false, error: e?.message || String(e) })
      }
    }

    return { results, errors }
  }

  /** 从线上站点取回 app-ads.txt（更新部署时保留用） */
  private fetchLiveAppAds(proj: string, timeoutMs = 10000): Promise<Buffer | null> {
    const tryUrl = (url: string): Promise<Buffer | null> =>
      new Promise(resolve => {
        const mod = url.startsWith('https') ? https : http
        const req = mod.get(url, { timeout: timeoutMs }, res => {
          if (res.statusCode !== 200) { res.resume(); return resolve(null) }
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            const buf = Buffer.concat(chunks)
            resolve(buf.length > 500 ? buf : null)
          })
        })
        req.on('error', () => resolve(null))
        req.on('timeout', () => { req.destroy(); resolve(null) })
      })

    return (async () => {
      for (const url of [`https://${proj}.us/app-ads.txt`, `https://${proj}.pages.dev/app-ads.txt`]) {
        const buf = await tryUrl(url)
        if (buf) return buf
      }
      return null
    })()
  }

  private copyRecursive(src: string, dest: string) {
    const st = fs.statSync(src)
    if (st.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
      for (const entry of fs.readdirSync(src)) {
        this.copyRecursive(path.join(src, entry), path.join(dest, entry))
      }
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(src, dest)
    }
  }

  private collectFiles(dir: string): Map<string, Buffer> {
    const map = new Map<string, Buffer>()
    const walk = (cur: string, base: string) => {
      for (const f of fs.readdirSync(cur, { withFileTypes: true })) {
        // 跳过 macOS 资源分支与隐藏文件
        if (f.name === '__MACOSX' || f.name.startsWith('.')) continue
        const full = path.join(cur, f.name)
        const rel = path.relative(base, full).replace(/\\/g, '/')
        if (f.isDirectory()) walk(full, base)
        else map.set(rel, fs.readFileSync(full))
      }
    }
    walk(dir, dir)
    return map
  }
}
