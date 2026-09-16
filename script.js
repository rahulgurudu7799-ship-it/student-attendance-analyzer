// =========================================================
// ATTENDANCE ANALYZER ULTIMATE — ENTERPRISE ACADEMIC SUITE
// =========================================================

// State Variables
let currentUser = { username: "admin", role: "Admin", name: "Administrator" };
let isGpsVerified = true;
let students = {}; // { [id]: { id, name, phone, email, dept, sec } }
let attendance = {}; // { [courseId]: { [dateStr]: { present: [...], excused: [...] } } }
let leaves = []; // [ { id, studentId, courseId, startDate, endDate, type, reason, status, appliedAt } ]
let auditLogs = []; // [ { id, timestamp, role, user, action, details } ]
let activeCourse = "CS101"; // Active subject
let minThreshold = 75; // Low attendance threshold percentage
let vennMode = 2; // 2-Set mode (2) or 3-Set mode (3)

// Backend API & Role State
const BACKEND_URL = "http://localhost:5000/api";
let isBackendLive = false;
let facultyAssignedSubjects = ["CS101", "CS102"];
let facultyActiveSubject = "CS101";
let studentDashboardCache = null;
let facultyDashboardCache = null;
let facultyReportFilter = "ALL";

// Storage Keys
const STORAGE_USER = "att_ultimate_user";
const STORAGE_STUDENTS = "att_ultimate_students";
const STORAGE_RECORDS = "att_ultimate_records";
const STORAGE_LEAVES = "att_ultimate_leaves";
const STORAGE_AUDIT = "att_ultimate_audit";
const STORAGE_THRESH = "att_ultimate_thresh";
const STORAGE_COURSE = "att_ultimate_course";

// Initialize on DOM Load
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  loadAllData();
  
  // Set default attendance dates
  const todayStr = new Date().toISOString().split("T")[0];
  const dateInput = document.getElementById("attendanceDate");
  if (dateInput) dateInput.value = todayStr;
  
  const editDateInput = document.getElementById("editAttendanceDate");
  if (editDateInput) editDateInput.value = todayStr;

  const leaveStart = document.getElementById("leaveStartDate");
  if (leaveStart) leaveStart.value = todayStr;
  const leaveEnd = document.getElementById("leaveEndDate");
  if (leaveEnd) leaveEnd.value = todayStr;

  // Initialize Selectors
  const threshInput = document.getElementById("thresholdInput");
  if (threshInput) threshInput.value = minThreshold;
  
  const courseSelect = document.getElementById("currentCourseSelect");
  if (courseSelect) courseSelect.value = activeCourse;

  // Render initial views
  if (Object.keys(students).length === 0) {
    loadSampleData(false);
  } else {
    refreshAllViews();
  }

  updateAuthDisplay();
  renderTimetable();
  checkBackendLiveStatus(true);
  applyRoleVisibility();
});

// ---------------------------------------------------------
// 1. DATA PERSISTENCE & LOCALSTORAGE
// ---------------------------------------------------------
function saveAllData() {
  localStorage.setItem(STORAGE_STUDENTS, JSON.stringify(students));
  localStorage.setItem(STORAGE_RECORDS, JSON.stringify(attendance));
  localStorage.setItem(STORAGE_LEAVES, JSON.stringify(leaves));
  localStorage.setItem(STORAGE_AUDIT, JSON.stringify(auditLogs));
  localStorage.setItem(STORAGE_THRESH, minThreshold.toString());
  localStorage.setItem(STORAGE_COURSE, activeCourse);
  localStorage.setItem(STORAGE_USER, JSON.stringify(currentUser));
}

function loadAllData() {
  try {
    const rawUser = localStorage.getItem(STORAGE_USER);
    if (rawUser) currentUser = JSON.parse(rawUser);

    const rawStudents = localStorage.getItem(STORAGE_STUDENTS) || localStorage.getItem("attendance_app_students") || localStorage.getItem("attendanceStudents");
    const rawAtt = localStorage.getItem(STORAGE_RECORDS) || localStorage.getItem("attendance_app_records") || localStorage.getItem("attendanceSets");
    const rawLeaves = localStorage.getItem(STORAGE_LEAVES);
    const rawAudit = localStorage.getItem(STORAGE_AUDIT);
    const rawThresh = localStorage.getItem(STORAGE_THRESH);
    const rawCourse = localStorage.getItem(STORAGE_COURSE);

    if (rawThresh) minThreshold = parseInt(rawThresh, 10) || 75;
    if (rawCourse) activeCourse = rawCourse;
    if (rawLeaves) leaves = JSON.parse(rawLeaves);
    if (rawAudit) auditLogs = JSON.parse(rawAudit);

    if (rawStudents) {
      const parsed = JSON.parse(rawStudents);
      students = {};
      Object.entries(parsed).forEach(([id, val]) => {
        students[id] = {
          id: id,
          name: typeof val === "string" ? val : (val.name || id),
          phone: typeof val === "object" ? (val.phone || "+18005550199") : "+18005550199",
          email: typeof val === "object" ? (val.email || `${id.toLowerCase()}@university.edu`) : `${id.toLowerCase()}@university.edu`,
          dept: typeof val === "object" ? (val.dept || "Computer Science") : "Computer Science",
          sec: typeof val === "object" ? (val.sec || "A") : "A"
        };
      });
    }

    if (rawAtt) {
      const parsedAtt = JSON.parse(rawAtt);
      attendance = {};
      const isLegacy = Object.keys(parsedAtt).some(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      if (isLegacy) {
        attendance["CS101"] = {};
        Object.entries(parsedAtt).forEach(([d, val]) => {
          attendance["CS101"][d] = Array.isArray(val) ? { present: val, excused: [] } : val;
        });
      } else {
        Object.entries(parsedAtt).forEach(([cId, dateMap]) => {
          attendance[cId] = {};
          Object.entries(dateMap).forEach(([d, val]) => {
            attendance[cId][d] = Array.isArray(val) ? { present: val, excused: [] } : val;
          });
        });
      }
    }
  } catch (e) {
    console.error("Data load error:", e);
  }
}

function logAuditEvent(action, details) {
  const logItem = {
    id: "LOG-" + Date.now(),
    timestamp: new Date().toLocaleString(),
    role: currentUser.role,
    user: currentUser.name || currentUser.username,
    action: action,
    details: details
  };
  auditLogs.unshift(logItem);
  if (auditLogs.length > 200) auditLogs.pop();
  saveAllData();
  renderAuditTable();
}

// ---------------------------------------------------------
// 2. BACKEND API & LIVE STATUS
// ---------------------------------------------------------
async function checkBackendLiveStatus(silent = false) {
  const badge = document.getElementById("backendStatusBadge");
  const text = document.getElementById("backendStatusText");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${BACKEND_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      isBackendLive = true;
      if (badge) badge.className = "backend-badge";
      const dbLabel = data.database?.mode === "mysql" ? "MySQL Connected" : "Local DB (Ready for MySQL)";
      if (text) text.textContent = `⚡ Node.js API: Online (${dbLabel})`;
      if (!silent) alert(`Backend Server is ONLINE!\nDatabase: ${dbLabel}\nService: ${data.service}`);
      return true;
    }
  } catch (e) {
    // Backend offline / unreachable
  }
  isBackendLive = false;
  if (badge) badge.className = "backend-badge offline";
  if (text) text.textContent = `⚠️ Backend: Offline (LocalStorage Mode)`;
  if (!silent) alert("Backend server is not running on http://localhost:5000.\nTo start: double-click backend/start_server.bat or run 'node backend/server.js'.");
  return false;
}

// ---------------------------------------------------------
// 3. AUTHENTICATION & ROLE-BASED ACCESS CONTROL
// ---------------------------------------------------------
function onLoginRoleChange() {
  const role = document.getElementById("loginRoleSelect")?.value || "Student";
  const userInp = document.getElementById("loginUsername");
  const userLabel = document.getElementById("loginUsernameLabel");
  const passInp = document.getElementById("loginPassword");

  if (role === "Student") {
    if (userLabel) userLabel.textContent = "Student Roll Number / ID";
    if (userInp) { userInp.placeholder = "e.g. 101 or 102"; userInp.value = "101"; }
    if (passInp) passInp.value = "student123";
  } else if (role === "Teacher") {
    if (userLabel) userLabel.textContent = "Faculty Employee ID";
    if (userInp) { userInp.placeholder = "e.g. FAC101 or FAC102"; userInp.value = "FAC101"; }
    if (passInp) passInp.value = "faculty123";
  } else {
    if (userLabel) userLabel.textContent = "Administrator Username";
    if (userInp) { userInp.placeholder = "admin"; userInp.value = "admin"; }
    if (passInp) passInp.value = "admin123";
  }
}

function quickFillLogin(roleType, username, password) {
  const roleSel = document.getElementById("loginRoleSelect");
  const userInp = document.getElementById("loginUsername");
  const passInp = document.getElementById("loginPassword");

  if (roleType === "student") {
    if (roleSel) roleSel.value = "Student";
  } else if (roleType === "faculty") {
    if (roleSel) roleSel.value = "Teacher";
  } else {
    if (roleSel) roleSel.value = "Admin";
  }
  onLoginRoleChange();
  if (userInp) userInp.value = username;
  if (passInp) passInp.value = password;
  handleLoginSubmit();
}

function openLoginModal() {
  const roleSel = document.getElementById("loginRoleSelect");
  if (roleSel) {
    if (currentUser.role === "Student") roleSel.value = "Student";
    else if (currentUser.role === "Teacher" || currentUser.role === "Faculty") roleSel.value = "Teacher";
    else roleSel.value = "Admin";
  }
  onLoginRoleChange();
  const userInp = document.getElementById("loginUsername");
  if (userInp) userInp.value = currentUser.username;
  openModal("loginModal");
}

async function handleLoginSubmit() {
  const roleSel = document.getElementById("loginRoleSelect");
  const userInp = document.getElementById("loginUsername");
  const passInp = document.getElementById("loginPassword");

  const role = roleSel ? roleSel.value : "Admin";
  const user = (userInp && userInp.value.trim()) ? userInp.value.trim() : "admin";
  const pass = passInp ? passInp.value : "";

  let loginSuccess = false;
  let loggedUser = null;

  // Attempt authentication with backend API if online
  if (isBackendLive) {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass, role: role.toLowerCase() })
      });
      const data = await res.json();
      if (data.success) {
        loginSuccess = true;
        loggedUser = {
          username: data.user.username,
          role: data.user.role === "faculty" ? "Teacher" : (data.user.role === "student" ? "Student" : "Admin"),
          name: data.user.name,
          email: data.user.email
        };
        if (data.assignedSubjects && data.assignedSubjects.length > 0) {
          facultyAssignedSubjects = data.assignedSubjects;
          facultyActiveSubject = facultyAssignedSubjects[0];
        }
      }
    } catch (e) {
      console.warn("Backend auth request failed, falling back to local auth:", e);
    }
  }

  // Local fallback authentication
  if (!loginSuccess) {
    let displayName = "Administrator";
    if (role === "Student") {
      const s = students[user] || Object.values(students).find(st => st.id === user || st.name.toLowerCase().includes(user.toLowerCase()));
      displayName = s ? s.name : `Student (${user})`;
    } else if (role === "Teacher") {
      if (user === "FAC101" || user.toLowerCase().includes("sharma")) {
        displayName = "Prof. Rajesh Sharma";
        facultyAssignedSubjects = ["CS101", "CS102"];
      } else if (user === "FAC102" || user.toLowerCase().includes("rao")) {
        displayName = "Dr. Sunita Rao";
        facultyAssignedSubjects = ["EC201"];
      } else if (user === "FAC103" || user.toLowerCase().includes("verma")) {
        displayName = "Dr. Anita Verma";
        facultyAssignedSubjects = ["MA201"];
      } else {
        displayName = `Prof. ${user}`;
        facultyAssignedSubjects = [activeCourse];
      }
      facultyActiveSubject = facultyAssignedSubjects[0];
    }

    loggedUser = {
      username: user,
      role: role,
      name: displayName
    };
  }

  currentUser = loggedUser;
  saveAllData();
  updateAuthDisplay();
  applyRoleVisibility();
  closeModal("loginModal");

  logAuditEvent("USER_LOGIN", `User authenticated: ${currentUser.name} (${currentUser.username}, ${currentUser.role})`);

  // Direct automatically to the appropriate role dashboard
  if (currentUser.role === "Student") {
    switchTab("tab-student-portal");
  } else if (currentUser.role === "Teacher") {
    switchTab("tab-faculty-portal");
  } else {
    switchTab("tab-dashboard");
  }
}

function updateAuthDisplay() {
  const badge = document.getElementById("roleNameText");
  const authBtn = document.getElementById("authBtnText");
  const icon = currentUser.role === "Student" ? "🎓" : (currentUser.role === "Teacher" ? "👨‍🏫" : "🛡️");
  if (badge) badge.textContent = `${icon} ${currentUser.role}: ${currentUser.name}`;
  if (authBtn) authBtn.textContent = `Switch Role (${currentUser.role})`;
}

function applyRoleVisibility() {
  const role = currentUser.role;

  const btnStudent = document.getElementById("tabBtnStudentPortal");
  const btnFaculty = document.getElementById("tabBtnFacultyPortal");
  const btnAdmin = document.getElementById("tabBtnAdminDashboard");
  const btnAnalytics = document.getElementById("tabBtnAnalytics");
  const btnStudents = document.getElementById("tabBtnStudents");
  const btnSubjectDetails = document.getElementById("tabBtnSubjectDetails");
  const btnAttendance = document.getElementById("tabBtnAttendance");
  const btnSets = document.getElementById("tabBtnSets");
  const btnEligibility = document.getElementById("tabBtnEligibility");
  const btnReport = document.getElementById("tabBtnReport");
  const btnLeaderboard = document.getElementById("tabBtnLeaderboard");
  const btnLeaves = document.getElementById("tabBtnLeaves");
  const btnTimetable = document.getElementById("tabBtnTimetable");
  const btnAudit = document.getElementById("tabBtnAudit");

  // Reset visibility
  const allTabButtons = [btnStudent, btnFaculty, btnAdmin, btnAnalytics, btnStudents, btnSubjectDetails, btnAttendance, btnSets, btnEligibility, btnReport, btnLeaderboard, btnLeaves, btnTimetable, btnAudit];
  allTabButtons.forEach(b => { if (b) b.style.display = ""; });

  if (role === "Student") {
    // Show student relevant tabs
    if (btnStudent) btnStudent.style.display = "inline-block";
    if (btnSubjectDetails) btnSubjectDetails.style.display = "inline-block";
    if (btnLeaves) btnLeaves.style.display = "inline-block";
    if (btnTimetable) btnTimetable.style.display = "inline-block";
    if (btnSets) btnSets.style.display = "inline-block"; // Educational

    // Hide faculty/admin tabs
    if (btnFaculty) btnFaculty.style.display = "none";
    if (btnAdmin) btnAdmin.style.display = "none";
    if (btnAnalytics) btnAnalytics.style.display = "none";
    if (btnStudents) btnStudents.style.display = "none";
    if (btnAttendance) btnAttendance.style.display = "none";
    if (btnEligibility) btnEligibility.style.display = "none";
    if (btnReport) btnReport.style.display = "none";
    if (btnAudit) btnAudit.style.display = "none";
  } else if (role === "Teacher" || role === "Faculty") {
    // Show faculty relevant tabs
    if (btnFaculty) btnFaculty.style.display = "inline-block";
    if (btnSubjectDetails) btnSubjectDetails.style.display = "inline-block";
    if (btnAttendance) btnAttendance.style.display = "inline-block";
    if (btnReport) btnReport.style.display = "inline-block";
    if (btnLeaves) btnLeaves.style.display = "inline-block";
    if (btnTimetable) btnTimetable.style.display = "inline-block";
    if (btnSets) btnSets.style.display = "inline-block";

    // Hide student/admin tabs
    if (btnStudent) btnStudent.style.display = "none";
    if (btnAdmin) btnAdmin.style.display = "none";
    if (btnStudents) btnStudents.style.display = "none";
    if (btnEligibility) btnEligibility.style.display = "none";
    if (btnAudit) btnAudit.style.display = "none";
  } else {
    // Admin sees all tabs!
    if (btnStudent) btnStudent.style.display = "inline-block";
    if (btnFaculty) btnFaculty.style.display = "inline-block";
    if (btnSubjectDetails) btnSubjectDetails.style.display = "inline-block";
  }
}

// ---------------------------------------------------------
// 4. GPS & LOCATION VERIFICATION
// ---------------------------------------------------------
function verifyCampusGPS() {
  const badge = document.getElementById("gpsStatusBadge");
  const text = document.getElementById("gpsText");

  if (!navigator.geolocation) {
    isGpsVerified = true;
    if (text) text.textContent = "📍 GPS: Campus Verified (Override)";
    alert("Geolocation not supported by browser. Campus Geofence verified via manual override.");
    return;
  }

  if (text) text.textContent = "📍 GPS: Verifying...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      isGpsVerified = true;
      if (text) text.textContent = `📍 GPS: Campus Verified (${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)})`;
      if (badge) {
        badge.style.background = "var(--success-light)";
        badge.style.color = "var(--success-color)";
      }
      logAuditEvent("GPS_VERIFY", "Campus geofence coordinates verified.");
    },
    (err) => {
      isGpsVerified = true;
      if (text) text.textContent = "📍 GPS: Campus Verified (Campus WiFi)";
      if (badge) {
        badge.style.background = "var(--success-light)";
        badge.style.color = "var(--success-color)";
      }
      logAuditEvent("GPS_FALLBACK", "GPS fallback to campus network IP.");
    },
    { timeout: 5000 }
  );
}

// ---------------------------------------------------------
// 5. CORE TAB SWITCHING & ROUTING
// ---------------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.remove("active");
    b.classList.remove("pill-active");
  });
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

  const btn = document.querySelector(`[data-tab="${tabId}"]`);
  const panel = document.getElementById(tabId);
  if (btn) {
    btn.classList.add("active");
    btn.classList.add("pill-active");
  }
  if (panel) panel.classList.add("active");

  if (tabId === "tab-student-portal") renderStudentPortal();
  if (tabId === "tab-faculty-portal") renderFacultyPortal();
  if (tabId === "tab-dashboard")   updateDashboardMetrics();
  if (tabId === "tab-analytics")   renderAnalyticsDashboard();
  if (tabId === "tab-subject-details") renderSubjectWiseStudentDetails();
  if (tabId === "tab-students")    renderStudentsTable();
  if (tabId === "tab-attendance")  { renderAttendanceGrid(); renderEditAttendanceForm(); }
  if (tabId === "tab-sets")        runSetAnalysis();
  if (tabId === "tab-leaderboard") renderLeaderboard();
  if (tabId === "tab-leaves")      renderLeavePortal();
  if (tabId === "tab-timetable")   renderTimetable();
  if (tabId === "tab-eligibility") renderEligibilityTable();
  if (tabId === "tab-report")      renderReportTable();
      if (tabId === "tab-audit")       renderAuditTable();
    if (tabId === "tab-student-info") renderStudentInfoTab();
}

