# Design Notes

## Project Goal
Build a clean in-memory Library Management System in Core Java that clearly demonstrates:
- OOP concepts
- SOLID principles
- relevant design patterns
- Java collections
- input validation and error handling

## Current Scope
This document covers:
- the core assignment requirements
- optional extension 1: multi-branch support with book transfer
- optional extension 2: reservation system with notification when a reserved book becomes available

The recommendation system extension is intentionally not implemented yet.

## Package Design
- `app`: contains `Main`, the demo entry point
- `model`: contains domain objects and enums
- `repository`: contains repository interfaces and in-memory implementations
- `service`: contains business logic and search orchestration
- `strategy`: contains interchangeable search strategies
- `factory`: contains object creation and application wiring classes
- `exception`: contains custom application-specific exceptions
- `util`: contains shared helper logic and notification support used by the reservation flow

## OOP Concepts Used
### Encapsulation
- `Book`, `Patron`, and `BorrowRecord` keep fields private and expose behavior through methods.
- `LibraryBranch` and `Reservation` also keep their own state private and expose focused behavior.

### Abstraction
- `Person` is an abstract base class for shared member information.
- `BookSearchService` and repository interfaces define contracts independent of implementation details.

### Inheritance
- `Patron` extends `Person`.

### Polymorphism
- `BookSearchStrategy` implementations are used interchangeably through `StrategyBasedBookSearchService`.

## SOLID Principles Used
### Single Responsibility Principle
- `Book` manages book data and state changes.
- `Patron` manages member data and borrowing history.
- `LibraryBranch` manages branch identity data.
- `Reservation` manages reservation state only.
- `LibraryService` manages business rules.
- repository classes manage storage only.
- `InputValidator` handles validation centrally.

### Open/Closed Principle
- New search strategies can be added without modifying the search service contract or the library service API.

### Liskov Substitution Principle
- Any implementation of `BookSearchStrategy` can be used wherever the strategy interface is expected.

### Interface Segregation Principle
- Repository and service abstractions are small and focused.

### Dependency Inversion Principle
- `LibraryService` depends on `BookRepository`, `PatronRepository`, `BranchRepository`, `ReservationRepository`, and `BookSearchService` abstractions.

## Design Patterns Used
### Factory Pattern
- `BookFactory` centralizes validated `Book` creation.
- `LibraryServiceFactory` centralizes object wiring for the application.

### Strategy Pattern
- `TitleSearchStrategy`, `AuthorSearchStrategy`, and `IsbnSearchStrategy` implement interchangeable search logic.

### Observer Pattern
- `LibraryNotificationHub` and `LibraryNotificationObserver` are now used in the reservation workflow.
- `LoggingNotificationObserver` receives notifications when a reserved book becomes available.

## Optional Extensions Implemented
### Multi-Branch Support
- books are assigned to a branch
- branches can be added to the system
- available books can be transferred between branches

### Reservation System
- patrons can reserve borrowed books
- reservations are stored in queue order
- when a reserved book is returned, the next patron is notified
- reserved checkout is enforced so another patron cannot bypass the active reservation queue

## Collections Used
- `Map<String, Book>` for fast ISBN lookup
- `Map<String, Patron>` for fast patron lookup
- `Map<String, LibraryBranch>` for fast branch lookup
- `List<BorrowRecord>` for patron borrowing history
- `List<Reservation>` for reservation storage and queue traversal
- `Set<String>` for borrowed book ISBN tracking
