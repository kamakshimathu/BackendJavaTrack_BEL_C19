package com.library.management.service;

/*
 * LibraryService.java
 * Purpose: Central business service for the Library Management System.
 * What this file contains:
 * - Core operations for books, patrons, lending, returns, and inventory reporting
 * - Validation, business rules, and exception handling for invalid flows
 * - Collaboration with repository abstractions, factories, and search services
 * Why it exists:
 * - Demonstrates SRP and DIP by keeping business logic in one focused service layer
 */

import com.library.management.exception.BookAlreadyBorrowedException;
import com.library.management.exception.BookNotFoundException;
import com.library.management.exception.BranchNotFoundException;
import com.library.management.exception.DuplicateBookException;
import com.library.management.exception.DuplicateBranchException;
import com.library.management.exception.DuplicatePatronException;
import com.library.management.exception.InvalidReturnException;
import com.library.management.exception.InvalidTransferException;
import com.library.management.exception.PatronNotFoundException;
import com.library.management.exception.ReservationNotAllowedException;
import com.library.management.factory.BookFactory;
import com.library.management.model.Book;
import com.library.management.model.BorrowRecord;
import com.library.management.model.LibraryBranch;
import com.library.management.model.Patron;
import com.library.management.model.Reservation;
import com.library.management.model.SearchType;
import com.library.management.repository.BranchRepository;
import com.library.management.repository.BookRepository;
import com.library.management.repository.PatronRepository;
import com.library.management.repository.ReservationRepository;
import com.library.management.util.InputValidator;
import com.library.management.util.LibraryNotificationHub;

import java.util.ArrayList;
import java.time.LocalDate;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

// DIP: service depends on repository abstractions instead of concrete implementations
public class LibraryService {
    private static final Logger LOGGER = Logger.getLogger(LibraryService.class.getName());

    private final BookRepository bookRepository;
    private final PatronRepository patronRepository;
    private final BranchRepository branchRepository;
    private final ReservationRepository reservationRepository;
    private final BookFactory bookFactory;
    private final BookSearchService bookSearchService;
    private final LibraryNotificationHub notificationHub;

    public LibraryService(
            BookRepository bookRepository,
            PatronRepository patronRepository,
            BranchRepository branchRepository,
            ReservationRepository reservationRepository,
            BookFactory bookFactory,
            BookSearchService bookSearchService,
            LibraryNotificationHub notificationHub
    ) {
        this.bookRepository = bookRepository;
        this.patronRepository = patronRepository;
        this.branchRepository = branchRepository;
        this.reservationRepository = reservationRepository;
        this.bookFactory = bookFactory;
        this.bookSearchService = bookSearchService;
        this.notificationHub = notificationHub;
    }

    public LibraryBranch addBranch(String branchId, String branchName) {
        String normalizedBranchId = InputValidator.requireNonBlank(branchId, "Branch ID");
        String validatedBranchName = InputValidator.requireNonBlank(branchName, "Branch name");
        if (branchRepository.existsById(normalizedBranchId)) {
            LOGGER.warning("Branch add failed, duplicate ID: " + normalizedBranchId);
            throw new DuplicateBranchException(normalizedBranchId);
        }

        LibraryBranch branch = new LibraryBranch(normalizedBranchId, validatedBranchName);
        branchRepository.save(branch);
        LOGGER.info("Branch added: " + normalizedBranchId);
        return branch;
    }

    public List<LibraryBranch> listBranches() {
        return branchRepository.findAll();
    }

    public Book addBookToBranch(String title, String author, String isbn, int publicationYear, String branchId) {
        String normalizedIsbn = InputValidator.normalizeIsbn(isbn);
        String normalizedBranchId = InputValidator.requireNonBlank(branchId, "Branch ID");
        getBranchOrThrow(normalizedBranchId);
        if (bookRepository.existsByIsbn(normalizedIsbn)) {
            LOGGER.warning("Book add failed, duplicate ISBN: " + normalizedIsbn);
            throw new DuplicateBookException(normalizedIsbn);
        }

        Book book = bookFactory.createBook(title, author, isbn, publicationYear);
        book.assignToBranch(normalizedBranchId);
        bookRepository.save(book);
        LOGGER.info("Book added: " + book.getIsbn() + " to branch " + normalizedBranchId);
        return book;
    }

