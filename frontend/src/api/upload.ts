import type { ZodType } from 'zod'

import { ApiError } from './client'

/**
 * XHR-based multipart upload —— 出**真实逐字节上传进度**。
 *
 * 为什么不用 `client.ts` 的 `request`（fetch）：`fetch` 的 request body 没有
 * upload-progress 事件，拿不到字节进度；只有 `XMLHttpRequest.upload.onprogress`
 * 能逐字节回报。其余约定与 `request` 保持一致：
 * - 鉴权 header 逐个 `setRequestHeader`（caller 传 authHeaders()）。
 * - **不手动设 Content-Type**：body 是 FormData，浏览器自动带 multipart boundary，
 *   手动覆盖会破坏 boundary（与 client.ts FormData 注释同义）。
 * - 响应过同一 zod `schema.parse`，边界处强校验。
 * - 非 2xx → reject 一个 `ApiError`（同形态/同类，读 `{ detail }` 当 message），
 *   使上层 `e instanceof ApiError`、`e.message`、`e.status` 行为与 fetch 路径不变。
 * - `signal` 取消：abort → reject 一个 name='AbortError' 的错误（与 fetch abort 同名）。
 *
 * 进度阶段（`phase`）：
 * - `'uploading'`：upload.onprogress 报字节比（`ratio = loaded/total`）。
 * - `'processing'`：upload 'load'（字节已全部发完）→ 等服务端响应。CF/nginx 会缓冲
 *   响应尾部产生延迟，故区分「已发完」与「服务端确认」两个语义。
 * - `'done'`：xhr 'load' 拿到 2xx 响应并校验通过。
 */

export type UploadProgress = {
  loaded: number
  total: number
  /** 0..1；total 不可计算（lengthComputable=false）时为 null（不确定进度）。 */
  ratio: number | null
  phase: 'uploading' | 'processing' | 'done'
}

type XhrUploadOpts<T> = {
  method?: 'POST' | 'PUT'
  url: string
  form: FormData
  /** 鉴权等 header；**不要**包含 Content-Type（FormData 自动带 boundary）。 */
  headers?: Record<string, string> | undefined
  schema: ZodType<T>
  onProgress?: ((p: UploadProgress) => void) | undefined
  signal?: AbortSignal | undefined
}

/** 仿 fetch 的 AbortError（DOMException 在所有环境不一定可 new，故用 Error 兜底）。 */
function makeAbortError(): Error {
  try {
    return new DOMException('The user aborted a request.', 'AbortError')
  } catch {
    const e = new Error('The user aborted a request.')
    e.name = 'AbortError'
    return e
  }
}

export function xhrUpload<T>(opts: XhrUploadOpts<T>): Promise<T> {
  const { url, form, headers, schema, onProgress, signal } = opts

  return new Promise<T>((resolve, reject) => {
    // 已经 abort 了就别发了。
    if (signal?.aborted) {
      reject(makeAbortError())
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open(opts.method ?? 'POST', url)

    // 逐个加 header（鉴权）。绝不设 Content-Type：FormData 自动带 boundary。
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'content-type') continue
        xhr.setRequestHeader(k, v)
      }
    }

    // abort 接线：signal → xhr.abort()。
    const onAbort = () => xhr.abort()
    if (signal) signal.addEventListener('abort', onAbort)
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    // 上传字节进度（uploading 阶段）。
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress?.({
          loaded: e.loaded,
          total: e.total,
          ratio: e.total > 0 ? e.loaded / e.total : null,
          phase: 'uploading',
        })
      }
    })

    // 上传 body 已全部发完 → 进入「等待服务端确认」(processing)。
    xhr.upload.addEventListener('load', () => {
      onProgress?.({
        loaded: 1,
        total: 1,
        ratio: 1,
        phase: 'processing',
      })
    })

    // 拿到响应。
    xhr.addEventListener('load', () => {
      cleanup()
      const status = xhr.status
      const text = xhr.responseText
      if (status >= 200 && status < 300) {
        let raw: unknown
        try {
          raw = text ? (JSON.parse(text) as unknown) : null
        } catch {
          reject(new ApiError(`Invalid JSON response (HTTP ${status})`, status, url))
          return
        }
        try {
          const parsed = schema.parse(raw)
          onProgress?.({ loaded: 1, total: 1, ratio: 1, phase: 'done' })
          resolve(parsed)
        } catch (err) {
          reject(err)
        }
        return
      }
      // 非 2xx：还原 client.ts 的 ApiError —— 读 { detail } 当 message。
      let message = `HTTP ${status}`
      try {
        const body = JSON.parse(text) as { detail?: unknown } | null
        if (body && typeof body.detail === 'string' && body.detail.length > 0) {
          message = body.detail
        }
      } catch {
        /* keep HTTP fallback */
      }
      reject(new ApiError(message, status, url))
    })

    // 网络错误 / 超时。
    xhr.addEventListener('error', () => {
      cleanup()
      reject(new ApiError('Network error', 0, url))
    })
    xhr.addEventListener('timeout', () => {
      cleanup()
      reject(new ApiError('Request timed out', 0, url))
    })
    // 用户/ signal 取消 → AbortError（与 fetch 同名，上层判断不变）。
    xhr.addEventListener('abort', () => {
      cleanup()
      reject(makeAbortError())
    })

    xhr.send(form)
  })
}
