import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Homework } from '@/api/schemas/homework'
import { HomeworkTab } from './HomeworkTab'
import { validateHomeworkFile } from './helpers'

const api = vi.hoisted(() => ({ list: vi.fn(), upload: vi.fn(), records: vi.fn() }))
vi.mock('@/api/endpoints/homeworks', () => ({
  listHomeworks: api.list,
  uploadHomework: api.upload,
  getHomeworkRecords: api.records,
  createHomework: vi.fn(),
  downloadHomework: vi.fn(),
}))
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ user: { sid: '20241401231', name: '赵文彪' } }),
}))
const expected = '计算机24-3-20241401231-赵文彪'
let items: Homework[]
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <HomeworkTab className="计算机24-3" />
    </QueryClientProvider>,
  )
}
function row(course: string) {
  return screen.getByRole('article', { name: `${course} 实验 1 · 报告` })
}
function choose(course: string, file: File) {
  fireEvent.change(screen.getByLabelText(`${course} 实验 1 · 报告文件`), {
    target: { files: [file] },
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  items = ['操作系统', '数据库原理'].map((course, i) => ({
    id: String(i + 1),
    course,
    experimentNo: 1,
    title: '报告',
    dueAt: '2026-11-12T15:59:00Z',
    namingClass: '计算机24-3',
    namingOrder: 'class-id-name',
    expectedFilename: expected,
    submission: null,
    submittedCount: 0,
    totalCount: 8,
    createdAt: '2026-11-09T00:00:00Z',
  }))
  api.list.mockImplementation(async () => ({ items: structuredClone(items), canManage: false }))
  api.upload.mockImplementation(async (id: string, file: File) => {
    const h = items.find((item) => item.id === id)!
    h.submission = { filename: file.name, size: file.size, submittedAt: '2026-11-10T00:00:00Z' }
    return h.submission
  })
})
afterEach(cleanup)

describe('homework submissions', () => {
  it('keeps pending files scoped to a homework across filters and submission', async () => {
    mount()
    await screen.findByRole('article', { name: '操作系统 实验 1 · 报告' })
    choose('操作系统', new File(['wrong'], '报告.txt'))
    choose('数据库原理', new File(['valid'], `${expected}.txt`))
    fireEvent.change(screen.getByLabelText('筛选课程'), { target: { value: '操作系统' } })
    expect(within(row('操作系统')).getByText('文件名不符合要求')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('筛选课程'), { target: { value: 'all' } })
    fireEvent.click(within(row('数据库原理')).getByRole('button', { name: '确认上传' }))
    await waitFor(() => expect(within(row('数据库原理')).getByText('已提交')).toBeInTheDocument())
    expect(api.upload).toHaveBeenCalledTimes(1)
    expect(api.upload.mock.calls[0]?.[0]).toBe('2')
    expect(within(row('操作系统')).getByText('文件名不符合要求')).toBeInTheDocument()
    expect(within(row('操作系统')).getByText('未提交')).toBeInTheDocument()
  })
  it('routes a file dropped on the row itself and ignores non-file dragging', async () => {
    mount()
    await screen.findByRole('article', { name: '操作系统 实验 1 · 报告' })
    const file = new File(['content'], `${expected}.txt`)
    const transfer = {
      types: ['Files'],
      items: [{ kind: 'file' }],
      files: [file],
      dropEffect: 'none',
    }
    fireEvent.dragEnter(row('数据库原理'), { dataTransfer: transfer })
    expect(row('数据库原理')).toHaveClass('hw-dragover')
    expect(screen.getByRole('status')).toHaveTextContent('将文件拖到对应的作业行')
    fireEvent.drop(row('数据库原理'), { dataTransfer: transfer })
    expect(within(row('数据库原理')).getByText(file.name)).toBeInTheDocument()
    expect(within(row('操作系统')).queryByText(file.name)).not.toBeInTheDocument()
    expect(row('数据库原理')).not.toHaveClass('hw-dragover')
    const textDrag = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(textDrag, 'dataTransfer', { value: { types: ['text/plain'], items: [] } })
    fireEvent(row('操作系统'), textDrag)
    expect(textDrag.defaultPrevented).toBe(false)
    const outsideDrop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(outsideDrop, 'dataTransfer', { value: transfer })
    fireEvent(document, outsideDrop)
    expect(outsideDrop.defaultPrevented).toBe(true)
  })
  it('keeps the existing submission on invalid replacement and allows retry after a network failure', async () => {
    items[0]!.submission = {
      filename: `${expected}.pdf`,
      size: 100,
      submittedAt: '2026-11-09T01:00:00Z',
    }
    api.upload.mockRejectedValueOnce(new Error('网络中断'))
    mount()
    await screen.findByRole('article', { name: '操作系统 实验 1 · 报告' })
    choose('操作系统', new File(['wrong'], '错误.txt'))
    expect(within(row('操作系统')).getByText('已提交')).toBeInTheDocument()
    expect(
      within(row('操作系统')).queryByRole('button', { name: '确认上传' }),
    ).not.toBeInTheDocument()
    choose('操作系统', new File(['new'], `${expected}.txt`))
    fireEvent.click(within(row('操作系统')).getByRole('button', { name: '确认上传' }))
    await within(row('操作系统')).findByText('网络中断')
    expect(within(row('操作系统')).getByText('已提交')).toBeInTheDocument()
    fireEvent.click(within(row('操作系统')).getByRole('button', { name: '重试上传' }))
    await waitFor(() =>
      expect(within(row('操作系统')).queryByText('网络中断')).not.toBeInTheDocument(),
    )
    expect(api.upload).toHaveBeenCalledTimes(2)
    expect(items[0]!.submission?.filename).toBe(`${expected}.txt`)
  })
  it('validates the entire filename stem, limits and supported formats', () => {
    expect(validateHomeworkFile(new File(['x'], `${expected}.PDF`), expected)).toBeNull()
    expect(
      validateHomeworkFile(new File(['x'], '计算机24-3-赵文彪-20241401231.pdf'), expected),
    ).toBe('文件名不符合要求')
    expect(validateHomeworkFile(new File(['x'], `${expected}.html`), expected)).toContain(
      '暂不支持',
    )
    expect(validateHomeworkFile(new File(['x'], expected), expected)).toBe('请保留文件扩展名')
    const oversized = new File(['x'], `${expected}.zip`)
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 })
    expect(validateHomeworkFile(oversized, expected)).toContain('超过 20 MB')
  })
})
