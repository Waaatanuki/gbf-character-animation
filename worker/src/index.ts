interface Env {
  ALLOWED_ORIGINS?: string
  VERSION_TTL_SECONDS?: string
  ASSET_TTL_SECONDS?: string
  GAME_HOME_URL?: string
  ASSET_BASE_URL?: string
  IMAGE_BASE_URL?: string
}

const defaultGameHomeUrl = 'https://game.granbluefantasy.jp/'
const defaultAssetBaseUrl = 'https://prd-game-a-granbluefantasy.akamaized.net/assets'
const defaultImageBaseUrl = `${defaultAssetBaseUrl}/img/sp/cjs`
const versionPattern = /"version"\s*:\s*"(\d+)"/
const scriptPathPattern = /^\/js\/cjs\/(\w+\.js)$/i
const imagePathPattern = /^\/img\/cjs\/(\w+\.png)$/i

interface CfRequestInit extends RequestInit {
  cf?: {
    cacheEverything?: boolean
    cacheTtl?: number
    cacheTtlByStatus?: Record<string, number>
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS')
      return handleOptions(request, env)

    if (request.method !== 'GET' && request.method !== 'HEAD')
      return withCors(request, env, new Response('Method Not Allowed', { status: 405 }))

    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return withCors(request, env, jsonResponse({ ok: true }, { cacheControl: 'no-store' }))
    }

    if (url.pathname === '/version') {
      return handleVersion(request, env)
    }

    const scriptMatch = url.pathname.match(scriptPathPattern)
    if (scriptMatch)
      return handleScriptProxy(request, env, scriptMatch[1], url.searchParams)

    const imageMatch = url.pathname.match(imagePathPattern)
    if (imageMatch)
      return handleImageProxy(request, env, imageMatch[1])

    return withCors(request, env, jsonResponse({
      error: 'Not Found',
      routes: [
        'GET /health',
        'GET /version',
        'GET /js/cjs/:scriptId.js?version=<gbfVersion>',
        'GET /img/cjs/:imageId.png',
      ],
    }, { status: 404 }))
  },
}

async function handleVersion(request: Request, env: Env) {
  const ttl = getPositiveInt(env.VERSION_TTL_SECONDS, 300)
  const homepageUrl = env.GAME_HOME_URL || defaultGameHomeUrl

  try {
    const homepage = await fetchTextWithRetry(homepageUrl, ttl)
    const version = homepage.match(versionPattern)?.[1]

    if (!version) {
      return withCors(request, env, jsonResponse({ error: '未能从首页提取版本号' }, {
        status: 502,
        cacheControl: 'no-store',
      }))
    }

    return withCors(request, env, jsonResponse({ version }, {
      cacheControl: `public, max-age=60, s-maxage=${ttl}`,
    }))
  }
  catch (error) {
    return withCors(request, env, jsonResponse({
      error: '版本请求失败',
      detail: error instanceof Error ? error.message : String(error),
    }, {
      status: 502,
      cacheControl: 'no-store',
    }))
  }
}

async function handleScriptProxy(request: Request, env: Env, scriptFileName: string, searchParams: URLSearchParams) {
  const version = searchParams.get('version')
  if (!version || !/^\d+$/.test(version)) {
    return withCors(request, env, jsonResponse({ error: '缺少合法的 version 查询参数' }, {
      status: 400,
      cacheControl: 'no-store',
    }))
  }

  const assetBaseUrl = env.ASSET_BASE_URL || defaultAssetBaseUrl
  const ttl = getPositiveInt(env.ASSET_TTL_SECONDS, 86400)
  const upstreamUrl = `${assetBaseUrl}/${version}/js/cjs/${scriptFileName}`
  return proxyUpstream(request, env, upstreamUrl, ttl)
}

