/**
 * Mock dispatch table for dev. Loaded once at app boot via api/index.ts.
 * R3 注册了 auth；R4 home-agent 扩 notes；R4 editor-agent 扩 ai。
 */
import { ApiError, registerMock, type MockReq } from '../client'
import { NoteSchema, type Note, type ListNotesQuery } from '../schemas/note'
import { AIComposeRequestSchema, type AIComposeMode } from '../schemas/ai'
import { computeDiff } from '@/features/editor/ai/diffEngine'
import { periodOf } from '@/features/home/lib/greeting'
import greetingsRaw from '@/features/home/data/greetings.json'
import notesFixture from './notes.json'
// Side-effect imports: registerMock at module load.
import './schools'
import './conferences'
import './classes'
import './homeworks'

// ============== auth ==============

const VALID_SID = '20211010001'
const VALID_PASSWORD = '123456'
const TOKEN_PREFIX = 'mock-jwt-'

const FAKE_USER = {
  id: 'usr_winbeau',
  sid: VALID_SID,
  name: 'winbeau',
  bio: '工程速查 + 深度学习环境配置',
}

registerMock('POST', '/auth/login', async (req: MockReq) => {
  const body = req.body as { sid?: string; password?: string } | undefined
  if (!body || body.sid !== VALID_SID || body.password !== VALID_PASSWORD) {
    throw new ApiError('学号或密码不正确', 401, req.path)
  }
  return {
    user: FAKE_USER,
    token: `${TOKEN_PREFIX}${Date.now()}`,
  }
})

registerMock('POST', '/auth/logout', async () => null)

registerMock('GET', '/auth/me', async (req: MockReq) => {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith(`Bearer ${TOKEN_PREFIX}`)) return null
  return FAKE_USER
})

// ============== notes ==============

// Validate fixtures at load time — fail fast if JSON drifts from schema.
// Mock fixtures pre-date the likedByMe field; inject the default so each row
// still matches NoteSchema without rewriting 994 lines of JSON.
const ALL_NOTES: Note[] = (notesFixture as unknown[]).map((n) =>
  NoteSchema.parse({ likedByMe: false, ...(n as Record<string, unknown>) }),
)

const DEFAULT_LIMIT = 6
const MAX_LIMIT = 50

function parseListQuery(req: MockReq): ListNotesQuery {
  const q: ListNotesQuery = {}
  const cat = req.query.get('cat')
  if (cat) q.cat = cat as ListNotesQuery['cat']
  const text = req.query.get('q')
  if (text) q.q = text
  const sort = req.query.get('sort')
  if (sort === 'latest' || sort === 'hot' || sort === 'liked') q.sort = sort
  const cursor = req.query.get('cursor')
  if (cursor) q.cursor = cursor
  const limitStr = req.query.get('limit')
  if (limitStr) {
    const n = Number(limitStr)
    if (Number.isInteger(n) && n > 0) q.limit = Math.min(n, MAX_LIMIT)
  }
  const tagsStr = req.query.get('tags')
  if (tagsStr) {
    const tags = tagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (tags.length > 0) q.tags = tags
  }
  return q
}

function filterAndSort(query: ListNotesQuery): Note[] {
  let result = ALL_NOTES.slice()
  if (query.cat) {
    result = result.filter((n) => n.category === query.cat)
  }
  if (query.q) {
    const needle = query.q.toLowerCase()
    result = result.filter(
      (n) =>
        n.title.toLowerCase().includes(needle) ||
        n.summary.toLowerCase().includes(needle) ||
        n.tags.some((t) => t.toLowerCase().includes(needle)),
    )
  }
  if (query.tags && query.tags.length > 0) {
    const wanted = new Set(query.tags)
    result = result.filter((n) => n.tags.some((t) => wanted.has(t)))
  }
  if (query.sort === 'hot' || query.sort === 'liked') {
    result.sort((a, b) => b.likes - a.likes)
  } else {
    result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  return result
}

registerMock('GET', '/notes', async (req: MockReq) => {
  const q = parseListQuery(req)
  const list = filterAndSort(q)
  const limit = q.limit ?? DEFAULT_LIMIT
  const startIdx = q.cursor ? list.findIndex((n) => n.id === q.cursor) + 1 : 0
  const items = list.slice(startIdx, startIdx + limit)
  const lastItem = items.at(-1)
  const nextCursor = startIdx + limit < list.length && lastItem ? lastItem.id : null
  return { items, nextCursor }
})

registerMock('GET', '/notes/hot', async () => {
  return ALL_NOTES.slice()
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, 6)
})

