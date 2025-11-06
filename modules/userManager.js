const DatabaseManager = require('../utils/database');
const SecurityManager = require('../utils/security');
const Validator = require('../utils/validator');
const config = require('../config');

class UserManager {
    constructor() {
        this.db = new DatabaseManager();
        this.security = new SecurityManager();
    }

    // ➕ CREATE USER
    async createUser(userData) {
        try {
            // Validate
            if (!Validator.isValidUserId(userData.userId)) {
                throw new Error('Invalid user ID');
            }

            // Check if exists
            const existing = await this.db.findOne('users', { userId: userData.userId });
            if (existing) {
                return { success: false, message: 'User already exists', user: existing };
            }

            const user = {
                userId: userData.userId,
                username: userData.username || 'Unknown',
                firstName: userData.firstName || '',
                lastName: userData.lastName || '',
                role: 'user',
                balance: 0,
                totalSpent: 0,
                totalOrders: 0,
                status: 'active',
                isBlocked: false,
                isBanned: false,
                verificationLevel: 0,
                joinedAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                metadata: {
                    phone: null,
                    email: null,
                    address: null,
                    preferences: {}
                },
                statistics: {
                    totalDeposits: 0,
                    totalOrders: 0,
                    totalSpent: 0,
                    completedOrders: 0,
                    cancelledOrders: 0
                }
            };

            await this.db.insert('users', user);
            console.log(`✅ New user created: ${user.userId}`);

            return { success: true, message: 'User created', user: user };

        } catch (error) {
            console.error('Error creating user:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🔍 GET USER
    async getUser(userId) {
        try {
            const user = await this.db.findOne('users', { userId: userId });
            return user;
        } catch (error) {
            console.error('Error getting user:', error.message);
            return null;
        }
    }

    // 🔄 UPDATE USER
    async updateUser(userId, updates) {
        try {
            updates.lastActivity = new Date().toISOString();
            const success = await this.db.update('users', { userId: userId }, updates);
            
            if (success) {
                console.log(`✅ User updated: ${userId}`);
            }

            return success;
        } catch (error) {
            console.error('Error updating user:', error.message);
            return false;
        }
    }

    // 💰 UPDATE BALANCE
    async updateBalance(userId, amount, type = 'add') {
        try {
            const user = await this.getUser(userId);
            if (!user) throw new Error('User not found');

            let newBalance = user.balance;

            if (type === 'add') {
                newBalance += amount;
            } else if (type === 'subtract') {
                if (user.balance < amount) {
                    throw new Error('Insufficient balance');
                }
                newBalance -= amount;
            } else if (type === 'set') {
                newBalance = amount;
            }

            await this.updateUser(userId, { balance: newBalance });
            console.log(`💰 Balance updated: ${userId} - ${type} ${amount}`);

            return { success: true, newBalance: newBalance };

        } catch (error) {
            console.error('Error updating balance:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🚫 BLOCK USER
    async blockUser(userId, reason) {
        try {
            await this.updateUser(userId, {
                isBlocked: true,
                blockReason: reason,
                blockedAt: new Date().toISOString()
            });

            this.security.blockUser(userId, reason);
            console.log(`🚫 User blocked: ${userId}`);

            return true;
        } catch (error) {
            console.error('Error blocking user:', error.message);
            return false;
        }
    }

    // ✅ UNBLOCK USER
    async unblockUser(userId) {
        try {
            await this.updateUser(userId, {
                isBlocked: false,
                blockReason: null,
                blockedAt: null
            });

            console.log(`✅ User unblocked: ${userId}`);
            return true;
        } catch (error) {
            console.error('Error unblocking user:', error.message);
            return false;
        }
    }

    // 📊 GET USER STATS
    async getUserStats(userId) {
        try {
            const user = await this.getUser(userId);
            if (!user) return null;

            const orders = await this.db.findMany('orders', { userId: userId });
            const deposits = await this.db.findMany('deposits', { userId: userId });

            const completedOrders = orders.filter(o => o.status === 'completed');
            const totalSpent = completedOrders.reduce((sum, o) => sum + o.amount, 0);
            const totalDeposits = deposits
                .filter(d => d.status === 'completed')
                .reduce((sum, d) => sum + d.amount, 0);

            return {
                userId: user.userId,
                username: user.username,
                balance: user.balance,
                totalOrders: orders.length,
                completedOrders: completedOrders.length,
                pendingOrders: orders.filter(o => o.status === 'pending').length,
                totalSpent: totalSpent,
                totalDeposits: totalDeposits,
                joinedAt: user.joinedAt,
                lastActivity: user.lastActivity,
                status: user.status
            };

        } catch (error) {
            console.error('Error getting user stats:', error.message);
            return null;
        }
    }

    // 📋 GET ALL USERS
    async getAllUsers() {
        try {
            return await this.db.readData('users');
        } catch (error) {
            console.error('Error getting all users:', error.message);
            return [];
        }
    }

    // 🔍 SEARCH USERS
    async searchUsers(query) {
        try {
            const users = await this.getAllUsers();
            const searchTerm = query.toLowerCase();

            return users.filter(user => 
                user.username.toLowerCase().includes(searchTerm) ||
                user.userId.toString().includes(searchTerm) ||
                (user.firstName && user.firstName.toLowerCase().includes(searchTerm))
            );

        } catch (error) {
            console.error('Error searching users:', error.message);
            return [];
        }
    }

    // ✅ CHECK USER EXISTS
    async userExists(userId) {
        const user = await this.getUser(userId);
        return user !== null;
    }

    // 🔐 CHECK USER ACCESS
    async checkUserAccess(userId) {
        const user = await this.getUser(userId);
        
        if (!user) {
            return { allowed: false, reason: 'User not found' };
        }

        if (user.isBlocked) {
            return { allowed: false, reason: 'User is blocked' };
        }

        if (user.isBanned) {
            return { allowed: false, reason: 'User is banned' };
        }

        if (this.security.isBlocked(userId)) {
            return { allowed: false, reason: 'Temporarily blocked' };
        }

        return { allowed: true };
    }

    // 👑 CHECK IS OWNER
    isOwner(userId) {
        return userId === config.OWNER_ID;
    }

    // 📈 INCREMENT ORDER COUNT
    async incrementOrderCount(userId) {
        try {
            const user = await this.getUser(userId);
            if (!user) return false;

            await this.updateUser(userId, {
                'statistics.totalOrders': (user.statistics?.totalOrders || 0) + 1
            });

            return true;
        } catch (error) {
            console.error('Error incrementing order count:', error.message);
            return false;
        }
    }

    // 💳 ADD DEPOSIT HISTORY
    async addDepositHistory(userId, amount) {
        try {
            const user = await this.getUser(userId);
            if (!user) return false;

            await this.updateUser(userId, {
                'statistics.totalDeposits': (user.statistics?.totalDeposits || 0) + amount
            });

            return true;
        } catch (error) {
            console.error('Error adding deposit history:', error.message);
            return false;
        }
    }
}

module.exports = UserManager;