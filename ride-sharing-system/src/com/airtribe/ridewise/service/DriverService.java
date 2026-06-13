package com.airtribe.ridewise.service;

import com.airtribe.ridewise.model.Driver;
import com.airtribe.ridewise.model.VehicleType;
import com.airtribe.ridewise.util.IdGenerator;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

public class DriverService {
    private final List<Driver> drivers;
    private final IdGenerator idGenerator;

    public DriverService(IdGenerator idGenerator) {
        this.drivers = new ArrayList<>();
        this.idGenerator = idGenerator;
    }

    public Driver registerDriver(String name, String currentLocation, VehicleType vehicleType) {
        if (vehicleType == null) {
            throw new IllegalArgumentException("Vehicle type is required.");
        }

        Driver driver = new Driver(idGenerator.nextId(), requireText(name, "Driver name"),
                requireText(currentLocation, "Driver location"), vehicleType);
        drivers.add(driver);
        return driver;
    }

    public Optional<Driver> getDriverById(String id) {
        return drivers.stream()
                .filter(driver -> driver.getId().equalsIgnoreCase(id))
                .findFirst();
    }

    public List<Driver> getAvailableDrivers() {
        return drivers.stream()
                .filter(Driver::isAvailable)
                .collect(Collectors.toList());
    }

    public List<Driver> getAllDrivers() {
        return Collections.unmodifiableList(drivers);
    }

    public void markUnavailable(Driver driver) {
        driver.markUnavailable();
    }

    public void markAvailable(Driver driver) {
        driver.markAvailable();
    }

    private String requireText(String value, String fieldName) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(fieldName + " cannot be empty.");
        }
        return value.trim();
    }
}
