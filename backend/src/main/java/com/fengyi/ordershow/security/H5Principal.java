package com.fengyi.ordershow.security;

public record H5Principal(long sessionId, long activityId, long customerId, String activityCode,
                          String customerType, String regionCode, String branchName,
                          String dealerShortName, String dealerFullName, String phoneMasked) {}
