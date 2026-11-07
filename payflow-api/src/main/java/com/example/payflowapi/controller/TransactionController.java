package com.example.payflowapi.controller;

import com.example.payflowapi.entity.Transaction;
import com.example.payflowapi.service.TransactionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/transactions")
public class TransactionController {

    @Autowired
    private TransactionService transactionService;

    @PostMapping
    public Transaction sendMoney(@RequestBody Transaction transaction) {
        return transactionService.sendMoney(transaction);
    }
}