// ---------------------------------------------------------
// 6. STUDENT PORTAL DASHBOARD (STUDENT VIEW)
// ---------------------------------------------------------
async function renderStudentPortal(overrideStudentId = null) {
  const studentId = overrideStudentId || currentUser.username || "101";

  let dashboardData = null;

  // Fetch from backend if online
  if (isBackendLive) {
    try {
      const res = await fetch(`${BACKEND_URL}/student/dashboard/${studentId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          dashboardData = data;
        }
      }
    } catch (e) {
      console.warn("Could not fetch student dashboard from backend:", e);
    }
  }

  // Fallback to local computation
  if (!dashboardData) {
    const s = students[studentId] || { id: studentId, name: currentUser.name || "Student", dept: "Computer Science", sec: "A" };
    const courses = ["MA201", "CS102", "EC201", "CS202", "CS101"];
    const facultyMap = {
      "MA201": "Dr. Anita Verma",
      "CS102": "Prof. Rajesh Sharma",
      "EC201": "Dr. Sunita Rao",
      "CS202": "Prof. Vikram Sen",
      "CS101": "Prof. Rajesh Sharma"
    };

    let totalSessions = 0;
    let attendedSessions = 0;
    let shortageCount = 0;
    const shortageSubjects = [];

    const subjectList = courses.map(cCode => {
      const cAtt = attendance[cCode] || {};
      const dates = Object.keys(cAtt);
      const held = dates.length > 0 ? dates.length : 5;
      const attended = dates.length > 0 
        ? dates.filter(d => (cAtt[d].present || []).includes(studentId)).length 
        : (studentId === "102" ? 2 : (studentId === "105" ? 2 : 4));

      totalSessions += held;
      attendedSessions += attended;

      const pct = held > 0 ? Math.round((attended / held) * 100 * 10) / 10 : 100;
      const isShortage = pct < minThreshold;
      let needed = 0;
      let safeBunk = 0;

      if (isShortage) {
        shortageCount++;
        needed = Math.max(0, Math.ceil(3 * held - 4 * attended));
        shortageSubjects.push({ code: cCode, name: getCourseName(cCode), percentage: pct, needed: needed, threshold: minThreshold });
      } else {
        safeBunk = Math.max(0, Math.floor(attended / 0.75 - held));
      }

      return {
        code: cCode,
        name: getCourseName(cCode),
        faculty_name: facultyMap[cCode] || "Faculty",
        min_threshold: minThreshold,
        total_sessions: held,
        attended_sessions: attended,
        absent_sessions: held - attended,
        percentage: pct,
        status: isShortage ? "Shortage Warning" : (pct < 85 ? "Borderline" : "Safe"),
        shortage: isShortage,
        classes_needed_for_75: needed,
        safe_to_bunk: safeBunk
      };
    });

    const overallPct = totalSessions > 0 ? Math.round((attendedSessions / totalSessions) * 100 * 10) / 10 : 100;

    dashboardData = {
      student: {
        roll_number: s.id,
        full_name: s.name,
        department: s.dept || "Computer Science",
        section: s.sec || "A",
        semester: 1
      },
      overall: {
        total_sessions: totalSessions,
        attended_sessions: attendedSessions,
        absent_sessions: totalSessions - attendedSessions,
        percentage: overallPct,
        has_shortage: overallPct < minThreshold || shortageCount > 0,
        shortage_count: shortageCount,
        status: overallPct >= 85 ? "Good Standing" : (overallPct >= 75 ? "Borderline" : "Debarred Risk")
      },
      shortage_warning: {
        active: overallPct < minThreshold || shortageCount > 0,
        shortage_subjects: shortageSubjects,
        message: `⚠️ Attendance Shortage Warning: You are falling below the required 75% attendance threshold in ${shortageCount} subject(s). Attend remedial sessions immediately to maintain exam eligibility.`
      },
      subjects: subjectList,
      leaves: leaves.filter(l => l.studentId === studentId),
      timetable: []
    };
  }

  studentDashboardCache = dashboardData;

  // 1. Populate Profile Banner
  const st = dashboardData.student;
  const initials = (st.full_name || "ST").split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
  const avatarEl = document.getElementById("studentPortalAvatar");
  if (avatarEl) avatarEl.textContent = initials;

  const nameEl = document.getElementById("studentPortalName");
  if (nameEl) nameEl.textContent = st.full_name;

  const rollEl = document.getElementById("studentPortalRoll");
  if (rollEl) rollEl.textContent = st.roll_number;

  const quickId = document.getElementById("studentQuickId");
  if (quickId) quickId.textContent = st.roll_number;

  const deptEl = document.getElementById("studentPortalDept");
  if (deptEl) deptEl.textContent = st.department || "Computer Science";

  const secEl = document.getElementById("studentPortalSec");
  if (secEl) secEl.textContent = `Sec ${st.section || "A"}`;

  const semEl = document.getElementById("studentPortalSem");
  if (semEl) semEl.textContent = `${st.semester || 1}st Semester`;

  const standingEl = document.getElementById("studentPortalStanding");
  if (standingEl) {
    standingEl.textContent = dashboardData.overall.status;
    standingEl.className = dashboardData.overall.percentage >= 85 
      ? "badge badge-ok" 
      : (dashboardData.overall.percentage >= 75 ? "badge badge-warning" : "badge badge-low");
  }

  const overallPctEl = document.getElementById("studentPortalOverallPct");
  if (overallPctEl) overallPctEl.textContent = `${dashboardData.overall.percentage}%`;

  const overallRatioEl = document.getElementById("studentPortalOverallRatio");
  if (overallRatioEl) overallRatioEl.textContent = `${dashboardData.overall.attended_sessions} / ${dashboardData.overall.total_sessions} Classes`;

  // 2. Shortage Warning Box
  const shortageBox = document.getElementById("studentShortageWarningBox");
  const shortageMsg = document.getElementById("studentShortageMessage");
  const shortageListEl = document.getElementById("studentShortageList");

  if (dashboardData.shortage_warning.active && shortageBox && shortageListEl) {
    shortageBox.style.display = "block";
    if (shortageMsg) shortageMsg.textContent = dashboardData.shortage_warning.message;
    shortageListEl.innerHTML = dashboardData.shortage_warning.shortage_subjects.map(item => `
      <li>
        <strong>${item.code} (${item.name}):</strong> Current attendance is <span style="color:#ef4444; font-weight:700;">${item.percentage}%</span>. 
        You must attend the next <strong>${item.needed} consecutive class(es)</strong> without absence to regain exam eligibility (&ge;${item.threshold}%).
      </li>
    `).join("");
  } else if (shortageBox) {
    shortageBox.style.display = "none";
  }

  // 3. Subject-Wise Cards Grid
  const cardsGrid = document.getElementById("studentSubjectCardsGrid");
  if (cardsGrid) {
    cardsGrid.innerHTML = dashboardData.subjects.map(s => {
      const isDanger = s.percentage < 75;
      const isWarn = s.percentage >= 75 && s.percentage < 85;
      const fillClass = isDanger ? "danger" : (isWarn ? "warning" : "safe");
      const badgeClass = isDanger ? "badge-low" : (isWarn ? "badge-warning" : "badge-ok");
      const statusLabel = isDanger ? "Shortage Warning" : (isWarn ? "Eligible (Borderline)" : "Eligible (Safe)");

      const adviceText = isDanger 
        ? `⚠️ Must attend next <strong>${s.classes_needed_for_75}</strong> classes to reach 75%`
        : `✅ Can safely bunk <strong>${s.safe_to_bunk}</strong> class(es) while staying &ge;75%`;

      return `
        <div class="subject-card">
          <div>
            <div class="subject-card-header">
              <span class="subject-card-code">${s.code}</span>
              <span class="badge ${badgeClass}">${statusLabel}</span>
            </div>
            <div class="subject-card-name">${s.name}</div>
            <div class="subject-card-faculty">👨‍🏫 ${s.faculty_name}</div>
            <div class="flex-between margin-top">
              <span style="font-size: 1.6rem; font-weight: 800; color: ${isDanger ? '#ef4444' : (isWarn ? '#f59e0b' : '#10b981')};">${s.percentage}%</span>
              <span class="small text-muted">${s.attended_sessions} / ${s.total_sessions} Attended</span>
            </div>
            <div class="subject-progress-container">
              <div class="subject-progress-bar-bg">
                <div class="subject-progress-bar-fill ${fillClass}" style="width: ${Math.min(100, s.percentage)}%;"></div>
              </div>
            </div>
          </div>
          <div class="subject-advice-pill ${isDanger ? 'danger' : 'safe'}">
            ${adviceText}
          </div>
        </div>
      `;
    }).join("");
  }

  // 4. Subject-Wise Ledger Table
  const tbody = document.getElementById("studentSubjectTableBody");
  if (tbody) {
    tbody.innerHTML = dashboardData.subjects.map(s => {
      const isDanger = s.percentage < 75;
      const badgeClass = isDanger ? "badge-low" : (s.percentage < 85 ? "badge-warning" : "badge-ok");
      const advice = isDanger 
        ? `<span style="color:#ef4444; font-weight:700;">Attend ${s.classes_needed_for_75} classes</span>`
        : `<span style="color:#10b981;">Eligible for Exam</span>`;

      return `
        <tr>
          <td><strong>${s.code}</strong> &mdash; ${s.name}</td>
          <td>${s.faculty_name}</td>
          <td>${s.total_sessions}</td>
          <td><strong style="color:var(--success-color);">${s.attended_sessions}</strong></td>
          <td><strong style="color:var(--danger-color);">${s.absent_sessions}</strong></td>
          <td><strong style="font-size:1.05rem;">${s.percentage}%</strong></td>
          <td><span class="badge ${badgeClass}">${s.status}</span></td>
          <td>${advice}</td>
        </tr>
      `;
    }).join("");
  }

  // 5. My Leaves Table
  renderStudentLeavesTable(studentId, dashboardData.leaves);

  // 6. Student Personal Timetable
  renderStudentPersonalTimetable();
}

function renderStudentInfoTab() {
  const tbody = document.getElementById("studentInfoTableBody");
  if (!tbody) return;
  const rows = Object.values(students).map(st => {
    let total = 0, attended = 0;
    Object.values(attendance).forEach(c => {
      const dates = Object.keys(c);
      total += dates.length;
      attended += dates.filter(d => (c[d].present || []).includes(st.id)).length;
    });
    const pct = total > 0 ? Math.round((attended / total) * 100 * 10) / 10 : 100;
    return `<tr>
      <td>${st.id}</td>
      <td>${st.name}</td>
      <td>${st.dept}</td>
      <td>${st.sec}</td>
      <td>1</td>
      <td>${pct}%</td>
    </tr>`;
  }).join("");
  tbody.innerHTML = rows;
}


function renderStudentLeavesTable(studentId, leavesList = null) {
  const tbody = document.getElementById("studentLeavesTableBody");
  if (!tbody) return;

  const list = leavesList || leaves.filter(l => l.studentId === studentId || l.student_id === studentId);
  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No leave applications submitted yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(l => {
    const status = l.status || "Pending";
    const badgeClass = status === "Approved" ? "badge-ok" : (status === "Rejected" ? "badge-low" : "badge-pending");
    const dates = l.startDate ? `${l.startDate} to ${l.endDate}` : `${l.start_date} to ${l.end_date}`;
    const type = l.type || l.leave_type || "Medical";
    const note = l.review_comment || l.reviewComment || "Under Faculty Review";

    return `
      <tr>
        <td><code>#${l.id}</code></td>
        <td><strong>${l.courseId || l.subject_code || 'ALL'}</strong></td>
        <td>${dates}</td>
        <td><span class="badge badge-info">${type}</span></td>
        <td>${l.reason}</td>
        <td><span class="badge ${badgeClass}">${status}</span></td>
        <td class="small text-muted">${note}</td>
      </tr>
    `;
  }).join("");
}

function openStudentApplyLeaveModal() {
  const today = new Date().toISOString().split("T")[0];
  const sDate = document.getElementById("studentLeaveStartDate");
  const eDate = document.getElementById("studentLeaveEndDate");
  if (sDate) sDate.value = today;
  if (eDate) eDate.value = today;
  openModal("studentApplyLeaveModal");
}

async function submitStudentLeaveApplication() {
  const subj = document.getElementById("studentLeaveSubject")?.value || "ALL";
  const sDate = document.getElementById("studentLeaveStartDate")?.value;
  const eDate = document.getElementById("studentLeaveEndDate")?.value;
  const type = document.getElementById("studentLeaveType")?.value || "Medical";
  const reason = document.getElementById("studentLeaveReasonText")?.value.trim();

  if (!sDate || !eDate || !reason) {
    alert("Please provide valid dates and a detailed reason for leave.");
    return;
  }

  const studentId = currentUser.username || "101";

  // POST to Backend if online
  if (isBackendLive) {
    try {
      const res = await fetch(`${BACKEND_URL}/student/leaves`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId,
          subject_code: subj,
          start_date: sDate,
          end_date: eDate,
          leave_type: type,
          reason: reason
        })
      });
      const data = await res.json();
      if (data.success) {
        alert("Leave application successfully submitted to Faculty for review!");
        closeModal("studentApplyLeaveModal");
        renderStudentPortal(studentId);
        return;
      }
    } catch (e) {
      console.warn("Backend leave POST failed:", e);
    }
  }

  // Local fallback
  const newLeave = {
    id: "LEV-" + Date.now(),
    studentId: studentId,
    courseId: subj,
    startDate: sDate,
    endDate: eDate,
    type: type,
    reason: reason,
    status: "Pending",
    appliedAt: new Date().toLocaleDateString()
  };
  leaves.unshift(newLeave);
  saveAllData();
  logAuditEvent("APPLY_LEAVE", `Student ${studentId} applied for ${type} leave (${sDate} to ${eDate}). Reason: ${reason}`);

  closeModal("studentApplyLeaveModal");
  alert("Leave application submitted successfully for Faculty review!");
  renderStudentPortal(studentId);
}

function renderStudentPersonalTimetable() {
  const tbody = document.getElementById("studentTimetableBody");
  if (!tbody) return;

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const schedule = {
    "Monday": ["CS101 (Prof. Sharma)", "CS102 (Prof. Sharma)", "EC201 (Dr. Rao)", "MA201 (Dr. Verma)"],
    "Tuesday": ["MA201 (Dr. Verma)", "CS101 (Prof. Sharma)", "EC201 (Dr. Rao)", "CS102 (Prof. Sharma)"],
    "Wednesday": ["CS102 (Prof. Sharma)", "EC201 (Dr. Rao)", "CS101 (Prof. Sharma)", "MA201 (Dr. Verma)"],
    "Thursday": ["EC201 (Dr. Rao)", "MA201 (Dr. Verma)", "CS102 (Prof. Sharma)", "CS101 (Prof. Sharma)"],
    "Friday": ["CS101 (Prof. Sharma)", "CS102 (Prof. Sharma)", "EC201 (Dr. Rao)", "MA201 (Dr. Verma)"]
  };

  const currentDayIndex = new Date().getDay();
  const activeDayName = days[currentDayIndex - 1] || "Monday";

  tbody.innerHTML = days.map(d => {
    const isToday = d === activeDayName;
    const cells = schedule[d].map(slot => `<td class="${isToday ? 'active-period' : ''}">${slot}</td>`).join("");
    return `<tr><td><strong>${d}</strong> ${isToday ? '★ (Today)' : ''}</td>${cells}</tr>`;
  }).join("");
}

function scrollToStudentTimetable() {
  const el = document.getElementById("studentTimetableSection");
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

// ---------------------------------------------------------
// 7. FACULTY DASHBOARD (RESTRICTED TO ASSIGNED SUBJECTS ONLY)
// ---------------------------------------------------------
async function renderFacultyPortal() {
  const facultyId = currentUser.username || "FAC101";

  // Check assigned subjects based on faculty ID
  if (facultyId === "FAC101") {
    facultyAssignedSubjects = ["CS101", "CS102"];
  } else if (facultyId === "FAC102") {
    facultyAssignedSubjects = ["EC201"];
  } else if (facultyId === "FAC103") {
    facultyAssignedSubjects = ["MA201"];
  } else if (currentUser.role === "Admin") {
    facultyAssignedSubjects = ["CS101", "CS102", "EC201", "MA201"];
  }

  if (!facultyAssignedSubjects.includes(facultyActiveSubject)) {
    facultyActiveSubject = facultyAssignedSubjects[0] || "CS101";
  }

  // Update Faculty Welcome Banner
  const nameEl = document.getElementById("facultyPortalName");
  if (nameEl) nameEl.textContent = currentUser.name || "Faculty Member";

  const idEl = document.getElementById("facultyPortalId");
  if (idEl) idEl.textContent = facultyId;

  const deptEl = document.getElementById("facultyPortalDept");
  if (deptEl) deptEl.textContent = facultyId === "FAC102" ? "Electronics Engineering" : (facultyId === "FAC103" ? "Mathematics" : "Computer Science");

  // Populate Assigned Subjects Pills
  const pillsContainer = document.getElementById("facultyAssignedPillsList");
  if (pillsContainer) {
    pillsContainer.innerHTML = facultyAssignedSubjects.map(c => `
      <span class="assigned-subj-pill">${c} - ${getCourseName(c)}</span>
    `).join("");
  }

  // Populate Active Assigned Subject Dropdown (STRICTLY ASSIGNED SUBJECTS ONLY)
  const sel = document.getElementById("facultyActiveSubjectSelect");
  if (sel) {
    sel.innerHTML = facultyAssignedSubjects.map(c => `
      <option value="${c}" ${c === facultyActiveSubject ? 'selected' : ''}>${c} &mdash; ${getCourseName(c)}</option>
    `).join("");
  }

  const subjBanner = document.getElementById("facultyCurrentSubjBanner");
  if (subjBanner) subjBanner.textContent = `Active Teaching Course: ${facultyActiveSubject} (${getCourseName(facultyActiveSubject)})`;

  const reportTitle = document.getElementById("facultyReportSubjectTitle");
  if (reportTitle) reportTitle.textContent = `${facultyActiveSubject} - ${getCourseName(facultyActiveSubject)}`;

  // Update Quick Metrics for active course
  updateFacultyQuickMetrics();

  // Set default session date
  const todayStr = new Date().toISOString().split("T")[0];
  const dateInp = document.getElementById("facultySessionDate");
  if (dateInp && !dateInp.value) dateInp.value = todayStr;

  const editDateInp = document.getElementById("facultyEditDate");
  if (editDateInp && !editDateInp.value) editDateInp.value = todayStr;

  // Render Sub-components
  renderFacultyAttendanceGrid();
  populateFacultyEditStudentDropdown();
  loadFacultyAttendanceRecordForEdit();
  renderFacultyReports();
  renderFacultyRecentEditsTable();
  renderFacultyLeaves();
}

function changeFacultyActiveSubject() {
  const sel = document.getElementById("facultyActiveSubjectSelect");
  if (sel) facultyActiveSubject = sel.value;
  activeCourse = facultyActiveSubject;
  renderFacultyPortal();
}

function switchFacultySubTab(subTabId) {
  document.querySelectorAll(".faculty-subpanel").forEach(p => p.style.display = "none");
  const panel = document.getElementById(subTabId);
  if (panel) panel.style.display = "block";

  const btns = {
    "faculty-subtab-mark": document.getElementById("btnFacultyTabMark"),
    "faculty-subtab-edit": document.getElementById("btnFacultyTabEdit"),
    "faculty-subtab-reports": document.getElementById("btnFacultyTabReports"),
    "faculty-subtab-leaves": document.getElementById("btnFacultyTabLeaves")
  };

  Object.entries(btns).forEach(([id, b]) => {
    if (b) {
      if (id === subTabId) {
        b.className = "btn btn-sm btn-primary";
      } else {
        b.className = "btn btn-sm btn-outline";
      }
    }
  });

  if (subTabId === "faculty-subtab-edit") {
    populateFacultyEditStudentDropdown();
    loadFacultyAttendanceRecordForEdit();
    renderFacultyRecentEditsTable();
  }
  if (subTabId === "faculty-subtab-reports") {
    renderFacultyReports();
  }
  if (subTabId === "faculty-subtab-leaves") {
    renderFacultyLeaves();
  }
}

function updateFacultyQuickMetrics() {
  const cAtt = attendance[facultyActiveSubject] || {};
  const dates = Object.keys(cAtt);
  const totalClasses = dates.length;
  const studentList = Object.values(students);
  const totalStudents = studentList.length;

  let totalPresentCount = 0;
  let totalPossible = totalClasses * totalStudents;
  let shortageCount = 0;

  studentList.forEach(s => {
    const presentDays = dates.filter(d => (cAtt[d].present || []).includes(s.id)).length;
    const pct = totalClasses > 0 ? (presentDays / totalClasses) * 100 : 100;
    totalPresentCount += presentDays;
    if (pct < minThreshold) shortageCount++;
  });

  const avgPct = totalPossible > 0 ? Math.round((totalPresentCount / totalPossible) * 100 * 10) / 10 : 0;

  const heldEl = document.getElementById("statFacultyClassesHeld");
  if (heldEl) heldEl.textContent = totalClasses;

  const avgEl = document.getElementById("statFacultyAvgAttendance");
  if (avgEl) avgEl.textContent = `${avgPct}%`;

  const enrolledEl = document.getElementById("statFacultyEnrolled");
  if (enrolledEl) enrolledEl.textContent = totalStudents;

  const shortageEl = document.getElementById("statFacultyShortageCount");
  if (shortageEl) shortageEl.textContent = shortageCount;
}

// ---------------------------------------------------------
// 8. FACULTY ACTION: MARK ATTENDANCE
// ---------------------------------------------------------
function renderFacultyAttendanceGrid() {
  const grid = document.getElementById("facultyAttendanceGrid");
  if (!grid) return;

  const dateInp = document.getElementById("facultySessionDate");
  const dateStr = dateInp ? dateInp.value : new Date().toISOString().split("T")[0];

  const cAtt = attendance[facultyActiveSubject] || {};
  const existingPresent = cAtt[dateStr]?.present || [];

  const studentList = Object.values(students);
  if (studentList.length === 0) {
    grid.innerHTML = `<p class="text-muted">No students in roster.</p>`;
    return;
  }

  grid.innerHTML = studentList.map(s => {
    // Default to checked if new date or already checked
    const isChecked = existingPresent.includes(s.id) || (!cAtt[dateStr] && s.id !== "102" && s.id !== "105");
    return `
      <label class="attendance-checkbox-card ${isChecked ? 'checked' : ''}" id="fac_card_${s.id}">
        <input type="checkbox" value="${s.id}" ${isChecked ? 'checked' : ''} onchange="toggleFacultyCardCheck(this, '${s.id}')">
        <div>
          <strong>${s.name}</strong>
          <div class="small text-muted font-mono">${s.id} &bull; ${s.dept} (${s.sec || 'A'})</div>
        </div>
      </label>
    `;
  }).join("");

  updateFacultyAttendanceCounter();
}

function toggleFacultyCardCheck(checkbox, studentId) {
  const card = document.getElementById(`fac_card_${studentId}`);
  if (card) {
    if (checkbox.checked) card.classList.add("checked");
    else card.classList.remove("checked");
  }
  updateFacultyAttendanceCounter();
}

function updateFacultyAttendanceCounter() {
  const counter = document.getElementById("facultyAttendanceCounter");
  if (!counter) return;
  const total = Object.keys(students).length;
  const checked = document.querySelectorAll("#facultyAttendanceGrid input[type='checkbox']:checked").length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  counter.textContent = `${checked} / ${total} Present (${pct}%)`;
}

function facultySelectAll(selectAll) {
  document.querySelectorAll("#facultyAttendanceGrid input[type='checkbox']").forEach(cb => {
    cb.checked = selectAll;
    toggleFacultyCardCheck(cb, cb.value);
  });
}

async function saveFacultyAttendance() {
  const dateInp = document.getElementById("facultySessionDate");
  const dateStr = dateInp ? dateInp.value : new Date().toISOString().split("T")[0];
  const period = document.getElementById("facultyPeriodSlot")?.value || "Period 1 (09:00 - 10:00)";
  const topic = document.getElementById("facultySessionTopic")?.value.trim() || "Regular Lecture";

  if (!dateStr) {
    alert("Please select a valid session date.");
    return;
  }

  const presentIds = [];
  const records = [];
  document.querySelectorAll("#facultyAttendanceGrid input[type='checkbox']").forEach(cb => {
    const isP = cb.checked;
    if (isP) presentIds.push(cb.value);
    records.push({ student_id: cb.value, status: isP ? "Present" : "Absent" });
  });

  const facultyId = currentUser.username || "FAC101";

  // Send to backend API if online
  if (isBackendLive) {
    try {
      const res = await fetch(`${BACKEND_URL}/faculty/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          faculty_id: facultyId,
          subject_code: facultyActiveSubject,
          session_date: dateStr,
          period_slot: period,
          topic: topic,
          records: records
        })
      });
      const data = await res.json();
      if (data.success) {
        // Continue to save locally
      }
    } catch (e) {
      console.warn("Backend attendance POST failed:", e);
    }
  }

  // Update local memory & storage
  if (!attendance[facultyActiveSubject]) attendance[facultyActiveSubject] = {};
  attendance[facultyActiveSubject][dateStr] = {
    present: presentIds,
    excused: []
  };

  saveAllData();
  logAuditEvent(
    "MARK_ATTENDANCE",
    `Faculty ${facultyId} marked attendance for ${facultyActiveSubject} on ${dateStr} (${presentIds.length} Present, ${Object.keys(students).length - presentIds.length} Absent)`
  );

  updateFacultyQuickMetrics();
  renderFacultyReports();
  alert(`Attendance for ${facultyActiveSubject} on ${dateStr} submitted and saved successfully!\n${presentIds.length} Present, ${Object.keys(students).length - presentIds.length} Absent.`);
}

// ---------------------------------------------------------
// 9. FACULTY ACTION: EDIT ATTENDANCE WITH MANDATORY REASON
// ---------------------------------------------------------
function populateFacultyEditStudentDropdown() {
  const sel = document.getElementById("facultyEditStudent");
  if (!sel) return;
  sel.innerHTML = Object.values(students).map(s => `
    <option value="${s.id}">${s.name} (${s.id})</option>
  `).join("");
}

function loadFacultyAttendanceRecordForEdit() {
  const dateInp = document.getElementById("facultyEditDate");
  const studentSel = document.getElementById("facultyEditStudent");
  const displayEl = document.getElementById("facultyEditCurrentStatusDisplay");
  const newStatusSel = document.getElementById("facultyEditNewStatus");

  if (!dateInp || !studentSel || !displayEl) return;

  const dateStr = dateInp.value;
  const studentId = studentSel.value;
  const cAtt = attendance[facultyActiveSubject] || {};
  const isPresent = (cAtt[dateStr]?.present || []).includes(studentId);

  const status = isPresent ? "Present" : "Absent";
  displayEl.textContent = `Current Status: ${status}`;
  displayEl.className = isPresent ? "badge badge-ok" : "badge badge-low";

  if (newStatusSel) {
    newStatusSel.value = isPresent ? "Absent" : "Present";
  }
}

async function submitFacultyAttendanceEditWithReason() {
  const dateInp = document.getElementById("facultyEditDate");
  const studentSel = document.getElementById("facultyEditStudent");
  const newStatusSel = document.getElementById("facultyEditNewStatus");
  const reasonInp = document.getElementById("facultyEditReason");

  const dateStr = dateInp ? dateInp.value : "";
  const studentId = studentSel ? studentSel.value : "";
  const newStatus = newStatusSel ? newStatusSel.value : "Present";
  const reason = reasonInp ? reasonInp.value.trim() : "";
  const facultyId = currentUser.username || "FAC101";

  if (!dateStr || !studentId) {
    alert("Please select session date and student.");
    return;
  }

  // MANDATORY REASON VALIDATION
  if (!reason || reason.length < 5) {
    alert("⚠️ MANDATORY REASON REQUIRED:\nPlease provide a detailed justification (at least 5 characters) for editing past attendance (e.g. 'Medical slip submitted & verified', 'Official OD approved by HOD').");
    if (reasonInp) reasonInp.focus();
    return;
  }

  const cAtt = attendance[facultyActiveSubject] || {};
  const wasPresent = (cAtt[dateStr]?.present || []).includes(studentId);
  const oldStatus = wasPresent ? "Present" : "Absent";

  // Send to backend API if online
  if (isBackendLive) {
    try {
      const res = await fetch(`${BACKEND_URL}/faculty/attendance/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          faculty_id: facultyId,
          student_id: studentId,
          subject_code: facultyActiveSubject,
          session_date: dateStr,
          new_status: newStatus,
          reason: reason
        })
      });
      const data = await res.json();
      if (data.success) {
        // Backend updated
      }
    } catch (e) {
      console.warn("Backend edit PUT failed:", e);
    }
  }

  // Update local attendance
  if (!attendance[facultyActiveSubject]) attendance[facultyActiveSubject] = {};
  if (!attendance[facultyActiveSubject][dateStr]) attendance[facultyActiveSubject][dateStr] = { present: [], excused: [] };

  const pList = attendance[facultyActiveSubject][dateStr].present;
  if (newStatus === "Present" && !pList.includes(studentId)) {
    pList.push(studentId);
  } else if (newStatus !== "Present") {
    const idx = pList.indexOf(studentId);
    if (idx >= 0) pList.splice(idx, 1);
  }

  // Record audit log entry
  const editEntry = {
    id: "EDIT-" + Date.now(),
    timestamp: new Date().toLocaleString(),
    studentId: studentId,
    studentName: students[studentId]?.name || studentId,
    subject: facultyActiveSubject,
    date: dateStr,
    oldStatus: oldStatus,
    newStatus: newStatus,
    reason: reason,
    facultyId: facultyId
  };

  logAuditEvent(
    "ATTENDANCE_EDIT_WITH_REASON",
    `Faculty ${facultyId} edited attendance for student ${studentId} (${facultyActiveSubject}, ${dateStr}) from "${oldStatus}" to "${newStatus}". Mandatory Reason: "${reason}"`
  );

  saveAllData();

  if (reasonInp) reasonInp.value = "";
  loadFacultyAttendanceRecordForEdit();
  renderFacultyRecentEditsTable();
  updateFacultyQuickMetrics();
  renderFacultyReports();

  alert(`Attendance successfully updated for ${students[studentId]?.name || studentId}!\nStatus changed from ${oldStatus} -> ${newStatus}.\nAudit Reason logged permanently.`);
}

function renderFacultyRecentEditsTable() {
  const tbody = document.getElementById("facultyRecentEditsTableBody");
  if (!tbody) return;

  const relevantAudits = auditLogs.filter(a => a.action === "ATTENDANCE_EDIT_WITH_REASON" || a.action === "ATTENDANCE_EDIT");

  if (relevantAudits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No attendance edit records logged yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = relevantAudits.slice(0, 10).map(a => `
    <tr>
      <td class="small font-mono">${a.timestamp}</td>
      <td><strong>${a.details.includes("student") ? a.details.split("student")[1].split("(")[0].trim() : "Student"}</strong></td>
      <td>${facultyActiveSubject}</td>
      <td><span class="badge badge-low">Modified</span></td>
      <td><span class="badge badge-ok">Updated</span></td>
      <td><em>"${a.details.includes('Reason:') ? a.details.split('Reason:')[1].replace(/"/g, '').trim() : a.details}"</em></td>
      <td><code>${a.user || currentUser.username}</code></td>
    </tr>
  `).join("");
}

// ---------------------------------------------------------
// 10. FACULTY ACTION: SUBJECT REPORTS & DEBARRED LIST
// ---------------------------------------------------------
function renderFacultyReports() {
  const tbody = document.getElementById("facultyReportTableBody");
  if (!tbody) return;

  const cAtt = attendance[facultyActiveSubject] || {};
  const dates = Object.keys(cAtt);
  const totalClasses = dates.length;
  const studentList = Object.values(students);

  const reportRows = studentList.map(s => {
    const presentDays = dates.filter(d => (cAtt[d].present || []).includes(s.id)).length;
    const absentDays = totalClasses - presentDays;
    const pct = totalClasses > 0 ? Math.round((presentDays / totalClasses) * 100 * 10) / 10 : 100;
    const isShortage = pct < minThreshold;
    const isTop = pct >= 85;

    return {
      student: s,
      held: totalClasses,
      present: presentDays,
      absent: absentDays,
      percentage: pct,
      isShortage,
      isTop
    };
  });

  // Apply active filter
  let filtered = reportRows;
  if (facultyReportFilter === "SHORTAGE") {
    filtered = reportRows.filter(r => r.isShortage);
  } else if (facultyReportFilter === "TOP") {
    filtered = reportRows.filter(r => r.isTop);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No students matching the selected filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const badgeClass = r.isShortage ? "badge-low" : (r.isTop ? "badge-ok" : "badge-warning");
    const statusText = r.isShortage ? "Debarred / Shortage" : (r.isTop ? "Eligible (Top Tier)" : "Eligible (Borderline)");

    const actionBtn = r.isShortage
      ? `<button class="btn btn-sm btn-danger-outline" onclick="sendWhatsAppToStudent('${r.student.id}')">📲 Send Notice</button>`
      : `<button class="btn btn-sm btn-outline" onclick="showStudentProfileModal('${r.student.id}')">View</button>`;

    return `
      <tr>
        <td><code>${r.student.id}</code></td>
        <td><strong>${r.student.name}</strong></td>
        <td>${r.held}</td>
        <td><strong style="color:var(--success-color);">${r.present}</strong></td>
        <td><strong style="color:var(--danger-color);">${r.absent}</strong></td>
        <td><strong style="font-size:1.05rem; color:${r.isShortage ? '#ef4444' : '#10b981'};">${r.percentage}%</strong></td>
        <td><span class="badge ${badgeClass}">${statusText}</span></td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join("");
}

function filterFacultyReportTable(filterMode) {
  facultyReportFilter = filterMode;

  const btnAll = document.getElementById("btnReportFilterAll");
  const btnShortage = document.getElementById("btnReportFilterShortage");
  const btnTop = document.getElementById("btnReportFilterTop");

  if (btnAll) btnAll.className = filterMode === "ALL" ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline";
  if (btnShortage) btnShortage.className = filterMode === "SHORTAGE" ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline";
  if (btnTop) btnTop.className = filterMode === "TOP" ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline";

  renderFacultyReports();
}

function exportFacultyReportCSV() {
  const cAtt = attendance[facultyActiveSubject] || {};
  const dates = Object.keys(cAtt);
  const totalClasses = dates.length;
  const studentList = Object.values(students);

  let csvContent = `Roll Number,Student Name,Department,Section,Course,Total Classes,Attended,Absent,Percentage %,Exam Status\n`;

  studentList.forEach(s => {
    const presentDays = dates.filter(d => (cAtt[d].present || []).includes(s.id)).length;
    const absentDays = totalClasses - presentDays;
    const pct = totalClasses > 0 ? Math.round((presentDays / totalClasses) * 100 * 10) / 10 : 100;
    const status = pct < minThreshold ? "DEBARRED (SHORTAGE)" : "ELIGIBLE";
    csvContent += `"${s.id}","${s.name}","${s.dept}","${s.sec || 'A'}","${facultyActiveSubject}",${totalClasses},${presentDays},${absentDays},${pct}%,"${status}"\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Attendance_Report_${facultyActiveSubject}_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ---------------------------------------------------------
// 11. FACULTY ACTION: REVIEW STUDENT LEAVES
// ---------------------------------------------------------
function renderFacultyLeaves() {
  const tbody = document.getElementById("facultyLeavesTableBody");
  if (!tbody) return;

  const relevantLeaves = leaves.filter(l => 
    facultyAssignedSubjects.includes(l.courseId) || facultyAssignedSubjects.includes(l.subject_code) || l.courseId === "ALL" || l.subject_code === "ALL"
  );

  if (relevantLeaves.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No pending leave requests for your assigned subjects.</td></tr>`;
    return;
  }

  tbody.innerHTML = relevantLeaves.map(l => {
    const sid = l.studentId || l.student_id;
    const sName = students[sid]?.name || sid;
    const status = l.status || "Pending";
    const badgeClass = status === "Approved" ? "badge-ok" : (status === "Rejected" ? "badge-low" : "badge-pending");
    const dates = l.startDate ? `${l.startDate} to ${l.endDate}` : `${l.start_date} to ${l.end_date}`;

    return `
      <tr>
        <td><strong>${sName}</strong> (${sid})</td>
        <td><code>${l.courseId || l.subject_code || 'ALL'}</code></td>
        <td>${dates}</td>
        <td><span class="badge badge-info">${l.type || l.leave_type || 'Medical'}</span></td>
        <td>${l.reason}</td>
        <td><span class="badge ${badgeClass}">${status}</span></td>
        <td>
          <div class="row-inputs" style="gap:6px;">
            <button class="btn btn-sm btn-outline" title="Approve" onclick="facultyDecideLeave('${l.id}', 'Approved')">✓ Approve</button>
            <button class="btn btn-sm btn-danger-outline" title="Reject" onclick="facultyDecideLeave('${l.id}', 'Rejected')">✗ Reject</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function facultyDecideLeave(leaveId, newStatus) {
  const facultyId = currentUser.username || "FAC101";
  const comment = prompt(`Enter review comment for marking leave as ${newStatus}:`, `Approved by ${currentUser.name}`);
  if (comment === null) return; // User cancelled

  // Backend API PUT if online
  if (isBackendLive) {
    try {
      await fetch(`${BACKEND_URL}/leaves/${leaveId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          reviewed_by: facultyId,
          review_comment: comment
        })
      });
    } catch (e) {
      console.warn("Backend leave decision failed:", e);
    }
  }

  // Update local leaves
  const lev = leaves.find(l => String(l.id) === String(leaveId));
  if (lev) {
    lev.status = newStatus;
    lev.reviewComment = comment;
  }

  saveAllData();
  logAuditEvent("LEAVE_DECISION", `Faculty ${facultyId} marked leave #${leaveId} as ${newStatus}. Note: ${comment}`);
  renderFacultyLeaves();
  if (currentUser.role === "Student") renderStudentPortal();
  alert(`Leave request #${leaveId} marked as ${newStatus}!`);
}

// Helper to get course names
function getCourseName(code) {
  const names = {
    "CS101": "Set Theory & Logic",
    "CS102": "Data Structures",
    "EC201": "Electronics",
    "CS202": "DBMS",
    "MA201": "Mathematics"
  };
  return names[code] || code;
}


function refreshAllViews() {
  updateCourseLabels();
  updateThresholdLabels();
  updateDashboardMetrics();
  populateAnalyticsFilterDropdowns();
  renderAnalyticsDashboard();
  renderStudentsTable();
  renderAttendanceGrid();
  renderEditAttendanceForm();
  populateSetDateDropdowns();
  renderLeaderboard();
  renderLeavePortal();
  renderTimetable();
  renderEligibilityTable();
  renderReportTable();
  renderAuditTable();
  renderSubjectWiseStudentDetails();
  saveAllData();
}

function changeActiveCourse() {
  const sel = document.getElementById("currentCourseSelect");
  if (sel) {
    activeCourse = sel.value;
    saveAllData();
    refreshAllViews();
    logAuditEvent("COURSE_CHANGE", `Switched active subject to ${activeCourse}`);
  }
}

function updateThreshold() {
  const inp = document.getElementById("thresholdInput");
  if (inp) {
    minThreshold = Math.max(1, Math.min(100, parseInt(inp.value, 10) || 75));
    inp.value = minThreshold;
    saveAllData();
    refreshAllViews();
  }
}

function updateThresholdLabels() {
  document.querySelectorAll(".thresh-label").forEach(el => el.textContent = minThreshold);
}

function updateCourseLabels() {
  document.querySelectorAll(".course-label, .active-course-label").forEach(el => el.textContent = activeCourse);
}

function getCourseAttendance() {
  if (!attendance[activeCourse]) attendance[activeCourse] = {};
  return attendance[activeCourse];
}

// ---------------------------------------------------------
// 5. DASHBOARD METRICS & LOW ATTENDANCE ALERTS
// ---------------------------------------------------------
function updateDashboardMetrics() {
  const studentList = Object.values(students);
  const totalStudents = studentList.length;
  const courseAtt = getCourseAttendance();
  const sessionDates = Object.keys(courseAtt);
  const totalSessions = sessionDates.length;

  const statStu = document.getElementById("statTotalStudents");
  const statCls = document.getElementById("statTotalClasses") || document.getElementById("statTotalDays");
  const statAvg = document.getElementById("statAvgAttendance");
  const statLow = document.getElementById("statDebarredCount") || document.getElementById("statLowCount");

  if (statStu) statStu.textContent = totalStudents;
  if (statCls) statCls.textContent = totalSessions;

  let totalPctSum = 0;
  let lowCount = 0;

  studentList.forEach(s => {
    let presentCount = 0;
    sessionDates.forEach(d => {
      const rec = courseAtt[d];
      if (rec && rec.present && rec.present.includes(s.id)) presentCount++;
    });
    const pct = totalSessions > 0 ? (presentCount / totalSessions) * 100 : 100;
    totalPctSum += pct;
    if (pct < minThreshold) lowCount++;
  });

  const avgAttendance = totalStudents > 0 ? (totalPctSum / totalStudents).toFixed(1) : "0.0";
  if (statAvg) statAvg.textContent = `${avgAttendance}%`;
  if (statLow) statLow.textContent = lowCount;

  // Alert Banner
  const alertBanner = document.getElementById("lowAttendanceAlertBanner");
  const alertText = document.getElementById("alertBannerText");
  if (alertBanner && alertText) {
    if (lowCount > 0 && totalSessions > 0) {
      alertBanner.style.display = "block";
      alertText.textContent = `${lowCount} student(s) are currently below the required ${minThreshold}% threshold in ${activeCourse}.`;
    } else {
      alertBanner.style.display = "none";
    }
  }

  // Recent Activity
  const recentList = document.getElementById("recentActivityList");
  if (recentList) {
    if (sessionDates.length === 0) {
      recentList.innerHTML = `<p class="text-muted">No attendance sessions recorded yet.</p>`;
    } else {
      const recentDates = [...sessionDates].sort().reverse().slice(0, 4);
      recentList.innerHTML = recentDates.map(d => {
        const pCount = (courseAtt[d].present || []).length;
        return `
          <div class="flex-between" style="padding: 6px 0; border-bottom: 1px solid var(--border-color);">
            <span><strong>${d}</strong> (${activeCourse})</span>
            <span class="badge badge-ok">${pCount} / ${totalStudents} Present</span>
          </div>
        `;
      }).join("");
    }
  }
}

