// 测试缓存机制是否正常工作
import { LocalCache } from './src/utils/localCache.js';

async function testCache() {
  console.log('Testing cache functionality...\n');
  
  const cache = new LocalCache();
  const userId = 'test_user_123';
  
  // 测试保存数据
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
  
  try {
    console.log('1. Saving test data to cache...');
    await cache.save(userId, 'profile', testData);
    console.log('   ✓ Profile data saved\n');
    
    // 添加测试数据到其他缓存类型
    await cache.save(userId, 'dashboard', {
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
      recentTracks: [
        { trackId: 'test1', name: 'Sample Track 1', artist: 'Sample Artist 1', playedAt: new Date() },
        { trackId: 'test2', name: 'Sample Track 2', artist: 'Sample Artist 2', playedAt: new Date(Date.now() - 3600000) }
      ],
      spotifyTopTracks: testData.topTracks
    });
    console.log('   ✓ Dashboard data saved\n');
    
    await cache.save(userId, 'recentTracks', [
      { trackId: 'test1', name: 'Sample Track 1', artist: 'Sample Artist 1', playedAt: new Date() },
      { trackId: 'test2', name: 'Sample Track 2', artist: 'Sample Artist 2', playedAt: new Date(Date.now() - 3600000) }
    ]);
    console.log('   ✓ Recent tracks data saved\n');
    
    // 测试加载数据
    console.log('2. Loading test data from cache...');
    const loadedProfile = await cache.load(userId, 'profile');
    console.log('   ✓ Profile data loaded:', loadedProfile ? 'Found' : 'Not found');
    
    const loadedDashboard = await cache.load(userId, 'dashboard');
    console.log('   ✓ Dashboard data loaded:', loadedDashboard ? 'Found' : 'Not found');
    
    const loadedRecent = await cache.load(userId, 'recentTracks');
    console.log('   ✓ Recent tracks data loaded:', loadedRecent ? 'Found' : 'Not found');
    
    // 测试列出所有缓存
    console.log('\n3. Listing all cache files for user...');
    const userCaches = await cache.listUserCaches(userId);
    console.log('   Cache files found:', userCaches);
    
    // 测试加载所有缓存
    console.log('\n4. Loading all cached data for user...');
    const allData = await cache.loadAll(userId);
    console.log('   All cached data:', Object.keys(allData));
    
    console.log('\n✅ Cache functionality test completed successfully!');
    console.log('\n💡 To use cache data in your iOS App, ensure that:');
    console.log('   1. The backend service is running properly');
    console.log('   2. The cache files are populated with relevant data');
    console.log('   3. The API endpoints return data from cache when database is unavailable');
    
  } catch (error) {
    console.error('❌ Cache test failed:', error.message);
    console.error('Error stack:', error.stack);
  }
}

testCache();