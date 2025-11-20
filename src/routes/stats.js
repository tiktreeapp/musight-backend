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
  // Set timeout for the entire request
  req.setTimeout(45000, () => { // 45 seconds timeout
    console.error('Request timeout for /api/stats/dashboard');
  });

  try {
    // Use cache fallback mechanism for dashboard data
    const result = await withCacheFallback(
      async (db) => {
        // Use database if available
        const analysisService = new AnalysisService(req.user);
        return await analysisService.getDashboard();
      },
      async (cache) => {
        // Fallback to cache or fetch from Spotify directly
        console.log(`Using cache fallback for dashboard data for user ${req.user.id}`);
        
        // Try to load from cache first
        let cachedData = await cache.load(req.user.id, 'dashboard');
        if (cachedData) {
          console.log('Returning cached dashboard data');
          return cachedData;
        }
        
        // If no cache, fetch fresh data from Spotify
        console.log('No cached dashboard data, fetching fresh data from Spotify');
        const spotifyService = new SpotifyService(req.user);
        
        // Fetch data with timeout protection
        const [recentTracks, topArtists, listeningStats] = await Promise.all([
          Promise.race([
            spotifyService.getRecentlyPlayed(20),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout fetching recent tracks')), 15000)
            )
          ]).catch(() => []),
          Promise.race([
            spotifyService.getTopArtists('medium_term', 10),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout fetching top artists')), 15000)
            )
          ]).catch(() => []),
          Promise.race([
            (async () => {
              // Simple stats based on recent tracks
              const tracks = await spotifyService.getRecentlyPlayed(50);
              return {
                timeRange: '7d',
                totalTracks: tracks.length,
                uniqueTracks: new Set(tracks.map(t => t.trackId)).size,
                uniqueArtists: new Set(tracks.map(t => t.artist)).size,
                totalListeningTime: { hours: 0, minutes: 0, totalMs: 0 }, // Placeholder
                topTracks: tracks.slice(0, 10),
                topArtists: [], // Will be filled from topArtists above
                hourlyActivity: new Array(24).fill(0),
                firstTrack: tracks[tracks.length - 1] || null,
                lastTrack: tracks[0] || null,
              };
            })(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout fetching listening stats')), 15000)
            )
          ]).catch(() => ({
            timeRange: '7d',
            totalTracks: 0,
            uniqueTracks: 0,
            uniqueArtists: 0,
            totalListeningTime: { hours: 0, minutes: 0, totalMs: 0 },
            topTracks: [],
            topArtists: [],
            hourlyActivity: new Array(24).fill(0),
            firstTrack: null,
            lastTrack: null,
          }))
        ]);

        // Build dashboard response
        const dashboardData = {
          stats: listeningStats,
          topArtists: topArtists.map(artist => ({
            id: artist.artistId,
            artistId: artist.artistId,
            name: artist.name,
            genres: artist.genres || [],
            imageUrl: artist.imageUrl || null,
            playCount: artist.playCount || 0,
          })),
          recentTracks: recentTracks,
          spotifyTopTracks: await Promise.race([
            spotifyService.getTopTracks('medium_term', 10),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout fetching top tracks')), 15000)
            )
          ]).catch(() => [])
        };

        // Cache the result for future requests
        try {
          await cache.save(req.user.id, 'dashboard', dashboardData);
        } catch (cacheError) {
          console.error('Failed to cache dashboard data:', cacheError.message);
        }

        return dashboardData;
      },
      { userId: req.user.id, dataType: 'dashboard', fallbackToCache: true }
    );

    res.json(result);
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    // Return a minimal response instead of failing completely
    res.json({
      stats: {
        timeRange: '7d',
        totalTracks: 0,
        uniqueTracks: 0,
        uniqueArtists: 0,
        totalListeningTime: { hours: 0, minutes: 0, totalMs: 0 },
        topTracks: [],
        topArtists: [],
        hourlyActivity: new Array(24).fill(0),
        firstTrack: null,
        lastTrack: null,
      },
      topArtists: [],
      recentTracks: [],
      spotifyTopTracks: []
    });
  }
});

/**
 * GET /api/stats/listening
 * Get listening statistics
 * Query params: timeRange (24h, 7d, 30d, all)
 */
