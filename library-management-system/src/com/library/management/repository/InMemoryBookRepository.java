package com.library.management.repository;

/*
 * InMemoryBookRepository.java
 * Purpose: In-memory implementation of the BookRepository interface.
 * What this file contains:
 * - Map-based storage for books by ISBN
 * - Set-based tracking for borrowed book ISBNs
 * - Inventory retrieval methods for available and borrowed books
 * Why it exists:
 * - Demonstrates SRP by keeping storage logic separate from service logic
 */

import com.library.management.model.Book;
import com.library.management.model.BookStatus;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

// SRP: this class only handles in-memory book storage
public class InMemoryBookRepository implements BookRepository {
    private final Map<String, Book> booksByIsbn = new HashMap<>();
    private final Set<String> borrowedBookIsbns = new HashSet<>();

    @Override
    public void save(Book book) {
        booksByIsbn.put(book.getIsbn(), book);
        if (book.getStatus() == BookStatus.BORROWED) {
            borrowedBookIsbns.add(book.getIsbn());
        } else {
            borrowedBookIsbns.remove(book.getIsbn());
        }
    }

    @Override
    public Optional<Book> findByIsbn(String isbn) {
        return Optional.ofNullable(booksByIsbn.get(isbn));
    }

    @Override
    public boolean existsByIsbn(String isbn) {
        return booksByIsbn.containsKey(isbn);
    }

    @Override
    public void deleteByIsbn(String isbn) {
        booksByIsbn.remove(isbn);
        borrowedBookIsbns.remove(isbn);
    }

    @Override
    public List<Book> findAll() {
        return new ArrayList<>(booksByIsbn.values());
    }

    @Override
    public List<Book> findAvailableBooks() {
        List<Book> availableBooks = new ArrayList<>();
        for (Book book : booksByIsbn.values()) {
            if (book.getStatus() == BookStatus.AVAILABLE) {
                availableBooks.add(book);
            }
        }
        return availableBooks;
    }

    @Override
    public List<Book> findBorrowedBooks() {
        List<Book> borrowedBooks = new ArrayList<>();
        for (String isbn : borrowedBookIsbns) {
            Book book = booksByIsbn.get(isbn);
            if (book != null) {
                borrowedBooks.add(book);
            }
        }
        return borrowedBooks;
    }
}
