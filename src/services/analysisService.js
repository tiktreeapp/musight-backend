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
      const tracks = await this.spotifyService.getRecentlyPlayed(50, after);

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
   */
  async syncTopArtists() {
    try {
      const topArtists = await this.spotifyService.getTopArtists('medium_term', 50);

      // Clear existing top artists and save new ones
      await prisma.artistStat.deleteMany({
        where: { userId: this.user.id },
      });

      const savedArtists = [];
      for (const artist of topArtists) {
        const saved = await prisma.artistStat.create({
          data: {
            userId: this.user.id,
            artistId: artist.artistId,
            name: artist.name,
            genre: artist.genres?.[0] || null,
            imageUrl: artist.imageUrl,
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
    const artists = await prisma.artistStat.findMany({
      where: { userId: this.user.id },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return artists;
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
   * Get comprehensive dashboard data
   */
  async getDashboard() {
    const [stats, topArtists, recentTracks] = await Promise.all([
      this.getListeningStats('30d'),
      this.getTopArtists(10),
      this.getRecentTracks(20),
    ]);

    // Get Spotify top tracks for comparison
    let spotifyTopTracks = [];
    try {
      spotifyTopTracks = await this.spotifyService.getTopTracks('medium_term', 10);
    } catch (error) {
      console.error('Error fetching Spotify top tracks:', error);
    }

    return {
      stats,
      topArtists,
      recentTracks,
      spotifyTopTracks,
    };
  }
}

