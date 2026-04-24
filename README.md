# GBF Character Animation

基于 Vue 3 + Vite 的 GBF 角色、皮肤与敌人动作预览和 GIF 导出工具。

## 运行时资源

角色脚本与图片在生产环境通过 Cloudflare Worker 代理按需加载；本地开发时由 Vite dev server 的 Node 中间件直接代理上游资源。

- 运行时索引使用 `public/data.json`。
- CreateJS 运行时位于 `public/js/runtime/createjs.js`。
- 前端可通过 `VITE_GBF_PROXY_BASE` 指向独立 Worker 域名；本地开发时会强制走当前 Vite 源站的同源 Node 代理，不依赖这个变量。

## 资源加载规则

- 页面输入的是角色、皮肤或敌人的基础 ID，例如 `3040638000`、`3710191000`、`1200011`。
- 候选资源名和图片 ID 通过 `public/data.json` 推导。
- 实际加载时会按 `public/data.json` 中的图片 ID 归并出脚本组，再通过 `/version`、`/js/cjs/*`、`/img/cjs/*` 接口拉取远程资源，并从 `js/runtime` 加载 CreateJS 运行时。本地开发下这些接口由 Vite 的 Node 进程处理，生产环境再由 Worker 提供。
- 本体动作先进入就绪状态，特效资源异步补齐；特效缺失时不会阻塞角色本体动作。

## 资源索引脚本

- `script/fetchResource.ts` 会从 `https://raw.githubusercontent.com/MizaGBF/GBFAL/refs/heads/main/json/data.json` 拉取远端索引。
- 脚本会保留动画相关的 `characters`、`skins` 和 `enemies`，并统一裁剪为 `npc` / `special` 两类资源后写入 `public/data.json`。
- 脚本会额外请求 `https://game.granbluefantasy.jp/` 提取当前资源版本号，方便在更新索引时确认上游版本仍可解析。
- 该脚本负责生成 `public/data.json`，不会下载本地角色脚本与图片。
- 执行命令：`pnpm fetch:resource`

## Cloudflare Worker 代理

- 仓库内附带了一套可独立部署的 Cloudflare Worker 代理，目录在 [worker/README.md](worker/README.md)。
- 它提供 `version`、`js/cjs`、`img/cjs` 三类只读代理接口，用来解决浏览器直接请求 GBF 资源时的跨域问题。
- 部署与调试命令都在该目录自己的 `package.json` 中，不会污染当前 Vite 应用依赖。

## 环境变量

```bash
VITE_GBF_PROXY_BASE=http://127.0.0.1:8787
```

- 本地开发时不需要再启动 `wrangler dev`；Vite 会在当前源站下直接代理这些接口。
- 如果线上把 Worker 绑到了和页面同源的路由，这个变量可以留空。

## GitHub Pages

- 仓库内置了 [deploy-pages.yml](.github/workflows/deploy-pages.yml)，每次 push 到 `main` 都会自动构建并发布到 GitHub Pages。
- Workflow 会在 CI 中注入：
  - `VITE_APP_BASE=/gbf-character-animation/`
  - `VITE_GBF_PROXY_BASE=https://gbf-character-animation-proxy.watanukipublic.workers.dev`
- 第一次启用前，去 GitHub 仓库设置里把 Pages Source 切到 `GitHub Actions`。

## 开发命令

```bash
pnpm install
pnpm fetch:resource
pnpm dev
pnpm build
pnpm exec vite preview
```
