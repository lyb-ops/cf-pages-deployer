import { CloudflareAPI } from './cloudflare'
import type { CloudflareCreds } from './crypto'

export interface BatchDnsSetupParams {
  sites: { project: string; domain: string }[]
}

export type LogFn = (msg: string) => void

const PARKING_IPS = new Set(['3.33.130.190', '15.197.148.33', '47.251.109.182', '43.110.32.104'])

export class DnsEngine {
  private api: CloudflareAPI
  private log: LogFn

  constructor(creds: CloudflareCreds, log: LogFn) {
    this.api = new CloudflareAPI(creds)
    this.log = log
  }

  async batchSetup(params: BatchDnsSetupParams): Promise<{ results: any[]; errors: string[] }> {
    const results: any[] = []
    const errors: string[] = []

    for (const { project, domain } of params.sites) {
      try {
        this.log(`\n=== ${domain} (project=${project}) ===`)

        // 1) 查 zone
        let zone = await this.api.getZone(domain)
        if (!zone) {
          this.log(`  ⚠️ zone 不存在，创建 ...`)
          const createRes = await this.api.createZone(domain)
          if (!createRes?.success) {
            throw new Error(`创建 zone 失败: ${JSON.stringify(createRes?.errors)}`)
          }
          zone = createRes.result
          const ns = zone.name_servers || []
          this.log(`  ✅ zone 已创建，nameservers: ${ns.join(', ')}`)
          this.log(`  ⚠️ 请在 GoDaddy 把 NS 改为上面两个，等生效后再跑一次 DNS 绑定`)
          results.push({ domain, project, zoneCreated: true, needNsSwitch: true })
          continue
        }
        const zoneId = zone.id

        // 2) 查 Pages subdomain
        const projRes: any = await this.api.getProject(project)
        if (!projRes?.success) {
          throw new Error(`Pages project 不存在: ${project}`)
        }
        const subdomain = projRes.result.subdomain
        this.log(`  Pages subdomain: ${subdomain}`)

        // 3) 清理旧 DNS
        this.log(`  🧹 清理旧 DNS 记录 ...`)
        const dnsRecords = await this.api.listDnsRecords(zoneId)
        let delCount = 0
        for (const r of dnsRecords) {
          const name = r.name
          const type = r.type
          const content = r.content || ''

          const shouldDel =
            (type === 'A' && name === domain && PARKING_IPS.has(content)) ||
            (type === 'CNAME' && (name === domain || name === `www.${domain}`) && !content.includes('pages.dev')) ||
            name.includes('_domainconnect')

          if (shouldDel) {
            await this.api.deleteDnsRecord(zoneId, r.id)
            this.log(`    DEL ${type} ${name} (${content})`)
            delCount++
          }
        }
        this.log(`  清理了 ${delCount} 条旧记录`)

        // 4) 创建 CNAME
        for (const label of [domain, `www.${domain}`]) {
          // 先删残留
          for (const r of await this.api.listDnsRecords(zoneId)) {
            if (r.name === label && (r.type === 'CNAME' || r.type === 'A' || r.type === 'AAAA')) {
              await this.api.deleteDnsRecord(zoneId, r.id)
              this.log(`    删残留 ${r.type} ${label}`)
            }
          }

          const cnameRes = await this.api.createDnsRecord(zoneId, {
            type: 'CNAME',
            name: label,
            content: subdomain,
            proxied: true,
            ttl: 1
          })
          if (cnameRes?.success) {
            this.log(`  ✅ CNAME ${label} -> ${subdomain}`)
          } else {
            const errs = cnameRes?.errors || []
            if (errs[0]?.code === 81053) {
              this.log(`  ⚠️ CNAME ${label} 已存在或冲突`)
            } else {
              throw new Error(`建 CNAME 失败: ${JSON.stringify(errs)}`)
            }
          }
        }

        // 5) 绑 Pages 自定义域名
        for (const bd of [domain, `www.${domain}`]) {
          const bindRes: any = await this.api.addCustomDomain(project, bd)
          if (bindRes?.success) {
            this.log(`  ✅ Pages 绑定 ${bd}`)
          } else if (bindRes?.errors?.[0]?.code === 8000018) {
            this.log(`  ⏭️  Pages ${bd} 已绑定`)
          } else {
            this.log(`  ⚠️ Pages 绑定 ${bd}: ${JSON.stringify(bindRes?.errors)}`)
          }
        }

        results.push({ domain, project, success: true, zoneId })
      } catch (e: any) {
        this.log(`  ❌ ${domain} 失败: ${e?.message || String(e)}`)
        errors.push(`${domain}: ${e?.message || String(e)}`)
        results.push({ domain, project, success: false, error: e?.message || String(e) })
      }
    }
    return { results, errors }
  }
}
