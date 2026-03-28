package com.airtribe.learntrack.util;

import com.airtribe.learntrack.entity.Course;
import com.airtribe.learntrack.entity.Student;
import com.airtribe.learntrack.enums.EnrollmentStatus;
import com.airtribe.learntrack.exception.InvalidInputException;

// Centralized helper methods for input and business rule validation.
public class ValidationUtil {
    private ValidationUtil() {
    }

    public static void validateStudentData(String firstName, String lastName, String email, String batch) {
        validateRequiredText(firstName, "First name");
        validateRequiredText(lastName, "Last name");
        validateRequiredText(batch, "Batch");

        if (email != null && !email.trim().isEmpty() && !email.contains("@")) {
            throw new InvalidInputException("Email must contain '@' if provided.");
        }
    }

    public static void validateCourseData(String courseName, String description, int durationInWeeks) {
        validateRequiredText(courseName, "Course name");
        validateRequiredText(description, "Course description");

        if (durationInWeeks <= 0) {
            throw new InvalidInputException("Course duration must be greater than 0.");
        }
    }

    public static void validateRequiredText(String value, String fieldName) {
        if (value == null || value.trim().isEmpty()) {
            throw new InvalidInputException(fieldName + " cannot be empty.");
        }
    }

    public static EnrollmentStatus parseEnrollmentStatus(String input) {
        try {
            return EnrollmentStatus.valueOf(input.trim().toUpperCase());
        } catch (IllegalArgumentException | NullPointerException exception) {
            throw new InvalidInputException("Invalid status. Use ACTIVE, COMPLETED, or CANCELLED.");
        }
    }

    public static void validateActiveStudent(Student student) {
        if (!student.isActive()) {
            throw new InvalidInputException("Cannot enroll an inactive student.");
        }
    }

    public static void validateActiveCourse(Course course) {
        if (!course.isActive()) {
            throw new InvalidInputException("Cannot enroll in an inactive course.");
        }
    }
}
