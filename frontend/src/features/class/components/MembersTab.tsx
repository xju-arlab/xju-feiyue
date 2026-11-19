import { useState } from 'react'
import { Star, StarOff, Trash2, Users } from 'lucide-react'

import { resolveAssetUrl } from '@/api/client'
import type { ClassMember } from '@/api/schemas/class'
import { CommitteeBadge } from '@/components/common/CommitteeBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useAuthStore } from '@/stores/authStore'

import {
  useClassMe,
  useClassMembers,
  useDeleteMemberAccount,
  useSetMemberCommittee,
} from '../hooks/useClass'
import { SetMemberCommitteeDialog } from './SetMemberCommitteeDialog'

/**
 * 成员 tab —— 全班同学网格（头像 + 昵称 + 职务着色徽标）。
 *
 * 右键成员卡片可设置班委：超管任意（含授予「班长」）；本班班长可设/撤
 * 普通班委，但「班长」职务与现任班长只归超管管（后端同规则强制）。
 */
export function MembersTab() {
  const { data: members, isLoading, isError, refetch } = useClassMembers(true)
  const { data: me } = useClassMe()
  const user = useAuthStore((s) => s.user)
  const setCommittee = useSetMemberCommittee()
  const deleteAccount = useDeleteMemberAccount()

  const [editTarget, setEditTarget] = useState<ClassMember | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ClassMember | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ClassMember | null>(null)

  const isSuperAdmin = user?.isSuperAdmin === true
  const isBanzhang = me?.committeeTitle === '班长'
  const canManage = isSuperAdmin || isBanzhang
  // 非超管不能动现任班长（含自己）。
  const canTouch = (m: ClassMember) => canManage && (isSuperAdmin || m.committeeTitle !== '班长')
  // 删除账户：仅超管，且不能删自己（超管账户后端另有保护）。
  const canDelete = (m: ClassMember) => isSuperAdmin && m.sid !== user?.sid

  if (isLoading) return <LoadingSkeleton preset="paragraph" count={2} />
  if (isError || !members) {
    return <ErrorState title="成员加载失败" message="请稍后重试。" onRetry={() => void refetch()} />
  }
  if (!members.length) return <EmptyState icon={Users} title="暂无班级成员" />

  return (
    <>
      {canManage && (
        <p className="m-0 mb-3 text-xs text-text-faint">
          右键成员卡片可设置班委职务{isSuperAdmin ? '（含班长）' : '（「班长」由超管设置）'}。
        </p>
      )}
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {members.map((m) => {
          const card = (
            <li key={m.sid} className="class-item flex items-center gap-3 px-3 py-2.5">
              <Avatar className="size-9">
                {m.avatarThumb && <AvatarImage src={resolveAssetUrl(m.avatarThumb)} alt="" />}
                <AvatarFallback className="text-xs">{m.nickname.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-text">{m.nickname}</span>
                  {m.isClassCommittee && <CommitteeBadge title={m.committeeTitle} />}
                </div>
                <div className="truncate font-mono text-xs text-text-muted">{m.sid}</div>
              </div>
            </li>
          )

          if (!canTouch(m) && !canDelete(m)) return card

          return (
            <ContextMenu key={m.sid}>
              <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
              <ContextMenuContent>
                {canTouch(m) && (
                  <ContextMenuItem className="gap-2" onSelect={() => setEditTarget(m)}>
                    <Star className="size-4" />
                    {m.isClassCommittee ? '修改班委职务' : '设为班委'}
                  </ContextMenuItem>
                )}
                {canTouch(m) && m.isClassCommittee && (
                  <ContextMenuItem
                    className="gap-2 text-cat-research"
                    onSelect={() => setCancelTarget(m)}
                  >
                    <StarOff className="size-4" />
                    取消班委
                  </ContextMenuItem>
                )}
                {canDelete(m) && (
                  <>
                    {canTouch(m) && <ContextMenuSeparator />}
                    <ContextMenuItem
                      className="gap-2 text-cat-research"
                      onSelect={() => setDeleteTarget(m)}
                    >
                      <Trash2 className="size-4" />
                      删除账户
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </ul>

      <SetMemberCommitteeDialog
        member={editTarget}
        open={editTarget != null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null)
        }}
        allowBanzhang={isSuperAdmin}
      />

      {/* 删除账户 —— 硬删，二次确认写明后果。 */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => (!o ? setDeleteTarget(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">
              删除 {deleteTarget?.nickname} 的账户？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将从数据库<strong>永久删除</strong>该账户（{deleteTarget?.sid}
              ），其笔记、资料、上传文件、点名记录与小组关系一并清除；若 TA
              是组长，小组也会随之删除。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteAccount.mutate({
                    sid: deleteTarget.sid,
                    nickname: deleteTarget.nickname,
                  })
                }
                setDeleteTarget(null)
              }}
            >
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelTarget != null}
        onOpenChange={(o) => (!o ? setCancelTarget(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">取消班委？</AlertDialogTitle>
            <AlertDialogDescription>
              将取消 <strong>{cancelTarget?.nickname}</strong>（
              {cancelTarget?.committeeTitle ?? '班委'}）的班委身份，TA
              将无法再发起点名或审批小组申请。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cancelTarget) {
                  setCommittee.mutate({ sid: cancelTarget.sid, isClassCommittee: false })
                }
                setCancelTarget(null)
              }}
            >
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
