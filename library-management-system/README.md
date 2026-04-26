# Library Management System

## Project Overview
This is a Core Java in-memory Library Management System. It covers the core assignment features and now also includes the first two optional extensions: multi-branch support and reservation with notification on availability. The implementation is structured to make OOP, SOLID, and design-pattern usage explicit and meaningful.

## Documentation Index
- `docs/README.md`: documentation hub for project notes
- `docs/Design_Notes.md`: architecture, OOP, SOLID, and pattern decisions
- `docs/Testing_Notes.md`: user journeys, manual testing notes, console output, and screenshot placeholders
- `docs/Class_Diagram.md`: Mermaid class diagram matching the current codebase

## Features Implemented
- Add, update, remove, and search books
- Add and update patrons
- Checkout and return books with validation
- Track available books and borrowed books
- Track patron borrowing history
- Add and manage library branches
- Transfer available books between branches
- Reserve borrowed books
- Notify patrons when reserved books become available
- In-memory storage using `Map`, `List`, and `Set`
- Logging with built-in `java.util.logging`
- Duplicate prevention and centralized input validation

## Folder Structure
```text
library-management-system
|-- README.md
|-- docs
`-- src
    `-- com
        `-- library
            `-- management
                |-- app
                |-- exception
                |-- factory
                |-- model
                |-- repository
                |-- service
                |-- strategy
                `-- util
```

## What Each Folder Holds
- `app`: the demo entry point that runs the application flow.
- `model`: core domain objects such as books, patrons, branches, reservations, borrow records, and enums.
- `repository`: interfaces and in-memory storage classes for books, patrons, branches, and reservations.
- `service`: business logic for inventory, lending, search orchestration, transfers, and reservations.
- `strategy`: interchangeable search implementations for title, author, and ISBN.
- `factory`: object creation and application wiring classes.
- `exception`: custom exceptions for library-specific error handling.
- `util`: shared helper utilities and notification support used by the reservation feature.
- `docs`: a place for screenshots, notes, or extra documentation you want to include later.

## How to Run the Project
Compile:

```bash
javac -d out (Get-ChildItem -Recurse -Filter *.java src | ForEach-Object { $_.FullName })
```

Run:

```bash
java -cp out com.library.management.app.Main
```
