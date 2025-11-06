const DatabaseManager = require('../utils/database');
const FileManager = require('../utils/fileManager');
const Validator = require('../utils/validator');
const SecurityManager = require('../utils/security');
const config = require('../config');

class ProductManager {
    constructor() {
        this.db = new DatabaseManager();
        this.fileManager = new FileManager();
        this.security = new SecurityManager();
    }

    // ➕ CREATE PRODUCT
    async createProduct(productData) {
        try {
            // Validate
            const validation = Validator.validateSchema(productData, {
                name: { required: true, type: 'string', minLength: 3, maxLength: 100 },
                description: { required: true, type: 'string', minLength: 10, maxLength: 1000 },
                price: { required: true, type: 'number', min: 100 },
                category: { required: true, type: 'string' },
                sellerId: { required: true, type: 'number' }
            });

            if (!validation.valid) {
                throw new Error(validation.errors.join(', '));
            }

            const product = {
                productId: this.security.generateSecureToken(16),
                name: Validator.sanitize(productData.name),
                description: Validator.sanitize(productData.description),
                price: productData.price,
                category: productData.category.toLowerCase(),
                sellerId: productData.sellerId,
                stock: productData.stock || 999,
                status: 'active',
                files: [],
                images: [],
                totalSales: 0,
                totalViews: 0,
                rating: 0,
                reviews: [],
                metadata: {
                    fileSize: 0,
                    fileCount: 0,
                    version: '1.0',
                    lastUpdate: new Date().toISOString()
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await this.db.insert('products', product);
            console.log(`✅ Product created: ${product.name} (${product.productId})`);

            return { success: true, product: product };

        } catch (error) {
            console.error('Error creating product:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 📝 UPDATE PRODUCT
    async updateProduct(productId, updates) {
        try {
            // Sanitize updates
            if (updates.name) updates.name = Validator.sanitize(updates.name);
            if (updates.description) updates.description = Validator.sanitize(updates.description);
            
            updates.updatedAt = new Date().toISOString();

            const success = await this.db.update('products', { productId: productId }, updates);
            
            if (success) {
                console.log(`✅ Product updated: ${productId}`);
            }

            return success;

        } catch (error) {
            console.error('Error updating product:', error.message);
            return false;
        }
    }

    // 🗑️ DELETE PRODUCT
    async deleteProduct(productId) {
        try {
            // Delete files first
            await this.fileManager.deleteProductFiles(productId);

            // Delete from database
            const success = await this.db.delete('products', { productId: productId });

            if (success) {
                console.log(`🗑️ Product deleted: ${productId}`);
            }

            return success;

        } catch (error) {
            console.error('Error deleting product:', error.message);
            return false;
        }
    }

    // 🔍 GET PRODUCT
    async getProduct(productId) {
        try {
            return await this.db.findOne('products', { productId: productId });
        } catch (error) {
            console.error('Error getting product:', error.message);
            return null;
        }
    }

    // 📋 GET ALL PRODUCTS
    async getAllProducts(filters = {}) {
        try {
            let products = await this.db.readData('products');

            // Apply filters
            if (filters.status) {
                products = products.filter(p => p.status === filters.status);
            }

            if (filters.category) {
                products = products.filter(p => p.category === filters.category);
            }

            if (filters.sellerId) {
                products = products.filter(p => p.sellerId === filters.sellerId);
            }

            if (filters.minPrice) {
                products = products.filter(p => p.price >= filters.minPrice);
            }

            if (filters.maxPrice) {
                products = products.filter(p => p.price <= filters.maxPrice);
            }

            // Sort
            if (filters.sortBy) {
                products.sort((a, b) => {
                    if (filters.sortBy === 'price_asc') return a.price - b.price;
                    if (filters.sortBy === 'price_desc') return b.price - a.price;
                    if (filters.sortBy === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
                    if (filters.sortBy === 'popular') return b.totalSales - a.totalSales;
                    return 0;
                });
            }

            return products;

        } catch (error) {
            console.error('Error getting products:', error.message);
            return [];
        }
    }

    // 🔍 SEARCH PRODUCTS
    async searchProducts(query) {
        try {
            const products = await this.getAllProducts({ status: 'active' });
            const searchTerm = query.toLowerCase();

            return products.filter(product => 
                product.name.toLowerCase().includes(searchTerm) ||
                product.description.toLowerCase().includes(searchTerm) ||
                product.category.toLowerCase().includes(searchTerm)
            );

        } catch (error) {
            console.error('Error searching products:', error.message);
            return [];
        }
    }

    // 📁 ADD FILE TO PRODUCT
    async addFileToProduct(productId, fileBuffer, fileName) {
        try {
            const product = await this.getProduct(productId);
            if (!product) throw new Error('Product not found');

            // Save file
            const fileInfo = await this.fileManager.saveFile(fileBuffer, fileName, productId);

            // Update product
            product.files = product.files || [];
            product.files.push(fileInfo);

            product.metadata.fileSize = (product.metadata.fileSize || 0) + fileInfo.size;
            product.metadata.fileCount = product.files.length;

            await this.updateProduct(productId, {
                files: product.files,
                metadata: product.metadata
            });

            console.log(`📁 File added to product: ${productId}`);
            return { success: true, fileInfo: fileInfo };

        } catch (error) {
            console.error('Error adding file to product:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 🖼️ ADD IMAGE TO PRODUCT
    async addImageToProduct(productId, imageBuffer, imageName) {
        try {
            const product = await this.getProduct(productId);
            if (!product) throw new Error('Product not found');

            const imageInfo = await this.fileManager.saveFile(imageBuffer, imageName, productId);

            product.images = product.images || [];
            product.images.push(imageInfo);

            await this.updateProduct(productId, { images: product.images });

            console.log(`🖼️ Image added to product: ${productId}`);
            return { success: true, imageInfo: imageInfo };

        } catch (error) {
            console.error('Error adding image to product:', error.message);
            return { success: false, message: error.message };
        }
    }

    // 📊 INCREMENT VIEW COUNT
    async incrementViewCount(productId) {
        try {
            const product = await this.getProduct(productId);
            if (!product) return false;

            await this.updateProduct(productId, {
                totalViews: (product.totalViews || 0) + 1
            });

            return true;
        } catch (error) {
            console.error('Error incrementing view count:', error.message);
            return false;
        }
    }

    // 💰 INCREMENT SALES COUNT
    async incrementSalesCount(productId) {
        try {
            const product = await this.getProduct(productId);
            if (!product) return false;

            const newStock = Math.max(0, (product.stock || 0) - 1);

            await this.updateProduct(productId, {
                totalSales: (product.totalSales || 0) + 1,
                stock: newStock
            });

            return true;
        } catch (error) {
            console.error('Error incrementing sales count:', error.message);
            return false;
        }
    }

    // 🎯 GET PRODUCT CATEGORIES
    async getCategories() {
        try {
            const products = await this.getAllProducts();
            const categories = [...new Set(products.map(p => p.category))];
            
            return categories.map(cat => ({
                name: cat,
                count: products.filter(p => p.category === cat).length
            }));

        } catch (error) {
            console.error('Error getting categories:', error.message);
            return [];
        }
    }

    // 📊 GET PRODUCT STATS
    async getProductStats(productId) {
        try {
            const product = await this.getProduct(productId);
            if (!product) return null;

            const orders = await this.db.findMany('orders', { productId: productId });

            return {
                productId: product.productId,
                name: product.name,
                totalViews: product.totalViews || 0,
                totalSales: product.totalSales || 0,
                totalOrders: orders.length,
                completedOrders: orders.filter(o => o.status === 'completed').length,
                revenue: orders
                    .filter(o => o.status === 'completed')
                    .reduce((sum, o) => sum + o.amount, 0),
                rating: product.rating || 0,
                reviewCount: product.reviews?.length || 0,
                stock: product.stock,
                status: product.status
            };

        } catch (error) {
            console.error('Error getting product stats:', error.message);
            return null;
        }
    }

    // ✅ CHECK STOCK
    async checkStock(productId, quantity = 1) {
        try {
            const product = await this.getProduct(productId);
            if (!product) return false;

            return product.stock >= quantity;
        } catch (error) {
            console.error('Error checking stock:', error.message);
            return false;
        }
    }

    // 🔄 UPDATE STOCK
    async updateStock(productId, quantity, operation = 'set') {
        try {
            const product = await this.getProduct(productId);
            if (!product) throw new Error('Product not found');

            let newStock = product.stock || 0;

            if (operation === 'add') {
                newStock += quantity;
            } else if (operation === 'subtract') {
                newStock = Math.max(0, newStock - quantity);
            } else if (operation === 'set') {
                newStock = quantity;
            }

            await this.updateProduct(productId, { stock: newStock });

            return { success: true, newStock: newStock };

        } catch (error) {
            console.error('Error updating stock:', error.message);
            return { success: false, message: error.message };
        }
    }
}

module.exports = ProductManager;