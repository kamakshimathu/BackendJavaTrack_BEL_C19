# Design Notes

## Why `ArrayList` Instead of Array
`ArrayList` was used because the number of students, courses, and enrollments changes during program execution.  
It allows easy add, remove, and search operations without manually resizing arrays.

## Where Static Members Were Used and Why
Static members were used in `IdGenerator`.

- `studentIdCounter`
- `courseIdCounter`
- `enrollmentIdCounter`
- `getNextStudentId()`
- `getNextCourseId()`
- `getNextEnrollmentId()`

They were used so ID generation is shared across the whole application and does not depend on individual object instances.

## Where Centralized Validation Was Used and Why
Validation logic was centralized in `ValidationUtil`.

It is used to validate:

- student names and batch
- optional email format
- course name and description
- positive course duration
- enrollment status parsing

This keeps validation rules in one place and avoids repeating the same checks across multiple classes.

## Where Inheritance Was Used and What It Gave
Inheritance was used with `Student extends Person`.

`Person` stores common fields like `id`, `firstName`, `lastName`, and `email`.  
`Student` reuses those fields and adds `batch` and `active`.

This reduced duplication and made the relationship between general and specialized classes clearer.  
It also allowed method overriding through `getDisplayName()`.

## Where Exceptions Were Used and Why
Two custom exceptions were used in the project:

- `EntityNotFoundException` for missing student, course, or enrollment IDs
- `InvalidInputException` for invalid numeric, boolean, or status input

These exceptions help the application show clean user-friendly error messages instead of crashing.

## Where Enum Was Used and Why
The `EnrollmentStatus` enum was added for fixed enrollment states:

- `ACTIVE`
- `COMPLETED`
- `CANCELLED`

Using an enum is better than plain strings because it avoids spelling mistakes, improves readability, and keeps allowed values controlled in one place.

## Relationship Validation Added
Extra enrollment validation was added in `EnrollmentService`.

The system now prevents:

- enrolling an inactive student
- enrolling into an inactive course
- creating duplicate active enrollment for the same student and course

These checks make the application logic more realistic while still staying within the scope of the assignment.
