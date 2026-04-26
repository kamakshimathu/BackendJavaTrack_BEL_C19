package com.library.management.exception;

/*
 * DuplicateBranchException.java
 * Purpose: Signals that a branch with the same ID already exists.
 */

public class DuplicateBranchException extends LibraryException {
    public DuplicateBranchException(String branchId) {
        super("A branch with ID already exists: " + branchId);
    }
}
