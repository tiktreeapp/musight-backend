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
   * Create axios instance with default timeout
   */
  getAxiosInstance() {
    return axios.create({
      timeout: 10000, // 10 second timeout for all requests
    });
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
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() => 
      axiosInstance.get('https://api.spotify.com/v1/me', { headers })
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

    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get('https://api.spotify.com/v1/me/player/recently-played', {
        headers,
        params,
      })
    );

    return response.data.items.map(item => {
      // Ensure required fields are always present with fallback values
      const track = item.track || {};
      const artistName = track.artists && Array.isArray(track.artists) 
        ? track.artists.map(a => a.name || 'Unknown Artist').join(', ') 
        : 'Unknown Artist';
      const artistIds = track.artists && Array.isArray(track.artists)
        ? track.artists.map(a => a.id || 'unknown_id')
        : [];
      
      return {
        trackId: track.id || 'unknown_id',
        name: track.name || 'Unknown Track',
        artist: artistName,
        artistIds: artistIds,
        imageUrl: track.album?.images?.[0]?.url || null,
        previewUrl: track.preview_url || null,
        playedAt: new Date(item.played_at),
        duration: track.duration_ms || 0,
        popularity: track.popularity || 0,
      };
    });
  }

  /**
   * Get user's top tracks
   * @param {string} timeRange - 'short_term', 'medium_term', 'long_term'
   * @param {number} limit - Number of tracks (max 50)
   */
  async getTopTracks(timeRange = 'medium_term', limit = 50) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get('https://api.spotify.com/v1/me/top/tracks', {
        headers,
        params: { time_range: timeRange, limit },
      })
    );

    return response.data.items.map(track => {
      // Ensure required fields are always present with fallback values
      const artistName = track.artists && Array.isArray(track.artists) 
        ? track.artists.map(a => a.name || 'Unknown Artist').join(', ') 
        : 'Unknown Artist';
      const artistIds = track.artists && Array.isArray(track.artists)
        ? track.artists.map(a => a.id || 'unknown_id')
        : [];
      
      return {
        trackId: track.id || 'unknown_id',
        name: track.name || 'Unknown Track',
        artist: artistName,
        artistIds: artistIds,
        imageUrl: track.album?.images?.[0]?.url || null,
        previewUrl: track.preview_url || null,
        duration: track.duration_ms || 0,
        popularity: track.popularity || 0,
      };
    });
  }

  /**
   * Get user's top artists
   * @param {string} timeRange - 'short_term', 'medium_term', 'long_term'
   * @param {number} limit - Number of artists (max 50)
   */
  async getTopArtists(timeRange = 'medium_term', limit = 50) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get('https://api.spotify.com/v1/me/top/artists', {
        headers,
        params: { time_range: timeRange, limit },
      })
    );

    return response.data.items.map(artist => ({
      artistId: artist.id || 'unknown_id',
      name: artist.name || 'Unknown Artist',
      genres: artist.genres || [],
      imageUrl: artist.images?.[0]?.url || null,
      popularity: artist.popularity || 0,
    }));
  }

  /**
   * Get audio features for tracks
   * @param {string[]} trackIds - Array of track IDs (max 100)
   */
  async getAudioFeatures(trackIds) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get('https://api.spotify.com/v1/audio-features', {
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
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get(`https://api.spotify.com/v1/tracks/${trackId}`, { headers })
    );
    return response.data;
  }

  /**
   * Get audio features for a single track
   * @param {string} trackId
   */
  async getAudioFeaturesForTrack(trackId) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get(`https://api.spotify.com/v1/audio-features/${trackId}`, { headers })
    );
    return response.data;
  }

  /**
   * Get audio analysis for a track
   * @param {string} trackId
   */
  async getAudioAnalysis(trackId) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get(`https://api.spotify.com/v1/audio-analysis/${trackId}`, { headers })
    );
    return response.data;
  }

  /**
   * Get tracks from an album
   * @param {string} albumId
   * @param {number} limit - Number of tracks to return (max 50)
   * @param {number} offset - The index of the first track to return
   */
  async getAlbumTracks(albumId, limit = 50, offset = 0) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get(`https://api.spotify.com/v1/albums/${albumId}/tracks`, {
        headers,
        params: { limit, offset }
      })
    );

    return response.data.items.map(track => ({
      trackId: track.id,
      name: track.name,
      discNumber: track.disc_number,
      trackNumber: track.track_number,
      duration: track.duration_ms,
      explicit: track.explicit,
      previewUrl: track.preview_url || null,
      artists: track.artists.map(a => ({ id: a.id, name: a.name })),
    }));
  }
  
  /**
   * Get artist details
   * @param {string} artistId
   */
  async getArtist(artistId) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get(`https://api.spotify.com/v1/artists/${artistId}`, { headers })
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
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get('https://api.spotify.com/v1/me/playlists', {
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
  
  /**
   * Get related artists for a given artist
   * @param {string} artistId - Spotify artist ID
   */
  async getRelatedArtists(artistId) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get(`https://api.spotify.com/v1/artists/${artistId}/related-artists`, { headers })
    );
    
    // Format the response to match our standard format with error handling
    return response.data.artists.map(artist => ({
      artistId: artist.id || 'unknown_id',
      name: artist.name || 'Unknown Artist',
      genres: artist.genres || [],
      imageUrl: artist.images?.[0]?.url || null,
      popularity: artist.popularity || 0,
    }));
  }
  
  /**
   * Get an artist's top tracks
   * @param {string} artistId - Spotify artist ID
   * @param {string} market - Optional market/territory (e.g. 'US', 'GB')
   */
  async getArtistTopTracks(artistId, market = 'US') {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get(`https://api.spotify.com/v1/artists/${artistId}/top-tracks`, {
        headers,
        params: { market },
      })
    );
    
    // Format the response to match our standard format
    return response.data.tracks.map(track => {
      // Ensure required fields are always present with fallback values
      const artistName = track.artists && Array.isArray(track.artists) 
        ? track.artists.map(a => a.name || 'Unknown Artist').join(', ') 
        : 'Unknown Artist';
      const artistIds = track.artists && Array.isArray(track.artists)
        ? track.artists.map(a => a.id || 'unknown_id')
        : [];
      
      return {
        trackId: track.id || 'unknown_id',
        name: track.name || 'Unknown Track',
        artist: artistName,
        artistIds: artistIds,
        imageUrl: track.album?.images?.[0]?.url || null,
        duration: track.duration_ms || 0,
        popularity: track.popularity || 0,
        previewUrl: track.preview_url || null,
      };
    });
  }
  
  /**
   * Get an artist's albums
   * @param {string} artistId - Spotify artist ID
   * @param {string} includeGroups - Comma-separated album types to include (album, single, appears_on, compilation)
   * @param {string} market - Optional market/territory (e.g. 'US', 'GB')
   */
  async getArtistAlbums(artistId, includeGroups = 'album,single', market = 'US') {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get(`https://api.spotify.com/v1/artists/${artistId}/albums`, {
        headers,
        params: { 
          include_groups: includeGroups,
          market: market,
          limit: 50 // Max limit for this endpoint
        },
      })
    );
    
    // Format the response to match our standard format with error handling
    return response.data.items.map(album => {
      // Ensure required fields are always present with fallback values
      const artists = album.artists && Array.isArray(album.artists)
        ? album.artists.map(a => ({ 
            id: a.id || 'unknown_id', 
            name: a.name || 'Unknown Artist' 
          }))
        : [];
      
      return {
        albumId: album.id || 'unknown_id',
        name: album.name || 'Unknown Album',
        type: album.album_type || 'album',
        imageUrl: album.images?.[0]?.url || null,
        releaseDate: album.release_date || null,
        releaseDatePrecision: album.release_date_precision || null,
        totalTracks: album.total_tracks || 0,
        artists: artists,
      };
    });
  }
  
  /**
   * Follow an artist
   * @param {string} artistId - Spotify artist ID
   */
  async followArtist(artistId) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    
    // Note: For following artists, we need to send the artist IDs in the request body
    await this.makeRequestWithRetry(() =>
      axiosInstance.put(`https://api.spotify.com/v1/me/following`, 
        { ids: [artistId] },
        { 
          headers,
          params: { type: 'artist' }
        }
      )
    );
    
    return { success: true };
  }
  
  /**
   * Unfollow an artist
   * @param {string} artistId - Spotify artist ID
   */
  async unfollowArtist(artistId) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    
    await this.makeRequestWithRetry(() =>
      axiosInstance.delete(`https://api.spotify.com/v1/me/following`, 
        { 
          headers,
          params: { type: 'artist', ids: artistId }
        }
      )
    );
    
    return { success: true };
  }
  
  /**
   * Check if current user follows an artist
   * @param {string} artistIds - Array of Spotify artist IDs
   */
  async checkUserFollowingArtists(artistIds) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get(`https://api.spotify.com/v1/me/following/contains`, {
        headers,
        params: { 
          type: 'artist',
          ids: artistIds.join(',')
        },
      })
    );
    
    return response.data; // Returns array of booleans in same order as input IDs
  }
}

