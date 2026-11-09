import type { Homework } from '@/api/schemas/homework'

export const MAX_HOMEWORK_BYTES = 20 * 1024 * 1024
export const HOMEWORK_EXTENSIONS =
  '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.zip,.txt,.csv,.md'
export const homeworkTitle = (h: Homework) =>
  `实验 ${h.experimentNo}${h.title ? ` · ${h.title}` : ''}`
export function formatHomeworkTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
export function validateHomeworkFile(file: File, expected: string): string | null {
  if (file.size > MAX_HOMEWORK_BYTES) return '文件超过 20 MB，请压缩后重试'
  const dot = file.name.lastIndexOf('.')
  if (dot <= 0 || dot === file.name.length - 1) return '请保留文件扩展名'
  if (!HOMEWORK_EXTENSIONS.split(',').includes(file.name.slice(dot).toLowerCase()))
    return '暂不支持此文件格式，请转为文档或 ZIP 压缩包'
  if (file.name.slice(0, dot).normalize('NFC') !== expected.normalize('NFC'))
    return '文件名不符合要求'
  return null
}
export function isFileDrag(transfer: DataTransfer | null) {
  return Boolean(
    transfer &&
    (Array.from(transfer.types).includes('Files') ||
      Array.from(transfer.items ?? []).some((item) => item.kind === 'file')),
  )
}
