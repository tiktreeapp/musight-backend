import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function viewData() {
  try {
    console.log('Connecting to database...');
    
    // 获取所有用户
    const users = await prisma.user.findMany({
      include: {
        tracks: {
          take: 5, // 只获取前5条记录
        },
        artists: {
          take: 5, // 只获取前5条记录
        },
        musicProfile: true,
      },
    });
    
    console.log(`Found ${users.length} users:`);
    console.log('----------------------------------------');
    
    for (const user of users) {
      console.log(`User ID: ${user.id}`);
      console.log(`Spotify ID: ${user.spotifyId}`);
      console.log(`Display Name: ${user.displayName}`);
      console.log(`Avatar URL: ${user.avatarUrl}`);
      console.log(`Access Token: ${user.accessToken ? 'Exists' : 'None'}`);
      console.log(`Refresh Token: ${user.refreshToken ? 'Exists' : 'None'}`);
      console.log(`Token Expires At: ${user.tokenExpiresAt}`);
      console.log(`Created At: ${user.createdAt}`);
      console.log(`Updated At: ${user.updatedAt}`);
      console.log(`Tracks Count: ${user.tracks.length}`);
      console.log(`Artists Count: ${user.artists.length}`);
      console.log(`Has Music Profile: ${!!user.musicProfile}`);
      
      // 显示最新的几条轨道数据
      if (user.tracks.length > 0) {
        console.log('\nLatest Track Data:');
        user.tracks.forEach((track, index) => {
          console.log(`  ${index + 1}. Track: ${track.name}`);
          console.log(`     Artist: ${track.artist}`);
          console.log(`     Played At: ${track.playedAt}`);
          console.log(`     Duration: ${track.duration}ms`);
          console.log(`     Popularity: ${track.popularity}`);
          console.log(`     Energy: ${track.energy}`);
          console.log(`     Valence: ${track.valence}`);
          console.log(`     Danceability: ${track.danceability}`);
          console.log('   ---');
        });
      }
      
      // 显示前几个艺术家数据
      if (user.artists.length > 0) {
        console.log('\nTop Artist Data:');
        user.artists.forEach((artist, index) => {
          console.log(`  ${index + 1}. Artist: ${artist.name}`);
          console.log(`     Genres: ${artist.genres.join(', ')}`);
          console.log(`     Play Count: ${artist.playCount}`);
          console.log(`     Image URL: ${artist.imageUrl}`);
          console.log('   ---');
        });
      }
      
      console.log('========================================');
    }
    
    // 获取所有统计数据
    const totalTracks = await prisma.trackStat.count();
    const totalArtists = await prisma.artistStat.count();
    const totalProfiles = await prisma.musicProfile.count();
    
    console.log(`\nTotal Tracks: ${totalTracks}`);
    console.log(`Total Artists: ${totalArtists}`);
    console.log(`Total Music Profiles: ${totalProfiles}`);
    
  } catch (error) {
    console.error('Error viewing data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

viewData();