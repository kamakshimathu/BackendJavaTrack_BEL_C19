package com.airtribe.ridewise;

import com.airtribe.ridewise.exception.InvalidRideStateException;
import com.airtribe.ridewise.exception.NoDriverAvailableException;
import com.airtribe.ridewise.exception.RideNotFoundException;
import com.airtribe.ridewise.model.Driver;
import com.airtribe.ridewise.model.Ride;
import com.airtribe.ridewise.model.Rider;
import com.airtribe.ridewise.model.VehicleType;
import com.airtribe.ridewise.service.DriverService;
import com.airtribe.ridewise.service.RideService;
import com.airtribe.ridewise.service.RiderService;
import com.airtribe.ridewise.strategy.DefaultFareStrategy;
import com.airtribe.ridewise.strategy.FareStrategy;
import com.airtribe.ridewise.strategy.NearestDriverStrategy;
import com.airtribe.ridewise.strategy.PeakHourFareStrategy;
import com.airtribe.ridewise.strategy.RideMatchingStrategy;
import com.airtribe.ridewise.util.IdGenerator;

import java.util.List;
import java.util.Optional;
import java.util.Scanner;

public class Main {
    private final Scanner scanner;
    private final RiderService riderService;
    private final DriverService driverService;
    private final RideService rideService;

    public Main() {
        scanner = new Scanner(System.in);
        riderService = new RiderService(new IdGenerator("R"));
        driverService = new DriverService(new IdGenerator("D"));

        // Strategies are wired once and injected, keeping RideService open for extension.
        RideMatchingStrategy matchingStrategy = new NearestDriverStrategy();
        FareStrategy fareStrategy = new PeakHourFareStrategy(new DefaultFareStrategy());
        rideService = new RideService(driverService, matchingStrategy, fareStrategy, new IdGenerator("RID"));
    }

    public static void main(String[] args) {
        new Main().start();
    }

    private void start() {
        boolean running = true;
        while (running) {
            printMenu();
            int choice = readInt("Choose an option: ");

            switch (choice) {
                case 1:
                    addRider();
                    break;
                case 2:
                    addDriver();
                    break;
                case 3:
                    viewAvailableDrivers();
                    break;
                case 4:
                    requestRide();
                    break;
                case 5:
                    completeRide();
                    break;
                case 6:
                    viewRides();
                    break;
                case 7:
                    running = false;
                    System.out.println("Thank you for using RideWise.");
                    break;
                default:
                    System.out.println("Please choose a valid menu option.");
            }
        }
    }

    private void printMenu() {
        System.out.println();
        System.out.println("===== RideWise =====");
        System.out.println("1. Add Rider");
        System.out.println("2. Add Driver");
        System.out.println("3. View Available Drivers");
        System.out.println("4. Request Ride");
        System.out.println("5. Complete Ride");
        System.out.println("6. View Rides");
        System.out.println("7. Exit");
    }

    private void addRider() {
        String name = readText("Rider name: ");
        String location = readText("Rider location: ");
        Rider rider = riderService.registerRider(name, location);
        System.out.println("Rider registered: " + rider);
    }

    private void addDriver() {
        String name = readText("Driver name: ");
        String location = readText("Driver location: ");
        VehicleType vehicleType = readVehicleType();

        Driver driver = driverService.registerDriver(name, location, vehicleType);
        System.out.println("Driver registered: " + driver);
    }

    private void viewAvailableDrivers() {
        List<Driver> drivers = driverService.getAvailableDrivers();
        if (drivers.isEmpty()) {
            System.out.println("No available drivers.");
            return;
        }

        drivers.forEach(System.out::println);
    }

    private void requestRide() {
        String riderId = readText("Rider id: ");
        Optional<Rider> riderOptional = riderService.getRiderById(riderId);
        if (!riderOptional.isPresent()) {
            System.out.println("Rider not found.");
            return;
        }

        double distance = readDouble("Ride distance in km: ");
        try {
            Ride ride = rideService.requestRide(riderOptional.get(), distance);
            System.out.println("Ride assigned: " + ride);
        } catch (NoDriverAvailableException exception) {
            System.out.println(exception.getMessage());
        }
    }

    private void completeRide() {
        String rideId = readText("Ride id: ");
        try {
            Ride ride = rideService.completeRide(rideId);
            System.out.println("Ride completed: " + ride);
        } catch (RideNotFoundException | InvalidRideStateException exception) {
            System.out.println(exception.getMessage());
        }
    }

    private void viewRides() {
        List<Ride> rides = rideService.getAllRides();
        if (rides.isEmpty()) {
            System.out.println("No rides available.");
            return;
        }

        rides.forEach(System.out::println);
    }

    private VehicleType readVehicleType() {
        while (true) {
            String input = readText("Vehicle type (BIKE/AUTO/CAR): ");
            try {
                return VehicleType.valueOf(input.toUpperCase());
            } catch (IllegalArgumentException exception) {
                System.out.println("Invalid vehicle type.");
            }
        }
    }

    private String readText(String prompt) {
        while (true) {
            System.out.print(prompt);
            String input = scanner.nextLine().trim();
            if (!input.isEmpty()) {
                return input;
            }
            System.out.println("Input cannot be empty.");
        }
    }

    private int readInt(String prompt) {
        while (true) {
            System.out.print(prompt);
            try {
                return Integer.parseInt(scanner.nextLine().trim());
            } catch (NumberFormatException exception) {
                System.out.println("Please enter a valid number.");
            }
        }
    }

    private double readDouble(String prompt) {
        while (true) {
            System.out.print(prompt);
            try {
                double value = Double.parseDouble(scanner.nextLine().trim());
                if (value > 0) {
                    return value;
                }
                System.out.println("Value must be greater than zero.");
            } catch (NumberFormatException exception) {
                System.out.println("Please enter a valid decimal number.");
            }
        }
    }
}