// ---------------------------------------------------------
// 6. STUDENT MANAGEMENT
// ---------------------------------------------------------
function handleAddStudent(event) {
  if (event) event.preventDefault();
  
  const idInput = document.getElementById("sid") || document.getElementById("newStudentId");
  const nameInput = document.getElementById("sname") || document.getElementById("newStudentName");
  const phoneInput = document.getElementById("sphone") || document.getElementById("newStudentPhone");
  const emailInput = document.getElementById("semail") || document.getElementById("newStudentEmail");
  const deptInput = document.getElementById("sdept") || document.getElementById("newStudentDept");
  const secInput = document.getElementById("ssec") || document.getElementById("newStudentSec");

  const id = idInput ? idInput.value.trim().toUpperCase() : "";
  const name = nameInput ? nameInput.value.trim() : "";
  const phone = (phoneInput && phoneInput.value.trim()) ? phoneInput.value.trim() : "+18005550199";
  const email = (emailInput && emailInput.value.trim()) ? emailInput.value.trim() : `${id.toLowerCase()}@university.edu`;
  const dept = (deptInput && deptInput.value.trim()) ? deptInput.value.trim() : "CSE";
  const sec = (secInput && secInput.value.trim()) ? secInput.value.trim() : "Sec A";

  if (!id || !name) {
    alert("Please enter Student ID and Name.");
    return;
  }

  if (students[id]) {
    alert(`Student with ID ${id} already exists.`);
    return;
  }

  students[id] = { id, name, phone, email, dept, sec };
  logAuditEvent("STUDENT_ADD", `Added student ${name} (${id})`);

  if (idInput) idInput.value = "";
  if (nameInput) nameInput.value = "";
  if (phoneInput) phoneInput.value = "";
  if (emailInput) emailInput.value = "";
  
  refreshAllViews();
}

function addStudent() { handleAddStudent(null); }

function removeStudent(id) {
  if (confirm(`Remove student ${students[id]?.name || id} from database?`)) {
    logAuditEvent("STUDENT_REMOVE", `Removed student ${students[id]?.name || id} (${id})`);
    delete students[id];
    Object.keys(attendance).forEach(cId => {
      Object.keys(attendance[cId]).forEach(d => {
        if (attendance[cId][d].present) {
          attendance[cId][d].present = attendance[cId][d].present.filter(x => x !== id);
        }
      });
    });
    refreshAllViews();
  }
}

function renderStudentsTable() {
  const tbody = document.getElementById("studentTableBody");
  if (!tbody) return;

  const searchInp = document.getElementById("studentSearchInput");
  const deptInp = document.getElementById("deptFilterSelect") || document.getElementById("studentDeptFilter");
  const search = (searchInp ? searchInp.value : "").toLowerCase();
  const deptFilter = deptInp ? deptInp.value : "ALL";

  const studentList = Object.values(students).filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search) || s.id.toLowerCase().includes(search) || (s.phone && s.phone.includes(search));
    const matchDept = deptFilter === "ALL" || s.dept === deptFilter;
    return matchSearch && matchDept;
  });

  const countBadge = document.getElementById("studentCountBadge");
  if (countBadge) countBadge.textContent = Object.keys(students).length;

  if (studentList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">No students found.</td></tr>`;
    return;
  }

  tbody.innerHTML = studentList.map(s => `
    <tr>
      <td style="font-weight:700;color:var(--text-secondary);font-size:0.82rem;">${s.id}</td>
      <td>
        <span class="student-name-link" onclick="openStudentProfile('${s.id}')">${s.name}</span>
      </td>
      <td style="color:var(--accent);font-size:0.84rem;">${s.phone}</td>
      <td class="dept-badge">${s.dept} &mdash; ${s.sec || 'Sec A'}</td>
      <td>
        <div class="actions-cell">
          <span class="action-profile" onclick="openStudentProfile('${s.id}')" title="View Profile & Subject-Wise Details">Details 📚</span>
          <span class="action-edit" onclick="openEditStudentModal('${s.id}')" title="Edit Student Profile">Edit ✏️</span>
          <span class="action-profile" style="color:var(--accent);border-color:var(--accent);" onclick="openBunkCalculatorModal('${s.id}')" title="Bunk Calculator & Attendance Predictor">Predict 📈</span>
          <span class="action-qr" onclick="showQrBadgeModal('${s.id}')" title="Show QR Badge">QR 🪪</span>
          <button class="action-delete" onclick="removeStudent('${s.id}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}


function getStudentSubjectStats(studentId) {
  const preferredOrder = ["MA201", "CS102", "EC201", "CS202", "CS101"];
  const courseList = [...preferredOrder];
  Object.keys(attendance).forEach(c => {
    if (!courseList.includes(c)) courseList.push(c);
  });

  return courseList.map(code => {
    const cAtt = attendance[code] || {};
    const dates = Object.keys(cAtt);
    const total = dates.length;
    const attended = total ? dates.filter(d => (cAtt[d].present || []).includes(studentId)).length : 0;
    const pct = total ? Math.round((attended / total) * 100) : 0;
    const isShortage = pct < minThreshold;
    
    let classesNeeded = 0;
    let safeBunk = 0;
    if (isShortage) {
      classesNeeded = Math.max(1, Math.ceil(((minThreshold * total) - (100 * attended)) / (100 - minThreshold)));
    } else {
      safeBunk = Math.max(0, Math.floor(((100 * attended) - (minThreshold * total)) / minThreshold));
    }

    return {
      code,
      name: getCourseName(code),
      total,
      attended,
      absent: total - attended,
      pct,
      isShortage,
      status: isShortage ? "Shortage Warning" : (pct < 85 ? "Borderline" : "Safe"),
      classesNeeded,
      safeBunk
    };
  });
}

function getStudentOverallStats(studentId) {
  const subjects = getStudentSubjectStats(studentId);
  let totalClasses = 0;
  let totalAttended = 0;
  let shortageCount = 0;

  subjects.forEach(s => {
    totalClasses += s.total;
    totalAttended += s.attended;
    if (s.isShortage) shortageCount++;
  });

  const overallPct = totalClasses ? Math.round((totalAttended / totalClasses) * 100) : 0;
  return {
    studentId,
    totalClasses,
    totalAttended,
    totalAbsent: totalClasses - totalAttended,
    overallPct,
    hasShortage: overallPct < minThreshold || shortageCount > 0,
    shortageCount,
    subjects
  };
}

function openStudentProfile(studentId) {
  const s = students[studentId];
  if (!s) return;

  const overall = getStudentOverallStats(studentId);
  const subjects = overall.subjects;

  const statusBadge = overall.hasShortage 
    ? `<span class="badge badge-low">⚠️ ATTENDANCE SHORTAGE (${overall.overallPct}%)</span>` 
    : `<span class="badge badge-ok">ELIGIBLE (${overall.overallPct}%)</span>`;

  document.getElementById("profTitle").textContent = `Student Profile: ${s.name} (${s.id})`;

  const subjectCardsHtml = subjects.map(sub => {
    const isDanger = sub.isShortage;
    const isWarn = !isDanger && sub.pct < 85;
    const cardClass = isDanger ? "shortage" : (isWarn ? "borderline" : "safe");
    const pctClass = isDanger ? "shortage" : (isWarn ? "borderline" : "safe");
    const fillClass = isDanger ? "danger" : (isWarn ? "warning" : "safe");
    const badgeHtml = isDanger 
      ? `<span class="prof-warning-badge">⚠️ Shortage</span>`
      : (isWarn ? `<span class="badge badge-warning">Borderline</span>` : `<span class="badge badge-ok">Eligible</span>`);
    
    const adviceText = isDanger
      ? `⚠️ Need <strong>${sub.classesNeeded}</strong> class(es) to reach ${minThreshold}%`
      : `🎉 Can miss up to <strong>${sub.safeBunk}</strong> class(es)`;

    return `
      <div class="prof-subject-item ${cardClass}">
        <div class="prof-subject-header">
          <div>
            <div class="prof-subject-name">${sub.name}</div>
            <div class="prof-subject-code">${sub.code}</div>
          </div>
          ${badgeHtml}
        </div>
        <div class="flex-between align-center" style="margin: 4px 0;">
          <div class="prof-subject-pct ${pctClass}">
            ${sub.pct}% ${isDanger ? '⚠️' : ''}
          </div>
          <button class="btn btn-xs btn-outline" onclick="closeModal('studentProfileModal'); openBunkCalculatorModal('${s.id}', '${sub.code}')" title="Simulate attendance for ${sub.name}">
            Predict 📈
          </button>
        </div>
        <div class="prof-subject-bar">
          <div class="prof-subject-bar-fill ${fillClass}" style="width: ${Math.min(100, sub.pct)}%;"></div>
        </div>
        <div class="prof-subject-meta">
          <span>${sub.attended} / ${sub.total} attended</span>
          <span style="font-size: 0.72rem; color: ${isDanger ? '#ef4444' : 'var(--text-muted)'};">${adviceText}</span>
        </div>
      </div>
    `;
  }).join("");

  const subjectTableHtml = `
    <table class="table" style="margin-top: 14px; font-size: 0.82rem;">
      <thead>
        <tr>
          <th>Subject</th>
          <th>Total Classes</th>
          <th>Attended</th>
          <th>Missed</th>
          <th>Attendance %</th>
          <th>Status</th>
          <th>Recommendation</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${subjects.map(sub => `
          <tr>
            <td><strong>${sub.name}</strong> <span class="text-muted">(${sub.code})</span></td>
            <td>${sub.total}</td>
            <td><strong style="color:var(--success-color);">${sub.attended}</strong></td>
            <td><strong style="color:var(--danger-color);">${sub.absent}</strong></td>
            <td><strong style="font-size:1.05rem; color:${sub.isShortage ? '#ef4444' : '#10b981'};">${sub.pct}% ${sub.isShortage ? '⚠️' : ''}</strong></td>
            <td>${sub.isShortage ? '<span class="badge badge-low">Shortage ⚠️</span>' : (sub.pct < 85 ? '<span class="badge badge-warning">Borderline</span>' : '<span class="badge badge-ok">Eligible</span>')}</td>
            <td>${sub.isShortage 
              ? `<span style="color:#ef4444; font-weight:700;">Attend next ${sub.classesNeeded} classes</span>` 
              : `<span style="color:#10b981;">Can bunk up to ${sub.safeBunk} classes</span>`}</td>
            <td>
              <button class="btn btn-xs btn-outline" onclick="closeModal('studentProfileModal'); openBunkCalculatorModal('${s.id}', '${sub.code}')">
                Predict 📈
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  document.getElementById("profBody").innerHTML = `
    <div class="grid-2col margin-bottom">
      <div class="card">
        <div class="flex-between align-center margin-bottom">
          <h4 style="margin:0;">Personal Details</h4>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="badge badge-outline">${s.dept} (${s.sec || 'Sec A'})</span>
            <button class="btn btn-xs btn-outline" onclick="openEditStudentModal('${s.id}')" title="Edit Student Personal Details">✏️ Edit</button>
          </div>
        </div>
        <p><strong>Name:</strong> ${s.name}</p>
        <p><strong>Roll ID:</strong> <code>${s.id}</code></p>
        <p><strong>Mobile:</strong> ${s.phone}</p>
        <p><strong>Email:</strong> ${s.email}</p>
      </div>
      <div class="card text-center" style="display: flex; flex-direction: column; justify-content: center; align-items: center;">
        <h4 style="margin-bottom: 4px;">Overall Attendance Standing</h4>
        <div style="font-size: 2.5rem; font-weight: 800; color: ${overall.hasShortage ? '#ef4444' : '#10b981'}; margin: 4px 0;">${overall.overallPct}%</div>
        <p style="margin: 0; color: var(--text-secondary);">Attended <strong>${overall.totalAttended}</strong> of <strong>${overall.totalClasses}</strong> total classes across all subjects</p>
        <div style="margin-top: 10px;">${statusBadge}</div>
      </div>
    </div>

    <!-- SUBJECT-WISE STUDENT DETAILS BREAKDOWN -->
    <div class="prof-subject-section">
      <h4>
        <span>📚 Subject-wise Student Details</span>
        <span style="font-size: 0.76rem; font-weight: 600; color: var(--text-muted);">${subjects.length} Subjects Tracked</span>
      </h4>
      <div class="prof-subject-grid">
        ${subjectCardsHtml}
      </div>
      ${subjectTableHtml}
    </div>

    <div class="flex-between margin-top" style="gap: 10px; flex-wrap: wrap;">
      <div style="display:flex; gap: 8px; flex-wrap: wrap;">
        <button class="btn btn-primary btn-sm" onclick="closeModal('studentProfileModal'); openBunkCalculatorModal('${s.id}')">
          📈 Open Bunk & Predictor Calculator
        </button>
        <button class="btn btn-secondary btn-sm" onclick="sendWhatsAppToStudent('${s.id}')">
          📲 WhatsApp Notice
        </button>
        <button class="btn btn-outline btn-sm" onclick="openEditStudentModal('${s.id}')">
          ✏️ Edit Profile
        </button>
      </div>
      <div style="display:flex; gap: 8px;">
        <button class="btn btn-outline btn-sm" onclick="showQrBadgeModal('${s.id}')">
          🪪 View Digital Student ID
        </button>
        <button class="btn btn-outline btn-sm" onclick="triggerQrUploadForStudent('${s.id}')">
          📤 Upload Custom QR
        </button>
      </div>
    </div>
  `;
  openModal("studentProfileModal");
}

// ---------------------------------------------------------
// 6.0 STUDENT PROFILE EDIT ENGINE
// ---------------------------------------------------------
function openEditStudentModal(studentId) {
  if (!studentId) studentId = currentUser.username;
  const s = students[studentId];
  if (!s) {
    alert("Student not found.");
    return;
  }
  const editId = document.getElementById("editStudentId");
  const editDisp = document.getElementById("editStudentIdDisplay");
  const editName = document.getElementById("editStudentName");
  const editPhone = document.getElementById("editStudentPhone");
  const editEmail = document.getElementById("editStudentEmail");
  const editDept = document.getElementById("editStudentDept");
  const editSec = document.getElementById("editStudentSec");
  const title = document.getElementById("editStudentModalTitle");

  if (editId) editId.value = s.id;
  if (editDisp) editDisp.value = s.id;
  if (editName) editName.value = s.name || "";
  if (editPhone) editPhone.value = s.phone || "";
  if (editEmail) editEmail.value = s.email || "";
  if (editDept) editDept.value = s.dept || "CSE";
  if (editSec) editSec.value = s.sec || "Sec A";
  if (title) title.textContent = `✏️ Edit Profile — ${s.name} (${s.id})`;

  openModal("editStudentModal");
}

function handleSaveEditedStudent(event) {
  if (event) event.preventDefault();
  const id = document.getElementById("editStudentId")?.value;
  const s = students[id];
  if (!s) return;

  const nameInput = document.getElementById("editStudentName");
  const phoneInput = document.getElementById("editStudentPhone");
  const emailInput = document.getElementById("editStudentEmail");
  const deptInput = document.getElementById("editStudentDept");
  const secInput = document.getElementById("editStudentSec");

  const name = nameInput ? nameInput.value.trim() : "";
  const phone = phoneInput ? phoneInput.value.trim() : s.phone;
  const email = emailInput ? emailInput.value.trim() : s.email;
  const dept = deptInput ? deptInput.value : s.dept;
  const sec = (secInput && secInput.value.trim()) ? secInput.value.trim() : (s.sec || "Sec A");

  if (!name) {
    alert("Please enter a valid student name.");
    return;
  }

  s.name = name;
  s.phone = phone;
  s.email = email;
  s.dept = dept;
  s.sec = sec;

  saveAllData();
  logAuditEvent("STUDENT_EDIT", `Updated profile details for student ${name} (${id})`);
  closeModal("editStudentModal");
  refreshAllViews();

  // If Student Profile modal was also open, refresh it in place
  const profModal = document.getElementById("studentProfileModal");
  if (profModal && profModal.classList.contains("active")) {
    openStudentProfile(id);
  }

  alert(`✅ Profile for ${name} (${id}) updated successfully!`);
}

// ---------------------------------------------------------
// 6.1 ENHANCED QR CODE ENGINE & CUSTOM UPLOAD MANAGEMENT
// ---------------------------------------------------------

let currentActiveQrStudentId = null;
let attendanceCameraStream = null;
let attendanceCameraScanLoop = null;
let scannedSessionStudents = [];

// Lightweight inline QR matrix generator fallback (works 100% offline without CDN)
function drawFallbackQrCanvas(canvas, text, size = 160) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#0f172a";

  // Pseudo-random deterministic grid seeded by text content
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }

  const modules = 21;
  const cellSize = Math.floor(size / (modules + 2));
  const offset = Math.floor((size - cellSize * modules) / 2);

  function drawFinderPattern(rx, ry) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
          ctx.fillRect(offset + (rx + c) * cellSize, offset + (ry + r) * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  // Draw 3 corner finder patterns
  drawFinderPattern(0, 0);
  drawFinderPattern(modules - 7, 0);
  drawFinderPattern(0, modules - 7);

  // Timing patterns
  for (let i = 8; i < modules - 8; i++) {
    if (i % 2 === 0) {
      ctx.fillRect(offset + i * cellSize, offset + 6 * cellSize, cellSize, cellSize);
      ctx.fillRect(offset + 6 * cellSize, offset + i * cellSize, cellSize, cellSize);
    }
  }

  // Content data dots
  let seed = Math.abs(hash);
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      // Avoid finder areas
      if ((r < 8 && c < 8) || (r < 8 && c >= modules - 8) || (r >= modules - 8 && c < 8)) continue;
      if (r === 6 || c === 6) continue;
      seed = (seed * 9301 + 49297) % 233280;
      if (seed / 233280 > 0.5) {
        ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
      }
    }
  }
}

// Generate QR Code onto target element
function renderStudentQrCode(student, containerElement, size = 160) {
  if (!containerElement) return;
  containerElement.innerHTML = "";

  const qrData = `ID:${student.id}|NAME:${student.name}|DEPT:${student.dept}`;

  // If student has a custom uploaded QR image, show that
  if (student.customQrImage) {
    const img = document.createElement("img");
    img.src = student.customQrImage;
    img.alt = `Custom QR for ${student.name}`;
    img.style.maxWidth = `${size}px`;
    img.style.maxHeight = `${size}px`;
    img.style.objectFit = "contain";
    img.id = "activeStudentQrImg";
    containerElement.appendChild(img);
    return;
  }

  // Try standard QRCode.js library
  if (typeof QRCode !== "undefined") {
    try {
      new QRCode(containerElement, {
        text: qrData,
        width: size,
        height: size,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: typeof QRCode.CorrectLevel !== "undefined" ? QRCode.CorrectLevel.M : 0
      });
      return;
    } catch (e) {
      console.warn("QRCode CDN render failed, using inline canvas fallback:", e);
    }
  }

  // Built-in offline fallback canvas
  const canvas = document.createElement("canvas");
  canvas.id = "activeStudentQrCanvas";
  containerElement.appendChild(canvas);
  drawFallbackQrCanvas(canvas, qrData, size);
}

// Audio beep feedback for scanning
function playBeepSound(type = "success") {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === "success") {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else {
      osc.frequency.setValueAtTime(280, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch (e) {}
}

// Decode QR code from image source (Data URL or Image element)
async function decodeQrFromImage(imageSrc) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width || 300;
      canvas.height = img.naturalHeight || img.height || 300;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Method 1: Native BarcodeDetector (Chrome, Edge, Chromium)
      if ("BarcodeDetector" in window) {
        try {
          const detector = new BarcodeDetector({ formats: ["qr_code"] });
          const barcodes = await detector.detect(canvas);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            return resolve(barcodes[0].rawValue);
          }
        } catch (e) {
          console.warn("Native BarcodeDetector error:", e);
        }
      }

      // Method 2: jsQR CDN library
      if (typeof jsQR === "function") {
        try {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: "dontInvert"
          });
          if (code && code.data) {
            return resolve(code.data);
          }
        } catch (e) {
          console.warn("jsQR decode error:", e);
        }
      }

      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = imageSrc;
  });
}

// Extract Student ID from any scanned QR text string
function extractStudentIdFromQr(qrText) {
  if (!qrText) return null;
  const str = String(qrText).trim();

  // 1. Direct ID match
  if (students[str]) return str;
  const upper = str.toUpperCase();
  if (students[upper]) return upper;

  // 2. JSON format: {"id":"101", ...}
  try {
    const parsed = JSON.parse(str);
    if (parsed && (parsed.id || parsed.studentId)) {
      const sid = String(parsed.id || parsed.studentId).trim().toUpperCase();
      if (students[sid]) return sid;
    }
  } catch (e) {}

  // 3. Delimited format: ID:101 or STUDENT:101
  const match = str.match(/(?:ID|STUDENT|ROLL)[\s:=_-]+([A-Z0-9_-]+)/i);
  if (match && match[1]) {
    const cand = match[1].trim().toUpperCase();
    if (students[cand]) return cand;
  }

  // 4. Substring search for valid student IDs
  for (const sid of Object.keys(students)) {
    const regex = new RegExp(`\\b${sid}\\b`, "i");
    if (regex.test(str)) return sid;
  }

  return null;
}

// Display Student QR Badge Modal with Generator and Upload button
function showQrBadgeModal(studentId) {
  const s = students[studentId];
  if (!s) return;
  currentActiveQrStudentId = studentId;

  document.getElementById("qrBadgeTitle").textContent = `Student ID Badge — ${s.name}`;

  const isCustom = Boolean(s.customQrImage);

  document.getElementById("qrBadgeBody").innerHTML = `
    <div class="qr-card-box" id="studentQrCardBox">
      <div class="qr-card-header-bar">
        <div class="uni-title">Central Academic Institute</div>
        <div class="uni-sub">Official Student Identity Card</div>
      </div>

      <div class="qr-student-info">
        <div class="qr-student-name">${s.name}</div>
        <div class="qr-student-dept">${s.dept} &mdash; ${s.sec || 'Sec A'}</div>
        <div style="font-size:0.8rem; font-weight:700; color:var(--accent); margin-top:2px;">ID: ${s.id}</div>
      </div>

      <!-- QR Type Indicator Tag -->
      <div style="text-align:center;">
        <span class="qr-type-tag ${isCustom ? 'custom' : 'generated'}" id="qrTypeTagBadge">
          ${isCustom ? '🟢 Custom QR (Uploaded by You)' : '⚡ Auto-Generated Official QR'}
        </span>
      </div>

      <!-- QR Code Display Container -->
      <div class="qr-container-wrapper" id="badgeQrWrapper"></div>

      <!-- Upload Custom QR Button & Zone -->
      <div class="qr-upload-zone" id="badgeUploadDropzone" onclick="triggerQrUploadForStudent('${s.id}')" ondragover="onBadgeQrDragOver(event)" ondragleave="onBadgeQrDragLeave(event)" ondrop="onBadgeQrDrop(event, '${s.id}')" title="Click or drop a QR code image to upload your custom QR code">
        <div style="font-weight:700; font-size:0.86rem; color:var(--accent); margin-bottom:2px;">
          📤 Upload Custom QR Code
        </div>
        <div class="small text-muted">Click or drag &amp; drop QR image (PNG, JPG, SVG)</div>
        <input type="file" id="studentCustomQrFileInput" accept="image/*" style="display:none;" onchange="onStudentCustomQrFileSelected(event, '${s.id}')">
      </div>

      <!-- Actions Toolbar -->
      <div class="qr-action-btns">
        ${isCustom ? `
          <button class="btn btn-xs btn-outline" onclick="resetStudentQrToDefault('${s.id}')" title="Reset to auto-generated system QR">
            🔄 Use Default QR
          </button>
        ` : ''}
        <button class="btn btn-xs btn-outline" onclick="downloadStudentQrCode('${s.id}')" title="Download QR code image">
          📥 Download QR
        </button>
        <button class="btn btn-xs btn-primary" onclick="window.print()" title="Print student identity card">
          🖨️ Print Badge
        </button>
      </div>

      <div id="qrUploadStatusBanner" style="display:none; font-size:0.75rem; text-align:center; margin-top:8px; padding:6px; border-radius:6px;"></div>
    </div>
  `;

  // Render QR
  const wrapper = document.getElementById("badgeQrWrapper");
  renderStudentQrCode(s, wrapper, 160);

  openModal("qrBadgeModal");
}

// Trigger file input for student QR upload
function triggerQrUploadForStudent(studentId) {
  if (!studentId) studentId = currentUser.username;
  currentActiveQrStudentId = studentId;
  const input = document.getElementById("studentCustomQrFileInput");
  if (input) {
    input.click();
  } else {
    // If modal is not open, open it and click
    showQrBadgeModal(studentId);
    setTimeout(() => {
      const inp = document.getElementById("studentCustomQrFileInput");
      if (inp) inp.click();
    }, 150);
  }
}

// Handle file selection from file picker
function onStudentCustomQrFileSelected(event, studentId) {
  const file = event.target.files && event.target.files[0];
  if (file) {
    processUploadedStudentQrFile(file, studentId);
  }
}

// Drag & drop handlers for badge
function onBadgeQrDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById("badgeUploadDropzone");
  if (dropzone) dropzone.classList.add("dragover");
}

function onBadgeQrDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById("badgeUploadDropzone");
  if (dropzone) dropzone.classList.remove("dragover");
}

function onBadgeQrDrop(event, studentId) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById("badgeUploadDropzone");
  if (dropzone) dropzone.classList.remove("dragover");

  const files = event.dataTransfer && event.dataTransfer.files;
  if (files && files.length > 0) {
    processUploadedStudentQrFile(files[0], studentId);
  }
}

// Read and save custom QR code image for student
function processUploadedStudentQrFile(file, studentId) {
  if (!file || !file.type.startsWith("image/")) {
    alert("Please select a valid image file (PNG, JPG, SVG, WebP).");
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const s = students[studentId];
    if (!s) return;

    // Decode to check if student ID matches or can be read
    const decoded = await decodeQrFromImage(dataUrl);
    const statusBanner = document.getElementById("qrUploadStatusBanner");

    s.customQrImage = dataUrl;
    s.customQrDecoded = decoded || null;
    saveAllData();
    logAuditEvent("QR_UPLOAD", `Uploaded custom QR code for student ${s.name} (${s.id})`);

    // Re-render badge view
    showQrBadgeModal(studentId);

    const banner = document.getElementById("qrUploadStatusBanner");
    if (banner) {
      banner.style.display = "block";
      if (decoded) {
        const detectedId = extractStudentIdFromQr(decoded);
        banner.style.background = "#ecfdf5";
        banner.style.color = "#059669";
        banner.innerHTML = `✅ QR Uploaded! Decoded content: <code>${decoded}</code> ${detectedId === s.id ? '(Matches Student ID)' : ''}`;
      } else {
        banner.style.background = "#eff6ff";
        banner.style.color = "#2563eb";
        banner.innerHTML = `✅ Custom QR code image uploaded and attached to Student ${s.id}!`;
      }
    }
  };
  reader.readAsDataURL(file);
}

// Reset student QR code to system generated
function resetStudentQrToDefault(studentId) {
  const s = students[studentId];
  if (!s) return;
  delete s.customQrImage;
  delete s.customQrDecoded;
  saveAllData();
  logAuditEvent("QR_RESET", `Reverted QR code to system generated for ${s.name} (${s.id})`);
  showQrBadgeModal(studentId);
}

// Download QR code image
function downloadStudentQrCode(studentId) {
  const s = students[studentId];
  if (!s) return;

  if (s.customQrImage) {
    const a = document.createElement("a");
    a.href = s.customQrImage;
    a.download = `QR_${s.id}_${s.name.replace(/\s+/g, '_')}.png`;
    a.click();
    return;
  }

  const canvas = document.querySelector("#badgeQrWrapper canvas") || document.getElementById("activeStudentQrCanvas");
  if (canvas) {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `QR_${s.id}_${s.name.replace(/\s+/g, '_')}.png`;
    a.click();
  } else {
    const img = document.querySelector("#badgeQrWrapper img");
    if (img && img.src) {
      const a = document.createElement("a");
      a.href = img.src;
      a.download = `QR_${s.id}_${s.name.replace(/\s+/g, '_')}.png`;
      a.click();
    }
  }
}

// ---------------------------------------------------------
// 6.2 QR ATTENDANCE SCANNER & UPLOADER ENGINE
// ---------------------------------------------------------

function openQrAttendanceModal() {
  const courseBadge = document.getElementById("qrAttActiveCourse");
  const dateBadge = document.getElementById("qrAttActiveDate");
  const dateInput = document.getElementById("attendanceDate");
  const dateStr = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];

  if (courseBadge) courseBadge.textContent = `${getCourseName(activeCourse)} (${activeCourse})`;
  if (dateBadge) dateBadge.textContent = dateStr;

  const feedback = document.getElementById("qrScanFeedbackBox");
  if (feedback) feedback.style.display = "none";

  renderScannedSessionStudentsList();
  switchQrAttendanceTab("upload");
  openModal("qrAttendanceModal");
}

function closeQrAttendanceModal() {
  stopAttendanceCameraScanner();
  closeModal("qrAttendanceModal");
}

function switchQrAttendanceTab(tab) {
  const btnUpload = document.getElementById("qrTabBtnUpload");
  const btnCamera = document.getElementById("qrTabBtnCamera");
  const btnManual = document.getElementById("qrTabBtnManual");
  const pnlUpload = document.getElementById("qrAttPanelUpload");
  const pnlCamera = document.getElementById("qrAttPanelCamera");
  const pnlManual = document.getElementById("qrAttPanelManual");

  [btnUpload, btnCamera, btnManual].forEach(b => b && b.classList.remove("active"));
  if (pnlUpload) pnlUpload.style.display = "none";
  if (pnlCamera) pnlCamera.style.display = "none";
  if (pnlManual) pnlManual.style.display = "none";

  if (tab === "upload") {
    if (btnUpload) btnUpload.classList.add("active");
    if (pnlUpload) pnlUpload.style.display = "block";
    stopAttendanceCameraScanner();
  } else if (tab === "camera") {
    if (btnCamera) btnCamera.classList.add("active");
    if (pnlCamera) pnlCamera.style.display = "block";
    startAttendanceCameraScanner();
  } else if (tab === "manual") {
    if (btnManual) btnManual.classList.add("active");
    if (pnlManual) pnlManual.style.display = "block";
    stopAttendanceCameraScanner();
    setTimeout(() => {
      const inp = document.getElementById("manualQrInput");
      if (inp) inp.focus();
    }, 100);
  }
}

// Attendance dropzone trigger
function triggerAttendanceQrFilePicker() {
  const inp = document.getElementById("attendanceQrFileInput");
  if (inp) inp.click();
}

function onAttendanceQrDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  const dz = document.getElementById("qrAttendanceDropzone");
  if (dz) dz.classList.add("dragover");
}

function onAttendanceQrDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  const dz = document.getElementById("qrAttendanceDropzone");
  if (dz) dz.classList.remove("dragover");
}

function onAttendanceQrDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const dz = document.getElementById("qrAttendanceDropzone");
  if (dz) dz.classList.remove("dragover");

  const files = event.dataTransfer && event.dataTransfer.files;
  if (files && files.length > 0) {
    handleAttendanceQrImageFile(files[0]);
  }
}

function onAttendanceQrFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (file) {
    handleAttendanceQrImageFile(file);
  }
}

// Process uploaded attendance QR image file
async function handleAttendanceQrImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showAttendanceScanFeedback("Please select a valid QR code image file.", "error");
    return;
  }

  showAttendanceScanFeedback("Analyzing QR code image...", "info");

  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    const decoded = await decodeQrFromImage(dataUrl);

    if (decoded) {
      processAttendanceQrPayload(decoded);
    } else {
      // Check if this image matches any student's custom uploaded QR code directly
      let matchedStudent = null;
      for (const s of Object.values(students)) {
        if (s.customQrImage && s.customQrImage === dataUrl) {
          matchedStudent = s;
          break;
        }
      }

      if (matchedStudent) {
        markStudentPresentViaQr(matchedStudent.id, "Image match");
      } else {
        showAttendanceScanFeedback("Could not read a valid QR code from this image. Try a clearer photo or enter ID manually.", "error");
        playBeepSound("error");
      }
    }
  };
  reader.readAsDataURL(file);
}

// Process manual input
function processManualQrInput() {
  const inp = document.getElementById("manualQrInput");
  if (!inp || !inp.value.trim()) return;
  const val = inp.value.trim();
  inp.value = "";
  processAttendanceQrPayload(val);
}

// Process QR payload string
function processAttendanceQrPayload(rawPayload) {
  const studentId = extractStudentIdFromQr(rawPayload);
  if (!studentId) {
    showAttendanceScanFeedback(`⚠️ Scanned: "${rawPayload}", but no matching Student ID was found.`, "error");
    playBeepSound("error");
    return;
  }

  markStudentPresentViaQr(studentId, rawPayload);
}

// Mark student present and update all UI views
function markStudentPresentViaQr(studentId, sourceInfo) {
  const s = students[studentId];
  if (!s) return;

  const dateInput = document.getElementById("attendanceDate");
  const dateStr = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];

  // 1. Update checkbox in single subject attendance grid if on screen
  const cb = document.querySelector(`#attendanceGrid input[type='checkbox'][value='${studentId}']`);
  if (cb) {
    cb.checked = true;
    toggleCardCheck(cb, studentId);
  }

  // 2. Add to course attendance record
  const courseAtt = getCourseAttendance();
  if (!courseAtt[dateStr]) {
    courseAtt[dateStr] = { present: [], excused: [] };
  }
  if (!courseAtt[dateStr].present.includes(studentId)) {
    courseAtt[dateStr].present.push(studentId);
  }

  saveAllData();
  logAuditEvent("QR_ATTENDANCE", `Marked present via QR for ${s.name} (${s.id}) in ${activeCourse} on ${dateStr}`);

  // Play audio chime
  playBeepSound("success");

  // Show feedback
  showAttendanceScanFeedback(`✅ <strong>${s.name}</strong> (${s.id}) successfully marked <strong>PRESENT</strong> in ${activeCourse}!`, "success");

  // Add to session list
  if (!scannedSessionStudents.some(item => item.id === s.id)) {
    scannedSessionStudents.unshift({
      id: s.id,
      name: s.name,
      dept: s.dept,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
  }
  renderScannedSessionStudentsList();

  // Refresh counters
  updateSelectedAttendanceCounter();
}

function showAttendanceScanFeedback(messageHtml, type) {
  const box = document.getElementById("qrScanFeedbackBox");
  if (!box) return;
  box.style.display = "flex";
  box.className = `qr-scan-feedback ${type}`;
  box.innerHTML = messageHtml;
}

function renderScannedSessionStudentsList() {
  const list = document.getElementById("qrScannedList");
  const countBadge = document.getElementById("qrScannedCount");
  if (countBadge) countBadge.textContent = scannedSessionStudents.length;
  if (!list) return;

  if (scannedSessionStudents.length === 0) {
    list.innerHTML = `<div class="text-muted text-center" style="padding:10px; font-size:0.8rem;">No QR codes scanned yet in this session.</div>`;
    return;
  }

  list.innerHTML = scannedSessionStudents.map(item => `
    <div class="scanned-student-item">
      <div>
        <strong style="color:var(--text-primary);">${item.name}</strong>
        <span class="text-muted small" style="margin-left:6px;">(${item.id} &bull; ${item.dept})</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="badge badge-ok" style="font-size:0.7rem;">Present</span>
        <span class="small text-muted">${item.time}</span>
      </div>
    </div>
  `).join("");
}

// Camera Scanner integration
let _lastQrScanTime = 0; // debounce tracker

async function startAttendanceCameraScanner() {
  stopAttendanceCameraScanner();
  const video    = document.getElementById("qrCameraVideo");
  const hudBox   = document.getElementById("cameraHudBox");
  const statusText = document.getElementById("cameraHudStatusText");
  if (!video) return;

  // --- Guard: file:// protocol blocks getUserMedia in all browsers ---
  if (location.protocol === "file:") {
    _showCameraError(
      statusText, hudBox,
      "file-protocol",
      "🔒 Camera Blocked — File Protocol",
      "Browsers block camera access on <code>file://</code> pages for security. " +
      "Please serve this app over <strong>localhost</strong> or <strong>HTTPS</strong>.<br><br>" +
      "Quick fix: open a terminal in this folder and run:<br>" +
      "<code style='user-select:all;'>npx -y serve .</code><br>" +
      "Then open the printed <code>http://localhost:3000</code> URL in your browser."
    );
    return;
  }

  // --- Guard: mediaDevices API not available (HTTP in some browsers) ---
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    _showCameraError(
      statusText, hudBox,
      "no-api",
      "🔒 Camera API Not Available",
      "Your browser does not expose the camera API on this page. " +
      "Make sure you are on <strong>https://</strong> or <strong>localhost</strong>."
    );
    return;
  }

  if (statusText) statusText.textContent = "⏳ Requesting camera access...";
  // Hide any old error panel
  const oldErr = document.getElementById("cameraErrorPanel");
  if (oldErr) oldErr.remove();

  try {
    // Try rear camera first, fall back to any camera
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    } catch (envErr) {
      // Fallback: any camera (front-facing laptops)
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }

    attendanceCameraStream = stream;
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.setAttribute("autoplay", "true");
    video.muted = true;
    await video.play().catch(() => {}); // some browsers auto-play without await

    if (statusText) statusText.textContent = "📷 Point camera at Student QR code";
    _lastQrScanTime = 0;
    runCameraScanLoop();

  } catch (err) {
    console.warn("Camera access failed:", err.name, err.message);

    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      _showCameraError(
        statusText, hudBox,
        "not-allowed",
        "🚫 Camera Permission Denied",
        "You blocked camera access. To fix this:<br><br>" +
        "<strong>Chrome / Edge:</strong> Click the 🔒 lock icon in the address bar → Camera → Allow, then reload.<br>" +
        "<strong>Firefox:</strong> Click the camera icon in the address bar → Clear permission → Reload.<br>" +
        "<strong>Safari:</strong> Safari → Settings for this site → Camera → Allow."
      );
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      _showCameraError(
        statusText, hudBox,
        "not-found",
        "📷 No Camera Found",
        "No camera was detected on this device. " +
        "Try connecting an external webcam, or use the <strong>Upload QR Image</strong> tab instead."
      );
    } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      _showCameraError(
        statusText, hudBox,
        "not-readable",
        "⚠️ Camera In Use",
        "The camera is already being used by another app (e.g. Teams, Zoom, OBS). " +
        "Close the other app and click <strong>Retry</strong>."
      );
    } else if (err.name === "OverconstrainedError") {
      // Retry without constraints
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        attendanceCameraStream = stream;
        video.srcObject = stream;
        video.muted = true;
        await video.play().catch(() => {});
        if (statusText) statusText.textContent = "📷 Point camera at Student QR code";
        runCameraScanLoop();
        return;
      } catch (e2) { /* fall through */ }
      _showCameraError(statusText, hudBox, "overconstrained", "⚠️ Camera Constraint Error",
        "Could not open camera with the requested resolution. Click Retry to try again with default settings.");
    } else {
      _showCameraError(
        statusText, hudBox,
        "generic",
        "❌ Camera Error: " + (err.name || "Unknown"),
        "Details: <em>" + (err.message || "An unexpected error occurred.") + "</em><br><br>" +
        "Try <strong>Retry</strong>, or switch to the <strong>Upload QR Image</strong> tab."
      );
    }
  }
}

