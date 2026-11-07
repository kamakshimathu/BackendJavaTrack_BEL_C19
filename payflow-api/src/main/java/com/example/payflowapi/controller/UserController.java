package com.example.payflowapi.controller;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.payflowapi.entity.User;
import com.example.payflowapi.service.UserService;

@RestController
@RequestMapping("/users")
public class UserController {

    @Autowired
    private UserService userService;

    @PostMapping
    public User registerUser(@RequestBody User user) {
        System.out.println(user);
        return userService.registerUser(user);
    }

    @GetMapping
    public List<User> getAllUsers() {
        return userService.getAllUsers();
    }

    @GetMapping("/{id}")
    public User getUserById(@PathVariable Long id) {
        return userService.getUserById(id);
    }

    @GetMapping("/upi/{upiId}")
    public User findByUpiId(@PathVariable String upiId) {
        return userService.findByUpiId(upiId);
    }

    @GetMapping("/balance/above/{amount}")
    public List<User> findUsersWithBalanceGreaterThan(@PathVariable Double amount) {
        return userService.findUsersWithBalanceGreaterThan(amount);
    }
}
