package com.library.management.strategy;

/*
 * AuthorSearchStrategy.java
 * Purpose: Searches books by author.
 * What this file contains:
 * - Strategy implementation for author-based matching
 * Why it exists:
 * - Supports Open/Closed Principle by adding behavior without changing core search logic
 */

import com.library.management.model.Book;
import com.library.management.model.SearchType;

import java.util.ArrayList;
import java.util.List;

public class AuthorSearchStrategy implements BookSearchStrategy {
    @Override
    public SearchType getSearchType() {
        return SearchType.AUTHOR;
    }

    @Override
    public List<Book> search(List<Book> books, String keyword) {
        List<Book> matches = new ArrayList<>();
        String normalizedKeyword = keyword.toLowerCase();
        for (Book book : books) {
            if (book.getAuthor().toLowerCase().contains(normalizedKeyword)) {
                matches.add(book);
            }
        }
        return matches;
    }
}
