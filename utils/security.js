const crypto = require('crypto');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const config = require('../config');

class SecurityManager {
    constructor() {
        this.config = config.SECURITY;
        this.failedAttempts = new Map();
        this.blockedUsers = new Set();
        this.suspiciousActivity = new Map();
        this.activeSessions = new Map();
        
        // Rate limiter
        this.rateLimiter = new RateLimiterMemory({
            points: this.config.RATE_LIMIT.MAX_REQUESTS,
            duration: this.config.RATE_LIMIT.WINDOW_MS / 1000,
            blockDuration: this.config.RATE_LIMIT.BLOCK_DURATION / 1000
        });

        this.startAntiDebugger();
        this.startSessionCleaner();
    }

    // 🛡️ ANTI-DEBUGGER
    startAntiDebugger() {
        if (!this.config.ANTI_DEBUG) return;

        setInterval(() => {
            const start = Date.now();
            debugger; // Akan detect debugger
            const end = Date.now();
            
            if (end - start > 100) {
                console.error('🚨 DEBUGGER DETECTED! System will shutdown...');
                this.handleSecurityBreach('DEBUGGER_DETECTED');
            }
        }, 5000);

        // Prevent console tampering
        const noop = () => {};
        ['log', 'debug', 'info', 'warn', 'error'].forEach(method => {
            if (process.env.NODE_ENV === 'production') {
                console[method] = noop;
            }
        });
    }

    // 🔒 ENKRIPSI DATA
    encrypt(text) {
        try {
            const cipher = crypto.createCipheriv(
                'aes-256-cbc',
                Buffer.from(this.config.ENCRYPTION_KEY, 'hex'),
                Buffer.from(this.config.ENCRYPTION_IV, 'hex')
            );
            
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            return encrypted;
        } catch (error) {
            throw new Error('Encryption failed');
        }
    }

    // 🔓 DEKRIPSI DATA
    decrypt(encryptedText) {
        try {
            const decipher = crypto.createDecipheriv(
                'aes-256-cbc',
                Buffer.from(this.config.ENCRYPTION_KEY, 'hex'),
                Buffer.from(this.config.ENCRYPTION_IV, 'hex')
            );
            
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;
        } catch (error) {
            throw new Error('Decryption failed');
        }
    }

    // 🚦 RATE LIMITING
    async checkRateLimit(userId) {
        try {
            await this.rateLimiter.consume(userId.toString());
            return { allowed: true };
        } catch (error) {
            this.logSecurityEvent('RATE_LIMIT_EXCEEDED', userId);
            return {
                allowed: false,
                retryAfter: Math.round(error.msBeforeNext / 1000)
            };
        }
    }

    // 🚫 USER BLOCKING
    blockUser(userId, reason, duration = 0) {
        this.blockedUsers.add(userId);
        this.logSecurityEvent('USER_BLOCKED', userId, { reason, duration });
        
        if (duration > 0) {
            setTimeout(() => {
                this.blockedUsers.delete(userId);
                this.logSecurityEvent('USER_UNBLOCKED', userId);
            }, duration);
        }
    }

    isBlocked(userId) {
        return this.blockedUsers.has(userId);
    }

    // 📊 TRACK SUSPICIOUS ACTIVITY
    trackActivity(userId, activityType) {
        const key = `${userId}_${activityType}`;
        const count = (this.suspiciousActivity.get(key) || 0) + 1;
        this.suspiciousActivity.set(key, count);

        if (count >= this.config.SUSPICIOUS_ACTIVITY_THRESHOLD) {
            this.handleSuspiciousActivity(userId, activityType, count);
        }

        // Auto cleanup after 1 hour
        setTimeout(() => {
            this.suspiciousActivity.delete(key);
        }, 3600000);
    }

    handleSuspiciousActivity(userId, activityType, count) {
        console.warn(`⚠️ Suspicious activity: User ${userId}, Type: ${activityType}, Count: ${count}`);
        this.logSecurityEvent('SUSPICIOUS_ACTIVITY', userId, { activityType, count });
        
        if (config.ANTI_FRAUD.AUTO_BAN_ON_FRAUD) {
            this.blockUser(userId, 'Suspicious activity detected', 86400000); // 24 jam
        }
    }

    // 🔐 SESSION MANAGEMENT
    createSession(userId) {
        const sessionId = crypto.randomUUID();
        const session = {
            id: sessionId,
            userId: userId,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            isActive: true
        };
        
        this.activeSessions.set(sessionId, session);
        return sessionId;
    }

    validateSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        
        if (!session) return false;
        if (!session.isActive) return false;
        
        const now = Date.now();
        if (now - session.lastActivity > this.config.SESSION_TIMEOUT) {
            session.isActive = false;
            return false;
        }
        
        session.lastActivity = now;
        return true;
    }

    destroySession(sessionId) {
        this.activeSessions.delete(sessionId);
    }

    startSessionCleaner() {
        setInterval(() => {
            const now = Date.now();
            for (const [sessionId, session] of this.activeSessions.entries()) {
                if (now - session.lastActivity > this.config.SESSION_TIMEOUT) {
                    this.destroySession(sessionId);
                }
            }
        }, 300000); // Check every 5 minutes
    }

    // 📝 SECURITY LOGGING
    logSecurityEvent(eventType, userId, details = {}) {
        const event = {
            type: eventType,
            userId: userId,
            timestamp: new Date().toISOString(),
            details: details
        };
        
        if (config.LOGGING.LOG_SECURITY_EVENTS) {
            console.log(`🔒 Security Event:`, event);
            // Save to file/database (implement later)
        }
    }

    // 🚨 HANDLE SECURITY BREACH
    handleSecurityBreach(breachType) {
        console.error(`🚨 SECURITY BREACH: ${breachType}`);
        this.logSecurityEvent('SECURITY_BREACH', 0, { breachType });
        
        // Implement emergency actions:
        // - Notify owner
        // - Lock critical functions
        // - Backup data
        // - etc.
        
        if (process.env.NODE_ENV === 'production') {
            // In production, you might want to shutdown or alert
            // process.exit(1);
        }
    }

    // 🔍 INPUT VALIDATION
    sanitizeInput(input) {
        if (typeof input !== 'string') return input;
        
        // Remove potential XSS
        return input
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '')
            .trim();
    }

    // 🔐 HASH PASSWORD
    hashPassword(password) {
        return crypto
            .createHash('sha256')
            .update(password + this.config.ENCRYPTION_KEY)
            .digest('hex');
    }

    // ✅ VERIFY PASSWORD
    verifyPassword(password, hashedPassword) {
        return this.hashPassword(password) === hashedPassword;
    }

    // 🎲 GENERATE SECURE TOKEN
    generateSecureToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    // 🆔 GENERATE ORDER ID
    generateOrderId() {
        const timestamp = Date.now().toString(36);
        const random = crypto.randomBytes(4).toString('hex');
        return `ORD-${timestamp}-${random}`.toUpperCase();
    }
}

module.exports = SecurityManager;