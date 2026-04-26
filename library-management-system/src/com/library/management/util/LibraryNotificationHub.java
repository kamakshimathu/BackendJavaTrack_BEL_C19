package com.library.management.util;

/*
 * LibraryNotificationHub.java
 * Purpose: Minimal observer-style notification hub for future extensions.
 * What this file contains:
 * - Registration, removal, and notification of observers
 * Why it exists:
 * - Shows how notifications can be extended later without changing the core flow now
 */

import java.util.ArrayList;
import java.util.List;

// Observer-style extension point for future notifications without affecting core logic
public class LibraryNotificationHub {
    private final List<LibraryNotificationObserver> observers = new ArrayList<>();

    public void addObserver(LibraryNotificationObserver observer) {
        observers.add(observer);
    }

    public void removeObserver(LibraryNotificationObserver observer) {
        observers.remove(observer);
    }

    public void notifyObservers(String eventType, String message) {
        for (LibraryNotificationObserver observer : observers) {
            observer.onNotify(eventType, message);
        }
    }
}