    public void updateBook(String isbn, String title, String author, int publicationYear) {
        Book book = getBookOrThrow(InputValidator.normalizeIsbn(isbn));
        String validatedTitle = InputValidator.requireNonBlank(title, "Title");
        String validatedAuthor = InputValidator.requireNonBlank(author, "Author");
        int validatedYear = InputValidator.validatePublicationYear(publicationYear);
        book.updateDetails(validatedTitle, validatedAuthor, validatedYear);
        bookRepository.save(book);
        LOGGER.info("Book updated: " + book.getIsbn());
    }

    public void removeBook(String isbn) {
        String normalizedIsbn = InputValidator.normalizeIsbn(isbn);
        getBookOrThrow(normalizedIsbn);
        bookRepository.deleteByIsbn(normalizedIsbn);
        LOGGER.info("Book removed: " + normalizedIsbn);
    }

    public void transferBook(String isbn, String fromBranchId, String toBranchId) {
        String normalizedIsbn = InputValidator.normalizeIsbn(isbn);
        String normalizedFromBranchId = InputValidator.requireNonBlank(fromBranchId, "From branch ID");
        String normalizedToBranchId = InputValidator.requireNonBlank(toBranchId, "To branch ID");

        getBranchOrThrow(normalizedFromBranchId);
        getBranchOrThrow(normalizedToBranchId);
        Book book = getBookOrThrow(normalizedIsbn);

        if (!normalizedFromBranchId.equals(book.getBranchId())) {
            throw new InvalidTransferException("Book is not located at source branch: " + normalizedFromBranchId);
        }
        if (!book.isAvailable()) {
            throw new InvalidTransferException("Borrowed books cannot be transferred: " + normalizedIsbn);
        }
        if (normalizedFromBranchId.equals(normalizedToBranchId)) {
            throw new InvalidTransferException("Source and target branch cannot be the same.");
        }

        book.assignToBranch(normalizedToBranchId);
        bookRepository.save(book);
        LOGGER.info("Book transferred. isbn=" + normalizedIsbn + ", from=" + normalizedFromBranchId + ", to=" + normalizedToBranchId);
    }

    public List<Book> searchBooks(SearchType searchType, String keyword) {
        return bookSearchService.search(bookRepository.findAll(), searchType, keyword);
    }

    public Patron addPatron(String patronId, String name, String email) {
        String normalizedPatronId = InputValidator.requireNonBlank(patronId, "Patron ID");
        if (patronRepository.existsById(normalizedPatronId)) {
            LOGGER.warning("Patron add failed, duplicate ID: " + normalizedPatronId);
            throw new DuplicatePatronException(normalizedPatronId);
        }

        String validatedName = InputValidator.requireNonBlank(name, "Patron name");
        String validatedEmail = InputValidator.normalizeEmail(email);
        Patron patron = new Patron(normalizedPatronId, validatedName, validatedEmail);
        patronRepository.save(patron);
        LOGGER.info("Patron added: " + normalizedPatronId);
        return patron;
    }

    public void updatePatron(String patronId, String name, String email) {
        String normalizedPatronId = InputValidator.requireNonBlank(patronId, "Patron ID");
        Patron patron = getPatronOrThrow(normalizedPatronId);
        String validatedName = InputValidator.requireNonBlank(name, "Patron name");
        String validatedEmail = InputValidator.normalizeEmail(email);
        patron.updateProfile(validatedName, validatedEmail);
        patronRepository.save(patron);
        LOGGER.info("Patron updated: " + normalizedPatronId);
    }

