const express = require('express');
const router = express.Router();
const pipeline = require('../services/dataPipelineService');
const db = require('../config/database');

router.get('/status/:date', async (req, res) => {
    try {
        if (!db.isConnected) await db.initialize();
        const status = await pipeline.getDataStatus(req.params.date);
        res.json({ success: true, data: status });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

router.post('/collect/:date', async (req, res) => {
    try {
        const date = req.params.date;
        pipeline.collectAllForDate(date)
            .then(r => console.log(`✅ Pipeline done: ${date}`))
            .catch(e => console.error(`❌ Pipeline failed: ${e.message}`));
        res.json({ success: true, message: `Collection started for ${date}`, date });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

router.get('/progress', (req, res) => {
    const jobs = [];
    for (const [id, job] of pipeline.currentJobs.entries()) {
        jobs.push({ jobId: id, ...job });
    }
    res.json({ success: true, data: jobs });
});

module.exports = router;