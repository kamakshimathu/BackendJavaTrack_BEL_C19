# RideWise SOLID Reflection

## Single Responsibility Principle

- `RiderService` manages rider registration and lookup only.
- `DriverService` manages driver registration, lookup, and availability only.
- `RideService` orchestrates ride request, cancellation, completion, and fare receipt creation.
- `FareStrategy` implementations calculate fare only.
- `RideMatchingStrategy` implementations select drivers only.
- `IdGenerator` generates identifiers only.

## Open Closed Principle

RideWise can support new matching and fare rules by adding new strategy implementations.
`RideService` depends on `RideMatchingStrategy` and `FareStrategy`, so its core ride flow does not need to change when a new strategy is introduced.

## Liskov Substitution Principle

`NearestDriverStrategy` and `LeastActiveDriverStrategy` both satisfy the same `RideMatchingStrategy` contract.
They are interchangeable because both return an available `Driver` or `null` when no match exists, and neither implementation changes driver state.

## Interface Segregation Principle

The strategy interfaces are intentionally small:

- `RideMatchingStrategy` only finds a driver.
- `FareStrategy` only calculates fare.

No class is forced to implement methods that do not belong to its responsibility.

## Dependency Inversion Principle

`RideService` receives abstractions through its constructor:

- `RideMatchingStrategy`
- `FareStrategy`

This keeps the service decoupled from concrete algorithms and makes the design easier to test.

## Composition Over Inheritance

- `Ride` has a `FareReceipt`.
- `RideService` uses matching and fare strategies.
- `PeakHourFareStrategy` wraps another `FareStrategy` to reuse the base fare calculation.

The design avoids inheritance hierarchies that are not required for this MVP.

## Robustness Improvements

Mentor feedback from earlier projects called out edge-case handling and service responsibility clarity.
RideWise addresses that by validating service inputs directly and by using specific exceptions for ride not found and invalid ride state cases.
