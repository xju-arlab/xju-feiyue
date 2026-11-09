import type { ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, GraduationCap } from 'lucide-react'

import { resolveAssetUrl } from '@/api/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

/**
 * /class 空间的顶层导航栏 —— 取代旧的「返回 Feiyue」极简链接。
 *
 * AppShell 之外的独立页面（ClassPage / GroupSpacePage）共用本栏：左侧回主站，
 * 中间是班级级 section 链接（概览 / 作业 / 点名 / 成员），可选传入面包屑尾节点（如
 * 当前小组名），右侧是登录用户。sticky 顶部、全宽、内容居中约束到 max-w-5xl。
 */

/** 班级级 section —— 全都落在 /class 概览页（layer 2），以 ?tab= 切换。 */
const SECTIONS = [
  { key: 'groups', label: '概览', to: '/class?tab=groups' },
  { key: 'homeworks', label: '作业', to: '/class?tab=homeworks' },
  { key: 'rollcall', label: '点名', to: '/class?tab=rollcall' },
  { key: 'members', label: '成员', to: '/class?tab=members' },
] as const

type Props = {
  /** 面包屑尾节点（当前小组名等）；传入时高亮它、section 链接不高亮。 */
  crumb?: ReactNode
}

export function ClassNavbar({ crumb }: Props) {
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  const [searchParams] = useSearchParams()
  // 概览页的 active section：仅当在 /class 且无面包屑时点亮。
  const onOverview = location.pathname === '/class' && !crumb
  const activeTab = searchParams.get('tab') ?? 'groups'

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted transition hover:text-text"
        >
          <ArrowLeft size={15} aria-hidden />
          <span className="hidden sm:inline">返回 Feiyue</span>
        </Link>

        <span aria-hidden className="mx-1.5 text-text-faint">
          ·
        </span>

        <Link
          to="/class"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text"
        >
          <GraduationCap size={16} strokeWidth={1.75} aria-hidden />
          <span className="hidden sm:inline">分组任务</span>
        </Link>

        {/* section 链接 —— 概览 / 作业 / 点名 / 成员 */}
        <div className="ml-3 flex items-center gap-0.5">
          {SECTIONS.map((s) => (
            <Link
              key={s.key}
              to={s.to}
              className={cn(
                'rounded-md px-2.5 py-1 text-sm transition',
                onOverview && activeTab === s.key
                  ? 'bg-bg-subtle font-medium text-text'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>

        {/* 面包屑尾节点（当前小组等）*/}
        {crumb && (
          <span className="ml-1 inline-flex min-w-0 items-center gap-1">
            <ChevronRight size={14} aria-hidden className="shrink-0 text-text-faint" />
            <span className="truncate text-sm font-medium text-text">{crumb}</span>
          </span>
        )}

        {user && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 pl-3">
            <Avatar className="size-7">
              {(user.avatarThumb ?? user.avatar) && (
                <AvatarImage src={resolveAssetUrl(user.avatarThumb ?? user.avatar ?? '')} alt="" />
              )}
              <AvatarFallback className="text-[10px]">{user.nickname.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <span className="hidden truncate text-sm text-text sm:inline">{user.nickname}</span>
          </span>
        )}
      </nav>
    </header>
  )
}
