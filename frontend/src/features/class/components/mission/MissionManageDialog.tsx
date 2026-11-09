import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Pencil, Plus, Trash2 } from 'lucide-react'

import type { Mission } from '@/api/schemas/class'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { useCreateMission, useDeleteMission, useUpdateMission } from '../../hooks/useMissions'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  missions: Mission[]
}

/** null = 列表视图；'new' = 新建表单；string = 编辑该 id。 */
type Editing = null | 'new' | string

/**
 * 分组任务管理（班委）—— 新建 / 设为进行中 / 改名 / 删除。
 * 一个 dialog 内切换「列表 ↔ 表单」，避免嵌套 Radix dialog。
 */
export function MissionManageDialog({ open, onOpenChange, missions }: Props) {
  const create = useCreateMission()
  const update = useUpdateMission()
  const del = useDeleteMission()
  const [editing, setEditing] = useState<Editing>(null)

  useEffect(() => {
    if (open) setEditing(missions.length === 0 ? 'new' : null)
  }, [open, missions.length])

  const editingMission =
    typeof editing === 'string' && editing !== 'new'
      ? missions.find((m) => m.id === editing)
      : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>分组任务</DialogTitle>
          <DialogDescription>
            设置正在进行的分组任务；全班成员进入分组任务时以它为顶层。
          </DialogDescription>
        </DialogHeader>

        {editing !== null ? (
          <MissionForm
            key={editing}
            mission={editingMission}
            pending={create.isPending || update.isPending}
            onCancel={() => setEditing(missions.length === 0 ? 'new' : null)}
            onSubmit={(title, description) => {
              if (editingMission) {
                update.mutate(
                  { id: editingMission.id, body: { title, description } },
                  { onSuccess: () => setEditing(null) },
                )
              } else {
                create.mutate(
                  { title, description, active: true },
                  { onSuccess: () => setEditing(null) },
                )
              }
            }}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {missions.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start gap-2 rounded-lg border border-border p-2.5"
                >
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: m.id, body: { active: true } })}
                    disabled={m.isActive || update.isPending}
                    className="mt-0.5 shrink-0 text-text-muted transition enabled:hover:text-text disabled:cursor-default"
                    title={m.isActive ? '进行中' : '设为进行中'}
                    aria-label={m.isActive ? '进行中' : '设为进行中'}
                  >
                    {m.isActive ? (
                      <CheckCircle2 size={18} className="text-cat-tools" />
                    ) : (
                      <Circle size={18} />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text">{m.title}</span>
                      {m.isActive && (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          进行中
                        </Badge>
                      )}
                    </div>
                    {m.description && (
                      <p className="m-0 mt-0.5 line-clamp-2 text-xs text-text-muted">
                        {m.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => setEditing(m.id)}
                      aria-label="编辑"
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-text-muted hover:text-cat-research"
                      onClick={() => del.mutate(m.id)}
                      disabled={del.isPending}
                      aria-label="删除"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="outline" onClick={() => setEditing('new')}>
              <Plus size={15} aria-hidden className="mr-1.5" />
              新建分组任务
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function MissionForm({
  mission,
  pending,
  onCancel,
  onSubmit,
}: {
  mission: Mission | undefined
  pending: boolean
  onCancel: () => void
  onSubmit: (title: string, description: string) => void
}) {
  const [title, setTitle] = useState(mission?.title ?? '')
  const [description, setDescription] = useState(mission?.description ?? '')
  const trimmed = title.trim()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (trimmed) onSubmit(trimmed, description.trim())
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mission-title">任务标题</Label>
        <Input
          id="mission-title"
          value={title}
          maxLength={255}
          placeholder="如：软件工程课程设计 · 第一次分组"
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mission-desc">任务说明（可选）</Label>
        <Textarea
          id="mission-desc"
          rows={3}
          value={description}
          maxLength={4000}
          placeholder="分组规则、人数要求、截止时间等"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={pending || !trimmed}>
          {mission ? '保存' : '新建并设为进行中'}
        </Button>
      </div>
    </form>
  )
}
