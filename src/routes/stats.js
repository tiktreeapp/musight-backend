import express from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyUserToken } from '../utils/tokenManager.js';
import { AnalysisService } from '../services/analysisService.js';
import { SpotifyService } from '../services/spotifyService.js';
import { withCacheFallback, checkDatabase } from '../utils/dbFallback.js';

const router = express.Router();

// Initialize Prisma with error handling
let prisma;
try {
  prisma = new PrismaClient();
} catch (error) {
  console.error('Failed to initialize Prisma in stats routes:', error);
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

    // Ensure all tracks have required fields including imageUrl
    const formattedTracks = topTracks.map(track => ({
      trackId: track.trackId,
      name: track.name,
      artist: track.artist,
      imageUrl: track.imageUrl || null,
      count: track.count || 0,
      plays: track.count || 0, // Alias for count
      lastPlayed: track.lastPlayed || null,
    }));

    res.json(formattedTracks);
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

    // Get top artists from database or Spotify
    let artists = await analysisService.getTopArtists(parseInt(limit));
    
    // If no artists found in database and sync wasn't requested, try fetching from Spotify directly
    if ((!artists || artists.length === 0) && sync !== 'true') {
      try {
        const spotifyService = new SpotifyService(req.user);
        artists = await spotifyService.getTopArtists(time_range, parseInt(limit));
        // Cache the results
        const { localCache } = await import('../utils/dbFallback.js');
        await localCache.save(req.user.id, 'topArtists', artists);
      } catch (spotifyError) {
        console.error('Error fetching top artists from Spotify:', spotifyError);
      }
    }
    
    // Ensure all artists have required fields
    const formattedArtists = artists.map(artist => ({
      id: artist.id || artist.artistId,
      artistId: artist.artistId,
      name: artist.name,
      genres: artist.genres || [],
      imageUrl: artist.imageUrl || null,
      playCount: artist.playCount || 0,
      popularity: artist.popularity || null,
      createdAt: artist.createdAt || new Date().toISOString(),
      updatedAt: artist.updatedAt || new Date().toISOString(),
    }));
    
    res.json(formattedArtists);
  } catch (error) {
    console.error('Error fetching top artists:', error);
    res.status(500).json({ error: 'Failed to fetch top artists' });
  }
});

/**
 * GET /api/stats/recent
 * Get recent tracks from Spotify (proxy endpoint)
 * Query params: limit (max 50)
 * Falls back to cache if database unavailable
 */
router.get('/recent', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const analysisService = new AnalysisService(req.user);
    const userId = req.user.id;
    
    // Get directly from Spotify API (real-time data)
    const tracks = await analysisService.spotifyService.getRecentlyPlayed(limit);
    
    // Cache the results if database available
    const isDbAvailable = await checkDatabase();
    if (isDbAvailable) {
      // Save to database (this will happen in syncRecentlyPlayed)
      try {
        await analysisService.syncRecentlyPlayed();
      } catch (dbError) {
        console.warn('Failed to save to database, caching instead:', dbError.message);
        const { localCache } = await import('../utils/dbFallback.js');
        await localCache.save(userId, 'recentTracks', tracks);
      }
    } else {
      // Cache to local file
      const { localCache } = await import('../utils/dbFallback.js');
      await localCache.save(userId, 'recentTracks', tracks);
    }
    
    res.json(tracks);
  } catch (error) {
    console.error('Error fetching recent tracks:', error);
    
    // Try to return cached data as fallback
    try {
      const { localCache } = await import('../utils/dbFallback.js');
      const cached = await localCache.load(req.user.id, 'recentTracks');
      if (cached) {
        console.log('Returning cached recent tracks');
        return res.json(cached);
      }
    } catch (cacheError) {
      console.error('Cache fallback failed:', cacheError);
    }
    
    res.status(500).json({ error: 'Failed to fetch recent tracks', message: error.message });
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
 * Falls back to local cache if database unavailable
 */
router.get('/profile', authenticate, async (req, res) => {
  try {
    const analysisService = new AnalysisService(req.user);
    const userId = req.user.id;

    // Try to get profile from database or cache
    const profile = await withCacheFallback(
      async (prisma) => {
        let profile = await prisma.musicProfile.findUnique({
          where: { userId },
        });

        // If profile doesn't exist, trigger sync and build
        if (!profile) {
          console.log(`Profile not found for user ${userId}, triggering sync...`);
          await analysisService.syncUserPlayback('medium_term');
          profile = await prisma.musicProfile.findUnique({
            where: { userId },
          });
        }

        return profile;
      },
      async (cache) => {
        // Load from cache
        let cachedProfile = await cache.load(userId, 'profile');
        
        if (!cachedProfile) {
          // Try to build profile from cached data
          console.log(`Cache not found for user ${userId}, fetching from Spotify...`);
          
          // Fetch data from Spotify
          const spotifyService = new SpotifyService(req.user);
          const [topTracks, topArtists, recentTracks] = await Promise.all([
            spotifyService.getTopTracks('medium_term', 20).catch(() => []),
            spotifyService.getTopArtists('medium_term', 20).catch(() => []),
            spotifyService.getRecentlyPlayed(50).catch(() => []),
          ]);

          // Cache individual data
          await Promise.all([
            cache.save(userId, 'topTracks', topTracks),
            cache.save(userId, 'topArtists', topArtists),
            cache.save(userId, 'recentTracks', recentTracks),
          ]);

          // Build simple profile
          cachedProfile = {
            topTracks: topTracks.map(t => ({
              trackId: t.trackId,
              name: t.name,
              plays: 1,
              imageUrl: t.imageUrl,
            })),
            topArtists: topArtists.map(a => ({
              artistId: a.artistId,
              name: a.name,
              plays: 1,
              genres: a.genres || [],
              imageUrl: a.imageUrl,
            })),
            genreDist: {},
            avgEnergy: null,
            avgValence: null,
            lastUpdated: new Date().toISOString(),
          };

          await cache.save(userId, 'profile', cachedProfile);
        }

        return cachedProfile;
      },
      { userId, dataType: 'profile', fallbackToCache: true }
    );

    if (!profile) {
      return res.status(404).json({ error: 'Failed to create music profile' });
    }

    // Return profile data in the expected format
    res.json({
      topTracks: profile.topTracks || [],
      topArtists: profile.topArtists || [],
      genreDist: profile.genreDist || {},
      avgEnergy: profile.avgEnergy,
      avgValence: profile.avgValence,
      lastUpdated: profile.lastUpdated,
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch music profile', message: error.message });
  }
});

export default router;

