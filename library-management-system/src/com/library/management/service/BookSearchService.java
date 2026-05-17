package com.library.management.service;

/*
 * BookSearchService.java
 * Purpose: Small abstraction for searching books.
 * What this file contains:
 * - A focused contract for search behavior
 * Why it exists:
 * - Supports DIP and keeps LibraryService independent from a specific search implementation
 */

import com.library.management.model.Book;
import com.library.management.model.SearchType;

import java.util.List;

public interface BookSearchService {
    List<Book> search(List<Book> books, SearchType searchType, String keyword);
}
