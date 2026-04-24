<script setup lang="ts">
import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

interface MotionItem {
  key: string
  label: string
}

interface ControlItem {
  key: string
  label: string
  type: 'motion' | 'effect'
}

interface EffectItem {
  key: string // lib 中的根类名
  label: string
  motion?: string // 同时触发的角色动作；省略表示不动角色
  images: string[] // 需要预加载的 png id 列表
  scriptId: string // 对应 Worker 代理下的脚本文件名（无扩展）
  assetVersion: string
  hideCharacter?: boolean // 播放期间隐藏底层角色（必杀过场自带角色绘制）
  scale?: number // 可选：覆盖默认 effectScale
  // 可选：覆盖默认锚点（0~1，相对 canvas 宽高的比例）
  anchor?: { x: number, y: number }
}

interface ResolvedAssetGroup {
  scriptId: string
  imageIds: string[]
}

interface CharacterManifestPayload {
  characters?: Record<string, CharacterManifestEntry>
  skins?: Record<string, CharacterManifestEntry>
}

interface ResolvedCharacterAssets {
  assetVersion: string
  npcScriptId: string
  npcImageIds: string[]
  effects: EffectItem[]
}

interface VersionPayload {
  version?: string
}

interface GifExportQualityOption {
  key: 'compact' | 'standard' | 'balanced' | 'high' | 'ultra'
  label: string
  width: number
  height: number
  tickStep: number
  maxTicks: number
  maxColors: number
}

interface GifFrameSet {
  frames: Uint8ClampedArray[]
  width: number
  height: number
}

interface PixelBounds {
  left: number
  top: number
  right: number
  bottom: number
}

type MotionKey = 'wait' | 'stbwait' | 'attack' | 'double' | 'triple' | 'ability' | 'mortal_A' | 'damage' | 'win' | 'down'

interface CharacterManifestEntry {
  npc: string[]
  special: string[]
}

const props = defineProps<{
  characterId: string
}>()

const localRuntimeBase = `${import.meta.env.BASE_URL}js/runtime`
const characterDataUrl = `${import.meta.env.BASE_URL}data.json`
const configuredProxyBase = ((import.meta.env.VITE_GBF_PROXY_BASE as string | undefined)?.trim().replace(/\/$/, '')) ?? ''
const stageWidth = 640
const stageHeight = 640
const renderPixelRatio = 1
const remoteRequestTimeoutMs = 8000
const assetLoadTimeoutMs = 15000
const exportButtonClass = 'apple-cta w-full shrink-0 sm:w-auto'
const characterScale = 0.8
const characterAnchor = { x: 0.5, y: 0.8 }
const attackComboSequence: MotionKey[] = ['attack', 'double', 'triple']
const effectAnchor = { x: 0, y: 0 }
const effectScale = 1
const gifExportBaseQualityOptions: GifExportQualityOption[] = [
  {
    key: 'compact',
    label: '紧凑',
    width: 180,
    height: 210,
    tickStep: 3,
    maxTicks: 300,
    maxColors: 96,
  },
  {
    key: 'standard',
    label: '标准',
    width: 220,
    height: 257,
    tickStep: 2,
    maxTicks: 330,
    maxColors: 128,
  },
  {
    key: 'balanced',
    label: '平衡',
    width: 240,
    height: 280,
    tickStep: 2,
    maxTicks: 360,
    maxColors: 160,
  },
  {
    key: 'high',
    label: '高清',
    width: 300,
    height: 350,
    tickStep: 1,
    maxTicks: 420,
    maxColors: 224,
  },
  {
    key: 'ultra',
    label: '极清',
    width: stageWidth,
    height: stageHeight,
    tickStep: 1,
    maxTicks: 480,
    maxColors: 256,
  },
]

const motions: MotionItem[] = [
  { key: 'wait', label: '待机1' },
  { key: 'stbwait', label: '待机2' },
  { key: 'combo', label: '普攻' },
  { key: 'ability', label: '技能' },
  { key: 'down', label: '倒地' },
  { key: 'win', label: '胜利' },
]

const canvasRef = ref<HTMLCanvasElement | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')
const exportErrorMessage = ref('')
const currentMotion = ref<MotionKey>('wait')
const queuedMotions = ref<MotionKey[]>([])
const selectedControlKey = ref<string>('wait')
const selectedGifQualityKey = ref<GifExportQualityOption['key']>('balanced')
const isExportingGif = ref(false)

const stage = shallowRef<any>(null)
const motionRoot = shallowRef<any>(null)
const characterClip = shallowRef<any>(null)
const currentNpcScriptId = ref('')
const resolvedEffects = ref<EffectItem[]>([])
const motionSequenceReturn = ref<MotionKey | null>(null)
const motionSequenceHandler = shallowRef<(() => void) | null>(null)
const activeMotionClip = shallowRef<any>(null)
const motionCycleCount = ref(0)
const activeEffect = ref<string | null>(null)
const activeEffectClip = shallowRef<any>(null)
const activeEffectPlaybackClip = shallowRef<any>(null)
const activeEffectTickHandler = shallowRef<(() => void) | null>(null)
const activeEffectCycleCount = ref(0)
const normalizedCharacterId = computed(() => props.characterId.trim())

