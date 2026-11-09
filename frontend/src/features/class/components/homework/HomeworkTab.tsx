import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Loader2, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { uploadHomework } from '@/api/endpoints/homeworks'
import { useAuthStore } from '@/stores/authStore'
import { useHomeworks, homeworkKeys } from '../../hooks/useHomeworks'
import { errMsg } from '../../hooks/keys'
import { CourseTag } from './HomeworkBadges'
import { HomeworkRow, type PendingHomework } from './HomeworkRow'
import { NewHomeworkDialog } from './NewHomeworkDialog'
import { HomeworkRecords } from './HomeworkRecords'
import { formatHomeworkTime, homeworkTitle, isFileDrag, validateHomeworkFile } from './helpers'
import './homework.css'

type Filter = 'all' | 'pending' | 'done'
export function HomeworkTab({ className }: { className: string }) {
  const { data, isPending, isError, refetch } = useHomeworks()
  const qc = useQueryClient()
  const sid = useAuthStore((s) => s.user?.sid)
  const [view, setView] = useState<'manage' | 'mine'>('manage')
  const [filter, setFilter] = useState<Filter>('all')
  const [course, setCourse] = useState('all')
  const [creating, setCreating] = useState(false)
  const [recordId, setRecordId] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, PendingHomework>>({})
  const controllers = useRef(new Map<string, AbortController>())
  const [fileDragging, setFileDragging] = useState(false)
  const managing = Boolean(data?.canManage && view === 'manage')
  useEffect(() => {
    const uploads = controllers.current
    return () => {
      for (const controller of uploads.values()) controller.abort()
      uploads.clear()
    }
  }, [sid])
  useEffect(() => {
    let depth = 0
    const clear = () => {
      depth = 0
      setFileDragging(false)
    }
    const enter = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return
      depth++
      if (!managing) setFileDragging(true)
    }
    const over = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return
      e.preventDefault()
      if (!managing) setFileDragging(true)
      if (e.dataTransfer && !(e.target instanceof Element && e.target.closest('.hw-item')))
        e.dataTransfer.dropEffect = 'none'
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) clear()
    }
    const drop = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer)) return
      e.preventDefault()
      clear()
      if (!(e.target instanceof Element && e.target.closest('.hw-item')))
        toast.info(managing ? '切换至我的作业后上传文件' : '请将文件拖到对应作业行')
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear()
    }
    document.addEventListener('dragenter', enter)
    document.addEventListener('dragover', over)
    document.addEventListener('dragleave', leave)
    document.addEventListener('drop', drop)
    document.addEventListener('dragend', clear)
    document.addEventListener('keydown', key)
    window.addEventListener('blur', clear)
    return () => {
      document.removeEventListener('dragenter', enter)
      document.removeEventListener('dragover', over)
      document.removeEventListener('dragleave', leave)
      document.removeEventListener('drop', drop)
      document.removeEventListener('dragend', clear)
      document.removeEventListener('keydown', key)
      window.removeEventListener('blur', clear)
    }
  }, [managing])
  function choose(id: string, files: FileList) {
    if (controllers.current.has(id)) return
    const task = data?.items.find((t) => t.id === id)
    if (!task) return
    const file = files.length === 1 ? files[0]! : null
    const error = file
      ? validateHomeworkFile(file, task.expectedFilename)
      : '每项作业只提交一个文件，多份内容请先打包'
    setPending((prev) => ({
      ...prev,
      [id]: { file, valid: !error, error, uploading: false, progress: '' },
    }))
  }
  function discard(id: string) {
    setPending((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }
  async function submit(id: string) {
    const candidate = pending[id]
    if (!candidate?.file || !candidate.valid || controllers.current.has(id)) return
    const controller = new AbortController()
    controllers.current.set(id, controller)
    setPending((prev) => ({
      ...prev,
      [id]: { ...candidate, uploading: true, error: null, progress: '正在上传…' },
    }))
    try {
      await uploadHomework(
        id,
        candidate.file,
        (progress) => {
          if (controller.signal.aborted) return
          const text =
            progress.phase === 'processing'
              ? '文件已发送，正在保存…'
              : progress.ratio === null
                ? '正在上传…'
                : `正在上传 ${Math.round(progress.ratio * 100)}%`
          setPending((prev) =>
            prev[id] ? { ...prev, [id]: { ...prev[id], progress: text } } : prev,
          )
        },
        controller.signal,
      )
      if (controller.signal.aborted) return
      discard(id)
      await qc.invalidateQueries({ queryKey: homeworkKeys.all })
      toast.success('作业已提交')
    } catch (e) {
      if (!controller.signal.aborted)
        setPending((prev) => ({
          ...prev,
          [id]: { ...candidate, error: errMsg(e, '上传失败，请重试'), uploading: false },
        }))
    } finally {
      controllers.current.delete(id)
    }
  }
  if (isPending)
    return (
      <div className="hw-empty">
        <Loader2 size={18} className="animate-spin" />
        加载作业…
      </div>
    )
  if (isError || !data)
    return (
      <div className="hw-empty">
        <p>作业加载失败</p>
        <button className="hw-button" onClick={() => void refetch()}>
          重试
        </button>
      </div>
    )
  const courses = [...new Set(data.items.map((h) => h.course))]
  const items = data.items.filter(
    (h) =>
      (course === 'all' || h.course === course) &&
      (filter === 'all' ||
        (managing ? h.submittedCount === h.totalCount : Boolean(h.submission)) ===
          (filter === 'done')),
  )
  return (
    <section
      className={`hw-workspace${fileDragging && !managing ? ' hw-file-dragging' : ''}`}
      aria-label={managing ? '作业收发台' : '作业收件箱'}
    >
      {data.canManage && (
        <div className="hw-view-switch" aria-label="作业视图">
          <button
            aria-pressed={managing}
            onClick={() => {
              setView('manage')
              setFilter('all')
            }}
          >
            收发台
          </button>
          <button
            aria-pressed={!managing}
            onClick={() => {
              setView('mine')
              setFilter('all')
            }}
          >
            我的作业
          </button>
        </div>
      )}
      <div className="hw-toolbar">
        <div className="hw-filters">
          {(['all', 'pending', 'done'] as const).map((value) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {value === 'all'
                ? '全部'
                : value === 'pending'
                  ? managing
                    ? '未收齐'
                    : '未提交'
                  : managing
                    ? '已收齐'
                    : '已提交'}
            </button>
          ))}
        </div>
        <div className="hw-toolbar-actions">
          <select aria-label="筛选课程" value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="all">全部课程</option>
            {courses.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {managing && (
            <button className="hw-button hw-primary" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden />
              发布作业
            </button>
          )}
        </div>
      </div>
      {fileDragging && !managing && (
        <div className="hw-drag-message" role="status">
          <Upload size={15} aria-hidden />
          将文件拖到对应的作业行
        </div>
      )}
      {managing ? (
        <div className="hw-table-scroll">
          <table className="hw-management">
            <thead>
              <tr>
                <th>课程</th>
                <th>实验</th>
                <th>截止时间</th>
                <th>提交人数</th>
                <th>状态</th>
                <th>
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id}>
                  <td>
                    <CourseTag course={h.course} />
                  </td>
                  <td className="hw-table-name">{homeworkTitle(h)}</td>
                  <td className="hw-date">
                    <time dateTime={h.dueAt}>{formatHomeworkTime(h.dueAt)}</time>
                  </td>
                  <td className="hw-count">
                    {h.submittedCount} <span>/ {h.totalCount}</span>
                  </td>
                  <td>
                    <span
                      className={`hw-tag ${h.submittedCount === h.totalCount ? 'hw-submitted' : 'hw-waiting'}`}
                    >
                      {h.submittedCount === h.totalCount ? '已收齐' : '未收齐'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="hw-button hw-ghost"
                      onClick={() => setRecordId(h.id)}
                      aria-label={`查看${h.course} ${homeworkTitle(h)}提交记录`}
                    >
                      查看
                      <ChevronRight size={14} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <p className="hw-empty">{data.items.length ? '没有匹配的作业' : '暂无作业'}</p>
          )}
        </div>
      ) : (
        <div className="hw-list">
          <div className="hw-columns" aria-hidden>
            <span>课程</span>
            <span>实验</span>
            <span>截止时间</span>
            <span>状态</span>
            <span>提交</span>
          </div>
          {items.map((h) => (
            <HomeworkRow
              key={h.id}
              homework={h}
              pending={pending[h.id]}
              pageFileDragging={fileDragging}
              onFiles={choose}
              onSubmit={(id) => void submit(id)}
              onDiscard={discard}
            />
          ))}
          {!items.length && (
            <p className="hw-empty">{data.items.length ? '没有匹配的作业' : '暂无作业'}</p>
          )}
        </div>
      )}
      {creating && (
        <NewHomeworkDialog
          open={creating}
          onOpenChange={setCreating}
          className={className}
          courses={courses}
        />
      )}
      <HomeworkRecords id={recordId} onClose={() => setRecordId(null)} />
    </section>
  )
}
