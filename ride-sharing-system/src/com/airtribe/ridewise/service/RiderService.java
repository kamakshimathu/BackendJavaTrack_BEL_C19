package com.airtribe.ridewise.service;

import com.airtribe.ridewise.model.Rider;
import com.airtribe.ridewise.util.IdGenerator;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

public class RiderService {
    private final List<Rider> riders;
    private final IdGenerator idGenerator;

    public RiderService(IdGenerator idGenerator) {
        this.riders = new ArrayList<>();
        this.idGenerator = idGenerator;
    }

    public Rider registerRider(String name, String location) {
        Rider rider = new Rider(idGenerator.nextId(), requireText(name, "Rider name"),
                requireText(location, "Rider location"));
        riders.add(rider);
        return rider;
    }

    public Optional<Rider> getRiderById(String id) {
        return riders.stream()
                .filter(rider -> rider.getId().equalsIgnoreCase(id))
                .findFirst();
    }

    public List<Rider> getAllRiders() {
        return Collections.unmodifiableList(riders);
    }

    private String requireText(String value, String fieldName) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(fieldName + " cannot be empty.");
        }
        return value.trim();
    }
}
