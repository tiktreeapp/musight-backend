import express from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyUserToken } from '../utils/tokenManager.js';
import { SpotifyService } from '../services/spotifyService.js';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * Middleware to authenticate requests
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Handle both "Bearer token" and just "token" formats
    let token;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }

    if (!token || token.trim() === '') {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = verifyUserToken(token);

    if (!decoded || !decoded.userId) {
      console.error('Token verification failed:', { 
        tokenPresent: !!token, 
        tokenLength: token.length,
        decoded 
      });
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Handle database unavailable scenario
    if (!prisma) {
      // When database unavailable, create minimal user from token
      req.user = { id: decoded.userId };
      return next();
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        console.error('User not found:', decoded.userId);
        // Fallback: allow request to continue with minimal user object
        req.user = { id: decoded.userId };
        return next();
      }

      req.user = user;
      next();
    } catch (dbError) {
      console.error('Database error in authentication:', dbError);
      // Fallback: allow request to continue with minimal user object
      req.user = { id: decoded.userId };
      next();
    }
  } catch (error) {
    console.error('Authentication error:', error.message);
    res.status(401).json({ error: 'Authentication failed', message: error.message });
  }
}

/**
 * GET /api/user/me
 * Get current user profile
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    // Get fresh data from Spotify
    const spotifyService = new SpotifyService(req.user);
    const spotifyUser = await spotifyService.getCurrentUser();

    // Try to update local user data if database available
    if (prisma && req.user.id && !req.user.id.startsWith('temp_')) {
      try {
        const updatedUser = await prisma.user.update({
          where: { id: req.user.id },
          data: {
            displayName: spotifyUser.display_name,
            avatarUrl: spotifyUser.images?.[0]?.url || null,
          },
        });

        return res.json({
          id: updatedUser.id,
          spotifyId: updatedUser.spotifyId,
          displayName: updatedUser.displayName,
          avatarUrl: updatedUser.avatarUrl,
          email: spotifyUser.email,
          followers: spotifyUser.followers?.total || 0,
          createdAt: updatedUser.createdAt,
        });
      } catch (dbError) {
        console.warn('Database update failed, returning Spotify data:', dbError.message);
      }
    }

    // Fallback: return Spotify data directly
    res.json({
      id: req.user.id || spotifyUser.id,
      spotifyId: spotifyUser.id,
      displayName: spotifyUser.display_name,
      avatarUrl: spotifyUser.images?.[0]?.url || null,
      email: spotifyUser.email,
      followers: spotifyUser.followers?.total || 0,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile', message: error.message });
  }
});

/**
 * GET /api/user/status
 * Check if user is connected and token is valid
 */
router.get('/status', authenticate, async (req, res) => {
  try {
    const spotifyService = new SpotifyService(req.user);
    await spotifyService.getCurrentUser(); // This will auto-refresh token if needed

    res.json({
      connected: true,
      hasRefreshToken: !!(req.user.refreshToken || req.user.id && !req.user.id.startsWith('temp_')),
    });
  } catch (error) {
    res.json({
      connected: false,
      error: error.message,
    });
  }
});

export default router;

