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

    // Get ALL tracks from database (aggregated by play count across all time)
    const allTracks = await prisma.trackStat.findMany({
      where: { 
        userId: req.user.id 
      },
      orderBy: { playedAt: 'desc' }
    });
    
    // Group by track and count plays across all history
    const trackCounts = {};
    allTracks.forEach(track => {
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

    // Sort by play count (descending) and take top N
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
 * GET /api/stats/top-tracks-by-time
 * Get top tracks by specific time range
 * Query params: time_range (24h, 7d, 30d, all), limit
 */
router.get('/top-tracks-by-time', authenticate, async (req, res) => {
  try {
    const { time_range = 'all', limit = 20 } = req.query;
    const analysisService = new AnalysisService(req.user);

    // Get tracks based on time range from database
    const now = new Date();
    let startDate;

    switch (time_range) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        startDate = new Date(0); // All time
        break;
      default:
        // Default to 'all' if invalid time_range provided
        startDate = new Date(0);
    }

    // Get tracks from database within the specified time range
    const allTracks = await prisma.trackStat.findMany({
      where: {
        userId: req.user.id,
        playedAt: { gte: startDate },
      },
    });

    // Count plays per track
    const trackCounts = {};
    allTracks.forEach(track => {
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

    // Convert to array and sort by play count
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
    console.error('Error fetching top tracks by time:', error);
    res.status(500).json({ error: 'Failed to fetch top tracks by time range' });
  }
});

/**
 * GET /api/stats/top-artists-by-time
 * Get top artists by specific time range
 * Query params: time_range (24h, 7d, 30d, all), limit
 */
router.get('/top-artists-by-time', authenticate, async (req, res) => {
  try {
    const { time_range = 'all', limit = 20 } = req.query;
    const analysisService = new AnalysisService(req.user);

    // Get tracks based on time range from database
    const now = new Date();
    let startDate;

    switch (time_range) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        startDate = new Date(0); // All time
        break;
      default:
        // Default to 'all' if invalid time_range provided
        startDate = new Date(0);
    }

    // Get tracks from database within the specified time range
    const allTracks = await prisma.trackStat.findMany({
      where: {
        userId: req.user.id,
        playedAt: { gte: startDate },
      },
    });

    // Count plays per artist based on tracks
    const artistCounts = {};
    allTracks.forEach(track => {
      // Use artist name as key since we don't have artist IDs in trackStat
      const key = track.artist;
      if (!artistCounts[key]) {
        artistCounts[key] = {
          name: track.artist,
          artistId: null, // We don't have artistId in TrackStat, will try to get from ArtistStat if needed
          count: 0,
          lastPlayed: track.playedAt,
          imageUrl: track.imageUrl || null, // Use the imageUrl from any track by this artist
        };
      }
      artistCounts[key].count++;
      if (track.playedAt > artistCounts[key].lastPlayed) {
        artistCounts[key].lastPlayed = track.playedAt;
      }
    });
    
    // Try to get artist IDs and images from ArtistStat table if available
    // Use findMany to get all matching artists at once for better performance
    const artistNames = Object.keys(artistCounts);
    console.log(`[DEBUG] Looking for ${artistNames.length} artists in ArtistStat:`, artistNames.slice(0, 5)); // Log first 5 for debugging
    if (artistNames.length > 0) {
      try {
        const artistStats = await prisma.artistStat.findMany({
          where: {
            userId: req.user.id,
            name: { in: artistNames },
          },
          select: {
            name: true,
            artistId: true,
            imageUrl: true,
          }
        });
        
        console.log(`[DEBUG] Found ${artistStats.length} matching artists in ArtistStat`); // Debug log
        
        // Map the results back to artistCounts
        artistStats.forEach(artistStat => {
          if (artistCounts[artistStat.name]) {
            artistCounts[artistStat.name].artistId = artistStat.artistId;
            if (!artistCounts[artistStat.name].imageUrl) {
              artistCounts[artistStat.name].imageUrl = artistStat.imageUrl;
            }
          }
        });
        
        // Log which artists didn't get IDs
        const missingIds = Object.values(artistCounts).filter(artist => !artist.artistId);
        if (missingIds.length > 0) {
          console.log(`[DEBUG] ${missingIds.length} artists missing IDs:`, missingIds.slice(0, 5).map(a => a.name));
        }
      } catch (error) {
        // If ArtistStat query fails, continue with existing data
        console.warn('Could not fetch artist details from ArtistStat:', error.message);
      }
    }

    // Convert to array and sort by play count
    const topArtists = Object.values(artistCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, parseInt(limit));

    // Ensure all artists have required fields including imageUrl
    const formattedArtists = topArtists.map(artist => ({
      artistId: artist.artistId || null,
      name: artist.name,
      imageUrl: artist.imageUrl || null,
      count: artist.count || 0,
      plays: artist.count || 0, // Alias for count
      lastPlayed: artist.lastPlayed || null,
    }));

    res.json(formattedArtists);
  } catch (error) {
    console.error('Error fetching top artists by time:', error);
    res.status(500).json({ error: 'Failed to fetch top artists by time range' });
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
      async (prismaClient) => {
        // Safety check: ensure prismaClient is available
        if (!prismaClient) {
          console.error('Prisma client not available in profile fetch');
          return null; // Return null to trigger cache fallback
        }
        
        let profile = await prismaClient.musicProfile.findUnique({
          where: { userId },
        });

        // If profile doesn't exist, trigger sync and build
        if (!profile) {
          console.log(`Profile not found for user ${userId}, triggering sync...`);
          await analysisService.syncUserPlayback('medium_term');
          profile = await prismaClient.musicProfile.findUnique({
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

