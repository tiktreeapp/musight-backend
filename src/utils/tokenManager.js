import jwt from 'jsonwebtoken';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// Initialize Prisma with error handling
let prisma;
try {
  prisma = new PrismaClient();
} catch (error) {
  console.error('Failed to initialize Prisma in tokenManager:', error);
  prisma = null;
}

/**
 * Generate JWT token for user
 */
export function generateUserToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

/**
 * Verify JWT token
 */
export function verifyUserToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Refresh Spotify access token
 */
export async function refreshSpotifyToken(refreshToken) {
  try {
    const authString = Buffer.from(
      `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in,
      tokenExpiresAt: new Date(Date.now() + response.data.expires_in * 1000),
    };
  } catch (error) {
    console.error('Error refreshing Spotify token:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Check if token is expired or about to expire (within 5 minutes)
 */
export function isTokenExpired(tokenExpiresAt) {
  if (!tokenExpiresAt) return true;
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
  return new Date(tokenExpiresAt).getTime() < fiveMinutesFromNow;
}

/**
 * Get valid access token, refreshing if necessary
 * Automatically updates the database if token is refreshed
 * Supports temp users by loading tokens from local cache
 */
export async function getValidAccessToken(user) {
  // For temp users, try to load tokens from local cache first
  let currentUser = user;
  
  if (user.id && user.id.startsWith('temp_') && (!user.accessToken || !user.refreshToken)) {
    try {
      const { localCache } = await import('./dbFallback.js');
      const cachedTokens = await localCache.load(user.id, 'tokens');
      
      if (cachedTokens && cachedTokens.accessToken && cachedTokens.refreshToken) {
        currentUser = {
          ...user,
          accessToken: cachedTokens.accessToken,
          refreshToken: cachedTokens.refreshToken,
          tokenExpiresAt: cachedTokens.tokenExpiresAt ? new Date(cachedTokens.tokenExpiresAt) : null,
        };
      }
    } catch (cacheError) {
      console.warn('Failed to load tokens from cache for temp user:', cacheError.message);
    }
  }
  
  if (!currentUser.refreshToken) {
    throw new Error('No refresh token available');
  }

  // Check if token needs refresh
  if (isTokenExpired(currentUser.tokenExpiresAt)) {
    const refreshed = await refreshSpotifyToken(currentUser.refreshToken);
    
    // Update database with new token (if available)
    if (prisma && currentUser.id && !currentUser.id.startsWith('temp_')) {
      try {
        await prisma.user.update({
          where: { id: currentUser.id },
          data: {
            accessToken: refreshed.accessToken,
            tokenExpiresAt: refreshed.tokenExpiresAt,
          },
        });
      } catch (dbError) {
        console.warn('Failed to update token in database:', dbError.message);
        // Continue even if database update fails
      }
    }
    
    // For temp users, update local cache
    if (currentUser.id && currentUser.id.startsWith('temp_')) {
      try {
        const { localCache } = await import('./dbFallback.js');
        await localCache.save(currentUser.id, 'tokens', {
          accessToken: refreshed.accessToken,
          refreshToken: currentUser.refreshToken, // Keep the same refresh token
          tokenExpiresAt: refreshed.tokenExpiresAt.toISOString(),
        });
      } catch (cacheError) {
        console.warn('Failed to cache refreshed token for temp user:', cacheError.message);
      }
    }
    
    return refreshed.accessToken;
  }

  return currentUser.accessToken;
}

