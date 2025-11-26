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
    
    try {
      console.log(`[DEBUG] Attempting to fetch audio features for ${trackId}`);
      const response = await this.makeRequestWithRetry(() =>
        axiosInstance.get(`https://api.spotify.com/v1/audio-features/${trackId}`, { headers })
      );
      
      console.log(`[DEBUG] Raw audio features response for ${trackId}:`, {
        status: response.status,
        statusText: response.statusText,
        hasData: !!response.data,
        id: response.data.id,
        dataKeys: response.data ? Object.keys(response.data) : []
      });
      
      return response.data;
    } catch (error) {
      console.error(`[ERROR] Error fetching audio features for track ${trackId}:`, error.message);
      console.error(`[ERROR] Error details:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Get audio analysis for a track
   * @param {string} trackId
   */
  async getAudioAnalysis(trackId) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    
    try {
      console.log(`[DEBUG] Attempting to fetch audio analysis for ${trackId}`);
      const response = await this.makeRequestWithRetry(() =>
        axiosInstance.get(`https://api.spotify.com/v1/audio-analysis/${trackId}`, { headers })
      );
      
      console.log(`[DEBUG] Raw audio analysis response for ${trackId}:`, {
        status: response.status,
        statusText: response.statusText,
        hasData: !!response.data,
        dataKeys: response.data ? Object.keys(response.data) : []
      });
      
      return response.data;
    } catch (error) {
      console.error(`[ERROR] Error fetching audio analysis for track ${trackId}:`, error.message);
      console.error(`[ERROR] Error details:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      throw error;
    }
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
    
    try {
      console.log(`[DEBUG] Attempting to fetch related artists for ${artistId}`);
      const response = await this.makeRequestWithRetry(() =>
        axiosInstance.get(`https://api.spotify.com/v1/artists/${artistId}/related-artists`, { headers })
      );
      
      console.log(`[DEBUG] Raw related artists response for ${artistId}:`, {
        status: response.status,
        statusText: response.statusText,
        hasData: !!response.data,
        hasArtists: !!response.data.artists,
        artistsCount: response.data.artists ? response.data.artists.length : 0,
        dataKeys: response.data ? Object.keys(response.data) : []
      });
      
      if (!response.data || !response.data.artists || response.data.artists.length === 0) {
        console.warn(`[WARN] No related artists found for artist ${artistId} in response`);
        return [];
      }
      
      // Format the response to match our standard format with error handling
      const formattedArtists = response.data.artists.map(artist => ({
        artistId: artist.id || 'unknown_id',
        name: artist.name || 'Unknown Artist',
        genres: artist.genres || [],
        imageUrl: artist.images?.[0]?.url || null,
        popularity: artist.popularity || 0,
      }));
      
      console.log(`[DEBUG] Formatted ${formattedArtists.length} related artists for ${artistId}`);
      
      return formattedArtists;
    } catch (error) {
      console.error(`[ERROR] Error fetching related artists for artist ${artistId}:`, error.message);
      console.error(`[ERROR] Error details:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
      // 对于404错误，这可能意味着艺术家没有相关艺术家，返回空数组
      if (error.response?.status === 404) {
        console.warn(`[WARN] No related artists found for artist ${artistId} (404 response)`);
        return [];
      }
      // 对于其他错误，抛出异常让上层处理
      throw error;
    }
  }
  
  /**
   * Get an artist's top tracks
   * @param {string} artistId - Spotify artist ID
   * @param {string} market - Optional market/territory (e.g. 'US', 'GB')
   */
  async getArtistTopTracks(artistId, market = 'US') {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    
    try {
      const response = await this.makeRequestWithRetry(() =>
        axiosInstance.get(`https://api.spotify.com/v1/artists/${artistId}/top-tracks`, {
          headers,
          params: { market },
        })
      );
      
      // Log the raw response for debugging
      console.log(`[DEBUG] Artist top tracks response for ${artistId}:`, {
        total: response.data.tracks?.length
      });
      
      if (!response.data.tracks || response.data.tracks.length === 0) {
        console.warn(`[WARN] No top tracks found for artist ${artistId}`);
        return [];
      }
      
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
    } catch (error) {
      console.error(`[ERROR] Error fetching top tracks for artist ${artistId}:`, error.message);
      throw error;
    }
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
    
    try {
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
      
      // Log the raw response for debugging
      console.log(`[DEBUG] Artist albums response for ${artistId}:`, {
        total: response.data.items?.length,
        href: response.data.href,
        next: response.data.next
      });
      
      if (!response.data.items || response.data.items.length === 0) {
        console.warn(`[WARN] No albums found for artist ${artistId}`);
        return [];
      }
      
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
    } catch (error) {
      console.error(`[ERROR] Error fetching albums for artist ${artistId}:`, error.message);
      throw error;
    }
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
   * Get user's followed artists
   * @param {number} limit - Number of artists to return (max 50)
   * @param {number} after - The last artist ID retrieved in the previous request
   */
  async getUserFollowedArtists(limit = 50, after = null) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    
    const params = { type: 'artist', limit };
    if (after) {
      params.after = after;
    }
    
    try {
      const response = await this.makeRequestWithRetry(() =>
        axiosInstance.get('https://api.spotify.com/v1/me/following', {
          headers,
          params
        })
      );

      // Debug log to see the actual response structure
      console.log('[DEBUG] getUserFollowedArtists response:', {
        status: response.status,
        statusText: response.statusText,
        hasData: !!response.data,
        dataKeys: response.data ? Object.keys(response.data) : [],
        hasArtists: !!response.data?.artists,
        artistsKeys: response.data?.artists ? Object.keys(response.data.artists) : []
      });

      // Check if response has the expected structure
      if (!response.data || !response.data.artists || !response.data.artists.items) {
        console.error('[ERROR] Unexpected response structure from Spotify API:', response.data);
        // If response contains error information, return empty array
        if (response.data && response.data.error) {
          console.error('[ERROR] Spotify API error:', response.data.error);
        }
        return []; // Return empty array instead of throwing error
      }

      // Format response to match our standard format
      return response.data.artists.items.map(artist => ({
        artistId: artist.id || 'unknown_id',
        name: artist.name || 'Unknown Artist',
        genres: artist.genres || [],
        imageUrl: artist.images?.[0]?.url || null,
        followers: artist.followers?.total || 0,
        popularity: artist.popularity || 0,
      }));
    } catch (error) {
      console.error('[ERROR] Failed to fetch followed artists from Spotify:', error.message);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        code: error.code,
        status: error.response?.status,
        data: error.response?.data
      });
      // Return empty array instead of throwing error to prevent 500
      return [];
    }
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
  
  /**
   * Get user's saved tracks (liked/favorited tracks)
   * @param {number} limit - Number of tracks to return (max 50)
   * @param {number} offset - The index of the first track to return
   */
  async getUserSavedTracks(limit = 50, offset = 0) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get('https://api.spotify.com/v1/me/tracks', {
        headers,
        params: { limit, offset }
      })
    );

    // Format response to match our standard format
    return response.data.items.map(item => {
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
        addedAt: item.added_at ? new Date(item.added_at) : null,
        duration: track.duration_ms || 0,
        popularity: track.popularity || 0,
      };
    });
  }
  
  /**
   * Check if user has saved tracks (liked/favorited)
   * @param {string[]} trackIds - Array of Spotify track IDs
   */
  async checkUserSavedTracks(trackIds) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    const response = await this.makeRequestWithRetry(() =>
      axiosInstance.get('https://api.spotify.com/v1/me/tracks/contains', {
        headers,
        params: { 
          ids: trackIds.join(',')
        },
      })
    );
    
    return response.data; // Returns array of booleans in same order as input IDs
  }
  
  /**
   * Save tracks to user's library (like/favorite tracks)
   * @param {string[]} trackIds - Array of Spotify track IDs to save
   */
  async saveTracks(trackIds) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    
    await this.makeRequestWithRetry(() =>
      axiosInstance.put('https://api.spotify.com/v1/me/tracks', 
        { ids: trackIds },
        { headers }
      )
    );
    
    return { success: true };
  }
  
  /**
   * Remove tracks from user's library (unlike/unfavorite tracks)
   * @param {string[]} trackIds - Array of Spotify track IDs to remove
   */
  async removeTracks(trackIds) {
    const headers = await this.getAuthHeaders();
    const axiosInstance = this.getAxiosInstance();
    
    await this.makeRequestWithRetry(() =>
      axiosInstance.delete('https://api.spotify.com/v1/me/tracks', 
        { 
          headers,
          data: { ids: trackIds }
        }
      )
    );
    
    return { success: true };
  }
}

