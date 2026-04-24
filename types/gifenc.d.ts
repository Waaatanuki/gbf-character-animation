declare module 'gifenc' {
  export type GifPalette = number[][]

  export interface GifEncoderOptions {
    auto?: boolean
    initialCapacity?: number
  }

  export interface GifFrameOptions {
    palette?: GifPalette
    delay?: number
    repeat?: number
    transparent?: boolean
    transparentIndex?: number
    dispose?: number
  }

  export interface QuantizeOptions {
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
    oneBitAlpha?: boolean | number
    clearAlpha?: boolean
    clearAlphaColor?: number
    clearAlphaThreshold?: number
  }

  export interface GifEncoderInstance {
    finish: () => void
    bytes: () => Uint8Array
    writeFrame: (index: Uint8Array, width: number, height: number, options?: GifFrameOptions) => void
  }

  export function GIFEncoder(options?: GifEncoderOptions): GifEncoderInstance
  export function quantize(data: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): GifPalette
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array
}