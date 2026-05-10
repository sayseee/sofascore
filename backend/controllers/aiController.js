class AIController {
    async askQuestion(req, res, next) {
        try {
            const { question } = req.body;
            
            if (!question) {
                return res.status(400).json({ success: false, error: 'Question is required' });
            }

            const response = this.generateResponse(question);

            res.json({
                success: true,
                data: {
                    question,
                    response,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) { next(error); }
    }

    generateResponse(question) {
        const q = question.toLowerCase();

        if (q.includes('predict') || q.includes('prediction')) {
            return {
                text: 'I can help with match predictions! Check the Predictions tab for detailed AI-generated predictions with confidence scores.',
                suggestions: ['Show top predictions', 'Explain prediction factors', 'What is the confidence level?']
            };
        } else if (q.includes('value bet') || q.includes('value')) {
            return {
                text: 'Value bets are identified when our AI model probability exceeds the bookmaker implied probability by more than 2%. Check the Value Bets tab for current opportunities.',
                suggestions: ['Show top value bets', 'What is expected value?', 'Highest confidence bets']
            };
        } else if (q.includes('form') || q.includes('streak')) {
            return {
                text: 'Team form analysis includes PPG (Points Per Game), weighted recent form, winning/losing streaks, and goal scoring/conceding trends. Go to a team page to see detailed form analysis.',
                suggestions: ['Show Arsenal form', 'Analyze recent Premier League matches', 'Compare team forms']
            };
        } else if (q.includes('h2h') || q.includes('head to head')) {
            return {
                text: 'Head-to-Head analysis compares historical matchups between two teams. You can compare any two teams by going to the H2H tab and searching for them.',
                suggestions: ['Compare Arsenal vs Chelsea', 'Show recent H2H results', 'H2H goal statistics']
            };
        } else {
            return {
                text: `I'm your AI football analytics assistant. I can help with match predictions, value bet identification, form analysis, H2H comparisons, and more. What would you like to know?`,
                suggestions: ['Predict upcoming matches', 'Find value bets', 'Analyze team form', 'Compare teams H2H']
            };
        }
    }

    async getMatchInsights(req, res, next) {
        try {
            const { matchId } = req.params;
            res.json({
                success: true,
                data: {
                    matchId: parseInt(matchId),
                    insights: [
                        'This appears to be a closely contested match',
                        'Both teams have strong recent form',
                        'Historical H2H suggests a high-scoring affair'
                    ]
                }
            });
        } catch (error) { next(error); }
    }

    async explainPrediction(req, res, next) {
        try {
            const { predictionId } = req.params;
            res.json({
                success: true,
                data: {
                    predictionId: parseInt(predictionId),
                    factors: [
                        { name: 'Team Form', impact: 'high', description: 'Recent performance weighted more heavily' },
                        { name: 'Head-to-Head', impact: 'medium', description: 'Historical matchups considered' },
                        { name: 'Market Odds', impact: 'high', description: 'Bookmaker probabilities factored in' }
                    ]
                }
            });
        } catch (error) { next(error); }
    }
}

module.exports = new AIController();

