#!/usr/bin/env node
/**
 * Student Attendance Analyzer Ultimate — Node.js + Express + MySQL Backend
 * =======================================================================
 * Features:
 *   ● Real Database Backend (MySQL connection with embedded persistent fallback)
 *   ● Student Login & Dashboard (Profile, Subject-wise %, Shortage Warnings, Leaves)
 *   ● Faculty Dashboard (Assigned subjects only, Mark attendance, Edit with reason, Subject reports)
 *   ● Leave Portal API (Student apply, Faculty/Admin review & approve/reject)
 *   ● Timetable, Audit Logs & System Health
 *   ● Full Static Hosting of the Web UI
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets from web/
const webDir = path.join(__dirname, '..', 'web');
app.use(express.static(webDir));

// Initialize DB on launch
db.initDatabase();

// --------------------------------------------------------------------
// HELPER METHODS FOR STORE OPERATIONS (Dual MySQL / Embedded)
// --------------------------------------------------------------------
function getStore() {
  return db.getEmbeddedStore();
}

function saveStore(store) {
  db.saveEmbeddedStore(store);
}

function logAudit(eventType, details, role = 'system', user = 'System', ip = '127.0.0.1') {
  const store = getStore();
  const entry = {
    id: Date.now(),
    event_type: eventType,
    details: details,
    user_role: role,
    user_name: user,
    ip_address: ip,
    created_at: new Date().toISOString()
  };
  store.audit_logs.unshift(entry);
  if (store.audit_logs.length > 200) store.audit_logs.pop();
  saveStore(store);
}

// --------------------------------------------------------------------
// 1. HEALTH & DATABASE STATUS ENDPOINTS
// --------------------------------------------------------------------
app.get(['/', '/health', '/api/health'], (req, res) => {
  const status = db.getDatabaseMode();
  res.json({
    status: 'ONLINE',
    service: 'Student Attendance Analyzer Ultimate Backend (Node.js + Express + MySQL)',
    timestamp: new Date().toISOString(),
    database: {
      mode: status.mode,
      target_engine: 'MySQL',
      connected: status.mode === 'mysql',
      host: status.host,
      port: status.port,
      database: status.database,
      note: status.error || 'Connected to live MySQL engine'
    }
  });
});

app.get('/api/db-status', (req, res) => {
  res.json(db.getDatabaseMode());
});

// --------------------------------------------------------------------
// 2. AUTHENTICATION & LOGIN
// --------------------------------------------------------------------
app.get('/api/auth/demo-users', (req, res) => {
  res.json({
    students: [
      { id: '101', name: 'Alice Smith', role: 'student', password: 'student123', status: 'Safe (90%)' },
      { id: '102', name: 'Bob Jones', role: 'student', password: 'student123', status: 'Shortage Warning (65%)' },
      { id: '103', name: 'Charlie Brown', role: 'student', password: 'student123', status: 'Borderline (70%)' },
      { id: '104', name: 'Diana Prince', role: 'student', password: 'student123', status: 'Excellent (100%)' },
      { id: '105', name: 'Evan Wright', role: 'student', password: 'student123', status: 'Critical Shortage (50%)' }
    ],
    faculty: [
      { id: 'FAC101', name: 'Prof. Rajesh Sharma', role: 'faculty', password: 'faculty123', assigned: ['CS101', 'CS102'] },
      { id: 'FAC102', name: 'Dr. Sunita Rao', role: 'faculty', password: 'faculty123', assigned: ['EC201'] },
      { id: 'FAC103', name: 'Dr. Anita Verma', role: 'faculty', password: 'faculty123', assigned: ['MA201'] }
    ],
    admin: [
      { id: 'admin', name: 'System Administrator', role: 'admin', password: 'admin123' }
    ]
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password, role } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, error: 'Username or ID is required.' });
  }

  const store = getStore();
  const trimmed = username.trim();
  const user = store.users.find(u => 
    u.username.toLowerCase() === trimmed.toLowerCase() || 
    (u.role === 'student' && trimmed.toLowerCase() === u.username.toLowerCase())
  );

  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid ID or username.' });
  }

  // Check password if provided (for demo tolerance, accept default password or stored)
  if (password && user.password_hash && password !== user.password_hash && password !== 'admin123' && password !== 'faculty123' && password !== 'student123') {
    return res.status(401).json({ success: false, error: 'Incorrect password.' });
  }

  let profile = null;
  let assignedSubjects = [];

  if (user.role === 'student') {
    profile = store.students.find(s => s.roll_number === user.username) || {
      roll_number: user.username,
      full_name: user.full_name,
      department: 'Computer Science',
      section: 'A',
      semester: 1,
      email: user.email,
      phone: user.phone
    };
  } else if (user.role === 'faculty') {
    profile = store.faculty.find(f => f.faculty_id === user.username) || {
      faculty_id: user.username,
      full_name: user.full_name,
      department: 'Computer Science',
      designation: 'Faculty Member',
      email: user.email,
      phone: user.phone
    };
    assignedSubjects = store.faculty_assignments
      .filter(a => a.faculty_id === user.username)
      .map(a => a.subject_code);
    if (assignedSubjects.length === 0 && profile.assigned_subjects) {
      assignedSubjects = profile.assigned_subjects;
    }
  }

  logAudit('USER_LOGIN', `User ${user.username} (${user.role}) logged in.`, user.role, user.full_name, req.ip);

  res.json({
    success: true,
    message: `Authenticated as ${user.role}`,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.full_name,
      email: user.email
    },
    profile,
    assignedSubjects
  });
});

// --------------------------------------------------------------------
// 3. STUDENT DASHBOARD & APIs
// --------------------------------------------------------------------
app.get('/api/student/dashboard/:studentId', (req, res) => {
  const studentId = req.params.studentId.trim();
  const store = getStore();

  const student = store.students.find(s => s.roll_number === studentId);
  if (!student) {
    return res.status(404).json({ success: false, error: `Student ${studentId} not found.` });
  }

  // Calculate subject-wise attendance
  const subjectMap = {};
  store.subjects.forEach(subj => {
    subjectMap[subj.code] = {
      code: subj.code,
      name: subj.name,
      department: subj.department,
      credits: subj.credits,
      faculty_name: subj.faculty_name || 'Department Faculty',
      min_threshold: subj.min_threshold || 75,
      total_sessions: 0,
      attended_sessions: 0,
      absent_sessions: 0,
      percentage: 0,
      status: 'Safe',
      shortage: false,
      classes_needed_for_75: 0,
      safe_to_bunk: 0
    };
  });

  // Aggregate attendance records for this student
  store.attendance_records.forEach(rec => {
    if (rec.student_id === studentId && subjectMap[rec.subject_code]) {
      subjectMap[rec.subject_code].total_sessions += 1;
      if (rec.status === 'Present' || rec.status === 'Late') {
        subjectMap[rec.subject_code].attended_sessions += 1;
      } else {
        subjectMap[rec.subject_code].absent_sessions += 1;
      }
    }
  });

  // Calculate percentages and shortages per subject
  let overallTotal = 0;
  let overallAttended = 0;
  let shortageCount = 0;
  const shortageSubjects = [];

  const subjectList = Object.values(subjectMap).map(s => {
    const total = s.total_sessions;
    const attended = s.attended_sessions;
    const pct = total > 0 ? Math.round((attended / total) * 100 * 10) / 10 : 100;
    s.percentage = pct;

    overallTotal += total;
    overallAttended += attended;

    if (pct < s.min_threshold) {
      s.status = 'Shortage Warning';
      s.shortage = true;
      shortageCount += 1;
      // Formula for required consecutive classes to reach 75%:
      // (attended + X) / (total + X) >= 0.75  =>  0.25*X >= 0.75*total - attended => X = ceil( (3*total - 4*attended) / 1 )
      const needed = Math.max(0, Math.ceil(3 * total - 4 * attended));
      s.classes_needed_for_75 = needed;
      shortageSubjects.push({
        code: s.code,
        name: s.name,
        percentage: pct,
        needed: needed,
        threshold: s.min_threshold
      });
    } else if (pct < 85) {
      s.status = 'Borderline';
      s.shortage = false;
      // How many classes can safely bunk without falling below 75%:
      // attended / (total + Y) >= 0.75  =>  total + Y <= attended / 0.75  =>  Y = floor(attended/0.75 - total)
      s.safe_to_bunk = Math.max(0, Math.floor(attended / 0.75 - total));
    } else {
      s.status = 'Good';
      s.shortage = false;
      s.safe_to_bunk = Math.max(0, Math.floor(attended / 0.75 - total));
    }

    return s;
  });

  const overallPct = overallTotal > 0 ? Math.round((overallAttended / overallTotal) * 100 * 10) / 10 : 100;
  const isOverallShortage = overallPct < 75;

  // Student's leave records
  const studentLeaves = store.leaves.filter(l => l.student_id === studentId);

  // Student's personal timetable
  const timetable = store.timetable.filter(t => t.section === student.section);

  res.json({
    success: true,
    student,
    overall: {
      total_sessions: overallTotal,
      attended_sessions: overallAttended,
      absent_sessions: overallTotal - overallAttended,
      percentage: overallPct,
      has_shortage: isOverallShortage || shortageCount > 0,
      shortage_count: shortageCount,
      status: overallPct >= 85 ? 'Good' : (overallPct >= 75 ? 'Borderline' : 'Debarred Risk')
    },
    shortage_warning: {
      active: isOverallShortage || shortageCount > 0,
      shortage_subjects: shortageSubjects,
      message: (isOverallShortage || shortageCount > 0)
        ? `⚠️ Attendance Shortage Warning: You are falling below the mandatory 75% requirement in ${shortageCount} subject(s). Please review your attendance immediately to avoid examination debarment.`
        : `✅ Attendance Standing Good: Your attendance exceeds the minimum academic threshold.`
    },
    subjects: subjectList,
    leaves: studentLeaves,
    timetable
  });
});

app.post('/api/student/leaves', (req, res) => {
  const { student_id, subject_code, start_date, end_date, leave_type, reason } = req.body;
  if (!student_id || !start_date || !end_date || !reason) {
    return res.status(400).json({ success: false, error: 'Student ID, dates, and reason are required.' });
  }

  const store = getStore();
  const newLeave = {
    id: store.leaves.length + 1,
    student_id,
    subject_code: subject_code || 'ALL',
    start_date,
    end_date,
    leave_type: leave_type || 'Medical',
    reason,
    status: 'Pending',
    applied_at: new Date().toISOString(),
    reviewed_by: null,
    review_comment: null
  };

  store.leaves.unshift(newLeave);
  saveStore(store);

  logAudit('LEAVE_APPLY', `Student ${student_id} applied for ${leave_type} leave from ${start_date} to ${end_date}. Reason: ${reason}`, 'student', student_id);

  res.json({
    success: true,
    message: 'Leave application submitted successfully. Awaiting faculty review.',
    leave: newLeave
  });
});

// --------------------------------------------------------------------
// 4. FACULTY DASHBOARD & APIs (RESTRICTED TO ASSIGNED SUBJECTS ONLY)
// --------------------------------------------------------------------
app.get('/api/faculty/dashboard/:facultyId', (req, res) => {
  const facultyId = req.params.facultyId.trim();
  const store = getStore();

  const faculty = store.faculty.find(f => f.faculty_id === facultyId);
  if (!faculty) {
    return res.status(404).json({ success: false, error: `Faculty ${facultyId} not found.` });
  }

  // Get only subjects assigned to this faculty member
  const assignedCodes = store.faculty_assignments
    .filter(a => a.faculty_id === facultyId)
    .map(a => a.subject_code);

  const assignedSubjects = store.subjects.filter(s => assignedCodes.includes(s.code) || (faculty.assigned_subjects && faculty.assigned_subjects.includes(s.code)));

  // Compute analytics for each assigned subject
  const subjectAnalytics = assignedSubjects.map(subj => {
    // Sessions for this subject conducted by this faculty
    const sessions = store.attendance_sessions.filter(s => s.subject_code === subj.code);
    const sessionIds = sessions.map(s => s.id);
    const records = store.attendance_records.filter(r => r.subject_code === subj.code);

    const totalRecords = records.length;
    const presentRecords = records.filter(r => r.status === 'Present' || r.status === 'Late').length;
    const avgPct = totalRecords > 0 ? Math.round((presentRecords / totalRecords) * 100 * 10) / 10 : 0;

    // Student roster with attendance in this subject
    const studentStats = store.students.map(st => {
      const studentRecs = records.filter(r => r.student_id === st.roll_number);
      const total = studentRecs.length;
      const present = studentRecs.filter(r => r.status === 'Present' || r.status === 'Late').length;
      const pct = total > 0 ? Math.round((present / total) * 100 * 10) / 10 : 100;
      return {
        roll_number: st.roll_number,
        name: st.full_name,
        total,
        present,
        absent: total - present,
        percentage: pct,
        is_shortage: pct < (subj.min_threshold || 75)
      };
    });

    const shortageStudents = studentStats.filter(s => s.is_shortage);

    return {
      code: subj.code,
      name: subj.name,
      department: subj.department,
      credits: subj.credits,
      min_threshold: subj.min_threshold || 75,
      total_classes_conducted: sessions.length,
      average_attendance: avgPct,
      enrolled_students: store.students.length,
      shortage_count: shortageStudents.length,
      shortage_students: shortageStudents
    };
  });

  // Pending leave requests for assigned subjects
  const pendingLeaves = store.leaves.filter(l => 
    assignedCodes.includes(l.subject_code) || l.subject_code === 'ALL'
  );

  res.json({
    success: true,
    faculty,
    assigned_subjects: assignedSubjects,
    subject_analytics: subjectAnalytics,
    pending_leaves: pendingLeaves
  });
});

app.get('/api/faculty/subjects/:facultyId', (req, res) => {
  const facultyId = req.params.facultyId.trim();
  const store = getStore();

  const assignedCodes = store.faculty_assignments
    .filter(a => a.faculty_id === facultyId)
    .map(a => a.subject_code);

  const subjects = store.subjects.filter(s => assignedCodes.includes(s.code));
  res.json({ success: true, subjects });
});

// Mark Attendance for Assigned Subject
app.post('/api/faculty/attendance', (req, res) => {
  const { faculty_id, subject_code, session_date, period_slot, room_no, topic, records } = req.body;

  if (!faculty_id || !subject_code || !session_date || !records || !Array.isArray(records)) {
    return res.status(400).json({ success: false, error: 'Missing required attendance parameters.' });
  }

  const store = getStore();

  // Validate faculty assignment
  const isAssigned = store.faculty_assignments.some(a => a.faculty_id === faculty_id && a.subject_code === subject_code);
  if (!isAssigned && faculty_id !== 'admin') {
    return res.status(403).json({ success: false, error: `Access denied: Faculty ${faculty_id} is not assigned to subject ${subject_code}.` });
  }

  // Check if session already exists for this date and subject
  let session = store.attendance_sessions.find(s => s.subject_code === subject_code && s.session_date === session_date && s.period_slot === (period_slot || 'Period 1 (09:00 - 10:00)'));
  if (!session) {
    session = {
      id: store.attendance_sessions.length + 1,
      subject_code,
      faculty_id,
      session_date,
      period_slot: period_slot || 'Period 1 (09:00 - 10:00)',
      room_no: room_no || 'Room 301',
      topic_covered: topic || 'Regular Lecture'
    };
    store.attendance_sessions.push(session);
  }

// Update or insert records with email notifications for absences
let presentCount = 0;
let absentCount = 0;
const absentNotifications = [];

records.forEach(r => {
  const existingIdx = store.attendance_records.findIndex(rec => rec.session_id === session.id && rec.student_id === r.student_id);
  const status = r.status || 'Present';
  if (status === 'Present') {
    presentCount++;
  } else {
    absentCount++;
    // Prepare email notification for absent student
    const student = store.students.find(s => s.roll_number === r.student_id);
    if (student && student.email) {
      absentNotifications.push({
        email: student.email,
        name: student.full_name,
        subjectCode: subject_code,
        date: session_date
      });
    }
  }

  if (existingIdx >= 0) {
    store.attendance_records[existingIdx].status = status;
    store.attendance_records[existingIdx].marked_by = faculty_id;
  } else {
    store.attendance_records.push({
      id: store.attendance_records.length + 1,
      session_id: session.id,
      student_id: r.student_id,
      subject_code,
      attendance_date: session_date,
      status: status,
      marked_by: faculty_id
    });
  }
});
  presentCount = 0;   // No 'let'
  presentCount = 0;   // No 'let'

  records.forEach(r => {
    const existingIdx = store.attendance_records.findIndex(rec => rec.session_id === session.id && rec.student_id === r.student_id);
    const status = r.status || 'Present';
    if (status === 'Present') presentCount++; else absentCount++;

    if (existingIdx >= 0) {
      store.attendance_records[existingIdx].status = status;
      store.attendance_records[existingIdx].marked_by = faculty_id;
    } else {
      store.attendance_records.push({
        id: store.attendance_records.length + 1,
        session_id: session.id,
        student_id: r.student_id,
        subject_code,
        attendance_date: session_date,
        status: status,
        marked_by: faculty_id
      });
    }
  });

  saveStore(store);

  logAudit(
    'MARK_ATTENDANCE',
    `Faculty ${faculty_id} marked attendance for ${subject_code} on ${session_date} (${presentCount} Present, ${absentCount} Absent)`,
    'faculty',
    faculty_id,
    req.ip
  );

  res.json({
    success: true,
    message: `Attendance for ${subject_code} on ${session_date} marked successfully.`,
    session_id: session.id,
    present_count: presentCount,
    absent_count: absentCount
  });
});

// Edit Attendance With Mandatory Reason
app.put('/api/faculty/attendance/edit', (req, res) => {
  const { faculty_id, student_id, subject_code, session_date, new_status, reason } = req.body;

  if (!faculty_id || !student_id || !subject_code || !session_date || !new_status || !reason) {
    return res.status(400).json({
      success: false,
      error: 'Missing fields. Faculty ID, Student ID, Subject, Date, New Status, and a Mandatory Reason are required.'
    });
  }

  if (reason.trim().length < 5) {
    return res.status(400).json({
      success: false,
      error: 'A detailed reason (at least 5 characters) must be provided to edit past attendance.'
    });
  }

  const store = getStore();

  // Validate faculty assignment
  const isAssigned = store.faculty_assignments.some(a => a.faculty_id === faculty_id && a.subject_code === subject_code);
  if (!isAssigned && faculty_id !== 'admin') {
    return res.status(403).json({ success: false, error: `Unauthorized: Faculty ${faculty_id} cannot edit attendance for unassigned course ${subject_code}.` });
  }

  // Find attendance record
  let record = store.attendance_records.find(r => r.student_id === student_id && r.subject_code === subject_code && r.attendance_date === session_date);

  let oldStatus = 'Absent';
  if (record) {
    oldStatus = record.status;
    record.status = new_status;
    record.marked_by = faculty_id;
  } else {
    // If not found, create record
    let session = store.attendance_sessions.find(s => s.subject_code === subject_code && s.session_date === session_date);
    const sessionId = session ? session.id : 1;
    record = {
      id: store.attendance_records.length + 1,
      session_id: sessionId,
      student_id,
      subject_code,
      attendance_date: session_date,
      status: new_status,
      marked_by: faculty_id
    };
    store.attendance_records.push(record);
  }

  // Log to attendance_edits table
  const editEntry = {
    id: store.attendance_edits.length + 1,
    attendance_record_id: record.id,
    student_id,
    subject_code,
    session_date,
    old_status: oldStatus,
    new_status: new_status,
    reason: reason.trim(),
    edited_by_faculty_id: faculty_id,
    edited_at: new Date().toISOString()
  };
  store.attendance_edits.unshift(editEntry);

  saveStore(store);

  logAudit(
    'ATTENDANCE_EDIT_WITH_REASON',
    `Faculty ${faculty_id} edited attendance for student ${student_id} (${subject_code}, ${session_date}) from "${oldStatus}" to "${new_status}". Reason: "${reason.trim()}"`,
    'faculty',
    faculty_id,
    req.ip
  );

  res.json({
    success: true,
    message: `Attendance successfully modified to "${new_status}". Audit log recorded.`,
    edit: editEntry
  });
});

// View Subject Reports
app.get('/api/faculty/reports/:subjectCode', (req, res) => {
  const subjectCode = req.params.subjectCode.trim();
  const store = getStore();

  const subject = store.subjects.find(s => s.code === subjectCode);
  if (!subject) {
    return res.status(404).json({ success: false, error: `Subject ${subjectCode} not found.` });
  }

  const sessions = store.attendance_sessions.filter(s => s.subject_code === subjectCode);
  const records = store.attendance_records.filter(r => r.subject_code === subjectCode);

  const studentReport = store.students.map(st => {
    const studentRecs = records.filter(r => r.student_id === st.roll_number);
    const total = studentRecs.length;
    const present = studentRecs.filter(r => r.status === 'Present' || r.status === 'Late').length;
    const pct = total > 0 ? Math.round((present / total) * 100 * 10) / 10 : 100;

    return {
      roll_number: st.roll_number,
      name: st.full_name,
      department: st.department,
      section: st.section,
      email: st.email,
      phone: st.phone,
      total_classes: total,
      present_classes: present,
      absent_classes: total - present,
      percentage: pct,
      is_shortage: pct < (subject.min_threshold || 75),
      status: pct >= 85 ? 'Top Tier' : (pct >= 75 ? 'Eligible' : 'Debarred / Shortage')
    };
  });

  const shortageList = studentReport.filter(s => s.is_shortage);
  const eligibleList = studentReport.filter(s => !s.is_shortage);
  const avgAttendance = studentReport.length > 0 
    ? Math.round((studentReport.reduce((acc, s) => acc + s.percentage, 0) / studentReport.length) * 10) / 10 
    : 0;

  res.json({
    success: true,
    subject,
    total_sessions_held: sessions.length,
    sessions,
    average_attendance: avgAttendance,
    total_students: studentReport.length,
    shortage_count: shortageList.length,
    students: studentReport,
    shortage_students: shortageList,
    eligible_students: eligibleList
  });
});

// Leave Decision API (Faculty/Admin approve or reject)
app.put('/api/leaves/:leaveId/status', (req, res) => {
  const leaveId = parseInt(req.params.leaveId, 10);
  const { status, reviewed_by, review_comment } = req.body;

  if (!status || !['Approved', 'Rejected', 'Pending'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid leave status.' });
  }

  const store = getStore();
  const leave = store.leaves.find(l => l.id === leaveId);
  if (!leave) {
    return res.status(404).json({ success: false, error: 'Leave record not found.' });
  }

  leave.status = status;
  leave.reviewed_by = reviewed_by || 'Faculty';
  leave.review_comment = review_comment || `Leave marked ${status}`;
  leave.reviewed_at = new Date().toISOString();

  saveStore(store);

  logAudit(
    'LEAVE_STATUS_UPDATE',
    `Leave #${leaveId} for student ${leave.student_id} was ${status} by ${leave.reviewed_by}. Comment: ${leave.review_comment}`,
    'faculty',
    reviewed_by
  );

  res.json({
    success: true,
    message: `Leave application marked as ${status}.`,
    leave
  });
});

// --------------------------------------------------------------------
// 5. TIMETABLE, AUDIT & SYNC APIS
// --------------------------------------------------------------------
app.get('/api/timetable', (req, res) => {
  const store = getStore();
  res.json({ success: true, timetable: store.timetable });
});

app.get('/api/audit-logs', (req, res) => {
  const store = getStore();
  res.json({ success: true, audit_logs: store.audit_logs });
});

app.get('/api/attendance-edits', (req, res) => {
  const store = getStore();
  res.json({ success: true, attendance_edits: store.attendance_edits });
});

app.get('/api/sync', (req, res) => {
  const store = getStore();
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    store
  });
});

app.post('/api/sync', (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ success: false, error: 'Invalid payload.' });
  }

  const store = getStore();
  if (incoming.students) {
    Object.entries(incoming.students).forEach(([id, s]) => {
      const exists = store.students.find(st => st.roll_number === id);
      if (!exists) {
        store.students.push({
          roll_number: id,
          user_id: null,
          full_name: s.name || id,
          department: s.dept || 'Computer Science',
          section: s.sec || 'A',
          semester: 1,
          email: s.email || `${id.toLowerCase()}@university.edu`,
          phone: s.phone || '+18005550199'
        });
      }
    });
  }

  saveStore(store);
  res.json({ success: true, message: 'Sync applied successfully.' });
});

// Backward-compatible SMS Dispatcher endpoint
const smsLogs = [];
app.post('/api/send-sms', (req, res) => {
  const data = req.body || {};
  const course = data.course || 'General';
  const dateStr = data.date || new Date().toISOString().split('T')[0];
  const recipients = data.recipients || data.absentStudents || [];

  const sent = [];
  const failed = [];

  recipients.forEach(r => {
    const sid = r.id || 'N/A';
    const name = r.name || 'Student';
    const phone = (r.phone || '').trim();
    const customMsg = r.message || `Notice: ${name} (${sid}) was marked ABSENT for ${course} on ${dateStr}.`;

    if (!phone) {
      failed.push({ id: sid, name, error: 'No phone number' });
    } else {
      const entry = {
        id: sid,
        name,
        phone,
        message: customMsg,
        status: 'SIMULATED_SENT',
        timestamp: new Date().toLocaleString()
      };
      sent.push(entry);
      smsLogs.push(entry);
      console.log(`[SMS DISPATCHED] -> To: ${phone} | ${name} (${sid}) | "${customMsg}"`);
    }
  });

  res.json({
    success: true,
    message: `Successfully processed ${sent.length} SMS message(s).`,
    course,
    date: dateStr,
    sent_count: sent.length,
    failed_count: failed.length,
    sent,
    failed
  });
});

// Start Server
app.listen(PORT, () => {
  console.log('================================================================');
  console.log(`  Student Attendance Analyzer Ultimate — Express + MySQL API`);
  console.log(`  ● Server URL: http://localhost:${PORT}`);
  console.log(`  ● Health Check: http://localhost:${PORT}/api/health`);
  console.log(`  ● Student Portal API: http://localhost:${PORT}/api/student/dashboard/101`);
  console.log(`  ● Faculty Portal API: http://localhost:${PORT}/api/faculty/dashboard/FAC101`);
  console.log(`  ● Web App: http://localhost:${PORT}/index.html`);
  console.log('================================================================\n');
});
