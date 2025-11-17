import axios from 'axios';
import { getValidAccessToken } from '../utils/tokenManager.js';

/**
 * Spotify API Service
 * Handles all Spotify API requests with rate limiting and error handling
 */
export class SpotifyService {
  constructor(user) {
    this.user = user;
  }

  /**
   * Get authenticated request headers
   */
  async getAuthHeaders() {
    const accessToken = await getValidAccessToken(this.user);
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Make a request with rate limiting and exponential backoff retry
   * @param {Function} requestFn - Function that returns a promise for the request
   * @param {number} maxRetries - Maximum number of retries (default: 3)
   * @param {number} baseDelay - Base delay in milliseconds (default: 1000)
   */
  async makeRequestWithRetry(requestFn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await requestFn();
        return response;
      } catch (error) {
        lastError = error;
        
        // Handle 429 (Too Many Requests) with exponential backoff
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'];
          const delay = retryAfter 
            ? parseInt(retryAfter) * 1000 
            : baseDelay * Math.pow(2, attempt);
          
          console.warn(`Rate limited. Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Handle 401 (Unauthorized) - token might be expired
        if (error.response?.status === 401) {
          console.warn('Token expired, refreshing...');
          // getValidAccessToken should handle refresh automatically
          // Retry once after a short delay
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          }
        }
        
        // For other errors, don't retry
        throw error;
      }
    }
    
    // If all retries failed, throw the last error
    throw lastError;
  }

  /**
   * Get current user profile
   */
  async getCurrentUser() {
    const headers = await this.getAuthHeaders();
    const response = await this.makeRequestWithRetry(() => 
      axios.get('https://api.spotify.com/v1/me', { headers })
    );
    return response.data;
  }

  /**
   * Get user's recently played tracks
   * @param {number} limit - Number of tracks to fetch (max 50)
   * @param {number} after - Unix timestamp in milliseconds
   */
  async getRecentlyPlayed(limit = 50, after = null) {
    const headers = await this.getAuthHeaders();
    const params = { limit };
    if (after) {
      params.after = after;
    }

    const response = await this.makeRequestWithRetry(() =>
      axios.get('https://api.spotify.com/v1/me/player/recently-played', {
        headers,
        params,
      })
    );

    return response.data.items.map(item => ({
      trackId: item.track.id,
      name: item.track.name,
      artist: item.track.artists.map(a => a.name).join(', '),
      artistIds: item.track.artists.map(a => a.id),
      imageUrl: item.track.album.images[0]?.url || null,
      playedAt: new Date(item.played_at),
      duration: item.track.duration_ms,
      popularity: item.track.popularity,
    }));
  }

  /**
   * Get user's top tracks
   * @param {string} timeRange - 'short_term', 'medium_term', 'long_term'
   * @param {number} limit - Number of tracks (max 50)
   */
  async getTopTracks(timeRange = 'medium_term', limit = 50) {
    const headers = await this.getAuthHeaders();
    const response = await this.makeRequestWithRetry(() =>
      axios.get('https://api.spotify.com/v1/me/top/tracks', {
        headers,
        params: { time_range: timeRange, limit },
      })
    );

    return response.data.items.map(track => ({
      trackId: track.id,
      name: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      artistIds: track.artists.map(a => a.id),
      imageUrl: track.album.images[0]?.url || null,
      duration: track.duration_ms,
      popularity: track.popularity,
    }));
  }

  /**
   * Get user's top artists
   * @param {string} timeRange - 'short_term', 'medium_term', 'long_term'
   * @param {number} limit - Number of artists (max 50)
   */
  async getTopArtists(timeRange = 'medium_term', limit = 50) {
    const headers = await this.getAuthHeaders();
    const response = await this.makeRequestWithRetry(() =>
      axios.get('https://api.spotify.com/v1/me/top/artists', {
        headers,
        params: { time_range: timeRange, limit },
      })
    );

    return response.data.items.map(artist => ({
      artistId: artist.id,
      name: artist.name,
      genres: artist.genres,
      imageUrl: artist.images[0]?.url || null,
      popularity: artist.popularity,
    }));
  }

  /**
   * Get audio features for tracks
   * @param {string[]} trackIds - Array of track IDs (max 100)
   */
  async getAudioFeatures(trackIds) {
    const headers = await this.getAuthHeaders();
    const response = await this.makeRequestWithRetry(() =>
      axios.get('https://api.spotify.com/v1/audio-features', {
        headers,
        params: { ids: trackIds.join(',') },
      })
    );

    return response.data.audio_features;
  }

  /**
   * Get track details
   * @param {string} trackId
   */
  async getTrack(trackId) {
    const headers = await this.getAuthHeaders();
    const response = await this.makeRequestWithRetry(() =>
      axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, { headers })
    );
    return response.data;
  }

  /**
   * Get artist details
   * @param {string} artistId
   */
  async getArtist(artistId) {
    const headers = await this.getAuthHeaders();
    const response = await this.makeRequestWithRetry(() =>
      axios.get(`https://api.spotify.com/v1/artists/${artistId}`, { headers })
    );
    return response.data;
  }

  /**
   * Get user's playlists
   * @param {number} limit - Number of playlists (max 50)
   * @param {number} offset - Offset for pagination
   */
  async getPlaylists(limit = 50, offset = 0) {
    const headers = await this.getAuthHeaders();
    const response = await this.makeRequestWithRetry(() =>
      axios.get('https://api.spotify.com/v1/me/playlists', {
        headers,
        params: { limit, offset },
      })
    );

    return response.data.items.map(playlist => ({
      playlistId: playlist.id,
      name: playlist.name,
      description: playlist.description,
      imageUrl: playlist.images[0]?.url || null,
      owner: playlist.owner.display_name,
      tracksCount: playlist.tracks.total,
      public: playlist.public,
    }));
  }

  /**
   * Get user's top playlists (most followed/public playlists)
   * This returns the user's playlists sorted by follower count
   */
  async getTopPlaylists(limit = 20) {
    const playlists = await this.getPlaylists(50, 0);
    // Sort by follower count if available, otherwise by tracks count
    return playlists
      .sort((a, b) => (b.tracksCount || 0) - (a.tracksCount || 0))
      .slice(0, limit);
  }
}

