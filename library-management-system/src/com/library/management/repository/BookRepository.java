package com.library.management.repository;

/*
 * BookRepository.java
 * Purpose: Abstraction for storing and retrieving books.
 * What this file contains:
 * - The contract for book persistence operations in memory
 * Why it exists:
 * - Allows the service layer to depend on an interface instead of a concrete repository
 */

import com.library.management.model.Book;

import java.util.List;
import java.util.Optional;

public interface BookRepository {
    void save(Book book);

    Optional<Book> findByIsbn(String isbn);

    boolean existsByIsbn(String isbn);

    void deleteByIsbn(String isbn);

    List<Book> findAll();

    List<Book> findAvailableBooks();

    List<Book> findBorrowedBooks();
}
