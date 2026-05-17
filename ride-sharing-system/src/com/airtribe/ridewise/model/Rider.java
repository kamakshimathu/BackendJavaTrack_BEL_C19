package com.airtribe.ridewise.model;

public class Rider {
    private final String id;
    private final String name;
    private String location;

    public Rider(String id, String name, String location) {
        this.id = id;
        this.name = name;
        this.location = location;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getLocation() {
        return location;
    }

    public void updateLocation(String location) {
        this.location = location;
    }

    @Override
    public String toString() {
        return "Rider{id='" + id + "', name='" + name + "', location='" + location + "'}";
    }
}