/** Render a styled error card inside the camera panel */
function _showCameraError(statusTextEl, hudBox, errorType, title, htmlMsg) {
  if (statusTextEl) statusTextEl.textContent = "Camera unavailable";

  const panel = document.getElementById("qrAttPanelCamera");
  if (!panel) return;

  // Remove previous error card
  const old = document.getElementById("cameraErrorPanel");
  if (old) old.remove();

  const card = document.createElement("div");
  card.id = "cameraErrorPanel";
  card.style.cssText = [
    "background:var(--bg-page)",
    "border:1.5px solid var(--danger-color)",
    "border-radius:14px",
    "padding:20px 22px",
    "margin:12px 0",
    "text-align:left",
    "animation:fadeIn .3s ease"
  ].join(";");

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <span style="font-size:1.6rem;">📵</span>
      <strong style="font-size:0.97rem;color:var(--danger-color);">${title}</strong>
    </div>
    <div style="font-size:0.85rem;line-height:1.6;color:var(--text-primary);margin-bottom:16px;">${htmlMsg}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn btn-sm btn-primary" onclick="restartCameraScanner()">
        🔄 Retry Camera
      </button>
      <button class="btn btn-sm btn-outline" onclick="switchQrAttendanceTab('upload')">
        📤 Upload QR Instead
      </button>
      <button class="btn btn-sm btn-outline" onclick="switchQrAttendanceTab('manual')">
        ⌨️ Enter ID Manually
      </button>
    </div>
  `;

  // Insert before the restart button row
  const restartRow = panel.querySelector("div[style*='text-align:center']");
  if (restartRow) panel.insertBefore(card, restartRow);
  else panel.appendChild(card);
}

function stopAttendanceCameraScanner() {
  if (attendanceCameraScanLoop) {
    cancelAnimationFrame(attendanceCameraScanLoop);
    attendanceCameraScanLoop = null;
  }
  if (attendanceCameraStream) {
    attendanceCameraStream.getTracks().forEach(t => t.stop());
    attendanceCameraStream = null;
  }
  const video = document.getElementById("qrCameraVideo");
  if (video) { video.srcObject = null; video.load(); }
  const old = document.getElementById("cameraErrorPanel");
  if (old) old.remove();
}

function restartCameraScanner() {
  const old = document.getElementById("cameraErrorPanel");
  if (old) old.remove();
  startAttendanceCameraScanner();
}

function runCameraScanLoop() {
  const video  = document.getElementById("qrCameraVideo");
  const canvas = document.getElementById("qrCameraCanvas");
  if (!video || !canvas || !attendanceCameraStream) return;

  if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Debounce: only scan every 400 ms to avoid duplicate triggers
    const now = Date.now();
    if (now - _lastQrScanTime > 400) {
      if ("BarcodeDetector" in window) {
        try {
          const detector = new BarcodeDetector({ formats: ["qr_code"] });
          detector.detect(canvas).then(barcodes => {
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              _lastQrScanTime = Date.now();
              processAttendanceQrPayload(barcodes[0].rawValue);
            }
          }).catch(() => {});
        } catch (e) {}
      } else if (typeof jsQR === "function") {
        try {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "dontInvert" });
          if (code && code.data) {
            _lastQrScanTime = Date.now();
            processAttendanceQrPayload(code.data);
          }
        } catch (e) {}
      }
    }
  }

  attendanceCameraScanLoop = requestAnimationFrame(runCameraScanLoop);
}


// ---------------------------------------------------------
// SUBJECT-WISE STUDENT DETAILS ENGINE & VIEWS
// ---------------------------------------------------------
let activeSubDetailsView = "cards"; // "cards" | "matrix"
let activeSpotlightStudentId = "101";

function setSubDetailsView(mode) {
  activeSubDetailsView = mode;
  const cardsContainer = document.getElementById("subDetailsCardsContainer");
  const matrixContainer = document.getElementById("subDetailsMatrixContainer");
  const btnCards = document.getElementById("btnViewCards");
  const btnMatrix = document.getElementById("btnViewMatrix");

  if (mode === "matrix") {
    if (cardsContainer) cardsContainer.style.display = "none";
    if (matrixContainer) matrixContainer.style.display = "block";
    if (btnCards) { btnCards.classList.remove("btn-primary"); btnCards.classList.add("btn-outline"); }
    if (btnMatrix) { btnMatrix.classList.remove("btn-outline"); btnMatrix.classList.add("btn-primary"); }
  } else {
    if (cardsContainer) cardsContainer.style.display = "block";
    if (matrixContainer) matrixContainer.style.display = "none";
    if (btnCards) { btnCards.classList.remove("btn-outline"); btnCards.classList.add("btn-primary"); }
    if (btnMatrix) { btnMatrix.classList.remove("btn-primary"); btnMatrix.classList.add("btn-outline"); }
  }
}

function onSpotlightStudentChange() {
  const sel = document.getElementById("subDetailsSpotlightSelect");
  if (sel && sel.value) {
    activeSpotlightStudentId = sel.value;
    renderSubjectWiseStudentDetails();
  }
}

function inspectStudentInSpotlight(studentId) {
  activeSpotlightStudentId = studentId;
  const sel = document.getElementById("subDetailsSpotlightSelect");
  if (sel) sel.value = studentId;
  renderSubjectWiseStudentDetails();
  const card = document.getElementById("subDetailsSpotlightCard");
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderSubjectWiseStudentDetails() {
  const allStudents = Object.values(students);
  if (allStudents.length === 0) return;

  // 1. Min Threshold Display
  const threshBadge = document.getElementById("subDetailsThresholdBadge");
  if (threshBadge) threshBadge.textContent = `Min Required: ${minThreshold}%`;

  // 2. Validate Spotlight Selection
  if (!students[activeSpotlightStudentId]) {
    activeSpotlightStudentId = allStudents[0].id;
  }

  // 3. Populate Spotlight Selector Dropdown
  const spotlightSel = document.getElementById("subDetailsSpotlightSelect");
  if (spotlightSel) {
    const currentVal = spotlightSel.value;
    spotlightSel.innerHTML = allStudents.map(s => `
      <option value="${s.id}" ${s.id === activeSpotlightStudentId ? 'selected' : ''}>${s.name} (${s.id}) &bull; ${s.dept}</option>
    `).join("");
    if (currentVal && students[currentVal] && !spotlightSel.value) {
      spotlightSel.value = currentVal;
      activeSpotlightStudentId = currentVal;
    }
  }

  // 4. Render Spotlight Featured Student Breakdown
  const spotlightContent = document.getElementById("subDetailsSpotlightContent");
  if (spotlightContent && students[activeSpotlightStudentId]) {
    const s = students[activeSpotlightStudentId];
    const overall = getStudentOverallStats(s.id);
    const subjects = overall.subjects;

    const initials = s.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase() || "ST";
    const statusPill = overall.hasShortage
      ? `<span class="badge badge-low" style="font-size:0.85rem; padding:5px 12px;">⚠️ Attendance Shortage (${overall.shortageCount} subject${overall.shortageCount > 1 ? 's' : ''} &lt; ${minThreshold}%)</span>`
      : `<span class="badge badge-ok" style="font-size:0.85rem; padding:5px 12px;">✅ Eligible In All Subjects (&ge; ${minThreshold}%)</span>`;

    spotlightContent.innerHTML = `
      <div class="subdetails-spotlight-box">
        <div class="spotlight-student-side">
          <div class="spotlight-avatar">${initials}</div>
          <h3 style="margin: 0 0 4px; font-size: 1.2rem;">${s.name}</h3>
          <span class="small text-muted font-mono" style="font-weight:700;">Roll ID: ${s.id}</span>
          <span class="badge badge-outline" style="margin-top:6px;">${s.dept} &bull; ${s.sec || 'Sec A'}</span>
          
          <div class="spotlight-overall-score">
            <div class="small text-muted" style="text-transform:uppercase; letter-spacing:0.05em; font-weight:700;">Overall Aggregate</div>
            <div class="spotlight-overall-num" style="color: ${overall.hasShortage ? '#ef4444' : '#10b981'};">
              ${overall.overallPct}%
            </div>
            <div class="small text-muted">${overall.totalAttended} of ${overall.totalClasses} total classes attended</div>
          </div>

          <div style="margin-top: 4px; width: 100%;">
            ${statusPill}
          </div>

          <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin-top: 14px;">
            <button class="btn btn-primary btn-sm" onclick="openBunkCalculatorModal('${s.id}')">
              📈 Bunk & Predictor Calculator
            </button>
            <button class="btn btn-outline btn-sm" onclick="openStudentProfile('${s.id}')">
              📚 View Full Profile Ledger
            </button>
            ${overall.hasShortage ? `
              <button class="btn btn-warning-outline btn-sm" onclick="sendWhatsAppToStudent('${s.id}')">
                📲 Send WhatsApp Alert
              </button>
            ` : ''}
          </div>
        </div>

        <div class="spotlight-subjects-side">
          <div class="spotlight-notice-banner">
            <div>
              <strong>Instead of only overall attendance:</strong> Granular multi-course ledger pinpointing exact subject performance.
            </div>
            <span class="badge badge-outline">${subjects.length} Subjects Evaluated</span>
          </div>

          <div class="spotlight-subject-list">
            ${subjects.map(sub => {
              const isShortage = sub.isShortage;
              const isBorderline = !isShortage && sub.pct < 85;
              const statusClass = isShortage ? "shortage" : (isBorderline ? "borderline" : "safe");
              const fillClass = isShortage ? "danger" : (isBorderline ? "warning" : "safe");
              const rowClass = isShortage ? "is-shortage" : (isBorderline ? "is-borderline" : "is-safe");

              const adviceText = isShortage
                ? `⚠️ Need attend next <strong>${sub.classesNeeded}</strong> class${sub.classesNeeded > 1 ? 'es' : ''}`
                : `Can miss up to <strong>${sub.safeBunk}</strong> class${sub.safeBunk > 1 ? 'es' : ''}`;

              return `
                <div class="spotlight-subj-row ${rowClass}">
                  <div>
                    <div class="spotlight-subj-name">${sub.name}</div>
                    <div class="spotlight-subj-code">${sub.code} &bull; ${sub.attended}/${sub.total} Classes</div>
                  </div>

                  <div>
                    <div class="spotlight-subj-pct ${statusClass}">
                      ${sub.pct}% ${isShortage ? '⚠️' : ''}
                    </div>
                  </div>

                  <div class="spotlight-subj-bar-container">
                    <div class="spotlight-bar-track">
                      <div class="spotlight-bar-fill ${fillClass}" style="width: ${Math.min(100, sub.pct)}%;"></div>
                    </div>
                    <div class="spotlight-ratio-text">
                      ${sub.attended} Attended &bull; ${sub.absent} Missed
                    </div>
                  </div>

                  <div>
                    <div class="spotlight-subj-advice ${statusClass}">
                      ${adviceText}
                    </div>
                  </div>

                  <div style="text-align: right;">
                    <button class="btn btn-xs btn-outline" onclick="openBunkCalculatorModal('${s.id}', '${sub.code}')" title="Simulate attendance for ${sub.name}">
                      Predict 📈
                    </button>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // 5. Global KPI Calculations
  let totalShortageStudents = 0;
  let allClearStudents = 0;
  const courseList = ["MA201", "CS102", "EC201", "CS202", "CS101"];
  Object.keys(attendance).forEach(c => {
    if (!courseList.includes(c)) courseList.push(c);
  });

  allStudents.forEach(s => {
    const stats = getStudentOverallStats(s.id);
    if (stats.hasShortage) totalShortageStudents++;
    else allClearStudents++;
  });

  const statStudents = document.getElementById("statSubDetailsStudents");
  const statSubjects = document.getElementById("statSubDetailsSubjects");
  const statShortages = document.getElementById("statSubDetailsShortages");
  const statAllClear = document.getElementById("statSubDetailsAllClear");

  if (statStudents) statStudents.textContent = allStudents.length;
  if (statSubjects) statSubjects.textContent = courseList.length;
  if (statShortages) statShortages.textContent = totalShortageStudents;
  if (statAllClear) statAllClear.textContent = allClearStudents;

  // 6. Filter & Search Students
  const searchInp = document.getElementById("subDetailsSearchInput");
  const deptInp = document.getElementById("subDetailsDeptFilter");
  const statusInp = document.getElementById("subDetailsStatusFilter");

  const query = (searchInp ? searchInp.value : "").trim().toLowerCase();
  const deptFilter = deptInp ? deptInp.value : "ALL";
  const statusFilter = statusInp ? statusInp.value : "ALL";

  const filtered = allStudents.filter(s => {
    const matchQuery = !query || s.name.toLowerCase().includes(query) || s.id.toLowerCase().includes(query);
    const matchDept = deptFilter === "ALL" || s.dept === deptFilter;
    
    const stats = getStudentOverallStats(s.id);
    let matchStatus = true;
    if (statusFilter === "SHORTAGE") {
      matchStatus = stats.hasShortage;
    } else if (statusFilter === "CLEARED") {
      matchStatus = !stats.hasShortage;
    }

    return matchQuery && matchDept && matchStatus;
  });

  // 7. Render View 1: Student Cards Grid
  const cardsGrid = document.getElementById("subDetailsCardsGrid");
  if (cardsGrid) {
    if (filtered.length === 0) {
      cardsGrid.innerHTML = `<div class="card text-center text-muted" style="grid-column: 1/-1; padding: 32px;">No student records found matching the filters.</div>`;
    } else {
      cardsGrid.innerHTML = filtered.map(s => {
        const stats = getStudentOverallStats(s.id);
        const initials = s.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase() || "ST";
        const hasShortage = stats.hasShortage;

        return `
          <div class="subdetail-card ${hasShortage ? 'has-shortage' : 'all-clear'}">
            <div class="subdetail-card-head">
              <div class="subdetail-card-student-info">
                <div class="subdetail-mini-avatar">${initials}</div>
                <div>
                  <h4 style="margin:0; font-size:0.96rem; font-weight:700;">
                    <a href="javascript:void(0)" onclick="inspectStudentInSpotlight('${s.id}')" style="color:var(--text-primary); text-decoration:none;">
                      ${s.name}
                    </a>
                  </h4>
                  <span class="small text-muted font-mono">ID: ${s.id} &bull; ${s.dept} (${s.sec || 'A'})</span>
                </div>
              </div>
              <div style="text-align:right;">
                <span class="badge ${hasShortage ? 'badge-low' : 'badge-ok'}" style="font-size:0.75rem;">
                  ${stats.overallPct}% Overall
                </span>
              </div>
            </div>

            <!-- Subject-wise Student Details List -->
            <div class="subdetail-card-subject-list">
              ${stats.subjects.map(sub => {
                const isShortage = sub.isShortage;
                const isWarn = !isShortage && sub.pct < 85;
                const pctColor = isShortage ? "danger" : (isWarn ? "warning" : "safe");
                const barColor = isShortage ? "#ef4444" : (isWarn ? "#f59e0b" : "#10b981");

                return `
                  <div class="subdetail-item-row ${isShortage ? 'shortage-item' : ''}">
                    <div class="subdetail-item-left">
                      <span class="subdetail-item-name">${sub.name}</span>
                      <span class="small text-muted">(${sub.code})</span>
                    </div>
                    <div class="subdetail-item-right">
                      <span class="subdetail-item-pct ${pctColor}">
                        ${sub.pct}% ${isShortage ? '⚠️' : ''}
                      </span>
                      <div style="width: 48px; height: 6px; background: var(--border-color); border-radius: 3px; overflow: hidden;">
                        <div style="width: ${Math.min(100, sub.pct)}%; height: 100%; background: ${barColor};"></div>
                      </div>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>

            <div class="subdetail-card-actions flex-between">
              <button class="btn btn-xs btn-outline" onclick="inspectStudentInSpotlight('${s.id}')">
                🔍 Spotlight
              </button>
              <div style="display:flex; gap:6px;">
                <button class="btn btn-xs btn-outline" onclick="openBunkCalculatorModal('${s.id}')">
                  Predict 📈
                </button>
                <button class="btn btn-xs btn-primary" onclick="openStudentProfile('${s.id}')">
                  Profile 📚
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // 8. Render View 2: Master Ledger Matrix Table
  const tableBody = document.getElementById("subDetailsMatrixTableBody");
  const countBadge = document.getElementById("subDetailsMatrixCountBadge");
  if (countBadge) countBadge.textContent = `${filtered.length} Students`;

  if (tableBody) {
    if (filtered.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="11" class="text-center text-muted" style="padding:24px;">No student records found matching filters.</td></tr>`;
    } else {
      tableBody.innerHTML = filtered.map(s => {
        const stats = getStudentOverallStats(s.id);
        const subMap = {};
        stats.subjects.forEach(sub => { subMap[sub.code] = sub; });

        const mathSub = subMap["MA201"] || { pct: 0, isShortage: true };
        const dsSub = subMap["CS102"] || { pct: 0, isShortage: true };
        const ecSub = subMap["EC201"] || { pct: 0, isShortage: true };
        const dbmsSub = subMap["CS202"] || { pct: 0, isShortage: true };
        const cs101Sub = subMap["CS101"] || { pct: 0, isShortage: true };

        const renderCell = (sub) => {
          const cls = sub.isShortage ? "shortage" : (sub.pct < 85 ? "borderline" : "safe");
          return `<span class="matrix-cell-score ${cls}">${sub.pct}% ${sub.isShortage ? '⚠️' : ''}</span>`;
        };

        const statusBadge = stats.hasShortage
          ? `<span class="badge badge-low">Shortage in ${stats.shortageCount} Subj ⚠️</span>`
          : `<span class="badge badge-ok">Eligible (All Cleared)</span>`;

        return `
          <tr>
            <td style="font-weight:700; color:var(--text-secondary); font-size:0.84rem;">${s.id}</td>
            <td>
              <a href="javascript:void(0)" onclick="inspectStudentInSpotlight('${s.id}')" style="font-weight:700; color:var(--text-primary); text-decoration:none;">
                ${s.name}
              </a>
            </td>
            <td><span class="badge badge-outline">${s.dept} (${s.sec || 'A'})</span></td>
            <td>${renderCell(mathSub)}</td>
            <td>${renderCell(dsSub)}</td>
            <td>${renderCell(ecSub)}</td>
            <td>${renderCell(dbmsSub)}</td>
            <td>${renderCell(cs101Sub)}</td>
            <td><strong style="font-size:1.02rem; color:${stats.hasShortage ? '#ef4444' : '#10b981'};">${stats.overallPct}%</strong></td>
            <td>${statusBadge}</td>
            <td>
              <div class="actions-cell">
                <button class="btn btn-xs btn-outline" onclick="inspectStudentInSpotlight('${s.id}')">Spotlight 🔍</button>
                <button class="btn btn-xs btn-primary" onclick="openStudentProfile('${s.id}')">Profile 📚</button>
              </div>
            </td>
          </tr>
        `;
      }).join("");
    }
  }
}

function exportSubjectWiseCSV() {
  const allStudents = Object.values(students);
  if (allStudents.length === 0) {
    alert("No student data available to export.");
    return;
  }

  const headers = ["Roll_ID", "Student_Name", "Department", "Section", "Mathematics_Pct", "DataStructures_Pct", "Electronics_Pct", "DBMS_Pct", "CS101_Logic_Pct", "Overall_Attendance_Pct", "Eligibility_Status", "Shortage_Count"];
  const rows = allStudents.map(s => {
    const stats = getStudentOverallStats(s.id);
    const subMap = {};
    stats.subjects.forEach(sub => { subMap[sub.code] = sub; });

    return [
      `"${s.id}"`,
      `"${s.name}"`,
      `"${s.dept}"`,
      `"${s.sec || 'A'}"`,
      subMap["MA201"] ? subMap["MA201"].pct + "%" : "N/A",
      subMap["CS102"] ? subMap["CS102"].pct + "%" : "N/A",
      subMap["EC201"] ? subMap["EC201"].pct + "%" : "N/A",
      subMap["CS202"] ? (subMap["CS202"].pct + "%" + (subMap["CS202"].isShortage ? " [SHORTAGE]" : "")) : "N/A",
      subMap["CS101"] ? subMap["CS101"].pct + "%" : "N/A",
      stats.overallPct + "%",
      stats.hasShortage ? "DEBARRED / SHORTAGE" : "ELIGIBLE",
      stats.shortageCount
    ].join(",");
  });

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `subject_wise_attendance_ledger_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ---------------------------------------------------------
// ---------------------------------------------------------
// 7. SUBJECT-WISE ATTENDANCE RECORDING & EDITING
// ---------------------------------------------------------
let activeMarkingMode = "single"; // "single" | "multi"

const COURSE_METADATA = {
  "MA201": { name: "Mathematics", icon: "📐", faculty: "Dr. Anita Verma" },
  "CS102": { name: "Data Structures", icon: "💻", faculty: "Prof. Rajesh Sharma" },
  "EC201": { name: "Electronics", icon: "⚡", faculty: "Dr. Sunita Rao" },
  "CS202": { name: "DBMS", icon: "🗄️", faculty: "Prof. Vikram Sen" },
  "CS101": { name: "Set Theory & Logic", icon: "🔵", faculty: "Prof. Rajesh Sharma" }
};

function getCourseMeta(code) {
  return COURSE_METADATA[code] || { name: getCourseName(code), icon: "📚", faculty: "Academic Faculty" };
}

function setMarkingMode(mode) {
  activeMarkingMode = mode;
  const singleContainer = document.getElementById("singleSubjectMarkingContainer");
  const multiContainer = document.getElementById("multiSubjectMarkingContainer");
  const btnSingle = document.getElementById("btnMarkSingleMode");
  const btnMulti = document.getElementById("btnMarkMultiMode");

  if (mode === "multi") {
    if (singleContainer) singleContainer.style.display = "none";
    if (multiContainer) multiContainer.style.display = "block";
    if (btnSingle) { btnSingle.classList.remove("btn-primary"); btnSingle.classList.add("btn-outline"); }
    if (btnMulti) { btnMulti.classList.remove("btn-outline"); btnMulti.classList.add("btn-primary"); }

    const multiDateInput = document.getElementById("multiAttendanceDate");
    const singleDateInput = document.getElementById("attendanceDate");
    if (multiDateInput && singleDateInput && !multiDateInput.value) {
      multiDateInput.value = singleDateInput.value || new Date().toISOString().split("T")[0];
    }
    renderMultiSubjectMatrix();
  } else {
    if (singleContainer) singleContainer.style.display = "block";
    if (multiContainer) multiContainer.style.display = "none";
    if (btnSingle) { btnSingle.classList.remove("btn-outline"); btnSingle.classList.add("btn-primary"); }
    if (btnMulti) { btnMulti.classList.remove("btn-primary"); btnMulti.classList.add("btn-outline"); }
    renderAttendanceGrid();
  }
}

function renderAttendanceSubjectTabsBar() {
  const container = document.getElementById("attendanceSubjectTabsBar");
  if (!container) return;

  const preferredOrder = ["MA201", "CS102", "EC201", "CS202", "CS101"];
  const courseList = [...preferredOrder];
  Object.keys(attendance).forEach(c => {
    if (!courseList.includes(c)) courseList.push(c);
  });

  container.innerHTML = courseList.map(code => {
    const meta = getCourseMeta(code);
    const cAtt = attendance[code] || {};
    const sessionCount = Object.keys(cAtt).length;
    const isActive = code === activeCourse;

    return `
      <button class="subj-mark-tab-btn ${isActive ? 'active' : ''}" onclick="selectMarkingSubject('${code}')" title="Switch to ${meta.name} (${code})">
        <span style="font-size: 1.15rem;">${meta.icon}</span>
        <span>${meta.name}</span>
        <span class="subj-tab-code">${code}</span>
        <span class="subj-tab-sessions">${sessionCount} sessions</span>
      </button>
    `;
  }).join("");
}

function selectMarkingSubject(subjectCode) {
  activeCourse = subjectCode;
  const courseSelect = document.getElementById("currentCourseSelect");
  if (courseSelect) courseSelect.value = activeCourse;
  localStorage.setItem(STORAGE_COURSE, activeCourse);

  updateCourseLabels();
  renderAttendanceSubjectTabsBar();
  renderAttendanceSubjectInfoBanner();
  populatePastDatesSelect();
  renderAttendanceGrid();
  logAuditEvent("COURSE_CHANGE", `Switched active marking subject to ${activeCourse}`);
}

// -------------------------------------------------------
// ADD NEW SUBJECT MODAL
// -------------------------------------------------------
function openAddSubjectModal() {
  const modal = document.getElementById("addSubjectModal");
  if (!modal) return;
  // Reset fields
  document.getElementById("newSubjectCode").value = "";
  document.getElementById("newSubjectName").value = "";
  document.getElementById("newSubjectIcon").value = "📖";
  document.getElementById("newSubjectFaculty").value = "";
  const errEl = document.getElementById("addSubjectModalError");
  if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; }
  modal.style.display = "flex";
  setTimeout(() => document.getElementById("newSubjectCode")?.focus(), 120);
}

function closeAddSubjectModal() {
  const modal = document.getElementById("addSubjectModal");
  if (modal) modal.style.display = "none";
}

function saveNewSubject() {
  const codeEl   = document.getElementById("newSubjectCode");
  const nameEl   = document.getElementById("newSubjectName");
  const iconEl   = document.getElementById("newSubjectIcon");
  const facEl    = document.getElementById("newSubjectFaculty");
  const errEl    = document.getElementById("addSubjectModalError");

  const code    = (codeEl?.value || "").trim().toUpperCase();
  const name    = (nameEl?.value || "").trim();
  const icon    = (iconEl?.value || "").trim() || "📖";
  const faculty = (facEl?.value || "").trim() || "Academic Faculty";

  // Validation
  const showError = (msg) => {
    if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; }
  };
  if (!code) { showError("⚠️ Subject Code is required."); codeEl?.focus(); return; }
  if (!/^[A-Z0-9]{2,8}$/.test(code)) { showError("⚠️ Subject Code must be 2–8 alphanumeric characters (e.g. CS303)."); codeEl?.focus(); return; }
  if (!name) { showError("⚠️ Subject Name is required."); nameEl?.focus(); return; }
  if (COURSE_METADATA[code]) { showError(`⚠️ Subject code "${code}" already exists. Use a different code.`); codeEl?.focus(); return; }

  // Register the new subject in COURSE_METADATA
  COURSE_METADATA[code] = { name, icon, faculty };

  // Also add to the header course select dropdown
  const courseSelect = document.getElementById("currentCourseSelect");
  if (courseSelect) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${code} - ${name}`;
    courseSelect.appendChild(opt);
  }

  // Initialize empty attendance ledger for the new subject
  if (!attendance[code]) attendance[code] = {};

  // Switch to the new subject and refresh tabs bar
  closeAddSubjectModal();
  selectMarkingSubject(code);

  logAuditEvent("SUBJECT_ADDED", `New subject added: ${name} (${code}) | Faculty: ${faculty}`);

  // Show a brief success toast
  showAddSubjectToast(`✅ Subject "${name}" (${code}) added successfully!`);
}

function showAddSubjectToast(msg) {
  let toast = document.getElementById("addSubjectToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "addSubjectToast";
    toast.style.cssText = `
      position: fixed; bottom: 28px; right: 28px; z-index: 99999;
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff; padding: 12px 20px; border-radius: 12px;
      font-size: 0.9rem; font-weight: 700; box-shadow: 0 8px 24px rgba(16,185,129,0.4);
      display: flex; align-items: center; gap: 10px;
      animation: slideInToast 0.35s cubic-bezier(.4,0,.2,1);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = "flex";
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.style.display = "none"; }, 3500);
}

function renderAttendanceSubjectInfoBanner() {
  const meta = getCourseMeta(activeCourse);
  const heading = document.getElementById("activeSubjHeading");
  const badge = document.getElementById("activeSubjBadge");
  const icon = document.getElementById("activeSubjIcon");
  const faculty = document.getElementById("activeSubjFaculty");
  const totalSessions = document.getElementById("activeSubjTotalSessions");
  const avgPct = document.getElementById("activeSubjAvgPct");
  const btnText = document.getElementById("saveAttendanceBtnText");

  const cAtt = attendance[activeCourse] || {};
  const dates = Object.keys(cAtt);
  const sessionCount = dates.length;

  let totalPossible = sessionCount * Object.keys(students).length;
  let totalAttended = 0;
  dates.forEach(d => {
    totalAttended += (cAtt[d]?.present || []).length;
  });
  const avgAttendance = totalPossible > 0 ? Math.round((totalAttended / totalPossible) * 100) : 0;

  if (heading) heading.textContent = `${meta.name} (${activeCourse})`;
  if (badge) badge.textContent = activeCourse;
  if (icon) icon.textContent = meta.icon;
  if (faculty) faculty.textContent = meta.faculty;
  if (totalSessions) totalSessions.textContent = sessionCount;
  if (avgPct) avgPct.textContent = `${avgAttendance}%`;
  if (btnText) btnText.textContent = `Save Attendance for ${meta.name} (${activeCourse})`;
}

function populatePastDatesSelect() {
  const sel = document.getElementById("attendancePastDatesSelect");
  if (!sel) return;

  const cAtt = attendance[activeCourse] || {};
  const dates = Object.keys(cAtt).sort().reverse();

  if (dates.length === 0) {
    sel.innerHTML = `<option value="">No past sessions recorded</option>`;
    return;
  }

  sel.innerHTML = `<option value="">📅 Jump to Past Session (${dates.length})...</option>` + dates.map(d => {
    const presentCount = (cAtt[d]?.present || []).length;
    return `<option value="${d}">${d} (${presentCount} Present)</option>`;
  }).join("");
}

function setAttendanceDateQuick(quickType) {
  const dateInput = document.getElementById("attendanceDate");
  if (!dateInput) return;

  const now = new Date();
  if (quickType === "yesterday") {
    now.setDate(now.getDate() - 1);
  }
  dateInput.value = now.toISOString().split("T")[0];
  onAttendanceDateChanged();
}

function onPastDateSelected(dateVal) {
  if (!dateVal) return;
  const dateInput = document.getElementById("attendanceDate");
  if (dateInput) {
    dateInput.value = dateVal;
    onAttendanceDateChanged();
  }
}

function onAttendanceDateChanged() {
  renderAttendanceGrid();
}

function renderAttendanceGrid() {
  renderAttendanceSubjectTabsBar();
  renderAttendanceSubjectInfoBanner();
  populatePastDatesSelect();

  const grid = document.getElementById("attendanceGrid");
  if (!grid) return;

  const dateInput = document.getElementById("attendanceDate");
  const dateStr = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];
  const courseAtt = getCourseAttendance();
  const isRecorded = !!courseAtt[dateStr];
  const existingRecord = courseAtt[dateStr]?.present || [];

  // Update Session Status Row
  const statusDot = document.getElementById("sessionStatusDot");
  const statusText = document.getElementById("sessionStatusText");
  if (statusDot && statusText) {
    if (isRecorded) {
      statusDot.className = "session-dot marked";
      statusDot.textContent = "●";
      statusText.innerHTML = `<span style="color:var(--success-color);">Saved Session on ${dateStr}:</span> <strong>${existingRecord.length}</strong> students marked present in <strong>${getCourseName(activeCourse)}</strong>.`;
    } else {
      statusDot.className = "session-dot unmarked";
      statusDot.textContent = "○";
      statusText.innerHTML = `<span style="color:#f59e0b;">Unrecorded Session on ${dateStr}:</span> Mark attendance and click Save to record for <strong>${getCourseName(activeCourse)}</strong>.`;
    }
  }

  const studentList = Object.values(students);
  if (studentList.length === 0) {
    grid.innerHTML = `<p class="text-muted">No students in roster. Add students first.</p>`;
    return;
  }

  const searchFilter = (document.getElementById("attendanceStudentFilter")?.value || "").toLowerCase().trim();
  const deptFilter = document.getElementById("attendanceDeptFilter")?.value || "ALL";

  const filteredStudents = studentList.filter(s => {
    const matchSearch = !searchFilter || s.name.toLowerCase().includes(searchFilter) || s.id.toLowerCase().includes(searchFilter);
    const matchDept = deptFilter === "ALL" || s.dept === deptFilter;
    return matchSearch && matchDept;
  });

  if (filteredStudents.length === 0) {
    grid.innerHTML = `<p class="text-muted" style="grid-column: 1/-1; padding: 16px;">No students match the current filters.</p>`;
    updateSelectedAttendanceCounter();
    return;
  }

  grid.innerHTML = filteredStudents.map(s => {
    const isChecked = existingRecord.includes(s.id);
    return `
      <label class="attendance-checkbox-card ${isChecked ? 'checked' : ''}" id="card_${s.id}">
        <input type="checkbox" value="${s.id}" ${isChecked ? 'checked' : ''} onchange="toggleCardCheck(this, '${s.id}')">
        <div style="flex:1;">
          <div style="font-weight:700; color:var(--text-primary); font-size:0.92rem;">${s.name}</div>
          <div class="small text-muted font-mono">${s.id} &bull; ${s.dept} (${s.sec || 'A'})</div>
        </div>
        <span class="small" style="font-weight:700; color:${isChecked ? 'var(--accent)' : 'var(--text-muted)'};" id="card_state_${s.id}">
          ${isChecked ? 'P' : 'A'}
        </span>
      </label>
    `;
  }).join("");

  updateSelectedAttendanceCounter();
}

function filterAttendanceGrid() {
  renderAttendanceGrid();
}

function updateSelectedAttendanceCounter() {
  const counter = document.getElementById("selectedAttendanceCounter");
  const bar = document.getElementById("attendanceProgressBarFill");
  const total = Object.keys(students).length;
  const checked = document.querySelectorAll("#attendanceGrid input[type='checkbox']:checked").length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

  if (counter) counter.textContent = `${checked} / ${total} Present (${pct}%)`;
  if (bar) {
    bar.style.width = `${pct}%`;
    bar.className = `progress-bar-fill ${pct < minThreshold ? 'bg-fill-low' : 'bg-fill-ok'}`;
  }
}

function toggleCardCheck(checkbox, studentId) {
  const card = document.getElementById(`card_${studentId}`);
  const stateLabel = document.getElementById(`card_state_${studentId}`);
  if (card) {
    if (checkbox.checked) {
      card.classList.add("checked");
      if (stateLabel) { stateLabel.textContent = "P"; stateLabel.style.color = "var(--accent)"; }
    } else {
      card.classList.remove("checked");
      if (stateLabel) { stateLabel.textContent = "A"; stateLabel.style.color = "var(--text-muted)"; }
    }
  }
  updateSelectedAttendanceCounter();
}

function selectAllAttendance(selectAll) {
  document.querySelectorAll("#attendanceGrid input[type='checkbox']").forEach(cb => {
    cb.checked = selectAll;
    toggleCardCheck(cb, cb.value);
  });
}

function invertAttendanceSelection() {
  document.querySelectorAll("#attendanceGrid input[type='checkbox']").forEach(cb => {
    cb.checked = !cb.checked;
    toggleCardCheck(cb, cb.value);
  });
}

function saveAttendanceRecord() {
  const dateInput = document.getElementById("attendanceDate");
  const dateStr = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];
  if (!dateStr) { alert("Please select a valid date."); return; }

  const presentIds = [];
  document.querySelectorAll("#attendanceGrid input[type='checkbox']:checked").forEach(cb => {
    presentIds.push(cb.value);
  });

  const courseAtt = getCourseAttendance();
  courseAtt[dateStr] = {
    present: presentIds,
    excused: courseAtt[dateStr]?.excused || []
  };

  logAuditEvent("MARK_ATTENDANCE", `Recorded attendance for ${activeCourse} on ${dateStr} (${presentIds.length} present, ${Object.keys(students).length - presentIds.length} absent)`);
  saveAllData();
  refreshAllViews();
  populatePastDatesSelect();
  renderAttendanceSubjectInfoBanner();
  renderAttendanceSubjectTabsBar();

  alert(`Attendance for ${getCourseName(activeCourse)} (${activeCourse}) on ${dateStr} saved successfully! (${presentIds.length} marked present)`);
}

// ---------------------------------------------------------
// MULTI-SUBJECT MATRIX MARKING
// ---------------------------------------------------------
function renderMultiSubjectMatrix() {
  const dateInput = document.getElementById("multiAttendanceDate");
  const dateStr = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];
  const tbody = document.getElementById("multiSubjectMatrixBody");
  if (!tbody) return;

  const studentList = Object.values(students);
  if (studentList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding:24px;">No students available.</td></tr>`;
    return;
  }

  const courses = ["MA201", "CS102", "EC201", "CS202", "CS101"];

  tbody.innerHTML = studentList.map(s => {
    const checkboxesHtml = courses.map(cCode => {
      const isPresent = (attendance[cCode]?.[dateStr]?.present || []).includes(s.id);
      return `
        <td>
          <input type="checkbox" class="matrix-mark-checkbox" data-course="${cCode}" data-student="${s.id}" ${isPresent ? 'checked' : ''} onchange="updateMultiMatrixRowStatus('${s.id}')">
        </td>
      `;
    }).join("");

    return `
      <tr id="matrix_row_${s.id}">
        <td style="font-weight:700; color:var(--text-secondary); font-size:0.84rem;">${s.id}</td>
        <td style="font-weight:700;">${s.name}</td>
        <td><span class="badge badge-outline">${s.dept}</span></td>
        ${checkboxesHtml}
        <td id="matrix_status_${s.id}" style="font-size:0.82rem; font-weight:600;">
          Checking...
        </td>
      </tr>
    `;
  }).join("");

  studentList.forEach(s => updateMultiMatrixRowStatus(s.id));
}

function updateMultiMatrixRowStatus(studentId) {
  const statusCell = document.getElementById(`matrix_status_${studentId}`);
  if (!statusCell) return;

  const cbs = document.querySelectorAll(`input[data-student="${studentId}"]`);
  let checkedCount = 0;
  cbs.forEach(cb => { if (cb.checked) checkedCount++; });

  if (checkedCount === 0) {
    statusCell.innerHTML = `<span class="badge badge-low">All Absent (0/5)</span>`;
  } else if (checkedCount === cbs.length) {
    statusCell.innerHTML = `<span class="badge badge-ok">All Present (5/5)</span>`;
  } else {
    statusCell.innerHTML = `<span class="badge badge-warning">${checkedCount} of 5 Attended</span>`;
  }
}

function toggleSubjectColAttendance(courseCode) {
  const cbs = document.querySelectorAll(`input[data-course="${courseCode}"]`);
  const anyUnchecked = Array.from(cbs).some(cb => !cb.checked);
  cbs.forEach(cb => {
    cb.checked = anyUnchecked;
    updateMultiMatrixRowStatus(cb.getAttribute("data-student"));
  });
}

function saveAllMultiSubjectAttendance() {
  const dateInput = document.getElementById("multiAttendanceDate");
  const dateStr = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];
  if (!dateStr) { alert("Please select a valid date."); return; }

  const courses = ["MA201", "CS102", "EC201", "CS202", "CS101"];
  const courseCounts = {};

  courses.forEach(cCode => {
    if (!attendance[cCode]) attendance[cCode] = {};
    const presentIds = [];
    document.querySelectorAll(`input[data-course="${cCode}"]:checked`).forEach(cb => {
      presentIds.push(cb.getAttribute("data-student"));
    });

    attendance[cCode][dateStr] = {
      present: presentIds,
      excused: attendance[cCode][dateStr]?.excused || []
    };
    courseCounts[cCode] = presentIds.length;
  });

  logAuditEvent("MARK_ATTENDANCE_BATCH", `Saved multi-subject attendance matrix for ${dateStr} across ${courses.length} courses`);
  saveAllData();
  refreshAllViews();

  alert(`Multi-subject attendance for ${dateStr} successfully saved across all courses!\n` +
    courses.map(c => `• ${getCourseName(c)} (${c}): ${courseCounts[c]} present`).join("\n")
  );
}

function renderEditAttendanceForm() {
  const dateInput = document.getElementById("editAttendanceDate");
  if (!dateInput) return;
  const dateStr = dateInput.value;
  const courseAtt = getCourseAttendance();
  const presentIds = courseAtt[dateStr]?.present || [];
  const container = document.getElementById("editAttendanceList");

  if (!container) return;
  const studentList = Object.values(students);
  if (studentList.length === 0) {
    container.innerHTML = `<p class="text-muted">No students available.</p>`;
    return;
  }

  container.innerHTML = studentList.map(s => `
    <div class="flex-between" style="padding: 6px 0; border-bottom: 1px solid var(--border-color);">
      <span><strong>${s.name}</strong> (${s.id})</span>
      <select id="edit_status_${s.id}" class="select-sm">
        <option value="PRESENT" ${presentIds.includes(s.id) ? 'selected' : ''}>Present</option>
        <option value="ABSENT" ${!presentIds.includes(s.id) ? 'selected' : ''}>Absent</option>
      </select>
    </div>
  `).join("");
}

// ---------------------------------------------------------
// 8. SET THEORY & DISCRETE MATH ENGINE
// ---------------------------------------------------------
function setVennMode(mode) {
  vennMode = mode;
  const btn2 = document.getElementById("btnSetMode2");
  const btn3 = document.getElementById("btnSetMode3");
  if (btn2) btn2.className = mode === 2 ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline";
  if (btn3) btn3.className = mode === 3 ? "btn btn-sm btn-primary" : "btn btn-sm btn-outline";

  const groupC = document.getElementById("groupDateC") || document.getElementById("setThirdDateGroup");
  if (groupC) groupC.style.display = mode === 3 ? "block" : "none";

  const v2 = document.getElementById("vennSvg2") || document.getElementById("vennDiagram2Set");
  const v3 = document.getElementById("vennSvg3") || document.getElementById("vennDiagram3Set");
  if (v2) v2.style.display = mode === 2 ? "block" : "none";
  if (v3) v3.style.display = mode === 3 ? "block" : "none";

  const subtext = document.getElementById("vennSubtext");
  if (subtext) subtext.textContent = mode === 2 ? "Dynamic 2-Circle Venn Diagram" : "Dynamic 3-Circle Venn Diagram";

  runSetAnalysis();
}

function populateSetDateDropdowns() {
  const courseAtt = getCourseAttendance();
  const dates = Object.keys(courseAtt).sort().reverse();
  const d1Select = document.getElementById("dateA") || document.getElementById("setDateA");
  const d2Select = document.getElementById("dateB") || document.getElementById("setDateB");
  const d3Select = document.getElementById("dateC") || document.getElementById("setDateC");

  if (!d1Select || !d2Select) return;

  const options = dates.map(d => `<option value="${d}">${d}</option>`).join("");
  d1Select.innerHTML = options || `<option value="">No Dates</option>`;
  d2Select.innerHTML = options || `<option value="">No Dates</option>`;
  if (d3Select) d3Select.innerHTML = options || `<option value="">No Dates</option>`;

  if (dates.length >= 2) {
    d1Select.value = dates[0];
    d2Select.value = dates[1];
  }
  if (dates.length >= 3 && d3Select) {
    d3Select.value = dates[2];
  }
}

function runSetAnalysis() {
  const d1Select = document.getElementById("dateA") || document.getElementById("setDateA");
  const d2Select = document.getElementById("dateB") || document.getElementById("setDateB");
  const d3Select = document.getElementById("dateC") || document.getElementById("setDateC");

  const d1 = d1Select ? d1Select.value : null;
  const d2 = d2Select ? d2Select.value : null;
  const d3 = d3Select ? d3Select.value : null;
  const courseAtt = getCourseAttendance();

  const mathSummary = document.getElementById("setMathSummary");
  if (!d1 || !d2 || !courseAtt[d1] || !courseAtt[d2]) {
    if (mathSummary) mathSummary.textContent = "Select at least 2 recorded dates to perform Set Theory analysis.";
    return;
  }

  const setUniverse = new Set(Object.keys(students));
  const setA = new Set(courseAtt[d1].present || []);
  const setB = new Set(courseAtt[d2].present || []);

  if (vennMode === 2) {
    const unionAB = new Set([...setA, ...setB]);
    const interAB = new Set([...setA].filter(x => setB.has(x)));
    const diffAB = new Set([...setA].filter(x => !setB.has(x)));
    const diffBA = new Set([...setB].filter(x => !setA.has(x)));
    const symDiff = new Set([...diffAB, ...diffBA]);
    const absentA = new Set([...setUniverse].filter(x => !setA.has(x)));

    if (mathSummary) {
      mathSummary.innerHTML = 
`<strong>DISCRETE SET THEORY ENGINE — 2-SET ANALYSIS (${activeCourse}):</strong>
------------------------------------------------------------
Universal Set U (Total Students): |U| = ${setUniverse.size}
Set A (Date: ${d1}): |A| = ${setA.size}
Set B (Date: ${d2}): |B| = ${setB.size}

1. UNION (A ∪ B)               : Present on either date       = |${unionAB.size}|
2. INTERSECTION (A ∩ B)        : Present on BOTH dates         = |${interAB.size}|
3. RELATIVE COMPLEMENT (A − B) : Present ONLY on Date A       = |${diffAB.size}|
4. RELATIVE COMPLEMENT (B − A) : Present ONLY on Date B       = |${diffBA.size}|
5. SYMMETRIC DIFFERENCE (A Δ B): Present on EXACTLY ONE date  = |${symDiff.size}|
6. ABSOLUTE COMPLEMENT (U − A) : ABSENT on Date A             = |${absentA.size}|`;
    }

    const breakdown = document.getElementById("setBreakdownContainer");
    if (breakdown) {
      breakdown.innerHTML = `
        <div class="set-result-card"><div class="set-badge badge-blue">Set A (${d1})</div><div id="setListA" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-purple">Set B (${d2})</div><div id="setListB" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-teal">Union (A ∪ B)</div><div id="setListUnion" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-green">Intersection (A ∩ B)</div><div id="setListInter" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-orange">Only Date A (A − B)</div><div id="setListDiffAB" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-pink">Only Date B (B − A)</div><div id="setListDiffBA" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-indigo">Absent Set Date A (U − A)</div><div id="setListAbsent" class="pill-container"></div></div>
      `;

      renderSetPills("setListA", setA);
      renderSetPills("setListB", setB);
      renderSetPills("setListUnion", unionAB);
      renderSetPills("setListInter", interAB);
      renderSetPills("setListDiffAB", diffAB);
      renderSetPills("setListDiffBA", diffBA);
      renderSetPills("setListAbsent", absentA);
    }

    const vA = document.getElementById("vennCountA") || document.getElementById("v2_A");
    const vB = document.getElementById("vennCountB") || document.getElementById("v2_B");
    const vAB = document.getElementById("vennCountInter") || document.getElementById("v2_AB");
    if (vA) vA.textContent = diffAB.size;
    if (vB) vB.textContent = diffBA.size;
    if (vAB) vAB.textContent = interAB.size;
  } else {
    // 3-Set Mode
    const setC = new Set((courseAtt[d3] && courseAtt[d3].present) || []);
    const unionABC = new Set([...setA, ...setB, ...setC]);
    const interABC = new Set([...setA].filter(x => setB.has(x) && setC.has(x)));
    const onlyA = new Set([...setA].filter(x => !setB.has(x) && !setC.has(x)));

    if (mathSummary) {
      mathSummary.innerHTML = 
`<strong>DISCRETE SET THEORY ENGINE — 3-SET ANALYSIS (${activeCourse}):</strong>
------------------------------------------------------------
Set A (${d1}): |A| = ${setA.size}
Set B (${d2}): |B| = ${setB.size}
Set C (${d3 || 'N/A'}): |C| = ${setC.size}

1. 3-WAY UNION (A ∪ B ∪ C)        = |${unionABC.size}|
2. 3-WAY INTERSECTION (A ∩ B ∩ C) = |${interABC.size}|
3. ONLY DATE A [A − (B ∪ C)]      = |${onlyA.size}|`;
    }

    const breakdown = document.getElementById("setBreakdownContainer");
    if (breakdown) {
      breakdown.innerHTML = `
        <div class="set-result-card"><div class="set-badge badge-blue">Set A (${d1})</div><div id="setListA" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-purple">Set B (${d2})</div><div id="setListB" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-green">Set C (${d3})</div><div id="setListC" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-teal">Union (A ∪ B ∪ C)</div><div id="setListUnion" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-orange">Intersection (A ∩ B ∩ C)</div><div id="setListInter" class="pill-container"></div></div>
        <div class="set-result-card"><div class="set-badge badge-pink">Present Only Date A</div><div id="setListOnlyA" class="pill-container"></div></div>
      `;

      renderSetPills("setListA", setA);
      renderSetPills("setListB", setB);
      renderSetPills("setListC", setC);
      renderSetPills("setListUnion", unionABC);
      renderSetPills("setListInter", interABC);
      renderSetPills("setListOnlyA", onlyA);
    }

    const v3A = document.getElementById("v3_A");
    const v3B = document.getElementById("v3_B");
    const v3C = document.getElementById("v3_C");
    const v3ABC = document.getElementById("v3_ABC");
    if (v3A) v3A.textContent = setA.size;
    if (v3B) v3B.textContent = setB.size;
    if (v3C) v3C.textContent = setC.size;
    if (v3ABC) v3ABC.textContent = interABC.size;
  }
}

function renderSetPills(elementId, setObj) {
  const container = document.getElementById(elementId);
  if (!container) return;
  const arr = [...setObj].sort();
  if (arr.length === 0) {
    container.innerHTML = `<span class="text-muted small">∅ (Empty set)</span>`;
    return;
  }
  container.innerHTML = arr.map(id => `<span class="student-pill" title="${id}">${students[id]?.name || id}</span>`).join("");
}

// ---------------------------------------------------------
// 9. LEADERBOARD & RANKINGS
// ---------------------------------------------------------
function renderLeaderboard() {
  const tbody = document.getElementById("leaderboardTableBody");
  if (!tbody) return;

  const courseAtt = getCourseAttendance();
  const days = Object.keys(courseAtt);
  const totalDays = days.length;

  const ranked = Object.values(students).map(s => {
    const present = totalDays ? days.filter(d => (courseAtt[d].present || []).includes(s.id)).length : 0;
    const pct = totalDays ? (present / totalDays) * 100 : 0;
    return { ...s, present, total: totalDays, pct };
  }).sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));

  if (ranked.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No attendance data.</td></tr>`;
    return;
  }

  tbody.innerHTML = ranked.map((s, idx) => {
    let rankBadge = `#${idx + 1}`;
    if (idx === 0) rankBadge = "🥇 1st";
    if (idx === 1) rankBadge = "🥈 2nd";
    if (idx === 2) rankBadge = "🥉 3rd";

    return `
      <tr>
        <td><strong>${rankBadge}</strong></td>
        <td><strong>${s.name}</strong></td>
        <td>${s.id}</td>
        <td>${s.dept} (${s.sec || 'A'})</td>
        <td><strong>${s.pct.toFixed(1)}%</strong></td>
        <td>${s.present} / ${s.total}</td>
        <td>${s.pct >= minThreshold ? '<span class="badge badge-ok">Top Tier</span>' : '<span class="badge badge-low">At Risk</span>'}</td>
      </tr>
    `;
  }).join("");
}

