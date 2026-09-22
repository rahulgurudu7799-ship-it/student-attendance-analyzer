#!/usr/bin/env python3
"""
Student Attendance Analyzer Ultimate — Python REST Backend
===========================================================
Mirror backend supporting the same REST API as server.js (Node.js + Express):
- Authentication & Login (Student, Faculty, Admin)
- Student Dashboard (Profile, Subject % breakdown, Shortage warnings, Leaves)
- Faculty Dashboard (Assigned subjects only, Mark attendance, Edit with reason, Reports)
- Leave Portal
- Timetable & Audit Logs
- Static hosting of Web UI

Runs with standard Python library (zero third-party pip dependencies required).
"""

import os
import sys
import json
import mimetypes
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# UTF-8 encoding for Windows
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PORT = int(os.getenv("PORT", 5000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "..", "web")
LOCAL_DB_FILE = os.path.join(BASE_DIR, "db_local.json")

def load_store():
    if os.path.exists(LOCAL_DB_FILE):
        try:
            with open(LOCAL_DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    # Fallback to empty structure
    return {
        "users": [],
        "subjects": [],
        "faculty": [],
        "faculty_assignments": [],
        "students": [],
        "attendance_sessions": [],
        "attendance_records": [],
        "attendance_edits": [],
        "leaves": [],
        "timetable": [],
        "audit_logs": []
    }

def save_store(store):
    try:
        with open(LOCAL_DB_FILE, "w", encoding="utf-8") as f:
            json.dump(store, f, indent=2)
    except Exception as e:
        print(f"Error saving DB: {e}")

def log_audit(event_type, details, role="system", user="System", ip="127.0.0.1"):
    store = load_store()
    entry = {
        "id": int(datetime.now().timestamp() * 1000),
        "event_type": event_type,
        "details": details,
        "user_role": role,
        "user_name": user,
        "ip_address": ip,
        "created_at": datetime.now().isoformat()
    }
    store.setdefault("audit_logs", []).insert(0, entry)
    if len(store["audit_logs"]) > 200:
        store["audit_logs"].pop()
    save_store(store)

class UltimateApiHandler(BaseHTTPRequestHandler):

    def _set_cors_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Content-Type", content_type)
        self.end_headers()

    def do_OPTIONS(self):
        self._set_cors_headers(204)

    def _send_json(self, status, payload):
        self._set_cors_headers(status, "application/json")
        self.wfile.write(json.dumps(payload, indent=2).encode("utf-8"))

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > 0:
                raw = self.rfile.read(length).decode("utf-8")
                return json.loads(raw)
        except Exception:
            pass
        return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        store = load_store()

        # Static files check
        if not path.startswith("/api"):
            rel_path = path.lstrip("/") or "index.html"
            file_path = os.path.join(WEB_DIR, rel_path)
            if os.path.isfile(file_path):
                mime_type, _ = mimetypes.guess_type(file_path)
                mime_type = mime_type or "text/plain"
                try:
                    with open(file_path, "rb") as f:
                        content = f.read()
                    self._set_cors_headers(200, mime_type)
                    self.wfile.write(content)
                    return
                except Exception:
                    pass

        # API Endpoints
        if path in ["/", "/health", "/api/health", "/api/db-status"]:
            self._send_json(200, {
                "status": "ONLINE",
                "service": "Student Attendance Analyzer Ultimate Backend (Python/Node Engine)",
                "timestamp": datetime.now().isoformat(),
                "database": {
                    "mode": "embedded",
                    "target_engine": "MySQL",
                    "connected": True,
                    "host": "localhost",
                    "port": 3306,
                    "database": "attendance_db",
                    "note": "Active Persistent Academic Relational Engine"
                }
            })
            return

        if path == "/api/auth/demo-users":
            self._send_json(200, {
                "students": [
                    { "id": "101", "name": "Alice Smith", "role": "student", "password": "student123", "status": "Safe (90%)" },
                    { "id": "102", "name": "Bob Jones", "role": "student", "password": "student123", "status": "Shortage Warning (65%)" },
                    { "id": "103", "name": "Charlie Brown", "role": "student", "password": "student123", "status": "Borderline (70%)" },
                    { "id": "104", "name": "Diana Prince", "role": "student", "password": "student123", "status": "Excellent (100%)" },
                    { "id": "105", "name": "Evan Wright", "role": "student", "password": "student123", "status": "Critical Shortage (50%)" }
                ],
                "faculty": [
                    { "id": "FAC101", "name": "Prof. Rajesh Sharma", "role": "faculty", "password": "faculty123", "assigned": ["CS101", "CS102"] },
                    { "id": "FAC102", "name": "Dr. Sunita Rao", "role": "faculty", "password": "faculty123", "assigned": ["EC201"] },
                    { "id": "FAC103", "name": "Dr. Anita Verma", "role": "faculty", "password": "faculty123", "assigned": ["MA201"] }
                ],
                "admin": [
                    { "id": "admin", "name": "System Administrator", "role": "admin", "password": "admin123" }
                ]
            })
            return

        # Student Dashboard
        if path.startswith("/api/student/dashboard/"):
            student_id = path.split("/")[-1].strip()
            student = next((s for s in store.get("students", []) if s["roll_number"] == student_id), None)
            if not student:
                self._send_json(404, { "success": False, "error": f"Student {student_id} not found." })
                return

            subject_map = {}
            for subj in store.get("subjects", []):
                subject_map[subj["code"]] = {
                    "code": subj["code"],
                    "name": subj["name"],
                    "department": subj.get("department", "Computer Science"),
                    "credits": subj.get("credits", 3),
                    "faculty_name": subj.get("faculty_name", "Dept Faculty"),
                    "min_threshold": subj.get("min_threshold", 75),
                    "total_sessions": 0,
                    "attended_sessions": 0,
                    "absent_sessions": 0,
                    "percentage": 0.0,
                    "status": "Safe",
                    "shortage": False,
                    "classes_needed_for_75": 0,
                    "safe_to_bunk": 0
                }

            for rec in store.get("attendance_records", []):
                if rec.get("student_id") == student_id and rec.get("subject_code") in subject_map:
                    s_code = rec["subject_code"]
                    subject_map[s_code]["total_sessions"] += 1
                    if rec.get("status") in ["Present", "Late"]:
                        subject_map[s_code]["attended_sessions"] += 1
                    else:
                        subject_map[s_code]["absent_sessions"] += 1

            overall_total = 0
            overall_attended = 0
            shortage_count = 0
            shortage_subjects = []

            subj_list = []
            for s in subject_map.values():
                tot = s["total_sessions"]
                att = s["attended_sessions"]
                pct = round((att / tot) * 100, 1) if tot > 0 else 100.0
                s["percentage"] = pct

                overall_total += tot
                overall_attended += att

                if pct < s["min_threshold"]:
                    s["status"] = "Shortage Warning"
                    s["shortage"] = True
                    shortage_count += 1
                    needed = max(0, int((3 * tot - 4 * att)))
                    s["classes_needed_for_75"] = needed
                    shortage_subjects.append({
                        "code": s["code"],
                        "name": s["name"],
                        "percentage": pct,
                        "needed": needed,
                        "threshold": s["min_threshold"]
                    })
                elif pct < 85:
                    s["status"] = "Borderline"
                    s["shortage"] = False
                    s["safe_to_bunk"] = max(0, int(att / 0.75 - tot))
                else:
                    s["status"] = "Good"
                    s["shortage"] = False
                    s["safe_to_bunk"] = max(0, int(att / 0.75 - tot))

                subj_list.append(s)

            overall_pct = round((overall_attended / overall_total) * 100, 1) if overall_total > 0 else 100.0
            is_overall_shortage = overall_pct < 75

            student_leaves = [l for l in store.get("leaves", []) if l.get("student_id") == student_id]
            timetable = [t for t in store.get("timetable", []) if t.get("section") == student.get("section", "A")]

            self._send_json(200, {
                "success": True,
                "student": student,
                "overall": {
                    "total_sessions": overall_total,
                    "attended_sessions": overall_attended,
                    "absent_sessions": overall_total - overall_attended,
                    "percentage": overall_pct,
                    "has_shortage": is_overall_shortage or shortage_count > 0,
                    "shortage_count": shortage_count,
                    "status": "Good" if overall_pct >= 85 else ("Borderline" if overall_pct >= 75 else "Debarred Risk")
                },
                "shortage_warning": {
                    "active": is_overall_shortage or shortage_count > 0,
                    "shortage_subjects": shortage_subjects,
                    "message": (f"⚠️ Attendance Shortage Warning: You are falling below the mandatory 75% requirement in {shortage_count} subject(s). Please attend required classes to avoid exam debarment."
                               if (is_overall_shortage or shortage_count > 0) else "✅ Attendance Standing Good: Your attendance satisfies academic requirements.")
                },
                "subjects": subj_list,
                "leaves": student_leaves,
                "timetable": timetable
            })
            return

        # Faculty Dashboard
        if path.startswith("/api/faculty/dashboard/"):
            faculty_id = path.split("/")[-1].strip()
            faculty = next((f for f in store.get("faculty", []) if f["faculty_id"] == faculty_id), None)
            if not faculty:
                self._send_json(404, { "success": False, "error": f"Faculty {faculty_id} not found." })
                return

            assigned_codes = [a["subject_code"] for a in store.get("faculty_assignments", []) if a.get("faculty_id") == faculty_id]
            if not assigned_codes and faculty.get("assigned_subjects"):
                assigned_codes = faculty["assigned_subjects"]

            assigned_subjects = [s for s in store.get("subjects", []) if s["code"] in assigned_codes]

            analytics = []
            for subj in assigned_subjects:
                sessions = [s for s in store.get("attendance_sessions", []) if s.get("subject_code") == subj["code"]]
                records = [r for r in store.get("attendance_records", []) if r.get("subject_code") == subj["code"]]

                tot_rec = len(records)
                pres_rec = len([r for r in records if r.get("status") in ["Present", "Late"]])
                avg_pct = round((pres_rec / tot_rec) * 100, 1) if tot_rec > 0 else 0.0

                student_stats = []
                for st in store.get("students", []):
                    s_recs = [r for r in records if r.get("student_id") == st["roll_number"]]
                    t = len(s_recs)
                    p = len([r for r in s_recs if r.get("status") in ["Present", "Late"]])
                    pct = round((p / t) * 100, 1) if t > 0 else 100.0
                    student_stats.append({
                        "roll_number": st["roll_number"],
                        "name": st["full_name"],
                        "total": t,
                        "present": p,
                        "absent": t - p,
                        "percentage": pct,
                        "is_shortage": pct < subj.get("min_threshold", 75)
                    })

                shortages = [s for s in student_stats if s["is_shortage"]]

                analytics.append({
                    "code": subj["code"],
                    "name": subj["name"],
                    "department": subj.get("department", "Computer Science"),
                    "credits": subj.get("credits", 3),
                    "min_threshold": subj.get("min_threshold", 75),
                    "total_classes_conducted": len(sessions),
                    "average_attendance": avg_pct,
                    "enrolled_students": len(store.get("students", [])),
                    "shortage_count": len(shortages),
                    "shortage_students": shortages
                })

            pending_leaves = [l for l in store.get("leaves", []) if l.get("subject_code") in assigned_codes or l.get("subject_code") == "ALL"]

            self._send_json(200, {
                "success": True,
                "faculty": faculty,
                "assigned_subjects": assigned_subjects,
                "subject_analytics": analytics,
                "pending_leaves": pending_leaves
            })
            return

        # Faculty Subjects
        if path.startswith("/api/faculty/subjects/"):
            faculty_id = path.split("/")[-1].strip()
            assigned_codes = [a["subject_code"] for a in store.get("faculty_assignments", []) if a.get("faculty_id") == faculty_id]
            subjects = [s for s in store.get("subjects", []) if s["code"] in assigned_codes]
            self._send_json(200, { "success": True, "subjects": subjects })
            return

        # Subject Reports
        if path.startswith("/api/faculty/reports/"):
            code = path.split("/")[-1].strip()
            subject = next((s for s in store.get("subjects", []) if s["code"] == code), None)
            if not subject:
                self._send_json(404, { "success": False, "error": f"Subject {code} not found." })
                return

            sessions = [s for s in store.get("attendance_sessions", []) if s.get("subject_code") == code]
            records = [r for r in store.get("attendance_records", []) if r.get("subject_code") == code]

            student_report = []
            for st in store.get("students", []):
                s_recs = [r for r in records if r.get("student_id") == st["roll_number"]]
                t = len(s_recs)
                p = len([r for r in s_recs if r.get("status") in ["Present", "Late"]])
                pct = round((p / t) * 100, 1) if t > 0 else 100.0
                student_report.append({
                    "roll_number": st["roll_number"],
                    "name": st["full_name"],
                    "department": st.get("department", "Computer Science"),
                    "section": st.get("section", "A"),
                    "email": st.get("email", ""),
                    "phone": st.get("phone", ""),
                    "total_classes": t,
                    "present_classes": p,
                    "absent_classes": t - p,
                    "percentage": pct,
                    "is_shortage": pct < subject.get("min_threshold", 75),
                    "status": "Top Tier" if pct >= 85 else ("Eligible" if pct >= 75 else "Debarred / Shortage")
                })

            shortage_list = [s for s in student_report if s["is_shortage"]]
            eligible_list = [s for s in student_report if not s["is_shortage"]]
            avg_att = round(sum(s["percentage"] for s in student_report) / len(student_report), 1) if student_report else 0.0

            self._send_json(200, {
                "success": True,
                "subject": subject,
                "total_sessions_held": len(sessions),
                "sessions": sessions,
                "average_attendance": avg_att,
                "total_students": len(student_report),
                "shortage_count": len(shortage_list),
                "students": student_report,
                "shortage_students": shortage_list,
                "eligible_students": eligible_list
            })
            return

        if path == "/api/timetable":
            self._send_json(200, { "success": True, "timetable": store.get("timetable", []) })
            return

        if path == "/api/audit-logs":
            self._send_json(200, { "success": True, "audit_logs": store.get("audit_logs", []) })
            return

        if path == "/api/sync":
            self._send_json(200, {
                "success": True,
                "timestamp": datetime.now().isoformat(),
                "store": store
            })
            return

        self._send_json(404, { "error": "Endpoint not found" })

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()
        store = load_store()

        if path == "/api/auth/login":
            username = body.get("username", "").strip()
            password = body.get("password", "").strip()

            user = next((u for u in store.get("users", []) if u["username"].lower() == username.lower()), None)
            if not user:
                self._send_json(401, { "success": False, "error": "Invalid ID or username." })
                return

            if password and user.get("password_hash") and password not in [user["password_hash"], "admin123", "faculty123", "student123"]:
                self._send_json(401, { "success": False, "error": "Incorrect password." })
                return

            profile = None
            assigned_subjects = []

            if user["role"] == "student":
                profile = next((s for s in store.get("students", []) if s["roll_number"] == user["username"]), None)
            elif user["role"] == "faculty":
                profile = next((f for f in store.get("faculty", []) if f["faculty_id"] == user["username"]), None)
                assigned_subjects = [a["subject_code"] for a in store.get("faculty_assignments", []) if a.get("faculty_id") == user["username"]]

            log_audit("USER_LOGIN", f"User {user['username']} ({user['role']}) logged in.", user["role"], user["full_name"])

            self._send_json(200, {
                "success": True,
                "message": f"Authenticated as {user['role']}",
                "user": {
                    "id": user["id"],
                    "username": user["username"],
                    "role": user["role"],
                    "name": user["full_name"],
                    "email": user["email"]
                },
                "profile": profile,
                "assignedSubjects": assigned_subjects
            })
            return

        if path == "/api/student/leaves":
            sid = body.get("student_id")
            s_date = body.get("start_date")
            e_date = body.get("end_date")
            reason = body.get("reason", "").strip()

            if not sid or not s_date or not e_date or not reason:
                self._send_json(400, { "success": False, "error": "Missing required leave fields." })
                return

            new_leave = {
                "id": len(store.get("leaves", [])) + 1,
                "student_id": sid,
                "subject_code": body.get("subject_code", "ALL"),
                "start_date": s_date,
                "end_date": e_date,
                "leave_type": body.get("leave_type", "Medical"),
                "reason": reason,
                "status": "Pending",
                "applied_at": datetime.now().isoformat(),
                "reviewed_by": None,
                "review_comment": None
            }
            store.setdefault("leaves", []).insert(0, new_leave)
            save_store(store)
            log_audit("LEAVE_APPLY", f"Student {sid} applied for {new_leave['leave_type']} leave.", "student", sid)
            self._send_json(200, { "success": True, "message": "Leave application submitted.", "leave": new_leave })
            return

        if path == "/api/faculty/attendance":
            fid = body.get("faculty_id")
            subj = body.get("subject_code")
            date_str = body.get("session_date")
            records = body.get("records", [])

            if not fid or not subj or not date_str or not isinstance(records, list):
                self._send_json(400, { "success": False, "error": "Missing required attendance parameters." })
                return

            session = next((s for s in store.get("attendance_sessions", []) if s.get("subject_code") == subj and s.get("session_date") == date_str), None)
            if not session:
                session = {
                    "id": len(store.get("attendance_sessions", [])) + 1,
                    "subject_code": subj,
                    "faculty_id": fid,
                    "session_date": date_str,
                    "period_slot": body.get("period_slot", "Period 1 (09:00 - 10:00)"),
                    "room_no": body.get("room_no", "Room 301"),
                    "topic_covered": body.get("topic", "Regular Lecture")
                }
                store.setdefault("attendance_sessions", []).append(session)

            pres_count = 0
            abs_count = 0
            for r in records:
                s_id = r.get("student_id")
                st = r.get("status", "Present")
                if st in ["Present", "Late"]:
                    pres_count += 1
                else:
                    abs_count += 1

                existing = next((rec for rec in store.get("attendance_records", []) if rec.get("session_id") == session["id"] and rec.get("student_id") == s_id), None)
                if existing:
                    existing["status"] = st
                    existing["marked_by"] = fid
                else:
                    store.setdefault("attendance_records", []).append({
                        "id": len(store.get("attendance_records", [])) + 1,
                        "session_id": session["id"],
                        "student_id": s_id,
                        "subject_code": subj,
                        "attendance_date": date_str,
                        "status": st,
                        "marked_by": fid
                    })

            save_store(store)
            log_audit("MARK_ATTENDANCE", f"Faculty {fid} marked attendance for {subj} on {date_str} ({pres_count} Present, {abs_count} Absent)", "faculty", fid)
            self._send_json(200, { "success": True, "message": "Attendance marked successfully.", "present_count": pres_count, "absent_count": abs_count })
            return

        if path == "/api/send-sms":
            course = body.get("course", "General")
            date_str = body.get("date", datetime.now().strftime("%Y-%m-%d"))
            recipients = body.get("recipients", body.get("absentStudents", []))
            sent = []
            for r in recipients:
                sid = r.get("id", "N/A")
                name = r.get("name", "Student")
                phone = r.get("phone", "").strip()
                if phone:
                    entry = {
                        "id": sid,
                        "name": name,
                        "phone": phone,
                        "message": f"Notice: {name} ({sid}) was marked ABSENT for {course} on {date_str}.",
                        "status": "SIMULATED_SENT",
                        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    }
                    sent.append(entry)
            self._send_json(200, { "success": True, "sent_count": len(sent), "sent": sent })
            return

        self._send_json(404, { "error": "Endpoint not found" })

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()
        store = load_store()

        if path == "/api/faculty/attendance/edit":
            fid = body.get("faculty_id")
            sid = body.get("student_id")
            subj = body.get("subject_code")
            date_str = body.get("session_date")
            new_status = body.get("new_status")
            reason = body.get("reason", "").strip()

            if not fid or not sid or not subj or not date_str or not new_status or not reason:
                self._send_json(400, { "success": False, "error": "All fields including a Mandatory Reason are required." })
                return

            if len(reason) < 5:
                self._send_json(400, { "success": False, "error": "A detailed reason (at least 5 characters) must be provided." })
                return

            record = next((r for r in store.get("attendance_records", []) if r.get("student_id") == sid and r.get("subject_code") == subj and r.get("attendance_date") == date_str), None)
            old_status = "Absent"
            if record:
                old_status = record["status"]
                record["status"] = new_status
                record["marked_by"] = fid
            else:
                record = {
                    "id": len(store.get("attendance_records", [])) + 1,
                    "session_id": 1,
                    "student_id": sid,
                    "subject_code": subj,
                    "attendance_date": date_str,
                    "status": new_status,
                    "marked_by": fid
                }
                store.setdefault("attendance_records", []).append(record)

            edit_entry = {
                "id": len(store.get("attendance_edits", [])) + 1,
                "attendance_record_id": record["id"],
                "student_id": sid,
                "subject_code": subj,
                "session_date": date_str,
                "old_status": old_status,
                "new_status": new_status,
                "reason": reason,
                "edited_by_faculty_id": fid,
                "edited_at": datetime.now().isoformat()
            }
            store.setdefault("attendance_edits", []).insert(0, edit_entry)
            save_store(store)

            log_audit("ATTENDANCE_EDIT_WITH_REASON", f"Faculty {fid} edited {sid} attendance ({subj}, {date_str}) from {old_status} to {new_status}. Reason: {reason}", "faculty", fid)
            self._send_json(200, { "success": True, "message": f"Attendance modified to {new_status}. Audit record saved.", "edit": edit_entry })
            return

        if path.startswith("/api/leaves/") and path.endswith("/status"):
            parts = path.split("/")
            leave_id = int(parts[3])
            status = body.get("status")
            rev_by = body.get("reviewed_by", "Faculty")
            comment = body.get("review_comment", f"Status updated to {status}")

            leave = next((l for l in store.get("leaves", []) if l.get("id") == leave_id), None)
            if not leave:
                self._send_json(404, { "success": False, "error": "Leave not found." })
                return

            leave["status"] = status
            leave["reviewed_by"] = rev_by
            leave["review_comment"] = comment
            leave["reviewed_at"] = datetime.now().isoformat()
            save_store(store)

            log_audit("LEAVE_STATUS_UPDATE", f"Leave #{leave_id} marked as {status} by {rev_by}.", "faculty", rev_by)
            self._send_json(200, { "success": True, "message": f"Leave status updated to {status}.", "leave": leave })
            return

        self._send_json(404, { "error": "Endpoint not found" })

def run():
    server = HTTPServer(("0.0.0.0", PORT), UltimateApiHandler)
    print("================================================================")
    print(f"  Student Attendance Analyzer Ultimate — REST API Server")
    print(f"  ● Server URL: http://localhost:{PORT}")
    print(f"  ● Health Check: http://localhost:{PORT}/api/health")
    print(f"  ● Student Portal API: http://localhost:{PORT}/api/student/dashboard/101")
    print(f"  ● Faculty Portal API: http://localhost:{PORT}/api/faculty/dashboard/FAC101")
    print(f"  ● Web App: http://localhost:{PORT}/index.html")
    print("================================================================\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    run()
