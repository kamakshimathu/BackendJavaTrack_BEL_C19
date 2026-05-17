package com.airtribe.ridewise.service;

import com.airtribe.ridewise.exception.NoDriverAvailableException;
import com.airtribe.ridewise.exception.InvalidRideStateException;
import com.airtribe.ridewise.exception.RideNotFoundException;
import com.airtribe.ridewise.model.Driver;
import com.airtribe.ridewise.model.FareReceipt;
import com.airtribe.ridewise.model.Ride;
import com.airtribe.ridewise.model.RideStatus;
import com.airtribe.ridewise.model.Rider;
import com.airtribe.ridewise.strategy.FareStrategy;
import com.airtribe.ridewise.strategy.RideMatchingStrategy;
import com.airtribe.ridewise.util.IdGenerator;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

public class RideService {
    private final List<Ride> rides;
    private final DriverService driverService;
    private final RideMatchingStrategy matchingStrategy;
    private final FareStrategy fareStrategy;
    private final IdGenerator idGenerator;

    public RideService(DriverService driverService,
                       RideMatchingStrategy matchingStrategy,
                       FareStrategy fareStrategy,
                       IdGenerator idGenerator) {
        this.rides = new ArrayList<>();
        this.driverService = driverService;
        this.matchingStrategy = matchingStrategy;
        this.fareStrategy = fareStrategy;
        this.idGenerator = idGenerator;
    }

    public Ride requestRide(Rider rider, double distance) throws NoDriverAvailableException {
        validateRideRequest(rider, distance);

        // Matching and pricing are delegated to strategies to keep this service focused on orchestration.
        Driver driver = matchingStrategy.findDriver(rider, driverService.getAvailableDrivers());
        if (driver == null) {
            throw new NoDriverAvailableException("No drivers are available right now.");
        }

        Ride ride = new Ride(idGenerator.nextId(), rider, distance);
        ride.assignDriver(driver);
        ride.attachFareReceipt(createFareReceipt(ride));
        driverService.markUnavailable(driver);
        rides.add(ride);
        return ride;
    }

    public Ride completeRide(String rideId) throws RideNotFoundException, InvalidRideStateException {
        Ride ride = findRideOrThrow(rideId);
        if (ride.getStatus() != RideStatus.ASSIGNED) {
            throw new InvalidRideStateException("Only assigned rides can be completed.");
        }

        ride.complete();
        Driver driver = ride.getDriver();
        driver.recordCompletedTrip();
        driverService.markAvailable(driver);
        return ride;
    }

    public Ride cancelRide(String rideId) throws RideNotFoundException, InvalidRideStateException {
        Ride ride = findRideOrThrow(rideId);
        if (ride.getStatus() != RideStatus.ASSIGNED && ride.getStatus() != RideStatus.REQUESTED) {
            throw new InvalidRideStateException("Only requested or assigned rides can be cancelled.");
        }

        ride.cancel();
        if (ride.getDriver() != null) {
            driverService.markAvailable(ride.getDriver());
        }
        return ride;
    }

    public Optional<Ride> getRideById(String id) {
        return rides.stream()
                .filter(ride -> ride.getId().equalsIgnoreCase(id))
                .findFirst();
    }

    public List<Ride> getAllRides() {
        return Collections.unmodifiableList(rides);
    }

    private FareReceipt createFareReceipt(Ride ride) {
        double amount = fareStrategy.calculateFare(ride);
        return new FareReceipt(ride.getId(), amount, LocalDateTime.now());
    }

    private Ride findRideOrThrow(String rideId) throws RideNotFoundException {
        return getRideById(rideId)
                .orElseThrow(() -> new RideNotFoundException("Ride not found with id: " + rideId));
    }

    private void validateRideRequest(Rider rider, double distance) {
        if (rider == null) {
            throw new IllegalArgumentException("Rider is required.");
        }
        if (distance <= 0) {
            throw new IllegalArgumentException("Ride distance must be greater than zero.");
        }
    }
}