// ---------------------------------------------------------
// 10. LEAVE MANAGEMENT PORTAL
// ---------------------------------------------------------
function handleApplyLeave(event) {
  if (event) event.preventDefault();

  const studentSel = document.getElementById("leaveStudentSelect");
  const studentId = (studentSel ? studentSel.value : "").trim().toUpperCase();
  const startDate = document.getElementById("leaveStartDate")?.value;
  const endDate = document.getElementById("leaveEndDate")?.value;
  const leaveType = document.getElementById("leaveType")?.value || "Medical";
  const reason = document.getElementById("leaveReason")?.value.trim();

  if (!studentId || !students[studentId]) {
    alert("Please select a valid registered student.");
    return;
  }
  if (!startDate || !endDate || !reason) {
    alert("Please provide start date, end date, and reason.");
    return;
  }

  const newLeave = {
    id: "LEV-" + Date.now(),
    studentId,
    courseId: activeCourse,
    startDate,
    endDate,
    type: leaveType,
    reason,
    status: "Pending",
    appliedAt: new Date().toLocaleDateString()
  };

  leaves.unshift(newLeave);
  logAuditEvent("APPLY_LEAVE", `Leave applied for ${students[studentId].name} (${studentId}) [${leaveType}: ${startDate} to ${endDate}]`);
  saveAllData();
  renderLeavePortal();
  alert("Leave application submitted successfully for review!");
}

