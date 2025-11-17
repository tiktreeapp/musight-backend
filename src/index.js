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
import cacheRoutes from './routes/cache.js';

// Load environment variables
dotenv.config();

const app = express();

// Initialize Prisma with error handling
// Don't fail on startup if DATABASE_URL is missing - will use cache fallback
let prisma = null;
const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL && DATABASE_URL.trim() !== '') {
  try {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  } catch (error) {
    console.error('Failed to initialize Prisma Client:', error.message);
    // Continue without Prisma - will use cache fallback
    prisma = null;
  }
} else {
  console.warn('DATABASE_URL not set - running in cache-only mode');
}

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
app.use('/api/cache', cacheRoutes);

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

// Error handling middleware - MUST be before 404 handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Ensure JSON response
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  }
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
  if (!prisma) {
    console.warn('Prisma not available, skipping daily sync');
    return;
  }

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

// Start server with error handling
const server = app.listen(PORT, () => {
  console.log(`🚀 Musight Backend running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔄 Daily sync scheduled for 2:00 AM UTC`);
  
  if (!prisma) {
    console.warn('⚠️  Database not available - using cache fallback mode');
  }
});

// Handle server errors
server.on('error', (error) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof PORT === 'string' ? 'Pipe ' + PORT : 'Port ' + PORT;

  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, let the server continue running
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit immediately, let error handler respond to current requests
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (prisma) {
    await prisma.$disconnect().catch(err => console.error('Error disconnecting Prisma:', err));
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (prisma) {
    await prisma.$disconnect().catch(err => console.error('Error disconnecting Prisma:', err));
  }
  process.exit(0);
});

export default app;

