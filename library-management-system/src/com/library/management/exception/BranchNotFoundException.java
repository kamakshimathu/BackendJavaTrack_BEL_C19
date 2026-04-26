package com.library.management.exception;

/*
 * BranchNotFoundException.java
 * Purpose: Signals that a requested branch does not exist.
 */

public class BranchNotFoundException extends LibraryException {
    public BranchNotFoundException(String branchId) {
        super("Branch not found for ID: " + branchId);
    }
}
