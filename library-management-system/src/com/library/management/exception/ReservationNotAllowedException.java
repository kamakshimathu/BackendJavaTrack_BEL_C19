package com.library.management.exception;

/*
 * ReservationNotAllowedException.java
 * Purpose: Signals that a reservation request cannot be accepted.
 */

public class ReservationNotAllowedException extends LibraryException {
    public ReservationNotAllowedException(String message) {
        super(message);
    }
}
