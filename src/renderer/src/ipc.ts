// Electron IPC 统一包装：Vue 响应式 Proxy 穿透 contextBridge 时
// 结构化克隆会抛 "An object could not be cloned"，
// 必须在主世界（调用前）净化为纯对象，preload 内净化来不及
const rawApi = (window as any).api

const clean = (v: any) => (v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)))

const wrapped: any = {}
for (const key of Object.keys(rawApi)) {
  const fn = rawApi[key]
  if (typeof fn !== 'function') {
    wrapped[key] = fn
    continue
  }
  wrapped[key] = (...args: any[]) => {
    if (key === 'onDeployLog') return fn(...args) // 回调参数不能序列化
    return fn(...args.map(clean))
  }
}

export default wrapped
