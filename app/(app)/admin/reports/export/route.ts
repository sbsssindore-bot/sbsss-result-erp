import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireAdmin, sessionAndExams } from '@/lib/auth';
import { fetchAll } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { sb } = await requireAdmin();
    const examId = request.nextUrl.searchParams.get('exam') || undefined;
    const classIdRaw = request.nextUrl.searchParams.get('class_id');
    const classId = Number(classIdRaw);
    if (!classIdRaw || !Number.isInteger(classId)) {
      return NextResponse.json({ error: 'Select a valid class first.' }, { status: 400 });
    }
    const { session, exam } = await sessionAndExams(sb, { exam: examId });
    if (!session || !exam) return NextResponse.json({ error: 'No examination is available.' }, { status: 404 });

    const sections = await fetchAll((a, b) => sb.from('class_sections')
      .select('id,label,class_id').eq('session_id', session.id).eq('class_id', classId)
      .eq('status', 'ACTIVE').order('label').range(a, b));
    if (!sections.length) return NextResponse.json({ error: 'No active sections found for this class.' }, { status: 404 });

    const sectionIds = sections.map((s: any) => s.id);
    const allEnrollments = await fetchAll((a, b) => sb.from('student_class_enrollments')
      .select('id,roll_number,student_id,class_section_id').in('class_section_id', sectionIds)
      .eq('status', 'ACTIVE').order('roll_number').range(a, b));
    const selectedEnrollmentIds = request.nextUrl.searchParams.getAll('ids').filter(Boolean);
    const enrollments = selectedEnrollmentIds.length
      ? allEnrollments.filter((e: any) => selectedEnrollmentIds.includes(e.id))
      : allEnrollments;
    if (selectedEnrollmentIds.length && !enrollments.length) {
      return NextResponse.json({ error: 'Select at least one student, or download the whole class without selecting students.' }, { status: 400 });
    }
    const studentIds = [...new Set(enrollments.map((e: any) => e.student_id))];
    const students = studentIds.length
      ? await fetchAll((a, b) => sb.from('students').select('id,name,scholar_number').in('id', studentIds).range(a, b))
      : [];
    const subjects = await fetchAll((a, b) => sb.from('class_subjects')
      .select('id,display_label,display_order').eq('session_id', session.id).eq('class_id', classId)
      .eq('kind', 'MARKS').eq('status', 'ACTIVE').order('display_order').range(a, b));
    const { data: template, error: templateError } = await sb.from('report_card_templates')
      .select('code').lte('min_class', classId).gte('max_class', classId).single();
    if (templateError || !template) return NextResponse.json({ error: 'Report-card template not found for this class.' }, { status: 500 });
    const components = await fetchAll((a, b) => sb.from('exam_components').select('id,label,max_marks,display_order')
      .eq('examination_id', exam.id).eq('template_code', template.code).order('display_order').range(a, b));
    const limits = subjects.length ? await fetchAll((a, b) => sb.from('exam_component_limits')
      .select('class_subject_id,component_id,max_marks,is_applicable').in('class_subject_id', subjects.map((s: any) => s.id)).range(a, b)) : [];
    const applicable = subjects.map((subject: any) => ({
      ...subject,
      components: components.flatMap((component: any) => {
        const limit = limits.find((x: any) => x.class_subject_id === subject.id && x.component_id === component.id);
        if (limit?.is_applicable === false) return [];
        return [{ ...component, max: Number(limit?.max_marks ?? component.max_marks) }];
      }),
    }));
    const enrollmentIds = enrollments.map((e: any) => e.id);
    const markRows: any[] = [];
    for (const subject of applicable) {
      for (let i = 0; i < enrollmentIds.length; i += 40) {
        const part = enrollmentIds.slice(i, i + 40);
        if (!part.length) continue;
        markRows.push(...await fetchAll((a, b) => sb.from('marks')
          .select('enrollment_id,class_subject_id,component_id,value,is_absent')
          .eq('examination_id', exam.id).eq('class_subject_id', subject.id)
          .in('enrollment_id', part).range(a, b)));
      }
    }
    const batches = await fetchAll((a, b) => sb.from('mark_batches')
      .select('class_section_id,class_subject_id,status').eq('examination_id', exam.id)
      .in('class_section_id', sectionIds).range(a, b));
    const rows: any[] = [];
    for (const enrollment of enrollments) {
      const student: any = students.find((s: any) => s.id === enrollment.student_id);
      const section: any = sections.find((s: any) => s.id === enrollment.class_section_id);
      for (const subject of applicable) {
        const batch = batches.find((b: any) => b.class_section_id === enrollment.class_section_id && b.class_subject_id === subject.id);
        for (const component of subject.components) {
          const mark = markRows.find((m: any) => m.enrollment_id === enrollment.id && m.class_subject_id === subject.id && m.component_id === component.id);
          rows.push({
            'Class': classId,
            'Section / Stream': section?.label || '',
            'Roll No.': enrollment.roll_number ?? '',
            'Scholar No.': student?.scholar_number ?? '',
            'Student Name': student?.name ?? '',
            'Examination': exam.name,
            'Subject': subject.display_label,
            'Component': component.label,
            'Maximum Marks': component.max,
            'Marks': mark?.is_absent ? 'AB' : mark?.value ?? '',
            'Batch Status': batch?.status ?? 'NOT STARTED',
          });
        }
      }
    }
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [
      { wch: 9 }, { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 28 }, { wch: 24 },
      { wch: 24 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, 'Marks Backup');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `SBSSS_Class_${classId}_${exam.name.replace(/[^a-z0-9_-]+/gi, '_')}_Backup.xlsx`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('Class marks backup export failed:', error);
    return NextResponse.json({ error: 'Could not export this class backup. Please try again or contact the administrator.' }, { status: 500 });
  }
}
