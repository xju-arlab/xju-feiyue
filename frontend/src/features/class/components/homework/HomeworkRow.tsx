import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Upload, X } from 'lucide-react'
import type { Homework } from '@/api/schemas/homework'
import { CourseTag, SubmissionTag } from './HomeworkBadges'
import {
  formatFileSize,
  formatHomeworkTime,
  HOMEWORK_EXTENSIONS,
  homeworkTitle,
  isFileDrag,
  validateHomeworkBatch,
} from './helpers'

export type PendingHomework = {
  file: File | null
  files?: File[]
  error: string | null
  valid: boolean
  uploading: boolean
  progress: string
}
type Props = {
  homework: Homework
  pending: PendingHomework | undefined
  pageFileDragging: boolean
  onFiles: (id: string, files: FileList) => void
  onSubmit: (id: string) => void
  onDiscard: (id: string) => void
  onRemove: (id: string, files: File[]) => void
}
export function HomeworkRow({
  homework: h,
  pending,
  pageFileDragging,
  onFiles,
  onSubmit,
  onDiscard,
  onRemove,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const uploadButton = useRef<HTMLButtonElement>(null)
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const activeDrag = dragging && pageFileDragging
  const title = homeworkTitle(h)
  const busy = Boolean(pending?.uploading)
  const batch = Boolean(h.requiredQuestions?.length)
  const check = pending?.files ? validateHomeworkBatch(pending.files, h) : null
  const example = `${h.batchPrefixes?.[0] ?? ''}${h.requiredQuestions?.[0] ?? ''}.zip`
  const choose = () => {
    if (!busy) input.current?.click()
  }
  return (
    <article
      className={`hw-item${activeDrag ? ' hw-dragover' : ''}`}
      aria-label={`${h.course} ${title}`}
      aria-busy={busy}
      onClick={(e) => {
        if (
          !(e.target as Element).closest('button,input,a,.hw-file-feedback') &&
          !window.getSelection()?.toString()
        )
          choose()
      }}
      onDragEnter={(e) => {
        if (!isFileDrag(e.dataTransfer)) return
        e.preventDefault()
        depth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = busy ? 'none' : 'copy'
        setDragging(true)
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setDragging(false)
      }}
      onDrop={(e) => {
        if (!isFileDrag(e.dataTransfer)) return
        e.preventDefault()
        depth.current = 0
        setDragging(false)
        if (!busy && e.dataTransfer.files.length) onFiles(h.id, e.dataTransfer.files)
      }}
    >
      <div className="hw-line">
        <div className="hw-course-cell">
          <CourseTag course={h.course} />
        </div>
        <h3 className="hw-name">{title}</h3>
        <time className="hw-time" dateTime={h.dueAt} title="北京时间">
          {formatHomeworkTime(h.dueAt)}
        </time>
        <div className="hw-state">
          <SubmissionTag submitted={Boolean(h.submission)} />
        </div>
        <button
          ref={uploadButton}
          type="button"
          className="hw-upload"
          disabled={busy}
          onClick={choose}
          aria-label={`${h.submission ? '重新上传' : '上传'}${h.course} ${title}`}
          aria-describedby={`hw-rule-${h.id}`}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Upload size={14} aria-hidden />
          )}
          {activeDrag && !busy
            ? '松开即可上传'
            : busy
              ? '上传中'
              : h.submission
                ? '重新上传'
                : batch
                  ? '批量上传'
                  : '上传'}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={batch ? '.zip' : HOMEWORK_EXTENSIONS}
        multiple={batch}
        aria-label={`${h.course} ${title}文件`}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(h.id, e.target.files)
          e.target.value = ''
        }}
      />
      <span className="sr-only" id={`hw-rule-${h.id}`}>
        {batch
          ? `每题一个 ZIP：${h.requiredQuestions?.join('、')}。示例：${example}`
          : `可点击上传按钮或拖入此行。文件名：${h.expectedFilename}，保留扩展名，最大 20 MB。`}
      </span>
      {batch && !pending && (
        <div className="hw-batch-summary">
          {h.submission?.files ? (
            <>
              <span>已交 {h.submission.files.length} 个压缩包</span>
              {h.submission.files.some((file) => file.warnings.length > 0) && (
                <span>含 .gradle 缓存，建议下次打包前删除</span>
              )}
            </>
          ) : (
            <span title={example}>每题一个 ZIP · {h.requiredQuestions?.join('、')}</span>
          )}
        </div>
      )}
      {pending && check ? (
        <div className="hw-file-feedback hw-batch" aria-live="polite">
          <div className="hw-batch-summary">
            <span>每题一个 ZIP · {h.requiredQuestions?.join('、')}</span>
            <span className="hw-batch-example">示例：{example}</span>
          </div>
          <ul className="hw-batch-parts">
            {check.parts.map(({ file, question, error }, i) => (
              <li key={i}>
                <span>
                  <strong>{file.name}</strong>
                  <small className={error ? 'hw-error' : 'hw-muted'}>
                    {error ?? `${question} · ${formatFileSize(file.size)}`}
                  </small>
                </span>
                <button
                  type="button"
                  className="hw-button hw-ghost"
                  disabled={busy}
                  aria-label={`移除 ${file.name}`}
                  onClick={() =>
                    onRemove(
                      h.id,
                      check.parts.filter((_, index) => index !== i).map((part) => part.file),
                    )
                  }
                >
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {check.missing.length > 0 && <p className="hw-error">缺少：{check.missing.join('、')}</p>}
          {check.tooLarge && <p className="hw-error">整批文件不能超过 45 MB</p>}
          {pending.error && (
            <p className="hw-error hw-batch-error" role="alert">
              {pending.error}
            </p>
          )}
          {busy && <p className="hw-muted">{pending.progress}</p>}
          <div className="hw-file-actions">
            <button
              className="hw-button hw-ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                onDiscard(h.id)
                uploadButton.current?.focus()
              }}
            >
              取消
            </button>
            <button
              className="hw-button hw-primary"
              type="button"
              disabled={busy || !pending.valid}
              onClick={() => onSubmit(h.id)}
            >
              {busy ? '提交中…' : `提交 ${check.parts.length} 个压缩包`}
            </button>
          </div>
        </div>
      ) : (
        pending && (
          <div className="hw-file-feedback" aria-live="polite">
            <div className={`hw-file ${pending.error ? 'hw-file-error' : ''}`}>
              {pending.error ? (
                <AlertCircle size={16} aria-hidden />
              ) : (
                <CheckCircle2 size={16} aria-hidden />
              )}
              <div className="hw-file-info">
                {pending.file && (
                  <div className="hw-file-summary">
                    <span>{pending.file.name}</span>
                    <span className="hw-file-size">{formatFileSize(pending.file.size)}</span>
                  </div>
                )}
                <div className="hw-file-validation">
                  {busy ? pending.progress : (pending.error ?? '命名正确')}
                </div>
                {!pending.valid && (
                  <div className="hw-rule-hint">
                    文件名应为 <span>{h.expectedFilename}</span>，保留扩展名
                  </div>
                )}
              </div>
              <div className="hw-file-actions">
                {pending.valid && (
                  <button
                    className="hw-button hw-primary"
                    disabled={busy}
                    onClick={() => onSubmit(h.id)}
                  >
                    {busy ? '上传中…' : pending.error ? '重试上传' : '确认上传'}
                  </button>
                )}
                <button
                  className="hw-button hw-ghost"
                  disabled={busy}
                  onClick={() => {
                    onDiscard(h.id)
                    uploadButton.current?.focus()
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )
      )}
    </article>
  )
}
