package com.library.management.model;

/*
 * BorrowRecord.java
 * Purpose: Represents one borrowing transaction for a patron.
 * What this file contains:
 * - Borrow details such as patron ID, ISBN, branch ID, book title, borrowed date, and returned date
 * Why it exists:
 * - Keeps borrowing history separate from the Book and Patron core identity fields
 */

import java.time.LocalDate;

public class BorrowRecord {
    private final String patronId;
    private final String isbn;
    private final String branchId;
    private final String bookTitle;
    private final LocalDate borrowedOn;
    private LocalDate returnedOn;

    public BorrowRecord(String patronId, String isbn, String branchId, String bookTitle, LocalDate borrowedOn) {
        this.patronId = patronId;
        this.isbn = isbn;
        this.branchId = branchId;
        this.bookTitle = bookTitle;
        this.borrowedOn = borrowedOn;
    }

    public String getPatronId() {
        return patronId;
    }

    public String getIsbn() {
        return isbn;
    }

    public String getBookTitle() {
        return bookTitle;
    }

    public String getBranchId() {
        return branchId;
    }

    public LocalDate getBorrowedOn() {
        return borrowedOn;
    }

    public LocalDate getReturnedOn() {
        return returnedOn;
    }

    public boolean isActive() {
        return returnedOn == null;
    }

    public void markReturned(LocalDate date) {
        this.returnedOn = date;
    }

    @Override
    public String toString() {
        return "BorrowRecord{" +
                "patronId='" + patronId + '\'' +
                ", isbn='" + isbn + '\'' +
                ", branchId='" + branchId + '\'' +
                ", bookTitle='" + bookTitle + '\'' +
                ", borrowedOn=" + borrowedOn +
                ", returnedOn=" + returnedOn +
                '}';
    }
}
