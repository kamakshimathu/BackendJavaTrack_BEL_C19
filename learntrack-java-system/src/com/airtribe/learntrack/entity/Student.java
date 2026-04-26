package com.airtribe.learntrack.entity;

// Represents a student in the LearnTrack system.
public class Student extends Person {
    private String batch;
    private boolean active;

    public Student() {
    }

    public Student(int id, String firstName, String lastName, String email, String batch, boolean active) {
        super(id, firstName, lastName, email);
        this.batch = batch;
        this.active = active;
    }

    // Overloaded constructor for creating a student when email is not available.
    public Student(int id, String firstName, String lastName, String batch, boolean active) {
        this(id, firstName, lastName, null, batch, active);
    }

    public String getBatch() {
        return batch;
    }

    public void setBatch(String batch) {
        this.batch = batch;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    @Override
    public String getDisplayName() {
        return getFirstName() + " " + getLastName() + " [" + batch + "]";
    }

    @Override
    public String toString() {
        return "Student{id=" + getId()
                + ", firstName='" + getFirstName() + '\''
                + ", lastName='" + getLastName() + '\''
                + ", email='" + getEmail() + '\''
                + ", batch='" + batch + '\''
                + ", active=" + active
                + '}';
    }
}
