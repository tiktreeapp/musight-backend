import express from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyUserToken } from '../utils/tokenManager.js';
import { SpotifyService } from '../services/spotifyService.js';
import { AnalysisService } from '../services/analysisService.js';

const router = express.Router();

// Initialize Prisma with error handling
let prisma;
try {
  prisma = new PrismaClient();
} catch (error) {
  console.error('Failed to initialize Prisma in spotify routes:', error);
  prisma = null;
}

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

    // Handle database unavailable scenario or temp users
    if (!prisma || decoded.userId.startsWith('temp_')) {
      // When database unavailable or temp user, create minimal user from token
      // For temp users, extract spotifyId and ensure we have accessToken stored in temp user object
      req.user = { 
        id: decoded.userId,
        // Try to extract spotifyId from temp user ID format (temp_spotifyId)
        spotifyId: decoded.userId.startsWith('temp_') ? decoded.userId.replace('temp_', '') : null,
      };
      return next();
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        console.warn('User not found in database:', decoded.userId, '- allowing request with minimal user object');
        // Fallback: allow request to continue with minimal user object
        req.user = { 
          id: decoded.userId,
          spotifyId: null,
        };
        return next();
      }

      req.user = user;
      next();
    } catch (dbError) {
      console.error('Database error in authentication:', dbError);
      // Fallback: allow request to continue with minimal user object
      req.user = { 
        id: decoded.userId,
        spotifyId: decoded.userId.startsWith('temp_') ? decoded.userId.replace('temp_', '') : null,
      };
      next();
    }
  } catch (error) {
    console.error('Authentication error:', error.message);
    res.status(401).json({ error: 'Authentication failed', message: error.message });
  }
}

/**
 * POST /api/spotify/sync
 * Sync user's listening data from Spotify
 */
router.post('/sync', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(60000, () => { // 60 seconds timeout
    console.error('Request timeout for /api/spotify/sync');
  });

  try {
    const analysisService = new AnalysisService(req.user);
    
    const [tracksResult, artistsResult] = await Promise.all([
      analysisService.syncRecentlyPlayed(),
      analysisService.syncTopArtists(),
    ]);

    res.json({
      success: true,
      tracks: tracksResult,
      artists: artistsResult,
    });
  } catch (error) {
    console.error('Error syncing Spotify data:', error);
    res.status(500).json({ 
      error: 'Failed to sync data',
      message: error.message 
    });
  }
});

/**
 * GET /api/spotify/recently-played
 * Get recently played tracks from Spotify (fresh data)
 */
router.get('/recently-played', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/recently-played');
  });

  try {
    const limit = parseInt(req.query.limit) || 50;
    const after = req.query.after ? parseInt(req.query.after) : null;
    
    const spotifyService = new SpotifyService(req.user);
    const tracks = await spotifyService.getRecentlyPlayed(limit, after);
    res.json(tracks);
  } catch (error) {
    console.error('Error fetching recently played:', error);
    res.status(500).json({ error: 'Failed to fetch recently played tracks' });
  }
});

/**
 * GET /api/spotify/top-tracks
 * Get top tracks from Spotify (real-time data)
 */
router.get('/top-tracks', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/top-tracks');
  });

  try {
    const timeRange = req.query.time_range || 'medium_term';
    const limit = parseInt(req.query.limit) || 50;
    
    const spotifyService = new SpotifyService(req.user);
    const tracks = await spotifyService.getTopTracks(timeRange, limit);
    
    // Ensure consistent format with imageUrl
    const formattedTracks = tracks.map(track => ({
      trackId: track.trackId,
      name: track.name,
      artist: track.artist,
      artistIds: track.artistIds || [],
      imageUrl: track.imageUrl || null,
      duration: track.duration || null,
      popularity: track.popularity || null,
    }));
    
    res.json(formattedTracks);
  } catch (error) {
    console.error('Error fetching top tracks:', error);
    res.status(500).json({ error: 'Failed to fetch top tracks', message: error.message });
  }
});

/**
 * GET /api/spotify/top-artists
 * Get top artists from Spotify (real-time data)
 */
router.get('/top-artists', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/top-artists');
  });

  try {
    const timeRange = req.query.time_range || 'medium_term';
    const limit = parseInt(req.query.limit) || 50;
    
    const spotifyService = new SpotifyService(req.user);
    const artists = await spotifyService.getTopArtists(timeRange, limit);
    
    // Ensure consistent format with imageUrl
    const formattedArtists = artists.map(artist => ({
      artistId: artist.artistId,
      name: artist.name,
      genres: artist.genres || [],
      imageUrl: artist.imageUrl || null,
      popularity: artist.popularity || null,
    }));
    
    res.json(formattedArtists);
  } catch (error) {
    console.error('Error fetching top artists:', error);
    res.status(500).json({ error: 'Failed to fetch top artists', message: error.message });
  }
});

/**
 * GET /api/spotify/track/:trackId
 * Get track details
 */
router.get('/track/:trackId', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/track/:trackId');
  });

  try {
    const spotifyService = new SpotifyService(req.user);
    const track = await spotifyService.getTrack(req.params.trackId);
    res.json(track);
  } catch (error) {
    console.error('Error fetching track:', error);
    res.status(500).json({ error: 'Failed to fetch track details' });
  }
});

/**
 * GET /api/spotify/artist/:artistId
 * Get artist details
 */
router.get('/artist/:artistId', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/artist/:artistId');
  });

  try {
    const spotifyService = new SpotifyService(req.user);
    const artist = await spotifyService.getArtist(req.params.artistId);
    res.json(artist);
  } catch (error) {
    console.error('Error fetching artist:', error);
    res.status(500).json({ error: 'Failed to fetch artist details' });
  }
});

/**
 * GET /api/spotify/playlists
 * Get user's playlists
 */
router.get('/playlists', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/playlists');
  });

  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    const spotifyService = new SpotifyService(req.user);
    const playlists = await spotifyService.getPlaylists(limit, offset);
    res.json(playlists);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

/**
 * GET /api/spotify/top-playlists
 * Get user's top playlists
 */
router.get('/top-playlists', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/top-playlists');
  });

  try {
    const limit = parseInt(req.query.limit) || 20;
    
    const spotifyService = new SpotifyService(req.user);
    const playlists = await spotifyService.getTopPlaylists(limit);
    res.json(playlists);
  } catch (error) {
    console.error('Error fetching top playlists:', error);
    res.status(500).json({ error: 'Failed to fetch top playlists' });
  }
});

export default router;

