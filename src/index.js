import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { AnalysisService } from './services/analysisService.js';

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import statsRoutes from './routes/stats.js';
import spotifyRoutes from './routes/spotify.js';

// Load environment variables
dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/spotify', spotifyRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Musight Backend API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      user: '/api/user',
      stats: '/api/stats',
      spotify: '/api/spotify',
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

/**
 * Daily sync job - runs at 2 AM every day
 * Syncs listening data for all users and builds music profiles
 */
async function syncAllUsersData() {
  console.log('Starting daily sync job...');
  
  try {
    const users = await prisma.user.findMany({
      where: {
        refreshToken: { not: null },
      },
    });

    console.log(`Found ${users.length} users to sync`);

    for (const user of users) {
      try {
        const analysisService = new AnalysisService(user);
        
        // Use comprehensive syncUserPlayback which syncs everything and builds profile
        const result = await analysisService.syncUserPlayback('medium_term');
        
        console.log(`Synced user ${user.id}:`, {
          recent: result.recent.synced,
          tracks: result.tracks.synced,
          artists: result.artists.synced,
        });
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Error syncing user ${user.id}:`, error.message);
        // Continue with next user
      }
    }

    console.log('Daily sync job completed');
  } catch (error) {
    console.error('Error in daily sync job:', error);
  }
}

// Schedule daily sync at 2 AM
cron.schedule('0 2 * * *', syncAllUsersData, {
  scheduled: true,
  timezone: 'UTC',
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Musight Backend running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔄 Daily sync scheduled for 2:00 AM UTC`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

export default app;

