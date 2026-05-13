const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');

router.get('/team/:teamId/form', ctrl.getTeamForm);
router.get('/team/:teamId/strength', ctrl.getTeamStrength);
router.get('/team/:teamId/momentum', ctrl.getTeamMomentum);
router.get('/match/:matchId/analysis', ctrl.getMatchAnalysis);
router.get('/h2h', ctrl.getH2HComparison);
router.get('/value-bets', ctrl.getValueBets);     // ← Make sure this exists
router.get('/standings', ctrl.getStandings);         // ← Make sure this exists
router.get('/summary', ctrl.getDashboardSummary);
router.get('/match/:matchId/strength', ctrl.getTeamStrengthAnalysis);


module.exports = router;

