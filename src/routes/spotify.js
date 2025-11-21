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
    // Ensure consistent format with previewUrl
    const formattedTracks = tracks.map(track => ({
      trackId: track.trackId,
      name: track.name,
      artist: track.artist,
      artistIds: track.artistIds || [],
      imageUrl: track.imageUrl || null,
      previewUrl: track.previewUrl || null,
      playedAt: track.playedAt,
      duration: track.duration || null,
      popularity: track.popularity || null,
    }));
    res.json(formattedTracks);
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
    
    // Ensure consistent format with imageUrl and previewUrl
    const formattedTracks = tracks.map(track => ({
      trackId: track.trackId,
      name: track.name,
      artist: track.artist,
      artistIds: track.artistIds || [],
      imageUrl: track.imageUrl || null,
      previewUrl: track.previewUrl || null,
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
 * GET /api/spotify/track/:trackId/audio-features
 * Get audio features for a track
 */
router.get('/track/:trackId/audio-features', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/track/:trackId/audio-features');
  });

  try {
    const spotifyService = new SpotifyService(req.user);
    const audioFeatures = await spotifyService.getAudioFeaturesForTrack(req.params.trackId);
    res.json(audioFeatures);
  } catch (error) {
    console.error('Error fetching audio features:', error);
    res.status(500).json({ error: 'Failed to fetch audio features' });
  }
});

/**
 * GET /api/spotify/track/:trackId/audio-analysis
 * Get audio analysis for a track
 */
router.get('/track/:trackId/audio-analysis', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/track/:trackId/audio-analysis');
  });

  try {
    const spotifyService = new SpotifyService(req.user);
    const audioAnalysis = await spotifyService.getAudioAnalysis(req.params.trackId);
    res.json(audioAnalysis);
  } catch (error) {
    console.error('Error fetching audio analysis:', error);
    res.status(500).json({ error: 'Failed to fetch audio analysis' });
  }
});

/**
 * GET /api/spotify/track/:trackId/details
 * Get comprehensive track details including audio features, audio analysis, 
 * album tracks, and artist top tracks
 */
router.get('/track/:trackId/details', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(45000, () => { // 45 seconds timeout (longer for multiple API calls)
    console.error('Request timeout for /api/spotify/track/:trackId/details');
  });

  try {
    const spotifyService = new SpotifyService(req.user);
    const trackId = req.params.trackId;
    
    // Fetch data with individual error handling to prevent one failure from breaking the whole request
    let track, audioFeatures, audioAnalysis, albumTracks, artistTopTracks;
    
    try {
      track = await spotifyService.getTrack(trackId);
    } catch (trackError) {
      console.error('Error fetching track:', trackError);
      track = null;
    }
    
    try {
      audioFeatures = await spotifyService.getAudioFeaturesForTrack(trackId);
    } catch (audioFeaturesError) {
      console.error('Error fetching audio features:', audioFeaturesError);
      audioFeatures = null;
    }
    
    try {
      audioAnalysis = await spotifyService.getAudioAnalysis(trackId);
    } catch (audioAnalysisError) {
      console.error('Error fetching audio analysis:', audioAnalysisError);
      audioAnalysis = null;
    }
    
    // Extract album ID and artist ID from the track if available
    let albumId, artistId;
    if (track && track.album) {
      albumId = track.album.id;
    }
    if (track && track.artists && track.artists[0]) {
      artistId = track.artists[0].id;
    }
    
    // Fetch related data if IDs are available
    try {
      if (albumId) {
        albumTracks = await spotifyService.getAlbumTracks(albumId);
      } else {
        albumTracks = [];
      }
    } catch (albumError) {
      console.error('Error fetching album tracks:', albumError);
      albumTracks = [];
    }
    
    try {
      if (artistId) {
        artistTopTracks = await spotifyService.getArtistTopTracks(artistId);
      } else {
        artistTopTracks = [];
      }
    } catch (artistError) {
      console.error('Error fetching artist top tracks:', artistError);
      artistTopTracks = [];
    }
    
    // Return comprehensive track details (some may be null if individual requests failed)
    res.json({
      track: track,
      audioFeatures: audioFeatures,
      audioAnalysis: audioAnalysis ? {
        // Only return key sections of audio analysis to avoid huge payloads
        meta: audioAnalysis.meta,
        track: audioAnalysis.track,
        // Include only segments and sections as they are the most useful parts
        sections: audioAnalysis.sections || [],
        segments: audioAnalysis.segments || [],
        bars: audioAnalysis.bars || [],
        beats: audioAnalysis.beats || [],
        tatums: audioAnalysis.tatums || [],
        beats_count: audioAnalysis.beats ? audioAnalysis.beats.length : 0,
        sections_count: audioAnalysis.sections ? audioAnalysis.sections.length : 0,
      } : null,
      albumTracks: albumTracks,
      artistTopTracks: artistTopTracks,
    });
  } catch (error) {
    console.error('Error fetching comprehensive track details:', error);
    res.status(500).json({ error: 'Failed to fetch comprehensive track details', message: error.message });
  }
});

