const fs = require('fs-extra');
const path = require('path');
const SecurityManager = require('./security');
const config = require('../config');

class DatabaseManager {
    constructor() {
        this.security = new SecurityManager();
        this.dataPath = path.join(__dirname, '../data');
        this.backupPath = path.join(__dirname, '../backups');
        
        this.databases = {
            users: path.join(this.dataPath, 'users.json'),
            products: path.join(this.dataPath, 'products.json'),
            orders: path.join(this.dataPath, 'orders.json'),
            payments: path.join(this.dataPath, 'payments.json'),
            deposits: path.join(this.dataPath, 'deposits.json'),
            logs: path.join(this.dataPath, 'logs.json'),
            stats: path.join(this.dataPath, 'stats.json'),
            sessions: path.join(this.dataPath, 'sessions.json')
        };

        this.cache = new Map();
        this.initDatabase();
        this.startAutoBackup();
    }

    // 🚀 INITIALIZE DATABASE
    async initDatabase() {
        try {
            await fs.ensureDir(this.dataPath);
            await fs.ensureDir(this.backupPath);
            await fs.ensureDir(path.join(__dirname, '../storage/products'));

            for (const [name, filePath] of Object.entries(this.databases)) {
                if (!await fs.pathExists(filePath)) {
                    await this.writeData(name, this.getDefaultData(name));
                    console.log(`✅ Created ${name} database`);
                }
            }

            console.log('✅ Database initialized successfully');
        } catch (error) {
            console.error('❌ Database initialization failed:', error.message);
            throw error;
        }
    }

    // 📝 DEFAULT DATA STRUCTURE
    getDefaultData(dbName) {
        const defaults = {
            users: [],
            products: [],
            orders: [],
            payments: [],
            deposits: [],
            logs: [],
            stats: {
                totalUsers: 0,
                totalProducts: 0,
                totalOrders: 0,
                totalRevenue: 0,
                lastUpdate: new Date().toISOString()
            },
            sessions: []
        };
        return defaults[dbName] || [];
    }

    // 📖 READ DATA
    async readData(dbName) {
        try {
            // Check cache first
            if (this.cache.has(dbName)) {
                return this.cache.get(dbName);
            }

            const filePath = this.databases[dbName];
            if (!filePath) throw new Error(`Database ${dbName} not found`);

            if (!await fs.pathExists(filePath)) {
                return this.getDefaultData(dbName);
            }

            let data = await fs.readJson(filePath);

            // Decrypt if encryption enabled
            if (config.DATABASE.ENCRYPTION && typeof data === 'string') {
                data = JSON.parse(this.security.decrypt(data));
            }

            // Update cache
            this.cache.set(dbName, data);

            return data;
        } catch (error) {
            console.error(`Error reading ${dbName}:`, error.message);
            return this.getDefaultData(dbName);
        }
    }

    // ✍️ WRITE DATA
    async writeData(dbName, data) {
        try {
            const filePath = this.databases[dbName];
            if (!filePath) throw new Error(`Database ${dbName} not found`);

            let saveData = data;

            // Encrypt if enabled
            if (config.DATABASE.ENCRYPTION) {
                saveData = this.security.encrypt(JSON.stringify(data));
            }

            await fs.writeJson(filePath, saveData, { spaces: 2 });

            // Update cache
            this.cache.set(dbName, data);

            return true;
        } catch (error) {
            console.error(`Error writing ${dbName}:`, error.message);
            return false;
        }
    }

    // 🔍 FIND ONE
    async findOne(dbName, query) {
        const data = await this.readData(dbName);
        if (!Array.isArray(data)) return null;

        return data.find(item => {
            return Object.keys(query).every(key => item[key] === query[key]);
        });
    }

    // 🔍 FIND MANY
    async findMany(dbName, query = {}) {
        const data = await this.readData(dbName);
        if (!Array.isArray(data)) return [];

        if (Object.keys(query).length === 0) return data;

        return data.filter(item => {
            return Object.keys(query).every(key => item[key] === query[key]);
        });
    }

    // ➕ INSERT
    async insert(dbName, item) {
        try {
            const data = await this.readData(dbName);
            if (!Array.isArray(data)) throw new Error(`${dbName} is not an array`);

            item.id = item.id || this.generateId();
            item.createdAt = item.createdAt || new Date().toISOString();
            item.updatedAt = new Date().toISOString();

            data.push(item);
            await this.writeData(dbName, data);

            return item;
        } catch (error) {
            console.error(`Error inserting to ${dbName}:`, error.message);
            return null;
        }
    }

