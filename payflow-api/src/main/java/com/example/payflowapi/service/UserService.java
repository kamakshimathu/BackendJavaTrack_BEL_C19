package com.example.payflowapi.service;

import com.example.payflowapi.entity.User;
import com.example.payflowapi.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class UserService {

    // Spring creates the repository bean at startup and injects it automatically here.
    @Autowired
    private UserRepository userRepository;

    public User registerUser(User user) {
        return userRepository.save(user);
    }

    public List<User> getAllUsers() {
        return userRepository.findAll();
    }

    public User getUserById(Long id) {
        return userRepository.findById(id).orElse(null);
    }

    public User findByUpiId(String upiId) {
        return userRepository.findByUpiId(upiId).orElse(null);
    }

    public List<User> findUsersWithBalanceGreaterThan(Double amount) {
        return userRepository.findUsersWithBalanceGreaterThan(amount);
    }
}
