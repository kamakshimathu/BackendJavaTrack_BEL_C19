package com.library.management.exception;

/*
 * BookAlreadyBorrowedException.java
 * Purpose: Signals that a checkout failed because the book is already borrowed.
 */

public class BookAlreadyBorrowedException extends LibraryException {
    public BookAlreadyBorrowedException(String isbn) {
        super("Book is already borrowed for ISBN: " + isbn);
    }
}
