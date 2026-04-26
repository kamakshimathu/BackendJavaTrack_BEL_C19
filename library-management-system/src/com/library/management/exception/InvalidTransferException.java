package com.library.management.exception;

/*
 * InvalidTransferException.java
 * Purpose: Signals that a branch transfer request is invalid.
 */

public class InvalidTransferException extends LibraryException {
    public InvalidTransferException(String message) {
        super(message);
    }
}
