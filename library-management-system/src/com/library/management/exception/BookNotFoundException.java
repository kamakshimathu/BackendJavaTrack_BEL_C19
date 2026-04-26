package com.library.management.exception;

/*
 * BookNotFoundException.java
 * Purpose: Signals that a requested book does not exist.
 */

public class BookNotFoundException extends LibraryException {
    public BookNotFoundException(String isbn) {
        super("Book not found for ISBN: " + isbn);
    }
}
