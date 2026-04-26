package com.library.management.model;

/*
 * Book.java
 * Purpose: Represents a single book in the library inventory.
 * What this file contains:
 * - Core book details such as title, author, ISBN, publication year, and status
 * - State-changing behavior for updating, borrowing, returning, and branch assignment
 * Why it exists:
 * - Demonstrates encapsulation by keeping book state and behavior together
 */

import java.util.Objects;

public class Book {
    // Encapsulation: fields are private and accessed through methods
    private String title;
    private String author;
    private final String isbn;
    private int publicationYear;
    private BookStatus status;
    private String branchId;

    public Book(String title, String author, String isbn, int publicationYear) {
        this.title = title;
        this.author = author;
        this.isbn = isbn;
        this.publicationYear = publicationYear;
        this.status = BookStatus.AVAILABLE;
    }

    public String getTitle() {
        return title;
    }

    public String getAuthor() {
        return author;
    }

    public String getIsbn() {
        return isbn;
    }

    public int getPublicationYear() {
        return publicationYear;
    }

    public BookStatus getStatus() {
        return status;
    }

    public String getBranchId() {
        return branchId;
    }

    public boolean isAvailable() {
        return status == BookStatus.AVAILABLE;
    }

    public void updateDetails(String title, String author, int publicationYear) {
        this.title = title;
        this.author = author;
        this.publicationYear = publicationYear;
    }

    public void markBorrowed() {
        this.status = BookStatus.BORROWED;
    }

    public void markReturned() {
        this.status = BookStatus.AVAILABLE;
    }

    public void assignToBranch(String branchId) {
        this.branchId = branchId;
    }

    @Override
    public String toString() {
        return "Book{" +
                "title='" + title + '\'' +
                ", author='" + author + '\'' +
                ", isbn='" + isbn + '\'' +
                ", publicationYear=" + publicationYear +
                ", status=" + status +
                ", branchId='" + branchId + '\'' +
                '}';
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof Book book)) {
            return false;
        }
        return Objects.equals(isbn, book.isbn);
    }

    @Override
    public int hashCode() {
        return Objects.hash(isbn);
    }
}
