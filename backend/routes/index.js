const express = require('express');
const router = express.Router();

router.use('/matches', require('./matchRoutes'));
router.use('/teams', require('./teamRoutes'));
router.use('/odds', require('./oddsRoutes'));
router.use('/analytics', require('./analyticsRoutes'));
router.use('/predictions', require('./predictionRoutes'));
router.use('/ingestion', require('./ingestionRoutes'));
router.use('/ai', require('./aiRoutes'));
router.use('/pipeline', require('./pipelineRoutes'));

router.get('/', (req, res) => {
    res.json({
        name: 'Sofascore Analytics API',
        version: '1.0.0',
        endpoints: {
            matches: '/api/matches',
            teams: '/api/teams',
            odds: '/api/odds',
            analytics: '/api/analytics',
            predictions: '/api/predictions',
            pipeline: '/api/pipeline',
            ingestion: '/api/ingestion',
            ai: '/api/ai',
        }
    });
});

module.exports = router;