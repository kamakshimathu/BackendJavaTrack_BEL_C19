package com.library.management.repository;

/*
 * PatronRepository.java
 * Purpose: Abstraction for storing and retrieving patrons.
 * What this file contains:
 * - The contract for patron persistence operations in memory
 * Why it exists:
 * - Supports DIP and keeps storage concerns separate from business logic
 */

import com.library.management.model.Patron;

import java.util.List;
import java.util.Optional;

public interface PatronRepository {
    void save(Patron patron);

    Optional<Patron> findById(String patronId);

    boolean existsById(String patronId);

    List<Patron> findAll();
}
