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
    const enrollments = await fetchAll((a, b) => sb.from('student_class_enrollments')
      .select('id,roll_number,student_id,class_section_id').in('class_section_id', sectionIds)
      .eq('status', 'ACTIVE').order('roll_number').range(a, b));
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

    const components = await fetchAll((a, b) => sb.from('exam_components')
      .select('id,label,code,max_marks,display_order').eq('examination_id', exam.id)
      .eq('template_code', template.code).order('display_order').range(a, b));
    const firstTermComponents = components.filter((c: any) =>
      ['FT', 'FIRST_TERM', 'TERM_I', 'TERM_1'].includes(String(c.code || '').toUpperCase())
      || /first term|term i|term 1/i.test(String(c.label || '')));
    if (!firstTermComponents.length) {
      return NextResponse.json({ error: 'First Term component was not found for the selected examination.' }, { status: 404 });
    }

    const limits = subjects.length ? await fetchAll((a, b) => sb.from('exam_component_limits')
      .select('class_subject_id,component_id,max_marks,is_applicable')
      .in('class_subject_id', subjects.map((s: any) => s.id)).range(a, b)) : [];
    const applicable = subjects.map((subject: any) => ({
      ...subject,
      components: firstTermComponents.flatMap((component: any) => {
        const limit = limits.find((x: any) => x.class_subject_id === subject.id && x.component_id === component.id);
        if (limit?.is_applicable === false) return [];
        return [{ ...component, max: Number(limit?.max_marks ?? component.max_marks) }];
      }),
    })).filter((subject: any) => subject.components.length);

    const enrollmentIds = enrollments.map((e: any) => e.id);
    const markRows: any[] = [];
    for (const subject of applicable) {
      for (const component of subject.components) {
        for (let i = 0; i < enrollmentIds.length; i += 40) {
          const part = enrollmentIds.slice(i, i + 40);
          if (!part.length) continue;
          markRows.push(...await fetchAll((a, b) => sb.from('marks')
            .select('enrollment_id,class_subject_id,component_id,value,is_absent')
            .eq('examination_id', exam.id).eq('class_subject_id', subject.id)
            .eq('component_id', component.id).in('enrollment_id', part).range(a, b)));
        }
      }
    }

    const subjectColumns = applicable.map((s: any) => s.display_label);
    const rows = enrollments.map((enrollment: any) => {
      const student: any = students.find((s: any) => s.id === enrollment.student_id);
      const section: any = sections.find((s: any) => s.id === enrollment.class_section_id);
      const row: Record<string, any> = {
        'Class': classId,
        'Section': section?.label || '',
        'Roll No.': enrollment.roll_number ?? '',
        'Scholar No.': student?.scholar_number ?? '',
        'Student Name': student?.name ?? '',
      };
      for (const subject of applicable) {
        const marksForSubject = subject.components.map((component: any) => {
          const mark = markRows.find((m: any) => m.enrollment_id === enrollment.id
            && m.class_subject_id === subject.id && m.component_id === component.id);
          if (!mark) return '';
          return mark.is_absent ? 'AB' : (mark.value ?? '');
        });
        row[subject.display_label] = marksForSubject.length === 1
          ? marksForSubject[0]
          : marksForSubject.filter((x: any) => x !== '').join(' / ');
      }
      return row;
    });

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows, { header: ['Class', 'Section', 'Roll No.', 'Scholar No.', 'Student Name', ...subjectColumns] });
    sheet['!cols'] = [
      { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 28 },
      ...subjectColumns.map(() => ({ wch: 16 })),
    ];
    sheet['!autofilter'] = { ref: sheet['!ref'] || 'A1:A1' };
    XLSX.utils.book_append_sheet(workbook, sheet, 'First Term Class Marks');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `SBSSS_Class_${classId}_First_Term_Teacher_Print.xlsx`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('Class teacher first-term export failed:', error);
    return NextResponse.json({ error: 'Could not export the class teacher print sheet. Please try again or contact the administrator.' }, { status: 500 });
  }
}