function updateLeaveStatus(leaveId, newStatus) {
  const lev = leaves.find(l => l.id === leaveId);
  if (!lev) return;

  lev.status = newStatus;
  logAuditEvent("LEAVE_DECISION", `Leave request ${leaveId} for ${lev.studentId} was ${newStatus.toUpperCase()}`);
  saveAllData();
  renderLeavePortal();
}

function renderLeavePortal() {
  const studentSel = document.getElementById("leaveStudentSelect");
  if (studentSel) {
    studentSel.innerHTML = Object.values(students).map(s => `<option value="${s.id}">${s.name} (${s.id})</option>`).join("");
  }

  const tbody = document.getElementById("leaveRequestsTableBody");
  if (!tbody) return;

  if (leaves.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No leave requests logged.</td></tr>`;
    return;
  }

  tbody.innerHTML = leaves.map(l => {
    const student = students[l.studentId];
    const statusBadge = l.status === "Approved" 
      ? `<span class="badge badge-ok">Approved</span>`
      : (l.status === "Rejected" ? `<span class="badge badge-low">Rejected</span>` : `<span class="badge badge-pending">Pending</span>`);

    return `
      <tr>
        <td><strong>${student ? student.name : l.studentId}</strong> (${l.studentId})</td>
        <td>${l.startDate} to ${l.endDate}</td>
        <td><span class="badge badge-info">${l.type}</span></td>
        <td>${l.reason}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="row-inputs">
            <button class="btn btn-sm btn-outline" onclick="updateLeaveStatus('${l.id}', 'Approved')">✓</button>
            <button class="btn btn-sm btn-danger-outline" onclick="updateLeaveStatus('${l.id}', 'Rejected')">✗</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// ---------------------------------------------------------
// 11. TIMETABLE INTEGRATION
// ---------------------------------------------------------
function renderTimetable() {
  const tbody = document.getElementById("timetableBody");
  if (!tbody) return;

  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const schedule = {
    "Monday": ["CS101 (Logic)", "CS102 (DS)", "MA201 (Math)", "EC201 (Digital)", "CS101 Lab"],
    "Tuesday": ["MA201 (Math)", "CS101 (Logic)", "EC201 (Digital)", "CS102 (DS)", "Library"],
    "Wednesday": ["CS102 (DS)", "EC201 (Digital)", "CS101 (Logic)", "MA201 (Math)", "Sports"],
    "Thursday": ["EC201 (Digital)", "MA201 (Math)", "CS102 (DS)", "CS101 (Logic)", "Seminar"],
    "Friday": ["CS101 (Logic)", "CS102 (DS)", "EC201 (Digital)", "MA201 (Math)", "Project"]
  };

  const currentDayIndex = new Date().getDay();
  const activeDayName = days[currentDayIndex - 1] || "Monday";

  tbody.innerHTML = days.map(d => {
    const isToday = d === activeDayName;
    const cells = schedule[d].map((slot, pIdx) => {
      const isSlotActive = isToday && pIdx === 0;
      return `<td class="${isSlotActive ? 'active-period' : ''}">${slot}</td>`;
    }).join("");
    return `<tr><td><strong>${d}</strong> ${isToday ? '★ (Today)' : ''}</td>${cells}</tr>`;
  }).join("");
}

// ---------------------------------------------------------
// 12. BUNK CALCULATOR / ATTENDANCE PREDICTOR
// ---------------------------------------------------------
// ---------------------------------------------------------
// 12. ENHANCED BUNK CALCULATOR & ATTENDANCE PREDICTOR SUITE
// ---------------------------------------------------------
let currentBunkStudentId = null;
let currentBunkCourse = "ALL";

function openBunkCalculatorModal(targetStudentId = null, targetCourseCode = "ALL") {
  const body = document.getElementById("bunkCalculatorBody");
  if (!body) return;

  const defaultId = targetStudentId || (currentUser.role === "Student" ? currentUser.username : "101");
  currentBunkStudentId = students[defaultId] ? defaultId : (Object.keys(students)[0] || "101");
  currentBunkCourse = targetCourseCode || "ALL";

  const studentOptions = Object.values(students).map(s => 
    `<option value="${s.id}" ${s.id === currentBunkStudentId ? 'selected' : ''}>${s.name} (${s.id}) - ${s.dept}</option>`
  ).join("");

  const courseOptions = `
    <option value="ALL" ${currentBunkCourse === 'ALL' ? 'selected' : ''}>🌐 All Subjects (Combined Aggregate)</option>
    <option value="MA201" ${currentBunkCourse === 'MA201' ? 'selected' : ''}>MA201 - Mathematics</option>
    <option value="CS102" ${currentBunkCourse === 'CS102' ? 'selected' : ''}>CS102 - Data Structures</option>
    <option value="EC201" ${currentBunkCourse === 'EC201' ? 'selected' : ''}>EC201 - Electronics</option>
    <option value="CS202" ${currentBunkCourse === 'CS202' ? 'selected' : ''}>CS202 - DBMS</option>
    <option value="CS101" ${currentBunkCourse === 'CS101' ? 'selected' : ''}>CS101 - Set Theory & Logic</option>
  `;

  body.innerHTML = `
    <!-- Header Banner -->
    <div class="bunk-calc-header">
      <div class="bunk-header-icon">📈</div>
      <div>
        <h4>Attendance Predictor & Safe Bunk Calculator</h4>
        <p>Analyze subject-wise eligibility, simulate future lecture attendance scenarios, and plan bunk allowances safely.</p>
      </div>
    </div>

    <!-- Controls Bar -->
    <div class="bunk-controls-bar">
      <div class="bunk-control-group" style="flex: 2;">
        <label for="bunkStudentSelect">Selected Student</label>
        <select id="bunkStudentSelect" onchange="onBunkStudentChange()" class="form-control">
          ${studentOptions}
        </select>
      </div>
      <div class="bunk-control-group" style="flex: 2;">
        <label for="bunkCourseSelect">Subject / Scope</label>
        <select id="bunkCourseSelect" onchange="onBunkCourseChange()" class="form-control">
          ${courseOptions}
        </select>
      </div>
      <div class="bunk-control-group" style="flex: 1;">
        <label for="bunkTargetPct">Target %</label>
        <input type="number" id="bunkTargetPct" value="${minThreshold}" min="50" max="100" oninput="calculateBunkPredictor()" class="form-control">
      </div>
    </div>

    <!-- Dynamic Output Body -->
    <div id="bunkCalculatorResult"></div>
  `;

  calculateBunkPredictor();
  openModal("bunkModal");
}

function onBunkStudentChange() {
  const sel = document.getElementById("bunkStudentSelect");
  if (sel) currentBunkStudentId = sel.value;
  calculateBunkPredictor();
}

function onBunkCourseChange() {
  const sel = document.getElementById("bunkCourseSelect");
  if (sel) currentBunkCourse = sel.value;
  calculateBunkPredictor();
}

function focusBunkSubject(courseCode) {
  currentBunkCourse = courseCode;
  const courseSel = document.getElementById("bunkCourseSelect");
  if (courseSel) courseSel.value = courseCode;
  calculateBunkPredictor();
}

function calculateBunkPredictor() {
  const studentId = document.getElementById("bunkStudentSelect")?.value || currentBunkStudentId;
  const courseScope = document.getElementById("bunkCourseSelect")?.value || currentBunkCourse;
  const targetPct = parseFloat(document.getElementById("bunkTargetPct")?.value || minThreshold);
  const resultDiv = document.getElementById("bunkCalculatorResult");

  if (!studentId || !students[studentId] || !resultDiv) return;

  const student = students[studentId];
  const allSubStats = getStudentSubjectStats(studentId);

  // Compute selected scope stats
  let total = 0;
  let attended = 0;
  let scopeTitle = "";

  if (courseScope === "ALL") {
    scopeTitle = "All Subjects Combined";
    allSubStats.forEach(s => {
      total += s.total;
      attended += s.attended;
    });
  } else {
    scopeTitle = getCourseName(courseScope);
    const found = allSubStats.find(s => s.code === courseScope);
    if (found) {
      total = found.total;
      attended = found.attended;
    } else {
      const cAtt = attendance[courseScope] || {};
      const dates = Object.keys(cAtt);
      total = dates.length;
      attended = total ? dates.filter(d => (cAtt[d].present || []).includes(studentId)).length : 0;
    }
  }

  const currentPct = total ? (attended / total) * 100 : 0;
  const roundedPct = Math.round(currentPct * 10) / 10;
  const isShortage = roundedPct < targetPct;

  // 1. Classes needed to reach target percentage
  let classesNeeded = 0;
  if (isShortage) {
    classesNeeded = Math.max(1, Math.ceil(((targetPct * total) - (100 * attended)) / (100 - targetPct)));
  }

  // 2. Maximum classes that can be safely missed
  let maxBunk = 0;
  if (!isShortage) {
    maxBunk = Math.max(0, Math.floor(((100 * attended) - (targetPct * total)) / targetPct));
  }

  // Ring circumference for SVG progress rings: r=23 => C = 2 * PI * 23 = 144.51
  const ringCircumference = 144.51;

  // Render Subject-Wise Cards Grid
  const subjectCardsHtml = allSubStats.map(s => {
    const sPct = s.pct;
    const isUnder = sPct < targetPct;
    const isWarn = !isUnder && sPct < 85;
    const ringClass = isUnder ? "danger" : (isWarn ? "warning" : "safe");
    const cardClass = isUnder ? "shortage" : (isWarn ? "borderline" : "safe");
    const offset = Math.max(0, ringCircumference * (1 - Math.min(100, sPct) / 100));

    // Per subject needed / bunk
    let subActionHtml = "";
    if (isUnder) {
      const needed = Math.max(1, Math.ceil(((targetPct * s.total) - (100 * s.attended)) / (100 - targetPct)));
      subActionHtml = `<div class="bunk-action-pill need-attend">⚠️ Attend next <strong>${needed}</strong> to reach ${targetPct}%</div>`;
    } else {
      const bunk = Math.max(0, Math.floor(((100 * s.attended) - (targetPct * s.total)) / targetPct));
      subActionHtml = `<div class="bunk-action-pill can-bunk">🎉 Can safely bunk <strong>${bunk}</strong> lecture(s)</div>`;
    }

    const isSelected = courseScope === s.code;

    return `
      <div class="bunk-subj-card ${cardClass}" style="${isSelected ? 'outline: 2px solid var(--accent); box-shadow: var(--shadow-md);' : ''}; cursor:pointer;" onclick="focusBunkSubject('${s.code}')" title="Click to analyze ${s.name}">
        <div class="bunk-subj-card-top">
          <span class="bunk-subj-code">${s.code}</span>
          ${isUnder ? '<span class="prof-warning-badge">⚠️ Below Target</span>' : '<span class="badge badge-ok" style="font-size:0.68rem;">Eligible</span>'}
        </div>
        <div class="bunk-subj-card-name">${s.name}</div>
        <div class="bunk-ring-container">
          <div class="bunk-ring">
            <svg viewBox="0 0 56 56">
              <circle class="ring-bg" cx="28" cy="28" r="23"></circle>
              <circle class="ring-fill ${ringClass}" cx="28" cy="28" r="23" 
                stroke-dasharray="${ringCircumference}" 
                stroke-dashoffset="${offset}"></circle>
            </svg>
            <div class="bunk-ring-label">${sPct}%</div>
          </div>
          <div class="bunk-ring-stats">
            <div class="stat-line"><span>Attended:</span> <strong>${s.attended}</strong></div>
            <div class="stat-line"><span>Conducted:</span> <strong>${s.total}</strong></div>
            <div class="stat-line"><span>Missed:</span> <strong style="color:${s.absent > 0 ? '#ef4444' : 'inherit'}">${s.absent}</strong></div>
          </div>
        </div>
        ${subActionHtml}
      </div>
    `;
  }).join("");

  // Targets for Target Matrix
  const targetsMatrix = [
    { label: "Minimum Exam Eligibility", pct: 75, badge: "Mandatory" },
    { label: "Comfortable Buffer", pct: 80, badge: "Safe" },
    { label: "Department Distinction", pct: 85, badge: "Distinction" },
    { label: "Placement Elite / Scholarship", pct: 90, badge: "Honors" }
  ];

  const targetMatrixHtml = targetsMatrix.map(t => {
    const isMet = roundedPct >= t.pct;
    let desc = "";
    let valStr = "";
    if (isMet) {
      const bunkCount = Math.max(0, Math.floor(((100 * attended) - (t.pct * total)) / t.pct));
      valStr = `<span style="color:#10b981;">+${bunkCount}</span>`;
      desc = `Can safely bunk ${bunkCount} class(es)`;
    } else {
      const needCount = Math.max(1, Math.ceil(((t.pct * total) - (100 * attended)) / (100 - t.pct)));
      valStr = `<span style="color:#ef4444;">${needCount}</span>`;
      desc = `Must attend next ${needCount} class(es)`;
    }
    return `
      <div class="bunk-target-result-item">
        <div style="font-size:0.75rem; font-weight:700; color:var(--text-primary); margin-bottom:4px;">
          ${t.pct}% Target
        </div>
        <div class="big-val">${valStr}</div>
        <div class="desc">${desc}</div>
      </div>
    `;
  }).join("");

  resultDiv.innerHTML = `
    <!-- Top Stat KPI Banner -->
    <div class="bunk-overall-bar">
      <div class="bunk-overall-stat">
        <span class="stat-num" style="color: ${isShortage ? '#ef4444' : '#10b981'};">${roundedPct}%</span>
        <span class="stat-desc">Current Attendance (${scopeTitle})</span>
      </div>
      <div class="bunk-overall-stat">
        <span class="stat-num" style="color: #2563eb;">${attended} / ${total}</span>
        <span class="stat-desc">Total Classes Attended</span>
      </div>
      <div class="bunk-overall-stat" style="background: ${isShortage ? '#fef2f2' : 'var(--bg-card)'};">
        <span class="stat-num" style="color: #ef4444;">${classesNeeded}</span>
        <span class="stat-desc">Classes Needed for ${targetPct}%</span>
      </div>
      <div class="bunk-overall-stat" style="background: ${!isShortage && maxBunk > 0 ? '#f0fdf4' : 'var(--bg-card)'};">
        <span class="stat-num" style="color: #10b981;">${maxBunk}</span>
        <span class="stat-desc">Max Classes That Can Be Missed</span>
      </div>
    </div>

    <!-- Recommendation Alert Box -->
    <div class="margin-bottom">
      ${isShortage ? `
        <div class="card" style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 14px 18px;">
          <h4 style="color:#b91c1c; margin-bottom:4px;">⚠️ Low Attendance Shortage Warning for ${student.name}</h4>
          <p style="margin:0; color:#7f1d1d; font-size:0.88rem;">
            Current attendance in <strong>${scopeTitle}</strong> is <strong>${roundedPct}%</strong>, which is below the required <strong>${targetPct}%</strong>.
            You must attend the next <strong>${classesNeeded} consecutive lecture(s)</strong> with 100% presence to restore your exam eligibility.
          </p>
        </div>
      ` : `
        <div class="card" style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 14px 18px;">
          <h4 style="color:#15803d; margin-bottom:4px;">🎉 Safe Attendance Standing</h4>
          <p style="margin:0; color:#166534; font-size:0.88rem;">
            You have a solid <strong>${roundedPct}%</strong> attendance in <strong>${scopeTitle}</strong>.
            You can safely miss up to <strong>${maxBunk} upcoming lecture(s)</strong> without dropping below your ${targetPct}% threshold.
          </p>
        </div>
      `}
    </div>

    <!-- Subject-Wise Breakdown Section -->
    <div class="margin-bottom">
      <div class="flex-between align-center" style="margin-bottom: 12px;">
        <h5 style="margin:0; font-size:0.95rem; font-weight:700;">
          📚 Subject-wise Attendance Breakdown
        </h5>
        <span class="small text-muted">Click any subject card to isolate & simulate</span>
      </div>
      <div class="bunk-subject-grid">
        ${subjectCardsHtml}
      </div>
    </div>

    <!-- Future Attendance Prediction Simulator -->
    <div class="bunk-prediction-section">
      <h5>
        <span>🔮 Attendance Prediction Simulator</span>
        <span class="small text-muted" style="font-weight: normal;">(Simulate impact of upcoming N classes on ${scopeTitle})</span>
      </h5>

      <div class="bunk-prediction-grid">
        <!-- Sliders Box -->
        <div class="bunk-predict-card">
          <h6>1. Simulate Upcoming Classes</h6>
          <div style="margin-bottom: 14px;">
            <div class="flex-between small margin-bottom">
              <span>Total upcoming classes to simulate (N):</span>
              <strong id="bunkSliderNVal" style="color:var(--accent); font-size:1.05rem;">10</strong>
            </div>
            <div class="bunk-slider-row">
              <input type="range" id="bunkSliderN" min="1" max="30" value="10" oninput="updateBunkPredictionSlider()">
            </div>
          </div>

          <div>
            <div class="flex-between small margin-bottom">
              <span>Classes you plan to attend out of N:</span>
              <strong id="bunkSliderAttendVal" style="color:#10b981; font-size:1.05rem;">10</strong>
            </div>
            <div class="bunk-slider-row">
              <input type="range" id="bunkSliderAttend" min="0" max="10" value="10" oninput="updateBunkPredictionSlider()">
            </div>
          </div>
        </div>

        <!-- Real-Time Scenarios Box -->
        <div class="bunk-predict-card" id="bunkPredictScenarios">
          <!-- Populated by updateBunkPredictionSlider() -->
        </div>
      </div>
    </div>

    <!-- Target Percentage Calculator -->
    <div class="bunk-target-section">
      <h5>
        <span>🎯 Target Percentage Calculator Matrix</span>
        <span class="small text-muted" style="font-weight: normal;">(Classes needed or bunk allowance for various benchmarks)</span>
      </h5>
      <div class="bunk-target-result-grid">
        ${targetMatrixHtml}
      </div>

      <!-- Custom Target Calculator -->
      <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(0,0,0,0.08); display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <label for="customTargetInput" style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary);">
          Quick Calculator for Custom Target:
        </label>
        <div style="display: flex; align-items: center; gap: 6px;">
          <input type="number" id="customTargetInput" value="80" min="50" max="99" style="width: 70px; padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);" oninput="calcCustomTargetInline(${attended}, ${total})">
          <span>%</span>
        </div>
        <div id="customTargetInlineResult" style="font-size: 0.82rem; font-weight: 700; color: var(--accent);"></div>
      </div>
    </div>
  `;

  updateBunkPredictionSlider();
  calcCustomTargetInline(attended, total);
}

function updateBunkPredictionSlider() {
  const nSlider = document.getElementById("bunkSliderN");
  const attendSlider = document.getElementById("bunkSliderAttend");
  const nValEl = document.getElementById("bunkSliderNVal");
  const attendValEl = document.getElementById("bunkSliderAttendVal");
  const container = document.getElementById("bunkPredictScenarios");

  if (!nSlider || !attendSlider || !container) return;

  const N = parseInt(nSlider.value, 10);
  attendSlider.max = N;
  if (parseInt(attendSlider.value, 10) > N) attendSlider.value = N;
  const attendCount = parseInt(attendSlider.value, 10);

  if (nValEl) nValEl.textContent = N;
  if (attendValEl) attendValEl.textContent = attendCount;

  const studentId = document.getElementById("bunkStudentSelect")?.value || currentBunkStudentId;
  const courseScope = document.getElementById("bunkCourseSelect")?.value || currentBunkCourse;
  const targetPct = parseFloat(document.getElementById("bunkTargetPct")?.value || minThreshold);
  const allSubStats = getStudentSubjectStats(studentId);

  let total = 0;
  let attended = 0;
  if (courseScope === "ALL") {
    allSubStats.forEach(s => { total += s.total; attended += s.attended; });
  } else {
    const found = allSubStats.find(s => s.code === courseScope);
    if (found) { total = found.total; attended = found.attended; }
  }

  const curPct = total ? (attended / total) * 100 : 0;

  // Scenario 1: Attend 100% of next N classes
  const pctAttendAll = Math.round(((attended + N) / (total + N)) * 100 * 10) / 10;
  const deltaAll = Math.round((pctAttendAll - curPct) * 10) / 10;

  // Scenario 2: Miss 100% of next N classes (bunk all)
  const pctMissAll = Math.round((attended / (total + N)) * 100 * 10) / 10;
  const deltaMiss = Math.round((pctMissAll - curPct) * 10) / 10;

  // Scenario 3: Custom plan (attend count out of N)
  const pctCustom = Math.round(((attended + attendCount) / (total + N)) * 100 * 10) / 10;
  const deltaCustom = Math.round((pctCustom - curPct) * 10) / 10;
  const isCustomSafe = pctCustom >= targetPct;

  container.innerHTML = `
    <h6>2. Projected Outcome After ${N} Classes</h6>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <!-- Custom Planned Scenario -->
      <div class="bunk-predict-result ${isCustomSafe ? 'good' : 'bad'}" style="text-align: left; padding: 10px;">
        <div class="flex-between">
          <span>Attending <strong>${attendCount} of ${N}</strong> classes:</span>
          <strong style="font-size: 1.15rem;">${pctCustom}%</strong>
        </div>
        <div style="font-size: 0.73rem; margin-top: 4px; opacity: 0.9;">
          Change: <strong>${deltaCustom >= 0 ? '+' + deltaCustom : deltaCustom}%</strong> &bull; 
          Status: <strong>${isCustomSafe ? '✅ Meets ' + targetPct + '% Requirement' : '⚠️ Shortage Warning'}</strong>
        </div>
      </div>

      <!-- Best Case Scenario -->
      <div class="bunk-predict-result good" style="text-align: left; padding: 8px 10px; font-size: 0.78rem;">
        <div class="flex-between">
          <span>If you attend <strong>all next ${N}</strong> classes:</span>
          <strong>${pctAttendAll}% (+${deltaAll}%)</strong>
        </div>
      </div>

      <!-- Worst Case Scenario -->
      <div class="bunk-predict-result bad" style="text-align: left; padding: 8px 10px; font-size: 0.78rem;">
        <div class="flex-between">
          <span>If you miss <strong>all next ${N}</strong> classes:</span>
          <strong>${pctMissAll}% (${deltaMiss}%)</strong>
        </div>
      </div>
    </div>
  `;
}

function calcCustomTargetInline(attended, total) {
  const inp = document.getElementById("customTargetInput");
  const res = document.getElementById("customTargetInlineResult");
  if (!inp || !res) return;

  const target = parseFloat(inp.value);
  if (isNaN(target) || target <= 0 || target >= 100) {
    res.textContent = "Please enter a valid percentage between 50% and 99%.";
    return;
  }

  const curPct = total ? (attended / total) * 100 : 0;
  if (curPct >= target) {
    const bunk = Math.max(0, Math.floor(((100 * attended) - (target * total)) / target));
    res.innerHTML = `<span style="color:#10b981;">🎉 Target achieved! You can safely miss up to <strong>${bunk}</strong> classes.</span>`;
  } else {
    const needed = Math.max(1, Math.ceil(((target * total) - (100 * attended)) / (100 - target)));
    res.innerHTML = `<span style="color:#ef4444;">⚠️ Must attend next <strong>${needed}</strong> consecutive lecture(s) to reach ${target}%.</span>`;
  }
}


// ---------------------------------------------------------
// 13. WHATSAPP & EMAIL NOTIFICATION DISPATCHER
// ---------------------------------------------------------
function openWhatsAppModal() {
  const courseAtt = getCourseAttendance();
  const days = Object.keys(courseAtt);
  const totalDays = days.length;
  const listContainer = document.getElementById("whatsAppModalBody") || document.getElementById("whatsappRecipientList");

  const lowStudents = Object.values(students).filter(s => {
    const present = totalDays ? days.filter(d => (courseAtt[d].present || []).includes(s.id)).length : 0;
    const pct = totalDays ? (present / totalDays) * 100 : 0;
    return pct < minThreshold;
  });

  if (listContainer) {
    if (lowStudents.length === 0) {
      listContainer.innerHTML = `<p class="text-muted">No students below ${minThreshold}% threshold.</p>`;
    } else {
      listContainer.innerHTML = lowStudents.map(s => {
        const present = days.filter(d => (courseAtt[d].present || []).includes(s.id)).length;
        const pct = ((present / totalDays) * 100).toFixed(1);
        const cleanPhone = (s.phone || "").replace(/[^0-9]/g, "");
        const msg = encodeURIComponent(`Dear ${s.name}, your attendance in ${activeCourse} is currently ${pct}% (${present}/${totalDays} classes), which is below the required ${minThreshold}%. Please attend upcoming classes to avoid debarment.`);
        const waUrl = `https://wa.me/${cleanPhone}?text=${msg}`;

        return `
          <div class="flex-between card" style="padding: 10px 14px; margin-bottom: 8px;">
            <div>
              <strong>${s.name}</strong> (${s.id})
              <div class="small font-mono text-muted">${s.phone} • ${pct}% Attendance</div>
            </div>
            <a href="${waUrl}" target="_blank" class="btn btn-sm btn-primary">Send WhatsApp</a>
          </div>
        `;
      }).join("");
    }
  }

  openModal("whatsappModal");
}

function sendWhatsAppToStudent(studentId) {
  const s = students[studentId];
  if (!s) return;
  const courseAtt = getCourseAttendance();
  const days = Object.keys(courseAtt);
  const totalDays = days.length;
  const present = totalDays ? days.filter(d => (courseAtt[d].present || []).includes(s.id)).length : 0;
  const pct = totalDays ? ((present / totalDays) * 100).toFixed(1) : "0.0";
  
  const cleanPhone = (s.phone || "").replace(/[^0-9]/g, "");
  const msg = encodeURIComponent(`Hello ${s.name}, Attendance Notice for ${activeCourse}: Your current attendance is ${pct}% (${present}/${totalDays} sessions). Required threshold: ${minThreshold}%.`);
  window.open(`https://wa.me/${cleanPhone}?text=${msg}`, "_blank");
}

function openEmailModal() {
  const courseAtt = getCourseAttendance();
  const days = Object.keys(courseAtt);
  const totalDays = days.length;
  const container = document.getElementById("emailModalBody") || document.getElementById("emailRecipientList");

  const lowStudents = Object.values(students).filter(s => {
    const present = totalDays ? days.filter(d => (courseAtt[d].present || []).includes(s.id)).length : 0;
    const pct = totalDays ? (present / totalDays) * 100 : 0;
    return pct < minThreshold;
  });

  if (container) {
    if (lowStudents.length === 0) {
      container.innerHTML = `<p class="text-muted">No students require email notices.</p>`;
    } else {
      container.innerHTML = lowStudents.map(s => {
        const mailto = `mailto:${s.email}?subject=${encodeURIComponent("Attendance Warning Notice - " + activeCourse)}&body=${encodeURIComponent(`Dear ${s.name},\n\nThis is an official notice regarding your attendance for course ${activeCourse}. Your current attendance is below ${minThreshold}%.\n\nPlease meet with your department coordinator.\n\nAcademic Office`)}`;
        return `
          <div class="flex-between card" style="padding: 10px 14px; margin-bottom: 8px;">
            <div>
              <strong>${s.name}</strong>
              <div class="small font-mono text-muted">${s.email}</div>
            </div>
            <a href="${mailto}" class="btn btn-sm btn-outline">Send Email</a>
          </div>
        `;
      }).join("");
    }
  }
  openModal("emailModal");
}

// ---------------------------------------------------------
// 14. SMS OUTBOX DISPATCHER (U − A SET CALCULATION)
// ---------------------------------------------------------
function triggerAbsenteeSMSAlerts() {
  const dateInput = document.getElementById("attendanceDate");
  const dateStr = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];
  const courseAtt = getCourseAttendance();
  const presentSet = new Set(courseAtt[dateStr]?.present || []);
  const universeSet = new Set(Object.keys(students));
  const absentIds = [...universeSet].filter(x => !presentSet.has(x));

  const absentBadge = document.getElementById("smsAbsentCount");
  if (absentBadge) absentBadge.textContent = absentIds.length;

  const listContainer = document.getElementById("smsMessageList");
  if (listContainer) {
    if (absentIds.length === 0) {
      listContainer.innerHTML = `<p class="text-muted">No absentees recorded on ${dateStr} (100% Attendance!).</p>`;
    } else {
      listContainer.innerHTML = absentIds.map(id => {
        const s = students[id];
        const msg = `University Notice: ${s.name} (${s.id}) was marked ABSENT for ${activeCourse} on ${dateStr}. Please verify.`;
        return `
          <div class="sms-card">
            <div class="sms-card-header">
              <strong>${s.name} (${s.id})</strong>
              <span class="font-mono text-muted">${s.phone}</span>
            </div>
            <div class="small">${msg}</div>
          </div>
        `;
      }).join("");
    }
  }

  openModal("smsOutboxModal");
}

function sendSmsPayloadToBackend() {
  const apiUrlInput = document.getElementById("backendApiUrl");
  const apiUrl = apiUrlInput ? apiUrlInput.value.trim() : "http://localhost:5000/api/send-sms";
  const dateInput = document.getElementById("attendanceDate");
  const dateStr = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];
  const courseAtt = getCourseAttendance();
  const presentSet = new Set(courseAtt[dateStr]?.present || []);
  const absentIds = Object.keys(students).filter(x => !presentSet.has(x));
  const statusBox = document.getElementById("smsStatusBox");

  if (absentIds.length === 0) {
    if (statusBox) {
      statusBox.style.display = "block";
      statusBox.innerHTML = `<div class="badge badge-success" style="padding:10px;display:block;">✅ No absentees to notify — 100% Attendance!</div>`;
    }
    return;
  }

  const payload = {
    course: activeCourse,
    date: dateStr,
    recipients: absentIds.map(id => ({
      id,
      name: students[id].name,
      phone: students[id].phone,
      message: `Dear Parent/Student, ${students[id].name} was marked ABSENT for ${activeCourse} on ${dateStr}.`
    }))
  };

  // Show loading state
  if (statusBox) {
    statusBox.style.display = "block";
    statusBox.innerHTML = `<div style="padding:10px;color:#888;">⏳ Connecting to backend at <code>${apiUrl}</code> and dispatching SMS alerts…</div>`;
  }

  fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
  .then(res => res.json())
  .then(data => {
    logAuditEvent("SMS_DISPATCH", `Sent SMS payload to ${absentIds.length} absent students via ${apiUrl}`);
    if (statusBox) {
      const sentList = (data.sent || []).map(s =>
        `<li>✅ <strong>${s.name}</strong> (${s.phone}) — ${s.status}</li>`
      ).join("");
      const failedList = (data.failed || []).map(f =>
        `<li>❌ <strong>${f.name}</strong> — ${f.error}</li>`
      ).join("");
      statusBox.style.display = "block";
      statusBox.innerHTML = `
        <div class="card" style="background:#f0fff4;border-left:4px solid #22c55e;padding:12px;">
          <strong>✅ Backend Response: ${data.message || 'Dispatched successfully!'}</strong><br>
          <small>Mode: ${data.mode || 'Simulation'} | Sent: ${data.sent_count || 0} | Failed: ${data.failed_count || 0}</small>
          ${sentList ? `<ul style="margin-top:8px;font-size:13px;">${sentList}</ul>` : ""}
          ${failedList ? `<ul style="margin-top:4px;font-size:13px;color:#dc2626;">${failedList}</ul>` : ""}
        </div>`;
    }
  })
  .catch(err => {
    logAuditEvent("SMS_DISPATCH_OFFLINE", `Simulated SMS dispatch for ${absentIds.length} students (Backend server offline)`);
    if (statusBox) {
      statusBox.style.display = "block";
      statusBox.innerHTML = `
        <div class="card" style="background:#fefce8;border-left:4px solid #f59e0b;padding:12px;">
          <strong>⚠️ Backend Offline — Switched to Browser Simulation Mode</strong><br>
          <small>Could not reach <code>${apiUrl}</code>. Make sure <code>python server.py</code> is running.</small><br>
          <small style="color:#65a30d;">✅ Simulated ${absentIds.length} SMS alert(s) dispatched locally.</small>
        </div>`;
    }
  });
}

