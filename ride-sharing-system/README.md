# RideWise

RideWise is a console-based ride-sharing system inspired by Uber/Ola.
The project focuses on low-level design, clean object-oriented modeling, SOLID principles, and strategy-based extensibility.

## Features

- Register riders.
- Register drivers.
- View available drivers.
- Request a ride.
- Match a driver using a ride matching strategy.
- Calculate fare using a fare strategy.
- Complete rides.
- View all rides.
- Track ride states: `REQUESTED`, `ASSIGNED`, `COMPLETED`, `CANCELLED`.

## Project Structure

```text
src/com/airtribe/ridewise/
|-- Main.java
|-- RideWiseTestRunner.java
|-- model/
|-- service/
|-- strategy/
|-- exception/
`-- util/

docs/
|-- Class_Diagram.md
|-- SOLID_Reflection.md
`-- Testing_Notes.md
```

## Design Highlights

- `RideService` orchestrates ride booking and lifecycle operations.
- `RiderService` manages riders.
- `DriverService` manages drivers and availability.
- `RideMatchingStrategy` supports interchangeable driver allocation algorithms.
- `FareStrategy` supports interchangeable pricing algorithms.
- `Ride` owns its `FareReceipt`, demonstrating composition.
- Services validate important inputs so rules are not limited to the console layer.

## Run the Console App

From `ride-sharing-system`:

```powershell
javac -d out (Get-ChildItem -Recurse -Path src -Filter *.java).FullName
java -cp out com.airtribe.ridewise.Main
```

## Run Tests

RideWise includes a lightweight test runner without external dependencies.

From `ride-sharing-system`:

```powershell
javac -d out (Get-ChildItem -Recurse -Path src -Filter *.java).FullName
java -cp out com.airtribe.ridewise.RideWiseTestRunner
```

Expected result:

```text
Tests passed: 6
Tests failed: 0
```

## Notes

- `out/` is generated only when compiling locally and is ignored by Git.
- No frameworks, databases, Lombok, or Spring are used.
- See `docs/SOLID_Reflection.md` for design reasoning.
- See `docs/Class_Diagram.md` for the Mermaid class diagram.
- See `docs/Testing_Notes.md` for covered test scenarios.
