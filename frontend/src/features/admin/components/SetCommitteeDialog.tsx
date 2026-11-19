import * as React from 'react'

import type { AdminUserRow } from '@/api/schemas/admin'
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

import { useSetUserCommittee } from '../hooks/useAdmin'

type Props = {
  user: AdminUserRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 常见班委职务预设；点击填入输入框，仍可自由改写。 */
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
 * 设为班委 / 修改班委职务 —— 选择或输入职务名称，徽标实时预览
 * （班长/团支书红、其余橙，token 配色见 CommitteeBadge）。
 */
export function SetCommitteeDialog({ user, open, onOpenChange }: Props) {
  const setCommittee = useSetUserCommittee()
  const [title, setTitle] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setTitle(user?.committeeTitle ?? '班长')
  }, [open, user])

  if (!user) return null

  const onSave = () => {
    setCommittee.mutate(
      { sid: user.sid, isClassCommittee: true, committeeTitle: title.trim() || undefined },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">
            {user.isClassCommittee ? '修改班委职务' : '设为班委'}
          </DialogTitle>
          <DialogDescription>
            <strong>{user.nickname}</strong>（{user.classShortName ?? '未分配班级'}
            ）将获得班委权限：发起点名、勾选到点、审批本班小组的加入申请。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
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
            <Label htmlFor="committee-title">职务名称</Label>
            <div className="flex items-center gap-3">
              <Input
                id="committee-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={32}
                placeholder="如：班长"
                className="flex-1"
              />
              <CommitteeBadge title={title} className="text-xs" />
            </div>
            <p className="m-0 text-xs text-text-faint">
              班长、团支书显示红色徽标，其余职务显示橙色；留空则显示通用「班委」。
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
