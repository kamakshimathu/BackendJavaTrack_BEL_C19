package com.airtribe.ridewise.strategy;

import com.airtribe.ridewise.model.Ride;

public interface FareStrategy {
    double calculateFare(Ride ride);
}
