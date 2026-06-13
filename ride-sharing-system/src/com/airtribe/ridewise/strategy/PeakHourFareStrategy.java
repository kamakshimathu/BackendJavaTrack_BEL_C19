package com.airtribe.ridewise.strategy;

import com.airtribe.ridewise.model.Ride;

public class PeakHourFareStrategy implements FareStrategy {
    private static final double PEAK_MULTIPLIER = 1.5;
    private final FareStrategy baseFareStrategy;

    public PeakHourFareStrategy(FareStrategy baseFareStrategy) {
        this.baseFareStrategy = baseFareStrategy;
    }

    @Override
    public double calculateFare(Ride ride) {
        return baseFareStrategy.calculateFare(ride) * PEAK_MULTIPLIER;
    }
}
