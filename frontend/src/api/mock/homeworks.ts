import { ApiError, registerMock } from '../client'
import type { Homework, HomeworkCreateIn } from '../schemas/homework'

const sid = '20211010001'
const name = '测试同学'
const members = [
  { sid, name },
  { sid: '20211010002', name: '张三' },
  { sid: '20211010003', name: '李四' },
]
const now = () => new Date().toISOString()
const expected = (h: HomeworkCreateIn, member = members[0]!) =>
  (h.namingOrder === 'class-id-name'
    ? [h.namingClass, member.sid, member.name]
    : [h.namingClass, member.name, member.sid]
  ).join('-')
const items: Homework[] = ['操作系统', '数据库原理', '计算机网络'].map((course, i) => ({
  id: `hw_${i + 1}`,
  course,
  experimentNo: i === 1 ? 2 : 1,
  title: ['进程调度', 'SQL 查询', ''][i]!,
  dueAt: new Date(Date.now() + (i + 3) * 86400000).toISOString(),
  namingClass: '计算机24-3',
  namingOrder: 'class-id-name',
  expectedFilename: `计算机24-3-${sid}-${name}`,
  submission: null,
  submittedCount: 0,
  totalCount: members.length,
  createdAt: now(),
}))
const base = '/classes/me/homeworks'
registerMock('GET', base, async () => ({ items, canManage: true }))
registerMock('POST', base, async (req) => {
  const body = req.body as HomeworkCreateIn
  const h: Homework = {
    ...body,
    id: crypto.randomUUID(),
    expectedFilename: expected(body),
    submission: null,
    submittedCount: 0,
    totalCount: members.length,
    createdAt: now(),
  }
  items.unshift(h)
  return h
})
registerMock('GET', `${base}/:id/submissions`, async (req) => {
  const h = items.find((item) => item.id === req.path.split('/')[4])
  if (!h) throw new ApiError('作业不存在', 404, req.path)
  return {
    homework: h,
    records: members.map((member) => ({
      ...member,
      filename: member.sid === sid ? (h.submission?.filename ?? null) : null,
      size: member.sid === sid ? (h.submission?.size ?? null) : null,
      submittedAt: member.sid === sid ? (h.submission?.submittedAt ?? null) : null,
    })),
  }
})
registerMock('PUT', `${base}/:id/submission`, async (req) => {
  const h = items.find((item) => item.id === req.path.split('/')[4])
  if (!h) throw new ApiError('作业不存在', 404, req.path)
  const file = (req.body as FormData).get('file') as File | null
  if (
    !file ||
    file.name.slice(0, file.name.lastIndexOf('.')).normalize('NFC') !==
      h.expectedFilename.normalize('NFC')
  )
    throw new ApiError('文件名不符合要求', 400, req.path)
  h.submission = { filename: file.name, size: file.size, submittedAt: now() }
  h.submittedCount = 1
  return h.submission
})
