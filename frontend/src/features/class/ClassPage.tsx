import type { ReactNode } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { Navigate, useSearchParams } from 'react-router-dom'
import { GraduationCap, Users } from 'lucide-react'

import { CommitteeBadge } from '@/components/common/CommitteeBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { Badge } from '@/components/ui/badge'

import { HomeworkTab } from './components/homework/HomeworkTab'
import { ClassNavbar } from './components/ClassNavbar'
import { MembersTab } from './components/MembersTab'
import { MissionBar } from './components/mission/MissionBar'
import { GroupsTab } from './components/groups/GroupsTab'
import { RollcallTab } from './components/rollcall/RollcallTab'
import { useClassMe } from './hooks/useClass'
import { useGroups } from './hooks/useGroups'
import { useMissions } from './hooks/useMissions'

/**
 * /class —— 班级空间（AppShell 之外的独立页面，配 ClassNavbar 顶层导航栏）。
 *
 * 三层结构：
 *   1. 任务层：进行中的分组任务（MissionBar），学委可设置；
 *   2. 概览层：本页的「概览 / 作业 / 点名 / 成员」section（?tab= 同步 URL）；
 *   3. 组内层：/class/groups/:gid（GroupSpacePage）。
 *
 * 默认落点：裸进入 /class（无 ?tab=）时，已进组 → 跳自己组（layer 3），
 * 未进组 → 停在「所有组概览」。导航栏的 section 链接都带 ?tab=，即视为
 * 显式停留在概览层，不再自动跳转。
 */
function ClassLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <ClassNavbar />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-7">{children}</main>
    </div>
  )
}

export function ClassPage() {
  const sid = useAuthStore((s) => s.user?.sid)
  const [searchParams] = useSearchParams()
  const tab = searchParams.get('tab') ?? 'groups'
  const bareEntry = !searchParams.has('tab')

  const { data: me, isLoading, isError, refetch } = useClassMe()
  const inClass = Boolean(me?.classFullName)
  const { data: groups, isLoading: groupsLoading } = useGroups(inClass)
  const { data: missions } = useMissions(inClass)

  if (isLoading) {
    return (
      <ClassLayout>
        <LoadingSkeleton preset="paragraph" count={3} />
      </ClassLayout>
    )
  }
  if (isError || !me) {
    return (
      <ClassLayout>
        <ErrorState
          title="班级信息加载失败"
          message="请稍后重试。"
          onRetry={() => void refetch()}
        />
      </ClassLayout>
    )
  }
  if (!me.classFullName) {
    return (
      <ClassLayout>
        <EmptyState
          icon={GraduationCap}
          title="你还没有加入班级"
          description="班级信息由管理员统一设置，请联系管理员将你加入所在班级。"
        />
      </ClassLayout>
    )
  }

  // 默认落点：裸进入时，已进组 → 跳自己组。等小组加载完再判定，避免概览闪一下。
  if (bareEntry) {
    if (groupsLoading) {
      return (
        <ClassLayout>
          <LoadingSkeleton preset="paragraph" count={3} />
        </ClassLayout>
      )
    }
    const myGroup = groups?.find((g) => g.myRole != null)
    if (myGroup) {
      return <Navigate to={`/class/groups/${myGroup.id}`} replace />
    }
    // 未进组 → 落在所有组概览。
  }

  return (
    <ClassLayout>
      {tab !== 'homeworks' && (
        <header className="mb-5 flex flex-wrap items-center gap-3">
          <h1 className="m-0 font-serif text-[28px] font-semibold tracking-[-0.01em] text-text">
            {me.classFullName}
          </h1>
          <Badge variant="secondary">{me.classShortName}</Badge>
          {me.isClassCommittee && <CommitteeBadge title={me.committeeTitle} className="text-xs" />}
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-text-muted">
            <Users size={15} strokeWidth={1.75} aria-hidden />
            {me.memberCount} 名成员
          </span>
        </header>
      )}

      {tab === 'homeworks' ? (
        <HomeworkTab
          key={`${sid}:${me.classFullName}`}
          className={me.classShortName || me.classFullName}
        />
      ) : tab === 'rollcall' ? (
        <RollcallTab isCommittee={me.isClassCommittee} />
      ) : tab === 'members' ? (
        <MembersTab />
      ) : (
        <>
          {/* 任务层（layer 1）—— 概览页顶部 */}
          <MissionBar missions={missions} isCommittee={me.isClassCommittee} />
          <GroupsTab isCommittee={me.isClassCommittee} />
        </>
      )}
    </ClassLayout>
  )
}