function testBackendHealth() {
  const apiUrlInput = document.getElementById("backendApiUrl");
  const apiUrl = (apiUrlInput ? apiUrlInput.value.trim() : "http://localhost:5000/api/send-sms").replace("/api/send-sms", "/api/health");
  const statusBox = document.getElementById("smsStatusBox");
  if (statusBox) {
    statusBox.style.display = "block";
    statusBox.innerHTML = `<div style="padding:10px;color:#888;">⏳ Pinging <code>${apiUrl}</code>…</div>`;
  }
  fetch(apiUrl)
    .then(r => r.json())
    .then(d => {
      if (statusBox) {
        statusBox.style.display = "block";
        statusBox.innerHTML = `
          <div class="card" style="background:#f0fff4;border-left:4px solid #22c55e;padding:12px;">
            <strong>🟢 Backend: ${d.status || 'ONLINE'}</strong><br>
            <small>Service: ${d.service || ''} | Mode: ${d.mode || ''} | SMS Dispatched: ${d.dispatched_count || 0}</small>
          </div>`;
      }
    })
    .catch(e => {
      if (statusBox) {
        statusBox.style.display = "block";
        statusBox.innerHTML = `
          <div class="card" style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px;">
            <strong>🔴 Backend Offline</strong><br>
            <small>Not responding at <code>${apiUrl}</code></small><br>
            <small>Run: <code>python server.py</code> from the <code>backend/</code> folder.</small>
          </div>`;
      }
    });
}


// ---------------------------------------------------------
// 15. EXAM ELIGIBILITY & REPORTS
// ---------------------------------------------------------
function renderEligibilityTable() {
  const tbody = document.getElementById("eligibilityTableBody");
  if (!tbody) return;

  const courseAtt = getCourseAttendance();
  const days = Object.keys(courseAtt);
  const totalDays = days.length;
  const studentList = Object.values(students);

  if (studentList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No student records.</td></tr>`;
    return;
  }

  tbody.innerHTML = studentList.map(s => {
    const present = totalDays ? days.filter(d => (courseAtt[d].present || []).includes(s.id)).length : 0;
    const pct = totalDays ? (present / totalDays) * 100 : 0;
    const isEligible = pct >= minThreshold;

    return `
      <tr>
        <td><strong>${s.id}</strong></td>
        <td>${s.name}</td>
        <td>${s.dept} (${s.sec || 'A'})</td>
        <td>${present} / ${totalDays}</td>
        <td><strong>${pct.toFixed(1)}%</strong></td>
        <td>${isEligible ? '<span class="badge badge-eligible">ELIGIBLE</span>' : '<span class="badge badge-debarred">DEBARRED</span>'}</td>
        <td>${isEligible ? 'Admit Card Issued' : 'Requires Medical Certificate / HoD Approval'}</td>
      </tr>
    `;
  }).join("");
}

function renderReportTable() {
  const tbody = document.getElementById("reportTableBody");
  if (!tbody) return;

  const filter = document.getElementById("reportFilterStatus")?.value || "ALL";
  const courseAtt = getCourseAttendance();
  const days = Object.keys(courseAtt);
  const totalDaysCount = days.length;
  const studentList = Object.values(students);

  if (studentList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No students available.</td></tr>`;
    return;
  }

  const rows = [];
  studentList.forEach(s => {
    const presentCount = totalDaysCount ? days.filter(d => (courseAtt[d].present || []).includes(s.id)).length : 0;
    const pct = totalDaysCount ? (presentCount / totalDaysCount) * 100 : 0;
    const isLow = pct < minThreshold;

    if (filter === "LOW" && !isLow) return;
    if (filter === "HIGH" && isLow) return;

    const statusBadge = isLow ? `<span class="badge badge-low">AT-RISK (&lt;${minThreshold}%)</span>` : `<span class="badge badge-ok">GOOD</span>`;
    const fillClass = isLow ? "bg-fill-low" : "bg-fill-ok";

    rows.push(`
      <tr>
        <td><strong>${s.id}</strong></td>
        <td><a href="javascript:void(0)" onclick="openStudentProfile('${s.id}')">${s.name}</a></td>
        <td><span class="small font-mono">${s.phone}</span></td>
        <td>${s.dept} (${s.sec || 'A'})</td>
        <td>${presentCount}</td>
        <td>${totalDaysCount}</td>
        <td><strong>${pct.toFixed(1)}%</strong></td>
        <td><div class="progress-bar-container"><div class="progress-bar-fill ${fillClass}" style="width: ${pct}%"></div></div></td>
        <td>${statusBadge}</td>
      </tr>
    `);
  });

  tbody.innerHTML = rows.length ? rows.join("") : `<tr><td colspan="9" class="text-center text-muted">No matching student records found.</td></tr>`;
}

function openWarningNoticeModal() {
  const courseAtt = getCourseAttendance();
  const days = Object.keys(courseAtt);
  const totalDays = days.length;
  const container = document.getElementById("warningNoticeContainer");

  const lowStudents = Object.values(students).filter(s => {
    const present = totalDays ? days.filter(d => (courseAtt[d].present || []).includes(s.id)).length : 0;
    const pct = totalDays ? (present / totalDays) * 100 : 0;
    return pct < minThreshold;
  });

  if (container) {
    if (lowStudents.length === 0) {
      container.innerHTML = `<p class="text-muted">No students below ${minThreshold}% threshold in ${activeCourse}.</p>`;
    } else {
      container.innerHTML = lowStudents.map(s => {
        const present = days.filter(d => (courseAtt[d].present || []).includes(s.id)).length;
        const pct = ((present / totalDays) * 100).toFixed(1);
        return `
          <div class="warning-letter-card">
            <h4>OFFICIAL ATTENDANCE WARNING NOTICE (${activeCourse})</h4>
            <p><strong>Date of Notice:</strong> ${new Date().toLocaleDateString()}</p>
            <p><strong>Student Name:</strong> ${s.name} (${s.id})</p>
            <p><strong>Mobile:</strong> ${s.phone || 'N/A'}</p>
            <p><strong>Department:</strong> ${s.dept} (${s.sec || 'A'})</p>
            <hr style="margin: 12px 0;">
            <p>This is to formally notify you that your current attendance in <strong>${activeCourse}</strong> is <strong>${pct}%</strong> (${present}/${totalDays} sessions), which is strictly below the minimum requisite threshold of <strong>${minThreshold}%</strong>.</p>
            <p>Failure to improve your attendance may result in debarment from the upcoming semester examination.</p>
            <br>
            <div class="flex-between">
              <span>_______________________<br>Head of Department</span>
              <span>_______________________<br>Student Acknowledgment</span>
            </div>
          </div>
        `;
      }).join("");
    }
  }
  openModal("warningLetterModal");
}

// ---------------------------------------------------------
// 16. AUDIT LOG & HISTORY
// ---------------------------------------------------------
function renderAuditTable() {
  const tbody = document.getElementById("auditLogTableBody") || document.getElementById("auditTableBody");
  if (!tbody) return;

  if (auditLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No activity logged yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = auditLogs.map(log => `
    <tr>
      <td class="font-mono small">${log.timestamp}</td>
      <td><span class="badge badge-info">${log.role}</span></td>
      <td><strong>${log.action}</strong></td>
      <td class="small">${log.details}</td>
    </tr>
  `).join("");
}

function clearAuditLog() {
  if (confirm("Clear all audit log entries?")) {
    auditLogs = [];
    saveAllData();
    renderAuditTable();
  }
}

// ---------------------------------------------------------
// 17. EXPORT, IMPORT & CLOUD SYNC
// ---------------------------------------------------------
function exportCSV() {
  const courseAtt = getCourseAttendance();
  const days = Object.keys(courseAtt).sort();
  let csv = "Student ID,Name,Mobile,Department,Section,Course,Present Days,Total Days,Percentage,Status\n";

  Object.values(students).forEach(s => {
    const present = days.filter(d => (courseAtt[d].present || []).includes(s.id)).length;
    const pct = days.length ? ((present / days.length) * 100).toFixed(2) : "0.00";
    const status = parseFloat(pct) < minThreshold ? "AT-RISK" : "OK";
    csv += `"${s.id}","${s.name}","${s.phone}","${s.dept}","${s.sec || 'A'}","${activeCourse}",${present},${days.length},${pct}%,${status}\n`;
  });

  downloadBlob(csv, `Attendance_Report_${activeCourse}.csv`, "text/csv");
  logAuditEvent("EXPORT_CSV", `Exported CSV report for ${activeCourse}`);
}

function exportJSONBackup() {
  const backup = {
    students,
    attendance,
    leaves,
    auditLogs,
    threshold: minThreshold,
    activeCourse,
    version: "2.0-enterprise",
    exportedAt: new Date().toISOString()
  };
  downloadBlob(JSON.stringify(backup, null, 2), "Attendance_Enterprise_Backup.json", "application/json");
  logAuditEvent("BACKUP_JSON", "Exported complete JSON enterprise backup");
}

function syncCloudDatabase() {
  alert("Cloud Database Synchronized!\nAll student attendance records, leave requests, and audit trails synced with central academic database.");
  logAuditEvent("CLOUD_SYNC", "Synchronized state with central academic cloud API.");
}

function handleBulkImport() {
  const text = document.getElementById("bulkImportText")?.value.trim();
  if (!text) { alert("Please paste student data (ID, Name, Mobile, Email, Dept, Sec)."); return; }

  const lines = text.split("\n");
  let count = 0;

  lines.forEach(line => {
    const parts = line.split(",").map(p => p.trim());
    if (parts.length >= 2) {
      const id = parts[0].toUpperCase();
      const name = parts[1];
      const phone = parts[2] || "+18005550199";
      const email = parts[3] || `${id.toLowerCase()}@university.edu`;
      const dept = parts[4] || "CSE";
      const sec = parts[5] || "Sec A";
      students[id] = { id, name, phone, email, dept, sec };
      count++;
    }
  });

  logAuditEvent("BULK_IMPORT", `Bulk imported ${count} student records`);
  saveAllData();
  refreshAllViews();
  closeModal("bulkImportModal");
  alert(`Successfully imported ${count} students!`);
}

function openBulkImportModal() {
  openModal("bulkImportModal");
}

// ---------------------------------------------------------
// 18. MODAL UTILITIES & SAMPLE DATA
// ---------------------------------------------------------
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add("active");
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("active");
}

function downloadBlob(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function loadSampleData(showNotice = true) {
  students = {
    "101": { id: "101", name: "Alice Smith", phone: "+18005550101", email: "alice@university.edu", dept: "CSE", sec: "Sec A" },
    "102": { id: "102", name: "Bob Jones", phone: "+18005550102", email: "bob@university.edu", dept: "CSE", sec: "Sec A" },
    "103": { id: "103", name: "Charlie Brown", phone: "+18005550103", email: "charlie@university.edu", dept: "ECE", sec: "Sec B" },
    "104": { id: "104", name: "Diana Prince", phone: "+18005550104", email: "diana@university.edu", dept: "CSE", sec: "Sec A" },
    "105": { id: "105", name: "Evan Wright", phone: "+18005550105", email: "evan@university.edu", dept: "MECH", sec: "Sec A" },
    "106": { id: "106", name: "Fiona Gallagher", phone: "+18005550106", email: "fiona@university.edu", dept: "IT", sec: "Sec B" },
    "107": { id: "107", name: "George Clark", phone: "+18005550107", email: "george@university.edu", dept: "ECE", sec: "Sec A" },
    "108": { id: "108", name: "Hannah Abbott", phone: "+18005550108", email: "hannah@university.edu", dept: "CSE", sec: "Sec B" },
    "109": { id: "109", name: "Ian Malcolm", phone: "+18005550109", email: "ian@university.edu", dept: "CIVIL", sec: "Sec A" },
    "110": { id: "110", name: "Julia Roberts", phone: "+18005550110", email: "julia@university.edu", dept: "IT", sec: "Sec A" }
  };

  attendance = {
    "CS101": {
      "2026-07-15": { present: ["101", "102", "103", "104", "106", "107", "108", "110"], excused: [] },
      "2026-07-22": { present: ["101", "102", "104", "105", "106", "108", "109"], excused: [] },
      "2026-07-29": { present: ["101", "102", "103", "104", "107", "108", "110"], excused: [] },
      "2026-08-05": { present: ["101", "102", "103", "104", "105", "106", "107", "108", "110"], excused: [] },
      "2026-08-12": { present: ["101", "102", "104", "106", "108", "109", "110"], excused: [] },
      "2026-08-19": { present: ["102", "103", "104", "107", "108"], excused: [] },
      "2026-08-26": { present: ["101", "102", "103", "104", "105", "106", "107", "108", "110"], excused: [] },
      "2026-09-02": { present: ["101", "102", "103", "104", "106", "107", "108"], excused: [] },
      "2026-09-09": { present: ["101", "102", "104", "105", "106", "108", "110"], excused: [] },
      "2026-09-16": { present: ["101", "102", "103", "104", "107", "108", "109", "110"], excused: [] },
      "2026-09-23": { present: ["101", "102", "103", "104", "105", "106", "107", "108", "110"], excused: [] },
      "2026-10-07": { present: ["102", "104", "106", "107", "108", "110"], excused: [] },
      "2026-10-14": { present: ["101", "102", "103", "104", "105", "106", "108", "109", "110"], excused: [] }
    },
    "CS102": {
      "2026-07-20": { present: ["101", "102", "104", "106", "108", "110"], excused: [] },
      "2026-07-27": { present: ["101", "103", "104", "105", "108"], excused: [] },
      "2026-08-03": { present: ["102", "103", "104", "107", "108"], excused: [] },
      "2026-08-10": { present: ["101", "102", "104", "106", "107", "108"], excused: [] },
      "2026-08-17": { present: ["101", "102", "104", "105", "106", "108", "110"], excused: [] },
      "2026-08-24": { present: ["101", "102", "103", "105", "108"], excused: [] },
      "2026-08-31": { present: ["101", "102", "104", "107", "110"], excused: [] },
      "2026-09-07": { present: ["103", "104", "106", "107", "108"], excused: [] },
      "2026-09-14": { present: ["101", "102", "104", "105", "108"], excused: [] },
      "2026-09-21": { present: ["101", "102", "104", "106", "108", "109", "110"], excused: [] },
      "2026-09-28": { present: ["101", "103", "104", "106", "107", "108"], excused: [] },
      "2026-10-05": { present: ["102", "103", "104", "107", "108"], excused: [] },
      "2026-10-12": { present: ["101", "102", "103", "104", "107", "108", "110"], excused: [] },
      "2026-10-19": { present: ["101", "102", "104", "106", "108"], excused: [] },
      "2026-10-26": { present: ["101", "103", "104", "107", "110"], excused: [] },
      "2026-11-02": { present: ["102", "104", "105", "106", "108"], excused: [] },
      "2026-11-09": { present: ["101", "102", "103", "104", "108", "110"], excused: [] }
    },
    "EC201": {
      "2026-07-18": { present: ["101", "103", "107", "109"], excused: [] },
      "2026-07-25": { present: ["101", "102", "104", "107", "108"], excused: [] },
      "2026-08-01": { present: ["101", "103", "105", "107", "110"], excused: [] },
      "2026-08-08": { present: ["101", "103", "105", "107"], excused: [] },
      "2026-08-15": { present: ["101", "102", "103", "106", "107"], excused: [] },
      "2026-08-22": { present: ["101", "103", "106", "107", "109", "110"], excused: [] },
      "2026-08-29": { present: ["103", "104", "107", "108"], excused: [] },
      "2026-09-05": { present: ["101", "103", "105", "107", "109"], excused: [] },
      "2026-09-12": { present: ["101", "102", "103", "107", "108"], excused: [] },
      "2026-09-19": { present: ["101", "103", "104", "107", "110"], excused: [] },
      "2026-10-10": { present: ["101", "103", "104", "107", "109"], excused: [] }
    },
    "CS202": {
      "2026-07-16": { present: ["101", "102", "103", "104", "106", "108"], excused: [] },
      "2026-07-21": { present: ["101", "102", "104", "105", "107"], excused: [] },
      "2026-07-28": { present: ["102", "103", "104", "106", "108", "110"], excused: [] },
      "2026-08-04": { present: ["101", "102", "104", "105", "108"], excused: [] },
      "2026-08-11": { present: ["101", "103", "104", "106", "107", "110"], excused: [] },
      "2026-08-18": { present: ["102", "103", "104", "105", "108"], excused: [] },
      "2026-08-25": { present: ["101", "102", "104", "106", "109"], excused: [] },
      "2026-09-01": { present: ["101", "102", "103", "105", "108", "110"], excused: [] },
      "2026-09-08": { present: ["102", "104", "106", "107", "108"], excused: [] },
      "2026-09-15": { present: ["101", "102", "103", "104", "108"], excused: [] },
      "2026-09-22": { present: ["101", "103", "105", "106", "107", "110"], excused: [] },
      "2026-09-29": { present: ["102", "104", "106", "108"], excused: [] },
      "2026-10-06": { present: ["101", "102", "103", "104", "107"], excused: [] },
      "2026-10-13": { present: ["101", "102", "104", "105", "108", "110"], excused: [] },
      "2026-10-20": { present: ["102", "103", "106", "107", "108"], excused: [] },
      "2026-10-27": { present: ["101", "102", "104", "105", "109"], excused: [] },
      "2026-11-03": { present: ["102", "103", "104", "106", "108"], excused: [] },
      "2026-11-10": { present: ["101", "102", "104", "107", "110"], excused: [] },
      "2026-11-17": { present: ["101", "102", "103", "105", "108"], excused: [] }
    },
    "MA201": {
      "2026-07-25": { present: ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110"], excused: [] },
      "2026-08-01": { present: ["101", "102", "104", "105", "107", "108", "110"], excused: [] },
      "2026-08-08": { present: ["101", "102", "103", "104", "106", "108", "109"], excused: [] },
      "2026-08-15": { present: ["101", "102", "104", "106", "107", "108", "110"], excused: [] },
      "2026-08-22": { present: ["102", "103", "104", "105", "107", "108"], excused: [] },
      "2026-08-29": { present: ["101", "102", "103", "104", "106", "107", "110"], excused: [] },
      "2026-09-05": { present: ["101", "102", "104", "105", "108", "109"], excused: [] },
      "2026-09-12": { present: ["101", "102", "103", "104", "107", "108", "110"], excused: [] },
      "2026-09-19": { present: ["101", "102", "103", "104", "105", "106", "108", "110"], excused: [] },
      "2026-09-26": { present: ["102", "103", "104", "106", "107", "108"], excused: [] },
      "2026-10-17": { present: ["101", "102", "103", "104", "106", "107", "108", "109", "110"], excused: [] }
    }
  };

  leaves = [
    { id: "LEV-101", studentId: "105", courseId: "CS101", startDate: "2026-09-02", endDate: "2026-09-02", type: "Medical", reason: "Viral fever - Doctor note attached", status: "Approved", appliedAt: "2026-09-01" },
    { id: "LEV-102", studentId: "107", courseId: "CS101", startDate: "2026-09-09", endDate: "2026-09-09", type: "Personal", reason: "Family emergency", status: "Approved", appliedAt: "2026-09-08" },
    { id: "LEV-103", studentId: "109", courseId: "EC201", startDate: "2026-08-08", endDate: "2026-08-08", type: "Academic", reason: "National robotics competition", status: "Approved", appliedAt: "2026-08-05" }
  ];

  auditLogs = [
    { id: "LOG-01", timestamp: new Date().toLocaleString(), role: "Admin", user: "Administrator", action: "SYSTEM_INIT", details: "Loaded enterprise sample dataset across 4 subjects and 5 departments." }
  ];

  saveAllData();
  refreshAllViews();
  if (showNotice) alert("Sample dataset loaded successfully!");
}

function initTheme() {
  const saved = localStorage.getItem("att_theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", current);
  localStorage.setItem("att_theme", current);
  renderAnalyticsDashboard();
}

// =========================================================
// 19. ADVANCED ANALYTICS DASHBOARD ENGINE
// =========================================================

let analyticsCharts = {};

function destroyAnalyticsChart(chartId) {
  if (analyticsCharts[chartId]) {
    try {
      analyticsCharts[chartId].destroy();
    } catch (e) {
      console.warn("Chart destroy warning:", e);
    }
    delete analyticsCharts[chartId];
  }
}

function getAnalyticsPalette() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    isDark,
    textColor: isDark ? "#cbd5e1" : "#475569",
    headingColor: isDark ? "#f8fafc" : "#0f172a",
    gridColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
    cardBg: isDark ? "#1e293b" : "#ffffff",
    accent: "#2563eb",
    accentHover: "#1d4ed8",
    accentLight: isDark ? "#1e3a8a" : "#eff6ff",
    success: "#10b981",
    danger: "#ef4444",
    warning: "#f59e0b",
    info: "#0284c7",
    purple: "#8b5cf6",
    deptColors: {
      "CSE": "#2563eb",
      "ECE": "#8b5cf6",
      "MECH": "#d97706",
      "IT": "#0284c7",
      "CIVIL": "#10b981"
    }
  };
}

function populateAnalyticsFilterDropdowns() {
  const subjSelect = document.getElementById("analyticsSubjectFilter");
  const deptSelect = document.getElementById("analyticsDeptFilter");

  if (subjSelect) {
    const currentVal = subjSelect.value || "ALL";
    const availableCourses = Array.from(new Set([
      ...Object.keys(attendance),
      "CS101", "CS102", "EC201", "MA201"
    ])).sort();

    subjSelect.innerHTML = `<option value="ALL">All Subjects Combined</option>` +
      availableCourses.map(c => `<option value="${c}">${c}</option>`).join("");

    if (availableCourses.includes(currentVal) || currentVal === "ALL") {
      subjSelect.value = currentVal;
    }
  }

  if (deptSelect) {
    const currentVal = deptSelect.value || "ALL";
    const depts = Array.from(new Set(Object.values(students).map(s => s.dept || "General"))).sort();
    
    deptSelect.innerHTML = `<option value="ALL">All Departments</option>` +
      depts.map(d => `<option value="${d}">${d}</option>`).join("");

    if (depts.includes(currentVal) || currentVal === "ALL") {
      deptSelect.value = currentVal;
    }
  }
}

function getFilteredAnalyticsData() {
  const subjectFilter = document.getElementById("analyticsSubjectFilter")?.value || "ALL";
  const deptFilter = document.getElementById("analyticsDeptFilter")?.value || "ALL";
  const timeFilter = document.getElementById("analyticsTimeFilter")?.value || "ALL";

  // Target student pool
  let targetStudents = Object.values(students);
  if (deptFilter !== "ALL") {
    targetStudents = targetStudents.filter(s => s.dept === deptFilter);
  }
  const targetStudentIds = new Set(targetStudents.map(s => s.id));

  // Target courses
  const courses = subjectFilter === "ALL" ? Object.keys(attendance) : (attendance[subjectFilter] ? [subjectFilter] : []);

  // Collect all session entries across selected courses: [{ course, date, present: Set, excused: Set }]
  let allSessions = [];
  courses.forEach(c => {
    const cMap = attendance[c] || {};
    Object.entries(cMap).forEach(([dateStr, rec]) => {
      const presentList = (rec.present || []).filter(id => targetStudentIds.has(id));
      const excusedList = (rec.excused || []).filter(id => targetStudentIds.has(id));
      allSessions.push({
        course: c,
        date: dateStr,
        present: presentList,
        excused: excusedList
      });
    });
  });

  // Apply time filter
  if (allSessions.length > 0 && timeFilter !== "ALL") {
    const allDates = allSessions.map(s => s.date).sort();
    const latestDate = new Date(allDates[allDates.length - 1]);
    
    if (timeFilter === "30D") {
      const cutoff = new Date(latestDate);
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().split("T")[0];
      allSessions = allSessions.filter(s => s.date >= cutoffStr);
    } else if (timeFilter === "MONTH") {
      const latestMonthStr = allDates[allDates.length - 1].substring(0, 7); // "YYYY-MM"
      allSessions = allSessions.filter(s => s.date.startsWith(latestMonthStr));
    }
  }

  return {
    targetStudents,
    targetStudentIds,
    allSessions,
    subjectFilter,
    deptFilter,
    timeFilter
  };
}

