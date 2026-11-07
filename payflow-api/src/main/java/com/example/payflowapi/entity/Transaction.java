package com.example.payflowapi.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "transactions")
public class Transaction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long transactionId;

    private String senderUpiId;
    private String receiverUpiId;
    private Double amount;
    private String note;

    public Transaction() {
    }

    public Transaction(Long transactionId, String senderUpiId, String receiverUpiId, Double amount, String note) {
        this.transactionId = transactionId;
        this.senderUpiId = senderUpiId;
        this.receiverUpiId = receiverUpiId;
        this.amount = amount;
        this.note = note;
    }

    public Long getTransactionId() {
        return transactionId;
    }

    public void setTransactionId(Long transactionId) {
        this.transactionId = transactionId;
    }

    public String getSenderUpiId() {
        return senderUpiId;
    }

    public void setSenderUpiId(String senderUpiId) {
        this.senderUpiId = senderUpiId;
    }

    public String getReceiverUpiId() {
        return receiverUpiId;
    }

    public void setReceiverUpiId(String receiverUpiId) {
        this.receiverUpiId = receiverUpiId;
    }

    public Double getAmount() {
        return amount;
    }

    public void setAmount(Double amount) {
        this.amount = amount;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    @Override
    public String toString() {
        return "Transaction{" +
                "transactionId=" + transactionId +
                ", senderUpiId='" + senderUpiId + '\'' +
                ", receiverUpiId='" + receiverUpiId + '\'' +
                ", amount=" + amount +
                ", note='" + note + '\'' +
                '}';
    }
}
