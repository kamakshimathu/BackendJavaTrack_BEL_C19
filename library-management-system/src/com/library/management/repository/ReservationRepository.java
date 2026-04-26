package com.library.management.repository;

/*
 * ReservationRepository.java
 * Purpose: Abstraction for storing and retrieving reservations.
 */

import com.library.management.model.Reservation;

import java.util.List;
import java.util.Optional;

public interface ReservationRepository {
    void save(Reservation reservation);

    List<Reservation> findByIsbn(String isbn);

    Optional<Reservation> findFirstActiveByIsbn(String isbn);

    Optional<Reservation> findActiveByIsbnAndPatronId(String isbn, String patronId);

    List<Reservation> findByPatronId(String patronId);
}
