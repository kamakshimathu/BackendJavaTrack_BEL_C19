package com.library.management.exception;

/*
 * ValidationException.java
 * Purpose: Signals that input data is invalid.
 */

public class ValidationException extends LibraryException {
    public ValidationException(String message) {
        super(message);
    }
}