router.get('/listening', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/stats/listening');
  });

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
  // Set timeout for the entire request
  req.setTimeout(45000, () => { // 45 seconds timeout
    console.error('Request timeout for /api/stats/top-tracks');
  });

  try {
    const { time_range = 'medium_term', limit = 20, sync = false } = req.query;
    const validTimeRanges = ['short_term', 'medium_term', 'long_term'];
    
    if (!validTimeRanges.includes(time_range)) {
      return res.status(400).json({ 
        error: 'Invalid time_range', 
        validOptions: validTimeRanges 
      });
    }

    const analysisService = new AnalysisService(req.user);

    // If sync is requested, sync from Spotify first
    if (sync === 'true') {
      await analysisService.syncTopTracks(time_range, 50);
    }

    // Get top tracks from Spotify API instead of local database
    let tracks = await analysisService.getTopTracksFromSpotify(time_range, parseInt(limit));

    // Ensure all tracks have required fields including imageUrl
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
  // Set timeout for the entire request
  req.setTimeout(45000, () => { // 45 seconds timeout
    console.error('Request timeout for /api/stats/top-artists');
  });

  try {
    const { time_range = 'medium_term', limit = 20, sync = false } = req.query;
    const validTimeRanges = ['short_term', 'medium_term', 'long_term'];
    
    if (!validTimeRanges.includes(time_range)) {
      return res.status(400).json({ 
        error: 'Invalid time_range', 
        validOptions: validTimeRanges 
      });
    }

    const analysisService = new AnalysisService(req.user);

    // If sync is requested, sync from Spotify first
    if (sync === 'true') {
      await analysisService.syncTopArtists(time_range, 50);
    }

    // Get top artists from database or Spotify - use the new method that fetches from Spotify API
    let artists = await analysisService.getTopArtistsFromSpotify(time_range, parseInt(limit));
    
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
  // Set timeout for the entire request
  req.setTimeout(45000, () => { // 45 seconds timeout
    console.error('Request timeout for /api/stats/recent');
  });

  try {
    const limit = parseInt(req.query.limit) || 50;
    const analysisService = new AnalysisService(req.user);
    const userId = req.user.id;
    
    // Get directly from Spotify API (real-time data)
    // Use a promise with timeout to ensure the call doesn't hang
    const tracks = await Promise.race([
      analysisService.spotifyService.getRecentlyPlayed(limit),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout fetching recent tracks from Spotify')), 25000)
      )
    ]);
    
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
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/stats/top-playlists');
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

/**
 * GET /api/stats/profile
 * Get user's music profile
 * If profile doesn't exist, triggers syncUserPlayback + buildMusicProfile
 * Falls back to local cache if database unavailable
 */
router.get('/profile', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(60000, () => { // 60 seconds timeout
    console.error('Request timeout for /api/stats/profile');
  });

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
          
          // Fetch data from Spotify with timeout protection
          const [topTracks, topArtists, recentTracks] = await Promise.all([
            Promise.race([
              analysisService.spotifyService.getTopTracks('medium_term', 20),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout fetching top tracks from Spotify')), 25000)
              )
            ]).catch(() => []),
            Promise.race([
              analysisService.spotifyService.getTopArtists('medium_term', 20),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout fetching top artists from Spotify')), 25000)
              )
            ]).catch(() => []),
            Promise.race([
              analysisService.spotifyService.getRecentlyPlayed(50),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout fetching recently played from Spotify')), 25000)
              )
            ]).catch(() => []),
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

/**
 * GET /api/stats/top-tracks-by-time
 * Get top tracks from Spotify for specific time range
 * Query params: time_range (short_term, medium_term, long_term), limit
 */
router.get('/top-tracks-by-time', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/stats/top-tracks-by-time');
  });

  try {
    const { time_range = 'medium_term', limit = 20 } = req.query;
    const validTimeRanges = ['short_term', 'medium_term', 'long_term'];
    
    if (!validTimeRanges.includes(time_range)) {
      return res.status(400).json({ 
        error: 'Invalid time_range', 
        validOptions: validTimeRanges 
      });
    }

    const analysisService = new AnalysisService(req.user);
    const tracks = await analysisService.getTopTracksFromSpotify(time_range, parseInt(limit));
    
    // Set cache control headers to help with client-side caching
    const timestamp = new Date().toISOString();
    res.set('X-Data-Timestamp', timestamp);
    res.set('Cache-Control', 'no-cache'); // For now, to prevent any caching issues
    
    res.json(tracks);
  } catch (error) {
    console.error('Error fetching top tracks by time:', error);
    res.status(500).json({ error: 'Failed to fetch top tracks by time range', message: error.message });
  }
});

/**
 * GET /api/stats/top-artists-by-time
 * Get top artists from Spotify for specific time range
 * Query params: time_range (short_term, medium_term, long_term), limit
 */
router.get('/top-artists-by-time', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/stats/top-artists-by-time');
  });

  try {
    const { time_range = 'medium_term', limit = 20 } = req.query;
    const validTimeRanges = ['short_term', 'medium_term', 'long_term'];
    
    if (!validTimeRanges.includes(time_range)) {
      return res.status(400).json({ 
        error: 'Invalid time_range', 
        validOptions: validTimeRanges 
      });
    }

    const analysisService = new AnalysisService(req.user);
    const artists = await analysisService.getTopArtistsFromSpotify(time_range, parseInt(limit));
    
    // Set cache control headers to help with client-side caching
    const timestamp = new Date().toISOString();
    res.set('X-Data-Timestamp', timestamp);
    res.set('Cache-Control', 'no-cache'); // For now, to prevent any caching issues
    
    res.json(artists);
  } catch (error) {
    console.error('Error fetching top artists by time:', error);
    res.status(500).json({ error: 'Failed to fetch top artists by time range', message: error.message });
  }
});

export default router;

