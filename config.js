require('dotenv').config();
const crypto = require('crypto');

// 🔐 ENKRIPSI KEY (Ganti dengan key unik Anda)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ENCRYPTION_IV = process.env.ENCRYPTION_IV || crypto.randomBytes(16).toString('hex');

module.exports = {
    // 🤖 BOT CONFIGURATION
    BOT_TOKEN: process.env.BOT_TOKEN || '8374179615:AAH_nIQYYaYLCHqT-P-nI9PDqq9QmFD8F6E',
    OWNER_ID: parseInt(process.env.OWNER_ID) || 7804463533,
    BOT_LOGO: 'https://files.catbox.moe/swj56w.jpeg',
    BOT_NAME: 'Digital Store',
    
    // 💳 PAYMENT CONFIGURATION
    MANUAL_PAYMENT: {
        QRIS: {
            enabled: true,
            image_url: 'https://files.catbox.moe/tlofe0.jpg',
            name: 'QRIS All E-Wallet'
        },
        DANA: {
            enabled: true,
            number: '083834186945',
            name: 'Mohxxxx'
        },
        OVO: {
            enabled: true,
            number: '083122028438',
            name: 'jeeyxxx'
        },
        GOPAY: {
            enabled: true,
            number: '083122028438',
            name: 'jeeyxxx'
        },
        BCA: {
            enabled: true,
            account_number: '1234567890',
            account_name: 'PT DIGITAL STORE'
        },
        MANDIRI: {
            enabled: true,
            account_number: '9876543210',
            account_name: 'PT DIGITAL STORE'
        }
    },

    // ⚡ AUTO PAYMENT (QRIS)
    CIAATOPUP_API_KEY: process.env.CIAATOPUP_API_KEY || 'CiaaTopUp_qe51shcak0xrxuqt',
    CIAATOPUP_BASE_URL: 'https://ciaatopup.my.id',
    CIAATOPUP_CREATE_URL: 'https://ciaatopup.my.id/h2h/deposit/create',
    CIAATOPUP_STATUS_URL: 'https://ciaatopup.my.id/h2h/deposit/status',
    CIAATOPUP_CANCEL_URL: 'https://ciaatopup.my.id/h2h/deposit/cancel',
    
    // 📢 CHANNEL & GRUP
    TESTIMONI_CHANNEL: '@MarketplaceclCretatorID',
    SUPPORT_GROUP: '@YourSupportGroup',
    
    // 💰 PROFIT & PRICING
    MARKUP_PROFIT: 500,
    MIN_DEPOSIT: 1000,
    MAX_DEPOSIT: 10000000,
    ADMIN_FEE: 500,
    
    // 🔐 SECURITY CONFIGURATION
    SECURITY: {
        ENCRYPTION_KEY: ENCRYPTION_KEY,
        ENCRYPTION_IV: ENCRYPTION_IV,
        ANTI_DEBUG: true,
        ANTI_SPAM: true,
        RATE_LIMIT: {
            MAX_REQUESTS: 10,      // Max 10 request
            WINDOW_MS: 60000,      // Per 1 menit
            BLOCK_DURATION: 300000 // Block 5 menit
        },
        IP_WHITELIST: [],          // IP yang di-whitelist
        IP_BLACKLIST: [],          // IP yang di-blacklist
        MAX_FAILED_LOGIN: 5,       // Max percobaan login
        SESSION_TIMEOUT: 3600000,  // 1 jam
        JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex')
    },

    // 📦 STORAGE CONFIGURATION
    STORAGE: {
        BASE_PATH: './storage/products',
        MAX_FILE_SIZE: 1024 * 1024 * 1024 * 1024, // 1 TB per file
        ALLOWED_EXTENSIONS: [
            // Documents
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf',
            // Images
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico',
            // Videos
            '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v',
            // Audio
            '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a',
            // Archives
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
            // Ebooks
            '.epub', '.mobi', '.azw', '.azw3',
            // Code
            '.js', '.py', '.java', '.cpp', '.c', '.php', '.html', '.css',
            // Others
            '.apk', '.exe', '.dmg', '.iso', '.torrent'
        ],
        COMPRESSION_ENABLED: true,
        AUTO_BACKUP: true,
        BACKUP_INTERVAL: 86400000, // 24 jam
        CLEANUP_OLD_FILES: true,
        CLEANUP_DAYS: 90           // Hapus file >90 hari yang tidak terpakai
    },

    // 📊 DATABASE CONFIGURATION
    DATABASE: {
        AUTO_BACKUP: true,
        BACKUP_INTERVAL: 3600000,  // 1 jam
        MAX_BACKUP_FILES: 100,
        COMPRESSION: true,
        ENCRYPTION: true
    },

    // 🚨 LOGGING CONFIGURATION
    LOGGING: {
        ENABLED: true,
        LEVEL: 'info', // debug, info, warn, error
        MAX_LOG_SIZE: 10 * 1024 * 1024, // 10 MB
        MAX_LOG_FILES: 50,
        LOG_TO_FILE: true,
        LOG_TO_CONSOLE: true,
        LOG_SECURITY_EVENTS: true
    },

    // 🎨 UI CONFIGURATION
    UI: {
        ITEMS_PER_PAGE: 8,
        MAX_BUTTON_TEXT_LENGTH: 30,
        SHOW_PRODUCT_PREVIEW: true,
        SHOW_SELLER_INFO: true,
        ENABLE_RATING: true,
        ENABLE_REVIEWS: true
    },

    // 🔔 NOTIFICATION CONFIGURATION
    NOTIFICATIONS: {
        NOTIFY_OWNER_ON_ORDER: true,
        NOTIFY_USER_ON_APPROVAL: true,
        NOTIFY_USER_ON_REJECTION: true,
        NOTIFY_ON_LOW_STOCK: true,
        LOW_STOCK_THRESHOLD: 5,
        SEND_RECEIPT: true
    },

    // 🛡️ ANTI-FRAUD CONFIGURATION
    ANTI_FRAUD: {
        ENABLED: true,
        MAX_ORDERS_PER_DAY: 50,
        MAX_ORDERS_PER_HOUR: 10,
        VERIFY_NEW_USERS: true,
        MIN_ACCOUNT_AGE_DAYS: 0,    // Min umur akun telegram (hari)
        SUSPICIOUS_ACTIVITY_THRESHOLD: 3,
        AUTO_BAN_ON_FRAUD: true
    },

    // 📱 TELEGRAM LIMITS
    TELEGRAM: {
        MAX_MESSAGE_LENGTH: 4096,
        MAX_CAPTION_LENGTH: 1024,
        MAX_FILE_SIZE: 2000 * 1024 * 1024, // 2 GB untuk Telegram
        CHUNK_SIZE: 1024 * 1024,           // 1 MB chunks
        MAX_BUTTONS_PER_ROW: 2,
        MAX_ROWS: 8
    },

    // 🎯 BUSINESS CONFIGURATION
    BUSINESS: {
        ALLOW_GUEST_VIEW: true,        // Guest bisa lihat produk
        REQUIRE_APPROVAL: true,        // Order butuh approval
        AUTO_DELIVER_ON_PAYMENT: false, // Auto kirim setelah bayar
        ALLOW_REFUND: false,           // Allow refund
        REFUND_PERIOD_DAYS: 0,         // Periode refund (hari)
        ALLOW_PRODUCT_REVIEW: true,
        REQUIRE_PHONE_VERIFICATION: false,
        ENABLE_WISHLIST: true,
        ENABLE_CART: false             // Shopping cart (future feature)
    },

    // 📈 ANALYTICS
    ANALYTICS: {
        TRACK_USER_ACTIVITY: true,
        TRACK_PRODUCT_VIEWS: true,
        TRACK_SEARCH_QUERIES: true,
        GENERATE_REPORTS: true,
        REPORT_INTERVAL: 86400000      // 24 jam
    }
};