    // ✏️ UPDATE
    async update(dbName, query, updates) {
        try {
            const data = await this.readData(dbName);
            if (!Array.isArray(data)) throw new Error(`${dbName} is not an array`);

            let updated = false;
            const newData = data.map(item => {
                const matches = Object.keys(query).every(key => item[key] === query[key]);
                if (matches) {
                    updated = true;
                    return { ...item, ...updates, updatedAt: new Date().toISOString() };
                }
                return item;
            });

            if (updated) {
                await this.writeData(dbName, newData);
            }

            return updated;
        } catch (error) {
            console.error(`Error updating ${dbName}:`, error.message);
            return false;
        }
    }

    // 🗑️ DELETE
    async delete(dbName, query) {
        try {
            const data = await this.readData(dbName);
            if (!Array.isArray(data)) throw new Error(`${dbName} is not an array`);

            const newData = data.filter(item => {
                return !Object.keys(query).every(key => item[key] === query[key]);
            });

            const deleted = data.length !== newData.length;
            if (deleted) {
                await this.writeData(dbName, newData);
            }

            return deleted;
        } catch (error) {
            console.error(`Error deleting from ${dbName}:`, error.message);
            return false;
        }
    }

    // 💾 BACKUP
    async backup(dbName = null) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            
            if (dbName) {
                const data = await this.readData(dbName);
                const backupFile = path.join(this.backupPath, `${dbName}_${timestamp}.json`);
                await fs.writeJson(backupFile, data, { spaces: 2 });
                console.log(`✅ Backup created: ${dbName}`);
            } else {
                for (const name of Object.keys(this.databases)) {
                    const data = await this.readData(name);
                    const backupFile = path.join(this.backupPath, `${name}_${timestamp}.json`);
                    await fs.writeJson(backupFile, data, { spaces: 2 });
                }
                console.log(`✅ Full backup created`);
            }

            await this.cleanOldBackups();
            return true;
        } catch (error) {
            console.error('❌ Backup failed:', error.message);
            return false;
        }
    }

    // 🧹 CLEAN OLD BACKUPS
    async cleanOldBackups() {
        try {
            const files = await fs.readdir(this.backupPath);
            const backups = files
                .filter(f => f.endsWith('.json'))
                .map(f => ({
                    name: f,
                    path: path.join(this.backupPath, f),
                    time: fs.statSync(path.join(this.backupPath, f)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);

            if (backups.length > config.DATABASE.MAX_BACKUP_FILES) {
                const toDelete = backups.slice(config.DATABASE.MAX_BACKUP_FILES);
                for (const backup of toDelete) {
                    await fs.remove(backup.path);
                }
                console.log(`🧹 Cleaned ${toDelete.length} old backups`);
            }
        } catch (error) {
            console.error('Error cleaning backups:', error.message);
        }
    }

    // 🔄 AUTO BACKUP
    startAutoBackup() {
        if (!config.DATABASE.AUTO_BACKUP) return;

        setInterval(async () => {
            await this.backup();
        }, config.DATABASE.BACKUP_INTERVAL);

        console.log('✅ Auto backup enabled');
    }

    // 🆔 GENERATE ID
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // 📊 GET STATS
    async getStats() {
        try {
            const users = await this.readData('users');
            const products = await this.readData('products');
            const orders = await this.readData('orders');
            const payments = await this.readData('payments');

            const completedOrders = orders.filter(o => o.status === 'completed');
            const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

            const stats = {
                totalUsers: users.length,
                totalProducts: products.length,
                totalOrders: orders.length,
                completedOrders: completedOrders.length,
                pendingOrders: orders.filter(o => o.status === 'pending').length,
                totalRevenue: totalRevenue,
                totalPayments: payments.length,
                lastUpdate: new Date().toISOString()
            };

            await this.writeData('stats', stats);
            return stats;
        } catch (error) {
            console.error('Error getting stats:', error.message);
            return null;
        }
    }

    // 🧹 CLEAR CACHE
    clearCache(dbName = null) {
        if (dbName) {
            this.cache.delete(dbName);
        } else {
            this.cache.clear();
        }
    }
}

module.exports = DatabaseManager;