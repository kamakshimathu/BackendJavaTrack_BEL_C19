package com.library.management.model;

/*
 * Reservation.java
 * Purpose: Represents a reservation request for a borrowed book.
 * What this file contains:
 * - the patron, book, branch, reservation date, and reservation status
 * Why it exists:
 * - supports the reservation queue feature in a clear domain model
 */

import java.time.LocalDate;

public class Reservation {
    private final String patronId;
    private final String isbn;
    private final String branchId;
    private final LocalDate reservedOn;
    private ReservationStatus status;

    public Reservation(String patronId, String isbn, String branchId, LocalDate reservedOn) {
        this.patronId = patronId;
        this.isbn = isbn;
        this.branchId = branchId;
        this.reservedOn = reservedOn;
        this.status = ReservationStatus.PENDING;
    }

    public String getPatronId() {
        return patronId;
    }

    public String getIsbn() {
        return isbn;
    }

    public String getBranchId() {
        return branchId;
    }

    public LocalDate getReservedOn() {
        return reservedOn;
    }

    public ReservationStatus getStatus() {
        return status;
    }

    public boolean isActive() {
        return status == ReservationStatus.PENDING || status == ReservationStatus.NOTIFIED;
    }

    public void markNotified() {
        this.status = ReservationStatus.NOTIFIED;
    }

    public void markCompleted() {
        this.status = ReservationStatus.COMPLETED;
    }

    @Override
    public String toString() {
        return "Reservation{" +
                "patronId='" + patronId + '\'' +
                ", isbn='" + isbn + '\'' +
                ", branchId='" + branchId + '\'' +
                ", reservedOn=" + reservedOn +
                ", status=" + status +
                '}';
    }
}
