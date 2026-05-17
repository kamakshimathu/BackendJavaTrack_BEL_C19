package com.library.management.model;

/*
 * SearchType.java
 * Purpose: Represents the supported search modes.
 * What this file contains:
 * - Title, author, and ISBN search type values
 * Why it exists:
 * - Allows search behavior to be selected cleanly without exposing concrete strategy classes in Main
 */

public enum SearchType {
    TITLE,
    AUTHOR,
    ISBN
}
