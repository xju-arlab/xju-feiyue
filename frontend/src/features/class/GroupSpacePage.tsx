import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Lock } from 'lucide-react'

import { ErrorState } from '@/components/common/ErrorState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/authStore'

import { ClassNavbar } from './components/ClassNavbar'
import { GanttPanel } from './components/gantt/GanttPanel'
import { GroupFilesPanel } from './components/group-space/GroupFilesPanel'
import { GroupHeader } from './components/group-space/GroupHeader'
import { GroupIntro } from './components/group-space/GroupIntro'
import { JoinRequestButton } from './components/groups/JoinRequestButton'
import { useGroup } from './hooks/useGroups'

/**
 * /class/groups/:gid —— 小组内空间（可分享 URL）。
 *
 * 非组员（本班同学）可见头部 + 简介 + 成员；文件与甘特替换为锁面板 +
 * 申请入口（后端同时强制 403，前端裁剪只是 UX）。班委/管理员按组员对待
 * （后端有 override，`canAccess` 与之对齐）。
 */
export function GroupSpacePage() {
  const { gid } = useParams<{ gid: string }>()
  const user = useAuthStore((s) => s.user)
  const { data: group, isLoading, isError, refetch } = useGroup(gid ?? null)

  if (isLoading) {
    return (
      <GroupLayout>
        <LoadingSkeleton preset="paragraph" count={3} />
      </GroupLayout>
    )
  }
  if (isError || !group) {
    return (
      <GroupLayout>
        <ErrorState
          title="小组加载失败"
          message="小组不存在，或你不在该小组所在的班级。"
          onRetry={() => void refetch()}
        />
        <div className="mt-4 text-center">
          <Button asChild variant="outline" size="sm">
            <Link to="/class">
              <ArrowLeft size={14} aria-hidden className="mr-1" />
              返回分组任务
            </Link>
          </Button>
        </div>
      </GroupLayout>
    )
  }

  const isMember = group.myRole != null
  const isCommittee = user?.isClassCommittee === true
  const isAdmin = user?.isAdmin === true
  const canAccess = isMember || isCommittee || isAdmin
  const canManage = group.myRole === 'leader' || isCommittee || isAdmin

  return (
    <GroupLayout crumb={group.name}>
      <GroupHeader group={group} canManage={canManage} currentSid={user?.sid ?? ''} />

      <div className="mt-6 flex flex-col gap-6">
        <GroupIntro group={group} canEdit={canManage} />

        {canAccess ? (
          <>
            <GroupFilesPanel
              gid={group.id}
              group={group}
              currentSid={user?.sid ?? ''}
              canManage={canManage}
            />
            <GanttPanel
              gid={group.id}
              members={group.members}
              canEdit
              currentSid={user?.sid ?? ''}
              canManage={canManage}
            />
          </>
        ) : (
          <section className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <Lock size={22} aria-hidden className="text-text-muted" />
            <p className="m-0 text-sm text-text-muted">加入小组后可查看文件与任务</p>
            <JoinRequestButton group={group} size="default" />
          </section>
        )}
      </div>
    </GroupLayout>
  )
}

function GroupLayout({ crumb, children }: { crumb?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <ClassNavbar crumb={crumb} />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-7">{children}</main>
    </div>
  )
}
