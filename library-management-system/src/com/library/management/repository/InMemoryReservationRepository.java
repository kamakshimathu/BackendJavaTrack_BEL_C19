package com.library.management.repository;

/*
 * InMemoryReservationRepository.java
 * Purpose: In-memory implementation of the ReservationRepository interface.
 */

import com.library.management.model.Reservation;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

public class InMemoryReservationRepository implements ReservationRepository {
    private final List<Reservation> reservations = new ArrayList<>();

    @Override
    public void save(Reservation reservation) {
        if (!reservations.contains(reservation)) {
            reservations.add(reservation);
        }
    }

    @Override
    public List<Reservation> findByIsbn(String isbn) {
        List<Reservation> matchingReservations = new ArrayList<>();
        for (Reservation reservation : reservations) {
            if (reservation.getIsbn().equals(isbn)) {
                matchingReservations.add(reservation);
            }
        }
        return matchingReservations;
    }

    @Override
    public Optional<Reservation> findFirstActiveByIsbn(String isbn) {
        for (Reservation reservation : reservations) {
            if (reservation.getIsbn().equals(isbn) && reservation.isActive()) {
                return Optional.of(reservation);
            }
        }
        return Optional.empty();
    }

    @Override
    public Optional<Reservation> findActiveByIsbnAndPatronId(String isbn, String patronId) {
        for (Reservation reservation : reservations) {
            if (reservation.getIsbn().equals(isbn)
                    && reservation.getPatronId().equals(patronId)
                    && reservation.isActive()) {
                return Optional.of(reservation);
            }
        }
        return Optional.empty();
    }

    @Override
    public List<Reservation> findByPatronId(String patronId) {
        List<Reservation> matchingReservations = new ArrayList<>();
        for (Reservation reservation : reservations) {
            if (reservation.getPatronId().equals(patronId)) {
                matchingReservations.add(reservation);
            }
        }
        return matchingReservations;
    }
}
