package com.library.management.exception;

/*
 * DuplicatePatronException.java
 * Purpose: Signals that a patron with the same ID already exists.
 */

public class DuplicatePatronException extends LibraryException {
    public DuplicatePatronException(String patronId) {
        super("A patron with ID already exists: " + patronId);
    }
}
