import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const sourceUrl = 'https://raw.githubusercontent.com/MizaGBF/GBFAL/refs/heads/main/json/data.json'
const currentFile = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(currentFile), '..')
const outputPath = resolve(projectRoot, 'public/data.json')

interface CharacterAnimationEntry {
  npc: string[]
  special: string[]
}

interface ResourcePayload {
  characters: Record<string, CharacterAnimationEntry>
  skins: Record<string, CharacterAnimationEntry>
}

class HttpError extends Error {
  status: number

  constructor(status: number, statusText: string) {
    super(`请求失败: ${status} ${statusText}`)
    this.name = 'HttpError'
    this.status = status
  }
}

function extractVersion(text: string) {
  const match = text.match(/"version"\s*:\s*"(\d+)"/)
  return match?.[1] ?? null
}

function isRetryableRequestError(error: unknown) {
  if (error instanceof HttpError)
    return false

  if (!(error instanceof Error))
    return false

  return [
    error.name,
    error.message,
    (error as Error & { code?: string }).code,
    (error as Error & { cause?: { code?: string } }).cause?.code,
  ].some(value => typeof value === 'string' && /timeout|terminated|aborted|econnreset|und_err/i.test(value))
}

async function requestWithRetry<T>(
  url: string,
  readResponse: (response: Response) => Promise<T>,
  retries = 3,
  retryDelayMs = 1000,
) {
  let lastError: unknown

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url)

      if (!response.ok)
        throw new HttpError(response.status, response.statusText)

      return await readResponse(response)
    }
    catch (error) {
      lastError = error

      if (!isRetryableRequestError(error) || attempt === retries)
        throw error

      console.warn(`请求中断，正在重试 (${attempt}/${retries})...`)
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
    }
  }

  throw lastError
}

async function fetchGameVersion() {
  const text = await requestWithRetry('https://game.granbluefantasy.jp/', response => response.text())
  const version = extractVersion(text)

  if (!version)
    throw new Error('未能从首页提取版本号')

  return version
}

function normalizePayload(source: unknown): ResourcePayload {
  const characters = pickAnimationEntries((source as Record<string, unknown>)?.characters)
  const skins = pickAnimationEntries((source as Record<string, unknown>)?.skins)
  return { characters, skins }
}

function normalizeAssetList(value: unknown) {
  if (!Array.isArray(value))
    return []

  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .map(item => item.replace(/\.png$/i, ''))
}

function pickAnimationEntries(entries: unknown) {
  if (!entries || typeof entries !== 'object')
    return {}

  const result: Record<string, CharacterAnimationEntry> = {}

  for (const [id, value] of Object.entries(entries)) {
    if (!Array.isArray(value))
      continue

    const npc = normalizeAssetList(value[0])
    const special = normalizeAssetList(value[2])
    if (!npc.length && !special.length)
      continue

    result[id] = { npc, special }
  }

  return result
}

async function main() {
  const source = await requestWithRetry(sourceUrl, async (response) => {
    if (!response.ok)
      throw new Error(`远端 data.json 获取失败: ${response.status} ${response.statusText}`)

    return await response.json()
  })
  const payload = normalizePayload(source)
  const version = await fetchGameVersion()

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(payload), 'utf8')

  console.log(`已写入 ${outputPath}`)
  console.log(`version: ${version}`)
  console.log(`characters: ${Object.keys(payload.characters).length}`)
  console.log(`skins: ${Object.keys(payload.skins).length}`)
  console.log('本地角色脚本与图片目录已移除，运行时资源请通过 Worker 代理加载')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
