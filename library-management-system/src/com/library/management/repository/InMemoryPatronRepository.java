package com.library.management.repository;

/*
 * InMemoryPatronRepository.java
 * Purpose: In-memory implementation of the PatronRepository interface.
 * What this file contains:
 * - Map-based storage for patrons by ID
 * Why it exists:
 * - Keeps patron storage concerns isolated from the service layer
 */

import com.library.management.model.Patron;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

// SRP: this class only handles in-memory patron storage
public class InMemoryPatronRepository implements PatronRepository {
    private final Map<String, Patron> patronsById = new HashMap<>();

    @Override
    public void save(Patron patron) {
        patronsById.put(patron.getId(), patron);
    }

    @Override
    public Optional<Patron> findById(String patronId) {
        return Optional.ofNullable(patronsById.get(patronId));
    }

    @Override
    public boolean existsById(String patronId) {
        return patronsById.containsKey(patronId);
    }

    @Override
    public List<Patron> findAll() {
        return new ArrayList<>(patronsById.values());
    }
}
