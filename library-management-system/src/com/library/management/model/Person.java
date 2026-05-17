package com.library.management.model;

/*
 * Person.java
 * Purpose: Abstract base class for people in the system.
 * What this file contains:
 * - Shared identity and contact fields
 * - A shared contract for updating a profile
 * Why it exists:
 * - Demonstrates abstraction and provides reusable state for subclasses
 */

// Abstraction: shared member data is defined in a reusable base class
public abstract class Person {
    // Encapsulation: fields are private and accessed through methods
    private final String id;
    private String name;
    private String email;

    protected Person(String id, String name, String email) {
        this.id = id;
        this.name = name;
        this.email = email;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getEmail() {
        return email;
    }

    public abstract void updateProfile(String name, String email);

    protected void setName(String name) {
        this.name = name;
    }

    protected void setEmail(String email) {
        this.email = email;
    }
}
