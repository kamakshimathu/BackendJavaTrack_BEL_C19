package com.library.management.strategy;

/*
 * IsbnSearchStrategy.java
 * Purpose: Searches books by ISBN.
 * What this file contains:
 * - Strategy implementation for exact ISBN matching
 * Why it exists:
 * - Keeps ISBN search logic separate and interchangeable
 */

import com.library.management.model.Book;
import com.library.management.model.SearchType;

import java.util.ArrayList;
import java.util.List;

public class IsbnSearchStrategy implements BookSearchStrategy {
    @Override
    public SearchType getSearchType() {
        return SearchType.ISBN;
    }

    @Override
    public List<Book> search(List<Book> books, String keyword) {
        List<Book> matches = new ArrayList<>();
        for (Book book : books) {
            if (book.getIsbn().equalsIgnoreCase(keyword)) {
                matches.add(book);
            }
        }
        return matches;
    }
}