async function handleImageProxy(request: Request, env: Env, imageFileName: string) {
  const imageBaseUrl = env.IMAGE_BASE_URL || defaultImageBaseUrl
  const ttl = getPositiveInt(env.ASSET_TTL_SECONDS, 86400)
  const upstreamUrl = `${imageBaseUrl}/${imageFileName}`
  return proxyUpstream(request, env, upstreamUrl, ttl)
}

async function proxyUpstream(request: Request, env: Env, upstreamUrl: string, ttl: number) {
  try {
    const upstreamResponse = await fetchRawWithRetry(upstreamUrl, {
      method: request.method,
      cf: {
        cacheEverything: true,
        cacheTtl: ttl,
        cacheTtlByStatus: {
          '200-299': ttl,
          '404': 60,
          '500-599': 0,
        },
      },
    })

    const headers = new Headers(upstreamResponse.headers)
    headers.set('Cache-Control', `public, max-age=0, s-maxage=${ttl}`)
    headers.set('X-Proxy-Upstream', upstreamUrl)
    headers.delete('set-cookie')

    return withCors(request, env, new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    }))
  }
  catch (error) {
    return withCors(request, env, jsonResponse({
      error: '上游请求失败',
      detail: error instanceof Error ? error.message : String(error),
      upstreamUrl,
    }, {
      status: 502,
      cacheControl: 'no-store',
    }))
  }
}

async function fetchTextWithRetry(url: string, ttl: number) {
  return await readWithRetry(url, response => response.text(), ttl)
}

async function readWithRetry<T>(url: string, reader: (response: Response) => Promise<T>, ttl: number, retries = 3) {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithRetry(url, {
        cf: {
          cacheEverything: true,
          cacheTtl: ttl,
          cacheTtlByStatus: {
            '200-299': ttl,
            '404': 60,
            '500-599': 0,
          },
        },
      })

      return await reader(response)
    }
    catch (error) {
      lastError = error
      if (attempt === retries || !isRetryableError(error))
        throw error
    }
  }

  throw lastError
}

async function fetchWithRetry(url: string, init: CfRequestInit, retries = 3) {
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

async function fetchRawWithRetry(url: string, init: CfRequestInit, retries = 3) {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init)
    }
    catch (error) {
      lastError = error
      if (attempt === retries || !isRetryableError(error))
        throw error
    }
  }

  throw lastError
}

function isRetryableError(error: unknown) {
  if (!(error instanceof Error))
    return false

  return [
    error.name,
    error.message,
    (error as Error & { cause?: { code?: string } }).cause?.code,
  ].some(value => typeof value === 'string' && /timeout|terminated|aborted|econnreset|und_err/i.test(value))
}

function handleOptions(request: Request, env: Env) {
  const headers = new Headers()
  applyCorsHeaders(headers, request, env)
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type')
  headers.set('Access-Control-Max-Age', '86400')
  return new Response(null, { status: 204, headers })
}

function withCors(request: Request, env: Env, response: Response) {
  const headers = new Headers(response.headers)
  applyCorsHeaders(headers, request, env)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function applyCorsHeaders(headers: Headers, request: Request, env: Env) {
  const requestOrigin = request.headers.get('Origin')
  const allowOrigin = resolveAllowOrigin(requestOrigin, env.ALLOWED_ORIGINS)
  if (allowOrigin)
    headers.set('Access-Control-Allow-Origin', allowOrigin)

  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type, X-Proxy-Upstream')
  headers.set('Vary', 'Origin')
}

function resolveAllowOrigin(requestOrigin: string | null, allowedOriginsRaw?: string) {
  const allowedOrigins = (allowedOriginsRaw || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

  if (allowedOrigins.length === 0)
    return '*'

  if (!requestOrigin)
    return null

  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null
}

function getPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function jsonResponse(body: unknown, options?: { status?: number, cacheControl?: string }) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
  })

  if (options?.cacheControl)
    headers.set('Cache-Control', options.cacheControl)

  return new Response(JSON.stringify(body, null, 2), {
    status: options?.status ?? 200,
    headers,
  })
}
