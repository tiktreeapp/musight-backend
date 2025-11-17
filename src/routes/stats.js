import express from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyUserToken } from '../utils/tokenManager.js';
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
 */
router.get('/top-tracks', authenticate, async (req, res) => {
  try {
    const analysisService = new AnalysisService(req.user);
    const tracks = await analysisService.getRecentTracks(50);
    
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
      .slice(0, parseInt(req.query.limit) || 20);

    res.json(topTracks);
  } catch (error) {
    console.error('Error fetching top tracks:', error);
    res.status(500).json({ error: 'Failed to fetch top tracks' });
  }
});

/**
 * GET /api/stats/top-artists
 * Get top artists
 */
router.get('/top-artists', authenticate, async (req, res) => {
  try {
    const analysisService = new AnalysisService(req.user);
    const artists = await analysisService.getTopArtists(parseInt(req.query.limit) || 20);
    res.json(artists);
  } catch (error) {
    console.error('Error fetching top artists:', error);
    res.status(500).json({ error: 'Failed to fetch top artists' });
  }
});

/**
 * GET /api/stats/recent
 * Get recent tracks
 */
router.get('/recent', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const analysisService = new AnalysisService(req.user);
    const tracks = await analysisService.getRecentTracks(limit);
    res.json(tracks);
  } catch (error) {
    console.error('Error fetching recent tracks:', error);
    res.status(500).json({ error: 'Failed to fetch recent tracks' });
  }
});

export default router;

