import express from 'express';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { generateUserToken, refreshSpotifyToken } from '../utils/tokenManager.js';

const router = express.Router();

// Initialize Prisma with error handling
let prisma;
try {
  prisma = new PrismaClient();
} catch (error) {
  console.error('Failed to initialize Prisma in auth routes:', error);
  prisma = null;
}

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

/**
 * GET /api/auth/login
 * Generate Spotify OAuth URL
 */
router.get('/login', (req, res) => {
  const scopes = [
    'user-read-recently-played',
    'user-top-read',
    'user-read-email',
    'user-read-private',
  ].join(' ');

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.append('client_id', SPOTIFY_CLIENT_ID);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('redirect_uri', SPOTIFY_REDIRECT_URI);
  authUrl.searchParams.append('scope', scopes);
  authUrl.searchParams.append('show_dialog', 'false');

  res.json({ authUrl: authUrl.toString() });
});

/**
 * POST /api/auth/spotify
 * Exchange Spotify authorization code for JWT token (alternative to callback)
 * For iOS App direct token exchange
 */
router.post('/spotify', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      console.error('Spotify credentials not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Exchange code for tokens
    const authString = Buffer.from(
      `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // Get user profile from Spotify
    const userResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${access_token}` },
    });

    const spotifyUser = userResponse.data;

    // Try to save user to database, but handle database errors gracefully
    let user;
    try {
      if (prisma) {
        user = await prisma.user.findUnique({
          where: { spotifyId: spotifyUser.id },
        });

        if (user) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              displayName: spotifyUser.display_name,
              avatarUrl: spotifyUser.images?.[0]?.url || null,
              accessToken: access_token,
              refreshToken: refresh_token,
              tokenExpiresAt: tokenExpiresAt,
            },
          });
        } else {
          user = await prisma.user.create({
            data: {
              spotifyId: spotifyUser.id,
              displayName: spotifyUser.display_name,
              avatarUrl: spotifyUser.images?.[0]?.url || null,
              accessToken: access_token,
              refreshToken: refresh_token,
              tokenExpiresAt: tokenExpiresAt,
            },
          });
        }
      } else {
        // Database not available, create minimal user object
        console.warn('Database not available, creating temporary user object');
        user = {
          id: `temp_${spotifyUser.id}`,
          spotifyId: spotifyUser.id,
          displayName: spotifyUser.display_name,
          avatarUrl: spotifyUser.images?.[0]?.url || null,
        };
      }
    } catch (dbError) {
      console.error('Database error in /api/auth/spotify:', dbError);
      // Continue with minimal user object if database fails
      user = {
        id: `temp_${spotifyUser.id}`,
        spotifyId: spotifyUser.id,
        displayName: spotifyUser.display_name,
        avatarUrl: spotifyUser.images?.[0]?.url || null,
      };
    }

    // Generate JWT token for our API
    const jwtToken = generateUserToken(user.id);

    res.json({
      token: jwtToken,
      userId: user.id,
      user: {
        id: user.id,
        spotifyId: user.spotifyId,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    console.error('OAuth token exchange error:', error.response?.data || error.message);
    const errorMessage = error.response?.data?.error_description || error.message || 'Unknown error';
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to exchange token',
      message: errorMessage 
    });
  }
});

/**
 * GET /api/auth/callback
 * Handle Spotify OAuth callback
 */
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`musight://auth?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`musight://auth?error=${encodeURIComponent('No authorization code')}`);
  }

  try {
    // Exchange code for tokens
    const authString = Buffer.from(
      `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    // Get user profile from Spotify
    const userResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${access_token}` },
    });

    const spotifyUser = userResponse.data;

    // Try to save or update user in database, handle errors gracefully
    let user;
    try {
      if (prisma) {
        user = await prisma.user.findUnique({
          where: { spotifyId: spotifyUser.id },
        });

        if (user) {
          // Update existing user
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              displayName: spotifyUser.display_name,
              avatarUrl: spotifyUser.images?.[0]?.url || null,
              accessToken: access_token,
              refreshToken: refresh_token,
              tokenExpiresAt: tokenExpiresAt,
            },
          });
        } else {
          // Create new user
          user = await prisma.user.create({
            data: {
              spotifyId: spotifyUser.id,
              displayName: spotifyUser.display_name,
              avatarUrl: spotifyUser.images?.[0]?.url || null,
              accessToken: access_token,
              refreshToken: refresh_token,
              tokenExpiresAt: tokenExpiresAt,
            },
          });
        }
      } else {
        // Database not available, create minimal user object
        console.warn('Database not available in callback, creating temporary user');
        user = {
          id: `temp_${spotifyUser.id}`,
          spotifyId: spotifyUser.id,
          displayName: spotifyUser.display_name,
          avatarUrl: spotifyUser.images?.[0]?.url || null,
        };
      }
    } catch (dbError) {
      console.error('Database error in callback:', dbError);
      // Continue with minimal user object if database fails
      user = {
        id: `temp_${spotifyUser.id}`,
        spotifyId: spotifyUser.id,
        displayName: spotifyUser.display_name,
        avatarUrl: spotifyUser.images?.[0]?.url || null,
      };
    }

    // Generate JWT token for our API
    const jwtToken = generateUserToken(user.id);

    // Redirect to app with token
    res.redirect(`musight://auth?token=${jwtToken}&userId=${user.id}`);
  } catch (error) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    const errorMessage = error.response?.data?.error_description || error.message;
    res.redirect(`musight://auth?error=${encodeURIComponent(errorMessage)}`);
  }
});

/**
 * POST /api/auth/refresh
 * Refresh user's Spotify token manually
 */
router.post('/refresh', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (!prisma) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.refreshToken) {
      return res.status(404).json({ error: 'User not found or no refresh token' });
    }

    const refreshed = await refreshSpotifyToken(user.refreshToken);

    // Update user with new token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        accessToken: refreshed.accessToken,
        tokenExpiresAt: refreshed.tokenExpiresAt,
      },
    });

    res.json({ success: true, expiresAt: refreshed.tokenExpiresAt });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

export default router;

