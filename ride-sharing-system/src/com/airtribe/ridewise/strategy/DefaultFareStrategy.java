package com.airtribe.ridewise.strategy;

import com.airtribe.ridewise.model.Ride;

public class DefaultFareStrategy implements FareStrategy {
    private static final double BASE_FARE = 40.0;
    private static final double PER_KILOMETER_RATE = 12.0;

    @Override
    public double calculateFare(Ride ride) {
        return BASE_FARE + (ride.getDistance() * PER_KILOMETER_RATE);
    }
}
