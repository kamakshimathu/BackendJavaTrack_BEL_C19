package com.library.management.model;

/*
 * LibraryBranch.java
 * Purpose: Represents one library branch in a multi-branch system.
 * What this file contains:
 * - Branch identity and display name
 * Why it exists:
 * - Supports the optional multi-branch extension without mixing branch data into unrelated classes
 */

public class LibraryBranch {
    private final String branchId;
    private String branchName;

    public LibraryBranch(String branchId, String branchName) {
        this.branchId = branchId;
        this.branchName = branchName;
    }

    public String getBranchId() {
        return branchId;
    }

    public String getBranchName() {
        return branchName;
    }

    public void updateBranchName(String branchName) {
        this.branchName = branchName;
    }

    @Override
    public String toString() {
        return "LibraryBranch{" +
                "branchId='" + branchId + '\'' +
                ", branchName='" + branchName + '\'' +
                '}';
    }
}
