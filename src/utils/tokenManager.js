import jwt from 'jsonwebtoken';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const prisma = new PrismaClient();

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
 */
export async function getValidAccessToken(user) {
  if (!user.refreshToken) {
    throw new Error('No refresh token available');
  }

  // Check if token needs refresh
  if (isTokenExpired(user.tokenExpiresAt)) {
    const refreshed = await refreshSpotifyToken(user.refreshToken);
    
    // Update database with new token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        accessToken: refreshed.accessToken,
        tokenExpiresAt: refreshed.tokenExpiresAt,
      },
    });
    
    return refreshed.accessToken;
  }

  return user.accessToken;
}

