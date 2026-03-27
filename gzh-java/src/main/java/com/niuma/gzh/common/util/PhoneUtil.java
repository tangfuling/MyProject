package com.niuma.gzh.common.util;

public final class PhoneUtil {
    private PhoneUtil() {
    }

    public static String mask(String phone) {
        if (phone == null || phone.length() < 7) {
            return phone;
        }
        return phone.substring(0, 3) + "****" + phone.substring(phone.length() - 4);
    }
}
