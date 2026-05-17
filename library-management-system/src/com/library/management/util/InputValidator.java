package com.library.management.util;

/*
 * InputValidator.java
 * Purpose: Central utility for validating and normalizing input data.
 * What this file contains:
 * - Reusable checks for blank values, ISBNs, emails, and publication years
 * Why it exists:
 * - Keeps validation consistent across the whole project
 */

import com.library.management.exception.ValidationException;

import java.time.Year;

public final class InputValidator {
    private InputValidator() {
    }

    public static String requireNonBlank(String value, String fieldName) {
        if (value == null || value.trim().isEmpty()) {
            throw new ValidationException(fieldName + " cannot be blank.");
        }
        return value.trim();
    }

    public static int validatePublicationYear(int publicationYear) {
        int currentYear = Year.now().getValue();
        if (publicationYear < 0 || publicationYear > currentYear) {
            throw new ValidationException("Publication year must be between 0 and " + currentYear + ".");
        }
        return publicationYear;
    }

    public static String normalizeIsbn(String isbn) {
        return requireNonBlank(isbn, "ISBN").toUpperCase();
    }

    public static String normalizeEmail(String email) {
        String normalizedEmail = requireNonBlank(email, "Email");
        if (!normalizedEmail.contains("@") || normalizedEmail.startsWith("@") || normalizedEmail.endsWith("@")) {
            throw new ValidationException("Email must be a valid address.");
        }
        return normalizedEmail.toLowerCase();
    }
}
