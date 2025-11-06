const axios = require('axios');
const DatabaseManager = require('../utils/database');
const SecurityManager = require('../utils/security');
const config = require('../config');

class PaymentManager {
    constructor() {
        this.db = new DatabaseManager();
        this.security = new SecurityManager();
    }

    // 💰 CREATE DEPOSIT
    async createDeposit(depositData) {
        try {
            const deposit = {
                depositId: this.security.generateSecureToken(16),
                userId: depositData.userId,
                amount: depositData.amount,
                method: depositData.method,
                status: 'pending',
                qrUrl: null,
                paymentUrl: null,
                externalId: null,
                metadata: {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 3600000).toISOString() // 1 hour
            };

            // If auto payment (QRIS via CiaaTopUp)
            if (depositData.method === 'QRIS_AUTO') {
                const qrisResult = await this.createQRISPayment(depositData.amount, deposit.depositId);
                
                if (qrisResult.success) {
                    deposit.qrUrl = qrisResult.qrUrl;
                    deposit.paymentUrl = qrisResult.paymentUrl;
                    deposit.externalId = qrisResult.externalId;
                    deposit.metadata = qrisResult.metadata;
                } else {
                    throw new Error('Failed to create QRIS payment');
                }
            }

            await this.db.insert('deposits', deposit);
            console.log(`💰 Deposit created: ${deposit.depositId} - ${deposit.amount}`);

            return { success: true, deposit: deposit };

        } catch (error) {
            console.error('Error creating deposit:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🔄 UPDATE DEPOSIT
    async updateDeposit(depositId, updates) {
        try {
            updates.updatedAt = new Date().toISOString();
            const success = await this.db.update('deposits', { depositId: depositId }, updates);
            
            if (success) {
                console.log(`✅ Deposit updated: ${depositId}`);
            }

            return success;

        } catch (error) {
            console.error('Error updating deposit:', error.message);
            return false;
        }
    }

    // 🔍 GET DEPOSIT
    async getDeposit(depositId) {
        try {
            return await this.db.findOne('deposits', { depositId: depositId });
        } catch (error) {
            console.error('Error getting deposit:', error.message);
            return null;
        }
    }

    // 📋 GET USER DEPOSITS
    async getUserDeposits(userId) {
        try {
            const deposits = await this.db.findMany('deposits', { userId: userId });
            deposits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            return deposits;
        } catch (error) {
            console.error('Error getting user deposits:', error.message);
            return [];
        }
    }

    // 📋 GET ALL DEPOSITS
    async getAllDeposits(filters = {}) {
        try {
            let deposits = await this.db.readData('deposits');

            if (filters.status) {
                deposits = deposits.filter(d => d.status === filters.status);
            }

            if (filters.method) {
                deposits = deposits.filter(d => d.method === filters.method);
            }

            if (filters.userId) {
                deposits = deposits.filter(d => d.userId === filters.userId);
            }

            deposits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            return deposits;

        } catch (error) {
            console.error('Error getting all deposits:', error.message);
            return [];
        }
    }

    // ✅ APPROVE DEPOSIT
    async approveDeposit(depositId, approvedBy) {
        try {
            const deposit = await this.getDeposit(depositId);
            if (!deposit) throw new Error('Deposit not found');

            if (deposit.status !== 'pending') {
                throw new Error('Deposit cannot be approved');
            }

            await this.updateDeposit(depositId, {
                status: 'completed',
                approvedBy: approvedBy,
                approvedAt: new Date().toISOString()
            });

            console.log(`✅ Deposit approved: ${depositId}`);
            return { success: true, deposit: deposit };

        } catch (error) {
            console.error('Error approving deposit:', error.message);
            return { success: false, message: error.message };
        }
    }

    // ❌ REJECT DEPOSIT
    async rejectDeposit(depositId, reason, rejectedBy) {
        try {
            const deposit = await this.getDeposit(depositId);
            if (!deposit) throw new Error('Deposit not found');

            await this.updateDeposit(depositId, {
                status: 'rejected',
                rejectedBy: rejectedBy,
                rejectionReason: reason,
                rejectedAt: new Date().toISOString()
            });

            console.log(`❌ Deposit rejected: ${depositId}`);
            return { success: true, deposit: deposit };

        } catch (error) {
            console.error('Error rejecting deposit:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🏦 CREATE QRIS PAYMENT (CiaaTopUp)
    async createQRISPayment(amount, depositId) {
        try {
            const payload = {
                api_key: config.CIAATOPUP_API_KEY,
                type: 'ewallet',
                nominal: amount,
                cust_no: depositId,
                cust_name: 'Customer'
            };

            const response = await axios.post(config.CIAATOPUP_CREATE_URL, payload, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data && response.data.status === true) {
                return {
                    success: true,
                    qrUrl: response.data.data.qr_url,
                    paymentUrl: response.data.data.checkout_url,
                    externalId: response.data.data.trxid,
                    metadata: response.data.data
                };
            } else {
                throw new Error(response.data?.message || 'Failed to create QRIS payment');
            }

        } catch (error) {
            console.error('Error creating QRIS payment:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🔍 CHECK QRIS PAYMENT STATUS
    async checkQRISStatus(externalId) {
        try {
            const payload = {
                api_key: config.CIAATOPUP_API_KEY,
                trxid: externalId
            };

            const response = await axios.post(config.CIAATOPUP_STATUS_URL, payload, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data) {
                return {
                    success: true,
                    status: response.data.data?.status || 'pending',
                    data: response.data.data
                };
            } else {
                throw new Error('Failed to check status');
            }

        } catch (error) {
            console.error('Error checking QRIS status:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🗑️ CANCEL QRIS PAYMENT
    async cancelQRISPayment(externalId) {
        try {
            const payload = {
                api_key: config.CIAATOPUP_API_KEY,
                trxid: externalId
            };

            const response = await axios.post(config.CIAATOPUP_CANCEL_URL, payload, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data && response.data.status === true) {
                return { success: true };
            } else {
                throw new Error('Failed to cancel payment');
            }

        } catch (error) {
            console.error('Error cancelling QRIS payment:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🔄 AUTO CHECK QRIS PAYMENTS
    async autoCheckQRISPayments() {
        try {
            const pendingDeposits = await this.getAllDeposits({ 
                status: 'pending', 
                method: 'QRIS_AUTO' 
            });

            let checkedCount = 0;
            let completedCount = 0;

            for (const deposit of pendingDeposits) {
                if (!deposit.externalId) continue;

                const statusResult = await this.checkQRISStatus(deposit.externalId);
                checkedCount++;

                if (statusResult.success && statusResult.status === 'success') {
                    await this.updateDeposit(deposit.depositId, {
                        status: 'completed',
                        approvedBy: 'AUTO_SYSTEM',
                        approvedAt: new Date().toISOString(),
                        metadata: { ...deposit.metadata, statusData: statusResult.data }
                    });

                    completedCount++;
                    console.log(`✅ Auto approved deposit: ${deposit.depositId}`);
                }
            }

            if (checkedCount > 0) {
                console.log(`🔄 Checked ${checkedCount} QRIS payments, ${completedCount} completed`);
            }

            return { checkedCount, completedCount };

        } catch (error) {
            console.error('Error auto checking QRIS payments:', error.message);
            return { checkedCount: 0, completedCount: 0 };
        }
    }

    // 💳 CREATE PAYMENT RECORD
    async createPayment(paymentData) {
        try {
            const payment = {
                paymentId: this.security.generateSecureToken(16),
                orderId: paymentData.orderId,
                depositId: paymentData.depositId,
                userId: paymentData.userId,
                amount: paymentData.amount,
                method: paymentData.method,
                status: 'pending',
                proofUrl: paymentData.proofUrl || null,
                metadata: paymentData.metadata || {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await this.db.insert('payments', payment);
            console.log(`💳 Payment created: ${payment.paymentId}`);

            return { success: true, payment: payment };

        } catch (error) {
            console.error('Error creating payment:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 📊 GET PAYMENT STATS
    async getPaymentStats(filters = {}) {
        try {
            const deposits = await this.getAllDeposits(filters);

            const stats = {
                totalDeposits: deposits.length,
                pending: deposits.filter(d => d.status === 'pending').length,
                completed: deposits.filter(d => d.status === 'completed').length,
                rejected: deposits.filter(d => d.status === 'rejected').length,
                totalAmount: deposits
                    .filter(d => d.status === 'completed')
                    .reduce((sum, d) => sum + d.amount, 0),
                averageDeposit: 0
            };

            if (stats.completed > 0) {
                stats.averageDeposit = Math.round(stats.totalAmount / stats.completed);
            }

            return stats;

        } catch (error) {
            console.error('Error getting payment stats:', error.message);
            return null;
        }
    }

    // 🧹 CLEANUP EXPIRED DEPOSITS
    async cleanupExpiredDeposits() {
        try {
            const deposits = await this.db.readData('deposits');
            const now = Date.now();
            let cleanedCount = 0;

            for (const deposit of deposits) {
                if (deposit.status === 'pending' && deposit.expiresAt) {
                    const expiryTime = new Date(deposit.expiresAt).getTime();
                    
                    if (now > expiryTime) {
                        // Cancel QRIS if exists
                        if (deposit.externalId) {
                            await this.cancelQRISPayment(deposit.externalId);
                        }

                        await this.updateDeposit(deposit.depositId, {
                            status: 'expired',
                            expiredAt: new Date().toISOString()
                        });

                        cleanedCount++;
                    }
                }
            }

            if (cleanedCount > 0) {
                console.log(`🧹 Cleaned ${cleanedCount} expired deposits`);
            }

            return cleanedCount;

        } catch (error) {
            console.error('Error cleaning expired deposits:', error.message);
            return 0;
        }
    }

    // 📧 GET PAYMENT METHODS
    getPaymentMethods() {
        const methods = [];

        for (const [key, value] of Object.entries(config.MANUAL_PAYMENT)) {
            if (value.enabled) {
                methods.push({
                    code: key,
                    name: key,
                    ...value
                });
            }
        }

        // Add auto QRIS
        if (config.CIAATOPUP_API_KEY) {
            methods.push({
                code: 'QRIS_AUTO',
                name: 'QRIS (Auto)',
                enabled: true,
                type: 'auto'
            });
        }

        return methods;
    }
}

module.exports = PaymentManager;