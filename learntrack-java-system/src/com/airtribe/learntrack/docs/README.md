# LearnTrack Java System

## Project Description
LearnTrack is a menu-driven console application built in Java to manage students, courses, and enrollments.
The project demonstrates core OOP concepts such as encapsulation, inheritance, constructor overloading, static members, service classes, and custom exception handling.

## Features
- Add, view, search, update, and deactivate students
- View active students and search students by batch
- Add, view, activate, and deactivate courses
- Enroll students into courses
- View enrollments for a student
- View enrollments for a course
- Update enrollment status
- Handle invalid input and missing IDs with clean messages using custom exceptions
- Use centralized validation and enrollment relationship checks

## Project Structure
- `entity`: `Person`, `Student`, `Course`, `Enrollment`
- `enums`: `EnrollmentStatus`
- `service`: `StudentService`, `CourseService`, `EnrollmentService`
- `util`: `IdGenerator`, `ValidationUtil`
- `exception`: `EntityNotFoundException`, `InvalidInputException`
- `ui`: `Main`

## Class Diagram
```text
Person
|-- id : int
|-- firstName : String
|-- lastName : String
|-- email : String
`-- getDisplayName() : String
        ^
        | extends
        |
Student
|-- batch : String
`-- active : boolean

Course
|-- id : int
|-- courseName : String
|-- description : String
|-- durationInWeeks : int
`-- active : boolean

Enrollment
|-- id : int
|-- studentId : int
|-- courseId : int
|-- enrollmentDate : String
`-- status : EnrollmentStatus

EnrollmentStatus
|-- ACTIVE
|-- COMPLETED
`-- CANCELLED

StudentService ------ manages ------> Student
CourseService ------- manages ------> Course
EnrollmentService --- manages ------> Enrollment

Enrollment -------- references -------> Student
Enrollment -------- references -------> Course
Enrollment -------- uses -------------> EnrollmentStatus

StudentService ------ uses -----------> IdGenerator
CourseService ------- uses -----------> IdGenerator
EnrollmentService --- uses -----------> IdGenerator
StudentService ------ uses -----------> ValidationUtil
CourseService ------- uses -----------> ValidationUtil
Main --------------- uses -----------> ValidationUtil

Main --------------- uses -----------> StudentService
Main --------------- uses -----------> CourseService
Main --------------- uses -----------> EnrollmentService
```

## How to Compile
Open a terminal in `learntrack-java-system` and run:

```powershell
javac -d out src\com\airtribe\learntrack\entity\Person.java src\com\airtribe\learntrack\entity\Student.java src\com\airtribe\learntrack\entity\Course.java src\com\airtribe\learntrack\entity\Enrollment.java src\com\airtribe\learntrack\enums\EnrollmentStatus.java src\com\airtribe\learntrack\exception\EntityNotFoundException.java src\com\airtribe\learntrack\exception\InvalidInputException.java src\com\airtribe\learntrack\util\IdGenerator.java src\com\airtribe\learntrack\util\ValidationUtil.java src\com\airtribe\learntrack\service\StudentService.java src\com\airtribe\learntrack\service\CourseService.java src\com\airtribe\learntrack\service\EnrollmentService.java src\com\airtribe\learntrack\ui\Main.java
```

## How to Run
After compilation, run:

```powershell
java -cp out com.airtribe.learntrack.ui.Main
```

## Notes
- Data is stored in memory using `ArrayList`
- IDs are generated using static counters in `IdGenerator`
- Input and field validation is centralized in `ValidationUtil`
- Enrollment status is controlled using the `EnrollmentStatus` enum
- `EntityNotFoundException` is used for missing records
- `InvalidInputException` is used for invalid numeric, boolean, or status input
- Enrollment rules prevent inactive students, inactive courses, and duplicate active enrollments
- The app is console-based and does not use any database or file storage
