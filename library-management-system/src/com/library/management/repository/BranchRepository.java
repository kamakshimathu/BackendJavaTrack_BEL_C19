package com.library.management.repository;

/*
 * BranchRepository.java
 * Purpose: Abstraction for storing and retrieving library branches.
 */

import com.library.management.model.LibraryBranch;

import java.util.List;
import java.util.Optional;

public interface BranchRepository {
    void save(LibraryBranch branch);

    Optional<LibraryBranch> findById(String branchId);

    boolean existsById(String branchId);

    List<LibraryBranch> findAll();
}