function getAspectFitSize(sourceWidth: number, sourceHeight: number, maxWidth: number, maxHeight: number) {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      width: Math.max(1, Math.round(maxWidth)),
      height: Math.max(1, Math.round(maxHeight)),
    }
  }

  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

const isReady = computed(() => status.value === 'ready')
const controlItems = computed<ControlItem[]>(() => [
  ...motions.map(motion => ({
    key: motion.key,
    label: motion.label,
    type: 'motion' as const,
  })),
  ...resolvedEffects.value.map(effect => ({
    key: effect.key,
    label: effect.label,
    type: 'effect' as const,
  })),
])
const gifSourceWidth = computed(() => Math.max(stageWidth, canvasRef.value?.width ?? stageWidth))
const gifSourceHeight = computed(() => Math.max(stageHeight, canvasRef.value?.height ?? stageHeight))
const gifExportQualityOptions = computed<GifExportQualityOption[]>(() => {
  const sourceWidth = gifSourceWidth.value
  const sourceHeight = gifSourceHeight.value

  return gifExportBaseQualityOptions.map((option) => {
    if (option.key === 'ultra') {
      return {
        ...option,
        width: sourceWidth,
        height: sourceHeight,
      }
    }

    const maxWidth = option.key === 'high'
      ? Math.max(option.width, Math.round(sourceWidth * 0.75))
      : option.width
    const maxHeight = option.key === 'high'
      ? Math.max(option.height, Math.round(sourceHeight * 0.75))
      : option.height
    const { width, height } = getAspectFitSize(sourceWidth, sourceHeight, maxWidth, maxHeight)

    return {
      ...option,
      width,
      height,
    }
  })
})
const selectedControl = computed(() =>
  controlItems.value.find(item => item.key === selectedControlKey.value) ?? controlItems.value[0] ?? null,
)
const selectedGifQuality = computed(() =>
  gifExportQualityOptions.value.find(option => option.key === selectedGifQualityKey.value) ?? gifExportQualityOptions.value[2],
)
const selectedGifQualityIndex = computed({
  get() {
    const index = gifExportQualityOptions.value.findIndex(option => option.key === selectedGifQualityKey.value)
    return index >= 0 ? index : 2
  },
  set(index: number) {
    const nextOption = gifExportQualityOptions.value[index]
    if (nextOption)
      selectedGifQualityKey.value = nextOption.key
  },
})
const exportButtonLabel = computed(() => {
  if (isExportingGif.value)
    return '导出中…'

  return selectedControl.value
    ? `导出 ${selectedControl.value.label} GIF`
    : '导出 GIF'
})

const remoteScriptAvailabilityCache = new Map<string, Promise<boolean>>()
let characterManifestPromise: Promise<Record<string, CharacterManifestEntry>> | null = null
let remoteVersionPromise: Promise<string> | null = null
let runtimeReadyPromise: Promise<void> | null = null
let activeLoadToken = 0

