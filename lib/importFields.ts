/** Field definitions for the three imports. No heavy imports here, so the browser can use it too. */
export type Kind = 'STUDENTS' | 'TEACHERS' | 'ASSIGNMENTS';
export type FieldDef = { key: string; label: string; required: boolean; aliases: string[]; hint?: string };

export const FIELDS: Record<Kind, FieldDef[]> = {
  STUDENTS: [
    { key: 'scholar_number', label: 'Scholar Number', required: true, aliases: ['scholarnumber', 'scholarno', 'scholar', 'scholarnum', 'scno', 'scholarid'] },
    { key: 'name', label: 'Student Name', required: true, aliases: ['studentname', 'name', 'nameofstudent', 'student', 'fullname', 'nameofthestudent'] },
    { key: 'class', label: 'Class', required: true, aliases: ['class', 'classname', 'std', 'standard', 'grade', 'cls', 'classstd'] },
    { key: 'section', label: 'Section', required: false, aliases: ['section', 'sec', 'division', 'sectionname'], hint: 'or Stream for XI–XII' },
    { key: 'stream', label: 'Stream', required: false, aliases: ['stream', 'group'] },
    { key: 'roll_number', label: 'Roll Number', required: false, aliases: ['rollnumber', 'rollno', 'roll', 'rollnum'] },
    { key: 'father_name', label: "Father's Name", required: false, aliases: ['fathername', 'fathersname', 'father', 'nameoffather'] },
    { key: 'mother_name', label: "Mother's Name", required: false, aliases: ['mothername', 'mothersname', 'mother', 'nameofmother'] },
    { key: 'dob', label: 'Date of Birth', required: false, aliases: ['dob', 'dateofbirth', 'birthdate', 'birthday'] },
    { key: 'gender', label: 'Gender', required: false, aliases: ['gender', 'sex'] },
    { key: 'admission_number', label: 'Admission Number', required: false, aliases: ['admissionnumber', 'admissionno', 'admno', 'admission'] },
    { key: 'student_code', label: 'Student ID', required: false, aliases: ['studentid', 'studentcode', 'stuid'] },
    { key: 'mobile', label: 'Mobile', required: false, aliases: ['mobile', 'mobileno', 'mobilenumber', 'contact', 'contactnumber', 'contactno', 'phone', 'phoneno'] },
    { key: 'address', label: 'Address', required: false, aliases: ['address', 'residence'] },
    { key: 'academic_session', label: 'Academic Session', required: false, aliases: ['academicsession', 'session', 'year', 'academicyear'], hint: 'blank = active session' },
  ],
  TEACHERS: [
    { key: 'employee_id', label: 'Teacher ID', required: true, aliases: ['teacherid', 'employeeid', 'empid', 'employeecode', 'empcode', 'staffid', 'teachercode'] },
    { key: 'name', label: 'Teacher Name', required: true, aliases: ['teachername', 'name', 'nameofteacher', 'employeename', 'staffname'] },
    { key: 'mobile', label: 'Mobile', required: false, aliases: ['mobile', 'mobileno', 'mobilenumber', 'phone', 'contact', 'contactnumber'] },
    { key: 'email', label: 'Email', required: false, aliases: ['email', 'emailid', 'mail', 'emailaddress'], hint: 'needed to send a login invitation' },
    { key: 'designation', label: 'Designation', required: false, aliases: ['designation', 'post', 'position'] },
    { key: 'department', label: 'Department', required: false, aliases: ['department', 'dept'] },
    { key: 'login_id', label: 'Login ID / Username', required: false, aliases: ['loginid', 'username', 'userid', 'login', 'loginusername', 'loginidusername', 'usernameloginid'] },
    { key: 'academic_session', label: 'Academic Session', required: false, aliases: ['academicsession', 'session', 'year'], hint: 'checked only; teachers are stored once' },
    { key: 'status', label: 'Active / Inactive', required: false, aliases: ['status', 'activeinactive', 'active', 'isactive'] },
  ],
  ASSIGNMENTS: [
    { key: 'employee_id', label: 'Teacher ID', required: true, aliases: ['teacherid', 'employeeid', 'empid', 'employeecode', 'empcode', 'staffid', 'teachercode'] },
    { key: 'academic_session', label: 'Academic Session', required: true, aliases: ['academicsession', 'session', 'year', 'academicyear'] },
    { key: 'class', label: 'Class', required: true, aliases: ['class', 'classname', 'std', 'standard', 'grade', 'cls', 'assignedclass'] },
    { key: 'section', label: 'Section', required: true, aliases: ['section', 'sec', 'division', 'sectionname', 'assignedsection'], hint: 'blank only for XI–XII with a stream' },
    { key: 'subject', label: 'Subject', required: true, aliases: ['subject', 'subjectname', 'assignedsubject'], hint: 'blank only for class teacher rows' },
    { key: 'stream', label: 'Stream (XI–XII)', required: false, aliases: ['stream', 'group'] },
    { key: 'role', label: 'Role (Subject / Class Teacher)', required: false, aliases: ['role', 'assignmenttype', 'type', 'teacherrole'] },
  ],
};
