// 创建一个简化的后端服务器用于测试日志监控
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app = express();
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error']
});

// 中间件 - 记录所有请求
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // 记录请求
  console.log(`\n[${new Date().toISOString()}] 📡 ${req.method} ${req.path}`);
  console.log(`Headers: ${JSON.stringify(Object.keys(req.headers))}`);
  if (Object.keys(req.query).length > 0) {
    console.log(`Query: ${JSON.stringify(req.query)}`);
  }
  if (Object.keys(req.body).length > 0) {
    console.log(`Body: ${JSON.stringify(req.body)}`);
  }
  
  // 记录响应
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`Response: ${res.statusCode} (${duration}ms)\n`);
  });
  
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 简化的认证中间件（用于测试）
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  // 简化验证流程，仅用于测试
  req.user = { id: 'test_user_123', spotifyId: 'test_spotify_user' };
  next();
}

// 简化的 Spotify 同步路由（用于测试）
app.post('/api/spotify/sync', authenticate, async (req, res) => {
  console.log(`\n🔄 Sync request for user: ${req.user.id}`);
  
  try {
    // 记录同步开始
    console.log('Sync started...');
    
    // 模拟同步过程
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 检查数据库中的记录数
    const trackCountBefore = await prisma.trackStat.count({ where: { userId: req.user.id } });
    console.log(`Tracks before sync: ${trackCountBefore}`);
    
    // 这里实际会调用完整的同步逻辑
    // 为测试目的，我们模拟返回值
    res.json({
      success: true,
      tracks: { synced: 5, total: 50 },
      artists: { synced: 3 }
    });
    
    const trackCountAfter = await prisma.trackStat.count({ where: { userId: req.user.id } });
    console.log(`Tracks after sync: ${trackCountAfter}`);
    console.log(`Tracks added: ${trackCountAfter - trackCountBefore}`);
    
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// 简化的统计数据路由（用于测试）
app.get('/api/stats/dashboard', authenticate, async (req, res) => {
  console.log(`\n📊 Dashboard request for user: ${req.user.id}`);
  
  try {
    // 查询数据库中的统计数据
    const trackCount = await prisma.trackStat.count({ where: { userId: req.user.id } });
    const artistCount = await prisma.artistStat.count({ where: { userId: req.user.id } });
    
    console.log(`Data for dashboard: ${trackCount} tracks, ${artistCount} artists`);
    
    res.json({
      stats: {
        totalTracks: trackCount,
        uniqueArtists: artistCount,
        totalListeningTime: { hours: 10, minutes: 30 }
      },
      topArtists: [],
      recentTracks: [],
      spotifyTopTracks: []
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// 检查数据库状态的路由
app.get('/api/test/db-status', async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    const trackCount = await prisma.trackStat.count();
    const artistCount = await prisma.artistStat.count();
    
    console.log(`\n💾 Database Status:`);
    console.log(`Users: ${userCount}`);
    console.log(`Tracks: ${trackCount}`);
    console.log(`Artists: ${artistCount}`);
    
    res.json({
      users: userCount,
      tracks: trackCount,
      artists: artistCount
    });
  } catch (error) {
    console.error('DB status error:', error);
    res.status(500).json({ error: 'Failed to get DB status' });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 Test API Monitor Server running on port ${PORT}`);
  console.log(`📊 Monitor endpoints:`);
  console.log(`   POST /api/spotify/sync - Simulate data sync`);
  console.log(`   GET  /api/stats/dashboard - Get user stats`);
  console.log(`   GET  /api/test/db-status - Check DB status`);
  console.log(`\n📋 All API requests will be logged in real-time\n`);
});

// 清理
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await prisma.$disconnect();
  process.exit(0);
});