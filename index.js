require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');

// Import Managers
const config = require('./config');
const DatabaseManager = require('./utils/database');
const SecurityManager = require('./utils/security');
const FileManager = require('./utils/fileManager');
const Validator = require('./utils/validator');
const UserManager = require('./modules/userManager');
const ProductManager = require('./modules/productManager');
const OrderManager = require('./modules/orderManager');
const PaymentManager = require('./modules/paymentManager');

// Initialize Bot
const bot = new TelegramBot(config.BOT_TOKEN, { 
    polling: {
        interval: 1000,
        autoStart: true,
        params: {
            timeout: 30
        }
    }
});

// Initialize Managers
const db = new DatabaseManager();
const security = new SecurityManager();
const fileManager = new FileManager();
const userManager = new UserManager();
const productManager = new ProductManager();
const orderManager = new OrderManager();
const paymentManager = new PaymentManager();

// User States
const userStates = new Map();

// 🚀 BOT STARTUP
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.message);
});

console.log('🚀 Bot is starting...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📱 Bot Name: ${config.BOT_NAME}`);
console.log(`🔐 Security: ${config.SECURITY.ANTI_DEBUG ? 'ENABLED' : 'DISABLED'}`);
console.log(`💾 Storage: ${config.STORAGE.BASE_PATH}`);
console.log(`👑 Owner ID: ${config.OWNER_ID}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// 🔄 AUTO CLEANUP & CHECK SCHEDULER
setInterval(async () => {
    await orderManager.cleanupExpiredOrders();
    await paymentManager.cleanupExpiredDeposits();
    await paymentManager.autoCheckQRISPayments();
}, 60000); // Every 1 minute

// 🎯 HELPER FUNCTIONS

function formatRupiah(amount) {
    return `Rp ${amount.toLocaleString('id-ID')}`;
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleString('id-ID', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getUserState(userId) {
    return userStates.get(userId) || {};
}

function setUserState(userId, state) {
    userStates.set(userId, { ...getUserState(userId), ...state });
}

function clearUserState(userId) {
    userStates.delete(userId);
}

async function checkUserAccess(userId) {
    const access = await userManager.checkUserAccess(userId);
    return access;
}

function isOwner(userId) {
    return userId === config.OWNER_ID;
}

async function sendMessage(chatId, text, options = {}) {
    try {
        // Split long messages
        if (text.length > config.TELEGRAM.MAX_MESSAGE_LENGTH) {
            const chunks = text.match(new RegExp(`.{1,${config.TELEGRAM.MAX_MESSAGE_LENGTH}}`, 'g'));
            for (const chunk of chunks) {
                await bot.sendMessage(chatId, chunk, options);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } else {
            return await bot.sendMessage(chatId, text, options);
        }
    } catch (error) {
        console.error('Error sending message:', error.message);
    }
}

async function sendPhoto(chatId, photo, options = {}) {
    try {
        return await bot.sendPhoto(chatId, photo, options);
    } catch (error) {
        console.error('Error sending photo:', error.message);
        await sendMessage(chatId, options.caption || 'Terjadi kesalahan saat mengirim foto.');
    }
}

async function sendDocument(chatId, document, options = {}) {
    try {
        return await bot.sendDocument(chatId, document, options);
    } catch (error) {
        console.error('Error sending document:', error.message);
        await sendMessage(chatId, 'Terjadi kesalahan saat mengirim file.');
    }
}

function createInlineKeyboard(buttons, itemsPerRow = 2) {
    const keyboard = [];
    for (let i = 0; i < buttons.length; i += itemsPerRow) {
        keyboard.push(buttons.slice(i, i + itemsPerRow));
    }
    return { inline_keyboard: keyboard };
}

// 📝 MAIN MENU
function getMainMenu(userId) {
    const buttons = [
        [
            { text: '🛍️ Produk Digital', callback_data: 'menu_products' },
            { text: '📦 Pesanan Saya', callback_data: 'menu_my_orders' }
        ],
        [
            { text: '💰 Deposit', callback_data: 'menu_deposit' },
            { text: '💳 Saldo', callback_data: 'menu_balance' }
        ],
        [
            { text: '👤 Profil', callback_data: 'menu_profile' },
            { text: '❓ Bantuan', callback_data: 'menu_help' }
        ]
    ];

    if (isOwner(userId)) {
        buttons.push([
            { text: '⚙️ Admin Panel', callback_data: 'admin_panel' }
        ]);
    }

    return { inline_keyboard: buttons };
}

// 👑 ADMIN MENU
function getAdminMenu() {
    return {
        inline_keyboard: [
            [
                { text: '➕ Tambah Produk', callback_data: 'admin_add_product' },
                { text: '📋 Kelola Produk', callback_data: 'admin_manage_products' }
            ],
            [
                { text: '📦 Kelola Pesanan', callback_data: 'admin_manage_orders' },
                { text: '💳 Kelola Deposit', callback_data: 'admin_manage_deposits' }
            ],
            [
                { text: '👥 Daftar User', callback_data: 'admin_list_users' },
                { text: '📊 Statistik', callback_data: 'admin_statistics' }
            ],
            [
                { text: '🔙 Kembali', callback_data: 'main_menu' }
            ]
        ]
    };
}

// 🎯 START COMMAND
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        // Rate limit check
        const rateLimit = await security.checkRateLimit(userId);
        if (!rateLimit.allowed) {
            return await sendMessage(chatId, `⚠️ Terlalu banyak request. Coba lagi dalam ${rateLimit.retryAfter} detik.`);
        }

        // Check or create user
        let user = await userManager.getUser(userId);
        if (!user) {
            const result = await userManager.createUser({
                userId: userId,
                username: msg.from.username,
                firstName: msg.from.first_name,
                lastName: msg.from.last_name
            });
            user = result.user;
        }

        // Check access
        const access = await checkUserAccess(userId);
        if (!access.allowed) {
            return await sendMessage(chatId, `❌ Akses ditolak: ${access.reason}`);
        }

        // Update last activity
        await userManager.updateUser(userId, { lastActivity: new Date().toISOString() });

        // Send welcome message
        const welcomeText = `
🎉 *Selamat Datang di ${config.BOT_NAME}!*

Halo *${user.firstName || user.username}*! 👋

━━━━━━━━━━━━━━━━━━━━━━
💰 *Saldo Anda:* ${formatRupiah(user.balance)}
📦 *Total Pesanan:* ${user.totalOrders || 0}
━━━━━━━━━━━━━━━━━━━━━━

🛍️ Kami menyediakan berbagai produk digital berkualitas dengan harga terjangkau!

Pilih menu di bawah untuk memulai:
        `.trim();

        await sendPhoto(chatId, config.BOT_LOGO, {
            caption: welcomeText,
            parse_mode: 'Markdown',
            reply_markup: getMainMenu(userId)
        });

    } catch (error) {
        console.error('Error in /start command:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan. Silakan coba lagi.');
    }
});

// 🔄 CALLBACK QUERY HANDLER
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const userId = query.from.id;
    const data = query.data;

    try {
        // Rate limit
        const rateLimit = await security.checkRateLimit(userId);
        if (!rateLimit.allowed) {
            return await bot.answerCallbackQuery(query.id, {
                text: `⚠️ Terlalu banyak request. Tunggu ${rateLimit.retryAfter} detik.`,
                show_alert: true
            });
        }

        // Check access
        const access = await checkUserAccess(userId);
        if (!access.allowed) {
            return await bot.answerCallbackQuery(query.id, {
                text: `❌ ${access.reason}`,
                show_alert: true
            });
        }

        await bot.answerCallbackQuery(query.id);

        // MAIN MENU HANDLERS
        if (data === 'main_menu') {
            return await handleMainMenu(chatId, messageId, userId);
        }

        if (data === 'menu_products') {
            return await handleProductsMenu(chatId, messageId, userId);
        }

        if (data === 'menu_my_orders') {
            return await handleMyOrders(chatId, messageId, userId);
        }

        if (data === 'menu_deposit') {
            return await handleDepositMenu(chatId, messageId, userId);
        }

        if (data === 'menu_balance') {
            return await handleBalanceMenu(chatId, messageId, userId);
        }

        if (data === 'menu_profile') {
            return await handleProfileMenu(chatId, messageId, userId);
        }

        if (data === 'menu_help') {
            return await handleHelpMenu(chatId, messageId, userId);
        }

        // ADMIN HANDLERS
        if (data === 'admin_panel') {
            if (!isOwner(userId)) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Anda bukan admin!',
                    show_alert: true
                });
            }
            return await handleAdminPanel(chatId, messageId, userId);
        }

        if (data.startsWith('admin_')) {
            if (!isOwner(userId)) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Anda bukan admin!',
                    show_alert: true
                });
            }
            return await handleAdminActions(chatId, messageId, userId, data);
        }

        // PRODUCT HANDLERS
        if (data.startsWith('product_')) {
            return await handleProductActions(chatId, messageId, userId, data);
        }

        // ORDER HANDLERS
        if (data.startsWith('order_')) {
            return await handleOrderActions(chatId, messageId, userId, data);
        }

        // DEPOSIT HANDLERS
        if (data.startsWith('deposit_')) {
            return await handleDepositActions(chatId, messageId, userId, data);
        }

        // PAYMENT HANDLERS
        if (data.startsWith('payment_')) {
            return await handlePaymentActions(chatId, messageId, userId, data);
        }

    } catch (error) {
        console.error('Error handling callback query:', error.message);
        await bot.answerCallbackQuery(query.id, {
            text: '❌ Terjadi kesalahan',
            show_alert: true
        });
    }
});

// 📱 MAIN MENU HANDLER
async function handleMainMenu(chatId, messageId, userId) {
    const user = await userManager.getUser(userId);

    const text = `
🏠 *MENU UTAMA*

Halo *${user.firstName || user.username}*!

💰 *Saldo:* ${formatRupiah(user.balance)}
📦 *Total Pesanan:* ${user.statistics?.totalOrders || 0}

Silakan pilih menu:
    `.trim();

    await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu(userId)
    });
}

// 🛍️ PRODUCTS MENU HANDLER
async function handleProductsMenu(chatId, messageId, userId, page = 1) {
    try {
        const products = await productManager.getAllProducts({ status: 'active' });
        
        if (products.length === 0) {
            return await bot.editMessageText('📦 Belum ada produk tersedia.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Kembali', callback_data: 'main_menu' }
                    ]]
                }
            });
        }

        const itemsPerPage = config.UI.ITEMS_PER_PAGE;
        const totalPages = Math.ceil(products.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const pageProducts = products.slice(startIndex, endIndex);

        let text = `🛍️ *PRODUK DIGITAL*\n\n`;
        text += `📦 Total Produk: ${products.length}\n`;
        text += `📄 Halaman ${page}/${totalPages}\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        const buttons = [];

        for (const product of pageProducts) {
            text += `📦 *${product.name}*\n`;
            text += `💰 Harga: ${formatRupiah(product.price)}\n`;
            text += `📊 Stok: ${product.stock}\n`;
            text += `⭐ Rating: ${product.rating || 0}/5\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            buttons.push([{
                text: `📦 ${product.name.substring(0, 25)}${product.name.length > 25 ? '...' : ''}`,
                callback_data: `product_view_${product.productId}`
            }]);
        }

        // Pagination
        const navButtons = [];
        if (page > 1) {
            navButtons.push({ text: '◀️ Prev', callback_data: `products_page_${page - 1}` });
        }
        navButtons.push({ text: `📄 ${page}/${totalPages}`, callback_data: 'noop' });
        if (page < totalPages) {
            navButtons.push({ text: 'Next ▶️', callback_data: `products_page_${page + 1}` });
        }
        buttons.push(navButtons);

        buttons.push([
            { text: '🔍 Cari Produk', callback_data: 'product_search' },
            { text: '🏷️ Kategori', callback_data: 'product_categories' }
        ]);
        buttons.push([
            { text: '🔙 Kembali', callback_data: 'main_menu' }
        ]);

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });

    } catch (error) {
        console.error('Error handling products menu:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan saat memuat produk.');
    }
}

// 📦 PRODUCT ACTIONS HANDLER
async function handleProductActions(chatId, messageId, userId, data) {
    try {
        const parts = data.split('_');
        const action = parts[1];
        const productId = parts[2];

        if (action === 'view') {
            const product = await productManager.getProduct(productId);
            if (!product) {
                return await bot.editMessageText('❌ Produk tidak ditemukan.', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'menu_products' }
                        ]]
                    }
                });
            }

            // Increment view count
            await productManager.incrementViewCount(productId);

            let text = `📦 *DETAIL PRODUK*\n\n`;
            text += `*${product.name}*\n\n`;
            text += `📝 *Deskripsi:*\n${product.description}\n\n`;
            text += `💰 *Harga:* ${formatRupiah(product.price)}\n`;
            text += `📊 *Stok:* ${product.stock}\n`;
            text += `🏷️ *Kategori:* ${product.category}\n`;
            text += `⭐ *Rating:* ${product.rating || 0}/5\n`;
            text += `👁️ *Views:* ${product.totalViews || 0}\n`;
            text += `🛒 *Terjual:* ${product.totalSales || 0}\n`;
            text += `📁 *File Count:* ${product.files?.length || 0}\n`;
            text += `💾 *Size:* ${fileManager.formatSize(product.metadata?.fileSize || 0)}\n\n`;
            text += `📅 *Ditambahkan:* ${formatDate(product.createdAt)}\n`;

            const buttons = [
                [{ text: '🛒 Beli Sekarang', callback_data: `product_buy_${productId}` }],
                [{ text: '📋 Info Lengkap', callback_data: `product_fullinfo_${productId}` }],
                [{ text: '🔙 Kembali', callback_data: 'menu_products' }]
            ];

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (action === 'buy') {
            const product = await productManager.getProduct(productId);
            if (!product) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Produk tidak ditemukan',
                    show_alert: true
                });
            }

            if (product.stock <= 0) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Produk habis!',
                    show_alert: true
                });
            }

            const user = await userManager.getUser(userId);
            const totalPrice = product.price;

            let text = `💳 *KONFIRMASI PEMBELIAN*\n\n`;
            text += `📦 *Produk:* ${product.name}\n`;
            text += `💰 *Harga:* ${formatRupiah(totalPrice)}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `💳 *Saldo Anda:* ${formatRupiah(user.balance)}\n`;

            const buttons = [];

            if (user.balance >= totalPrice) {
                text += `\n✅ Saldo mencukupi!\n\nPilih metode pembayaran:`;
                buttons.push([
                    { text: '💰 Bayar dengan Saldo', callback_data: `payment_balance_${productId}` }
                ]);
            } else {
                text += `\n❌ Saldo tidak mencukupi!\n`;
                text += `Kekurangan: ${formatRupiah(totalPrice - user.balance)}\n\n`;
                text += `Silakan deposit terlebih dahulu.`;
                buttons.push([
                    { text: '💳 Deposit', callback_data: 'menu_deposit' }
                ]);
            }

            buttons.push([
                { text: '🔙 Kembali', callback_data: `product_view_${productId}` }
            ]);

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (action === 'fullinfo') {
            const product = await productManager.getProduct(productId);
            if (!product) return;

            let text = `📦 *INFORMASI LENGKAP*\n\n`;
            text += `*${product.name}*\n\n`;
            text += `📝 *Deskripsi:*\n${product.description}\n\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
            text += `💰 Harga: ${formatRupiah(product.price)}\n`;
            text += `📊 Stok: ${product.stock}\n`;
            text += `🏷️ Kategori: ${product.category}\n`;
            text += `⭐ Rating: ${product.rating || 0}/5\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            if (product.files && product.files.length > 0) {
                text += `📁 *File yang Didapat:*\n`;
                product.files.forEach((file, idx) => {
                    text += `${idx + 1}. ${file.originalName} (${fileManager.formatSize(file.size)})\n`;
                });
                text += `\n`;
            }

            text += `👁️ Views: ${product.totalViews || 0}\n`;
            text += `🛒 Terjual: ${product.totalSales || 0}\n`;
            text += `📅 Ditambahkan: ${formatDate(product.createdAt)}\n`;
            text += `🔄 Update: ${formatDate(product.updatedAt)}\n`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛒 Beli Sekarang', callback_data: `product_buy_${productId}` }],
                        [{ text: '🔙 Kembali', callback_data: `product_view_${productId}` }]
                    ]
                }
            });
        }

        if (action === 'page') {
            const page = parseInt(parts[2]);
            return await handleProductsMenu(chatId, messageId, userId, page);
        }

    } catch (error) {
        console.error('Error handling product actions:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 📦 MY ORDERS HANDLER
async function handleMyOrders(chatId, messageId, userId, page = 1) {
    try {
        const orders = await orderManager.getUserOrders(userId);

        if (orders.length === 0) {
            return await bot.editMessageText('📦 Anda belum memiliki pesanan.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛍️ Lihat Produk', callback_data: 'menu_products' }],
                        [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                    ]
                }
            });
        }

        const itemsPerPage = 5;
        const totalPages = Math.ceil(orders.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const pageOrders = orders.slice(startIndex, endIndex);

        let text = `📦 *PESANAN SAYA*\n\n`;
        text += `Total: ${orders.length} pesanan\n`;
        text += `Halaman ${page}/${totalPages}\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        const buttons = [];

        for (const order of pageOrders) {
            const statusEmoji = {
                'pending': '⏳',
                'processing': '🔄',
                'completed': '✅',
                'cancelled': '❌'
            };

            text += `${statusEmoji[order.status] || '📦'} *${order.orderId}*\n`;
            text += `📦 ${order.productName}\n`;
            text += `💰 ${formatRupiah(order.amount)}\n`;
            text += `📅 ${formatDate(order.createdAt)}\n`;
            text += `Status: *${order.status.toUpperCase()}*\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            buttons.push([{
                text: `📄 ${order.orderId}`,
                callback_data: `order_detail_${order.orderId}`
            }]);
        }

        // Pagination
        const navButtons = [];
        if (page > 1) {
            navButtons.push({ text: '◀️ Prev', callback_data: `orders_page_${page - 1}` });
        }
        navButtons.push({ text: `📄 ${page}/${totalPages}`, callback_data: 'noop' });
        if (page < totalPages) {
            navButtons.push({ text: 'Next ▶️', callback_data: `orders_page_${page + 1}` });
        }
        if (navButtons.length > 1) buttons.push(navButtons);

        buttons.push([{ text: '🔙 Kembali', callback_data: 'main_menu' }]);

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });

    } catch (error) {
        console.error('Error handling my orders:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 📦 ORDER ACTIONS HANDLER
async function handleOrderActions(chatId, messageId, userId, data) {
    try {
        const parts = data.split('_');
        const action = parts[1];
        const orderId = parts[2];

        if (action === 'detail') {
            const order = await orderManager.getOrder(orderId);
            if (!order || order.userId !== userId) {
                return await bot.editMessageText('❌ Pesanan tidak ditemukan.', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'menu_my_orders' }
                        ]]
                    }
                });
            }

            const statusEmoji = {
                'pending': '⏳ Menunggu',
                'processing': '🔄 Diproses',
                'completed': '✅ Selesai',
                'cancelled': '❌ Dibatalkan'
            };

            let text = `📦 *DETAIL PESANAN*\n\n`;
            text += `🆔 Order ID: \`${order.orderId}\`\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `📦 *Produk:* ${order.productName}\n`;
            text += `💰 *Total:* ${formatRupiah(order.amount)}\n`;
            text += `💳 *Metode:* ${order.paymentMethod}\n`;
            text += `📊 *Status:* ${statusEmoji[order.status]}\n\n`;
            text += `📅 *Dibuat:* ${formatDate(order.createdAt)}\n`;

            if (order.completedAt) {
                text += `✅ *Selesai:* ${formatDate(order.completedAt)}\n`;
            }

            if (order.notes) {
                text += `\n📝 *Catatan:*\n${order.notes}\n`;
            }

            const buttons = [];

            if (order.status === 'completed') {
                buttons.push([
                    { text: '📥 Download File', callback_data: `order_download_${orderId}` }
                ]);
            }

            if (order.status === 'pending' || order.status === 'processing') {
                buttons.push([
                    { text: '❌ Batalkan', callback_data: `order_cancel_${orderId}` }
                ]);
            }

            buttons.push([
                { text: '🔙 Kembali', callback_data: 'menu_my_orders' }
            ]);

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (action === 'download') {
            const order = await orderManager.getOrder(orderId);
            if (!order || order.userId !== userId) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Pesanan tidak ditemukan',
                    show_alert: true
                });
            }

            if (order.status !== 'completed') {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Pesanan belum selesai',
                    show_alert: true
                });
            }

            await sendMessage(chatId, '⏳ Memproses file, mohon tunggu...');

            const product = await productManager.getProduct(order.productId);
            if (!product || !product.files || product.files.length === 0) {
                return await sendMessage(chatId, '❌ File tidak ditemukan.');
            }

            await sendMessage(chatId, `📥 Mengirim ${product.files.length} file...`);

            for (const file of product.files) {
                try {
                    const fileBuffer = await fileManager.readFile(file.path);
                    
                    await sendDocument(chatId, fileBuffer, {
                        caption: `📦 ${product.name}\n📁 ${file.originalName}\n💾 ${fileManager.formatSize(file.size)}`,
                        filename: file.originalName
                    });

                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error('Error sending file:', error.message);
                    await sendMessage(chatId, `❌ Gagal mengirim: ${file.originalName}`);
                }
            }

            await sendMessage(chatId, '✅ Semua file berhasil dikirim!\n\n⭐ Jangan lupa beri rating produk ini!');
        }

        if (action === 'cancel') {
            const order = await orderManager.getOrder(orderId);
            if (!order || order.userId !== userId) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Pesanan tidak ditemukan',
                    show_alert: true
                });
            }

            if (!['pending', 'processing'].includes(order.status)) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Pesanan tidak dapat dibatalkan',
                    show_alert: true
                });
            }

            await orderManager.cancelOrder(orderId, 'Dibatalkan oleh user');

            // Refund balance
            await userManager.updateBalance(userId, order.amount, 'add');

            await bot.editMessageText('✅ Pesanan berhasil dibatalkan.\nSaldo telah dikembalikan.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Kembali', callback_data: 'menu_my_orders' }
                    ]]
                }
            });
        }

        if (action === 'page') {
            const page = parseInt(parts[2]);
            return await handleMyOrders(chatId, messageId, userId, page);
        }

    } catch (error) {
        console.error('Error handling order actions:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 💰 DEPOSIT MENU HANDLER
async function handleDepositMenu(chatId, messageId, userId) {
    try {
        const user = await userManager.getUser(userId);

        let text = `💰 *DEPOSIT SALDO*\n\n`;
        text += `💳 *Saldo Saat Ini:* ${formatRupiah(user.balance)}\n\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        text += `📌 *Minimal Deposit:* ${formatRupiah(config.MIN_DEPOSIT)}\n`;
        text += `📌 *Maksimal Deposit:* ${formatRupiah(config.MAX_DEPOSIT)}\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        text += `Pilih nominal deposit atau masukkan nominal custom:`;

        const quickAmounts = [10000, 25000, 50000, 100000, 250000, 500000];
        const buttons = [];

        quickAmounts.forEach(amount => {
            buttons.push([{
                text: formatRupiah(amount),
                callback_data: `deposit_amount_${amount}`
            }]);
        });

        buttons.push([
            { text: '✏️ Nominal Custom', callback_data: 'deposit_custom' }
        ]);
        buttons.push([
            { text: '📜 Riwayat Deposit', callback_data: 'deposit_history' }
        ]);
        buttons.push([
            { text: '🔙 Kembali', callback_data: 'main_menu' }
        ]);

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });

    } catch (error) {
        console.error('Error handling deposit menu:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 💳 DEPOSIT ACTIONS HANDLER
async function handleDepositActions(chatId, messageId, userId, data) {
    try {
        const parts = data.split('_');
        const action = parts[1];

        if (action === 'amount') {
            const amount = parseInt(parts[2]);
            setUserState(userId, { depositAmount: amount });

            let text = `💰 *PILIH METODE PEMBAYARAN*\n\n`;
            text += `💵 *Jumlah Deposit:* ${formatRupiah(amount)}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `Pilih metode pembayaran:`;

            const methods = paymentManager.getPaymentMethods();
            const buttons = [];

            methods.forEach(method => {
                buttons.push([{
                    text: `${method.name}`,
                    callback_data: `deposit_method_${method.code}_${amount}`
                }]);
            });

            buttons.push([
                { text: '🔙 Kembali', callback_data: 'menu_deposit' }
            ]);

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (action === 'method') {
            const method = parts[2];
            const amount = parseInt(parts[3]);

            const depositResult = await paymentManager.createDeposit({
                userId: userId,
                amount: amount,
                method: method
            });

            if (!depositResult.success) {
                return await bot.editMessageText(`❌ Gagal membuat deposit: ${depositResult.message}`, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'menu_deposit' }
                        ]]
                    }
                });
            }

            const deposit = depositResult.deposit;

            if (method === 'QRIS_AUTO') {
                // Auto QRIS
                let text = `💳 *DEPOSIT VIA QRIS*\n\n`;
                text += `💵 Jumlah: ${formatRupiah(amount)}\n`;
                text += `🆔 ID: \`${deposit.depositId}\`\n`;
                text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                text += `📱 Scan QR Code di bawah ini atau klik tombol untuk membayar.\n\n`;
                text += `⏰ Berlaku hingga: ${formatDate(deposit.expiresAt)}\n\n`;
                text += `✅ Saldo akan otomatis masuk setelah pembayaran terdeteksi.`;

                await bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💳 Bayar Sekarang', url: deposit.paymentUrl }],
                            [{ text: '🔄 Cek Status', callback_data: `deposit_check_${deposit.depositId}` }],
                            [{ text: '❌ Batalkan', callback_data: `deposit_cancel_${deposit.depositId}` }],
                            [{ text: '🔙 Kembali', callback_data: 'menu_deposit' }]
                        ]
                    }
                });

                // Send QR Code
                if (deposit.qrUrl) {
                    await sendPhoto(chatId, deposit.qrUrl, {
                        caption: `💳 QR Code untuk deposit ${formatRupiah(amount)}`
                    });
                }

            } else {
                // Manual Payment
                const paymentInfo = config.MANUAL_PAYMENT[method];

                let text = `💳 *DEPOSIT VIA ${method}*\n\n`;
                text += `💵 Jumlah: ${formatRupiah(amount)}\n`;
                text += `🆔 ID: \`${deposit.depositId}\`\n`;
                text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                if (method === 'QRIS' && paymentInfo.image_url) {
                    text += `📱 *Transfer ke:*\n${paymentInfo.name}\n\n`;
                } else if (paymentInfo.number) {
                    text += `📱 *Nomor:* \`${paymentInfo.number}\`\n`;
                    text += `👤 *Atas Nama:* ${paymentInfo.name}\n\n`;
                } else if (paymentInfo.account_number) {
                    text += `🏦 *Rekening:* \`${paymentInfo.account_number}\`\n`;
                    text += `👤 *Atas Nama:* ${paymentInfo.account_name}\n\n`;
                }

                text += `⚠️ *PENTING:*\n`;
                text += `• Transfer EXACT sesuai nominal\n`;
                text += `• Upload bukti transfer\n`;
                text += `• Tunggu konfirmasi admin\n\n`;
                text += `⏰ Berlaku hingga: ${formatDate(deposit.expiresAt)}`;

                await bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📤 Upload Bukti', callback_data: `deposit_proof_${deposit.depositId}` }],
                            [{ text: '❌ Batalkan', callback_data: `deposit_cancel_${deposit.depositId}` }],
                            [{ text: '🔙 Kembali', callback_data: 'menu_deposit' }]
                        ]
                    }
                });

                // Send QRIS image if available
                if (method === 'QRIS' && paymentInfo.image_url) {
                    await sendPhoto(chatId, paymentInfo.image_url, {
                        caption: `💳 Scan QR Code untuk transfer ${formatRupiah(amount)}`
                    });
                }
            }
        }

        if (action === 'proof') {
            const depositId = parts[2];
            setUserState(userId, { 
                waitingFor: 'deposit_proof',
                depositId: depositId
            });

            await bot.editMessageText('📤 *UPLOAD BUKTI TRANSFER*\n\nSilakan kirim foto bukti transfer Anda.', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '❌ Batalkan', callback_data: 'deposit_cancel_upload' }
                    ]]
                }
            });
        }

        if (action === 'check') {
            const depositId = parts[2];
            const deposit = await paymentManager.getDeposit(depositId);

            if (!deposit) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Deposit tidak ditemukan',
                    show_alert: true
                });
            }

            if (deposit.externalId) {
                const statusResult = await paymentManager.checkQRISStatus(deposit.externalId);

                if (statusResult.success && statusResult.status === 'success') {
                    await paymentManager.approveDeposit(depositId, 'AUTO_SYSTEM');
                    await userManager.updateBalance(userId, deposit.amount, 'add');

                    return await bot.editMessageText('✅ *PEMBAYARAN BERHASIL!*\n\nSaldo Anda telah ditambahkan.', {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '💳 Lihat Saldo', callback_data: 'menu_balance' },
                                { text: '🔙 Menu Utama', callback_data: 'main_menu' }
                            ]]
                        }
                    });
                }
            }

            await bot.answerCallbackQuery(query.id, {
                text: `Status: ${deposit.status.toUpperCase()}`,
                show_alert: true
            });
        }

        if (action === 'cancel') {
            const depositId = parts[2];
            const deposit = await paymentManager.getDeposit(depositId);

            if (deposit && deposit.externalId) {
                await paymentManager.cancelQRISPayment(deposit.externalId);
            }

            await paymentManager.updateDeposit(depositId, {
                status: 'cancelled',
                cancelledAt: new Date().toISOString()
            });

            await bot.editMessageText('✅ Deposit berhasil dibatalkan.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Kembali', callback_data: 'menu_deposit' }
                    ]]
                }
            });
        }

        if (action === 'history') {
            const deposits = await paymentManager.getUserDeposits(userId);

            if (deposits.length === 0) {
                return await bot.editMessageText('📜 Belum ada riwayat deposit.', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'menu_deposit' }
                        ]]
                    }
                });
            }

            let text = `📜 *RIWAYAT DEPOSIT*\n\n`;
            
            deposits.slice(0, 10).forEach(dep => {
                const statusEmoji = {
                    'pending': '⏳',
                    'completed': '✅',
                    'rejected': '❌',
                    'expired': '⌛',
                    'cancelled': '🚫'
                };

                text += `${statusEmoji[dep.status]} ${formatRupiah(dep.amount)}\n`;
                text += `🆔 ${dep.depositId}\n`;
                text += `📅 ${formatDate(dep.createdAt)}\n`;
                text += `Status: *${dep.status.toUpperCase()}*\n`;
                text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            });

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Kembali', callback_data: 'menu_deposit' }
                    ]]
                }
            });
        }

        if (action === 'custom') {
            setUserState(userId, { waitingFor: 'deposit_custom_amount' });

            await bot.editMessageText(`💰 *NOMINAL CUSTOM*\n\nMasukkan nominal deposit (${formatRupiah(config.MIN_DEPOSIT)} - ${formatRupiah(config.MAX_DEPOSIT)}):`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '❌ Batalkan', callback_data: 'menu_deposit' }
                    ]]
                }
            });
        }

    } catch (error) {
        console.error('Error handling deposit actions:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 💳 PAYMENT ACTIONS HANDLER
async function handlePaymentActions(chatId, messageId, userId, data) {
    try {
        const parts = data.split('_');
        const method = parts[1];
        const productId = parts[2];

        if (method === 'balance') {
            const product = await productManager.getProduct(productId);
            const user = await userManager.getUser(userId);

            if (!product) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Produk tidak ditemukan',
                    show_alert: true
                });
            }

            if (user.balance < product.price) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Saldo tidak mencukupi',
                    show_alert: true
                });
            }

            // Create order
            const orderResult = await orderManager.createOrder({
                userId: userId,
                productId: product.productId,
                productName: product.name,
                amount: product.price,
                paymentMethod: 'BALANCE',
                userInfo: { username: user.username, firstName: user.firstName },
                productInfo: { category: product.category }
            });

            if (!orderResult.success) {
                return await bot.answerCallbackQuery(query.id, {
                    text: '❌ Gagal membuat pesanan',
                    show_alert: true
                });
            }

            // Deduct balance
            await userManager.updateBalance(userId, product.price, 'subtract');

            // Update order to processing (waiting admin approval)
            if (config.BUSINESS.REQUIRE_APPROVAL) {
                await orderManager.updateOrder(orderResult.order.orderId, {
                    paymentStatus: 'paid',
                    status: 'processing'
                });

                await bot.editMessageText('✅ *PEMBAYARAN BERHASIL!*\n\nPesanan Anda sedang diproses.\nMohon tunggu konfirmasi admin.', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📦 Lihat Pesanan', callback_data: `order_detail_${orderResult.order.orderId}` }],
                            [{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]
                        ]
                    }
                });

                // Notify owner
                if (config.NOTIFICATIONS.NOTIFY_OWNER_ON_ORDER) {
                    await sendMessage(config.OWNER_ID, `🔔 *PESANAN BARU!*\n\n📦 ${product.name}\n💰 ${formatRupiah(product.price)}\n👤 User: ${user.username || user.firstName}\n🆔 Order: ${orderResult.order.orderId}\n\nSilakan approve pesanan ini.`);
                }
            } else {
                // Auto complete
                await orderManager.completeOrder(orderResult.order.orderId);
                await productManager.incrementSalesCount(productId);

                await bot.editMessageText('✅ *PEMBAYARAN BERHASIL!*\n\nProduk siap didownload!', {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📥 Download', callback_data: `order_download_${orderResult.order.orderId}` }],
                            [{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]
                        ]
                    }
                });
            }

            // Update user stats
            await userManager.incrementOrderCount(userId);
        }

    } catch (error) {
        console.error('Error handling payment actions:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 💳 BALANCE MENU HANDLER
async function handleBalanceMenu(chatId, messageId, userId) {
    try {
        const user = await userManager.getUser(userId);
        const stats = await userManager.getUserStats(userId);

        let text = `💳 *INFORMASI SALDO*\n\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💰 *Saldo Saat Ini:*\n`;
        text += `${formatRupiah(user.balance)}\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        text += `📊 *Statistik:*\n`;
        text += `📦 Total Pesanan: ${stats.totalOrders}\n`;
        text += `✅ Pesanan Selesai: ${stats.completedOrders}\n`;
        text += `⏳ Pesanan Pending: ${stats.pendingOrders}\n`;
        text += `💸 Total Pengeluaran: ${formatRupiah(stats.totalSpent)}\n`;
        text += `💰 Total Deposit: ${formatRupiah(stats.totalDeposits)}\n\n`;
        text += `📅 Bergabung: ${formatDate(user.joinedAt)}\n`;

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Top Up Saldo', callback_data: 'menu_deposit' }],
                    [{ text: '📜 Riwayat Transaksi', callback_data: 'balance_history' }],
                    [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error handling balance menu:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 👤 PROFILE MENU HANDLER
async function handleProfileMenu(chatId, messageId, userId) {
    try {
        const user = await userManager.getUser(userId);

        let text = `👤 *PROFIL SAYA*\n\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        text += `🆔 *User ID:* \`${user.userId}\`\n`;
        text += `👤 *Username:* @${user.username || 'Tidak ada'}\n`;
        text += `📝 *Nama:* ${user.firstName} ${user.lastName || ''}\n`;
        text += `🎖️ *Role:* ${user.role.toUpperCase()}\n`;
        text += `📊 *Status:* ${user.status.toUpperCase()}\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        text += `💰 *Saldo:* ${formatRupiah(user.balance)}\n`;
        text += `📦 *Total Pesanan:* ${user.statistics?.totalOrders || 0}\n`;
        text += `💸 *Total Belanja:* ${formatRupiah(user.statistics?.totalSpent || 0)}\n\n`;
        text += `📅 *Bergabung:* ${formatDate(user.joinedAt)}\n`;
        text += `🕐 *Aktivitas Terakhir:* ${formatDate(user.lastActivity)}\n`;

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Edit Profil', callback_data: 'profile_edit' }],
                    [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error handling profile menu:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// ❓ HELP MENU HANDLER
async function handleHelpMenu(chatId, messageId, userId) {
    try {
        let text = `❓ *BANTUAN & INFORMASI*\n\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        text += `📌 *Cara Membeli:*\n`;
        text += `1️⃣ Lihat produk di menu Produk Digital\n`;
        text += `2️⃣ Pilih produk yang diinginkan\n`;
        text += `3️⃣ Klik "Beli Sekarang"\n`;
        text += `4️⃣ Pilih metode pembayaran\n`;
        text += `5️⃣ Selesaikan pembayaran\n`;
        text += `6️⃣ Download produk dari menu Pesanan\n\n`;
        text += `💰 *Cara Deposit:*\n`;
        text += `1️⃣ Masuk ke menu Deposit\n`;
        text += `2️⃣ Pilih nominal atau masukkan custom\n`;
        text += `3️⃣ Pilih metode pembayaran\n`;
        text += `4️⃣ Transfer sesuai instruksi\n`;
        text += `5️⃣ Upload bukti transfer (manual) atau tunggu otomatis (QRIS)\n`;
        text += `6️⃣ Saldo akan masuk setelah dikonfirmasi\n\n`;
        text += `📞 *Kontak Support:*\n`;
        text += `💬 Grup: ${config.SUPPORT_GROUP}\n`;
        text += `⭐ Testimoni: ${config.TESTIMONI_CHANNEL}\n\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        text += `⚠️ *Penting:*\n`;
        text += `• Pastikan saldo mencukupi sebelum order\n`;
        text += `• Transfer EXACT sesuai nominal\n`;
        text += `• Simpan bukti transfer\n`;
        text += `• File download hanya bisa diakses setelah order approved\n`;

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💬 Grup Support', url: `https://t.me/${config.SUPPORT_GROUP.replace('@', '')}` },
                        { text: '⭐ Testimoni', url: `https://t.me/${config.TESTIMONI_CHANNEL.replace('@', '')}` }
                    ],
                    [{ text: '🔙 Kembali', callback_data: 'main_menu' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error handling help menu:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 👑 ADMIN PANEL HANDLER
async function handleAdminPanel(chatId, messageId, userId) {
    try {
        const stats = await db.getStats();
        const storageStats = await fileManager.getStorageStats();

        let text = `⚙️ *ADMIN PANEL*\n\n`;
        text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        text += `📊 *Statistik:*\n`;
        text += `👥 Total User: ${stats.totalUsers}\n`;
        text += `📦 Total Produk: ${stats.totalProducts}\n`;
        text += `🛒 Total Pesanan: ${stats.totalOrders}\n`;
        text += `✅ Pesanan Selesai: ${stats.completedOrders}\n`;
        text += `⏳ Pesanan Pending: ${stats.pendingOrders}\n`;
        text += `💰 Total Revenue: ${formatRupiah(stats.totalRevenue)}\n\n`;
        text += `💾 *Storage:*\n`;
        text += `📁 Total Files: ${storageStats.totalFiles}\n`;
        text += `💾 Total Size: ${storageStats.totalSizeFormatted}\n`;
        text += `📊 Available: ${storageStats.availableSpace}\n\n`;
        text += `🕐 *Last Update:* ${formatDate(stats.lastUpdate)}\n`;

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: getAdminMenu()
        });

    } catch (error) {
        console.error('Error handling admin panel:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 👑 ADMIN ACTIONS HANDLER
async function handleAdminActions(chatId, messageId, userId, data) {
    try {
        const parts = data.split('_');
        const section = parts[1];
        const action = parts[2];

        if (section === 'add' && action === 'product') {
            setUserState(userId, { 
                waitingFor: 'admin_add_product_name',
                productData: {}
            });

            await bot.editMessageText('➕ *TAMBAH PRODUK BARU*\n\nMasukkan nama produk:', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '❌ Batalkan', callback_data: 'admin_panel' }
                    ]]
                }
            });
        }

        if (section === 'manage' && action === 'products') {
            const products = await productManager.getAllProducts();

            if (products.length === 0) {
                return await bot.editMessageText('📦 Belum ada produk.', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ Tambah Produk', callback_data: 'admin_add_product' }],
                            [{ text: '🔙 Kembali', callback_data: 'admin_panel' }]
                        ]
                    }
                });
            }

            let text = `📦 *KELOLA PRODUK*\n\n`;
            text += `Total: ${products.length} produk\n\n`;

            const buttons = [];

            products.slice(0, 10).forEach(product => {
                const statusEmoji = product.status === 'active' ? '✅' : '❌';
                text += `${statusEmoji} ${product.name}\n`;
                text += `💰 ${formatRupiah(product.price)} | 📊 Stok: ${product.stock}\n`;
                text += `🛒 Terjual: ${product.totalSales || 0}\n`;
                text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                buttons.push([{
                    text: `✏️ ${product.name.substring(0, 20)}...`,
                    callback_data: `admin_edit_product_${product.productId}`
                }]);
            });

            buttons.push([
                { text: '➕ Tambah Produk', callback_data: 'admin_add_product' }
            ]);
            buttons.push([
                { text: '🔙 Kembali', callback_data: 'admin_panel' }
            ]);

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (section === 'manage' && action === 'orders') {
            const orders = await orderManager.getAllOrders({ status: 'processing' });

            if (orders.length === 0) {
                return await bot.editMessageText('📦 Tidak ada pesanan yang perlu diproses.', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'admin_panel' }
                        ]]
                    }
                });
            }

            let text = `📦 *KELOLA PESANAN*\n\n`;
            text += `⏳ Pending Approval: ${orders.length}\n\n`;

            const buttons = [];

            orders.slice(0, 8).forEach(order => {
                text += `🆔 ${order.orderId}\n`;
                text += `📦 ${order.productName}\n`;
                text += `💰 ${formatRupiah(order.amount)}\n`;
                text += `👤 User: ${order.userId}\n`;
                text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                buttons.push([{
                    text: `📄 ${order.orderId}`,
                    callback_data: `admin_order_detail_${order.orderId}`
                }]);
            });

            buttons.push([
                { text: '🔙 Kembali', callback_data: 'admin_panel' }
            ]);

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (section === 'manage' && action === 'deposits') {
            const deposits = await paymentManager.getAllDeposits({ status: 'pending' });

            if (deposits.length === 0) {
                return await bot.editMessageText('💳 Tidak ada deposit yang perlu diproses.', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'admin_panel' }
                        ]]
                    }
                });
            }

            let text = `💳 *KELOLA DEPOSIT*\n\n`;
            text += `⏳ Pending Approval: ${deposits.length}\n\n`;

            const buttons = [];

            deposits.slice(0, 8).forEach(deposit => {
                text += `🆔 ${deposit.depositId}\n`;
                text += `💰 ${formatRupiah(deposit.amount)}\n`;
                text += `💳 ${deposit.method}\n`;
                text += `👤 User: ${deposit.userId}\n`;
                text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                buttons.push([{
                    text: `💳 ${formatRupiah(deposit.amount)}`,
                    callback_data: `admin_deposit_detail_${deposit.depositId}`
                }]);
            });

            buttons.push([
                { text: '🔙 Kembali', callback_data: 'admin_panel' }
            ]);

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        if (section === 'order' && action === 'detail') {
            const orderId = parts[3];
            const order = await orderManager.getOrder(orderId);

            if (!order) {
                return await bot.editMessageText('❌ Pesanan tidak ditemukan.', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'admin_manage_orders' }
                        ]]
                    }
                });
            }

            const user = await userManager.getUser(order.userId);

            let text = `📦 *DETAIL PESANAN*\n\n`;
            text += `🆔 Order ID: \`${order.orderId}\`\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `📦 Produk: ${order.productName}\n`;
            text += `💰 Total: ${formatRupiah(order.amount)}\n`;
            text += `💳 Metode: ${order.paymentMethod}\n`;
            text += `📊 Status: ${order.status.toUpperCase()}\n\n`;
            text += `👤 *User Info:*\n`;
            text += `ID: \`${user.userId}\`\n`;
            text += `Username: @${user.username || 'N/A'}\n`;
            text += `Nama: ${user.firstName} ${user.lastName || ''}\n\n`;
            text += `📅 Dibuat: ${formatDate(order.createdAt)}\n`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Approve', callback_data: `admin_order_approve_${orderId}` },
                            { text: '❌ Reject', callback_data: `admin_order_reject_${orderId}` }
                        ],
                        [{ text: '🔙 Kembali', callback_data: 'admin_manage_orders' }]
                    ]
                }
            });
        }

        if (section === 'order' && action === 'approve') {
            const orderId = parts[3];
            const result = await orderManager.approveOrder(orderId, userId);

            if (result.success) {
                await orderManager.completeOrder(orderId);
                await productManager.incrementSalesCount(result.order.productId);

                // Notify user
                await sendMessage(result.order.userId, `✅ *PESANAN DISETUJUI!*\n\n🆔 Order: \`${orderId}\`\n📦 ${result.order.productName}\n\nProduk Anda sudah bisa didownload!\nKlik /start untuk mengakses.`);

                await bot.editMessageText(`✅ Pesanan ${orderId} berhasil diapprove!`, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'admin_manage_orders' }
                        ]]
                    }
                });
            }
        }

        if (section === 'order' && action === 'reject') {
            const orderId = parts[3];
            setUserState(userId, {
                waitingFor: 'admin_order_reject_reason',
                orderId: orderId
            });

            await bot.editMessageText('❌ *REJECT ORDER*\n\nMasukkan alasan penolakan:', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Batal', callback_data: `admin_order_detail_${orderId}` }
                    ]]
                }
            });
        }

        if (section === 'deposit' && action === 'detail') {
            const depositId = parts[3];
            const deposit = await paymentManager.getDeposit(depositId);

            if (!deposit) {
                return await bot.editMessageText('❌ Deposit tidak ditemukan.', {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'admin_manage_deposits' }
                        ]]
                    }
                });
            }

            const user = await userManager.getUser(deposit.userId);

            let text = `💳 *DETAIL DEPOSIT*\n\n`;
            text += `🆔 Deposit ID: \`${deposit.depositId}\`\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `💰 Jumlah: ${formatRupiah(deposit.amount)}\n`;
            text += `💳 Metode: ${deposit.method}\n`;
            text += `📊 Status: ${deposit.status.toUpperCase()}\n\n`;
            text += `👤 *User Info:*\n`;
            text += `ID: \`${user.userId}\`\n`;
            text += `Username: @${user.username || 'N/A'}\n`;
            text += `Nama: ${user.firstName} ${user.lastName || ''}\n\n`;
            text += `📅 Dibuat: ${formatDate(deposit.createdAt)}\n`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Approve', callback_data: `admin_deposit_approve_${depositId}` },
                            { text: '❌ Reject', callback_data: `admin_deposit_reject_${depositId}` }
                        ],
                        [{ text: '🔙 Kembali', callback_data: 'admin_manage_deposits' }]
                    ]
                }
            });
        }

        if (section === 'deposit' && action === 'approve') {
            const depositId = parts[3];
            const result = await paymentManager.approveDeposit(depositId, userId);

            if (result.success) {
                await userManager.updateBalance(result.deposit.userId, result.deposit.amount, 'add');
                await userManager.addDepositHistory(result.deposit.userId, result.deposit.amount);

                // Notify user
                await sendMessage(result.deposit.userId, `✅ *DEPOSIT BERHASIL!*\n\n💰 ${formatRupiah(result.deposit.amount)}\n\nSaldo Anda telah ditambahkan.\nKlik /start untuk melihat saldo.`);

                await bot.editMessageText(`✅ Deposit ${depositId} berhasil diapprove!\nSaldo user telah ditambahkan.`, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔙 Kembali', callback_data: 'admin_manage_deposits' }
                        ]]
                    }
                });
            }
        }

        if (section === 'deposit' && action === 'reject') {
            const depositId = parts[3];
            setUserState(userId, {
                waitingFor: 'admin_deposit_reject_reason',
                depositId: depositId
            });

            await bot.editMessageText('❌ *REJECT DEPOSIT*\n\nMasukkan alasan penolakan:', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Batal', callback_data: `admin_deposit_detail_${depositId}` }
                    ]]
                }
            });
        }

        if (section === 'list' && action === 'users') {
            const users = await userManager.getAllUsers();

            let text = `👥 *DAFTAR USER*\n\n`;
            text += `Total: ${users.length} users\n\n`;

            users.slice(0, 15).forEach(user => {
                const statusEmoji = user.status === 'active' ? '✅' : '❌';
                text += `${statusEmoji} ${user.firstName || user.username}\n`;
                text += `🆔 \`${user.userId}\`\n`;
                text += `💰 ${formatRupiah(user.balance)}\n`;
                text += `📦 Orders: ${user.statistics?.totalOrders || 0}\n`;
                text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            });

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Kembali', callback_data: 'admin_panel' }
                    ]]
                }
            });
        }

        if (section === 'statistics') {
            const stats = await db.getStats();
            const orderStats = await orderManager.getOrderStats();
            const paymentStats = await paymentManager.getPaymentStats();

            let text = `📊 *STATISTIK LENGKAP*\n\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `👥 *Users:*\n`;
            text += `Total: ${stats.totalUsers}\n\n`;
            text += `📦 *Produk:*\n`;
            text += `Total: ${stats.totalProducts}\n\n`;
            text += `🛒 *Orders:*\n`;
            text += `Total: ${orderStats.total}\n`;
            text += `⏳ Pending: ${orderStats.pending}\n`;
            text += `🔄 Processing: ${orderStats.processing}\n`;
            text += `✅ Completed: ${orderStats.completed}\n`;
            text += `❌ Cancelled: ${orderStats.cancelled}\n`;
            text += `💰 Revenue: ${formatRupiah(orderStats.totalRevenue)}\n`;
            text += `📊 Avg Order: ${formatRupiah(orderStats.averageOrderValue)}\n\n`;
            text += `💳 *Deposits:*\n`;
            text += `Total: ${paymentStats.totalDeposits}\n`;
            text += `⏳ Pending: ${paymentStats.pending}\n`;
            text += `✅ Completed: ${paymentStats.completed}\n`;
            text += `❌ Rejected: ${paymentStats.rejected}\n`;
            text += `💰 Total: ${formatRupiah(paymentStats.totalAmount)}\n`;
            text += `📊 Avg Deposit: ${formatRupiah(paymentStats.averageDeposit)}\n\n`;
            text += `🕐 Update: ${formatDate(stats.lastUpdate)}`;

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Refresh', callback_data: 'admin_statistics' }],
                        [{ text: '🔙 Kembali', callback_data: 'admin_panel' }]
                    ]
                }
            });
        }

    } catch (error) {
        console.error('Error handling admin actions:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan.');
    }
}

// 📨 MESSAGE HANDLER
bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return; // Skip commands

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = getUserState(userId);

    try {
        // Rate limit
        const rateLimit = await security.checkRateLimit(userId);
        if (!rateLimit.allowed) {
            return await sendMessage(chatId, `⚠️ Terlalu banyak request. Tunggu ${rateLimit.retryAfter} detik.`);
        }

        // Check access
        const access = await checkUserAccess(userId);
        if (!access.allowed) {
            return await sendMessage(chatId, `❌ ${access.reason}`);
        }

        // HANDLE CUSTOM DEPOSIT AMOUNT
        if (state.waitingFor === 'deposit_custom_amount') {
            const amount = parseInt(msg.text);

            if (!Validator.isValidNumber(amount, config.MIN_DEPOSIT, config.MAX_DEPOSIT)) {
                return await sendMessage(chatId, `❌ Nominal tidak valid!\n\nMin: ${formatRupiah(config.MIN_DEPOSIT)}\nMax: ${formatRupiah(config.MAX_DEPOSIT)}`);
            }

            clearUserState(userId);
            setUserState(userId, { depositAmount: amount });

            let text = `💰 *PILIH METODE PEMBAYARAN*\n\n`;
            text += `💵 *Jumlah Deposit:* ${formatRupiah(amount)}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            text += `Pilih metode pembayaran:`;

            const methods = paymentManager.getPaymentMethods();
            const buttons = [];

            methods.forEach(method => {
                buttons.push([{
                    text: `${method.name}`,
                    callback_data: `deposit_method_${method.code}_${amount}`
                }]);
            });

            buttons.push([
                { text: '🔙 Kembali', callback_data: 'menu_deposit' }
            ]);

            await sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // HANDLE DEPOSIT PROOF UPLOAD
        if (state.waitingFor === 'deposit_proof' && msg.photo) {
            const depositId = state.depositId;
            const photo = msg.photo[msg.photo.length - 1]; // Get highest quality

            await paymentManager.updateDeposit(depositId, {
                proofUrl: photo.file_id,
                status: 'pending'
            });

            clearUserState(userId);

            await sendMessage(chatId, `✅ *BUKTI TRANSFER DITERIMA!*\n\n🆔 Deposit ID: \`${depositId}\`\n\nBukti transfer Anda sedang diverifikasi oleh admin.\nMohon tunggu konfirmasi.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📜 Cek Status', callback_data: 'deposit_history' }],
                        [{ text: '🔙 Menu Utama', callback_data: 'main_menu' }]
                    ]
                }
            });

            // Notify admin
            const deposit = await paymentManager.getDeposit(depositId);
            await bot.sendPhoto(config.OWNER_ID, photo.file_id, {
                caption: `🔔 *BUKTI TRANSFER BARU!*\n\n💰 ${formatRupiah(deposit.amount)}\n🆔 ${depositId}\n👤 User: ${userId}\n\nSilakan approve/reject deposit ini.`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Approve', callback_data: `admin_deposit_approve_${depositId}` },
                        { text: '❌ Reject', callback_data: `admin_deposit_reject_${depositId}` }
                    ]]
                }
            });
        }

        // HANDLE ADMIN ADD PRODUCT - NAME
        if (state.waitingFor === 'admin_add_product_name') {
            const productName = msg.text;

            if (!Validator.isValidProductName(productName)) {
                return await sendMessage(chatId, '❌ Nama produk tidak valid! (Min 3, Max 100 karakter)');
            }

            state.productData.name = productName;
            state.waitingFor = 'admin_add_product_description';
            setUserState(userId, state);

            await sendMessage(chatId, '📝 Masukkan deskripsi produk:');
        }

        // HANDLE ADMIN ADD PRODUCT - DESCRIPTION
        else if (state.waitingFor === 'admin_add_product_description') {
            const description = msg.text;

            if (!Validator.isValidLength(description, 10, 1000)) {
                return await sendMessage(chatId, '❌ Deskripsi tidak valid! (Min 10, Max 1000 karakter)');
            }

            state.productData.description = description;
            state.waitingFor = 'admin_add_product_price';
            setUserState(userId, state);

            await sendMessage(chatId, `💰 Masukkan harga produk (Min ${formatRupiah(100)}):`);
        }

        // HANDLE ADMIN ADD PRODUCT - PRICE
        else if (state.waitingFor === 'admin_add_product_price') {
            const price = parseInt(msg.text);

            if (!Validator.isValidPrice(price)) {
                return await sendMessage(chatId, `❌ Harga tidak valid! (Min ${formatRupiah(100)})`);
            }

            state.productData.price = price;
            state.waitingFor = 'admin_add_product_category';
            setUserState(userId, state);

            const categories = ['ebook', 'software', 'template', 'course', 'music', 'video', 'photo', 'document', 'other'];

            await sendMessage(chatId, `🏷️ Pilih kategori:\n\n${categories.join(', ')}\n\nKetik salah satu kategori:`);
        }

        // HANDLE ADMIN ADD PRODUCT - CATEGORY
        else if (state.waitingFor === 'admin_add_product_category') {
            const category = msg.text.toLowerCase();

            if (!Validator.isValidCategory(category)) {
                return await sendMessage(chatId, '❌ Kategori tidak valid!');
            }

            state.productData.category = category;
            state.waitingFor = 'admin_add_product_stock';
            setUserState(userId, state);

            await sendMessage(chatId, '📊 Masukkan jumlah stok (atau 999 untuk unlimited):');
        }

        // HANDLE ADMIN ADD PRODUCT - STOCK
        else if (state.waitingFor === 'admin_add_product_stock') {
            const stock = parseInt(msg.text);

            if (!Validator.isValidStock(stock)) {
                return await sendMessage(chatId, '❌ Stok tidak valid!');
            }

            state.productData.stock = stock;
            state.productData.sellerId = userId;

            // Create product
            const result = await productManager.createProduct(state.productData);

            if (result.success) {
                state.productId = result.product.productId;
                state.waitingFor = 'admin_add_product_files';
                setUserState(userId, state);

                await sendMessage(chatId, `✅ *PRODUK BERHASIL DIBUAT!*\n\n📦 ${result.product.name}\n🆔 ${result.product.productId}\n\n📁 Sekarang kirim file produk (dokumen/arsip).\nKirim /done jika selesai.`, {
                    parse_mode: 'Markdown'
                });
            } else {
                clearUserState(userId);
                await sendMessage(chatId, `❌ Gagal membuat produk: ${result.message}`);
            }
        }

        // HANDLE ADMIN ADD PRODUCT - FILES
        else if (state.waitingFor === 'admin_add_product_files' && msg.document) {
            const productId = state.productId;
            const document = msg.document;

            await sendMessage(chatId, '⏳ Mengupload file...');

            try {
                const file = await bot.getFile(document.file_id);
                const fileUrl = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
                
                const axios = require('axios');
                const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
                const fileBuffer = Buffer.from(response.data);

                const result = await productManager.addFileToProduct(productId, fileBuffer, document.file_name);

                if (result.success) {
                    await sendMessage(chatId, `✅ File berhasil diupload!\n📁 ${document.file_name}\n💾 ${fileManager.formatSize(result.fileInfo.size)}\n\nKirim file lain atau /done jika selesai.`);
                } else {
                    await sendMessage(chatId, `❌ Gagal upload file: ${result.message}`);
                }

            } catch (error) {
                console.error('Error uploading file:', error.message);
                await sendMessage(chatId, '❌ Gagal mengupload file. Pastikan ukuran tidak melebihi 2GB.');
            }
        }

        // HANDLE ADMIN ORDER REJECT REASON
        else if (state.waitingFor === 'admin_order_reject_reason') {
            const orderId = state.orderId;
            const reason = msg.text;

            const result = await orderManager.rejectOrder(orderId, reason, userId);

            if (result.success) {
                // Refund user
                await userManager.updateBalance(result.order.userId, result.order.amount, 'add');

                // Notify user
                await sendMessage(result.order.userId, `❌ *PESANAN DITOLAK*\n\n🆔 Order: \`${orderId}\`\n\n📝 Alasan: ${reason}\n\n💰 Saldo telah dikembalikan.`, {
                    parse_mode: 'Markdown'
                });

                await sendMessage(chatId, `✅ Pesanan ${orderId} berhasil ditolak.\nSaldo user telah dikembalikan.`);
            } else {
                await sendMessage(chatId, `❌ Gagal menolak pesanan: ${result.message}`);
            }

            clearUserState(userId);
        }

        // HANDLE ADMIN DEPOSIT REJECT REASON
        else if (state.waitingFor === 'admin_deposit_reject_reason') {
            const depositId = state.depositId;
            const reason = msg.text;

            const result = await paymentManager.rejectDeposit(depositId, reason, userId);

            if (result.success) {
                // Notify user
                await sendMessage(result.deposit.userId, `❌ *DEPOSIT DITOLAK*\n\n🆔 Deposit: \`${depositId}\`\n💰 ${formatRupiah(result.deposit.amount)}\n\n📝 Alasan: ${reason}`, {
                    parse_mode: 'Markdown'
                });

                await sendMessage(chatId, `✅ Deposit ${depositId} berhasil ditolak.`);
            } else {
                await sendMessage(chatId, `❌ Gagal menolak deposit: ${result.message}`);
            }

            clearUserState(userId);
        }

    } catch (error) {
        console.error('Error handling message:', error.message);
        await sendMessage(chatId, '❌ Terjadi kesalahan. Silakan coba lagi.');
    }
});

// 🔚 /done COMMAND
bot.onText(/\/done/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = getUserState(userId);

    if (state.waitingFor === 'admin_add_product_files') {
        const productId = state.productId;
        const product = await productManager.getProduct(productId);

        clearUserState(userId);

        await sendMessage(chatId, `✅ *PRODUK SELESAI!*\n\n📦 ${product.name}\n💰 ${formatRupiah(product.price)}\n📁 ${product.files.length} file\n💾 ${fileManager.formatSize(product.metadata.fileSize)}\n\nProduk sudah aktif dan bisa dibeli!`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📦 Lihat Produk', callback_data: `product_view_${productId}` }],
                    [{ text: '⚙️ Admin Panel', callback_data: 'admin_panel' }]
                ]
            }
        });
    }
});

// 🚀 BOT READY
console.log('✅ Bot is running!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');