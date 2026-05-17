package com.airtribe.ridewise.model;

public class Ride {
    private final String id;
    private final Rider rider;
    private Driver driver;
    private final double distance;
    private RideStatus status;
    private FareReceipt fareReceipt;

    public Ride(String id, Rider rider, double distance) {
        this.id = id;
        this.rider = rider;
        this.distance = distance;
        this.status = RideStatus.REQUESTED;
    }

    public String getId() {
        return id;
    }

    public Rider getRider() {
        return rider;
    }

    public Driver getDriver() {
        return driver;
    }

    public double getDistance() {
        return distance;
    }

    public RideStatus getStatus() {
        return status;
    }

    public FareReceipt getFareReceipt() {
        return fareReceipt;
    }

    public void assignDriver(Driver driver) {
        this.driver = driver;
        this.status = RideStatus.ASSIGNED;
    }

    public void attachFareReceipt(FareReceipt fareReceipt) {
        this.fareReceipt = fareReceipt;
    }

    public void complete() {
        this.status = RideStatus.COMPLETED;
    }

    public void cancel() {
        this.status = RideStatus.CANCELLED;
    }

    public String getRiderName() {
        return rider.getName();
    }

    public String getDriverName() {
        return driver == null ? "Unassigned" : driver.getName();
    }

    @Override
    public String toString() {
        return "Ride{id='" + id + "', rider='" + getRiderName() + "', driver='" + getDriverName()
                + "', distance=" + distance + ", status=" + status + ", fareReceipt="
                + fareReceipt + "}";
    }
}
