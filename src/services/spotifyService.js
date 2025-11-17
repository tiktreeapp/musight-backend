import axios from 'axios';
import { getValidAccessToken } from '../utils/tokenManager.js';

/**
 * Spotify API Service
 * Handles all Spotify API requests
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
   * Get current user profile
   */
  async getCurrentUser() {
    const headers = await this.getAuthHeaders();
    const response = await axios.get('https://api.spotify.com/v1/me', { headers });
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

    const response = await axios.get('https://api.spotify.com/v1/me/player/recently-played', {
      headers,
      params,
    });

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
    const response = await axios.get('https://api.spotify.com/v1/me/top/tracks', {
      headers,
      params: { time_range: timeRange, limit },
    });

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
    const response = await axios.get('https://api.spotify.com/v1/me/top/artists', {
      headers,
      params: { time_range: timeRange, limit },
    });

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
    const response = await axios.get('https://api.spotify.com/v1/audio-features', {
      headers,
      params: { ids: trackIds.join(',') },
    });

    return response.data.audio_features;
  }

  /**
   * Get track details
   * @param {string} trackId
   */
  async getTrack(trackId) {
    const headers = await this.getAuthHeaders();
    const response = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, { headers });
    return response.data;
  }

  /**
   * Get artist details
   * @param {string} artistId
   */
  async getArtist(artistId) {
    const headers = await this.getAuthHeaders();
    const response = await axios.get(`https://api.spotify.com/v1/artists/${artistId}`, { headers });
    return response.data;
  }
}

