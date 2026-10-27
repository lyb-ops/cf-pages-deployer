# CF Pages Deployer

☁️ Cloudflare Pages 批量部署桌面工具 — Windows exe，类似 OSSBrowser2 体验。

## ✨ 功能

- **🔐 凭据安全存储**：API Token / Global Key / Account ID 用系统安全存储（Windows DPAPI / macOS Keychain），不会明文落盘
- **📁 Pages 项目管理**：列出 / 新建 / 查看所有 Pages 项目
- **🚀 批量部署**：选目录 → 勾项目 → 一键批量部署（Direct Upload API，**无需 wrangler / Node.js**）
  - 自动 zip 解压 + 目录提平
  - 智能 app-ads.txt 注入（仅新项目首次部署注入模板，更新老项目保留站点内原文件）
- **🔧 DNS 管理**：Zone 迁入、DNS 记录增删改、旧记录清理、批量 CNAME 绑定
- **🌐 Direct Upload API**：绕过 wrangler，完全用 HTTP 上传，exe 开箱即用

## 🚀 Windows 构建

### 方式一：GitHub Actions 自动构建（推荐）

1. 把整个 `cf-pages-deployer/` 目录 push 到 GitHub
2. GitHub 仓库 → Actions → 选择 "Build Windows Installer" → Run workflow
3. 等 3-5 分钟，下载 artifact 里的 `.exe`

### 方式二：本地 Windows 构建

```powershell
# 1. 安装 Node.js 20+ (https://nodejs.org)
# 2. 克隆项目后在 PowerShell 中：
cd cf-pages-deployer
npm install
npm run build:win
# 产物在 release/CF Pages Deployer-<版本>-x64.exe
```

安装包双击即可安装，或者用 `npm run dist:win` 出 portable zip。

### 方式三：macOS 上开发调试（不能出 exe，只能跑）

```bash
npm install
npm run dev
```

## 🔑 首次使用

1. 打开应用，进入 **⚙️ 设置** Tab
2. 填入 Cloudflare 凭据：

| 字段 | 说明 |
|------|------|
| Account ID | Dashboard → 头像 → My Profile → Accounts → 顶部 Account ID |
| 邮箱 | 登录 Cloudflare 的邮箱 |
| API Token | API Tokens → Create Custom Token → Account: Pages:Edit + Account: Pages:Read |
| Global Key | API Keys → View Global API Key（DNS 增删用） |

3. 点 **🔌 测试连接**，成功后点 **💾 保存**（凭据进系统安全存储）

## 📖 工作流示例

### 场景 A：7 个新域名首次部署

1. **⚙️ 设置** → 填好凭据并保存
2. **🚀 批量部署** → 选有 `*.us.zip` 的目录 → 勾 7 个项目 → 选 app-ads.txt 模板（留空则不注入）→ 部署
3. 部署完点 **🔧 自动 DNS 绑定** → 批量 CNAME + Pages 域名绑定
4. **🔧 DNS 管理** → 选 Zone → 确认 DNS 记录正确

### 场景 B：老站点更新

1. **🚀 批量部署** → 选源目录 → 勾项目 → 注入策略选 **"不注入，保留站点内原文件"** → 部署
2. 完成，DNS 已绑定过就不用再管

### 场景 C：新域名迁入 Cloudflare

1. **🔧 DNS 管理** → **➕ 迁入新域名** → 输入域名
2. Cloudflare 会返回两个 NS，到 GoDaddy 改 NS
3. 等 NS 生效（几分钟到几小时）
4. **🚀 批量部署** 正常部署
5. **🔧 自动 DNS 绑定** 批量绑 CNAME

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Electron 29 + electron-vite |
| 前端 | Vue 3 + TypeScript |
| 凭据安全 | keytar（Windows DPAPI / macOS Keychain） |
| 部署 | Cloudflare Pages Direct Upload API |
| 打包 | electron-builder（NSIS 安装包） |

## 📁 项目结构

```
cf-pages-deployer/
├── electron/                   # 主进程
│   ├── main.ts                  # Electron 入口 + IPC handlers
│   ├── preload.ts               # 安全桥接
│   └── services/
│       ├── crypto.ts            # keytar 凭据加密
│       ├── cloudflare.ts        # Cloudflare API (Direct Upload)
│       ├── deploy.ts            # 批量部署引擎（解压/提平/上传）
│       └── dns.ts                # DNS 批量清理+绑定引擎
├── src/renderer/                # 渲染进程（前端）
│   ├── index.html
│   └── src/
│       ├── App.vue              # Tab 导航
│       ├── main.ts
│       ├── styles/global.css
│       └── views/
│           ├── Settings.vue     # ⚙️ 设置页
│           ├── Projects.vue     # 📁 项目列表
│           ├── Deploy.vue       # 🚀 批量部署
│           └── DnsManager.vue   # 🔧 DNS 管理
├── electron-vite.config.ts
├── package.json
└── .github/workflows/build.yml  # Windows CI 自动出 exe
```

## ❓ 常见问题

**Q: 为什么不用 wrangler？**
A: Direct Upload API 完全用 HTTP 上传，不需要装 Node.js / wrangler。exe 里直接带上 Electron 运行时，开箱即用。

**Q: keytar 在 Windows 上安全吗？**
A: keytar 在 Windows 用 DPAPI（Data Protection API），每个用户每个机器独立加密；在 macOS 用 Keychain。比硬编码在 exe 里安全一万倍。

**Q: 跨平台构建？**
A: Electron + electron-builder 支持跨平台。推荐在 GitHub Actions 的 windows-latest runner 上构建 Windows exe，macOS 构建 dmg。Windows 上不支持构建 macOS 包，反过来也一样。

**Q: 老项目更新时 app-ads.txt 怎么办？**
A: 不注入，保留站点内原文件。只有新项目首次部署时注入模板。这是可配置的，批量部署页有三个选项。

## 🔐 安全提示

- 凭据存在系统安全存储里，不会进源码 / exe / 日志
- API Token 建议最小权限原则：只给 Pages:Edit + Pages:Read
- Global Key 可以用后轮换
