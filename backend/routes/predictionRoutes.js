const router = require('express').Router();
const ctrl = require('../controllers/predictionController');

router.get('/match/:matchId', ctrl.getMatchPrediction);
router.post('/match/:matchId/generate', ctrl.generatePrediction);
router.get('/upcoming', ctrl.getUpcomingPredictions);
router.get('/history', ctrl.getPredictionHistory);
router.get('/accuracy', ctrl.getAccuracy);

module.exports = router;

