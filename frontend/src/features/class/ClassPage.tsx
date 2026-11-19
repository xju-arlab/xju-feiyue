import type { ReactNode } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useSearchParams } from 'react-router-dom'
import { GraduationCap } from 'lucide-react'

import { CommitteeBadge } from '@/components/common/CommitteeBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'

import { ClassOverview } from './components/ClassOverview'
import { HomeworkTab } from './components/homework/HomeworkTab'
import { ClassNavbar } from './components/ClassNavbar'
import { GroupsTab } from './components/groups/GroupsTab'
import { MembersTab } from './components/MembersTab'
import { RollcallTab } from './components/rollcall/RollcallTab'
import { useClassMe } from './hooks/useClass'

/** 班级空间以概览为入口。小组列表和组内空间保留独立地址。 */
function ClassLayout({ children }: { children: ReactNode }) {
  return (
    <div className="class-space">
      <ClassNavbar />
      <main className="class-content">{children}</main>
    </div>
  )
}

export function ClassPage() {
  const sid = useAuthStore((s) => s.user?.sid)
  const [searchParams] = useSearchParams()
  const tab = searchParams.get('tab') ?? 'overview'

  const { data: me, isLoading, isError, refetch } = useClassMe()

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

  const sectionTitle =
    tab === 'groups' ? '小组' : tab === 'rollcall' ? '点名' : tab === 'members' ? '成员' : undefined

  return (
    <ClassLayout>
      {tab !== 'homeworks' && (
        <header className="class-page-heading">
          <h1>{sectionTitle ?? me.classFullName}</h1>
          <div className="class-page-meta">
            {sectionTitle && <span>{me.classShortName || me.classFullName}</span>}
            {me.isClassCommittee && <CommitteeBadge title={me.committeeTitle} />}
          </div>
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
      ) : tab === 'groups' ? (
        <GroupsTab isCommittee={me.isClassCommittee} />
      ) : (
        <ClassOverview memberCount={me.memberCount} />
      )}
    </ClassLayout>
  )
}
