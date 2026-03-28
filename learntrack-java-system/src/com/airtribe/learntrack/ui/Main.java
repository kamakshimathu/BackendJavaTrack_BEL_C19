package com.airtribe.learntrack.ui;

import com.airtribe.learntrack.entity.Course;
import com.airtribe.learntrack.entity.Enrollment;
import com.airtribe.learntrack.entity.Student;
import com.airtribe.learntrack.enums.EnrollmentStatus;
import com.airtribe.learntrack.exception.EntityNotFoundException;
import com.airtribe.learntrack.exception.InvalidInputException;
import com.airtribe.learntrack.service.CourseService;
import com.airtribe.learntrack.service.EnrollmentService;
import com.airtribe.learntrack.service.StudentService;
import com.airtribe.learntrack.util.ValidationUtil;

import java.time.LocalDate;
import java.util.List;
import java.util.Scanner;

public class Main {
    private static final Scanner SCANNER = new Scanner(System.in);
    private static final StudentService STUDENT_SERVICE = new StudentService();
    private static final CourseService COURSE_SERVICE = new CourseService();
    private static final EnrollmentService ENROLLMENT_SERVICE = new EnrollmentService(STUDENT_SERVICE, COURSE_SERVICE);

    public static void main(String[] args) {
        boolean running = true;

        while (running) {
            printMainMenu();
            int option;
            try {
                option = readInt("Enter your choice: ");
            } catch (InvalidInputException exception) {
                System.out.println(exception.getMessage());
                continue;
            }

            switch (option) {
                case 1:
                    runSafely(Main::handleStudentMenu);
                    break;
                case 2:
                    runSafely(Main::handleCourseMenu);
                    break;
                case 3:
                    runSafely(Main::handleEnrollmentMenu);
                    break;
                case 0:
                    running = false;
                    System.out.println("Exiting LearnTrack. Goodbye!");
                    break;
                default:
                    System.out.println("Option not found. Please try again.");
            }
        }
    }

    private static void runSafely(Runnable action) {
        try {
            action.run();
        } catch (EntityNotFoundException exception) {
            System.out.println(exception.getMessage());
        } catch (InvalidInputException exception) {
            System.out.println(exception.getMessage());
        } catch (Exception exception) {
            System.out.println("Something went wrong while processing your request.");
        }
    }

    private static void printMainMenu() {
        System.out.println();
        System.out.println("=== LearnTrack Menu ===");
        System.out.println("1. Student Management");
        System.out.println("2. Course Management");
        System.out.println("3. Enrollment Management");
        System.out.println("0. Exit");
    }

    private static void handleStudentMenu() {
        System.out.println();
        System.out.println("=== Student Management ===");
        System.out.println("1. Add new student");
        System.out.println("2. View all students");
        System.out.println("3. Search student by ID");
        System.out.println("4. Deactivate student");
        System.out.println("5. Update student");
        System.out.println("6. View active students");
        System.out.println("7. Search students by batch");

        int option = readInt("Enter your choice: ");

        switch (option) {
            case 1:
                addStudent();
                break;
            case 2:
                viewAllStudents();
                break;
            case 3:
                searchStudentById();
                break;
            case 4:
                deactivateStudent();
                break;
            case 5:
                updateStudent();
                break;
            case 6:
                viewActiveStudents();
                break;
            case 7:
                searchStudentsByBatch();
                break;
            default:
                System.out.println("Option not found. Please try again.");
        }
    }

    private static void handleCourseMenu() {
        System.out.println();
        System.out.println("=== Course Management ===");
        System.out.println("1. Add new course");
        System.out.println("2. View all courses");
        System.out.println("3. Activate or deactivate a course");

        int option = readInt("Enter your choice: ");

        switch (option) {
            case 1:
                addCourse();
                break;
            case 2:
                viewAllCourses();
                break;
            case 3:
                updateCourseStatus();
                break;
            default:
                System.out.println("Option not found. Please try again.");
        }
    }

    private static void handleEnrollmentMenu() {
        System.out.println();
        System.out.println("=== Enrollment Management ===");
        System.out.println("1. Enroll a student in a course");
        System.out.println("2. View enrollments for a student");
        System.out.println("3. Mark enrollment status");
        System.out.println("4. View enrollments for a course");

        int option = readInt("Enter your choice: ");

        switch (option) {
            case 1:
                enrollStudent();
                break;
            case 2:
                viewEnrollmentsForStudent();
                break;
            case 3:
                updateEnrollmentStatus();
                break;
            case 4:
                viewEnrollmentsForCourse();
                break;
            default:
                System.out.println("Option not found. Please try again.");
        }
    }

    private static void addStudent() {
        String firstName = readLine("Enter first name: ");
        String lastName = readLine("Enter last name: ");
        String email = readLine("Enter email (leave blank if not available): ");
        String batch = readLine("Enter batch: ");

        Student student;
        if (email.isEmpty()) {
            student = STUDENT_SERVICE.addStudent(firstName, lastName, batch, true);
        } else {
            student = STUDENT_SERVICE.addStudent(firstName, lastName, email, batch, true);
        }

        System.out.println("Student added successfully: " + student);
    }

    private static void viewAllStudents() {
        List<Student> students = STUDENT_SERVICE.listStudents();
        if (students.isEmpty()) {
            System.out.println("No students found.");
            return;
        }

        for (Student student : students) {
            System.out.println(student);
        }
    }