    public void checkoutBook(String isbn, String patronId) {
        Book book = getBookOrThrow(InputValidator.normalizeIsbn(isbn));
        checkoutBook(book.getBranchId(), isbn, patronId);
    }

    public void checkoutBook(String branchId, String isbn, String patronId) {
        String normalizedBranchId = InputValidator.requireNonBlank(branchId, "Branch ID");
        String normalizedIsbn = InputValidator.normalizeIsbn(isbn);
        String normalizedPatronId = InputValidator.requireNonBlank(patronId, "Patron ID");
        getBranchOrThrow(normalizedBranchId);
        Book book = getBookOrThrow(normalizedIsbn);
        Patron patron = getPatronOrThrow(normalizedPatronId);

        validateBookBranch(book, normalizedBranchId);

        if (!book.isAvailable()) {
            LOGGER.warning("Checkout failed, book already borrowed: " + normalizedIsbn);
            throw new BookAlreadyBorrowedException(normalizedIsbn);
        }

        Reservation nextReservation = reservationRepository.findFirstActiveByIsbn(normalizedIsbn).orElse(null);
        if (nextReservation != null && !nextReservation.getPatronId().equals(normalizedPatronId)) {
            throw new ReservationNotAllowedException("Book is reserved for patron: " + nextReservation.getPatronId());
        }

        book.markBorrowed();
        patron.addBorrowRecord(new BorrowRecord(normalizedPatronId, normalizedIsbn, normalizedBranchId, book.getTitle(), LocalDate.now()));
        bookRepository.save(book);
        patronRepository.save(patron);
        if (nextReservation != null && nextReservation.getPatronId().equals(normalizedPatronId)) {
            nextReservation.markCompleted();
            reservationRepository.save(nextReservation);
        }
        LOGGER.info("Checkout successful for ISBN " + normalizedIsbn + " by patron " + normalizedPatronId);
    }

    public void returnBook(String isbn, String patronId) {
        Book book = getBookOrThrow(InputValidator.normalizeIsbn(isbn));
        returnBook(book.getBranchId(), isbn, patronId);
    }

    public void returnBook(String branchId, String isbn, String patronId) {
        String normalizedBranchId = InputValidator.requireNonBlank(branchId, "Branch ID");
        String normalizedIsbn = InputValidator.normalizeIsbn(isbn);
        String normalizedPatronId = InputValidator.requireNonBlank(patronId, "Patron ID");
        getBranchOrThrow(normalizedBranchId);
        Book book = getBookOrThrow(normalizedIsbn);
        Patron patron = getPatronOrThrow(normalizedPatronId);

        validateBookBranch(book, normalizedBranchId);

        if (book.isAvailable()) {
            LOGGER.warning("Return failed, book is not currently borrowed: " + normalizedIsbn);
            throw new InvalidReturnException("Book was not borrowed: " + normalizedIsbn);
        }

        BorrowRecord record = patron.findActiveBorrowRecord(normalizedIsbn);
        if (record == null) {
            LOGGER.warning("Return failed, patron did not borrow this book. ISBN: " + normalizedIsbn + ", patron: " + normalizedPatronId);
            throw new InvalidReturnException("Book was not borrowed by patron: " + normalizedPatronId);
        }

        record.markReturned(LocalDate.now());
        book.markReturned();
        bookRepository.save(book);
        patronRepository.save(patron);
        LOGGER.info("Return successful for ISBN " + normalizedIsbn + " by patron " + normalizedPatronId);

        reservationRepository.findFirstActiveByIsbn(normalizedIsbn).ifPresent(reservation -> {
            reservation.markNotified();
            reservationRepository.save(reservation);
            String notificationMessage = "Reserved book now available: ISBN " + normalizedIsbn
                    + " at branch " + normalizedBranchId
                    + " for patron " + reservation.getPatronId();
            notificationHub.notifyObservers("RESERVATION_AVAILABLE", notificationMessage);
        });
    }