function setupGlobals() {
  const w = window as any
  w.Game = w.Game ?? {}
  w.Game.setting = w.Game.setting ?? { cjs_mode: 0 }
  w.Game.version = w.Game.version ?? -1
  w.Game.imgUri = w.Game.imgUri ?? ''
  w.lib = w.lib ?? {}
  w.images = w.images ?? {}
  w.ss = w.ss ?? {}
  // GBF 资源里偶尔出现 require([...], cb) 这种 RequireJS 调用，stub 掉避免报错
  if (typeof w.require !== 'function') {
    const raidExtension = new Proxy({
      mChangeMotion: (motion: string) => {
        if (motion === 'mortal_A')
          startMotion('mortal_A')
      },
    }, {
      get(target, property) {
        return property in target ? target[property as keyof typeof target] : () => {}
      },
    })

    const soundModule = new Proxy({
      play: () => {},
    }, {
      get(target, property) {
        return property in target ? target[property as keyof typeof target] : () => {}
      },
    })

    w.require = (deps: string[], cb?: (...args: any[]) => void) => {
      const modules = deps.map((dep) => {
        if (dep === 'lib/raid/extension')
          return raidExtension
        if (dep === 'lib/sound')
          return soundModule
        return {}
      })

      cb?.(...modules)
    }
  }
  // GBF 官方 createjs 末尾用 AMD `define({...})` 导出，没有 RequireJS 时
  // 我们把模块对象直接挂到 window.createjs；同时兼容 define(name, deps, factory) 形式
  if (typeof w.define !== 'function') {
    const define = (a: any, b?: any, c?: any) => {
      const factory = typeof c === 'function' ? c : (typeof b === 'function' ? b : null)
      const value = factory ? factory() : (typeof a === 'object' ? a : null)
      if (value && typeof value === 'object')
        w.createjs = { ...(w.createjs ?? {}), ...value }
    }
    ;(define as any).amd = {}
    w.define = define
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = window.setTimeout(() => {
      img.onload = null
      img.onerror = null
      reject(new Error(`图片加载超时: ${src}`))
    }, assetLoadTimeoutMs)

    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`))
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error(`图片加载失败: ${src}`))
    }
    img.src = src
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message))
    }, ms)

    promise
      .then((value) => {
        window.clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        window.clearTimeout(timer)
        reject(error)
      })
  })
}

function normalizeAssetId(id: string) {
  return id.replace(/\.png$/i, '')
}

function deriveScriptIdFromImageId(id: string) {
  return normalizeAssetId(id).replace(/_[a-z]$/i, '')
}

function extractAssetVariant(scriptId: string) {
  return scriptId.match(/^[a-z]+_\d+_(\d+)/i)?.[1] ?? null
}

function shouldHideCharacterForSpecial(scriptId: string) {
  return !/^nsp_\d+_\d+$/i.test(scriptId)
}

function getWorkerProxyBase() {
  return configuredProxyBase || window.location.origin
}

function getRemoteVersionUrl() {
  return `${getWorkerProxyBase()}/version`
}

function getRemoteScriptUrl(scriptId: string, version: string) {
  return `${getWorkerProxyBase()}/js/cjs/${scriptId}.js?version=${version}`
}

function getRemoteImageUrl(imageId: string) {
  return `${getWorkerProxyBase()}/img/cjs/${imageId}.png`
}

function groupImageIdsByScriptId(imageIds: string[]) {
  const groups = new Map<string, string[]>()

  for (const imageId of imageIds) {
    const normalizedId = normalizeAssetId(imageId)
    const scriptId = deriveScriptIdFromImageId(normalizedId)
    const group = groups.get(scriptId)

    if (group) {
      if (!group.includes(normalizedId))
        group.push(normalizedId)
      continue
    }

    groups.set(scriptId, [normalizedId])
  }

  return Array.from(groups, ([scriptId, groupedImageIds]) => ({
    scriptId,
    imageIds: groupedImageIds,
  }))
}

async function hasRemoteScript(scriptId: string, version: string) {
  const cacheKey = `${version}:${scriptId}`
  if (remoteScriptAvailabilityCache.has(cacheKey))
    return remoteScriptAvailabilityCache.get(cacheKey)!

  const scriptUrl = getRemoteScriptUrl(scriptId, version)
  const request = withTimeout(fetch(scriptUrl), remoteRequestTimeoutMs, `脚本探测超时: ${scriptId}`)
    .then(async (response) => {
      return response.ok
    })
    .catch(() => false)

  remoteScriptAvailabilityCache.set(cacheKey, request)
  return request
}

async function getCharacterManifest() {
  if (!characterManifestPromise) {
    characterManifestPromise = fetch(characterDataUrl)
      .then(async (response) => {
        if (!response.ok)
          throw new Error('角色资源索引加载失败')

        const data = await response.json() as CharacterManifestPayload
        return {
          ...(data.characters ?? {}),
          ...(data.skins ?? {}),
        }
      })
      .catch((error) => {
        characterManifestPromise = null
        throw error
      })
  }

  return await characterManifestPromise
}

async function getRemoteAssetVersion() {
  if (!remoteVersionPromise) {
    remoteVersionPromise = withTimeout(fetch(getRemoteVersionUrl()), remoteRequestTimeoutMs, '版本接口请求超时，请检查 Worker 是否可用')
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Worker 代理版本接口请求失败，请检查 VITE_GBF_PROXY_BASE 或同源路由配置')

        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.includes('application/json')) {
          throw new Error('Worker 代理版本接口返回了非 JSON 内容，请确认本地 Worker 已启动，或 Vite 已把 /version 代理到 Worker')
        }

        const data = await response.json() as VersionPayload
        if (!data.version || !/^\d+$/.test(data.version))
          throw new Error('Worker 代理未返回合法的资源版本号')

        return data.version
      })
      .catch((error) => {
        remoteVersionPromise = null
        throw error
      })
  }

  return await remoteVersionPromise
}

function createSpecialEffect(group: ResolvedAssetGroup, assetVersion: string): EffectItem {
  return {
    key: group.scriptId,
    label: '奥义动画',
    images: group.imageIds,
    scriptId: group.scriptId,
    assetVersion,
    hideCharacter: shouldHideCharacterForSpecial(group.scriptId),
  }
}

async function resolveAvailableAssetGroup(imageIds: string[], assetVersion: string, preferredVariant?: string | null) {
  const groups = groupImageIdsByScriptId(imageIds)
  const prioritizedGroups = preferredVariant
    ? [
        ...groups.filter(group => group.scriptId.endsWith(`_${preferredVariant}`)),
        ...groups.filter(group => extractAssetVariant(group.scriptId) === preferredVariant && !group.scriptId.endsWith(`_${preferredVariant}`)),
        ...groups.filter(group => extractAssetVariant(group.scriptId) !== preferredVariant),
      ]
    : groups

  for (const group of prioritizedGroups) {
    if (!(await hasRemoteScript(group.scriptId, assetVersion)))
      continue

    return group
  }

  return null
}

async function resolveCharacterAssets(characterId: string): Promise<ResolvedCharacterAssets> {
  const [manifest, assetVersion] = await Promise.all([
    getCharacterManifest(),
    getRemoteAssetVersion(),
  ])
  const entry = manifest[characterId]
  if (!entry)
    throw new Error(`未找到角色 ${characterId} 的资源索引`)

  const npcImages = entry.npc ?? []
  const specialImages = entry.special ?? []
  const npcGroup = await resolveAvailableAssetGroup(npcImages, assetVersion)
  if (!npcGroup)
    throw new Error(`未找到角色 ${characterId} 的远程本体动作资源，请检查 Worker 代理与版本号接口`)

  const specialGroup = await resolveAvailableAssetGroup(specialImages, assetVersion, extractAssetVariant(npcGroup.scriptId))
  const effects = specialGroup ? [createSpecialEffect(specialGroup, assetVersion)] : []

  return {
    assetVersion,
    npcScriptId: npcGroup.scriptId,
    npcImageIds: npcGroup.imageIds,
    effects,
  }
}

async function ensureRuntimeReady() {
  setupGlobals()
  runtimeReadyPromise ??= loadScript(`${localRuntimeBase}/createjs.js`)
  await runtimeReadyPromise

  const w = window as typeof window & {
    createjs?: {
      Config?: {
        setPixelRatio?: (value: number) => void
      }
    }
  }
  w.createjs?.Config?.setPixelRatio?.(renderPixelRatio)
}

const scriptCache = new Map<string, Promise<void>>()
function loadScript(src: string) {
  if (scriptCache.has(src))
    return scriptCache.get(src)!
  const promise = new Promise<void>((resolve, reject) => {
    const exists = document.querySelector<HTMLScriptElement>(`script[data-cjs="${src}"]`)
    if (exists) {
      resolve()
      return
    }
    const el = document.createElement('script')
    const timer = window.setTimeout(() => {
      el.onload = null
      el.onerror = null
      el.remove()
      reject(new Error(`脚本加载超时: ${src}`))
    }, assetLoadTimeoutMs)
    el.src = src
    el.async = false
    el.dataset.cjs = src
    el.onload = () => {
      window.clearTimeout(timer)
      resolve()
    }
    el.onerror = () => {
      window.clearTimeout(timer)
      el.remove()
      reject(new Error(`脚本加载失败: ${src}`))
    }
    document.head.appendChild(el)
  })
    .catch((error) => {
      scriptCache.delete(src)
      throw error
    })
  scriptCache.set(src, promise)
  return promise
}

function buildStage() {
  const canvas = canvasRef.value
  const w = window as any
  const createjs = w.createjs
  const npcScriptId = currentNpcScriptId.value
  if (!canvas || !createjs)
    return
  if (!npcScriptId)
    throw new Error('未解析到角色本体资源')

  const dpr = renderPixelRatio
  console.log({ dpr })

  // 强制走 2d 渲染器，避免 GBF createjs 的 WebGL 分支在普通页面里无法正确初始化
  canvas.setAttribute('cjs-context', '2d')
  canvas.setAttribute('cjs-noclip', '')
  canvas.width = stageWidth * dpr
  canvas.height = stageHeight * dpr

  const newStage = new createjs.Stage(canvas)
  // 用 stage scale 抵消 canvas 的高 DPR 分辨率，CSS 尺寸保持 stageWidth/Height
  newStage.scaleX = dpr
  newStage.scaleY = dpr

  const Ctor = w.lib?.[npcScriptId]
  if (!Ctor)
    throw new Error('未找到角色构造函数')

  const npc = new Ctor()
  npc.scaleX = characterScale
  npc.scaleY = characterScale
  npc.x = stageWidth * characterAnchor.x
  npc.y = stageHeight * characterAnchor.y
  newStage.addChild(npc)
  characterClip.value = npc

  // 顶层 npc 是一个 1 帧的 MovieClip，里面 npc_xxx 才是真正带动作 label 的容器
  const inner = npc[npcScriptId] ?? npc
  motionRoot.value = inner

  stage.value = newStage
  newStage.update()

  // GBF createjs 暴露的是 setFPS(fps, force)，没有 framerate setter；第二个参数 true 绕过 15fps 限制
  createjs.Ticker.setFPS?.(30, true)
  createjs.Ticker.addEventListener('tick', newStage)
  playMotion(currentMotion.value)
}

function disposeStage() {
  const w = window as any
  const createjs = w.createjs
  clearMotionSequence()
  stopActiveEffect()
  if (stage.value && createjs) {
    createjs.Ticker.removeEventListener('tick', stage.value)
    stage.value.removeAllChildren()
  }
  stage.value = null
  motionRoot.value = null
  characterClip.value = null
}

function stopActiveEffect() {
  const w = window as any
  const createjs = w.createjs
  const clip = activeEffectClip.value
  const handler = activeEffectTickHandler.value
  if (createjs?.Ticker && handler)
    createjs.Ticker.removeEventListener('tick', handler)

  if (clip)
    stage.value?.removeChild(clip)

  const npc = characterClip.value
  if (npc)
    npc.visible = true

  activeEffect.value = null
  activeEffectClip.value = null
  activeEffectPlaybackClip.value = null
  activeEffectTickHandler.value = null
}

function getMotionClip(key: MotionKey) {
  const target = motionRoot.value
  const npcScriptId = currentNpcScriptId.value
  if (!target)
    return null

  return target[`${npcScriptId}_${key}`] ?? null
}

function clearMotionSequence() {
  const w = window as any
  const createjs = w.createjs
  const handler = motionSequenceHandler.value
  if (createjs?.Ticker && handler)
    createjs.Ticker.removeEventListener('tick', handler)

  queuedMotions.value = []
  motionSequenceReturn.value = null
  motionSequenceHandler.value = null
  activeMotionClip.value = null
}

function startMotion(key: MotionKey) {
  currentMotion.value = key
  const target = motionRoot.value
  activeMotionClip.value = getMotionClip(key)
  activeMotionClip.value?.gotoAndPlay?.(0)
  if (target?.gotoAndPlay)
    target.gotoAndPlay(key)
}

function playMotionSequence(sequence: MotionKey[], options?: { repeat?: boolean, returnMotion?: MotionKey }) {
  const target = motionRoot.value
  const w = window as any
  const createjs = w.createjs
  if (!target?.gotoAndPlay || !createjs?.Ticker || sequence.length === 0)
    return

  clearMotionSequence()
  const [firstMotion, ...restMotions] = sequence
  const originalSequence = [...sequence]
  const shouldRepeat = options?.repeat ?? false
  queuedMotions.value = restMotions
  motionSequenceReturn.value = options?.returnMotion ?? null

  const onTick = () => {
    const clip = activeMotionClip.value
    const totalFrames = clip?.totalFrames ?? clip?.timeline?.duration ?? 0
    if (!clip || totalFrames <= 0 || clip.currentFrame < totalFrames - 1)
      return

    const nextMotion = queuedMotions.value.shift()
    if (nextMotion) {
      startMotion(nextMotion)
      return
    }

    motionCycleCount.value += 1

    if (shouldRepeat) {
      queuedMotions.value = originalSequence.slice(1)
      startMotion(firstMotion)
      return
    }

    const nextIdleMotion = motionSequenceReturn.value
    clearMotionSequence()
    if (nextIdleMotion)
      startMotion(nextIdleMotion)
  }

  motionSequenceHandler.value = onTick
  createjs.Ticker.addEventListener('tick', onTick)
  startMotion(firstMotion)
}

function playMotion(key: string) {
  stopActiveEffect()
  motionCycleCount.value = 0
  if (key === 'combo') {
    playMotionSequence(attackComboSequence, { repeat: true })
    return
  }

  playMotionSequence([key as MotionKey], { repeat: true })
}

function isMotionActive(key: string) {
  if (activeEffect.value)
    return false

  return key === 'combo'
    ? attackComboSequence.includes(currentMotion.value)
    : currentMotion.value === key
}

function handleControlClick(item: ControlItem) {
  selectedControlKey.value = item.key
  if (item.type === 'effect') {
    const effect = resolvedEffects.value.find(candidate => candidate.key === item.key)
    if (effect)
      playEffect(effect)
    return
  }

  playMotion(item.key)
}

function isControlActive(item: ControlItem) {
  return item.type === 'effect'
    ? activeEffect.value === item.key
    : isMotionActive(item.key)
}

function playEffect(effect: EffectItem, preserveCycleCount = false) {
  const w = window as any
  const createjs = w.createjs
  const Ctor = w.lib?.[effect.key]
  if (!stage.value || !createjs || !Ctor)
    return

  if (!preserveCycleCount)
    activeEffectCycleCount.value = 0

  clearMotionSequence()
  stopActiveEffect()
  if (effect.motion)
    playMotion(effect.motion)
  activeEffect.value = effect.key

  // 必杀过场自带角色绘制，需隐藏底层 npc 避免重叠
  const npc = characterClip.value
  if (effect.hideCharacter && npc)
    npc.visible = false

  const mc = new Ctor()
  const sc = effectScale
  const anchor = effectAnchor
  mc.scaleX = sc
  mc.scaleY = sc
  mc.x = stageWidth * anchor.x
  mc.y = stageHeight * anchor.y
  // 一次性播放：跑完后自行移除
  mc.loop = false
  if ('framerate' in mc)
    mc.framerate = 30
  stage.value.addChild(mc)
  mc.gotoAndPlay?.(0)
  activeEffectClip.value = mc
  const effectRootClip = mc[effect.key] ?? mc
  activeEffectPlaybackClip.value = effectRootClip[`${effect.key}_special`] ?? effectRootClip

  const onTick = () => {
    const playbackClip = activeEffectPlaybackClip.value
    const total = playbackClip?.totalFrames ?? playbackClip?.timeline?.duration ?? 0
    if (total > 0 && playbackClip.currentFrame >= total - 1) {
      activeEffectCycleCount.value += 1
      playEffect(effect, true)
    }
  }
  activeEffectTickHandler.value = onTick
  createjs.Ticker.addEventListener('tick', onTick)
}

function captureGifFrame(
  context: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  quality: GifExportQualityOption,
) {
  context.clearRect(0, 0, quality.width, quality.height)
  context.drawImage(sourceCanvas, 0, 0, quality.width, quality.height)
  return new Uint8ClampedArray(context.getImageData(0, 0, quality.width, quality.height).data)
}

function findTransparentIndex(palette: number[][]) {
  return palette.findIndex(color => color[3] === 0)
}

function findOpaqueBounds(frame: Uint8ClampedArray, width: number, height: number) {
  let left = width
  let top = height
  let right = -1
  let bottom = -1

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x += 1) {
      if (frame[rowOffset + (x * 4) + 3] === 0)
        continue

      if (x < left)
        left = x
      if (y < top)
        top = y
      if (x > right)
        right = x
      if (y > bottom)
        bottom = y
    }
  }

  if (right < 0 || bottom < 0)
    return null

  return { left, top, right, bottom }
}

function trimGifFrames(frames: Uint8ClampedArray[], width: number, height: number, padding = 1): GifFrameSet {
  let bounds: PixelBounds | null = null

  for (const frame of frames) {
    const currentBounds = findOpaqueBounds(frame, width, height)
    if (!currentBounds)
      continue

    if (!bounds) {
      bounds = currentBounds
      continue
    }

    bounds.left = Math.min(bounds.left, currentBounds.left)
    bounds.top = Math.min(bounds.top, currentBounds.top)
    bounds.right = Math.max(bounds.right, currentBounds.right)
    bounds.bottom = Math.max(bounds.bottom, currentBounds.bottom)
  }

  if (!bounds) {
    return {
      frames,
      width,
      height,
    }
  }

  const left = Math.max(0, bounds.left - padding)
  const top = Math.max(0, bounds.top - padding)
  const right = Math.min(width - 1, bounds.right + padding)
  const bottom = Math.min(height - 1, bounds.bottom + padding)
  const trimmedWidth = Math.max(1, right - left + 1)
  const trimmedHeight = Math.max(1, bottom - top + 1)

  if (trimmedWidth === width && trimmedHeight === height && left === 0 && top === 0) {
    return {
      frames,
      width,
      height,
    }
  }

  const trimmedFrames = frames.map((frame) => {
    const nextFrame = new Uint8ClampedArray(trimmedWidth * trimmedHeight * 4)

    for (let y = 0; y < trimmedHeight; y += 1) {
      const sourceStart = ((top + y) * width + left) * 4
      const sourceEnd = sourceStart + (trimmedWidth * 4)
      nextFrame.set(frame.subarray(sourceStart, sourceEnd), y * trimmedWidth * 4)
    }

    return nextFrame
  })

  return {
    frames: trimmedFrames,
    width: trimmedWidth,
    height: trimmedHeight,
  }
}

function sanitizeGifName(name: string) {
  return name
    .replace(/[<>:"/\\|?*]+/g, '_')
    .split('')
    .map(char => char.charCodeAt(0) < 32 ? '_' : char)
    .join('')
    .replace(/[. ]+$/g, '')
    .trim()
}

async function recordGifFrames(item: ControlItem, sourceCanvas: HTMLCanvasElement, quality: GifExportQualityOption) {
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = quality.width
  exportCanvas.height = quality.height

  const exportContext = exportCanvas.getContext('2d', { willReadFrequently: true })
  if (!exportContext)
    throw new Error('无法创建 GIF 导出画布')

  const context = exportContext

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  const w = window as any
  const createjs = w.createjs
  if (!createjs?.Ticker)
    throw new Error('CreateJS Ticker 不可用，无法导出 GIF')

  return await new Promise<Uint8ClampedArray[]>((resolve, reject) => {
    const frames: Uint8ClampedArray[] = []
    let tickCount = 0
    let hasStarted = false
    let initialMotionCycles = 0
    let initialEffectCycles = 0

    function finish() {
      createjs.Ticker.removeEventListener('tick', onTick)
      if (!frames.length)
        frames.push(captureGifFrame(context, sourceCanvas, quality))
      resolve(frames)
    }

    function fail(error: unknown) {
      createjs.Ticker.removeEventListener('tick', onTick)
      reject(error)
    }

    function onTick() {
      tickCount += 1
      if (frames.length === 0 || tickCount % quality.tickStep === 0)
        frames.push(captureGifFrame(context, sourceCanvas, quality))

      if (item.type === 'effect') {
        if (activeEffect.value === item.key)
          hasStarted = true
        if (hasStarted && activeEffectCycleCount.value > initialEffectCycles) {
          finish()
          return
        }
        if (hasStarted && activeEffect.value !== item.key) {
          finish()
          return
        }
      }
      else {
        if (item.key === 'combo') {
          if (attackComboSequence.includes(currentMotion.value))
            hasStarted = true
        }
        else if (currentMotion.value === item.key) {
          hasStarted = true
        }

        if (hasStarted && motionCycleCount.value > initialMotionCycles) {
          finish()
          return
        }
      }

      if (tickCount >= quality.maxTicks)
        finish()
    }

    createjs.Ticker.addEventListener('tick', onTick)

    try {
      if (item.type === 'effect') {
        const effect = resolvedEffects.value.find(candidate => candidate.key === item.key)
        if (!effect)
          throw new Error('未找到要导出的特效配置')
        playEffect(effect)
        initialEffectCycles = activeEffectCycleCount.value
      }
      else {
        playMotion(item.key)
        initialMotionCycles = motionCycleCount.value
      }
    }
    catch (error) {
      fail(error)
    }
  })
}

function downloadGif(bytes: Uint8Array, fileName: string) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const blob = new Blob([buffer], { type: 'image/gif' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

async function loadCharacter(characterId: string) {
  const nextCharacterId = characterId.trim()
  const loadToken = ++activeLoadToken

  status.value = 'loading'
  errorMessage.value = ''
  exportErrorMessage.value = ''
  selectedControlKey.value = 'wait'
  currentMotion.value = 'wait'
  motionCycleCount.value = 0
  activeEffectCycleCount.value = 0
  resolvedEffects.value = []
  currentNpcScriptId.value = ''
  disposeStage()

  try {
    if (!nextCharacterId)
      throw new Error('请输入角色 ID')

    await ensureRuntimeReady()
    const assets = await resolveCharacterAssets(nextCharacterId)
    if (loadToken !== activeLoadToken)
      return

    const w = window as any
    w.Game.version = Number(assets.assetVersion) || assets.assetVersion
    await Promise.all([
      ...assets.npcImageIds.map(id =>
        loadImage(getRemoteImageUrl(id)).then((img) => {
          w.images[id] = img
        }),
      ),
      loadScript(getRemoteScriptUrl(assets.npcScriptId, assets.assetVersion)),
    ])
    if (loadToken !== activeLoadToken)
      return

    currentNpcScriptId.value = assets.npcScriptId
    resolvedEffects.value = []
    buildStage()
    status.value = 'ready'

    void preloadEffects(assets.effects, loadToken)
  }
  catch (e) {
    if (loadToken !== activeLoadToken)
      return

    status.value = 'error'
    errorMessage.value = e instanceof Error ? e.message : String(e)
  }
}

async function preloadEffects(effects: EffectItem[], loadToken: number) {
  if (!effects.length)
    return

  const w = window as any
  const loadedEffects: EffectItem[] = []

  for (const effect of effects) {
    try {
      await Promise.all([
        ...effect.images.map(id =>
          loadImage(getRemoteImageUrl(id)).then((img) => {
            w.images[id] = img
          }),
        ),
        loadScript(getRemoteScriptUrl(effect.scriptId, effect.assetVersion)),
      ])
      loadedEffects.push(effect)
    }
    catch {
      // 特效资源缺失时降级为仅保留角色本体动作。
    }
  }

  if (loadToken !== activeLoadToken)
    return

  resolvedEffects.value = loadedEffects
}

async function exportSelectedGif() {
  if (isExportingGif.value)
    return

  const item = selectedControl.value
  const sourceCanvas = canvasRef.value
  if (!item || !sourceCanvas)
    return

  isExportingGif.value = true
  exportErrorMessage.value = ''

  try {
    const quality = selectedGifQuality.value
    const gifExportDelay = Math.round(1000 / (30 / quality.tickStep))
    const frames = await recordGifFrames(item, sourceCanvas, quality)
    const trimmedFrameSet = trimGifFrames(frames, quality.width, quality.height)
    const rgba = new Uint8Array(trimmedFrameSet.frames.length * trimmedFrameSet.frames[0].length)
    let offset = 0
    for (const frame of trimmedFrameSet.frames) {
      rgba.set(frame, offset)
      offset += frame.length
    }

    const palette = quantize(rgba, quality.maxColors, {
      format: 'rgba4444',
      oneBitAlpha: true,
      clearAlpha: false,
    })
    const transparentIndex = findTransparentIndex(palette)

    const gif = GIFEncoder()
    trimmedFrameSet.frames.forEach((frame, index) => {
      const bitmap = applyPalette(frame, palette, 'rgba4444')
      gif.writeFrame(bitmap, trimmedFrameSet.width, trimmedFrameSet.height, {
        palette: index === 0 ? palette : undefined,
        delay: gifExportDelay,
        repeat: 0,
        transparent: transparentIndex >= 0,
        transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
        // 透明背景动画必须在下一帧前清掉上一帧，否则移动角色会留下残影。
        dispose: 2,
      })
    })
    gif.finish()

    const gifPrefix = normalizedCharacterId.value || currentNpcScriptId.value || 'character'
    const gifActionName = item.label || item.key
    downloadGif(gif.bytes(), `${sanitizeGifName(gifPrefix)}_${sanitizeGifName(gifActionName)}.gif`)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    exportErrorMessage.value = `GIF 导出失败：${message}`
  }
  finally {
    isExportingGif.value = false
  }
}

onMounted(() => {
  void loadCharacter(normalizedCharacterId.value)
})

watch(normalizedCharacterId, (nextCharacterId, previousCharacterId) => {
  if (!canvasRef.value || nextCharacterId === previousCharacterId)
    return

  void loadCharacter(nextCharacterId)
})

onBeforeUnmount(() => {
  activeLoadToken += 1
  disposeStage()
})
</script>

<template>
  <div class="mx-auto max-w-[980px] w-full px-5 sm:px-8">
    <section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div class="apple-stage-shell">
        <div class="relative mx-auto max-w-[600px] w-full" :style="{ aspectRatio: `${stageWidth} / ${stageHeight}` }">
          <canvas
            ref="canvasRef"
            class="relative z-[1] block h-full w-full drop-shadow-[0_18px_48px_rgba(0,0,0,0.48)]"
          />
          <div v-if="status !== 'ready'" class="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-3 rounded-[20px] bg-[rgba(0,0,0,0.72)] px-5 text-center text-[14px] text-white leading-[1.43] tracking-[-0.224px]">
            <template v-if="status === 'loading'">
              <span class="h-8 w-8 animate-spin border-2 border-white/20 border-t-white rounded-full border-solid" />
              <span>资源加载中…</span>
            </template>
            <template v-else>
              <span class="h-9 w-9 fc rounded-full bg-white/10 text-[17px] text-white font-600">!</span>
              <span class="max-w-[240px] text-white/72">{{ errorMessage }}</span>
            </template>
          </div>
        </div>
      </div>

      <div class="apple-panel">
        <div class="flex flex-col gap-4">
          <div>
            <div flex items-center justify-between>
              <p class="m-0 mt-2 apple-body-compact text-ink">
                动作预览
              </p>
              <span class="apple-dark-chip-status">
                <i
                  class="h-2 w-2 rounded-full"
                  :class="status === 'ready'
                    ? 'bg-[#30d158]'
                    : status === 'loading'
                      ? 'animate-pulse bg-[#ffd60a]'
                      : 'bg-[#ff453a]'"
                />
                {{ status === 'ready' ? '就绪' : status === 'loading' ? '加载中' : '失败' }}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <button
              v-for="item in controlItems"
              :key="item.key"
              type="button"
              class="apple-filter-button"
              :class="[
                isControlActive(item) ? '!bg-accent !text-white hover:!bg-[#0077ed]' : '',
                item.type === 'effect' ? 'col-span-2 sm:col-span-3' : '',
              ]"
              :disabled="!isReady || isExportingGif"
              @click="handleControlClick(item)"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <div class="my-6 h-px bg-line/70" />

        <div class="flex flex-col gap-4">
          <p class="m-0 mt-2 apple-body-compact text-ink">
            导出选项
          </p>

          <div>
            <div class="mt-2 flex items-center justify-between gap-3 text-[12px] text-muted leading-[1.33] tracking-[-0.12px]">
              <span class="text-ink font-600">{{ selectedGifQuality.label }}</span>
              <span>{{ selectedGifQuality.width }}×{{ selectedGifQuality.height }} · {{ selectedGifQuality.maxColors }} 色</span>
            </div>
            <input
              v-model.number="selectedGifQualityIndex"
              type="range"
              min="0"
              :max="gifExportQualityOptions.length - 1"
              step="1"
              class="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-surfacesoft accent-accent disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="isExportingGif"
            >
            <div class="mt-2 flex justify-between gap-2 text-[11px] text-muted leading-[1.33] tracking-[-0.12px]">
              <button
                v-for="(quality, index) in gifExportQualityOptions"
                :key="quality.key"
                type="button"
                class="rounded-[10px] py-1 text-center"
                :class="selectedGifQualityKey === quality.key ? 'text-accent font-600' : ''"
                :disabled="isExportingGif"
                @click="selectedGifQualityIndex = index"
              >
                {{ quality.label }}
              </button>
            </div>
          </div>

          <button
            type="button"
            :class="exportButtonClass"
            :disabled="!isReady || isExportingGif || !selectedControl"
            @click="exportSelectedGif()"
          >
            {{ exportButtonLabel }}
          </button>
        </div>

        <p v-if="exportErrorMessage" class="m-0 mt-4 text-[12px] text-[#d70015] leading-[1.33] tracking-[-0.12px]">
          {{ exportErrorMessage }}
        </p>
      </div>
    </section>
  </div>
</template>