    private static void searchStudentById() {
        int studentId = readInt("Enter student ID: ");
        Student student = STUDENT_SERVICE.getStudentByIdOrThrow(studentId);
        System.out.println(student);
    }

    private static void viewActiveStudents() {
        List<Student> students = STUDENT_SERVICE.listActiveStudents();
        if (students.isEmpty()) {
            System.out.println("No active students found.");
            return;
        }

        for (Student student : students) {
            System.out.println(student);
        }
    }

    private static void searchStudentsByBatch() {
        String batch = readLine("Enter batch to search: ");
        List<Student> students = STUDENT_SERVICE.searchStudentsByBatch(batch);
        if (students.isEmpty()) {
            System.out.println("No students found for this batch.");
            return;
        }

        for (Student student : students) {
            System.out.println(student);
        }
    }

    private static void deactivateStudent() {
        int studentId = readInt("Enter student ID to deactivate: ");
        STUDENT_SERVICE.deactivateStudent(studentId);
        System.out.println("Student deactivated successfully.");
    }

    private static void updateStudent() {
        int studentId = readInt("Enter student ID to update: ");
        STUDENT_SERVICE.getStudentByIdOrThrow(studentId);

        String email = readLine("Enter new email: ");
        String batch = readLine("Enter new batch: ");
        boolean active = readBoolean("Is the student active? (true/false): ");
        STUDENT_SERVICE.updateStudent(studentId, email, batch, active);
        System.out.println("Student updated successfully.");
    }

    private static void addCourse() {
        String courseName = readLine("Enter course name: ");
        String description = readLine("Enter course description: ");
        int durationInWeeks = readInt("Enter course duration in weeks: ");

        Course course = COURSE_SERVICE.addCourse(courseName, description, durationInWeeks, true);
        System.out.println("Course added successfully: " + course);
    }

    private static void viewAllCourses() {
        List<Course> courses = COURSE_SERVICE.listCourses();
        if (courses.isEmpty()) {
            System.out.println("No courses found.");
            return;
        }

        for (Course course : courses) {
            System.out.println(course);
        }
    }

    private static void updateCourseStatus() {
        int courseId = readInt("Enter course ID: ");
        COURSE_SERVICE.getCourseByIdOrThrow(courseId);

        boolean active = readBoolean("Set course active? (true/false): ");
        COURSE_SERVICE.setCourseActiveStatus(courseId, active);
        System.out.println("Course status updated successfully.");
    }

    private static void enrollStudent() {
        int studentId = readInt("Enter student ID: ");
        Student student = STUDENT_SERVICE.getStudentByIdOrThrow(studentId);

        int courseId = readInt("Enter course ID: ");
        Course course = COURSE_SERVICE.getCourseByIdOrThrow(courseId);

        Enrollment enrollment = ENROLLMENT_SERVICE.enrollStudent(
                student.getId(),
                course.getId(),
                LocalDate.now().toString(),
                EnrollmentStatus.ACTIVE
        );
        System.out.println("Enrollment created successfully: " + enrollment);
    }

    private static void viewEnrollmentsForStudent() {
        int studentId = readInt("Enter student ID: ");
        STUDENT_SERVICE.getStudentByIdOrThrow(studentId);

        List<Enrollment> enrollments = ENROLLMENT_SERVICE.getEnrollmentsByStudentId(studentId);
        if (enrollments.isEmpty()) {
            System.out.println("No enrollments found for this student.");
            return;
        }

        for (Enrollment enrollment : enrollments) {
            System.out.println(enrollment);
        }
    }

    private static void viewEnrollmentsForCourse() {
        int courseId = readInt("Enter course ID: ");
        COURSE_SERVICE.getCourseByIdOrThrow(courseId);

        List<Enrollment> enrollments = ENROLLMENT_SERVICE.getEnrollmentsByCourseId(courseId);
        if (enrollments.isEmpty()) {
            System.out.println("No enrollments found for this course.");
            return;
        }

        for (Enrollment enrollment : enrollments) {
            System.out.println(enrollment);
        }
    }

    private static void updateEnrollmentStatus() {
        int enrollmentId = readInt("Enter enrollment ID: ");
        ENROLLMENT_SERVICE.getEnrollmentByIdOrThrow(enrollmentId);

        EnrollmentStatus status = readEnrollmentStatus("Enter new status (ACTIVE/COMPLETED/CANCELLED): ");
        ENROLLMENT_SERVICE.updateEnrollmentStatus(enrollmentId, status);
        System.out.println("Enrollment status updated successfully.");
    }

    private static int readInt(String prompt) {
        while (true) {
            System.out.print(prompt);
            String input = SCANNER.nextLine();
            try {
                return Integer.parseInt(input);
            } catch (NumberFormatException exception) {
                throw new InvalidInputException("Invalid number. Please enter a valid integer.");
            }
        }
    }

    private static boolean readBoolean(String prompt) {
        while (true) {
            System.out.print(prompt);
            String input = SCANNER.nextLine().trim().toLowerCase();
            if ("true".equals(input)) {
                return true;
            }
            if ("false".equals(input)) {
                return false;
            }
            throw new InvalidInputException("Invalid input. Please enter true or false.");
        }
    }

    private static String readLine(String prompt) {
        System.out.print(prompt);
        return SCANNER.nextLine().trim();
    }

    private static EnrollmentStatus readEnrollmentStatus(String prompt) {
        System.out.print(prompt);
        String input = SCANNER.nextLine();
        return ValidationUtil.parseEnrollmentStatus(input);
    }
}
