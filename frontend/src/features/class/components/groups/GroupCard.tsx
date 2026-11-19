import { Link } from 'react-router-dom'
import { ArrowRight, Crown } from 'lucide-react'

import type { Group } from '@/api/schemas/class'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { GroupLogo } from './GroupLogo'
import { JoinRequestButton } from './JoinRequestButton'

type Props = { group: Group }

/** 小组卡片 —— Logo + 名称 + 组长 + 成员数；成员进入小组空间，非成员申请加入。 */
export function GroupCard({ group }: Props) {
  const isMember = group.myRole != null
  return (
    <li className="class-item flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <GroupLogo gid={group.id} name={group.name} logo={group.logo} logoThumb={group.logoThumb} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="m-0 truncate font-serif text-base font-semibold text-text">
              {group.name}
            </h3>
            {group.myRole === 'leader' && <Badge className="px-1.5 py-0 text-[10px]">组长</Badge>}
            {group.myRole === 'member' && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                已加入
              </Badge>
            )}
          </div>
          <p className="m-0 mt-0.5 flex items-center gap-1 text-xs text-text-muted">
            <Crown size={11} aria-hidden />
            {group.leaderNickname} · {group.memberCount} 名成员
          </p>
        </div>
      </div>

      {group.intro && <p className="m-0 line-clamp-2 text-sm text-text-muted">{group.intro}</p>}

      <div className="mt-auto flex items-center gap-2">
        {isMember ? (
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link to={`/class/groups/${group.id}`}>
              进入小组
              <ArrowRight size={14} aria-hidden className="ml-1" />
            </Link>
          </Button>
        ) : (
          <>
            <Button asChild size="sm" variant="outline">
              <Link to={`/class/groups/${group.id}`}>查看</Link>
            </Button>
            <span className="ml-auto">
              <JoinRequestButton group={group} />
            </span>
          </>
        )}
      </div>
    </li>
  )
}
