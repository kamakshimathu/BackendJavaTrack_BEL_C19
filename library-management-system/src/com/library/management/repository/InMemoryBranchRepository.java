package com.library.management.repository;

/*
 * InMemoryBranchRepository.java
 * Purpose: In-memory implementation of the BranchRepository interface.
 */

import com.library.management.model.LibraryBranch;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public class InMemoryBranchRepository implements BranchRepository {
    private final Map<String, LibraryBranch> branchesById = new HashMap<>();

    @Override
    public void save(LibraryBranch branch) {
        branchesById.put(branch.getBranchId(), branch);
    }

    @Override
    public Optional<LibraryBranch> findById(String branchId) {
        return Optional.ofNullable(branchesById.get(branchId));
    }

    @Override
    public boolean existsById(String branchId) {
        return branchesById.containsKey(branchId);
    }

    @Override
    public List<LibraryBranch> findAll() {
        return new ArrayList<>(branchesById.values());
    }
}
