const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');
const mime = require('mime-types');
const config = require('../config');

class FileManager {
    constructor() {
        this.storagePath = path.join(__dirname, '../storage/products');
        this.tempPath = path.join(__dirname, '../storage/temp');
        this.init();
    }

    async init() {
        await fs.ensureDir(this.storagePath);
        await fs.ensureDir(this.tempPath);
        this.startCleanupScheduler();
    }

    // 💾 SAVE FILE
    async saveFile(fileBuffer, fileName, productId) {
        try {
            // Validate file
            const validation = this.validateFile(fileName, fileBuffer.length);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // Generate secure filename
            const ext = path.extname(fileName);
            const secureFileName = `${productId}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
            const productDir = path.join(this.storagePath, productId);
            await fs.ensureDir(productDir);

            const filePath = path.join(productDir, secureFileName);

            // Save file
            await fs.writeFile(filePath, fileBuffer);

            // Get file info
            const stats = await fs.stat(filePath);
            const fileInfo = {
                originalName: fileName,
                savedName: secureFileName,
                path: filePath,
                relativePath: path.relative(this.storagePath, filePath),
                size: stats.size,
                mimeType: mime.lookup(fileName) || 'application/octet-stream',
                extension: ext,
                uploadedAt: new Date().toISOString(),
                checksum: await this.calculateChecksum(filePath)
            };

            console.log(`✅ File saved: ${fileName} (${this.formatSize(stats.size)})`);
            return fileInfo;

        } catch (error) {
            console.error('❌ Error saving file:', error.message);
            throw error;
        }
    }

    // 📖 READ FILE
    async readFile(filePath) {
        try {
            const fullPath = path.isAbsolute(filePath) 
                ? filePath 
                : path.join(this.storagePath, filePath);

            if (!await fs.pathExists(fullPath)) {
                throw new Error('File not found');
            }

            return await fs.readFile(fullPath);
        } catch (error) {
            console.error('❌ Error reading file:', error.message);
            throw error;
        }
    }

    // 🗑️ DELETE FILE
    async deleteFile(filePath) {
        try {
            const fullPath = path.isAbsolute(filePath)
                ? filePath
                : path.join(this.storagePath, filePath);

            if (await fs.pathExists(fullPath)) {
                await fs.remove(fullPath);
                console.log(`🗑️ File deleted: ${filePath}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Error deleting file:', error.message);
            return false;
        }
    }

