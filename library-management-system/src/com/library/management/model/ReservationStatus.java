package com.library.management.model;

/*
 * ReservationStatus.java
 * Purpose: Represents the lifecycle of a reservation.
 * What this file contains:
 * - pending, notified, and completed states
 * Why it exists:
 * - Makes reservation flow explicit and easier to reason about
 */

public enum ReservationStatus {
    PENDING,
    NOTIFIED,
    COMPLETED
}