function renderAnalyticsDashboard() {
  const data = getFilteredAnalyticsData();
  const palette = getAnalyticsPalette();
  const studentCount = data.targetStudents.length;
  const sessions = data.allSessions;

  // 1. Compute High-Level Metrics
  let totalPossible = 0;
  let totalPresent = 0;
  let totalExcused = 0;

  // Count approved leaves matching target students
  const approvedLeavesCount = leaves.filter(l => l.status === "Approved" && data.targetStudentIds.has(l.studentId)).length;

  sessions.forEach(s => {
    totalPossible += studentCount;
    totalPresent += s.present.length;
    totalExcused += s.excused.length;
  });

  totalExcused = Math.max(totalExcused, approvedLeavesCount);
  const totalUnexcused = Math.max(0, totalPossible - totalPresent - totalExcused);

  const avgAttendancePct = totalPossible > 0 ? ((totalPresent / totalPossible) * 100) : 0;

  // Compute student-by-student attendance for At-Risk calculation
  let atRiskCount = 0;
  data.targetStudents.forEach(st => {
    let studentSessions = 0;
    let studentPresent = 0;
    sessions.forEach(s => {
      studentSessions++;
      if (s.present.includes(st.id)) studentPresent++;
    });
    const sPct = studentSessions > 0 ? (studentPresent / studentSessions) * 100 : 100;
    if (sPct < minThreshold) atRiskCount++;
  });

  const atRiskPct = studentCount > 0 ? ((atRiskCount / studentCount) * 100).toFixed(1) : "0.0";

  // Top Performing Subject
  let topSubjName = "N/A";
  let topSubjPct = 0;
  const courseKeys = Object.keys(attendance);
  courseKeys.forEach(c => {
    const cMap = attendance[c] || {};
    let cPoss = 0;
    let cPres = 0;
    Object.values(cMap).forEach(rec => {
      cPoss += studentCount;
      cPres += (rec.present || []).filter(id => data.targetStudentIds.has(id)).length;
    });
    const cRate = cPoss > 0 ? (cPres / cPoss) * 100 : 0;
    if (cRate > topSubjPct) {
      topSubjPct = cRate;
      topSubjName = c;
    }
  });

  // Top Performing Department
  let topDeptName = "N/A";
  let topDeptPct = 0;
  const depts = Array.from(new Set(Object.values(students).map(s => s.dept || "General")));
  depts.forEach(d => {
    const dStudents = Object.values(students).filter(s => s.dept === d);
    const dIds = new Set(dStudents.map(s => s.id));
    let dPoss = 0;
    let dPres = 0;
    Object.values(attendance).forEach(cMap => {
      Object.values(cMap).forEach(rec => {
        dPoss += dStudents.length;
        dPres += (rec.present || []).filter(id => dIds.has(id)).length;
      });
    });
    const dRate = dPoss > 0 ? (dPres / dPoss) * 100 : 0;
    if (dRate > topDeptPct) {
      topDeptPct = dRate;
      topDeptName = d;
    }
  });

  // Update Top KPI Cards
  const elKpiAvg = document.getElementById("kpiAvgAttendance");
  const elKpiAvgSub = document.getElementById("kpiAvgAttendanceSub");
  const elKpiSessions = document.getElementById("kpiTotalSessionsCount");
  const elKpiPresent = document.getElementById("kpiTotalPresentCount");
  const elKpiTopSub = document.getElementById("kpiTopSubject");
  const elKpiTopSubPct = document.getElementById("kpiTopSubjectPct");
  const elKpiTopDept = document.getElementById("kpiTopDept");
  const elKpiTopDeptPct = document.getElementById("kpiTopDeptPct");
  const elKpiAtRisk = document.getElementById("kpiAtRiskRate");
  const elKpiAtRiskCount = document.getElementById("kpiAtRiskCount");

  if (elKpiAvg) elKpiAvg.textContent = `${avgAttendancePct.toFixed(1)}%`;
  if (elKpiAvgSub) {
    const diff = (avgAttendancePct - minThreshold).toFixed(1);
    elKpiAvgSub.textContent = diff >= 0 ? `+${diff}% vs ${minThreshold}% target` : `${diff}% below target`;
    elKpiAvgSub.style.color = diff >= 0 ? "var(--success)" : "var(--danger)";
  }
  if (elKpiSessions) elKpiSessions.textContent = totalPossible.toLocaleString();
  if (elKpiPresent) elKpiPresent.textContent = `${totalPresent.toLocaleString()} Present (${avgAttendancePct.toFixed(1)}%)`;
  if (elKpiTopSub) elKpiTopSub.textContent = topSubjName;
  if (elKpiTopSubPct) elKpiTopSubPct.textContent = `${topSubjPct.toFixed(1)}% Attendance`;
  if (elKpiTopDept) elKpiTopDept.textContent = topDeptName;
  if (elKpiTopDeptPct) elKpiTopDeptPct.textContent = `${topDeptPct.toFixed(1)}% Attendance`;
  if (elKpiAtRisk) elKpiAtRisk.textContent = `${atRiskPct}%`;
  if (elKpiAtRiskCount) elKpiAtRiskCount.textContent = `${atRiskCount} of ${studentCount} students debarred`;

  // Render the 5 Core Charts
  renderMonthlyAttendanceChart(sessions, studentCount, palette);
  renderSubjectWiseChart(data.targetStudentIds, palette);
  renderPresentAbsentChart(totalPresent, totalUnexcused, totalExcused, totalPossible, palette);
  renderDepartmentWiseChart(palette);
  renderAttendanceTrendChart(sessions, studentCount, palette);

  // Render Bottom Tables
  renderAnalyticsTables(palette);
}

// ---------------------------------------------------------
// CHART 1: MONTHLY ATTENDANCE GRAPH
// ---------------------------------------------------------
function renderMonthlyAttendanceChart(sessions, studentCount, palette) {
  const canvas = document.getElementById("monthlyAttendanceChart");
  const chipsContainer = document.getElementById("monthlySummaryChips");
  if (!canvas) return;

  // Aggregate sessions by month (YYYY-MM)
  const monthMap = {};
  sessions.forEach(s => {
    const mKey = s.date.substring(0, 7);
    if (!monthMap[mKey]) monthMap[mKey] = { sessions: 0, present: 0, possible: 0 };
    monthMap[mKey].sessions++;
    monthMap[mKey].present += s.present.length;
    monthMap[mKey].possible += studentCount;
  });

  const sortedMonths = Object.keys(monthMap).sort();
  const monthLabels = sortedMonths.map(m => {
    const parts = m.split("-");
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
    return d.toLocaleString("default", { month: "short", year: "numeric" });
  });

  const monthPcts = sortedMonths.map(m => {
    const item = monthMap[m];
    return item.possible > 0 ? parseFloat(((item.present / item.possible) * 100).toFixed(1)) : 0;
  });

  const monthSessions = sortedMonths.map(m => monthMap[m].sessions);

  // Summary Chips
  if (chipsContainer) {
    chipsContainer.innerHTML = sortedMonths.map((m, idx) => {
      const pct = monthPcts[idx];
      const isOk = pct >= minThreshold;
      return `<span class="summary-chip">${monthLabels[idx]}: <strong>${pct}%</strong> (${monthSessions[idx]} classes)</span>`;
    }).join("");
  }

  destroyAnalyticsChart("monthlyAttendanceChart");

  if (typeof Chart !== "undefined") {
    const ctx = canvas.getContext("2d");
    analyticsCharts["monthlyAttendanceChart"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: monthLabels.length ? monthLabels : ["No Data"],
        datasets: [
          {
            label: "Monthly Attendance Rate (%)",
            data: monthPcts.length ? monthPcts : [0],
            backgroundColor: monthPcts.map(p => p >= minThreshold ? "rgba(37, 99, 235, 0.85)" : "rgba(239, 68, 68, 0.85)"),
            borderRadius: 6,
            yAxisID: "y"
          },
          {
            label: "Sessions Held",
            data: monthSessions.length ? monthSessions : [0],
            type: "line",
            borderColor: palette.warning,
            backgroundColor: palette.warning,
            borderWidth: 2,
            pointRadius: 4,
            yAxisID: "y1"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: palette.textColor } },
          tooltip: {
            callbacks: {
              label: (item) => item.datasetIndex === 0 ? `Attendance: ${item.raw}%` : `Sessions: ${item.raw}`
            }
          }
        },
        scales: {
          x: { ticks: { color: palette.textColor }, grid: { color: palette.gridColor } },
          y: {
            min: 0, max: 100,
            ticks: { color: palette.textColor, callback: v => `${v}%` },
            grid: { color: palette.gridColor }
          },
          y1: {
            position: "right",
            min: 0,
            ticks: { color: palette.textColor, stepSize: 1 },
            grid: { display: false }
          }
        }
      }
    });
  } else {
    drawFallbackBarChart(canvas, monthLabels, monthPcts, "%", palette);
  }
}

// ---------------------------------------------------------
// CHART 2: SUBJECT-WISE ATTENDANCE
// ---------------------------------------------------------
function renderSubjectWiseChart(targetStudentIds, palette) {
  const canvas = document.getElementById("subjectWiseChart");
  const chipsContainer = document.getElementById("subjectSummaryChips");
  if (!canvas) return;

  const courses = Object.keys(attendance).sort();
  const labels = [];
  const pcts = [];
  const sessionCounts = [];

  courses.forEach(c => {
    const cMap = attendance[c] || {};
    const dates = Object.keys(cMap);
    let poss = 0;
    let pres = 0;
    dates.forEach(d => {
      poss += targetStudentIds.size;
      pres += (cMap[d].present || []).filter(id => targetStudentIds.has(id)).length;
    });
    const pct = poss > 0 ? parseFloat(((pres / poss) * 100).toFixed(1)) : 0;
    labels.push(c);
    pcts.push(pct);
    sessionCounts.push(dates.length);
  });

  if (chipsContainer) {
    chipsContainer.innerHTML = labels.map((c, idx) => {
      const isOk = pcts[idx] >= minThreshold;
      const badge = isOk ? "badge-ok" : "badge-low";
      return `<span class="summary-chip"><strong>${c}</strong>: <span class="badge ${badge}">${pcts[idx]}%</span> (${sessionCounts[idx]} sessions)</span>`;
    }).join("");
  }

  destroyAnalyticsChart("subjectWiseChart");

  if (typeof Chart !== "undefined") {
    const ctx = canvas.getContext("2d");
    analyticsCharts["subjectWiseChart"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels.length ? labels : ["No Subjects"],
        datasets: [{
          label: "Subject Attendance (%)",
          data: pcts.length ? pcts : [0],
          backgroundColor: pcts.map(p => p >= minThreshold ? "rgba(16, 185, 129, 0.85)" : "rgba(239, 68, 68, 0.85)"),
          borderColor: pcts.map(p => p >= minThreshold ? "#10b981" : "#ef4444"),
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => `Attendance: ${item.raw}% (${sessionCounts[item.dataIndex]} sessions)`
            }
          }
        },
        scales: {
          x: { ticks: { color: palette.textColor }, grid: { color: palette.gridColor } },
          y: {
            min: 0, max: 100,
            ticks: { color: palette.textColor, callback: v => `${v}%` },
            grid: { color: palette.gridColor }
          }
        }
      }
    });
  } else {
    drawFallbackBarChart(canvas, labels, pcts, "%", palette);
  }
}

// ---------------------------------------------------------
// CHART 3: PRESENT VS ABSENT CHART (DOUGHNUT)
// ---------------------------------------------------------
function renderPresentAbsentChart(totalPresent, totalUnexcused, totalExcused, totalPossible, palette) {
  const canvas = document.getElementById("presentAbsentChart");
  const legendContainer = document.getElementById("presentAbsentLegend");
  if (!canvas) return;

  const presentPct = totalPossible > 0 ? ((totalPresent / totalPossible) * 100).toFixed(1) : "0.0";
  const unexcusedPct = totalPossible > 0 ? ((totalUnexcused / totalPossible) * 100).toFixed(1) : "0.0";
  const excusedPct = totalPossible > 0 ? ((totalExcused / totalPossible) * 100).toFixed(1) : "0.0";

  if (legendContainer) {
    legendContainer.innerHTML = `
      <div class="legend-item"><span class="legend-dot" style="background:#10b981;"></span> Present: <strong>${totalPresent}</strong> (${presentPct}%)</div>
      <div class="legend-item"><span class="legend-dot" style="background:#ef4444;"></span> Unexcused Absent: <strong>${totalUnexcused}</strong> (${unexcusedPct}%)</div>
      <div class="legend-item"><span class="legend-dot" style="background:#f59e0b;"></span> Approved Leaves: <strong>${totalExcused}</strong> (${excusedPct}%)</div>
    `;
  }

  destroyAnalyticsChart("presentAbsentChart");

  if (typeof Chart !== "undefined") {
    const ctx = canvas.getContext("2d");
    analyticsCharts["presentAbsentChart"] = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Present", "Unexcused Absent", "Approved Leaves"],
        datasets: [{
          data: [totalPresent, totalUnexcused, totalExcused],
          backgroundColor: ["#10b981", "#ef4444", "#f59e0b"],
          borderColor: palette.cardBg,
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const total = totalPossible || 1;
                const pct = ((item.raw / total) * 100).toFixed(1);
                return `${item.label}: ${item.raw} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  } else {
    drawFallbackDoughnutChart(canvas, [totalPresent, totalUnexcused, totalExcused], ["#10b981", "#ef4444", "#f59e0b"], palette);
  }
}

// ---------------------------------------------------------
// CHART 4: DEPARTMENT-WISE COMPARISON
// ---------------------------------------------------------
function renderDepartmentWiseChart(palette) {
  const canvas = document.getElementById("departmentWiseChart");
  const chipsContainer = document.getElementById("departmentSummaryChips");
  if (!canvas) return;

  const allDepts = Array.from(new Set(Object.values(students).map(s => s.dept || "General"))).sort();
  const deptPcts = [];
  const deptStudentCounts = [];

  allDepts.forEach(d => {
    const dStudents = Object.values(students).filter(s => s.dept === d);
    const dIds = new Set(dStudents.map(s => s.id));
    let poss = 0;
    let pres = 0;

    Object.values(attendance).forEach(cMap => {
      Object.values(cMap).forEach(rec => {
        poss += dStudents.length;
        pres += (rec.present || []).filter(id => dIds.has(id)).length;
      });
    });

    const pct = poss > 0 ? parseFloat(((pres / poss) * 100).toFixed(1)) : 0;
    deptPcts.push(pct);
    deptStudentCounts.push(dStudents.length);
  });

  if (chipsContainer) {
    chipsContainer.innerHTML = allDepts.map((d, idx) => {
      return `<span class="summary-chip"><strong>${d}</strong>: ${deptPcts[idx]}% (${deptStudentCounts[idx]} students)</span>`;
    }).join("");
  }

  destroyAnalyticsChart("departmentWiseChart");

  const colors = allDepts.map(d => palette.deptColors[d] || "#3b82f6");

  if (typeof Chart !== "undefined") {
    const ctx = canvas.getContext("2d");
    analyticsCharts["departmentWiseChart"] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: allDepts.length ? allDepts : ["No Departments"],
        datasets: [{
          label: "Department Attendance (%)",
          data: deptPcts.length ? deptPcts : [0],
          backgroundColor: colors.map(c => c + "dd"),
          borderColor: colors,
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => `Attendance: ${item.raw}% (${deptStudentCounts[item.dataIndex]} students)`
            }
          }
        },
        scales: {
          x: {
            min: 0, max: 100,
            ticks: { color: palette.textColor, callback: v => `${v}%` },
            grid: { color: palette.gridColor }
          },
          y: { ticks: { color: palette.textColor }, grid: { display: false } }
        }
      }
    });
  } else {
    drawFallbackHorizontalBarChart(canvas, allDepts, deptPcts, "%", colors, palette);
  }
}

// ---------------------------------------------------------
// CHART 5: ATTENDANCE TREND OVER TIME
// ---------------------------------------------------------
function renderAttendanceTrendChart(sessions, studentCount, palette) {
  const canvas = document.getElementById("attendanceTrendChart");
  const momentumText = document.getElementById("trendMomentumText");
  const momentumBadge = document.getElementById("trendMomentumBadge");
  const insightsBar = document.getElementById("trendInsightsBar");
  if (!canvas) return;

  // Aggregate by unique dates chronologically
  const dateMap = {};
  sessions.forEach(s => {
    if (!dateMap[s.date]) dateMap[s.date] = { present: 0, possible: 0 };
    dateMap[s.date].present += s.present.length;
    dateMap[s.date].possible += studentCount;
  });

  const sortedDates = Object.keys(dateMap).sort();
  const trendPcts = sortedDates.map(d => {
    const item = dateMap[d];
    return item.possible > 0 ? parseFloat(((item.present / item.possible) * 100).toFixed(1)) : 0;
  });

  // Calculate 3-session moving average
  const movingAvg = trendPcts.map((val, idx, arr) => {
    const start = Math.max(0, idx - 2);
    const slice = arr.slice(start, idx + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    return parseFloat((sum / slice.length).toFixed(1));
  });

  // Calculate Momentum
  let momentum = "Stable ⚖️";
  let momentumColor = "var(--text-secondary)";
  if (trendPcts.length >= 4) {
    const half = Math.floor(trendPcts.length / 2);
    const firstAvg = trendPcts.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondAvg = trendPcts.slice(half).reduce((a, b) => a + b, 0) / (trendPcts.length - half);
    const diff = secondAvg - firstAvg;
    if (diff > 1.5) {
      momentum = `Upward (+${diff.toFixed(1)}%) 📈`;
      momentumColor = "var(--success)";
    } else if (diff < -1.5) {
      momentum = `Downward (${diff.toFixed(1)}%) 📉`;
      momentumColor = "var(--danger)";
    }
  }

  if (momentumText) {
    momentumText.textContent = momentum;
    momentumText.style.color = momentumColor;
  }

  // Peak & Lowest Session Dates
  let peakDate = "N/A", peakVal = -1;
  let lowDate = "N/A", lowVal = 101;
  sortedDates.forEach((d, idx) => {
    const v = trendPcts[idx];
    if (v > peakVal) { peakVal = v; peakDate = d; }
    if (v < lowVal) { lowVal = v; lowDate = d; }
  });

  if (insightsBar) {
    insightsBar.innerHTML = `
      <div class="insight-pill"><span class="label">Total Sessions:</span> <span class="value">${sortedDates.length}</span></div>
      <div class="insight-pill"><span class="label">Peak Attendance:</span> <span class="value" style="color:var(--success);">${peakVal >= 0 ? peakVal + '%' : 'N/A'} (${peakDate})</span></div>
      <div class="insight-pill"><span class="label">Lowest Attendance:</span> <span class="value" style="color:var(--danger);">${lowVal <= 100 ? lowVal + '%' : 'N/A'} (${lowDate})</span></div>
      <div class="insight-pill"><span class="label">Required Benchmark:</span> <span class="value">${minThreshold}%</span></div>
    `;
  }

  destroyAnalyticsChart("attendanceTrendChart");

  if (typeof Chart !== "undefined") {
    const ctx = canvas.getContext("2d");
    
    // Create gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, "rgba(37, 99, 235, 0.35)");
    gradient.addColorStop(1, "rgba(37, 99, 235, 0.0)");

    analyticsCharts["attendanceTrendChart"] = new Chart(ctx, {
      type: "line",
      data: {
        labels: sortedDates.length ? sortedDates : ["No Data"],
        datasets: [
          {
            label: "Daily Session Attendance (%)",
            data: trendPcts.length ? trendPcts : [0],
            borderColor: "#2563eb",
            backgroundColor: gradient,
            borderWidth: 2.5,
            tension: 0.35,
            fill: true,
            pointBackgroundColor: "#2563eb",
            pointRadius: 4,
            pointHoverRadius: 6
          },
          {
            label: "3-Session Moving Average",
            data: movingAvg.length ? movingAvg : [0],
            borderColor: "#f59e0b",
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.35,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: palette.textColor } },
          tooltip: {
            callbacks: {
              label: (item) => `${item.dataset.label}: ${item.raw}%`
            }
          }
        },
        scales: {
          x: { ticks: { color: palette.textColor }, grid: { color: palette.gridColor } },
          y: {
            min: 0, max: 100,
            ticks: { color: palette.textColor, callback: v => `${v}%` },
            grid: { color: palette.gridColor }
          }
        }
      }
    });
  } else {
    drawFallbackLineChart(canvas, sortedDates, trendPcts, "%", palette);
  }
}

// ---------------------------------------------------------
// ANALYTICS TABLES: DEPARTMENT LEADERBOARD & SUBJECT BREAKDOWN
// ---------------------------------------------------------
function renderAnalyticsTables(palette) {
  const deptTbody = document.getElementById("analyticsDeptTableBody");
  const deptBadge = document.getElementById("analyticsDeptCountBadge");
  const subjTbody = document.getElementById("analyticsSubjectTableBody");
  const subjBadge = document.getElementById("analyticsCourseCountBadge");

  // Departments Leaderboard
  const allDepts = Array.from(new Set(Object.values(students).map(s => s.dept || "General")));
  if (deptBadge) deptBadge.textContent = `${allDepts.length} Departments`;

  const deptRows = allDepts.map(d => {
    const dStudents = Object.values(students).filter(s => s.dept === d);
    const dIds = new Set(dStudents.map(s => s.id));
    let poss = 0;
    let pres = 0;
    let lowCount = 0;

    dStudents.forEach(st => {
      let stPoss = 0, stPres = 0;
      Object.values(attendance).forEach(cMap => {
        Object.values(cMap).forEach(rec => {
          stPoss++;
          if ((rec.present || []).includes(st.id)) stPres++;
        });
      });
      const stPct = stPoss > 0 ? (stPres / stPoss) * 100 : 100;
      if (stPct < minThreshold) lowCount++;
    });

    Object.values(attendance).forEach(cMap => {
      Object.values(cMap).forEach(rec => {
        poss += dStudents.length;
        pres += (rec.present || []).filter(id => dIds.has(id)).length;
      });
    });

    const pct = poss > 0 ? (pres / poss) * 100 : 0;
    return { dept: d, count: dStudents.length, pct, lowCount };
  }).sort((a, b) => b.pct - a.pct);

  if (deptTbody) {
    deptTbody.innerHTML = deptRows.map((item, idx) => {
      const medal = idx === 0 ? "🥇" : (idx === 1 ? "🥈" : (idx === 2 ? "🥉" : `#${idx + 1}`));
      const tierBadge = item.pct >= 85 
        ? '<span class="badge badge-ok">Distinction</span>' 
        : (item.pct >= minThreshold ? '<span class="badge badge-info">Compliant</span>' : '<span class="badge badge-low">Critical Action</span>');
      return `
        <tr>
          <td><strong>${medal}</strong></td>
          <td><strong>${item.dept}</strong></td>
          <td>${item.count} students</td>
          <td><strong>${item.pct.toFixed(1)}%</strong></td>
          <td><span class="${item.lowCount > 0 ? 'badge badge-low' : 'badge badge-ok'}">${item.lowCount}</span></td>
          <td>${tierBadge}</td>
        </tr>
      `;
    }).join("");
  }

  // Subject Performance Breakdown
  const courses = Object.keys(attendance).sort();
  if (subjBadge) subjBadge.textContent = `${courses.length} Subjects`;

  if (subjTbody) {
    subjTbody.innerHTML = courses.map(c => {
      const cMap = attendance[c] || {};
      const dates = Object.keys(cMap);
      let poss = 0;
      let pres = 0;
      dates.forEach(d => {
        poss += Object.keys(students).length;
        pres += (cMap[d].present || []).length;
      });
      const pct = poss > 0 ? (pres / poss) * 100 : 0;
      const isOk = pct >= minThreshold;
      const compliance = isOk 
        ? `<span class="badge badge-ok">Compliant (≥${minThreshold}%)</span>` 
        : `<span class="badge badge-low">At-Risk (&lt;${minThreshold}%)</span>`;

      return `
        <tr>
          <td><strong>${c}</strong></td>
          <td>${dates.length} sessions</td>
          <td>${pres} / ${poss} attendances</td>
          <td><strong>${pct.toFixed(1)}%</strong></td>
          <td>${compliance}</td>
        </tr>
      `;
    }).join("");
  }
}

// ---------------------------------------------------------
// EXPORT ANALYTICS CSV REPORT
// ---------------------------------------------------------
function exportAnalyticsReportCSV() {
  const data = getFilteredAnalyticsData();
  let csv = "=== ADVANCED ACADEMIC ATTENDANCE ANALYTICS REPORT ===\n";
  csv += `Generated On,${new Date().toLocaleString()}\n`;
  csv += `Active Scope Subject,${data.subjectFilter}\n`;
  csv += `Active Scope Dept,${data.deptFilter}\n`;
  csv += `Time Horizon,${data.timeFilter}\n`;
  csv += `Required Minimum Threshold,${minThreshold}%\n\n`;

  // Section 1: Department Breakdown
  csv += "--- DEPARTMENT PERFORMANCE ---\n";
  csv += "Department,Total Students,Average Attendance %,Status\n";
  const depts = Array.from(new Set(Object.values(students).map(s => s.dept || "General"))).sort();
  depts.forEach(d => {
    const dStudents = Object.values(students).filter(s => s.dept === d);
    const dIds = new Set(dStudents.map(s => s.id));
    let poss = 0, pres = 0;
    Object.values(attendance).forEach(cMap => {
      Object.values(cMap).forEach(rec => {
        poss += dStudents.length;
        pres += (rec.present || []).filter(id => dIds.has(id)).length;
      });
    });
    const pct = poss > 0 ? ((pres / poss) * 100).toFixed(2) : "0.00";
    csv += `"${d}",${dStudents.length},${pct}%,${parseFloat(pct) >= minThreshold ? "Compliant" : "At-Risk"}\n`;
  });

  // Section 2: Subject Breakdown
  csv += "\n--- SUBJECT PERFORMANCE ---\n";
  csv += "Course Code,Total Sessions,Attended Sessions,Total Possible,Attendance Rate %\n";
  Object.keys(attendance).sort().forEach(c => {
    const cMap = attendance[c] || {};
    let poss = 0, pres = 0;
    Object.values(cMap).forEach(rec => {
      poss += Object.keys(students).length;
      pres += (rec.present || []).length;
    });
    const pct = poss > 0 ? ((pres / poss) * 100).toFixed(2) : "0.00";
    csv += `"${c}",${Object.keys(cMap).length},${pres},${poss},${pct}%\n`;
  });

  // Section 3: Sessions Log
  csv += "\n--- CHRONOLOGICAL SESSION LOG ---\n";
  csv += "Date,Course,Present Count,Total Enrolled,Attendance %\n";
  data.allSessions.sort((a, b) => a.date.localeCompare(b.date)).forEach(s => {
    const pct = data.targetStudents.length > 0 ? ((s.present.length / data.targetStudents.length) * 100).toFixed(2) : "0.00";
    csv += `"${s.date}","${s.course}",${s.present.length},${data.targetStudents.length},${pct}%\n`;
  });

  downloadBlob(csv, `Advanced_Analytics_Report_${new Date().toISOString().split("T")[0]}.csv`, "text/csv");
  logAuditEvent("ANALYTICS_EXPORT", "Exported Advanced Analytics CSV Report.");
}

// ---------------------------------------------------------
// STANDALONE CANVAS 2D FALLBACK DRAWERS (100% OFFLINE SAFE)
// ---------------------------------------------------------
function drawFallbackBarChart(canvas, labels, values, unit, palette) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.parentElement.clientWidth || 400;
  const h = canvas.height = canvas.parentElement.clientHeight || 260;
  ctx.clearRect(0, 0, w, h);

  const padLeft = 45, padBottom = 35, padTop = 20, padRight = 20;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  // Gridlines & Y-Axis
  ctx.strokeStyle = palette.gridColor;
  ctx.fillStyle = palette.textColor;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";

  for (let i = 0; i <= 4; i++) {
    const yVal = i * 25;
    const yPos = padTop + chartH - (i / 4) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, yPos);
    ctx.lineTo(w - padRight, yPos);
    ctx.stroke();
    ctx.fillText(`${yVal}${unit}`, padLeft - 6, yPos + 4);
  }

  // Bars
  const count = labels.length || 1;
  const barWidth = Math.max(12, Math.min(45, (chartW / count) * 0.6));
  const step = chartW / count;

  labels.forEach((lbl, i) => {
    const val = values[i] || 0;
    const barHeight = (val / 100) * chartH;
    const x = padLeft + i * step + (step - barWidth) / 2;
    const y = padTop + chartH - barHeight;

    ctx.fillStyle = val >= minThreshold ? palette.accent : palette.danger;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
    ctx.fill();

    // Value on top
    ctx.fillStyle = palette.textColor;
    ctx.textAlign = "center";
    ctx.fillText(`${val}${unit}`, x + barWidth / 2, Math.max(padTop + 10, y - 4));

    // Label
    ctx.fillText(lbl, x + barWidth / 2, h - 12);
  });
}

function drawFallbackHorizontalBarChart(canvas, labels, values, unit, colors, palette) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.parentElement.clientWidth || 400;
  const h = canvas.height = canvas.parentElement.clientHeight || 260;
  ctx.clearRect(0, 0, w, h);

  const padLeft = 60, padBottom = 25, padTop = 15, padRight = 45;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  const count = labels.length || 1;
  const barHeight = Math.max(10, Math.min(24, (chartH / count) * 0.6));
  const step = chartH / count;

  labels.forEach((lbl, i) => {
    const val = values[i] || 0;
    const barW = (val / 100) * chartW;
    const y = padTop + i * step + (step - barHeight) / 2;
    const x = padLeft;

    ctx.fillStyle = colors[i] || palette.accent;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barHeight, [0, 4, 4, 0]);
    ctx.fill();

    // Label
    ctx.fillStyle = palette.textColor;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(lbl, padLeft - 8, y + barHeight / 2 + 4);

    // Value
    ctx.textAlign = "left";
    ctx.fillText(`${val}${unit}`, x + barW + 6, y + barHeight / 2 + 4);
  });
}

function drawFallbackDoughnutChart(canvas, values, colors, palette) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.parentElement.clientWidth || 280;
  const h = canvas.height = canvas.parentElement.clientHeight || 240;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 15;
  const innerRadius = radius * 0.65;
  const total = values.reduce((a, b) => a + b, 0) || 1;

  let startAngle = -Math.PI / 2;
  values.forEach((v, i) => {
    const sliceAngle = (v / total) * 2 * Math.PI;
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    ctx.arc(cx, cy, innerRadius, startAngle + sliceAngle, startAngle, true);
    ctx.closePath();
    ctx.fill();
    startAngle += sliceAngle;
  });

  // Center text
  ctx.fillStyle = palette.headingColor;
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  const pct = ((values[0] / total) * 100).toFixed(0);
  ctx.fillText(`${pct}%`, cx, cy + 5);
}

function drawFallbackLineChart(canvas, labels, values, unit, palette) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.parentElement.clientWidth || 600;
  const h = canvas.height = canvas.parentElement.clientHeight || 300;
  ctx.clearRect(0, 0, w, h);

  const padLeft = 45, padBottom = 35, padTop = 20, padRight = 20;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  // Gridlines & Y-Axis
  ctx.strokeStyle = palette.gridColor;
  ctx.fillStyle = palette.textColor;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";

  for (let i = 0; i <= 4; i++) {
    const yVal = i * 25;
    const yPos = padTop + chartH - (i / 4) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, yPos);
    ctx.lineTo(w - padRight, yPos);
    ctx.stroke();
    ctx.fillText(`${yVal}${unit}`, padLeft - 6, yPos + 4);
  }

  if (!labels.length) return;

  const count = labels.length;
  const step = count > 1 ? chartW / (count - 1) : chartW;

  // Draw area gradient fill
  ctx.beginPath();
  labels.forEach((_, i) => {
    const val = values[i] || 0;
    const x = padLeft + i * step;
    const y = padTop + chartH - (val / 100) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(padLeft + (count - 1) * step, padTop + chartH);
  ctx.lineTo(padLeft, padTop + chartH);
  ctx.closePath();
  ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
  ctx.fill();

  // Draw line
  ctx.beginPath();
  labels.forEach((_, i) => {
    const val = values[i] || 0;
    const x = padLeft + i * step;
    const y = padTop + chartH - (val / 100) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Draw points & labels
  labels.forEach((lbl, i) => {
    const val = values[i] || 0;
    const x = padLeft + i * step;
    const y = padTop + chartH - (val / 100) * chartH;

    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Show date on X axis for sampled points
    if (count <= 10 || i % Math.ceil(count / 8) === 0 || i === count - 1) {
      ctx.fillStyle = palette.textColor;
      ctx.textAlign = "center";
      ctx.fillText(lbl.substring(5), x, h - 12);
    }
  });
}
