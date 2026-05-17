package com.library.management.model;

/*
 * BookStatus.java
 * Purpose: Represents the lending status of a book.
 * What this file contains:
 * - The available and borrowed states used by the inventory flow
 * Why it exists:
 * - Keeps book status values explicit and type-safe
 */

public enum BookStatus {
    AVAILABLE,
    BORROWED
}
