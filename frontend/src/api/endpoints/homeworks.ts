import { ApiError, getApiBase, isMockMode, request } from '../client'
import { xhrUpload, type UploadProgress } from '../upload'
import { classAuthHeaders, triggerBlobDownload } from './classes'
import {
  HomeworkListSchema,
  HomeworkSchema,
  HomeworkSubmissionSchema,
  HomeworkRecordsSchema,
  type HomeworkCreateIn,
} from '../schemas/homework'

const base = '/classes/me/homeworks'
export const listHomeworks = () =>
  request({ method: 'GET', path: base, schema: HomeworkListSchema, headers: classAuthHeaders() })
export const createHomework = (body: HomeworkCreateIn) =>
  request({ method: 'POST', path: base, schema: HomeworkSchema, headers: classAuthHeaders(), body })
export const getHomeworkRecords = (id: string) =>
  request({
    method: 'GET',
    path: `${base}/${id}/submissions`,
    schema: HomeworkRecordsSchema,
    headers: classAuthHeaders(),
  })
export function uploadHomework(
  id: string,
  file: File,
  onProgress: (p: UploadProgress) => void,
  signal: AbortSignal,
) {
  const form = new FormData()
  form.append('file', file)
  const path = `${base}/${id}/submission`
  if (isMockMode())
    return request({
      method: 'PUT',
      path,
      schema: HomeworkSubmissionSchema,
      headers: classAuthHeaders(),
      body: form,
    })
  return xhrUpload({
    method: 'PUT',
    url: `${getApiBase()}${path}`,
    form,
    schema: HomeworkSubmissionSchema,
    headers: classAuthHeaders(),
    onProgress,
    signal,
  })
}
export async function downloadHomework(id: string, filename: string, sid?: string) {
  const path = sid
    ? `${base}/${id}/submissions/${encodeURIComponent(sid)}/download`
    : `${base}/${id}/export`
  if (isMockMode()) {
    // Keep mock mode explicit; never return a fake ZIP or pretend to download real work.
    throw new Error('演示环境没有真实文件，请连接后端后下载')
  }
  const res = await fetch(`${getApiBase()}${path}`, { headers: classAuthHeaders() })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null
    throw new ApiError(
      typeof body?.detail === 'string' ? body.detail : '下载失败，请重试',
      res.status,
      path,
    )
  }
  triggerBlobDownload(await res.blob(), filename)
}