registerMock('GET', '/notes/latest', async () => {
  return ALL_NOTES.slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8)
})

registerMock('GET', '/notes/liked', async () => {
  return ALL_NOTES.slice()
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 6)
})

registerMock('GET', '/notes/get', async (req: MockReq) => {
  const id = req.query.get('id')
  const note = ALL_NOTES.find((n) => n.id === id)
  if (!note) throw new ApiError('笔记不存在', 404, req.path)
  return note
})

// ============== AI compose ==============

function transform(
  text: string,
  mode: AIComposeMode,
  options: Record<string, unknown> | undefined,
): string {
  switch (mode) {
    case 'polish': {
      let r = text
      r = r.replace(/我觉得/g, '笔者认为')
      r = r.replace(/(\S)\s+(\S)/g, '$1 $2')
      // 末尾补句号
      if (r.length > 0 && !/[。！？.!?]$/.test(r)) r = `${r}。`
      return r
    }
    case 'shorten': {
      const sentences = text.split(/(?<=[。！？.!?])/).filter(Boolean)
      const half = Math.max(1, Math.ceil(sentences.length / 2))
      return sentences.slice(0, half).join('').trim()
    }
    case 'expand': {
      return `${text}\n\n这一点尤其重要：上面提到的细节往往决定了实验结果的可复现性，建议在下一次开赛前做成 checklist 贴在工位上。`
    }
    case 'tone': {
      const target = (options?.['target'] as string) ?? 'formal'
      if (target === 'formal') {
        return text.replace(/我们/g, '研究者').replace(/我/g, '笔者')
      }
      return text.replace(/笔者/g, '我').replace(/研究者/g, '我们')
    }
    case 'translate': {
      return `[Auto-translated · zh→en mock]\n\n${text}`
    }
    case 'custom': {
      const prompt = (options?.['prompt'] as string) ?? ''
      return `${text}\n\n（按 prompt 修改：${prompt || '未提供 prompt'}）`
    }
    case 'summarize': {
      // Mock mirrors the real prompt: ≤ 35 Chinese chars, one line, no markdown.
      void options
      const stripped = text
        .replace(/[#>*_`\-\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const head = stripped.slice(0, 32)
      return head.length === stripped.length ? head : `${head}…`
    }
  }
}

// ============== uploads ==============

registerMock('POST', '/notes/images', async () => {
  // Mock dev fixture — placekitten lets us see the inserted image in
  // MarkdownPreview without a backend.
  return { url: 'https://placekitten.com/640/360' }
})

// GET /ai/greetings —— dev mock：当前时段 + 通用问候取 3 条不重复（名字用中性假名）。
registerMock('GET', '/ai/greetings', async () => {
  const data = greetingsRaw as Record<string, string[]>
  const arr = data[periodOf(new Date().getHours())] ?? []
  const common = data['通用'] ?? []
  const pool = [...new Set([...arr, ...common])].map((t) =>
    t.replace('{名字}', '同学'),
  )
  return { greetings: pool.slice(0, 3) }
})

registerMock('POST', '/ai/compose', async (req: MockReq) => {
  const parsed = AIComposeRequestSchema.parse(req.body)
  const before = parsed.text
  const after = transform(before, parsed.mode, parsed.options)
  // 模拟 400-1000ms 额外延迟（client 已有 200ms 全局延迟）
  const extra = Math.round(400 + Math.random() * 600)
  await new Promise((r) => setTimeout(r, extra))
  return {
    segments: computeDiff(before, after),
    before,
    after,
    elapsedMs: 200 + extra,
  }
})
