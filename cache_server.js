import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { LocalCache } from './src/utils/localCache.js';

dotenv.config();

const app = express();
const localCache = new LocalCache();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 简化的认证中间件（模拟）
function authenticate(req, res, next) {
  // 模拟一个用户，使用测试用户ID
  req.user = { id: 'test_user_123', spotifyId: 'test_spotify_user' };
  next();
}

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 用户信息端点
app.get('/api/user/me', authenticate, async (req, res) => {
  try {
    console.log(`[DEBUG] Fetching user data for ${req.user.id}`);
    
    // 尝试从缓存获取用户数据
    const cachedData = await localCache.load(req.user.id, 'profile');
    
    if (cachedData) {
      console.log(`[DEBUG] Found cached user data for ${req.user.id}`);
      res.json({
        id: req.user.id,
        spotifyId: req.user.spotifyId,
        displayName: 'Test User',
        avatarUrl: null,
        ...cachedData
      });
    } else {
      console.log(`[DEBUG] No cached user data found for ${req.user.id}`);
      res.json({
        id: req.user.id,
        spotifyId: req.user.spotifyId,
        displayName: 'Test User',
        avatarUrl: null
      });
    }
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// 仪表板数据端点
app.get('/api/stats/dashboard', authenticate, async (req, res) => {
  try {
    console.log(`[DEBUG] Fetching dashboard data for ${req.user.id}`);
    
    // 尝试从缓存获取仪表板数据
    const cachedData = await localCache.load(req.user.id, 'dashboard');
    
    if (cachedData) {
      console.log(`[DEBUG] Found cached dashboard data for ${req.user.id}`);
      res.json(cachedData);
    } else {
      console.log(`[DEBUG] No cached dashboard data found, returning empty data`);
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
          lastTrack: null
        },
        topArtists: [],
        recentTracks: [],
        spotifyTopTracks: []
      });
    }
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// 最近播放数据端点
app.get('/api/stats/recent', authenticate, async (req, res) => {
  try {
    console.log(`[DEBUG] Fetching recent data for ${req.user.id}`);
    
    const limit = parseInt(req.query.limit) || 50;
    
    // 尝试从缓存获取最近播放数据
    const cachedData = await localCache.load(req.user.id, 'recentTracks');
    
    if (cachedData) {
      console.log(`[DEBUG] Found cached recent tracks data for ${req.user.id}`);
      res.json(cachedData.slice(0, limit));
    } else {
      console.log(`[DEBUG] No cached recent tracks data found, returning empty array`);
      res.json([]);
    }
  } catch (error) {
    console.error('Error fetching recent tracks:', error);
    res.status(500).json({ error: 'Failed to fetch recent tracks' });
  }
});

// 音乐档案端点
app.get('/api/stats/profile', authenticate, async (req, res) => {
  try {
    console.log(`[DEBUG] Fetching profile data for ${req.user.id}`);
    
    // 尝试从缓存获取音乐档案数据
    const cachedData = await localCache.load(req.user.id, 'profile');
    
    if (cachedData) {
      console.log(`[DEBUG] Found cached profile data for ${req.user.id}`);
      res.json(cachedData);
    } else {
      console.log(`[DEBUG] No cached profile data found, returning empty profile`);
      res.json({
        topTracks: [],
        topArtists: [],
        genreDist: {},
        avgEnergy: null,
        avgValence: null,
        lastUpdated: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// 获取缓存状态的调试端点
app.get('/api/debug/cache/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const allCache = await localCache.loadAll(userId);
    res.json(allCache);
  } catch (error) {
    console.error('Error fetching cache:', error);
    res.status(500).json({ error: 'Failed to fetch cache' });
  }
});

// 测试缓存写入的端点
app.post('/api/debug/test-cache', authenticate, async (req, res) => {
  try {
    const testData = {
      topTracks: [
        { trackId: 'test1', name: 'Sample Track 1', artist: 'Sample Artist 1', plays: 10 },
        { trackId: 'test2', name: 'Sample Track 2', artist: 'Sample Artist 2', plays: 5 }
      ],
      topArtists: [
        { artistId: 'art1', name: 'Sample Artist 1', plays: 15 },
        { artistId: 'art2', name: 'Sample Artist 2', plays: 8 }
      ],
      lastUpdated: new Date().toISOString()
    };
    
    await localCache.save(req.user.id, 'profile', testData);
    await localCache.save(req.user.id, 'dashboard', {
      stats: {
        timeRange: '7d',
        totalTracks: 2,
        uniqueTracks: 2,
        uniqueArtists: 2,
        totalListeningTime: { hours: 1, minutes: 30, totalMs: 5400000 },
        topTracks: testData.topTracks,
        topArtists: testData.topArtists.map(a => ({...a, count: a.plays})),
        hourlyActivity: new Array(24).fill(0).map((_, i) => i % 3),
        firstTrack: { name: 'Sample Track 1' },
        lastTrack: { name: 'Sample Track 2' }
      },
      topArtists: testData.topArtists,
      recentTracks: [{ trackId: 'test1', name: 'Sample Track 1', artist: 'Sample Artist 1', playedAt: new Date() }],
      spotifyTopTracks: testData.topTracks
    });
    await localCache.save(req.user.id, 'recentTracks', [
      { trackId: 'test1', name: 'Sample Track 1', artist: 'Sample Artist 1', playedAt: new Date() },
      { trackId: 'test2', name: 'Sample Track 2', artist: 'Sample Artist 2', playedAt: new Date(Date.now() - 3600000) }
    ]);
    
    res.json({ message: 'Test data saved to cache', userId: req.user.id });
  } catch (error) {
    console.error('Error saving test data:', error);
    res.status(500).json({ error: 'Failed to save test data' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Musight Backend (Cache-Only Mode) running on port ${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   GET  /health - Health check`);
  console.log(`   GET  /api/user/me - Get user info`);
  console.log(`   GET  /api/stats/dashboard - Get dashboard data`);
  console.log(`   GET  /api/stats/recent - Get recent tracks`);
  console.log(`   GET  /api/stats/profile - Get music profile`);
  console.log(`   POST /api/debug/test-cache - Populate test cache data`);
  console.log(`   GET  /api/debug/cache/:userId - Debug cache contents`);
  console.log(`\n💡 To populate test data, call: POST /api/debug/test-cache with valid auth`);
});

export default app;