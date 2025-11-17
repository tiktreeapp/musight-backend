import express from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyUserToken } from '../utils/tokenManager.js';
import { AnalysisService } from '../services/analysisService.js';
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
 * GET /api/stats/dashboard
 * Get comprehensive dashboard data
 */
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const analysisService = new AnalysisService(req.user);
    const dashboard = await analysisService.getDashboard();
    res.json(dashboard);
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

/**
 * GET /api/stats/listening
 * Get listening statistics
 * Query params: timeRange (24h, 7d, 30d, all)
 */
router.get('/listening', authenticate, async (req, res) => {
  try {
    const { timeRange = '7d' } = req.query;
    const analysisService = new AnalysisService(req.user);
    const stats = await analysisService.getListeningStats(timeRange);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching listening stats:', error);
    res.status(500).json({ error: 'Failed to fetch listening statistics' });
  }
});

/**
 * GET /api/stats/top-tracks
 * Get top tracks
 * Query params: time_range (short_term, medium_term, long_term), limit
 * Can optionally sync from Spotify first by adding ?sync=true
 */
router.get('/top-tracks', authenticate, async (req, res) => {
  try {
    const { time_range = 'medium_term', limit = 20, sync = false } = req.query;
    const analysisService = new AnalysisService(req.user);

    // If sync is requested, sync from Spotify first
    if (sync === 'true') {
      await analysisService.syncTopTracks(time_range, 50);
    }

    // Get top tracks from database (aggregated by play count)
    const tracks = await analysisService.getRecentTracks(100);
    
    // Group by track and count plays
    const trackCounts = {};
    tracks.forEach(track => {
      const key = track.trackId;
      if (!trackCounts[key]) {
        trackCounts[key] = {
          trackId: track.trackId,
          name: track.name,
          artist: track.artist,
          imageUrl: track.imageUrl,
          count: 0,
          lastPlayed: track.playedAt,
        };
      }
      trackCounts[key].count++;
      if (track.playedAt > trackCounts[key].lastPlayed) {
        trackCounts[key].lastPlayed = track.playedAt;
      }
    });

    const topTracks = Object.values(trackCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, parseInt(limit));

    res.json(topTracks);
  } catch (error) {
    console.error('Error fetching top tracks:', error);
    res.status(500).json({ error: 'Failed to fetch top tracks' });
  }
});

/**
 * GET /api/stats/top-artists
 * Get top artists
 * Query params: time_range (short_term, medium_term, long_term), limit
 * Can optionally sync from Spotify first by adding ?sync=true
 */
router.get('/top-artists', authenticate, async (req, res) => {
  try {
    const { time_range = 'medium_term', limit = 20, sync = false } = req.query;
    const analysisService = new AnalysisService(req.user);

    // If sync is requested, sync from Spotify first
    if (sync === 'true') {
      await analysisService.syncTopArtists(time_range, 50);
    }

    // Get top artists from database (ordered by playCount)
    const artists = await analysisService.getTopArtists(parseInt(limit));
    res.json(artists);
  } catch (error) {
    console.error('Error fetching top artists:', error);
    res.status(500).json({ error: 'Failed to fetch top artists' });
  }
});

/**
 * GET /api/stats/recent
 * Get recent tracks from Spotify (proxy endpoint)
 * Query params: limit (max 50)
 */
router.get('/recent', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const analysisService = new AnalysisService(req.user);
    
    // Get directly from Spotify API (real-time data)
    const tracks = await analysisService.spotifyService.getRecentlyPlayed(limit);
    res.json(tracks);
  } catch (error) {
    console.error('Error fetching recent tracks:', error);
    res.status(500).json({ error: 'Failed to fetch recent tracks' });
  }
});

/**
 * GET /api/stats/top-playlists
 * Get top playlists (alias for /api/spotify/top-playlists)
 */
router.get('/top-playlists', authenticate, async (req, res) => {
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

/**
 * GET /api/stats/profile
 * Get user's music profile
 * If profile doesn't exist, triggers syncUserPlayback + buildMusicProfile
 */
router.get('/profile', authenticate, async (req, res) => {
  try {
    const analysisService = new AnalysisService(req.user);

    // Check if profile exists
    let profile = await prisma.musicProfile.findUnique({
      where: { userId: req.user.id },
    });

    // If profile doesn't exist, trigger sync and build
    if (!profile) {
      console.log(`Profile not found for user ${req.user.id}, triggering sync...`);
      await analysisService.syncUserPlayback('medium_term');
      profile = await prisma.musicProfile.findUnique({
        where: { userId: req.user.id },
      });
    }

    if (!profile) {
      return res.status(404).json({ error: 'Failed to create music profile' });
    }

    // Return profile data in the expected format
    res.json({
      topTracks: profile.topTracks,
      topArtists: profile.topArtists,
      genreDist: profile.genreDist,
      avgEnergy: profile.avgEnergy,
      avgValence: profile.avgValence,
      lastUpdated: profile.lastUpdated,
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch music profile' });
  }
});

export default router;

