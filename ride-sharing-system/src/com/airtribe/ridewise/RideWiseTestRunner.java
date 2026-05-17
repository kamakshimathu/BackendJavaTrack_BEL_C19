package com.airtribe.ridewise;

import com.airtribe.ridewise.exception.InvalidRideStateException;
import com.airtribe.ridewise.exception.NoDriverAvailableException;
import com.airtribe.ridewise.exception.RideNotFoundException;
import com.airtribe.ridewise.model.Driver;
import com.airtribe.ridewise.model.Ride;
import com.airtribe.ridewise.model.RideStatus;
import com.airtribe.ridewise.model.Rider;
import com.airtribe.ridewise.model.VehicleType;
import com.airtribe.ridewise.service.DriverService;
import com.airtribe.ridewise.service.RideService;
import com.airtribe.ridewise.service.RiderService;
import com.airtribe.ridewise.strategy.DefaultFareStrategy;
import com.airtribe.ridewise.strategy.LeastActiveDriverStrategy;
import com.airtribe.ridewise.strategy.NearestDriverStrategy;
import com.airtribe.ridewise.util.IdGenerator;

public class RideWiseTestRunner {
    private int passedTests;
    private int failedTests;

    public static void main(String[] args) {
        RideWiseTestRunner runner = new RideWiseTestRunner();
        runner.runAll();
    }

    private void runAll() {
        // Lightweight tests avoid external dependencies while still documenting important edge cases.
        run("request ride assigns driver and fare receipt", this::requestRideAssignsDriverAndFareReceipt);
        run("complete ride releases driver and counts trip", this::completeRideReleasesDriver);
        run("no driver available throws clear exception", this::noDriverAvailableThrowsException);
        run("invalid ride distance is rejected by service", this::invalidRideDistanceIsRejected);
        run("completed ride cannot be completed again", this::completedRideCannotBeCompletedAgain);
        run("least active strategy selects driver with fewer trips", this::leastActiveStrategySelectsFewerTrips);

        System.out.println();
        System.out.println("Tests passed: " + passedTests);
        System.out.println("Tests failed: " + failedTests);

        if (failedTests > 0) {
            throw new AssertionError("Some RideWise tests failed.");
        }
    }

    private void requestRideAssignsDriverAndFareReceipt() throws Exception {
        TestContext context = createContextWithNearestStrategy();
        Rider rider = context.riderService.registerRider("Asha", "Indiranagar");
        context.driverService.registerDriver("Ravi", "Domlur", VehicleType.CAR);

        Ride ride = context.rideService.requestRide(rider, 5.0);

        assertEquals(RideStatus.ASSIGNED, ride.getStatus(), "ride status");
        assertNotNull(ride.getDriver(), "driver should be assigned");
        assertNotNull(ride.getFareReceipt(), "fare receipt should be attached");
        assertEquals(100.0, ride.getFareReceipt().getAmount(), "fare amount");
        assertEquals(0, context.driverService.getAvailableDrivers().size(), "available driver count");
    }

    private void completeRideReleasesDriver() throws Exception {
        TestContext context = createContextWithNearestStrategy();
        Rider rider = context.riderService.registerRider("Asha", "Indiranagar");
        Driver driver = context.driverService.registerDriver("Ravi", "Domlur", VehicleType.CAR);
        Ride ride = context.rideService.requestRide(rider, 5.0);

        Ride completedRide = context.rideService.completeRide(ride.getId());

        assertEquals(RideStatus.COMPLETED, completedRide.getStatus(), "ride status");
        assertTrue(driver.isAvailable(), "driver should be available");
        assertEquals(1, driver.getCompletedTrips(), "completed trips");
    }

    private void noDriverAvailableThrowsException() throws Exception {
        TestContext context = createContextWithNearestStrategy();
        Rider rider = context.riderService.registerRider("Asha", "Indiranagar");

        expectException(NoDriverAvailableException.class, () -> context.rideService.requestRide(rider, 5.0));
    }

