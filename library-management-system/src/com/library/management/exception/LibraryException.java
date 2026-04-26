package com.library.management.exception;

/*
 * LibraryException.java
 * Purpose: Base exception for domain-specific library errors.
 * What this file contains:
 * - A parent runtime exception for custom library exceptions
 * Why it exists:
 * - Keeps library-related failures grouped under one application-specific hierarchy
 */

public class LibraryException extends RuntimeException {
    public LibraryException(String message) {
        super(message);
    }
}
