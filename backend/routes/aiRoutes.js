const router = require('express').Router();
const ctrl = require('../controllers/aiController');

router.post('/ask', ctrl.askQuestion);
router.get('/insights/:matchId', ctrl.getMatchInsights);
router.get('/explain/:predictionId', ctrl.explainPrediction);

module.exports = router;

