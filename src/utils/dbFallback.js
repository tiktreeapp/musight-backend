import { PrismaClient } from '@prisma/client';
import LocalCache from './localCache.js';

const prisma = new PrismaClient();
const localCache = new LocalCache();

let dbAvailable = null;

/**
 * Check if database is available
 */
export async function checkDatabase() {
  if (dbAvailable === null) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbAvailable = true;
    } catch (error) {
      console.warn('Database not available, using local cache mode:', error.message);
      dbAvailable = false;
    }
  }
  return dbAvailable;
}

/**
 * Reset database availability check (useful for reconnection attempts)
 */
export function resetDatabaseCheck() {
  dbAvailable = null;
}

/**
 * Get database client (with fallback to cache)
 */
export function getDatabase() {
  return { prisma, localCache };
}

/**
 * Execute database operation with cache fallback
 * @param {Function} dbOperation - Async function that uses prisma
 * @param {Function} cacheOperation - Async function that uses localCache
 * @param {Object} options - { userId, dataType, fallbackToCache }
 */
export async function withCacheFallback(
  dbOperation,
  cacheOperation,
  { userId, dataType, fallbackToCache = true }
) {
  const isDbAvailable = await checkDatabase();
  
  if (isDbAvailable) {
    try {
      return await dbOperation(prisma);
    } catch (error) {
      console.error('Database operation failed:', error.message);
      
      // If database connection lost, reset check and fall back to cache
      if (error.code === 'P1001' || error.message.includes('connect')) {
        resetDatabaseCheck();
        if (fallbackToCache) {
          console.log(`Falling back to cache for ${dataType}`);
          return await cacheOperation(localCache);
        }
      }
      throw error;
    }
  } else {
    // Database not available, use cache
    if (fallbackToCache) {
      return await cacheOperation(localCache);
    } else {
      throw new Error('Database unavailable and cache fallback disabled');
    }
  }
}

export { prisma, localCache };

