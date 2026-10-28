// wrangler 启动垫片
// 问题 1：Electron 以 ELECTRON_RUN_AS_NODE=1 运行时，process.versions.electron 存在
//   且 process.defaultApp 为空，yargs 的 getProcessArgvBinIndex() 会返回 0，
//   导致 hideBin() 把脚本路径当成第一个用户参数，wrangler 报
//   "Unknown arguments: ... wrangler-cli.js, pages, deploy, ..."。
// 问题 2：wrangler-cli.js 入口有 `require.main === module` 守卫，
//   直接 require() 不会执行主函数，进程静默退出。
// 这里在加载 wrangler 之前把进程伪装成普通 node 进程、规范化 argv，
// 并用 Module.runMain 把 wrangler 作为「主模块」运行。
const path = require('path')
const Module = require('module')

const wranglerPath = path.resolve(process.argv[2])
process.argv = [process.argv[0], wranglerPath, ...process.argv.slice(3)]

if (process.versions && process.versions.electron) {
  // 让 isElectronApp() 返回 false → getProcessArgvBinIndex() 返回 1 → hideBin 取 slice(2)
  try { delete process.versions.electron } catch { /* ignore */ }
  process.defaultApp = false
}

Module.runMain(wranglerPath)
