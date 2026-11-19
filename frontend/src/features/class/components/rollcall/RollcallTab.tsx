import { useState } from 'react'
import { ClipboardCheck } from 'lucide-react'

import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { Button } from '@/components/ui/button'

import { useRollcalls, useStartRollcall } from '../../hooks/useRollcalls'
import { RollcallHistoryItem } from './RollcallHistoryItem'
import { RollcallSession } from './RollcallSession'

type Props = { isCommittee: boolean }

/**
 * 点名 tab —— 两种视图页内切换（materials list⇄detail 同款）：
 * 默认历史列表（全班可见）；点「发起点名」/「继续点名」进入勾选视图。
 */
export function RollcallTab({ isCommittee }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const { data: history, isLoading, isError, refetch } = useRollcalls(true)
  const start = useStartRollcall()

  if (activeId) {
    return (
      <RollcallSession id={activeId} isCommittee={isCommittee} onExit={() => setActiveId(null)} />
    )
  }

  return (
    <section aria-label="点名">
      {isCommittee && (
        <div className="mb-4 flex justify-end">
          <Button
            size="sm"
            className="class-primary"
            onClick={() => start.mutate(undefined, { onSuccess: (d) => setActiveId(d.id) })}
            disabled={start.isPending}
          >
            <ClipboardCheck size={15} aria-hidden className="mr-1.5" />
            {start.isPending ? '发起中…' : '发起点名'}
          </Button>
        </div>
      )}

      {isLoading ? (
        <LoadingSkeleton preset="paragraph" count={2} />
      ) : isError || !history ? (
        <ErrorState
          title="点名历史加载失败"
          message="请稍后重试。"
          onRetry={() => void refetch()}
        />
      ) : history.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="还没有点名记录" />
      ) : (
        <ul className="m-0 list-none divide-y divide-border border-y border-border p-0">
          {history.map((s) => (
            <RollcallHistoryItem
              key={s.id}
              summary={s}
              isCommittee={isCommittee}
              onContinue={() => setActiveId(s.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
