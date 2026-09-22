import json
from pathlib import Path

DATA_FILE = Path("attendance_data.json")
students = {}
attendance = {}

def save():
    DATA_FILE.write_text(json.dumps({
        "students": students,
        "attendance": {d: list(ids) for d, ids in attendance.items()}
    }, indent=2))
    print("Data saved.")

def load():
    global students, attendance
    if DATA_FILE.exists():
        data = json.loads(DATA_FILE.read_text())
        students = data.get("students", {})
        attendance = {d: set(ids) for d, ids in data.get("attendance", {}).items()}

def add_student():
    sid = input("Student ID: ").strip()
    name = input("Student Name: ").strip()
    students[sid] = name
    print("Student added.")

def mark_attendance():
    date = input("Date (YYYY-MM-DD): ").strip()
    ids = input("Present student IDs separated by spaces: ").split()
    valid = {sid for sid in ids if sid in students}
    attendance[date] = valid
    print(f"{len(valid)} students marked present.")

def set_analysis():
    d1 = input("First date: ").strip()
    d2 = input("Second date: ").strip()
    a, b = attendance.get(d1, set()), attendance.get(d2, set())
    print("\nA =", a)
    print("B =", b)
    print("A union B =", a | b)
    print("A intersection B =", a & b)
    print("A - B =", a - b)
    print("B - A =", b - a)
    print("Symmetric difference =", a ^ b)

def report():
    days = len(attendance)
    print("\n=== Attendance Report ===")
    if not days:
        print("No attendance records.")
        return
    for sid, name in students.items():
        present = sum(sid in ids for ids in attendance.values())
        pct = present / days * 100
        status = "LOW ATTENDANCE" if pct < 75 else "OK"
        print(f"{sid:12} {name:25} {pct:6.2f}%  {status}")

def main():
    load()
    while True:
        print("\n=== Student Attendance Analyzer Using Set Theory ===")
        print("1. Add Student")
        print("2. Mark Attendance")
        print("3. Set Theory Analysis")
        print("4. Attendance Report")
        print("5. Save Data")
        print("0. Exit")
        choice = input("Choice: ").strip()
        if choice == "1": add_student()
        elif choice == "2": mark_attendance()
        elif choice == "3": set_analysis()
        elif choice == "4": report()
        elif choice == "5": save()
        elif choice == "0":
            save()
            print("Goodbye!")
            break
        else: print("Invalid choice.")

if __name__ == "__main__":
    main()
