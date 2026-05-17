package com.airtribe.ridewise.model;

public class Driver {
    private final String id;
    private final String name;
    private String currentLocation;
    private boolean available;
    private final VehicleType vehicleType;
    private int completedTrips;

    public Driver(String id, String name, String currentLocation, VehicleType vehicleType) {
        this.id = id;
        this.name = name;
        this.currentLocation = currentLocation;
        this.vehicleType = vehicleType;
        this.available = true;
        this.completedTrips = 0;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getCurrentLocation() {
        return currentLocation;
    }

    public boolean isAvailable() {
        return available;
    }

    public VehicleType getVehicleType() {
        return vehicleType;
    }

    public int getCompletedTrips() {
        return completedTrips;
    }

    public void updateLocation(String currentLocation) {
        this.currentLocation = currentLocation;
    }

    public void markAvailable() {
        this.available = true;
    }

    public void markUnavailable() {
        this.available = false;
    }

    public void recordCompletedTrip() {
        completedTrips++;
    }

    @Override
    public String toString() {
        return "Driver{id='" + id + "', name='" + name + "', location='" + currentLocation
                + "', available=" + available + ", vehicleType=" + vehicleType
                + ", completedTrips=" + completedTrips + "}";
    }
}
