package com.airtribe.ridewise.util;

import java.util.concurrent.atomic.AtomicInteger;

public class IdGenerator {
    private final String prefix;
    private final AtomicInteger sequence;

    public IdGenerator(String prefix) {
        this.prefix = prefix;
        this.sequence = new AtomicInteger(1);
    }

    public String nextId() {
        return prefix + sequence.getAndIncrement();
    }
}
