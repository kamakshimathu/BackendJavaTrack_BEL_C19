package com.library.management.factory;

/*
 * BookFactory.java
 * Purpose: Creates valid Book objects.
 * What this file contains:
 * - Centralized book creation logic
 * - Input validation and normalization before object creation
 * Why it exists:
 * - Demonstrates the Factory Pattern with real responsibility instead of direct object creation everywhere
 */

import com.library.management.model.Book;
import com.library.management.util.InputValidator;

public class BookFactory {
    // Factory Pattern: centralizes Book creation
    public Book createBook(String title, String author, String isbn, int publicationYear) {
        String normalizedTitle = InputValidator.requireNonBlank(title, "Title");
        String normalizedAuthor = InputValidator.requireNonBlank(author, "Author");
        String normalizedIsbn = InputValidator.normalizeIsbn(isbn);
        int validatedYear = InputValidator.validatePublicationYear(publicationYear);
        return new Book(normalizedTitle, normalizedAuthor, normalizedIsbn, validatedYear);
    }
}
