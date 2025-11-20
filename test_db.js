// 简化版测试脚本，用于验证数据库连接和数据写入
import { PrismaClient } from '@prisma/client';
import { AnalysisService } from './src/services/analysisService.js';
import { SpotifyService } from './src/services/spotifyService.js';

const prisma = new PrismaClient();

async function testDatabaseConnection() {
  console.log('Testing database connection...');
  
  try {
    // 测试数据库连接
    await prisma.$queryRaw`SELECT 1`;
    console.log('✓ Database connection successful');
    
    // 获取所有用户统计
    const userCount = await prisma.user.count();
    console.log(`✓ Total users in database: ${userCount}`);
    
    const trackCount = await prisma.trackStat.count();
    console.log(`✓ Total tracks in database: ${trackCount}`);
    
    const artistCount = await prisma.artistStat.count();
    console.log(`✓ Total artists in database: ${artistCount}`);
    
    // 显示所有用户信息
    const users = await prisma.user.findMany();
    console.log('\nUsers in database:');
    for (const user of users) {
      console.log(`- User ID: ${user.id}`);
      console.log(`  Spotify ID: ${user.spotifyId}`);
      console.log(`  Display Name: ${user.displayName}`);
      console.log(`  Token expires at: ${user.tokenExpiresAt}`);
      console.log('  ---');
    }
    
    // 如果有用户，显示他们的统计数据
    if (users.length > 0) {
      for (const user of users) {
        console.log(`\nData for user ${user.displayName || user.spotifyId}:`);
        
        const trackCount = await prisma.trackStat.count({
          where: { userId: user.id }
        });
        console.log(`  Track records: ${trackCount}`);
        
        const artistCount = await prisma.artistStat.count({
          where: { userId: user.id }
        });
        console.log(`  Artist records: ${artistCount}`);
        
        // 显示最近的轨道数据
        if (trackCount > 0) {
          const recentTracks = await prisma.trackStat.findMany({
            where: { userId: user.id },
            orderBy: { playedAt: 'desc' },
            take: 3
          });
          console.log('  Recent tracks:');
          for (const track of recentTracks) {
            console.log(`    - ${track.name} by ${track.artist} (${track.playedAt})`);
          }
        }
        
        // 显示 Top 艺术家
        if (artistCount > 0) {
          const topArtists = await prisma.artistStat.findMany({
            where: { userId: user.id },
            orderBy: { playCount: 'desc' },
            take: 3
          });
          console.log('  Top artists:');
          for (const artist of topArtists) {
            console.log(`    - ${artist.name} (plays: ${artist.playCount})`);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Database test failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// 运行测试
testDatabaseConnection();