import { z } from 'zod'

export const NamingOrderSchema = z.enum(['class-id-name', 'class-name-id'])
export const HomeworkSubmissionSchema = z.object({
  filename: z.string(),
  size: z.number().int().nonnegative(),
  submittedAt: z.string().datetime({ offset: true }),
})
export const HomeworkSchema = z.object({
  id: z.string(),
  course: z.string(),
  experimentNo: z.number().int(),
  title: z.string(),
  dueAt: z.string().datetime({ offset: true }),
  namingClass: z.string(),
  namingOrder: NamingOrderSchema,
  expectedFilename: z.string(),
  submission: HomeworkSubmissionSchema.nullable(),
  submittedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
})
export const HomeworkListSchema = z.object({
  items: z.array(HomeworkSchema),
  canManage: z.boolean(),
})
export const HomeworkRecordsSchema = z.object({
  homework: HomeworkSchema,
  records: z.array(
    z.object({
      sid: z.string(),
      name: z.string(),
      filename: z.string().nullable(),
      size: z.number().nullable(),
      submittedAt: z.string().datetime({ offset: true }).nullable(),
    }),
  ),
})
export type Homework = z.infer<typeof HomeworkSchema>
export type HomeworkSubmission = z.infer<typeof HomeworkSubmissionSchema>
export type HomeworkCreateIn = {
  course: string
  experimentNo: number
  title: string
  dueAt: string
  namingClass: string
  namingOrder: z.infer<typeof NamingOrderSchema>
}
