import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Connect, ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig, loadEnv } from 'vite'

const defaultGameHomeUrl = 'https://game.granbluefantasy.jp/'
const defaultAssetBaseUrl = 'https://prd-game-a-granbluefantasy.akamaized.net/assets'
const defaultImageBaseUrl = `${defaultAssetBaseUrl}/img/sp/cjs`
const retryableErrorPattern = /timeout|terminated|aborted|econnreset|und_err/i
const versionPattern = /"version"\s*:\s*"(\d+)"/

function jsonResponse(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(payload))

  for (const [key, value] of Object.entries(extraHeaders ?? {}))
    res.setHeader(key, value)

  res.end(payload)
}

function isRetryableError(error: unknown) {
  if (!(error instanceof Error))
    return false

  return [
    error.name,
    error.message,
    (error as Error & { cause?: { code?: string } }).cause?.code,
  ].some(value => typeof value === 'string' && retryableErrorPattern.test(value))
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 3) {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init)
      if (!response.ok)
        throw new Error(`请求失败: ${response.status} ${response.statusText}`)

      return response
    }
    catch (error) {
      lastError = error
      if (attempt === retries || !isRetryableError(error))
        throw error
    }
  }

  throw lastError
}

function createLocalVersionRoute() {
  return {
    name: 'gbf-local-version-route',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const isHandledRoute = url.pathname === '/health' || url.pathname === '/version'

        if (!isHandledRoute)
          return next()

        if (req.method !== 'GET' && req.method !== 'HEAD') {
          jsonResponse(res, 405, { error: 'Method Not Allowed' }, { 'Cache-Control': 'no-store' })
          return
        }

        try {
          if (url.pathname === '/health') {
            jsonResponse(res, 200, { ok: true }, { 'Cache-Control': 'no-store' })
            return
          }

          if (url.pathname === '/version') {
            const homepage = await fetchWithRetry(defaultGameHomeUrl, { method: 'GET' }).then(response => response.text())
            const version = homepage.match(versionPattern)?.[1]

            if (!version) {
              jsonResponse(res, 502, { error: '未能从首页提取版本号' }, { 'Cache-Control': 'no-store' })
              return
            }

            jsonResponse(res, 200, { version }, { 'Cache-Control': 'no-store' })
            return
          }
        }
        catch (error) {
          jsonResponse(res, 502, {
            error: '上游请求失败',
            detail: error instanceof Error ? error.message : String(error),
          }, { 'Cache-Control': 'no-store' })
          return
        }

        next()
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_APP_BASE || '/'

  return {
    base,
    plugins: [
      createLocalVersionRoute(),
      vue(),
      AutoImport({
        imports: ['vue'],
        dts: 'types/auto-imports.d.ts',
        vueTemplate: true,
      }),
      Components({
        dts: 'types/components.d.ts',
      }),
      UnoCSS({ inspector: false }),
    ],
    server: {
      proxy: {
        '/js/cjs': {
          target: defaultAssetBaseUrl,
          changeOrigin: true,
          rewrite(path) {
            const url = new URL(path, 'http://127.0.0.1')
            const version = url.searchParams.get('version')
            if (!version || !/^\d+$/.test(version))
              return path

            url.searchParams.delete('version')
            const queryString = url.searchParams.toString()
            return `/${version}${url.pathname}${queryString ? `?${queryString}` : ''}`
          },
        },
        '/img/cjs': {
          target: defaultImageBaseUrl,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/img\/cjs/, ''),
        },
      },
    },
  }
})
