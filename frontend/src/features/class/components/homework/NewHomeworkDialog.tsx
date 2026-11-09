import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { createHomework } from '@/api/endpoints/homeworks'
import type { HomeworkCreateIn } from '@/api/schemas/homework'
import { useAuthStore } from '@/stores/authStore'
import { homeworkKeys } from '../../hooks/useHomeworks'
import { errMsg } from '../../hooks/keys'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  className: string
  courses: string[]
}
export function NewHomeworkDialog({ open, onOpenChange, className, courses }: Props) {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const [namingClass, setNamingClass] = useState(className)
  const [order, setOrder] = useState<HomeworkCreateIn['namingOrder']>('class-id-name')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = user?.name || user?.nickname || '姓名'
  const sid = user?.sid || '学号'
  const example = (
    order === 'class-id-name'
      ? [namingClass || className, sid, name]
      : [namingClass || className, name, sid]
  ).join('-')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const form = new FormData(e.currentTarget)
    const due = String(form.get('due'))
    const date = new Date(`${due}:00+08:00`)
    if (!Number.isFinite(date.getTime())) {
      setError('请选择截止时间')
      return
    }
    setBusy(true)
    setError('')
    try {
      await createHomework({
        course: String(form.get('course')).trim(),
        experimentNo: Number(form.get('number')),
        title: String(form.get('title')).trim(),
        dueAt: date.toISOString(),
        namingClass: namingClass.trim(),
        namingOrder: order,
      })
      await qc.invalidateQueries({ queryKey: homeworkKeys.all })
      onOpenChange(false)
      toast.success('作业已发布')
    } catch (e) {
      setError(errMsg(e, '发布失败，请重试'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value)
      }}
    >
      <DialogContent className="hw-dialog" aria-describedby={undefined}>
        <DialogTitle>发布作业</DialogTitle>
        <form onSubmit={(e) => void submit(e)} className="hw-form">
          <div className="hw-form-pair">
            <label>
              课程
              <input
                name="course"
                list="hw-courses"
                placeholder="课程名称"
                required
                maxLength={120}
              />
            </label>
            <datalist id="hw-courses">
              {courses.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <label>
              实验编号
              <input name="number" type="number" min={1} max={99} defaultValue={1} required />
            </label>
          </div>
          <label>
            实验名称 <span className="hw-muted">（可不填）</span>
            <input name="title" placeholder="如：进程调度" maxLength={120} />
          </label>
          <label>
            截止时间 <span className="hw-muted">（北京时间）</span>
            <input name="due" type="datetime-local" required />
          </label>
          <div className="hw-form-rule">
            <label>
              班级
              <input
                value={namingClass}
                onChange={(e) => setNamingClass(e.target.value)}
                maxLength={80}
                required
              />
            </label>
            <fieldset>
              <legend>文件命名规则</legend>
              <div className="hw-rule-options">
                {(['class-id-name', 'class-name-id'] as const).map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="order"
                      value={value}
                      checked={order === value}
                      onChange={() => setOrder(value)}
                    />
                    {value === 'class-id-name' ? '班级-学号-姓名' : '班级-姓名-学号'}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="hw-rule-example">
              示例 <span>{example}.pdf</span>
            </p>
          </div>
          {error && (
            <p className="hw-error" role="alert">
              {error}
            </p>
          )}
          <div className="hw-form-footer">
            <button
              type="button"
              className="hw-button"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              取消
            </button>
            <button type="submit" className="hw-button hw-primary" disabled={busy}>
              {busy ? '发布中…' : '确认发布'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
