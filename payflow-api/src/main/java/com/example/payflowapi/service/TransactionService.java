package com.example.payflowapi.service;

import com.example.payflowapi.entity.Transaction;
import com.example.payflowapi.repository.TransactionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class TransactionService {

    // Spring injects the repository bean automatically here.
    @Autowired
    private TransactionRepository transactionRepository;

    public Transaction sendMoney(Transaction transaction) {
        return transactionRepository.save(transaction);
    }
}
