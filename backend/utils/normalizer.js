/**
 * Data Normalizer - Converts API responses to database format
 */
class DataNormalizer {

    normalizeWinningOdds(winningData, matchId) {
        if (!winningData) return null;

        const homeData = winningData.home || {};
        const awayData = winningData.away || {};

        // Convert fractional to decimal
        const homeDecimal = this.fractionalToDecimal(homeData.fractionalValue);
        const awayDecimal = this.fractionalToDecimal(awayData.fractionalValue);

        // Values are percentages (33 = 33%)
        const homeExpected = homeData.expected || 0;
        const homeActual = homeData.actual || 0;
        const awayExpected = awayData.expected || 0;
        const awayActual = awayData.actual || 0;

        // Edge = actual - expected (percentage points)
        const homeEdge = homeActual - homeExpected;
        const awayEdge = awayActual - awayExpected;

        const getEdgeType = (edge) => {
            if (edge > 2) return 'positive';
            if (edge < -2) return 'negative';
            return 'neutral';
        };

        // Draw implied = 100 - (home_exp + away_exp)
        const drawImplied = Math.max(0, 100 - homeExpected - awayExpected);

        return {
            match_id: matchId,
            provider_id: 1,
            
            home_expected_probability: (homeExpected / 100).toFixed(4),
            home_actual_probability: (homeActual / 100).toFixed(4),
            home_expected_percentage: homeExpected,
            home_actual_percentage: homeActual,
            home_decimal_odds: homeDecimal,
            home_fractional_odds: homeData.fractionalValue || null,
            home_edge_percentage: homeEdge,
            home_edge_type: getEdgeType(homeEdge),
            home_is_value: homeEdge > 2 ? 1 : 0,
            
            away_expected_probability: (awayExpected / 100).toFixed(4),
            away_actual_probability: (awayActual / 100).toFixed(4),
            away_expected_percentage: awayExpected,
            away_actual_percentage: awayActual,
            away_decimal_odds: awayDecimal,
            away_fractional_odds: awayData.fractionalValue || null,
            away_edge_percentage: awayEdge,
            away_edge_type: getEdgeType(awayEdge),
            away_is_value: awayEdge > 2 ? 1 : 0,
            
            draw_implied_percentage: drawImplied,
            total_expected_percentage: homeExpected + awayExpected,
            market_overround: (homeExpected + awayExpected - 100).toFixed(1),
            
            home_sofascore_id: homeData.id || null,
            away_sofascore_id: awayData.id || null
        };
    }

    /**
     * Convert fractional odds string to decimal
     * "2/1"   → 2/1 + 1 = 3.000
     * "27/20" → 27/20 + 1 = 2.350
     * "evs"   → 2.000
     */
    fractionalToDecimal(fractional) {
        if (!fractional) return null;

        if (fractional.toLowerCase() === 'evs' || fractional.toLowerCase() === 'evens') {
            return 2.000;
        }

        const parts = fractional.split('/');
        if (parts.length === 2) {
            const num = parseInt(parts[0]);
            const den = parseInt(parts[1]);
            if (!isNaN(num) && !isNaN(den) && den !== 0) {
                return parseFloat((num / den + 1).toFixed(3));
            }
        }

        return null;
    }

    /**
     * Convert decimal odds to fractional string (approximate)
     */
    decimalToFractional(decimal) {
        if (!decimal || decimal <= 1) return null;
        
        const profit = decimal - 1;
        const precision = 20;
        const numerator = Math.round(profit * precision);
        const denominator = precision;
        const gcd = this.gcd(numerator, denominator);
        
        return `${numerator / gcd}/${denominator / gcd}`;
    }

    gcd(a, b) {
        return b === 0 ? a : this.gcd(b, a % b);
    }
}

module.exports = new DataNormalizer();