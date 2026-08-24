package com.fengyi.ordershow.security;

public record AdminPrincipal(long id, String username, String displayName, boolean mustChangePassword) {}
