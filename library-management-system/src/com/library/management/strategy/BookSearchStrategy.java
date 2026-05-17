package com.library.management.strategy;

/*
 * BookSearchStrategy.java
 * Purpose: Strategy contract for book searching.
 * What this file contains:
 * - A common interface for interchangeable search algorithms
 * Why it exists:
 * - Demonstrates polymorphism and the Strategy Pattern
 */

import com.library.management.model.Book;
import com.library.management.model.SearchType;

import java.util.List;

public interface BookSearchStrategy {
    // Strategy Pattern: allows interchangeable search behavior
    SearchType getSearchType();

    List<Book> search(List<Book> books, String keyword);
}
