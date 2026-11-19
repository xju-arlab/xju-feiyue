import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorState } from '@/components/common/ErrorState'
import type { RollcallSummary } from '@/api/schemas/class'
import { cn } from '@/lib/cn'

import { useDeleteRollcall, useRollcall } from '../../hooks/useRollcalls'
import { absentSummary, sortAbsentFirst } from '../../lib/rollcall'

type Props = {
  summary: RollcallSummary
  isCommittee: boolean
  onContinue: () => void
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 点名历史行 —— 折叠行（时间 · 出勤 x/y · 发起人），展开懒加载详情，
 * 缺勤优先排序 + 高亮 + 一行缺勤摘要。班委可「继续点名」（未完成的会话）
 * 或删除。
 */
export function RollcallHistoryItem({ summary, isCommittee, onContinue }: Props) {
  const [expanded, setExpanded] = useState(false)
  // 展开才发请求（懒加载详情）。
  const { data: detail, isLoading, refetch } = useRollcall(expanded ? summary.id : null)
  const remove = useDeleteRollcall()

  const isOpenSession = summary.closedAt == null
  const hasAbsent = summary.presentCount < summary.totalCount

  return (
    <li className="bg-bg">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex max-w-full items-center gap-2 rounded-[4px] px-1.5 py-1 text-left text-sm text-text hover:bg-bg-subtle"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown size={15} aria-hidden />
          ) : (
            <ChevronRight size={15} aria-hidden />
          )}
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
            {formatDateTime(summary.createdAt)}
            {summary.title ? ` · ${summary.title}` : ''}
          </span>
          {isOpenSession && <span className="shrink-0 text-xs text-cat-research">点名中</span>}
        </button>
        <span
          className={cn(
            'text-sm tabular-nums',
            hasAbsent ? 'text-cat-research' : 'text-text-muted',
          )}
        >
          出勤 {summary.presentCount}/{summary.totalCount}
        </span>
        <span className="text-xs text-text-faint">发起人 {summary.createdByNickname}</span>

        {isCommittee && (
          <span className="ml-auto inline-flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onContinue}>
              <Pencil size={13} aria-hidden className="mr-1" />
              {isOpenSession ? '继续点名' : '修改'}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-cat-research">
                  <Trash2 size={13} aria-hidden />
                  <span className="sr-only">删除本次点名</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除本次点名？</AlertDialogTitle>
                  <AlertDialogDescription>
                    {formatDateTime(summary.createdAt)} 的点名记录将被永久删除，无法恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove.mutate(summary.id)}>
                    删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </span>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3">
          {isLoading ? (
            <LoadingSkeleton preset="paragraph" count={1} />
          ) : !detail ? (
            <ErrorState
              title="点名记录加载失败"
              message="请稍后重试。"
              onRetry={() => void refetch()}
            />
          ) : (
            <>
              {absentSummary(detail.records) && (
                <p className="m-0 mb-2 text-sm text-cat-research">
                  {absentSummary(detail.records)}
                </p>
              )}
              <ul className="grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0 sm:grid-cols-3 lg:grid-cols-4">
                {sortAbsentFirst(detail.records).map((r) => (
                  <li
                    key={r.sid}
                    className={cn(
                      'truncate text-sm',
                      r.present ? 'text-text-muted' : 'font-semibold text-cat-research',
                    )}
                  >
                    {r.nickname}
                    <span className="ml-1 text-xs font-normal text-text-faint">
                      {r.present ? '到' : '缺'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  )
}
