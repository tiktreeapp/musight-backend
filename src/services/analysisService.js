import { PrismaClient } from '@prisma/client';
import { SpotifyService } from './spotifyService.js';

const prisma = new PrismaClient();

/**
 * Analysis Service
 * Provides music listening analytics and insights
 */
export class AnalysisService {
  constructor(user) {
    this.user = user;
    this.spotifyService = new SpotifyService(user);
  }

  /**
   * Sync recently played tracks from Spotify
   */
  async syncRecentlyPlayed() {
    try {
      // Get the last sync time (most recent track's playedAt)
      const lastTrack = await prisma.trackStat.findFirst({
        where: { userId: this.user.id },
        orderBy: { playedAt: 'desc' },
      });

      const after = lastTrack ? lastTrack.playedAt.getTime() : null;
      // Use a promise with timeout to ensure the call doesn't hang
      const tracks = await Promise.race([
        this.spotifyService.getRecentlyPlayed(50, after),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout fetching recently played tracks')), 25000)
        )
      ]);

      // Save new tracks
      const savedTracks = [];
      for (const track of tracks) {
        // Skip if already exists
        const existing = await prisma.trackStat.findFirst({
          where: {
            userId: this.user.id,
            trackId: track.trackId,
            playedAt: track.playedAt,
          },
        });

        if (!existing) {
          const saved = await prisma.trackStat.create({
            data: {
              userId: this.user.id,
              trackId: track.trackId,
              name: track.name,
              artist: track.artist,
              imageUrl: track.imageUrl,
              playedAt: track.playedAt,
              duration: track.duration,
              popularity: track.popularity,
            },
          });
          savedTracks.push(saved);
        }
      }

      return {
        synced: savedTracks.length,
        total: tracks.length,
      };
    } catch (error) {
      console.error('Error syncing recently played:', error);
      throw error;
    }
  }

  /**
   * Sync top artists from Spotify
   * Uses upsert to accumulate playCount instead of replacing
   */
  async syncTopArtists(timeRange = 'medium_term', limit = 50) {
    try {
      // Use a promise with timeout to ensure the call doesn't hang
      const topArtists = await Promise.race([
        this.spotifyService.getTopArtists(timeRange, limit),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout fetching top artists')), 25000)
        )
      ]);

      const savedArtists = [];
      for (const artist of topArtists) {
        // Upsert: if exists, increment playCount; if not, create with playCount = 1
        const saved = await prisma.artistStat.upsert({
          where: {
            userId_artistId: {
              userId: this.user.id,
              artistId: artist.artistId,
            },
          },
          create: {
            userId: this.user.id,
            artistId: artist.artistId,
            name: artist.name,
            genres: artist.genres || [],
            imageUrl: artist.imageUrl,
            playCount: 1,
          },
          update: {
            name: artist.name,
            genres: artist.genres || [],
            imageUrl: artist.imageUrl,
            playCount: {
              increment: 1,
            },
          },
        });
        savedArtists.push(saved);
      }

      return {
        synced: savedArtists.length,
      };
    } catch (error) {
      console.error('Error syncing top artists:', error);
      throw error;
    }
  }

  /**
   * Sync top tracks from Spotify and cache audio features
   * @param {string} timeRange - 'short_term', 'medium_term', 'long_term'
   * @param {number} limit - Number of tracks to fetch (max 50)
   */
  async syncTopTracks(timeRange = 'medium_term', limit = 50) {
    try {
      // Use a promise with timeout to ensure the call doesn't hang
      const topTracks = await Promise.race([
        this.spotifyService.getTopTracks(timeRange, limit),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout fetching top tracks')), 25000)
        )
      ]);

      const trackIds = topTracks.map(t => t.trackId);
      const tracksMap = new Map(topTracks.map(t => [t.trackId, t]));

      // Update existing TrackStat records or create new ones for top tracks
      // We use a fixed "top tracks" timestamp to avoid duplicate entries
      const topTracksTimestamp = new Date('2000-01-01'); // Fixed date for top tracks
      const savedTracks = [];
      
      for (const track of topTracks) {
        // Check if track exists in TrackStat (from recently-played or previous sync)
        const existing = await prisma.trackStat.findFirst({
          where: {
            userId: this.user.id,
            trackId: track.trackId,
          },
          orderBy: { playedAt: 'desc' },
        });

        if (existing) {
          // Update existing record with latest info
          await prisma.trackStat.updateMany({
            where: {
              userId: this.user.id,
              trackId: track.trackId,
            },
            data: {
              name: track.name,
              artist: track.artist,
              imageUrl: track.imageUrl || existing.imageUrl,
              duration: track.duration || existing.duration,
              popularity: track.popularity || existing.popularity,
            },
          });
        } else {
          // Create new record for top track (if it doesn't exist from recently-played)
          try {
            const saved = await prisma.trackStat.create({
              data: {
                userId: this.user.id,
                trackId: track.trackId,
                name: track.name,
                artist: track.artist,
                imageUrl: track.imageUrl,
                playedAt: topTracksTimestamp, // Use fixed timestamp
                duration: track.duration,
                popularity: track.popularity,
              },
            });
            savedTracks.push(saved);
          } catch (error) {
            // Ignore unique constraint violations
            if (!error.code || error.code !== 'P2002') {
              throw error;
            }
          }
        }
      }

      // Fetch audio features in batches (max 100 per request)
      const audioFeaturesMap = new Map();
      const batchSize = 100;
      
      for (let i = 0; i < trackIds.length; i += batchSize) {
        const batch = trackIds.slice(i, i + batchSize);
        try {
          // Use a promise with timeout to ensure the call doesn't hang
          const features = await Promise.race([
            this.spotifyService.getAudioFeatures(batch),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Timeout fetching audio features for batch ${i}-${i + batchSize}`)), 25000)
            )
          ]);
          
          // Map features by track ID
          features.forEach((feature, index) => {
            if (feature && feature.id) {
              audioFeaturesMap.set(feature.id, feature);
            }
          });

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Error fetching audio features for batch ${i}-${i + batchSize}:`, error.message);
          // Continue with next batch even if one fails
        }
      }

      // Update tracks with audio features
      let updatedCount = 0;
      for (const trackId of trackIds) {
        const features = audioFeaturesMap.get(trackId);
        if (features) {
          try {
            await prisma.trackStat.updateMany({
              where: {
                userId: this.user.id,
                trackId: trackId,
              },
              data: {
                danceability: features.danceability || null,
                energy: features.energy || null,
                valence: features.valence || null,
                tempo: features.tempo || null,
              },
            });
            updatedCount++;
          } catch (error) {
            console.error(`Error updating audio features for track ${trackId}:`, error.message);
          }
        }
      }

      return {
        synced: savedTracks.length,
        total: topTracks.length,
        audioFeaturesUpdated: updatedCount,
      };
    } catch (error) {
      console.error('Error syncing top tracks:', error);
      throw error;
    }
  }

  /**
   * Comprehensive sync function that syncs all user playback data
   * Syncs recently-played, top tracks, top artists, and builds music profile
   * @param {string} timeRange - 'short_term', 'medium_term', 'long_term' for top data
   */
  async syncUserPlayback(timeRange = 'medium_term') {
    try {
      console.log(`Starting sync for user ${this.user.id}...`);

      // 1. Sync recently played tracks
      const recentResult = await this.syncRecentlyPlayed();
      console.log(`Synced ${recentResult.synced} new recently-played tracks`);

      // 2. Sync top tracks and cache audio features
      const tracksResult = await this.syncTopTracks(timeRange, 50);
      console.log(`Synced ${tracksResult.synced} top tracks, updated ${tracksResult.audioFeaturesUpdated} audio features`);

      // 3. Sync top artists
      const artistsResult = await this.syncTopArtists(timeRange, 50);
      console.log(`Synced ${artistsResult.synced} top artists`);

      // 4. Build music profile
      await this.buildMusicProfile();

      return {
        recent: recentResult,
        tracks: tracksResult,
        artists: artistsResult,
      };
    } catch (error) {
      console.error('Error in syncUserPlayback:', error);
      throw error;
    }
  }

  /**
   * Get listening statistics
   */
  async getListeningStats(timeRange = '7d') {
    const now = new Date();
    let startDate;

    switch (timeRange) {
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
        startDate = new Date(0);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const tracks = await prisma.trackStat.findMany({
      where: {
        userId: this.user.id,
        playedAt: { gte: startDate },
      },
      orderBy: { playedAt: 'desc' },
    });

    // Calculate total listening time
    const totalMs = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
    const totalMinutes = Math.floor(totalMs / 60000);
    const totalHours = Math.floor(totalMinutes / 60);

    // Get unique tracks and artists
    const uniqueTracks = new Set(tracks.map(t => t.trackId)).size;
    const uniqueArtists = new Set(tracks.map(t => t.artist)).size;

    // Get most played tracks
    const trackCounts = {};
    tracks.forEach(track => {
      const key = `${track.trackId}-${track.name}`;
      if (!trackCounts[key]) {
        trackCounts[key] = {
          trackId: track.trackId,
          name: track.name,
          artist: track.artist,
          imageUrl: track.imageUrl,
          count: 0,
        };
      }
      trackCounts[key].count++;
    });

    const topTracks = Object.values(trackCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get most played artists
    const artistCounts = {};
    tracks.forEach(track => {
      if (!artistCounts[track.artist]) {
        artistCounts[track.artist] = { name: track.artist, count: 0 };
      }
      artistCounts[track.artist].count++;
    });

    const topArtists = Object.values(artistCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Listening activity by hour
    const hourlyActivity = new Array(24).fill(0);
    tracks.forEach(track => {
      const hour = track.playedAt.getHours();
      hourlyActivity[hour]++;
    });

    return {
      timeRange,
      totalTracks: tracks.length,
      uniqueTracks,
      uniqueArtists,
      totalListeningTime: {
        hours: totalHours,
        minutes: totalMinutes % 60,
        totalMs,
      },
      topTracks,
      topArtists,
      hourlyActivity,
      firstTrack: tracks[tracks.length - 1] || null,
      lastTrack: tracks[0] || null,
    };
  }

  /**
   * Get top artists from database
   */
  async getTopArtists(limit = 20) {
    // If database not available, fetch from Spotify
    if (!prisma) {
      console.warn('Database not available, fetching top artists from Spotify');
      return await this.spotifyService.getTopArtists('medium_term', limit);
    }

    try {
      const artists = await prisma.artistStat.findMany({
        where: { userId: this.user.id },
        take: limit,
        orderBy: { playCount: 'desc' }, // Order by playCount instead of createdAt
      });

      // Ensure imageUrl is present in all artists
      return artists.map(artist => ({
        id: artist.id,
        artistId: artist.artistId,
        name: artist.name,
        genres: artist.genres || [],
        imageUrl: artist.imageUrl || null,
        playCount: artist.playCount || 0,
        createdAt: artist.createdAt,
        updatedAt: artist.updatedAt,
      }));
    } catch (error) {
      console.error('Error fetching top artists from database, falling back to Spotify:', error);
      // Fallback to Spotify if database query fails
      return await this.spotifyService.getTopArtists('medium_term', limit);
    }
  }

  /**
   * Get recent tracks
   */
  async getRecentTracks(limit = 50) {
    const tracks = await prisma.trackStat.findMany({
      where: { userId: this.user.id },
      take: limit,
      orderBy: { playedAt: 'desc' },
    });

    return tracks;
  }

  /**
   * Build user's music profile from aggregated data
   * Aggregates top tracks, top artists, genre distribution, and audio features
   */
  async buildMusicProfile() {
    try {
      // 1. Get top tracks from TrackStat (aggregated by play count)
      const allTracks = await prisma.trackStat.findMany({
        where: { userId: this.user.id },
        select: {
          trackId: true,
          name: true,
          artist: true,
          imageUrl: true,
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
            plays: 0,
          };
        }
        trackCounts[key].plays++;
      });

      const topTracks = Object.values(trackCounts)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 20);

      // 2. Get top artists from ArtistStat (ordered by playCount)
      const topArtists = await prisma.artistStat.findMany({
        where: { userId: this.user.id },
        orderBy: { playCount: 'desc' },
        take: 20,
        select: {
          artistId: true,
          name: true,
          genres: true,
          imageUrl: true,
          playCount: true,
        },
      });

      const topArtistsJson = topArtists.map(artist => ({
        artistId: artist.artistId,
        name: artist.name,
        plays: artist.playCount,
        genres: artist.genres,
        imageUrl: artist.imageUrl,
      }));

      // 3. Calculate genre distribution (weighted by artist playCount)
      const genreWeights = {};
      let totalGenreWeight = 0;

      topArtists.forEach(artist => {
        const weight = artist.playCount || 1;
        totalGenreWeight += weight * (artist.genres?.length || 1);

        artist.genres?.forEach(genre => {
          if (!genreWeights[genre]) {
            genreWeights[genre] = 0;
          }
          genreWeights[genre] += weight;
        });
      });

      // Normalize to percentages
      const genreDist = {};
      if (totalGenreWeight > 0) {
        Object.keys(genreWeights).forEach(genre => {
          genreDist[genre] = genreWeights[genre] / totalGenreWeight;
        });
      }

      // Sort genres by weight (descending)
      const sortedGenres = Object.entries(genreDist)
        .sort((a, b) => b[1] - a[1])
        .reduce((acc, [genre, weight]) => {
          acc[genre] = weight;
          return acc;
        }, {});

      // 4. Calculate average energy and valence (weighted by play count)
      const tracksWithFeatures = await prisma.trackStat.findMany({
        where: {
          userId: this.user.id,
          energy: { not: null },
          valence: { not: null },
        },
        select: {
          energy: true,
          valence: true,
        },
      });

      let totalEnergy = 0;
      let totalValence = 0;
      let totalWeight = 0;

      // For weighted average, we can use play count as weight
      // Since we don't have play count per track in TrackStat, we'll use equal weights
      // Or we can count occurrences (each TrackStat record = one play)
      const trackFeatureMap = {};
      allTracks.forEach(track => {
        if (!trackFeatureMap[track.trackId]) {
          trackFeatureMap[track.trackId] = { plays: 0, energy: null, valence: null };
        }
        trackFeatureMap[track.trackId].plays++;
      });

      // Get features for tracks
      const tracksWithEnergyValence = await prisma.trackStat.findMany({
        where: {
          userId: this.user.id,
          energy: { not: null },
          valence: { not: null },
        },
        select: {
          trackId: true,
          energy: true,
          valence: true,
        },
      });

      // Calculate weighted average
      tracksWithEnergyValence.forEach(track => {
        const plays = trackFeatureMap[track.trackId]?.plays || 1;
        const weight = plays;
        totalEnergy += (track.energy || 0) * weight;
        totalValence += (track.valence || 0) * weight;
        totalWeight += weight;
      });

      const avgEnergy = totalWeight > 0 ? totalEnergy / totalWeight : null;
      const avgValence = totalWeight > 0 ? totalValence / totalWeight : null;

      // 5. Upsert MusicProfile
      const profile = await prisma.musicProfile.upsert({
        where: { userId: this.user.id },
        create: {
          userId: this.user.id,
          topTracks: topTracks,
          topArtists: topArtistsJson,
          genreDist: sortedGenres,
          avgEnergy: avgEnergy,
          avgValence: avgValence,
        },
        update: {
          topTracks: topTracks,
          topArtists: topArtistsJson,
          genreDist: sortedGenres,
          avgEnergy: avgEnergy,
          avgValence: avgValence,
        },
      });

      return profile;
    } catch (error) {
      console.error('Error building music profile:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive dashboard data
   */
  async getDashboard() {
    try {
      // Check if database is available for this user
      if (!prisma || this.user.id.startsWith('temp_')) {
        // For temp users or when database is not available, fetch directly from Spotify
        console.log(`Database not available for user ${this.user.id}, fetching from Spotify`);
        
        const [stats, topArtists, recentTracks, spotifyTopTracks] = await Promise.all([
          // Create basic stats based on recent tracks
          (async () => {
            const recent = await this.spotifyService.getRecentlyPlayed(50);
            return {
              timeRange: '30d',
              totalTracks: recent.length,
              uniqueTracks: new Set(recent.map(t => t.trackId)).size,
              uniqueArtists: new Set(recent.map(t => t.artist)).size,
              totalListeningTime: { 
                hours: 0, 
                minutes: 0, 
                totalMs: recent.reduce((sum, track) => sum + (track.duration || 0), 0) 
              },
              topTracks: recent.slice(0, 10),
              topArtists: [], // Will be filled from topArtists below
              hourlyActivity: new Array(24).fill(0),
              firstTrack: recent[recent.length - 1] || null,
              lastTrack: recent[0] || null,
            };
          })().catch(() => ({
            timeRange: '30d',
            totalTracks: 0,
            uniqueTracks: 0,
            uniqueArtists: 0,
            totalListeningTime: { hours: 0, minutes: 0, totalMs: 0 },
            topTracks: [],
            topArtists: [],
            hourlyActivity: new Array(24).fill(0),
            firstTrack: null,
            lastTrack: null,
          })),
          this.spotifyService.getTopArtists('medium_term', 10).catch(() => []),
          this.spotifyService.getRecentlyPlayed(20).catch(() => []),
          this.spotifyService.getTopTracks('medium_term', 10).catch(() => [])
        ]);

        return {
          stats,
          topArtists: topArtists.map(artist => ({
            id: artist.artistId,
            artistId: artist.artistId,
            name: artist.name,
            genres: artist.genres || [],
            imageUrl: artist.imageUrl || null,
            playCount: artist.playCount || 0,
          })),
          recentTracks,
          spotifyTopTracks,
        };
      }

      // Use database for regular users
      const [stats, topArtists, recentTracks] = await Promise.all([
        this.getListeningStats('30d'),
        this.getTopArtists('10').catch(err => {
          console.error('Error fetching top artists for dashboard:', err);
          return []; // Return empty array if database query fails
        }),
        this.getRecentTracks(20),
      ]);

      // Get Spotify top tracks for comparison
      let spotifyTopTracks = [];
      try {
        // Use a promise with timeout to ensure the call doesn't hang
        spotifyTopTracks = await Promise.race([
          this.spotifyService.getTopTracks('medium_term', 10),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout fetching Spotify top tracks')), 25000)
          )
        ]);
      } catch (error) {
        console.error('Error fetching Spotify top tracks:', error);
        spotifyTopTracks = []; // Return empty array if Spotify API fails
      }

      return {
        stats,
        topArtists,
        recentTracks,
        spotifyTopTracks,
      };
    } catch (error) {
      console.error('Error in getDashboard:', error);
      // Return a safe fallback response
      return {
        stats: {
          timeRange: '30d',
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
      };
    }
  }
  
  /**
   * Get top tracks from Spotify for specific time range
   * @param {string} timeRange - 'short_term' (4 weeks), 'medium_term' (6 months), 'long_term' (years)
   * @param {number} limit - Number of tracks to return
   */
  async getTopTracksFromSpotify(timeRange = 'medium_term', limit = 20) {
    try {
      // Use a promise with timeout to ensure the call doesn't hang
      const tracks = await Promise.race([
        this.spotifyService.getTopTracks(timeRange, limit),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout fetching top tracks for time range: ${timeRange}`)), 25000)
        )
      ]);
      
      // Ensure consistent format with required fields
      return tracks.map(track => ({
        trackId: track.trackId,
        name: track.name,
        artist: track.artist,
        artistIds: track.artistIds || [],
        imageUrl: track.imageUrl || null,
        duration: track.duration || null,
        popularity: track.popularity || null,
      }));
    } catch (error) {
      console.error(`Error fetching top tracks from Spotify for time range ${timeRange}:`, error);
      throw error;
    }
  }
  
  /**
   * Get top artists from Spotify for specific time range
   * @param {string} timeRange - 'short_term' (4 weeks), 'medium_term' (6 months), 'long_term' (years)
   * @param {number} limit - Number of artists to return
   */
  async getTopArtistsFromSpotify(timeRange = 'medium_term', limit = 20) {
    try {
      // Use a promise with timeout to ensure the call doesn't hang
      const artists = await Promise.race([
        this.spotifyService.getTopArtists(timeRange, limit),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Timeout fetching top artists for time range: ${timeRange}`)), 25000)
        )
      ]);
      
      // Ensure consistent format with required fields
      // Spotify API returns artist with id field, but our service maps it to artistId
      return artists.map(artist => ({
        id: artist.artistId, // Use artistId which is the Spotify ID
        artistId: artist.artistId,
        name: artist.name,
        genres: artist.genres || [],
        imageUrl: artist.imageUrl || null,
        playCount: artist.playCount || 0,
        popularity: artist.popularity || null,
        createdAt: artist.createdAt || new Date().toISOString(),
        updatedAt: artist.updatedAt || new Date().toISOString(),
      }));
    } catch (error) {
      console.error(`Error fetching top artists from Spotify for time range ${timeRange}:`, error);
      throw error;
    }
  }
}

