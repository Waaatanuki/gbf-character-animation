# Cloudflare Worker 代理方案

这是一套给当前仓库配套的只读资源代理 Worker，用来把浏览器原本会被 CORS 拦截的 GBF 角色脚本和图片请求，转成你自己域名下的同源请求。

## 暴露的接口

- `GET /health`
  - 健康检查。
- `GET /version`
  - 请求 `https://game.granbluefantasy.jp/` 并提取当前资源版本号。
  - 返回示例：`{ "version": "1776998104" }`
- `GET /js/cjs/<scriptId>.js?version=<版本号>`
  - 代理角色脚本，例如 `npc_3040638000_01.js`。
- `GET /img/cjs/<imageId>.png`
  - 代理角色图片，例如 `npc_3040638000_01.png`。

## 目录结构

```text
worker/
  package.json
  tsconfig.json
  wrangler.jsonc
  .dev.vars.example
  src/
    index.ts
```

## 部署前准备

1. 安装依赖

```bash
pnpm --dir worker install
```

2. 登录 Cloudflare

```bash
pnpm --dir worker exec wrangler login
```

3. 准备本地环境变量

```bash
cp worker/.dev.vars.example worker/.dev.vars
```

## 本地调试

```bash
pnpm --dir worker dev
```

默认会启动本地 Worker 调试服务。你可以直接访问：

- `http://127.0.0.1:8787/health`
- `http://127.0.0.1:8787/version`

## 发布部署

直接发布到 `workers.dev`：

```bash
pnpm --dir worker deploy
```

如果要绑自定义域名，先在 Cloudflare Dashboard 里给 Worker 配 route，然后再把 `wrangler.jsonc` 补上 `routes`。

## 可配置环境变量

- `ALLOWED_ORIGINS`
  - 逗号分隔的前端来源白名单。
  - 例如：`https://gbf-animation.example.com,http://localhost:5173`
  - 未设置时默认允许任意来源，适合开发，生产建议显式配置。
- `VERSION_TTL_SECONDS`
  - `/version` 的边缘缓存时间，默认 `300`。
- `ASSET_TTL_SECONDS`
  - 脚本和图片代理的边缘缓存时间，默认 `86400`。
- `GAME_HOME_URL`
  - 可选，覆盖版本号来源首页。
- `ASSET_BASE_URL`
  - 可选，覆盖脚本上游地址前缀。
- `IMAGE_BASE_URL`
  - 可选，覆盖图片上游地址前缀。

## 前端接入示例

当前仓库已经按这个 Worker 接口形状实现了前端运行时切换，默认约定如下：

- `public/data.json` 继续由前端本地读取。
- `public/js/runtime/createjs.js` 继续本地提供。
- 角色脚本和图片统一走 Worker 代理。

如果你在别的前端项目里复用，也可以按下面这种方式拼地址：

```ts
const proxyBase = 'https://gbf-character-animation-proxy.your-subdomain.workers.dev'

async function fetchRemoteVersion() {
  const response = await fetch(`${proxyBase}/version`)
  if (!response.ok)
    throw new Error('版本号请求失败')

  const data = await response.json() as { version: string }
  return data.version
}

function getRemoteScriptUrl(scriptId: string, version: string) {
  return `${proxyBase}/js/cjs/${scriptId}.js?version=${version}`
}

function getRemoteImageUrl(imageId: string) {
  return `${proxyBase}/img/cjs/${imageId}.png`
}
```

当前仓库前端通过 `VITE_GBF_PROXY_BASE` 指向独立 Worker 域名；若 Worker 已绑定同源路由，也可以不配置这个变量。

## 为什么是这种接口形状

这样设计有几个目的：

1. 尽量贴近你现有项目的 `js/cjs`、`img/cjs` 目录约定，切换成本低。
2. 只开放脚本、图片、版本号这三类必需请求，避免做成泛用公开代理。
3. 脚本地址把 `version` 放到查询参数里，方便和 `/version` 接口配套使用。
4. Worker 会在边缘缓存 200 响应，并对 404 使用短缓存，降低重复回源。

## 生产建议

1. 一定设置 `ALLOWED_ORIGINS`，不要长期裸开 `*`。
2. 如果流量上来，再给 Worker 加一层简单的速率限制或 Token 校验。
3. 只代理当前项目需要的路径，不要扩成任意 URL 转发器。
4. 如果你后面要接入运行时远程加载，可以先把 CreateJS 运行时仍保留本地，先只远程代理 `js/cjs` 和 `img/cjs`。
