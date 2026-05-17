package com.airtribe.ridewise.strategy;

import com.airtribe.ridewise.model.Driver;
import com.airtribe.ridewise.model.Rider;

import java.util.Comparator;
import java.util.List;

public class NearestDriverStrategy implements RideMatchingStrategy {
    @Override
    public Driver findDriver(Rider rider, List<Driver> drivers) {
        return drivers.stream()
                .filter(Driver::isAvailable)
                .min(Comparator.comparingInt(driver -> locationGap(rider.getLocation(), driver.getCurrentLocation())))
                .orElse(null);
    }

    private int locationGap(String riderLocation, String driverLocation) {
        return Math.abs(locationScore(riderLocation) - locationScore(driverLocation));
    }

    private int locationScore(String location) {
        // Console MVP approximation: converts a location name into a stable comparable score.
        int score = 0;
        for (char character : location.toLowerCase().toCharArray()) {
            score += character;
        }
        return score;
    }
}