/**
 * GET /api/spotify/artist/:artistId/related
 * Get related/similar artists
 */
router.get('/artist/:artistId/related', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/artist/:artistId/related');
  });

  try {
    const spotifyService = new SpotifyService(req.user);
    const relatedArtists = await spotifyService.getRelatedArtists(req.params.artistId);
    res.json(relatedArtists);
  } catch (error) {
    console.error('Error fetching related artists:', error);
    res.status(500).json({ error: 'Failed to fetch related artists', message: error.message });
  }
});

/**
 * GET /api/spotify/artist/:artistId/top-tracks
 * Get artist's top tracks
 * Query params: market (default: US)
 */
router.get('/artist/:artistId/top-tracks', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/artist/:artistId/top-tracks');
  });

  try {
    const { market = 'US' } = req.query;
    const spotifyService = new SpotifyService(req.user);
    const topTracks = await spotifyService.getArtistTopTracks(req.params.artistId, market);
    res.json(topTracks);
  } catch (error) {
    console.error('Error fetching artist top tracks:', error);
    res.status(500).json({ error: 'Failed to fetch artist top tracks', message: error.message });
  }
});

/**
 * GET /api/spotify/artist/:artistId/albums
 * Get artist's albums
 * Query params: include_groups (default: 'album,single'), market (default: US)
 */
router.get('/artist/:artistId/albums', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/artist/:artistId/albums');
  });

  try {
    const { include_groups = 'album,single', market = 'US' } = req.query;
    const spotifyService = new SpotifyService(req.user);
    const albums = await spotifyService.getArtistAlbums(req.params.artistId, include_groups, market);
    res.json(albums);
  } catch (error) {
    console.error('Error fetching artist albums:', error);
    res.status(500).json({ error: 'Failed to fetch artist albums', message: error.message });
  }
});

/**
 * PUT /api/spotify/artist/:artistId/follow
 * Follow or unfollow an artist
 * Body: { action: 'follow' | 'unfollow' }
 */
router.put('/artist/:artistId/follow', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/artist/:artistId/follow');
  });

  try {
    const { action } = req.body;
    const spotifyService = new SpotifyService(req.user);
    
    if (action === 'follow') {
      await spotifyService.followArtist(req.params.artistId);
      res.json({ success: true, message: 'Artist followed successfully' });
    } else if (action === 'unfollow') {
      await spotifyService.unfollowArtist(req.params.artistId);
      res.json({ success: true, message: 'Artist unfollowed successfully' });
    } else {
      res.status(400).json({ error: 'Action must be "follow" or "unfollow"' });
    }
  } catch (error) {
    console.error('Error following/unfollowing artist:', error);
    res.status(500).json({ error: 'Failed to follow/unfollow artist', message: error.message });
  }
});

/**
 * GET /api/spotify/artist/:artistId/following
 * Check if user is following an artist
 */
router.get('/artist/:artistId/following', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/artist/:artistId/following');
  });

  try {
    const spotifyService = new SpotifyService(req.user);
    const isFollowing = await spotifyService.checkUserFollowingArtists([req.params.artistId]);
    res.json({ isFollowing: isFollowing[0] });
  } catch (error) {
    console.error('Error checking if user follows artist:', error);
    res.status(500).json({ error: 'Failed to check following status' });
  }
});

/**
 * GET /api/spotify/album/:albumId/tracks
 * Get tracks from an album
 * Query params: limit (default: 50), offset (default: 0)
 */
router.get('/album/:albumId/tracks', authenticate, async (req, res) => {
  // Set timeout for the entire request
  req.setTimeout(30000, () => { // 30 seconds timeout
    console.error('Request timeout for /api/spotify/album/:albumId/tracks');
  });

  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const spotifyService = new SpotifyService(req.user);
    const tracks = await spotifyService.getAlbumTracks(req.params.albumId, limit, offset);
    res.json(tracks);
  } catch (error) {
    console.error('Error fetching album tracks:', error);
    res.status(500).json({ error: 'Failed to fetch album tracks' });
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

