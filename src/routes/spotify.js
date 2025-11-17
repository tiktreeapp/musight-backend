import express from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyUserToken } from '../utils/tokenManager.js';
import { SpotifyService } from '../services/spotifyService.js';
import { AnalysisService } from '../services/analysisService.js';

const router = express.Router();
const prisma = new PrismaClient();

/**
 * Middleware to authenticate requests
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyUserToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * POST /api/spotify/sync
 * Sync user's listening data from Spotify
 */
router.post('/sync', authenticate, async (req, res) => {
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
 * Get top tracks from Spotify
 */
router.get('/top-tracks', authenticate, async (req, res) => {
  try {
    const timeRange = req.query.time_range || 'medium_term';
    const limit = parseInt(req.query.limit) || 50;
    
    const spotifyService = new SpotifyService(req.user);
    const tracks = await spotifyService.getTopTracks(timeRange, limit);
    res.json(tracks);
  } catch (error) {
    console.error('Error fetching top tracks:', error);
    res.status(500).json({ error: 'Failed to fetch top tracks' });
  }
});

/**
 * GET /api/spotify/top-artists
 * Get top artists from Spotify
 */
router.get('/top-artists', authenticate, async (req, res) => {
  try {
    const timeRange = req.query.time_range || 'medium_term';
    const limit = parseInt(req.query.limit) || 50;
    
    const spotifyService = new SpotifyService(req.user);
    const artists = await spotifyService.getTopArtists(timeRange, limit);
    res.json(artists);
  } catch (error) {
    console.error('Error fetching top artists:', error);
    res.status(500).json({ error: 'Failed to fetch top artists' });
  }
});

/**
 * GET /api/spotify/track/:trackId
 * Get track details
 */
router.get('/track/:trackId', authenticate, async (req, res) => {
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
  try {
    const spotifyService = new SpotifyService(req.user);
    const artist = await spotifyService.getArtist(req.params.artistId);
    res.json(artist);
  } catch (error) {
    console.error('Error fetching artist:', error);
    res.status(500).json({ error: 'Failed to fetch artist details' });
  }
});

export default router;

