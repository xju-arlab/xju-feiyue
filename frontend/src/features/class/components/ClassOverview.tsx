import { ArrowRight, ClipboardCheck, Inbox, Users, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useHomeworks } from '../hooks/useHomeworks'
import { useGroups } from '../hooks/useGroups'
import { useRollcalls } from '../hooks/useRollcalls'

export function ClassOverview({ memberCount }: { memberCount: number }) {
  const { data: homeworks } = useHomeworks()
  const { data: rollcalls } = useRollcalls(true)
  const { data: groups } = useGroups(true)
  const pending = homeworks?.items.filter((homework) => !homework.submission).length
  const entries = [
    {
      tab: 'homeworks',
      label: '作业',
      detail: homeworks && `${homeworks.items.length} 项作业 · ${pending} 项待提交`,
      icon: Inbox,
    },
    {
      tab: 'rollcall',
      label: '点名',
      detail: rollcalls && `${rollcalls.length} 次点名记录`,
      icon: ClipboardCheck,
    },
    { tab: 'members', label: '成员', detail: `${memberCount} 名成员`, icon: Users },
    { tab: 'groups', label: '小组', detail: groups && `${groups.length} 个小组`, icon: UsersRound },
  ]

  return (
    <nav className="class-overview-links" aria-label="班级功能">
      {entries.map(({ tab, label, detail, icon: Icon }) => (
        <Link key={tab} to={`/class?tab=${tab}`} className="class-overview-link">
          <span className="class-overview-icon">
            <Icon size={17} aria-hidden />
          </span>
          <span className="class-overview-label">
            <strong>{label}</strong>
            {detail && <small>{detail}</small>}
          </span>
          <ArrowRight size={15} aria-hidden className="class-overview-arrow" />
        </Link>
      ))}
    </nav>
  )
}
