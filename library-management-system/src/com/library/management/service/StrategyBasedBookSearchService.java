package com.library.management.service;

/*
 * StrategyBasedBookSearchService.java
 * Purpose: Search service that uses the Strategy Pattern.
 * What this file contains:
 * - Registration of search strategies by search type
 * - Runtime selection of title, author, or ISBN search behavior
 * Why it exists:
 * - Makes polymorphism more meaningful by moving search selection out of Main
 */

import com.library.management.exception.ValidationException;
import com.library.management.model.Book;
import com.library.management.model.SearchType;
import com.library.management.strategy.BookSearchStrategy;
import com.library.management.util.InputValidator;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

// Polymorphism: different search strategies are selected and executed through one interface
public class StrategyBasedBookSearchService implements BookSearchService {
    private final Map<SearchType, BookSearchStrategy> strategies = new EnumMap<>(SearchType.class);

    public StrategyBasedBookSearchService(List<BookSearchStrategy> searchStrategies) {
        for (BookSearchStrategy strategy : searchStrategies) {
            strategies.put(strategy.getSearchType(), strategy);
        }
    }

    @Override
    public List<Book> search(List<Book> books, SearchType searchType, String keyword) {
        InputValidator.requireNonBlank(keyword, "Search keyword");
        BookSearchStrategy strategy = strategies.get(searchType);
        if (strategy == null) {
            throw new ValidationException("No strategy registered for search type: " + searchType);
        }
        return strategy.search(books, keyword.trim());
    }
}
