import { Check, Circle } from 'lucide-react'

export function CourseTag({ course }: { course: string }) {
  const tone = [...course].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3
  return (
    <span className={`hw-tag hw-course hw-course-${tone}`} title={course}>
      {course}
    </span>
  )
}
export function SubmissionTag({ submitted }: { submitted: boolean }) {
  return (
    <span className={`hw-tag ${submitted ? 'hw-submitted' : 'hw-waiting'}`}>
      {submitted ? <Check size={11} aria-hidden /> : <Circle size={9} aria-hidden />}
      {submitted ? '已提交' : '未提交'}
    </span>
  )
}
