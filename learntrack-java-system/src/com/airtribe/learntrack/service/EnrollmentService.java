package com.airtribe.learntrack.service;

import com.airtribe.learntrack.entity.Course;
import com.airtribe.learntrack.entity.Enrollment;
import com.airtribe.learntrack.entity.Student;
import com.airtribe.learntrack.enums.EnrollmentStatus;
import com.airtribe.learntrack.exception.EntityNotFoundException;
import com.airtribe.learntrack.exception.InvalidInputException;
import com.airtribe.learntrack.util.IdGenerator;
import com.airtribe.learntrack.util.ValidationUtil;

import java.util.ArrayList;
import java.util.List;

// Service class that manages enrollment operations.
public class EnrollmentService {
    private final List<Enrollment> enrollments = new ArrayList<>();
    private final StudentService studentService;
    private final CourseService courseService;

    public EnrollmentService(StudentService studentService, CourseService courseService) {
        this.studentService = studentService;
        this.courseService = courseService;
    }

    public Enrollment enrollStudent(int studentId, int courseId, String enrollmentDate, EnrollmentStatus status) {
        Student student = studentService.getStudentByIdOrThrow(studentId);
        Course course = courseService.getCourseByIdOrThrow(courseId);

        ValidationUtil.validateActiveStudent(student);
        ValidationUtil.validateActiveCourse(course);
        validateNoDuplicateActiveEnrollment(studentId, courseId);

        Enrollment enrollment = new Enrollment(
                IdGenerator.getNextEnrollmentId(),
                studentId,
                courseId,
                enrollmentDate,
                status
        );
        enrollments.add(enrollment);
        return enrollment;
    }

    public Enrollment findEnrollmentById(int enrollmentId) {
        for (Enrollment enrollment : enrollments) {
            if (enrollment.getId() == enrollmentId) {
                return enrollment;
            }
        }
        return null;
    }

    public Enrollment getEnrollmentByIdOrThrow(int enrollmentId) {
        Enrollment enrollment = findEnrollmentById(enrollmentId);
        if (enrollment == null) {
            throw new EntityNotFoundException("Enrollment with ID " + enrollmentId + " not found.");
        }
        return enrollment;
    }

    public boolean updateEnrollmentStatus(int enrollmentId, EnrollmentStatus status) {
        Enrollment enrollment = getEnrollmentByIdOrThrow(enrollmentId);
        enrollment.setStatus(status);
        return true;
    }

    public List<Enrollment> getEnrollmentsByStudentId(int studentId) {
        List<Enrollment> studentEnrollments = new ArrayList<>();
        for (Enrollment enrollment : enrollments) {
            if (enrollment.getStudentId() == studentId) {
                studentEnrollments.add(enrollment);
            }
        }
        return studentEnrollments;
    }

    public List<Enrollment> listEnrollments() {
        return new ArrayList<>(enrollments);
    }

    public List<Enrollment> getEnrollmentsByCourseId(int courseId) {
        List<Enrollment> courseEnrollments = new ArrayList<>();
        for (Enrollment enrollment : enrollments) {
            if (enrollment.getCourseId() == courseId) {
                courseEnrollments.add(enrollment);
            }
        }
        return courseEnrollments;
    }

    private void validateNoDuplicateActiveEnrollment(int studentId, int courseId) {
        for (Enrollment enrollment : enrollments) {
            if (enrollment.getStudentId() == studentId
                    && enrollment.getCourseId() == courseId
                    && enrollment.getStatus() == EnrollmentStatus.ACTIVE) {
                throw new InvalidInputException("This student already has an active enrollment in the selected course.");
            }
        }
    }
}
