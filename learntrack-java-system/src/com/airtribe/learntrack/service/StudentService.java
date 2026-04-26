package com.airtribe.learntrack.service;

import com.airtribe.learntrack.entity.Student;
import com.airtribe.learntrack.exception.EntityNotFoundException;
import com.airtribe.learntrack.util.IdGenerator;
import com.airtribe.learntrack.util.ValidationUtil;

import java.util.ArrayList;
import java.util.List;

// Service class that manages student operations.
public class StudentService {
    private final List<Student> students = new ArrayList<>();

    public Student addStudent(String firstName, String lastName, String email, String batch, boolean active) {
        ValidationUtil.validateStudentData(firstName, lastName, email, batch);
        Student student = new Student(
                IdGenerator.getNextStudentId(),
                firstName,
                lastName,
                email,
                batch,
                active
        );
        students.add(student);
        return student;
    }

    // Overloaded method to show method overloading with different parameters.
    public Student addStudent(String firstName, String lastName, String batch, boolean active) {
        ValidationUtil.validateStudentData(firstName, lastName, null, batch);
        Student student = new Student(
                IdGenerator.getNextStudentId(),
                firstName,
                lastName,
                batch,
                active
        );
        students.add(student);
        return student;
    }

    public boolean removeStudent(int studentId) {
        for (int i = 0; i < students.size(); i++) {
            if (students.get(i).getId() == studentId) {
                students.remove(i);
                return true;
            }
        }
        return false;
    }

    public Student findStudentById(int studentId) {
        for (Student student : students) {
            if (student.getId() == studentId) {
                return student;
            }
        }
        return null;
    }

    public Student getStudentByIdOrThrow(int studentId) {
        Student student = findStudentById(studentId);
        if (student == null) {
            throw new EntityNotFoundException("Student with ID " + studentId + " not found.");
        }
        return student;
    }

    public boolean updateStudent(int studentId, String email, String batch, boolean active) {
        Student student = getStudentByIdOrThrow(studentId);
        ValidationUtil.validateStudentData(student.getFirstName(), student.getLastName(), email, batch);
        student.setEmail(email);
        student.setBatch(batch);
        student.setActive(active);
        return true;
    }

    public boolean deactivateStudent(int studentId) {
        Student student = getStudentByIdOrThrow(studentId);
        student.setActive(false);
        return true;
    }

    public List<Student> listStudents() {
        return new ArrayList<>(students);
    }

    public List<Student> listActiveStudents() {
        List<Student> activeStudents = new ArrayList<>();
        for (Student student : students) {
            if (student.isActive()) {
                activeStudents.add(student);
            }
        }
        return activeStudents;
    }

    public List<Student> searchStudentsByBatch(String batch) {
        ValidationUtil.validateRequiredText(batch, "Batch");
        List<Student> matchingStudents = new ArrayList<>();
        for (Student student : students) {
            if (student.getBatch().equalsIgnoreCase(batch)) {
                matchingStudents.add(student);
            }
        }
        return matchingStudents;
    }
}
