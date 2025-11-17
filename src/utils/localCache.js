import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cache directory
const CACHE_DIR = path.join(__dirname, '../../cache');

/**
 * Local Cache Service
 * Stores API responses to local files when database is unavailable
 */
export class LocalCache {
  constructor() {
    this.cacheDir = CACHE_DIR;
  }

  /**
   * Ensure cache directory exists
   */
  async ensureCacheDir() {
    try {
      await fs.access(this.cacheDir);
    } catch {
      await fs.mkdir(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Get cache file path for a user and data type
   */
  getCacheFilePath(userId, dataType) {
    const fileName = `${userId}_${dataType}.json`;
    return path.join(this.cacheDir, fileName);
  }

  /**
   * Save data to cache
   */
  async save(userId, dataType, data) {
    try {
      await this.ensureCacheDir();
      const filePath = this.getCacheFilePath(userId, dataType);
      
      const cacheData = {
        userId,
        dataType,
        data,
        cachedAt: new Date().toISOString(),
      };
      
      await fs.writeFile(filePath, JSON.stringify(cacheData, null, 2), 'utf-8');
      console.log(`Cached ${dataType} for user ${userId} to ${filePath}`);
      return filePath;
    } catch (error) {
      console.error(`Error saving cache for ${dataType}:`, error);
      throw error;
    }
  }

  /**
   * Load data from cache
   */
  async load(userId, dataType) {
    try {
      const filePath = this.getCacheFilePath(userId, dataType);
      const content = await fs.readFile(filePath, 'utf-8');
      const cacheData = JSON.parse(content);
      return cacheData.data;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null; // Cache file doesn't exist
      }
      console.error(`Error loading cache for ${dataType}:`, error);
      throw error;
    }
  }

  /**
   * Append data to cache (for lists like tracks)
   */
  async append(userId, dataType, newData) {
    try {
      const existing = await this.load(userId, dataType) || [];
      const updated = Array.isArray(existing) 
        ? [...existing, ...(Array.isArray(newData) ? newData : [newData])]
        : [newData];
      
      await this.save(userId, dataType, updated);
      return updated;
    } catch (error) {
      console.error(`Error appending to cache for ${dataType}:`, error);
      throw error;
    }
  }

  /**
   * List all cache files for a user
   */
  async listUserCaches(userId) {
    try {
      await this.ensureCacheDir();
      const files = await fs.readdir(this.cacheDir);
      return files.filter(file => file.startsWith(`${userId}_`));
    } catch (error) {
      console.error(`Error listing caches for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Load all cached data for a user
   */
  async loadAll(userId) {
    try {
      const files = await this.listUserCaches(userId);
      const data = {};
      
      for (const file of files) {
        const dataType = file.replace(`${userId}_`, '').replace('.json', '');
        data[dataType] = await this.load(userId, dataType);
      }
      
      return data;
    } catch (error) {
      console.error(`Error loading all caches for user ${userId}:`, error);
      return {};
    }
  }

  /**
   * Delete cache for a user and data type
   */
  async delete(userId, dataType) {
    try {
      const filePath = this.getCacheFilePath(userId, dataType);
      await fs.unlink(filePath);
      console.log(`Deleted cache ${dataType} for user ${userId}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`Error deleting cache for ${dataType}:`, error);
        throw error;
      }
    }
  }

  /**
   * Check if database is available
   */
  static async checkDatabaseAvailable(prisma) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.warn('Database not available, will use local cache:', error.message);
      return false;
    }
  }
}

export default LocalCache;

