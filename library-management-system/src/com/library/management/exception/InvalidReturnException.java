package com.library.management.exception;

/*
 * InvalidReturnException.java
 * Purpose: Signals that a return request is invalid.
 */

public class InvalidReturnException extends LibraryException {
    public InvalidReturnException(String message) {
        super(message);
    }
}
