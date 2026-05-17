package com.library.management.factory;

/*
 * LibraryServiceFactory.java
 * Purpose: Builds a ready-to-use LibraryService with all dependencies wired together.
 * What this file contains:
 * - Creation of repositories, search strategies, search service, and business service
 * Why it exists:
 * - Keeps object wiring out of Main and makes the application easier to understand
 */

import com.library.management.repository.BookRepository;
import com.library.management.repository.BranchRepository;
import com.library.management.repository.InMemoryBranchRepository;
import com.library.management.repository.InMemoryBookRepository;
import com.library.management.repository.InMemoryPatronRepository;
import com.library.management.repository.InMemoryReservationRepository;
import com.library.management.repository.PatronRepository;
import com.library.management.repository.ReservationRepository;
import com.library.management.service.BookSearchService;
import com.library.management.service.LibraryService;
import com.library.management.service.StrategyBasedBookSearchService;
import com.library.management.strategy.AuthorSearchStrategy;
import com.library.management.strategy.BookSearchStrategy;
import com.library.management.strategy.IsbnSearchStrategy;
import com.library.management.strategy.TitleSearchStrategy;
import com.library.management.util.LibraryNotificationHub;
import com.library.management.util.LoggingNotificationObserver;

import java.util.List;

public final class LibraryServiceFactory {
    private LibraryServiceFactory() {
    }

    public static LibraryService createDefaultLibraryService() {
        BookRepository bookRepository = new InMemoryBookRepository();
        PatronRepository patronRepository = new InMemoryPatronRepository();
        BranchRepository branchRepository = new InMemoryBranchRepository();
        ReservationRepository reservationRepository = new InMemoryReservationRepository();

        List<BookSearchStrategy> searchStrategies = List.of(
                new TitleSearchStrategy(),
                new AuthorSearchStrategy(),
                new IsbnSearchStrategy()
        );

        BookSearchService bookSearchService = new StrategyBasedBookSearchService(searchStrategies);
        LibraryNotificationHub notificationHub = new LibraryNotificationHub();
        notificationHub.addObserver(new LoggingNotificationObserver());

        return new LibraryService(
                bookRepository,
                patronRepository,
                branchRepository,
                reservationRepository,
                new BookFactory(),
                bookSearchService,
                notificationHub
        );
    }
}
