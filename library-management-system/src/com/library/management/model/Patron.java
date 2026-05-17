package com.library.management.model;

/*
 * Patron.java
 * Purpose: Represents a library member.
 * What this file contains:
 * - Patron identity and contact details inherited from Person
 * - Borrowing history and patron-specific behavior
 * Why it exists:
 * - Demonstrates inheritance while keeping patron responsibilities focused
 */

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Patron extends Person {
    private final List<BorrowRecord> borrowingHistory = new ArrayList<>();

    public Patron(String id, String name, String email) {
        super(id, name, email);
    }

    @Override
    public void updateProfile(String name, String email) {
        setName(name);
        setEmail(email);
    }

    public void addBorrowRecord(BorrowRecord record) {
        borrowingHistory.add(record);
    }

    public List<BorrowRecord> getBorrowingHistory() {
        return Collections.unmodifiableList(borrowingHistory);
    }

    public BorrowRecord findActiveBorrowRecord(String isbn) {
        for (int index = borrowingHistory.size() - 1; index >= 0; index--) {
            BorrowRecord record = borrowingHistory.get(index);
            if (record.getIsbn().equals(isbn) && record.isActive()) {
                return record;
            }
        }
        return null;
    }

    @Override
    public String toString() {
        return "Patron{" +
                "id='" + getId() + '\'' +
                ", name='" + getName() + '\'' +
                ", email='" + getEmail() + '\'' +
                ", borrowingHistorySize=" + borrowingHistory.size() +
                '}';
    }
}