    public Reservation reserveBook(String branchId, String isbn, String patronId) {
        String normalizedBranchId = InputValidator.requireNonBlank(branchId, "Branch ID");
        String normalizedIsbn = InputValidator.normalizeIsbn(isbn);
        String normalizedPatronId = InputValidator.requireNonBlank(patronId, "Patron ID");

        getBranchOrThrow(normalizedBranchId);
        getPatronOrThrow(normalizedPatronId);
        Book book = getBookOrThrow(normalizedIsbn);
        validateBookBranch(book, normalizedBranchId);

        if (book.isAvailable()) {
            throw new ReservationNotAllowedException("Only borrowed books can be reserved.");
        }
        if (reservationRepository.findActiveByIsbnAndPatronId(normalizedIsbn, normalizedPatronId).isPresent()) {
            throw new ReservationNotAllowedException("Patron already has an active reservation for this book.");
        }

        Reservation reservation = new Reservation(normalizedPatronId, normalizedIsbn, normalizedBranchId, LocalDate.now());
        reservationRepository.save(reservation);
        LOGGER.info("Reservation created for ISBN " + normalizedIsbn + " by patron " + normalizedPatronId);
        return reservation;
    }

    public List<Book> listAvailableBooks() {
        return bookRepository.findAvailableBooks();
    }

    public List<Book> listBorrowedBooks() {
        return bookRepository.findBorrowedBooks();
    }

    public List<Book> listAvailableBooks(String branchId) {
        String normalizedBranchId = InputValidator.requireNonBlank(branchId, "Branch ID");
        getBranchOrThrow(normalizedBranchId);
        return filterBooksByBranch(bookRepository.findAvailableBooks(), normalizedBranchId);
    }

    public List<Book> listBorrowedBooks(String branchId) {
        String normalizedBranchId = InputValidator.requireNonBlank(branchId, "Branch ID");
        getBranchOrThrow(normalizedBranchId);
        return filterBooksByBranch(bookRepository.findBorrowedBooks(), normalizedBranchId);
    }

    public List<BorrowRecord> getBorrowingHistory(String patronId) {
        String normalizedPatronId = InputValidator.requireNonBlank(patronId, "Patron ID");
        return getPatronOrThrow(normalizedPatronId).getBorrowingHistory();
    }

    public List<Reservation> getReservationsForPatron(String patronId) {
        String normalizedPatronId = InputValidator.requireNonBlank(patronId, "Patron ID");
        getPatronOrThrow(normalizedPatronId);
        return reservationRepository.findByPatronId(normalizedPatronId);
    }

    private Book getBookOrThrow(String isbn) {
        return bookRepository.findByIsbn(isbn).orElseThrow(() -> {
            LOGGER.log(Level.WARNING, "Book lookup failed for ISBN {0}", isbn);
            return new BookNotFoundException(isbn);
        });
    }

    private Patron getPatronOrThrow(String patronId) {
        return patronRepository.findById(patronId).orElseThrow(() -> {
            LOGGER.log(Level.WARNING, "Patron lookup failed for ID {0}", patronId);
            return new PatronNotFoundException(patronId);
        });
    }

    private LibraryBranch getBranchOrThrow(String branchId) {
        return branchRepository.findById(branchId).orElseThrow(() -> {
            LOGGER.log(Level.WARNING, "Branch lookup failed for ID {0}", branchId);
            return new BranchNotFoundException(branchId);
        });
    }

    private void validateBookBranch(Book book, String branchId) {
        if (!branchId.equals(book.getBranchId())) {
            throw new InvalidTransferException("Book " + book.getIsbn() + " is not located at branch " + branchId);
        }
    }

    private List<Book> filterBooksByBranch(List<Book> books, String branchId) {
        List<Book> booksForBranch = new ArrayList<>();
        for (Book book : books) {
            if (branchId.equals(book.getBranchId())) {
                booksForBranch.add(book);
            }
        }
        return booksForBranch;
    }
}
