package com.library.management.app;

/*
 * Main.java
 * Purpose: Entry point for the Library Management System demo.
 * What this file contains:
 * - Creates the ready-to-use library service through a factory
 * - Demonstrates the core assignment flows end to end
 * - Shows search, checkout, return, invalid operations, and reporting output
 * Why it exists:
 * - Keeps demo execution separate from business logic so the application flow is easy to follow
 */

import com.library.management.exception.LibraryException;
import com.library.management.factory.LibraryServiceFactory;
import com.library.management.model.Book;
import com.library.management.model.BorrowRecord;
import com.library.management.model.LibraryBranch;
import com.library.management.model.Reservation;
import com.library.management.model.SearchType;
import com.library.management.service.LibraryService;

import java.util.List;

public class Main {
    public static void main(String[] args) {
        LibraryService libraryService = LibraryServiceFactory.createDefaultLibraryService();

        libraryService.addBranch("BR-001", "Central Branch");
        libraryService.addBranch("BR-002", "West Branch");

        libraryService.addBookToBranch("Clean Code", "Robert C. Martin", "ISBN-001", 2008, "BR-001");
        libraryService.addBookToBranch("Effective Java", "Joshua Bloch", "ISBN-002", 2018, "BR-001");
        libraryService.addBookToBranch("The Pragmatic Programmer", "Andrew Hunt", "ISBN-003", 1999, "BR-002");
        libraryService.updateBook("ISBN-003", "The Pragmatic Programmer", "Andrew Hunt and David Thomas", 1999);

        libraryService.addPatron("P-100", "Asha Sharma", "asha@example.com");
        libraryService.addPatron("P-101", "Rahul Mehta", "rahul@example.com");
        libraryService.addPatron("P-102", "Neha Verma", "neha@example.com");
        libraryService.updatePatron("P-101", "Rahul Mehta", "rahul.mehta@example.com");

        printSection("Branches");
        printBranches(libraryService.listBranches());

        printSection("Search by title");
        printBooks(libraryService.searchBooks(SearchType.TITLE, "Clean"));

        printSection("Search by author");
        printBooks(libraryService.searchBooks(SearchType.AUTHOR, "Joshua"));

        printSection("Search by ISBN");
        printBooks(libraryService.searchBooks(SearchType.ISBN, "ISBN-003"));

        printSection("Checkout a book");
        libraryService.checkoutBook("BR-001", "ISBN-001", "P-100");
        printBooks(libraryService.listBorrowedBooks("BR-001"));

        printSection("Invalid checkout attempt");
        try {
            libraryService.checkoutBook("BR-001", "ISBN-001", "P-101");
        } catch (LibraryException exception) {
            System.out.println(exception.getMessage());
        }

        printSection("Reserve a borrowed book");
        libraryService.reserveBook("BR-001", "ISBN-001", "P-101");
        printReservations(libraryService.getReservationsForPatron("P-101"));

        printSection("Transfer a book between branches");
        libraryService.transferBook("ISBN-002", "BR-001", "BR-002");
        printBooks(libraryService.listAvailableBooks("BR-002"));

        printSection("Invalid transfer attempt");
        try {
            libraryService.transferBook("ISBN-001", "BR-001", "BR-002");
        } catch (LibraryException exception) {
            System.out.println(exception.getMessage());
        }

        printSection("Return a book and trigger reservation notification");
        libraryService.returnBook("BR-001", "ISBN-001", "P-100");
        printBooks(libraryService.listAvailableBooks("BR-001"));

        printSection("Reserved patron checks out the returned book");
        libraryService.checkoutBook("BR-001", "ISBN-001", "P-101");
        printBooks(libraryService.listBorrowedBooks("BR-001"));

        printSection("Invalid return attempt for a book that was not borrowed");
        try {
            libraryService.returnBook("BR-002", "ISBN-003", "P-100");
        } catch (LibraryException exception) {
            System.out.println(exception.getMessage());
        }

        printSection("Invalid return attempt by a different patron");
        try {
            libraryService.returnBook("BR-001", "ISBN-001", "P-102");
        } catch (LibraryException exception) {
            System.out.println(exception.getMessage());
        }

        printSection("Borrowing history for P-100");
        printBorrowRecords(libraryService.getBorrowingHistory("P-100"));

        printSection("Borrowing history for P-101");
        printBorrowRecords(libraryService.getBorrowingHistory("P-101"));

        printSection("Available books at Central Branch");
        printBooks(libraryService.listAvailableBooks("BR-001"));

        printSection("Borrowed books at Central Branch");
        printBooks(libraryService.listBorrowedBooks("BR-001"));

        printSection("Available books at West Branch");
        printBooks(libraryService.listAvailableBooks("BR-002"));
    }

    private static void printSection(String title) {
        System.out.println();
        System.out.println("=== " + title + " ===");
    }

    private static void printBooks(List<Book> books) {
        if (books.isEmpty()) {
            System.out.println("No books found.");
            return;
        }

        for (Book book : books) {
            System.out.println(book);
        }
    }

    private static void printBorrowRecords(List<BorrowRecord> records) {
        if (records.isEmpty()) {
            System.out.println("No borrowing history found.");
            return;
        }

        for (BorrowRecord record : records) {
            System.out.println(record);
        }
    }

    private static void printBranches(List<LibraryBranch> branches) {
        if (branches.isEmpty()) {
            System.out.println("No branches found.");
            return;
        }

        for (LibraryBranch branch : branches) {
            System.out.println(branch);
        }
    }

    private static void printReservations(List<Reservation> reservations) {
        if (reservations.isEmpty()) {
            System.out.println("No reservations found.");
            return;
        }

        for (Reservation reservation : reservations) {
            System.out.println(reservation);
        }
    }
}
