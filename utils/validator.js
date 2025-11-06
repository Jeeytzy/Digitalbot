const config = require('../config');

class Validator {
    // 📧 VALIDATE EMAIL
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // 📱 VALIDATE PHONE
    static isValidPhone(phone) {
        const phoneRegex = /^(\+62|62|0)[0-9]{9,12}$/;
        return phoneRegex.test(phone.replace(/\s/g, ''));
    }

    // 💰 VALIDATE AMOUNT
    static isValidAmount(amount) {
        const num = parseFloat(amount);
        return !isNaN(num) && num > 0 && num <= config.MAX_DEPOSIT;
    }

    // 🔢 VALIDATE NUMBER
    static isValidNumber(value, min = 0, max = Infinity) {
        const num = parseFloat(value);
        return !isNaN(num) && num >= min && num <= max;
    }

    // 📝 VALIDATE TEXT LENGTH
    static isValidLength(text, min = 1, max = 1000) {
        return text && text.length >= min && text.length <= max;
    }

    // 🆔 VALIDATE USER ID
    static isValidUserId(userId) {
        return Number.isInteger(userId) && userId > 0;
    }

    // 🏷️ VALIDATE PRODUCT NAME
    static isValidProductName(name) {
        return this.isValidLength(name, 3, 100);
    }

    // 💵 VALIDATE PRICE
    static isValidPrice(price) {
        return this.isValidNumber(price, 100, 100000000);
    }

    // 📦 VALIDATE STOCK
    static isValidStock(stock) {
        return Number.isInteger(stock) && stock >= 0;
    }

    // 📄 VALIDATE FILE NAME
    static isValidFileName(fileName) {
        if (!fileName || fileName.length === 0) return false;
        
        // Check for invalid characters
        const invalidChars = /[<>:"|?*\x00-\x1f]/;
        if (invalidChars.test(fileName)) return false;

        // Check length
        if (fileName.length > 255) return false;

        return true;
    }

    // 🔗 VALIDATE URL
    static isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    // 🎨 VALIDATE HEX COLOR
    static isValidHexColor(color) {
        return /^#[0-9A-F]{6}$/i.test(color);
    }

    // 🔐 VALIDATE PASSWORD
    static isValidPassword(password) {
        return this.isValidLength(password, 6, 50);
    }

    // ✅ VALIDATE PAYMENT METHOD
    static isValidPaymentMethod(method) {
        const validMethods = Object.keys(config.MANUAL_PAYMENT);
        return validMethods.includes(method.toUpperCase());
    }

    // 📊 VALIDATE ORDER STATUS
    static isValidOrderStatus(status) {
        const validStatuses = ['pending', 'processing', 'completed', 'cancelled', 'refunded'];
        return validStatuses.includes(status.toLowerCase());
    }

    // 🎯 VALIDATE CATEGORY
    static isValidCategory(category) {
        const validCategories = [
            'ebook', 'software', 'template', 'course', 
            'music', 'video', 'photo', 'document', 'other'
        ];
        return validCategories.includes(category.toLowerCase());
    }

    // 🔍 SANITIZE INPUT
    static sanitize(input) {
        if (typeof input !== 'string') return input;
        
        return input
            .trim()
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '');
    }

    // 🧹 CLEAN OBJECT
    static cleanObject(obj) {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null && value !== undefined && value !== '') {
                cleaned[key] = typeof value === 'string' ? this.sanitize(value) : value;
            }
        }
        return cleaned;
    }

    // ✅ VALIDATE OBJECT SCHEMA
    static validateSchema(obj, schema) {
        const errors = [];

        for (const [field, rules] of Object.entries(schema)) {
            const value = obj[field];

            if (rules.required && (value === undefined || value === null || value === '')) {
                errors.push(`Field '${field}' is required`);
                continue;
            }

            if (value !== undefined && value !== null && value !== '') {
                if (rules.type && typeof value !== rules.type) {
                    errors.push(`Field '${field}' must be of type ${rules.type}`);
                }

                if (rules.min !== undefined && value < rules.min) {
                    errors.push(`Field '${field}' must be at least ${rules.min}`);
                }

                if (rules.max !== undefined && value > rules.max) {
                    errors.push(`Field '${field}' must not exceed ${rules.max}`);
                }

                if (rules.minLength && value.length < rules.minLength) {
                    errors.push(`Field '${field}' must be at least ${rules.minLength} characters`);
                }

                if (rules.maxLength && value.length > rules.maxLength) {
                    errors.push(`Field '${field}' must not exceed ${rules.maxLength} characters`);
                }

                if (rules.pattern && !rules.pattern.test(value)) {
                    errors.push(`Field '${field}' has invalid format`);
                }

                if (rules.enum && !rules.enum.includes(value)) {
                    errors.push(`Field '${field}' must be one of: ${rules.enum.join(', ')}`);
                }

                if (rules.custom && !rules.custom(value)) {
                    errors.push(`Field '${field}' failed custom validation`);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
}

module.exports = Validator;