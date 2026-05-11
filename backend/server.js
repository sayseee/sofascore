/**
 * Sofascore Analytics - Express Server
 * Main application entry point
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const db = require('./config/database'); // ← Import database

class Server {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupMiddleware() {
        this.app.use(helmet());
        this.app.use(cors({
            origin: process.env.NODE_ENV === 'production'
                ? process.env.ALLOWED_ORIGINS?.split(',')
                : '*'
        }));
        this.app.use(compression());
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        
        if (process.env.NODE_ENV !== 'production') {
            this.app.use(morgan('dev'));
        } else {
            this.app.use(morgan('combined'));
        }

        const limiter = rateLimit({
            windowMs: 60 * 1000,
            max: parseInt(process.env.API_RATE_LIMIT_PER_MINUTE) || 120
        });
        this.app.use('/api/', limiter);
    }

    setupRoutes() {
        // ✅ Add this root route
        this.app.get('/', (req, res) => {
            res.json({
                name: 'Sofascore Analytics API',
                version: '1.0.0',
                status: 'running',
                database: db.isConnected ? 'connected' : 'disconnected',
                endpoints: {
                    health: '/health',
                    api: '/api',
                    matches: '/api/matches',
                    teams: '/api/teams',
                    odds: '/api/odds',
                    analytics: '/api/analytics',
                    predictions: '/api/predictions'
                },
                timestamp: new Date().toISOString()
            });
        });

        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                database: db.isConnected ? 'connected' : 'disconnected',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        this.app.use('/api', routes);

        this.app.use((req, res) => {
            res.status(404).json({
                success: false,
                error: 'Route not found'
            });
        });
    }

    setupErrorHandling() {
        this.app.use(errorHandler);
    }

    // ⚡ CHANGED: Initialize database before starting server
    async start() {
        try {
            await db.initialize();
            console.log('✅ Database connected successfully');
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            console.log('⚠️  Server starting without database - API calls will fail');
        }

        this.app.listen(this.port, () => {
            console.log(``);
            console.log(`╔══════════════════════════════════════════╗`);
            console.log(`║   ⚽ Sofascore Analytics Platform       ║`);
            console.log(`╠══════════════════════════════════════════╣`);
            console.log(`║  🚀 Server:  http://localhost:${this.port}     ║`);
            console.log(`║  📡 API:     http://localhost:${this.port}/api ║`);
            console.log(`║  💚 Health:  http://localhost:${this.port}/health ║`);
            console.log(`║  🌍 Env:     ${process.env.NODE_ENV || 'development'}                    ║`);
            console.log(`║  🗄️  DB:      ${db.isConnected ? 'Connected ✅' : 'Not Connected ❌'}       ║`);
            console.log(`╚══════════════════════════════════════════╝`);
            console.log(``);
        });
    }
}

const server = new Server();
server.start();

module.exports = server;