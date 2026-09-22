#include <iostream>
#include <set>
#include <map>
#include <vector>
#include <fstream>
#include <sstream>
#include <iomanip>
#include <algorithm>
using namespace std;

struct Student {
    string id, name;
};

map<string, Student> students;
map<string, set<string>> attendance;

void addStudent() {
    Student s;
    cout << "Student ID: "; cin >> s.id;
    cin.ignore();
    cout << "Student Name: "; getline(cin, s.name);
    students[s.id] = s;
    cout << "Student added.\n";
}

void markAttendance() {
    string date, id;
    cout << "Date (e.g. 2026-09-04): "; cin >> date;
    cout << "Enter present student IDs (0 to finish):\n";
    while (cin >> id && id != "0") {
        if (students.count(id)) attendance[date].insert(id);
        else cout << "Student not found: " << id << "\n";
    }
    cout << "Attendance saved.\n";
}

void showSetOperations() {
    string d1, d2;
    cout << "First date: "; cin >> d1;
    cout << "Second date: "; cin >> d2;

    set<string> a = attendance[d1], b = attendance[d2], result;
    cout << "\nA = " << d1 << "\nB = " << d2 << "\n";

    set_union(a.begin(), a.end(), b.begin(), b.end(), inserter(result, result.begin()));
    cout << "A union B: ";
    for (auto id : result) cout << id << " ";
    cout << "\n";

    result.clear();
    set_intersection(a.begin(), a.end(), b.begin(), b.end(), inserter(result, result.begin()));
    cout << "A intersection B: ";
    for (auto id : result) cout << id << " ";
    cout << "\n";

    result.clear();
    set_difference(a.begin(), a.end(), b.begin(), b.end(), inserter(result, result.begin()));
    cout << "A - B: ";
    for (auto id : result) cout << id << " ";
    cout << "\n";

    result.clear();
    set_symmetric_difference(a.begin(), a.end(), b.begin(), b.end(), inserter(result, result.begin()));
    cout << "Symmetric difference: ";
    for (auto id : result) cout << id << " ";
    cout << "\n";
}

void report() {
    if (attendance.empty()) { cout << "No attendance records.\n"; return; }
    cout << "\nAttendance Report\n";
    cout << left << setw(12) << "ID" << setw(22) << "Name" << "Percentage\n";
    cout << string(48, '-') << "\n";
    int totalDays = attendance.size();
    for (auto &[id, s] : students) {
        int present = 0;
        for (auto &[date, ids] : attendance)
            if (ids.count(id)) present++;
        double pct = totalDays ? present * 100.0 / totalDays : 0;
        cout << left << setw(12) << id << setw(22) << s.name
             << fixed << setprecision(2) << pct << "%\n";
    }
}

void saveData() {
    ofstream out("attendance_data.txt");
    for (auto &[id, s] : students)
        out << "STUDENT|" << s.id << "|" << s.name << "\n";
    for (auto &[date, ids] : attendance)
        for (const auto &id : ids)
            out << "ATT|" << date << "|" << id << "\n";
    cout << "Data saved to attendance_data.txt\n";
}

void loadData() {
    ifstream in("attendance_data.txt");
    string line;
    while (getline(in, line)) {
        stringstream ss(line);
        string type, a, b;
        getline(ss, type, '|'); getline(ss, a, '|'); getline(ss, b);
        if (type == "STUDENT") students[a] = {a, b};
        else if (type == "ATT") attendance[a].insert(b);
    }
}

int main() {
    loadData();
    int choice;
    do {
        cout << "\n=== Student Attendance Analyzer Using Set Theory ===\n";
        cout << "1. Add Student\n2. Mark Attendance\n3. Set Theory Analysis\n";
        cout << "4. Attendance Report\n5. Save Data\n0. Exit\nChoice: ";
        cin >> choice;
        switch (choice) {
            case 1: addStudent(); break;
            case 2: markAttendance(); break;
            case 3: showSetOperations(); break;
            case 4: report(); break;
            case 5: saveData(); break;
            case 0: saveData(); cout << "Goodbye!\n"; break;
            default: cout << "Invalid choice.\n";
        }
    } while (choice != 0);
    return 0;
}
