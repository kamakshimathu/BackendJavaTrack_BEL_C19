package com.airtribe.learntrack.exception;

// Custom exception thrown when an entity is not found in the system.
public class EntityNotFoundException extends RuntimeException {
    public EntityNotFoundException(String message) {
        super(message);
    }
}
