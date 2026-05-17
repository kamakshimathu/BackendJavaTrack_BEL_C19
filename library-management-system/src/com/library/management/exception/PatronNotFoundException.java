package com.library.management.exception;

/*
 * PatronNotFoundException.java
 * Purpose: Signals that a requested patron does not exist.
 */

public class PatronNotFoundException extends LibraryException {
    public PatronNotFoundException(String patronId) {
        super("Patron not found for ID: " + patronId);
    }
}
