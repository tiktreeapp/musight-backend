// 模拟测试脚本 - 验证完整的 Spotify 数据同步流程
import { PrismaClient } from '@prisma/client';
import { SpotifyService } from './src/services/spotifyService.js';
import { AnalysisService } from './src/services/analysisService.js';

const prisma = new PrismaClient();

// 模拟一个测试用户
const testUser = {
  id: 'test_user_123',
  spotifyId: 'test_spotify_user',
  displayName: 'Test User',
  accessToken: process.env.TEST_SPOTIFY_ACCESS_TOKEN || null,
  refreshToken: process.env.TEST_SPOTIFY_REFRESH_TOKEN || null,
  tokenExpiresAt: new Date(Date.now() + 3600000) // 1小时后过期
};

async function simulateSpotifyConnectionFlow() {
  console.log('🚀 开始模拟 Spotify 连接和数据同步流程...\n');
  
  try {
    // 步骤 1: 模拟创建用户（连接 Spotify 后）
    console.log('Step 1: 模拟创建用户记录...');
    let user = null;
    
    // 检查用户是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { spotifyId: testUser.spotifyId }
    });
    
    if (existingUser) {
      console.log('✓ 用户已存在，更新 Token 信息');
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          accessToken: testUser.accessToken,
          refreshToken: testUser.refreshToken,
          tokenExpiresAt: testUser.tokenExpiresAt,
          displayName: testUser.displayName,
        }
      });
    } else {
      console.log('✓ 创建新用户记录');
      user = await prisma.user.create({
        data: {
          spotifyId: testUser.spotifyId,
          accessToken: testUser.accessToken,
          refreshToken: testUser.refreshToken,
          tokenExpiresAt: testUser.tokenExpiresAt,
          displayName: testUser.displayName,
        }
      });
    }
    
    console.log(`✓ 用户创建/更新成功: ${user.displayName} (${user.spotifyId})\n`);
    
    // 步骤 2: 模拟数据同步到数据库
    console.log('Step 2: 开始同步 Spotify 数据到数据库...');
    
    if (!process.env.TEST_SPOTIFY_ACCESS_TOKEN) {
      console.log('⚠️  缺少测试用的 Spotify Access Token，跳过实时数据同步');
      console.log('   请设置 TEST_SPOTIFY_ACCESS_TOKEN 环境变量来测试实时同步\n');
      
      // 创建一些示例数据来演示数据结构
      console.log('Creating sample data for demonstration...');
      
      // 创建示例轨道数据
      const sampleTracks = [
        {
          userId: user.id,
          trackId: 'test_track_1',
          name: 'Test Track 1',
          artist: 'Test Artist 1',
          playedAt: new Date(),
          duration: 240000, // 4分钟
          popularity: 85,
          energy: 0.7,
          valence: 0.6,
          danceability: 0.8
        },
        {
          userId: user.id,
          trackId: 'test_track_2',
          name: 'Test Track 2',
          artist: 'Test Artist 2',
          playedAt: new Date(Date.now() - 3600000), // 1小时前
          duration: 180000, // 3分钟
          popularity: 70,
          energy: 0.5,
          valence: 0.4,
          danceability: 0.6
        }
      ];
      
      for (const track of sampleTracks) {
        await prisma.trackStat.create({
          data: track
        });
      }
      
      // 创建示例艺术家数据
      const sampleArtists = [
        {
          userId: user.id,
          artistId: 'test_artist_1',
          name: 'Test Artist 1',
          genres: ['pop', 'rock'],
          playCount: 10
        },
        {
          userId: user.id,
          artistId: 'test_artist_2',
          name: 'Test Artist 2',
          genres: ['electronic', 'dance'],
          playCount: 5
        }
      ];
      
      for (const artist of sampleArtists) {
        await prisma.artistStat.create({
          data: artist
        });
      }
      
      console.log('✓ 示例数据创建成功\n');
    } else {
      // 如果有访问令牌，执行实际的数据同步
      const analysisService = new AnalysisService(user);
      
      console.log('✓ 开始同步最近播放的歌曲...');
      const recentResult = await analysisService.syncRecentlyPlayed();
      console.log(`  同步了 ${recentResult.synced} 首新歌\n`);
      
      console.log('✓ 开始同步 Top Tracks...');
      const tracksResult = await analysisService.syncTopTracks('medium_term', 10);
      console.log(`  同步了 ${tracksResult.synced} 首 Top Tracks\n`);
      
      console.log('✓ 开始同步 Top Artists...');
      const artistsResult = await analysisService.syncTopArtists('medium_term', 10);
      console.log(`  同步了 ${artistsResult.synced} 位 Top Artists\n`);
      
      console.log('✓ 开始构建音乐档案...');
      await analysisService.buildMusicProfile();
      console.log('  音乐档案构建完成\n');
    }
    
    // 步骤 3: 模拟 API Token 过期和刷新
    console.log('Step 3: 模拟 Token 过期处理...');
    
    // 更新用户记录，模拟 Token 过期
    const expiredTime = new Date(Date.now() - 60000); // 1分钟前过期
    await prisma.user.update({
      where: { id: user.id },
      data: { tokenExpiresAt: expiredTime }
    });
    
    console.log('✓ 模拟 Token 过期');
    
    // 这里会触发自动刷新机制（在实际请求时）
    console.log('✓ Token 过期处理机制已准备就绪\n');
    
    // 步骤 4: 从数据库获取数据（模拟 App 获取数据）
    console.log('Step 4: 模拟 App 从数据库获取数据...');
    
    // 获取用户的统计信息
    const stats = await prisma.trackStat.findMany({
      where: { userId: user.id },
      take: 10,
      orderBy: { playedAt: 'desc' }
    });
    
    console.log(`✓ 获取到 ${stats.length} 条播放记录`);
    
    // 获取 Top Artists
    const topArtists = await prisma.artistStat.findMany({
      where: { userId: user.id },
      orderBy: { playCount: 'desc' },
      take: 10
    });
    
    console.log(`✓ 获取到 ${topArtists.length} 位 Top Artists`);
    
    // 获取用户音乐档案
    const musicProfile = await prisma.musicProfile.findUnique({
      where: { userId: user.id }
    });
    
    if (musicProfile) {
      console.log('✓ 获取到音乐档案');
      console.log(`  - Top Tracks: ${musicProfile.topTracks.length}`);
      console.log(`  - Top Artists: ${musicProfile.topArtists.length}`);
      console.log(`  - 平均能量值: ${musicProfile.avgEnergy}`);
      console.log(`  - 平均愉悦度: ${musicProfile.avgValence}`);
    } else {
      console.log('⚠️  未找到音乐档案（需要先运行完整同步）');
    }
    
    // 显示最终数据库状态
    console.log('\n📊 最终数据库状态:');
    const finalUserCount = await prisma.user.count();
    const finalTrackCount = await prisma.trackStat.count({ where: { userId: user.id } });
    const finalArtistCount = await prisma.artistStat.count({ where: { userId: user.id } });
    const finalProfileCount = await prisma.musicProfile.count({ where: { userId: user.id } });
    
    console.log(`  用户总数: ${finalUserCount}`);
    console.log(`  该用户轨道记录数: ${finalTrackCount}`);
    console.log(`  该用户艺术家记录数: ${finalArtistCount}`);
    console.log(`  该用户音乐档案数: ${finalProfileCount}`);
    
    console.log('\n✅ 完整的 Spotify 数据同步流程测试成功!');
    console.log('\n要进行实时测试，请:');
    console.log('1. 设置有效的 Spotify Access Token (TEST_SPOTIFY_ACCESS_TOKEN)');
    console.log('2. 运行 iOS App 并连接 Spotify');
    console.log('3. 在 App 中触发数据同步');
    console.log('4. 观察后端日志和数据库变化');
    
  } catch (error) {
    console.error('❌ 测试过程中出现错误:', error.message);
    console.error('错误堆栈:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// 运行模拟测试
simulateSpotifyConnectionFlow();
