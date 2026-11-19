import { useState } from 'react'
import { Settings2, Target } from 'lucide-react'

import type { Mission } from '@/api/schemas/class'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { MissionManageDialog } from './MissionManageDialog'

type Props = {
  missions: Mission[] | undefined
  isCommittee: boolean
}

/**
 * 小组列表内的当前分组任务。
 * 展示进行中的分组任务；班委可「管理任务」（新建 / 设为进行中 / 改名 / 删除）。
 */
export function MissionBar({ missions, isCommittee }: Props) {
  const [manageOpen, setManageOpen] = useState(false)
  const active = missions?.find((m) => m.isActive) ?? null

  return (
    <section aria-label="当前分组任务" className="class-mission">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-content-center rounded-[4px] border border-border bg-bg text-text-muted">
          <Target size={16} strokeWidth={1.75} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          {active ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-text-muted">当前分组任务</span>
                <Badge variant="secondary" className="text-[10px]">
                  进行中
                </Badge>
              </div>
              <h3 className="m-0 mt-1 font-serif text-base font-semibold text-text [overflow-wrap:anywhere]">
                {active.title}
              </h3>
              {active.description && (
                <p className="m-0 mt-1 whitespace-pre-wrap text-sm text-text-muted [overflow-wrap:anywhere]">
                  {active.description}
                </p>
              )}
            </>
          ) : (
            <p className="m-0 py-2 text-sm text-text-muted">暂无进行中的分组任务</p>
          )}
        </div>
        {isCommittee && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setManageOpen(true)}
          >
            <Settings2 size={15} aria-hidden className="mr-1.5" />
            {missions?.length ? '管理任务' : '设置任务'}
          </Button>
        )}
      </div>

      {isCommittee && (
        <MissionManageDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          missions={missions ?? []}
        />
      )}
    </section>
  )
}