    // 📁 DELETE PRODUCT FOLDER
    async deleteProductFiles(productId) {
        try {
            const productDir = path.join(this.storagePath, productId);
            if (await fs.pathExists(productDir)) {
                await fs.remove(productDir);
                console.log(`🗑️ Product folder deleted: ${productId}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Error deleting product folder:', error.message);
            return false;
        }
    }

    // ✅ VALIDATE FILE
    validateFile(fileName, fileSize) {
        const ext = path.extname(fileName).toLowerCase();

        // Check extension
        if (!config.STORAGE.ALLOWED_EXTENSIONS.includes(ext)) {
            return {
                valid: false,
                error: `Ekstensi file ${ext} tidak diizinkan`
            };
        }

        // Check size
        if (fileSize > config.STORAGE.MAX_FILE_SIZE) {
            return {
                valid: false,
                error: `Ukuran file melebihi batas maksimal ${this.formatSize(config.STORAGE.MAX_FILE_SIZE)}`
            };
        }

        return { valid: true };
    }

    // 🔐 CALCULATE CHECKSUM
    async calculateChecksum(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);

            stream.on('data', data => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }

    // 📦 COMPRESS FILE/FOLDER
    async compress(sourcePath, outputPath) {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(outputPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => {
                console.log(`✅ Compressed: ${this.formatSize(archive.pointer())}`);
                resolve(outputPath);
            });

            archive.on('error', reject);
            archive.pipe(output);

            if (fs.statSync(sourcePath).isDirectory()) {
                archive.directory(sourcePath, false);
            } else {
                archive.file(sourcePath, { name: path.basename(sourcePath) });
            }

            archive.finalize();
        });
    }

    // 📂 EXTRACT ZIP
    async extract(zipPath, outputDir) {
        try {
            await fs.ensureDir(outputDir);
            await fs.createReadStream(zipPath)
                .pipe(unzipper.Extract({ path: outputDir }))
                .promise();
            
            console.log(`✅ Extracted to: ${outputDir}`);
            return outputDir;
        } catch (error) {
            console.error('❌ Error extracting:', error.message);
            throw error;
        }
    }

    // 📊 GET FILE INFO
    async getFileInfo(filePath) {
        try {
            const fullPath = path.isAbsolute(filePath)
                ? filePath
                : path.join(this.storagePath, filePath);

            if (!await fs.pathExists(fullPath)) {
                return null;
            }

            const stats = await fs.stat(fullPath);
            const fileName = path.basename(fullPath);

            return {
                name: fileName,
                path: fullPath,
                size: stats.size,
                sizeFormatted: this.formatSize(stats.size),
                mimeType: mime.lookup(fileName) || 'application/octet-stream',
                extension: path.extname(fileName),
                createdAt: stats.birthtime,
                modifiedAt: stats.mtime,
                isDirectory: stats.isDirectory(),
                checksum: await this.calculateChecksum(fullPath)
            };
        } catch (error) {
            console.error('❌ Error getting file info:', error.message);
            return null;
        }
    }

    // 📂 LIST FILES IN DIRECTORY
    async listFiles(directory) {
        try {
            const dirPath = path.join(this.storagePath, directory);
            if (!await fs.pathExists(dirPath)) {
                return [];
            }

            const files = await fs.readdir(dirPath);
            const fileInfos = [];

            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stats = await fs.stat(filePath);
                
                fileInfos.push({
                    name: file,
                    path: filePath,
                    relativePath: path.relative(this.storagePath, filePath),
                    size: stats.size,
                    sizeFormatted: this.formatSize(stats.size),
                    isDirectory: stats.isDirectory(),
                    createdAt: stats.birthtime,
                    modifiedAt: stats.mtime
                });
            }

            return fileInfos;
        } catch (error) {
            console.error('❌ Error listing files:', error.message);
            return [];
        }
    }

    // 📏 FORMAT SIZE
    formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    // 📊 GET STORAGE STATS
    async getStorageStats() {
        try {
            const stats = {
                totalSize: 0,
                totalFiles: 0,
                products: {}
            };

            const products = await fs.readdir(this.storagePath);

            for (const productId of products) {
                const productDir = path.join(this.storagePath, productId);
                const productStats = await fs.stat(productDir);

                if (productStats.isDirectory()) {
                    const files = await this.listFiles(productId);
                    const productSize = files.reduce((sum, f) => sum + f.size, 0);

                    stats.products[productId] = {
                        fileCount: files.length,
                        totalSize: productSize,
                        formatted: this.formatSize(productSize)
                    };

                    stats.totalSize += productSize;
                    stats.totalFiles += files.length;
                }
            }

            stats.totalSizeFormatted = this.formatSize(stats.totalSize);
            stats.availableSpace = 'Unlimited';

            return stats;
        } catch (error) {
            console.error('❌ Error getting storage stats:', error.message);
            return null;
        }
    }

    // 🧹 CLEANUP OLD FILES
    async cleanupOldFiles() {
        if (!config.STORAGE.CLEANUP_OLD_FILES) return;

        try {
            const now = Date.now();
            const maxAge = config.STORAGE.CLEANUP_DAYS * 24 * 60 * 60 * 1000;
            let deletedCount = 0;

            const products = await fs.readdir(this.storagePath);

            for (const productId of products) {
                const productDir = path.join(this.storagePath, productId);
                const stats = await fs.stat(productDir);

                if (stats.isDirectory() && (now - stats.mtime.getTime() > maxAge)) {
                    await fs.remove(productDir);
                    deletedCount++;
                }
            }

            if (deletedCount > 0) {
                console.log(`🧹 Cleaned ${deletedCount} old product folders`);
            }
        } catch (error) {
            console.error('❌ Error cleaning old files:', error.message);
        }
    }

    // 🔄 START CLEANUP SCHEDULER
    startCleanupScheduler() {
        if (!config.STORAGE.CLEANUP_OLD_FILES) return;

        // Run cleanup every 24 hours
        setInterval(() => {
            this.cleanupOldFiles();
        }, 86400000);

        console.log('✅ File cleanup scheduler started');
    }

    // 🗑️ CLEAR TEMP FILES
    async clearTempFiles() {
        try {
            await fs.emptyDir(this.tempPath);
            console.log('🧹 Temp files cleared');
        } catch (error) {
            console.error('❌ Error clearing temp files:', error.message);
        }
    }
}

module.exports = FileManager;