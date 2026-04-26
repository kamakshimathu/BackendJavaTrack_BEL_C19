package com.library.management.exception;

/*
 * DuplicateBookException.java
 * Purpose: Signals that a book with the same ISBN already exists.
 */

public class DuplicateBookException extends LibraryException {
    public DuplicateBookException(String isbn) {
        super("A book with ISBN already exists: " + isbn);
    }
}
