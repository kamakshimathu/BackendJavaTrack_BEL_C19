package com.airtribe.learntrack.service;

import com.airtribe.learntrack.entity.Course;
import com.airtribe.learntrack.exception.EntityNotFoundException;
import com.airtribe.learntrack.util.IdGenerator;
import com.airtribe.learntrack.util.ValidationUtil;

import java.util.ArrayList;
import java.util.List;

// Service class that manages course operations.
public class CourseService {
    private final List<Course> courses = new ArrayList<>();

    public Course addCourse(String courseName, String description, int durationInWeeks, boolean active) {
        ValidationUtil.validateCourseData(courseName, description, durationInWeeks);
        Course course = new Course(
                IdGenerator.getNextCourseId(),
                courseName,
                description,
                durationInWeeks,
                active
        );
        courses.add(course);
        return course;
    }

    public Course findCourseById(int courseId) {
        for (Course course : courses) {
            if (course.getId() == courseId) {
                return course;
            }
        }
        return null;
    }

    public Course getCourseByIdOrThrow(int courseId) {
        Course course = findCourseById(courseId);
        if (course == null) {
            throw new EntityNotFoundException("Course with ID " + courseId + " not found.");
        }
        return course;
    }

    public boolean setCourseActiveStatus(int courseId, boolean active) {
        Course course = getCourseByIdOrThrow(courseId);
        course.setActive(active);
        return true;
    }

    public List<Course> listCourses() {
        return new ArrayList<>(courses);
    }
}