    private void invalidRideDistanceIsRejected() throws Exception {
        TestContext context = createContextWithNearestStrategy();
        Rider rider = context.riderService.registerRider("Asha", "Indiranagar");
        context.driverService.registerDriver("Ravi", "Domlur", VehicleType.CAR);

        expectException(IllegalArgumentException.class, () -> context.rideService.requestRide(rider, 0.0));
    }

    private void completedRideCannotBeCompletedAgain() throws Exception {
        TestContext context = createContextWithNearestStrategy();
        Rider rider = context.riderService.registerRider("Asha", "Indiranagar");
        context.driverService.registerDriver("Ravi", "Domlur", VehicleType.CAR);
        Ride ride = context.rideService.requestRide(rider, 5.0);
        context.rideService.completeRide(ride.getId());

        expectException(InvalidRideStateException.class, () -> context.rideService.completeRide(ride.getId()));
        expectException(RideNotFoundException.class, () -> context.rideService.completeRide("RID999"));
    }

    private void leastActiveStrategySelectsFewerTrips() throws Exception {
        TestContext context = createContextWithLeastActiveStrategy();
        Rider firstRider = context.riderService.registerRider("Asha", "Indiranagar");
        Rider secondRider = context.riderService.registerRider("Meera", "Koramangala");
        Driver busierDriver = context.driverService.registerDriver("Ravi", "Domlur", VehicleType.CAR);
        Driver lessActiveDriver = context.driverService.registerDriver("Iqbal", "Hebbal", VehicleType.AUTO);

        Ride firstRide = context.rideService.requestRide(firstRider, 4.0);
        context.rideService.completeRide(firstRide.getId());

        Ride secondRide = context.rideService.requestRide(secondRider, 4.0);

        assertEquals(busierDriver.getId(), firstRide.getDriver().getId(), "first assigned driver");
        assertEquals(lessActiveDriver.getId(), secondRide.getDriver().getId(), "least active assigned driver");
    }

    private TestContext createContextWithNearestStrategy() {
        DriverService driverService = new DriverService(new IdGenerator("D"));
        RiderService riderService = new RiderService(new IdGenerator("R"));
        RideService rideService = new RideService(driverService, new NearestDriverStrategy(),
                new DefaultFareStrategy(), new IdGenerator("RID"));
        return new TestContext(riderService, driverService, rideService);
    }

    private TestContext createContextWithLeastActiveStrategy() {
        DriverService driverService = new DriverService(new IdGenerator("D"));
        RiderService riderService = new RiderService(new IdGenerator("R"));
        RideService rideService = new RideService(driverService, new LeastActiveDriverStrategy(),
                new DefaultFareStrategy(), new IdGenerator("RID"));
        return new TestContext(riderService, driverService, rideService);
    }

    private void run(String testName, TestCase testCase) {
        try {
            testCase.execute();
            passedTests++;
            System.out.println("[PASS] " + testName);
        } catch (Exception | AssertionError error) {
            failedTests++;
            System.out.println("[FAIL] " + testName + " -> " + error.getMessage());
        }
    }

    private void expectException(Class<? extends Exception> expectedType, TestCase testCase) throws Exception {
        try {
            testCase.execute();
        } catch (Exception exception) {
            if (expectedType.isInstance(exception)) {
                return;
            }
            throw new AssertionError("Expected " + expectedType.getSimpleName()
                    + " but got " + exception.getClass().getSimpleName());
        }
        throw new AssertionError("Expected " + expectedType.getSimpleName() + " but no exception was thrown.");
    }

    private void assertEquals(Object expected, Object actual, String message) {
        if (!expected.equals(actual)) {
            throw new AssertionError(message + " expected " + expected + " but got " + actual);
        }
    }

    private void assertNotNull(Object value, String message) {
        if (value == null) {
            throw new AssertionError(message);
        }
    }

    private void assertTrue(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private interface TestCase {
        void execute() throws Exception;
    }

    private static class TestContext {
        private final RiderService riderService;
        private final DriverService driverService;
        private final RideService rideService;

        private TestContext(RiderService riderService, DriverService driverService, RideService rideService) {
            this.riderService = riderService;
            this.driverService = driverService;
            this.rideService = rideService;
        }
    }
}
