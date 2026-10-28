import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import { spawn } from 'child_process'
import { app } from 'electron'
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

export class DeployEngine {
  private api: CloudflareAPI
  private log: LogFn
  private creds: CloudflareCreds

  constructor(creds: CloudflareCreds, log: LogFn) {
    this.creds = creds
    this.api = new CloudflareAPI(creds)
    this.log = log
  }

  /** 调用 wrangler CLI 部署目录（官方 Direct Upload 实现） */
  private runWrangler(dir: string, proj: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 内置单文件 wrangler + 启动垫片（打包后均在 resources/ 下）
      // 垫片作用：Electron 以 ELECTRON_RUN_AS_NODE 运行时 process.versions.electron
      // 存在，yargs 的 hideBin() 会把脚本路径误判为用户参数，垫片负责修正。
      const searchDirs = [
        process.resourcesPath || '',
        path.join(app.getAppPath(), 'resources'),
        path.join(__dirname, '../../resources')
      ]
      const find = (name: string) =>
        searchDirs.map(d => path.join(d, name)).find(p => p && fs.existsSync(p))
      const bin = find('wrangler-cli.js')
      const runner = find('wrangler-runner.js')
      if (!bin) return reject(new Error('未找到内置 wrangler-cli.js'))
      if (!runner) return reject(new Error('未找到内置 wrangler-runner.js'))

      const args = [runner, bin, 'pages', 'deploy', dir, '--project-name', proj, '--branch', 'main', '--commit-dirty=true']
      // wrangler 认证：优先 API Token，其次 Global Key + 邮箱（legacy）
      const authEnv: Record<string, string> = {}
      if (this.creds.apiToken) {
        authEnv.CLOUDFLARE_API_TOKEN = this.creds.apiToken
      } else if (this.creds.globalKey && this.creds.email) {
        authEnv.CLOUDFLARE_API_KEY = this.creds.globalKey
        authEnv.CLOUDFLARE_EMAIL = this.creds.email
      } else {
        return reject(new Error('缺少凭据：请在「设置」填写 API Token，或 Global Key + 邮箱'))
      }
      const child = spawn(process.execPath, args, {
        cwd: dir,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          ...authEnv,
          CLOUDFLARE_ACCOUNT_ID: this.creds.accountId,
          WRANGLER_SEND_METRICS: 'false',
          CI: 'true'
        }
      })
      let out = ''
      child.stdout?.on('data', d => { out += d.toString() })
      child.stderr?.on('data', d => { out += d.toString() })
      child.on('error', reject)
      child.on('close', code => {
        if (code === 0) {
          const m = out.match(/https:\/\/[a-z0-9]+\.\S+\.pages\.dev/i)
          this.log(`  ▲ wrangler 部署完成${m ? ' ' + m[0] : ''}`)
          resolve()
        } else {
          const clean = out.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim()
          reject(new Error(`wrangler 失败: ${clean.slice(-600)}`))
        }
      })
    })
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

        // 4) 统计待部署文件
        const files = this.collectFiles(finalDir)
        const totalSize = [...files.values()].reduce((a, b) => a + b.length, 0)
        this.log(`  📦 共 ${files.size} 个文件，总 ${(totalSize / 1024).toFixed(1)} KB`)

        // 5) 用 wrangler 部署（官方实现，保证 manifest 与资源注册完全正确）
        this.log(`  🚀 部署中 ...`)
        await this.runWrangler(finalDir, proj)

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
