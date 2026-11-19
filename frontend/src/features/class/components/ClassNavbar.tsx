import type { ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Inbox,
  LayoutGrid,
  Users,
  UsersRound,
} from 'lucide-react'

import { resolveAssetUrl } from '@/api/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuthStore } from '@/stores/authStore'
import '../class-space.css'

/**
 * /class 空间的顶层导航栏 —— 取代旧的「返回 Feiyue」极简链接。
 *
 * AppShell 之外的独立页面（ClassPage / GroupSpacePage）共用本栏：左侧回主站，
 * 中间是班级空间的页签，右侧是登录用户。组内页另外显示小组名。
 */

const SECTIONS = [
  { key: 'overview', label: '概览', to: '/class?tab=overview', icon: LayoutGrid },
  { key: 'homeworks', label: '作业', to: '/class?tab=homeworks', icon: Inbox },
  { key: 'rollcall', label: '点名', to: '/class?tab=rollcall', icon: ClipboardCheck },
  { key: 'members', label: '成员', to: '/class?tab=members', icon: Users },
  { key: 'groups', label: '小组', to: '/class?tab=groups', icon: UsersRound },
] as const

type Props = {
  crumb?: ReactNode
}

export function ClassNavbar({ crumb }: Props) {
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const activeTab =
    location.pathname === '/class'
      ? (SECTIONS.find((section) => section.key === requestedTab)?.key ?? 'overview')
      : 'groups'
  const nickname = user?.nickname || user?.name || user?.sid || ''

  return (
    <header className="class-navbar">
      <nav className="class-navbar-inner" aria-label="班级导航">
        <div className="class-breadcrumb">
          <Link to="/" className="class-nav-link" aria-label="返回 Feiyue">
            <ArrowLeft size={15} aria-hidden />
            <span className="hidden sm:inline">Feiyue</span>
          </Link>

          <ChevronRight size={13} aria-hidden className="shrink-0 text-text-faint" />

          <Link to="/class" className="class-nav-link class-nav-brand">
            <GraduationCap size={16} strokeWidth={1.75} aria-hidden />
            <span>班级空间</span>
          </Link>
          {crumb && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <ChevronRight size={14} aria-hidden className="shrink-0 text-text-faint" />
              <span className="truncate text-sm font-medium text-text">{crumb}</span>
            </span>
          )}
        </div>

        <div className="class-tabs">
          {SECTIONS.map(({ key, label, to, icon: Icon }) => (
            <Link
              key={key}
              to={to}
              aria-current={activeTab === key ? (crumb ? 'location' : 'page') : undefined}
              className="class-nav-link"
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden />
              {label}
            </Link>
          ))}
        </div>

        {user && (
          <span className="class-nav-user">
            <Avatar className="size-7">
              {(user.avatarThumb ?? user.avatar) && (
                <AvatarImage src={resolveAssetUrl(user.avatarThumb ?? user.avatar ?? '')} alt="" />
              )}
              <AvatarFallback className="text-[10px]">{nickname.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <span className="hidden truncate text-sm text-text sm:inline">{nickname}</span>
          </span>
        )}
      </nav>
    </header>
  )
}
