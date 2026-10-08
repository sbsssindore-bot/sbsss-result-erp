/** Sample files use the same headings the importer expects. Optional columns may be left empty. */
export const TEMPLATES = {
  students: { name: 'students_import_template',
    head: ['Scholar Number', 'Roll Number', 'Student Name', "Father's Name", "Mother's Name", 'Date of Birth', 'Gender', 'Class', 'Section', 'Stream', 'Admission Number', 'Mobile', 'Address', 'Academic Session'],
    rows: [['2026001', 1, 'Aarav Sharma', 'Rajesh Sharma', 'Sunita Sharma', '2015-04-12', 'M', 'VI', 'A', '', 'ADM1001', '9800000000', 'Indore', '2026-27'],
           ['2026002', 2, 'Diya Verma', 'Anil Verma', 'Meena Verma', '2014-09-03', 'F', '6', 'A', '', 'ADM1002', '9800000001', 'Indore', '2026-27'],
           ['2026003', 1, 'Ishita Mishra', 'Deepak Mishra', 'Rekha Mishra', '2014-02-18', 'F', 'Class VI', 'B', '', 'ADM1003', '9800000002', 'Indore', '2026-27'],
           ['2026004', 1, 'Kavya Joshi', 'Sanjay Joshi', 'Pooja Joshi', '2009-01-20', 'F', 'XI', '', 'Science', 'ADM1004', '9800000003', 'Indore', '2026-27']] },
  teachers: { name: 'teachers_import_template',
    head: ['Teacher ID', 'Teacher Name', 'Mobile', 'Email', 'Designation', 'Department', 'Login ID', 'Academic Session', 'Status'],
    rows: [['T001', 'Neha Verma', '9800000002', 'neha@example.com', 'PGT', 'Mathematics', 'neha.verma', '2026-27', 'Active'],
           ['T002', 'Rahul Sharma', '9800000003', 'rahul@example.com', 'TGT', 'English', 'rahul.sharma', '2026-27', 'Active'],
           ['T003', 'Old Teacher', '', '', 'PRT', '', '', '2026-27', 'Inactive']] },
  assignments: { name: 'teacher_assignments_import_template',
    head: ['Teacher ID', 'Academic Session', 'Class', 'Section', 'Subject', 'Stream', 'Role'],
    rows: [['T001', '2026-27', 'VI', 'A', 'Mathematics', '', ''],
           ['T001', '2026-27', 'VI', 'B', 'Mathematics', '', ''],
           ['T002', '2026-27', 'VI', 'A', 'English', '', ''],
           ['T002', '2026-27', 'VI', 'A', '', '', 'Class Teacher'],
           ['T001', '2026-27', 'XI', '', 'Physics', 'Science', '']] },
} as const;

