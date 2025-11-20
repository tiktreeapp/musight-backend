import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { LocalCache } from './src/utils/localCache.js';
import { withCacheFallback, checkDatabase, resetDatabaseCheck } from './src/utils/dbFallback.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const localCache = new LocalCache();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 设置请求超时
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    console.error(`Request timeout for ${req.method} ${req.path}`);
  });
  next();
});

// 简化认证中间件
function authenticate(req, res, next) {
  // 这里应该实现实际的 JWT 验证
  // 为测试目的，我们使用固定用户
  req.user = { id: 'test_user_123', spotifyId: 'test_spotify_user' };
  next();
}

// 测试数据库连接的端点
app.get('/api/debug/connection', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ 
      database: 'connected', 
      timestamp: new Date().toISOString(),
      message: 'Database connection successful'
    });
  } catch (error) {
    res.json({ 
      database: 'failed',
      timestamp: new Date().toISOString(),
      message: 'Database connection failed: ' + error.message,
      usingCache: true
    });
  }
});

// 用户信息端点 (带缓存回退)
app.get('/api/user/me', authenticate, async (req, res) => {
  try {
    await withCacheFallback(
      async (db) => {
        const user = await db.user.findUnique({
          where: { id: req.user.id }
        });
        res.json(user);
      },
      async (cache) => {
        // 从缓存返回用户数据
        const cachedUser = await cache.load(req.user.id, 'user');
        res.json(cachedUser || {
          id: req.user.id,
          spotifyId: req.user.spotifyId,
          displayName: 'Test User',
          avatarUrl: null
        });
      },
      { userId: req.user.id, dataType: 'user', fallbackToCache: true }
    );
  } catch (error) {
    console.error('Error in /api/user/me:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// 仪表板数据端点 (带缓存回退)
app.get('/api/stats/dashboard', authenticate, async (req, res) => {
  try {
    await withCacheFallback(
      async (db) => {
        // 实际的数据库查询逻辑
        // 这里应该是完整的仪表板数据查询
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
      },
      async (cache) => {
        // 从缓存返回仪表板数据
        const cachedData = await cache.load(req.user.id, 'dashboard');
        if (cachedData) {
          res.json(cachedData);
        } else {
          // 返回空数据结构
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
      },
      { userId: req.user.id, dataType: 'dashboard', fallbackToCache: true }
    );
  } catch (error) {
    console.error('Error in /api/stats/dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// 最近播放数据端点 (带缓存回退)
app.get('/api/stats/recent', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    await withCacheFallback(
      async (db) => {
        const tracks = await db.trackStat.findMany({
          where: { userId: req.user.id },
          take: limit,
          orderBy: { playedAt: 'desc' }
        });
        res.json(tracks);
      },
      async (cache) => {
        const cachedData = await cache.load(req.user.id, 'recentTracks');
        if (cachedData) {
          res.json(cachedData.slice(0, limit));
        } else {
          res.json([]);
        }
      },
      { userId: req.user.id, dataType: 'recentTracks', fallbackToCache: true }
    );
  } catch (error) {
    console.error('Error in /api/stats/recent:', error);
    res.status(500).json({ error: 'Failed to fetch recent tracks' });
  }
});

// 音乐档案端点 (带缓存回退)
app.get('/api/stats/profile', authenticate, async (req, res) => {
  try {
    await withCacheFallback(
      async (db) => {
        const profile = await db.musicProfile.findUnique({
          where: { userId: req.user.id }
        });
        res.json(profile);
      },
      async (cache) => {
        const cachedData = await cache.load(req.user.id, 'profile');
        if (cachedData) {
          res.json(cachedData);
        } else {
          res.json({
            topTracks: [],
            topArtists: [],
            genreDist: {},
            avgEnergy: null,
            avgValence: null,
            lastUpdated: new Date().toISOString()
          });
        }
      },
      { userId: req.user.id, dataType: 'profile', fallbackToCache: true }
    );
  } catch (error) {
    console.error('Error in /api/stats/profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    cacheAvailable: true,
    databaseStatus: 'checking...'
  });
});

// 用于测试的端点 - 手动触发缓存回退
app.get('/api/debug/force-cache', async (req, res) => {
  try {
    // 强制重置数据库检查
    resetDatabaseCheck();
    const isAvailable = await checkDatabase();
    
    res.json({
      message: 'Database check reset',
      databaseAvailable: isAvailable,
      usingCache: !isAvailable
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 用于测试的端点 - 检查特定用户的缓存
app.get('/api/debug/cache/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const allCache = await localCache.loadAll(userId);
    res.json(allCache);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load cache' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Musight Backend (with Cache Fallback) running on port ${PORT}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   GET  /health - Health check`);
  console.log(`   GET  /api/debug/connection - Check database connection`);
  console.log(`   GET  /api/debug/force-cache - Force use of cache`);
  console.log(`   GET  /api/debug/cache/:userId - View user cache contents`);
  console.log(`\n   Main API endpoints (with automatic cache fallback):`);
  console.log(`   GET  /api/user/me - Get user info`);
  console.log(`   GET  /api/stats/dashboard - Get dashboard data`);
  console.log(`   GET  /api/stats/recent - Get recent tracks`);
  console.log(`   GET  /api/stats/profile - Get music profile`);
  console.log(`\n💡 Cache fallback is enabled - API will return cached data when database is unavailable`);
});

export default app;