import { useState } from 'react'
import { Download, Plus, UserX, UsersRound } from 'lucide-react'

import { resolveAssetUrl } from '@/api/client'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

import { useExportClassGroups, useMissions } from '../../hooks/useMissions'
import { useGroups, useUnassignedMembers } from '../../hooks/useGroups'
import { MissionBar } from '../mission/MissionBar'
import { CreateGroupDialog } from './CreateGroupDialog'
import { GroupCard } from './GroupCard'

type Props = {
  /** 班委 —— 显示「导出班级分组信息」按钮（后端二次强制）。 */
  isCommittee?: boolean
}

/**
 * 小组 tab —— 分组任务的全局概览（所有组卡片网格）。已入组用户不再显示
 * 「创建小组」（一人一组）；班委额外可「导出班级分组信息」为 .docx。
 */
export function GroupsTab({ isCommittee = false }: Props) {
  const { data: groups, isLoading, isError, refetch } = useGroups(true)
  const { data: unassigned } = useUnassignedMembers(true)
  const [createOpen, setCreateOpen] = useState(false)
  const exportGroups = useExportClassGroups()
  const missions = useMissions(true)

  if (isLoading) return <LoadingSkeleton preset="paragraph" count={2} />
  if (isError || !groups) {
    return <ErrorState title="小组加载失败" message="请稍后重试。" onRetry={() => void refetch()} />
  }

  const inGroup = groups.some((g) => g.myRole != null)

  return (
    <section aria-label="小组列表">
      <div className="class-section-heading">
        <span className="class-section-count">{groups.length} 个小组</span>
        <div className="class-section-actions">
          {!inGroup && (
            <Button size="sm" className="class-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={15} aria-hidden className="mr-1.5" />
              创建小组
            </Button>
          )}
          {isCommittee && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportGroups.mutate()}
              disabled={exportGroups.isPending}
            >
              <Download size={15} aria-hidden className="mr-1.5" />
              {exportGroups.isPending ? '导出中…' : '导出分组'}
            </Button>
          )}
        </div>
      </div>

      {missions.isError ? (
        <ErrorState
          title="分组任务加载失败"
          message="请稍后重试。"
          onRetry={() => void missions.refetch()}
        />
      ) : missions.isPending ? (
        <LoadingSkeleton preset="paragraph" count={1} />
      ) : (
        <MissionBar missions={missions.data} isCommittee={isCommittee} />
      )}

      {groups.length === 0 ? (
        <EmptyState icon={UsersRound} title="班里还没有小组" />
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
        </ul>
      )}

      {/* 未进组名单 —— 组卡片下方；全员进组后自动隐藏。 */}
      {unassigned && unassigned.length > 0 && (
        <section aria-label="未进组同学" className="mt-7 border-t border-border py-4">
          <div className="mb-3 flex items-center gap-2">
            <UserX size={15} aria-hidden className="text-text-muted" />
            <h3 className="m-0 text-sm font-semibold text-text">未进组同学</h3>
            <span className="text-xs text-text-faint">{unassigned.length} 人</span>
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {unassigned.map((m) => (
              <li
                key={m.sid}
                className="inline-flex items-center gap-1.5 rounded-[4px] bg-bg-subtle px-1.5 py-1 text-xs text-text"
                title={m.sid}
              >
                <Avatar className="size-5">
                  {m.avatarThumb && <AvatarImage src={resolveAssetUrl(m.avatarThumb)} alt="" />}
                  <AvatarFallback className="text-[9px]">{m.nickname.slice(0, 2)}</AvatarFallback>
                </Avatar>
                {m.nickname}
              </li>
            ))}
          </ul>
        </section>
      )}

      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
    </section>
  )
}
