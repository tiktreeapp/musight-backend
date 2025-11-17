import express from 'express';
import { verifyUserToken } from '../utils/tokenManager.js';
import { prisma, localCache, checkDatabase } from '../utils/dbFallback.js';

const router = express.Router();

/**
 * Middleware to authenticate requests
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    let token;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }

    if (!token || token.trim() === '') {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { verifyUserToken } = await import('../utils/tokenManager.js');
    const decoded = verifyUserToken(token);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Try database first, then fallback to just using userId
    try {
      const isDbAvailable = await checkDatabase();
      if (isDbAvailable) {
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
        });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        req.user = user;
      } else {
        // Use minimal user object when DB unavailable
        req.user = { id: decoded.userId };
      }
    } catch (error) {
      // Fallback to minimal user object
      req.user = { id: decoded.userId };
    }

    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    res.status(401).json({ error: 'Authentication failed', message: error.message });
  }
}

/**
 * GET /api/cache/list
 * List all cached data for the authenticated user
 */
router.get('/list', authenticate, async (req, res) => {
  try {
    const files = await localCache.listUserCaches(req.user.id);
    const dataTypes = files.map(file => 
      file.replace(`${req.user.id}_`, '').replace('.json', '')
    );
    
    res.json({
      userId: req.user.id,
      cachedTypes: dataTypes,
      files,
    });
  } catch (error) {
    console.error('Error listing cache:', error);
    res.status(500).json({ error: 'Failed to list cache' });
  }
});

/**
 * GET /api/cache/:dataType
 * Get cached data for a specific type
 */
router.get('/:dataType', authenticate, async (req, res) => {
  try {
    const { dataType } = req.params;
    const data = await localCache.load(req.user.id, dataType);
    
    if (!data) {
      return res.status(404).json({ error: 'Cache not found' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Error loading cache:', error);
    res.status(500).json({ error: 'Failed to load cache' });
  }
});

/**
 * POST /api/cache/import
 * Import cached data to database
 */
router.post('/import', authenticate, async (req, res) => {
  try {
    const isDbAvailable = await checkDatabase();
    if (!isDbAvailable) {
      return res.status(503).json({ 
        error: 'Database not available',
        message: 'Cannot import when database is unavailable' 
      });
    }

    const userId = req.user.id;
    const allCached = await localCache.loadAll(userId);
    
    const results = {
      imported: {},
      errors: {},
    };

    // Import profile if exists
    if (allCached.profile) {
      try {
        await prisma.musicProfile.upsert({
          where: { userId },
          create: {
            userId,
            topTracks: allCached.profile.topTracks || [],
            topArtists: allCached.profile.topArtists || [],
            genreDist: allCached.profile.genreDist || {},
            avgEnergy: allCached.profile.avgEnergy,
            avgValence: allCached.profile.avgValence,
          },
          update: {
            topTracks: allCached.profile.topTracks || [],
            topArtists: allCached.profile.topArtists || [],
            genreDist: allCached.profile.genreDist || {},
            avgEnergy: allCached.profile.avgEnergy,
            avgValence: allCached.profile.avgValence,
          },
        });
        results.imported.profile = true;
      } catch (error) {
        results.errors.profile = error.message;
      }
    }

    // Import tracks if exists
    if (allCached.recentTracks && Array.isArray(allCached.recentTracks)) {
      try {
        let importedCount = 0;
        for (const track of allCached.recentTracks) {
          try {
            await prisma.trackStat.upsert({
              where: {
                userId_trackId_playedAt: {
                  userId,
                  trackId: track.trackId,
                  playedAt: new Date(track.playedAt),
                },
              },
              create: {
                userId,
                trackId: track.trackId,
                name: track.name,
                artist: track.artist,
                imageUrl: track.imageUrl,
                playedAt: new Date(track.playedAt),
                duration: track.duration,
                popularity: track.popularity,
              },
              update: {},
            });
            importedCount++;
          } catch (error) {
            // Ignore duplicate errors
            if (error.code !== 'P2002') {
              throw error;
            }
          }
        }
        results.imported.tracks = importedCount;
      } catch (error) {
        results.errors.tracks = error.message;
      }
    }

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    console.error('Error importing cache:', error);
    res.status(500).json({ error: 'Failed to import cache', message: error.message });
  }
});

/**
 * DELETE /api/cache/:dataType
 * Delete cached data for a specific type
 */
router.delete('/:dataType', authenticate, async (req, res) => {
  try {
    const { dataType } = req.params;
    await localCache.delete(req.user.id, dataType);
    res.json({ success: true, message: `Cache ${dataType} deleted` });
  } catch (error) {
    console.error('Error deleting cache:', error);
    res.status(500).json({ error: 'Failed to delete cache' });
  }
});

export default router;

