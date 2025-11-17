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

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      console.error('User not found:', decoded.userId);
      return res.status(404).json({ error: 'User not found' });
    }

    req.user = user;
    next();
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

    // Update local user data
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        displayName: spotifyUser.display_name,
        avatarUrl: spotifyUser.images?.[0]?.url || null,
      },
    });

    res.json({
      id: updatedUser.id,
      spotifyId: updatedUser.spotifyId,
      displayName: updatedUser.displayName,
      avatarUrl: updatedUser.avatarUrl,
      email: spotifyUser.email,
      followers: spotifyUser.followers?.total || 0,
      createdAt: updatedUser.createdAt,
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
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
      hasRefreshToken: !!req.user.refreshToken,
    });
  } catch (error) {
    res.json({
      connected: false,
      error: error.message,
    });
  }
});

export default router;

