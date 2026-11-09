import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { downloadHomework } from '@/api/endpoints/homeworks'
import { useHomeworkRecords } from '../../hooks/useHomeworks'
import { errMsg } from '../../hooks/keys'
import { CourseTag, SubmissionTag } from './HomeworkBadges'
import { formatHomeworkTime, homeworkTitle } from './helpers'

type Props = { id: string | null; onClose: () => void }
export function HomeworkRecords({ id, onClose }: Props) {
  const { data, isPending, isError, refetch } = useHomeworkRecords(id)
  const [downloading, setDownloading] = useState(false)
  async function download(filename: string, sid?: string) {
    if (!id || downloading) return
    setDownloading(true)
    try {
      await downloadHomework(id, filename, sid)
    } catch (e) {
      toast.error(errMsg(e, '下载失败'))
    } finally {
      setDownloading(false)
    }
  }
  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <SheetContent className="hw-records-sheet" aria-describedby={undefined}>
        <SheetTitle className="pr-5 font-serif text-xl">
          {data ? homeworkTitle(data.homework) : '提交记录'}
        </SheetTitle>
        {isPending ? (
          <p className="hw-empty">
            <Loader2 size={18} className="animate-spin" />
            加载中…
          </p>
        ) : isError || !data ? (
          <div className="hw-empty">
            <p>提交记录加载失败</p>
            <button className="hw-button" onClick={() => void refetch()}>
              重试
            </button>
          </div>
        ) : (
          <>
            <div className="hw-records-meta">
              <CourseTag course={data.homework.course} />
              <time dateTime={data.homework.dueAt}>
                {formatHomeworkTime(data.homework.dueAt)} 截止
              </time>
            </div>
            <div className="hw-collection-rule">
              <span>文件命名规则</span>
              <span>
                {data.homework.namingOrder === 'class-id-name'
                  ? '班级-学号-姓名'
                  : '班级-姓名-学号'}
              </span>
              <span className="hw-collection-count">
                {data.homework.submittedCount} / {data.homework.totalCount} 已提交
              </span>
            </div>
            <div className="hw-records-actions">
              <span>提交记录</span>
              <button
                className="hw-button hw-ghost"
                disabled={downloading || !data.homework.submittedCount}
                onClick={() =>
                  void download(`${data.homework.course}-${homeworkTitle(data.homework)}.zip`)
                }
              >
                <Download size={14} aria-hidden />
                {downloading ? '下载中…' : '下载全部'}
              </button>
            </div>
            <div
              className="hw-records-scroll"
              tabIndex={0}
              role="region"
              aria-label="提交记录，窄屏可左右滚动"
            >
              <table className="hw-records-table">
                <colgroup>
                  <col className="hw-record-person" />
                  <col className="hw-record-file" />
                  <col className="hw-record-time" />
                  <col className="hw-record-state" />
                </colgroup>
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>文件名</th>
                    <th>提交时间</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((r) => (
                    <tr key={r.sid}>
                      <td>{r.name}</td>
                      <td>
                        {r.filename ? (
                          <button
                            className="hw-file-link"
                            title={r.filename}
                            disabled={downloading}
                            onClick={() => void download(r.filename!, r.sid)}
                          >
                            {r.filename}
                          </button>
                        ) : (
                          <span className="hw-muted">—</span>
                        )}
                      </td>
                      <td className="hw-record-date">
                        {r.submittedAt ? formatHomeworkTime(r.submittedAt) : '—'}
                      </td>
                      <td>
                        <SubmissionTag submitted={Boolean(r.filename)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
