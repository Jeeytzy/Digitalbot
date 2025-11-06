const DatabaseManager = require('../utils/database');
const SecurityManager = require('../utils/security');
const FileManager = require('../utils/fileManager');
const config = require('../config');

class OrderManager {
    constructor() {
        this.db = new DatabaseManager();
        this.security = new SecurityManager();
        this.fileManager = new FileManager();
    }

    // ➕ CREATE ORDER
    async createOrder(orderData) {
        try {
            const order = {
                orderId: this.security.generateOrderId(),
                userId: orderData.userId,
                productId: orderData.productId,
                productName: orderData.productName,
                amount: orderData.amount,
                quantity: orderData.quantity || 1,
                paymentMethod: orderData.paymentMethod,
                status: 'pending',
                paymentStatus: 'unpaid',
                deliveryStatus: 'pending',
                notes: orderData.notes || '',
                metadata: {
                    userInfo: orderData.userInfo || {},
                    productInfo: orderData.productInfo || {},
                    paymentInfo: {}
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 3600000).toISOString() // 1 hour
            };

            await this.db.insert('orders', order);
            console.log(`✅ Order created: ${order.orderId}`);

            return { success: true, order: order };

        } catch (error) {
            console.error('Error creating order:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🔄 UPDATE ORDER
    async updateOrder(orderId, updates) {
        try {
            updates.updatedAt = new Date().toISOString();
            const success = await this.db.update('orders', { orderId: orderId }, updates);
            
            if (success) {
                console.log(`✅ Order updated: ${orderId}`);
            }

            return success;

        } catch (error) {
            console.error('Error updating order:', error.message);
            return false;
        }
    }

    // 🔍 GET ORDER
    async getOrder(orderId) {
        try {
            return await this.db.findOne('orders', { orderId: orderId });
        } catch (error) {
            console.error('Error getting order:', error.message);
            return null;
        }
    }

    // 📋 GET USER ORDERS
    async getUserOrders(userId, filters = {}) {
        try {
            let orders = await this.db.findMany('orders', { userId: userId });

            if (filters.status) {
                orders = orders.filter(o => o.status === filters.status);
            }

            if (filters.paymentStatus) {
                orders = orders.filter(o => o.paymentStatus === filters.paymentStatus);
            }

            // Sort by newest
            orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            return orders;

        } catch (error) {
            console.error('Error getting user orders:', error.message);
            return [];
        }
    }

    // 📋 GET ALL ORDERS
    async getAllOrders(filters = {}) {
        try {
            let orders = await this.db.readData('orders');

            if (filters.status) {
                orders = orders.filter(o => o.status === filters.status);
            }

            if (filters.paymentStatus) {
                orders = orders.filter(o => o.paymentStatus === filters.paymentStatus);
            }

            if (filters.userId) {
                orders = orders.filter(o => o.userId === filters.userId);
            }

            if (filters.productId) {
                orders = orders.filter(o => o.productId === filters.productId);
            }

            // Sort by newest
            orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            return orders;

        } catch (error) {
            console.error('Error getting all orders:', error.message);
            return [];
        }
    }

    // ✅ APPROVE ORDER
    async approveOrder(orderId, approvedBy) {
        try {
            const order = await this.getOrder(orderId);
            if (!order) throw new Error('Order not found');

            if (order.status !== 'pending') {
                throw new Error('Order cannot be approved');
            }

            await this.updateOrder(orderId, {
                status: 'processing',
                paymentStatus: 'paid',
                approvedBy: approvedBy,
                approvedAt: new Date().toISOString()
            });

            console.log(`✅ Order approved: ${orderId}`);
            return { success: true, order: order };

        } catch (error) {
            console.error('Error approving order:', error.message);
            return { success: false, message: error.message };
        }
    }

    // ❌ REJECT ORDER
    async rejectOrder(orderId, reason, rejectedBy) {
        try {
            const order = await this.getOrder(orderId);
            if (!order) throw new Error('Order not found');

            await this.updateOrder(orderId, {
                status: 'cancelled',
                paymentStatus: 'refunded',
                rejectedBy: rejectedBy,
                rejectionReason: reason,
                rejectedAt: new Date().toISOString()
            });

            console.log(`❌ Order rejected: ${orderId}`);
            return { success: true, order: order };

        } catch (error) {
            console.error('Error rejecting order:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 📦 COMPLETE ORDER
    async completeOrder(orderId) {
        try {
            const order = await this.getOrder(orderId);
            if (!order) throw new Error('Order not found');

            await this.updateOrder(orderId, {
                status: 'completed',
                deliveryStatus: 'delivered',
                completedAt: new Date().toISOString()
            });

            console.log(`✅ Order completed: ${orderId}`);
            return { success: true, order: order };

        } catch (error) {
            console.error('Error completing order:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🗑️ CANCEL ORDER
    async cancelOrder(orderId, reason) {
        try {
            const order = await this.getOrder(orderId);
            if (!order) throw new Error('Order not found');

            if (!['pending', 'processing'].includes(order.status)) {
                throw new Error('Order cannot be cancelled');
            }

            await this.updateOrder(orderId, {
                status: 'cancelled',
                cancellationReason: reason,
                cancelledAt: new Date().toISOString()
            });

            console.log(`🗑️ Order cancelled: ${orderId}`);
            return { success: true, order: order };

        } catch (error) {
            console.error('Error cancelling order:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 📊 GET ORDER STATS
    async getOrderStats(filters = {}) {
        try {
            const orders = await this.getAllOrders(filters);

            const stats = {
                total: orders.length,
                pending: orders.filter(o => o.status === 'pending').length,
                processing: orders.filter(o => o.status === 'processing').length,
                completed: orders.filter(o => o.status === 'completed').length,
                cancelled: orders.filter(o => o.status === 'cancelled').length,
                totalRevenue: orders
                    .filter(o => o.status === 'completed')
                    .reduce((sum, o) => sum + o.amount, 0),
                averageOrderValue: 0
            };

            if (stats.completed > 0) {
                stats.averageOrderValue = Math.round(stats.totalRevenue / stats.completed);
            }

            return stats;

        } catch (error) {
            console.error('Error getting order stats:', error.message);
            return null;
        }
    }

    // 🧹 CLEANUP EXPIRED ORDERS
    async cleanupExpiredOrders() {
        try {
            const orders = await this.db.readData('orders');
            const now = Date.now();
            let cleanedCount = 0;

            for (const order of orders) {
                if (order.status === 'pending' && order.expiresAt) {
                    const expiryTime = new Date(order.expiresAt).getTime();
                    
                    if (now > expiryTime) {
                        await this.cancelOrder(order.orderId, 'Order expired');
                        cleanedCount++;
                    }
                }
            }

            if (cleanedCount > 0) {
                console.log(`🧹 Cleaned ${cleanedCount} expired orders`);
            }

            return cleanedCount;

        } catch (error) {
            console.error('Error cleaning expired orders:', error.message);
            return 0;
        }
    }

    // 📝 ADD ORDER NOTE
    async addOrderNote(orderId, note) {
        try {
            const order = await this.getOrder(orderId);
            if (!order) throw new Error('Order not found');

            order.notes = order.notes || '';
            order.notes += `\n[${new Date().toISOString()}] ${note}`;

            await this.updateOrder(orderId, { notes: order.notes });

            return true;

        } catch (error) {
            console.error('Error adding order note:', error.message);
            return false;
        }
    }

    // 🔍 SEARCH ORDERS
    async searchOrders(query) {
        try {
            const orders = await this.getAllOrders();
            const searchTerm = query.toLowerCase();

            return orders.filter(order => 
                order.orderId.toLowerCase().includes(searchTerm) ||
                order.productName.toLowerCase().includes(searchTerm) ||
                order.userId.toString().includes(searchTerm)
            );

        } catch (error) {
            console.error('Error searching orders:', error.message);
            return [];
        }
    }

    // 📧 GET ORDER RECEIPT
    async getOrderReceipt(orderId) {
        try {
            const order = await this.getOrder(orderId);
            if (!order) throw new Error('Order not found');

            const receipt = {
                orderId: order.orderId,
                date: new Date(order.createdAt).toLocaleString('id-ID'),
                productName: order.productName,
                quantity: order.quantity,
                amount: order.amount,
                paymentMethod: order.paymentMethod,
                status: order.status,
                paymentStatus: order.paymentStatus
            };

            return receipt;

        } catch (error) {
            console.error('Error getting receipt:', error.message);
            return null;
        }
    }
}

module.exports = OrderManager;