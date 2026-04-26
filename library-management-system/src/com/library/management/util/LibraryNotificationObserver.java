package com.library.management.util;

/*
 * LibraryNotificationObserver.java
 * Purpose: Observer contract for future notification extensions.
 * What this file contains:
 * - A simple callback method for notification events
 * Why it exists:
 * - Serves as a lightweight observer-style extension point for later enhancements
 */

public interface LibraryNotificationObserver {
    void onNotify(String eventType, String message);
}
