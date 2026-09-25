/**
 * Allowed data field names per sport.
 * Used to filter which keys are stored and emitted when a sport is configured.
 */

const FIELDS_BY_SPORT = {
  baseball: [
    'home_team_name', 'guest_team_name', 'home_score', 'guest_score', 'inning',
    'home_hits', 'home_errors', 'home_left_on_base', 'guest_hits', 'guest_errors', 'guest_left_on_base',
    'ball', 'strike', 'out', 'pitch_count', 'at_bat', 'top_bottom_inning', 'error_flag',
    'clock', 'clock_mode', 'guest_innings', 'home_innings',
  ],
  basketball: [
    'clock', 'shot_clock', 'home_score', 'away_score', 'period',
    'home_timeouts', 'away_timeouts', 'home_fouls', 'away_fouls',
    'home_bonus', 'away_bonus', 'home_double_bonus', 'away_double_bonus',
    'home_possession', 'away_possession', 'home_bonus_text', 'away_bonus_text',
    'home_assists', 'home_rebounds', 'home_blocked_shots', 'home_steals',
    'away_assists', 'away_rebounds', 'away_blocked_shots', 'away_steals',
  ],
  football: [
    'clock', 'home_score', 'guest_score', 'home_timeouts', 'guest_timeouts',
    'quarter', 'play_clock', 'home_possession', 'guest_possession',
    'ball_on', 'down', 'to_go',
  ],
  soccer: [
    'clock', 'home_score', 'guest_score', 'home_timeouts', 'guest_timeouts', 'half',
    'home_saves', 'home_corner_kicks', 'home_penalty', 'guest_shots_on_goal', 'guest_saves',
    'guest_corner_kicks', 'guest_penalty', 'home_corner_kicks_saves', 'guest_corner_kicks_saves',
    'home_fouls', 'guest_fouls', 'home_penalty_tol', 'guest_penalty_tol', 'home_shot', 'guest_shot', 'horn',
  ],
  volleyball: [
    'clock', 'home_score', 'guest_score', 'home_timeouts', 'guest_timeouts',
    'game', 'set', 'game_text', 'game_description', 'home_serve', 'guest_serve',
    'home_games_won', 'guest_games_won', 'match_number', 'home_score_current_game', 'guest_score_current_game',
    'home_score_games', 'guest_score_games', 'home_aces', 'home_kills', 'home_blocks', 'home_digs', 'home_total_hustle',
    'guest_aces', 'guest_kills', 'guest_blocks', 'guest_digs', 'guest_total_hustle',
  ],
};

const VALID_SPORTS = Object.keys(FIELDS_BY_SPORT);

const sportSets = {};
function getFieldsForSport(sport) {
  if (sport == null || typeof sport !== 'string') return null;
  const key = sport.toLowerCase();
  if (!FIELDS_BY_SPORT[key]) return null;
  if (!sportSets[key]) {
    sportSets[key] = new Set(FIELDS_BY_SPORT[key]);
  }
  return sportSets[key];
}

/**
 * @param {string} sport - Current sport (e.g. 'basketball').
 * @param {string} field - Field name to check.
 * @returns {boolean}
 */
function isFieldAllowed(sport, field) {
  const set = getFieldsForSport(sport);
  return set ? set.has(field) : false;
}

module.exports = {
  VALID_SPORTS,
  getFieldsForSport,
  isFieldAllowed,
};
