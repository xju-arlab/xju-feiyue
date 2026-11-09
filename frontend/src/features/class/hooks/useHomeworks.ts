import { useQuery } from '@tanstack/react-query'
import { listHomeworks, getHomeworkRecords } from '@/api/endpoints/homeworks'
import { useAuthStore } from '@/stores/authStore'

// Keep private submission caches isolated when accounts change in the same browser.
export const homeworkKeys = {
  all: ['class', 'homeworks'] as const,
  list: (sid: string | undefined) => ['class', 'homeworks', sid] as const,
  records: (sid: string | undefined, id: string | null) =>
    ['class', 'homeworks', sid, 'records', id] as const,
}
export function useHomeworks() {
  const sid = useAuthStore((s) => s.user?.sid)
  return useQuery({ queryKey: homeworkKeys.list(sid), queryFn: listHomeworks, staleTime: 30_000 })
}
export function useHomeworkRecords(id: string | null) {
  const sid = useAuthStore((s) => s.user?.sid)
  return useQuery({
    queryKey: homeworkKeys.records(sid, id),
    queryFn: () => getHomeworkRecords(id!),
    enabled: Boolean(id),
    staleTime: 0,
  })
}
