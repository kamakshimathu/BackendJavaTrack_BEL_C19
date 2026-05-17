package com.library.management.strategy;

/*
 * TitleSearchStrategy.java
 * Purpose: Searches books by title.
 * What this file contains:
 * - Strategy implementation for title-based matching
 * Why it exists:
 * - Provides one interchangeable search behavior under the BookSearchStrategy contract
 */

import com.library.management.model.Book;
import com.library.management.model.SearchType;

import java.util.ArrayList;
import java.util.List;

public class TitleSearchStrategy implements BookSearchStrategy {
    @Override
    public SearchType getSearchType() {
        return SearchType.TITLE;
    }

    @Override
    public List<Book> search(List<Book> books, String keyword) {
        List<Book> matches = new ArrayList<>();
        String normalizedKeyword = keyword.toLowerCase();
        for (Book book : books) {
            if (book.getTitle().toLowerCase().contains(normalizedKeyword)) {
                matches.add(book);
            }
        }
        return matches;
    }
}
