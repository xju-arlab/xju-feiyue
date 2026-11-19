import * as React from 'react'

import type { ClassMember } from '@/api/schemas/class'
import { CommitteeBadge } from '@/components/common/CommitteeBadge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/cn'

import { useSetMemberCommittee } from '../hooks/useClass'

type Props = {
  member: ClassMember | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 仅超管可授予「班长」；班长身份的调整也只属于超管。 */
  allowBanzhang: boolean
}

const PRESETS = [
  '班长',
  '副班长',
  '团支书',
  '学习委员',
  '体育委员',
  '文艺委员',
  '生活委员',
  '心理委员',
  '组织委员',
] as const

/**
 * 班内设置班委（成员卡片右键入口）—— 与管理端 SetCommitteeDialog 同构，
 * 但走 /classes/me/members/{sid}/committee（超管或班长可用），且非超管
 * 隐藏「班长」预设（后端同样强制 403）。
 */
export function SetMemberCommitteeDialog({ member, open, onOpenChange, allowBanzhang }: Props) {
  const setCommittee = useSetMemberCommittee()
  const [title, setTitle] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setTitle(member?.committeeTitle ?? (allowBanzhang ? '班长' : '学习委员'))
  }, [open, member, allowBanzhang])

  if (!member) return null

  const presets = allowBanzhang ? PRESETS : PRESETS.filter((p) => p !== '班长')

  const onSave = () => {
    setCommittee.mutate(
      { sid: member.sid, isClassCommittee: true, committeeTitle: title.trim() || undefined },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {member.isClassCommittee ? '修改班委职务' : '设为班委'}
          </DialogTitle>
          <DialogDescription>
            <strong>{member.nickname}</strong>（{member.sid}
            ）将获得班委权限：发起点名、勾选到点、审批本班小组的加入申请。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTitle(p)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition',
                  title === p
                    ? 'border-text bg-bg-subtle text-text'
                    : 'border-border text-text-muted hover:border-text-muted hover:text-text',
                )}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-committee-title">职务名称</Label>
            <div className="flex items-center gap-3">
              <Input
                id="member-committee-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={32}
                placeholder="如：学习委员"
                className="flex-1"
              />
              <CommitteeBadge title={title} className="text-xs" />
            </div>
            <p className="m-0 text-xs text-text-faint">
              {allowBanzhang
                ? '班长、团支书显示红色徽标，其余职务橙色；留空则显示通用「班委」。'
                : '「班长」职务须由超级管理员设置；其余职务橙色徽标，留空显示通用「班委」。'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSave} disabled={setCommittee.isPending}>
            {setCommittee.isPending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
