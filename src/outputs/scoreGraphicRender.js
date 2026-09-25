/**
 * Shared renderer for score graphic HTML. Used by scoreGraphic output and GET /graphic.
 * Baseball template with accent color and element toggles from graphicsSettings.
 */

const graphicsSettings = require('../graphicsSettings');

function ordinal(n) {
  if (n == null || typeof n !== 'number' || n < 1) return '1st';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function abbr(name) {
  if (typeof name !== 'string' || !name.trim()) return '---';
  return String(name).trim();
}

/**
 * Build baseball scorebug HTML from game data and graphics settings.
 * @param {Record<string, unknown>} data - getData() result (sport + baseball fields)
 * @param {{ accentColor?: string, elements?: Record<string, boolean> }} [options] - overrides (defaults from graphicsSettings.get())
 * @returns {string} Full HTML document
 */
function renderBaseball(data, options) {
  const gs = graphicsSettings.get();
  const settings = { ...gs };
  if (options) {
    if (options.accentColor != null) settings.accentColor = options.accentColor;
    if (options.elements) settings.elements = { ...settings.elements, ...options.elements };
  }
  if (options && options.effectiveSport !== undefined && options.effectiveSport !== null) {
    settings.effectiveSport = options.effectiveSport;
  } else if (data.sport) {
    settings.effectiveSport = data.sport;
  } else {
    settings.effectiveSport = 'baseball';
  }
  const accent = settings.accentColor || '#00ff41';
  const el = settings.elements || {};
  const ov = settings.fieldOverrides || {};
  const mv = settings.manualValues || {};

  const guestName = ov.guestTeamName ? (mv.guestTeamName != null ? String(mv.guestTeamName).trim() : '') : data.guest_team_name;
  const homeName = ov.homeTeamName ? (mv.homeTeamName != null ? String(mv.homeTeamName).trim() : '') : data.home_team_name;
  const guestAbbr = abbr(guestName);
  const homeAbbr = abbr(homeName);

  const guestScore = ov.guestScore ? (Number(mv.guestScore) || 0) : (Number(data.guest_score) || 0);
  const homeScore = ov.homeScore ? (Number(mv.homeScore) || 0) : (Number(data.home_score) || 0);
  const inningNum = ov.inning ? (Number(mv.inning) || 1) : (typeof data.inning === 'number' ? data.inning : 1);
  const topBottomRaw = ov.topBottom ? (mv.topBottom === 'bottom' ? 'bottom' : 'top') : String(data.top_bottom_inning || '').toLowerCase();
  const arrow = topBottomRaw.includes('top') ? '▲' : '▼';
  const ball = ov.ball ? (Number(mv.ball) ?? 0) : (Number(data.ball) ?? 0);
  const strike = ov.strike ? (Number(mv.strike) ?? 0) : (Number(data.strike) ?? 0);
  const out = ov.out ? (Number(mv.out) ?? 0) : (Number(data.out) ?? 0);
  const clock = ov.clock ? (mv.clock != null ? String(mv.clock) : '') : (data.clock != null ? String(data.clock) : '');

  const showTeams = el.teams !== false;
  const showAwayScore = el.awayScore !== false;
  const showHomeScore = el.homeScore !== false;
  const showInning = el.inning !== false;
  const showCount = el.count !== false;
  const showOuts = el.outs !== false;
  const showClock = el.clock === true;

  const teamGroupParts = [];
  if (showTeams || showAwayScore) {
    teamGroupParts.push('<div class="team">');
    if (showTeams) teamGroupParts.push('<span class="abbr">' + escapeHtml(guestAbbr) + '</span>');
    if (showAwayScore) teamGroupParts.push('<span class="score">' + guestScore + '</span>');
    teamGroupParts.push('</div>');
  }
  if (showTeams || showHomeScore) {
    teamGroupParts.push('<div class="team">');
    if (showTeams) teamGroupParts.push('<span class="abbr">' + escapeHtml(homeAbbr) + '</span>');
    if (showHomeScore) teamGroupParts.push('<span class="score">' + homeScore + '</span>');
    teamGroupParts.push('</div>');
  }

  const gameMetaParts = [];
  if (showInning) {
    gameMetaParts.push('<div class="inning-wrap"><span class="arrow">' + arrow + '</span><span class="inning-num">' + ordinal(inningNum) + '</span></div>');
  }
  if (showCount) {
    gameMetaParts.push('<div class="count-display"><div class="count-label">Count</div><div class="count-numbers">' + ball + '-' + strike + '</div></div>');
  }
  if (showOuts) {
    gameMetaParts.push('<div class="outs-box">' + out + ' OUT</div>');
  }
  if (showClock && clock !== '') {
    gameMetaParts.push('<div class="clock-box">' + escapeHtml(clock) + '</div>');
  }

  const teamGroupHtml = teamGroupParts.length ? '<div class="team-group">' + teamGroupParts.join('') + '</div>' : '';
  const gameMetaHtml = gameMetaParts.length ? '<div class="game-meta">' + gameMetaParts.join('') + '</div>' : '';

  const scorebugBody = teamGroupHtml + gameMetaHtml;

  const full = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        :root {
            --bg-dark: rgba(15, 15, 15, 0.95);
            --accent: ${escapeCss(accent)};
            --text-main: #ffffff;
            --text-secondary: #aaaaaa;
        }

        body {
            margin: 0;
            padding: 30px;
            font-family: 'Inter', 'Segoe UI', sans-serif;
            background: transparent;
        }

        .scorebug {
            display: flex;
            align-items: center;
            background: var(--bg-dark);
            color: white;
            border-radius: 5px;
            padding: 14px 26px;
            width: fit-content;
            border-left: 7px solid var(--accent);
            box-shadow: 8px 8px 24px rgba(0,0,0,0.35);
        }

        .team-group {
            display: flex;
            gap: 34px;
            padding-right: 34px;
            border-right: 1px solid #444;
        }

        .team {
            display: flex;
            align-items: center;
            gap: 17px;
        }

        .abbr { font-weight: 900; font-size: 37px; letter-spacing: 2px; }
        .score { font-weight: 700; font-size: 40px; color: var(--accent); }

        .game-meta {
            display: flex;
            align-items: center;
            padding-left: 34px;
            gap: 26px;
        }

        .inning-wrap {
            display: flex;
            flex-direction: column;
            line-height: 1.1;
        }

        .arrow { font-size: 20px; color: var(--accent); }
        .inning-num { font-weight: 800; font-size: 31px; }

        .count-display {
            display: flex;
            flex-direction: column;
            align-items: center;
            background: #222;
            padding: 7px 17px;
            border-radius: 6px;
        }

        .count-label {
            font-size: 17px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 2px;
            margin-bottom: 4px;
        }

        .count-numbers {
            font-family: monospace;
            font-weight: 700;
            font-size: 31px;
            letter-spacing: 4px;
        }

        .outs-box {
            font-size: 24px;
            font-weight: 600;
            color: #ff4d4d;
        }

        .clock-box {
            font-size: 24px;
            font-weight: 600;
        }
    </style>
</head>
<body>

<div class="scorebug" id="scorebug">
${scorebugBody}
</div>

<script>
window.__graphicOptions = __GRAPHIC_OPTIONS__;
(function poll() {
  fetch('/api/stats')
    .then(function(r) { return r.json(); })
    .then(function(stats) {
      var d = stats.data || {};
      var opts = stats.graphicsSettings != null ? stats.graphicsSettings : (window.__graphicOptions || {});
      var sport = (opts.autoSport !== false) ? (d.sport || null) : (opts.testSport || null);
      if (!sport || sport !== 'baseball') return;
      var sb = document.getElementById('scorebug');
      if (!sb) return;
      var el = opts.elements || {};
      var ov = opts.fieldOverrides || {};
      var mv = opts.manualValues || {};
      var guestSrc = ov.guestTeamName ? (mv.guestTeamName != null ? String(mv.guestTeamName).trim() : '') : (d.guest_team_name && String(d.guest_team_name).trim());
      var homeSrc = ov.homeTeamName ? (mv.homeTeamName != null ? String(mv.homeTeamName).trim() : '') : (d.home_team_name && String(d.home_team_name).trim());
      var guestAbbr = guestSrc ? String(guestSrc).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---';
      var homeAbbr = homeSrc ? String(homeSrc).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---';
      var guestScore = ov.guestScore ? (Number(mv.guestScore) || 0) : (Number(d.guest_score) || 0);
      var homeScore = ov.homeScore ? (Number(mv.homeScore) || 0) : (Number(d.home_score) || 0);
      var ord = function(n) { n = Number(n) || 1; var s = ['th','st','nd','rd']; var v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
      var inningNum = ov.inning ? (Number(mv.inning) || 1) : (Number(d.inning) || 1);
      var inning = ord(inningNum);
      var topRaw = ov.topBottom ? (mv.topBottom === 'bottom' ? 'bottom' : 'top') : String(d.top_bottom_inning||'').toLowerCase();
      var arrow = topRaw.indexOf('top') >= 0 ? '▲' : '▼';
      var ball = ov.ball ? (Number(mv.ball) ?? 0) : (Number(d.ball) ?? 0);
      var strike = ov.strike ? (Number(mv.strike) ?? 0) : (Number(d.strike) ?? 0);
      var out = ov.out ? (Number(mv.out) ?? 0) : (Number(d.out) ?? 0);
      var clock = ov.clock ? (mv.clock != null ? String(mv.clock) : '') : (d.clock != null ? String(d.clock) : '');
      var teamParts = [];
      if (el.teams !== false || el.awayScore !== false) {
        teamParts.push('<div class="team"><span class="abbr">' + guestAbbr + '</span><span class="score">' + guestScore + '</span></div>');
      }
      if (el.teams !== false || el.homeScore !== false) {
        teamParts.push('<div class="team"><span class="abbr">' + homeAbbr + '</span><span class="score">' + homeScore + '</span></div>');
      }
      var metaParts = [];
      if (el.inning !== false) metaParts.push('<div class="inning-wrap"><span class="arrow">' + arrow + '</span><span class="inning-num">' + inning + '</span></div>');
      if (el.count !== false) metaParts.push('<div class="count-display"><div class="count-label">Count</div><div class="count-numbers">' + ball + '-' + strike + '</div></div>');
      if (el.outs !== false) metaParts.push('<div class="outs-box">' + out + ' OUT</div>');
      if (el.clock && clock) metaParts.push('<div class="clock-box">' + clock.replace(/</g,'&lt;') + '</div>');
      sb.innerHTML = (teamParts.length ? '<div class="team-group">' + teamParts.join('') + '</div>' : '') + (metaParts.length ? '<div class="game-meta">' + metaParts.join('') + '</div>' : '');
    })
    .catch(function() {})
    .then(function() { setTimeout(poll, 1000); });
})();
</script>
</body>
</html>`;
  return full.replace('__GRAPHIC_OPTIONS__', JSON.stringify(settings));
}

function escapeHtml(s) {
  if (s == null) return '';
  const str = String(s);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeCss(s) {
  if (s == null) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Allow only http, https, or data URLs for img src to avoid XSS. Returns empty string if invalid. */
function safeLogoUrl(url) {
  if (url == null || typeof url !== 'string') return '';
  const u = String(url).trim();
  if (u === '') return '';
  const lower = u.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('data:')) {
    return u.replace(/"/g, '&quot;').replace(/>/g, '&gt;');
  }
  return '';
}

/** Logo template CSS with :root accent and logo box color from graphics settings. */
function getLogoTemplateCss(accentColor, logoBoxColor) {
  const accent = accentColor && typeof accentColor === 'string' ? accentColor.trim() : '';
  const safe = accent && /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : '#00e5ff';
  const logoBg = logoBoxColor && typeof logoBoxColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(logoBoxColor.trim()) ? logoBoxColor.trim() : '#ffffff';
  return `
        :root {
            --bg-dark: rgba(18, 18, 18, 0.95);
            --accent: ${escapeCss(safe)};
            --logo-box-color: ${escapeCss(logoBg)};
            --text: #ffffff;
        }
        body { margin: 0; padding: 40px; font-family: 'Inter', 'Segoe UI', Arial, sans-serif; background: transparent; }
        #scorebug { display: contents; }
        .scorebug {
            display: flex; align-items: stretch; background: var(--bg-dark); color: var(--text); height: 60px;
            width: fit-content; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            border-bottom: 4px solid var(--accent);
        }
        .logo-slot {
            background: var(--logo-box-color); display: flex; align-items: center; justify-content: center; padding: 0 10px;
            border-right: 2px solid #333; width: fit-content; height: 60px; flex-shrink: 0;
        }
        .logo-slot img { height: 100%; width: auto; max-height: 60px; object-fit: contain; border-radius: 0; }
        .teams-area {
            display: grid; grid-template-rows: 1fr 1fr; padding: 0 15px; min-width: 140px; border-right: 1px solid #444;
        }
        .team-row { display: flex; justify-content: space-between; align-items: center; font-weight: 800; font-size: 18px; }
        .team-row .score { color: var(--accent); font-size: 20px; }
        .data-slot {
            display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 20px;
            border-right: 1px solid #444; min-width: 80px;
        }
        .data-slot .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
        .data-slot .value { font-weight: 700; font-size: 20px; }
        .status-slot {
            display: flex; flex-direction: column; justify-content: center; padding: 0 20px;
            background: rgba(255,255,255,0.05);
        }
        .status-slot .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
        .status-slot .value { font-weight: 700; font-size: 20px; }
        .scorebug.baseball-border { border-bottom-color: var(--accent); }
        .scorebug.basketball-border { border-bottom-color: var(--accent); }
        .count-text { letter-spacing: 3px; color: var(--accent); }
        .clock-text { font-family: monospace; color: var(--accent); }
`;
}

/**
 * Build baseball logo-template scorebug HTML (full document).
 */
function renderBaseballLogo(data, options) {
  const gs = graphicsSettings.get();
  const settings = { ...gs };
  if (options) {
    if (options.accentColor != null) settings.accentColor = options.accentColor;
    if (options.elements) settings.elements = { ...settings.elements, ...options.elements };
  }
  if (options && options.effectiveSport !== undefined && options.effectiveSport !== null) {
    settings.effectiveSport = options.effectiveSport;
  } else {
    settings.effectiveSport = data.sport || 'baseball';
  }
  const ov = settings.fieldOverrides || {};
  const mv = settings.manualValues || {};
  const guestName = ov.guestTeamName ? (mv.guestTeamName != null ? String(mv.guestTeamName).trim() : '') : data.guest_team_name;
  const homeName = ov.homeTeamName ? (mv.homeTeamName != null ? String(mv.homeTeamName).trim() : '') : data.home_team_name;
  const guestAbbr = abbr(guestName);
  const homeAbbr = abbr(homeName);
  const guestScore = ov.guestScore ? (Number(mv.guestScore) || 0) : (Number(data.guest_score) || 0);
  const homeScore = ov.homeScore ? (Number(mv.homeScore) || 0) : (Number(data.home_score) || 0);
  const inningNum = ov.inning ? (Number(mv.inning) || 1) : (typeof data.inning === 'number' ? data.inning : 1);
  const topBottomRaw = ov.topBottom ? (mv.topBottom === 'bottom' ? 'bottom' : 'top') : String(data.top_bottom_inning || '').toLowerCase();
  const arrow = topBottomRaw.includes('top') ? '▲' : '▼';
  const ball = ov.ball ? (Number(mv.ball) ?? 0) : (Number(data.ball) ?? 0);
  const strike = ov.strike ? (Number(mv.strike) ?? 0) : (Number(data.strike) ?? 0);
  const out = ov.out ? (Number(mv.out) ?? 0) : (Number(data.out) ?? 0);
  const logoUrl = safeLogoUrl(settings.logoUrl || '');

  const logoSlotHtml = logoUrl
    ? '<div class="logo-slot"><img src="' + logoUrl + '" alt="Logo"></div>'
    : '';
  const teamsHtml = '<div class="teams-area"><div class="team-row"><span>' + escapeHtml(guestAbbr) + '</span> <span class="score">' + guestScore + '</span></div><div class="team-row"><span>' + escapeHtml(homeAbbr) + '</span> <span class="score">' + homeScore + '</span></div></div>';
  const inningHtml = '<div class="data-slot"><div class="label">Inning</div><div class="value">' + arrow + ' ' + ordinal(inningNum) + '</div></div>';
  const outsDots = '●'.repeat(out) + '○'.repeat(3 - Math.min(3, out));
  const statusHtml = '<div class="status-slot"><div class="label">Count / Outs</div><div class="value count-text">' + ball + '-' + strike + ' <span style="color:#ff4d4d;font-size:14px;">' + escapeHtml(outsDots) + '</span></div></div>';
  const scorebugInner = logoSlotHtml + teamsHtml + inningHtml + statusHtml;
  const logoCss = getLogoTemplateCss(settings.accentColor, settings.logoBoxColor);

  const full = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>${logoCss}</style></head>
<body>
<div id="scorebug"><div class="scorebug baseball-border">${scorebugInner}</div></div>
<script>
window.__graphicOptions = __GRAPHIC_OPTIONS__;
(function poll() {
  fetch('/api/stats').then(function(r){ return r.json(); }).then(function(stats) {
    var d = stats.data || {};
    var opts = stats.graphicsSettings != null ? stats.graphicsSettings : (window.__graphicOptions || {});
    if (opts.accentColor && /^#[0-9a-fA-F]{3,8}$/.test(String(opts.accentColor))) document.documentElement.style.setProperty('--accent', opts.accentColor);
    if (opts.logoBoxColor && /^#[0-9a-fA-F]{3,8}$/.test(String(opts.logoBoxColor))) document.documentElement.style.setProperty('--logo-box-color', opts.logoBoxColor);
    var sport = (opts.autoSport !== false) ? (d.sport || null) : (opts.testSport || null);
    var tpl = opts.template || 'simple';
    var sb = document.getElementById('scorebug');
    if (!sb) return;
    if (tpl === 'logo' && (sport === 'baseball' || sport === 'basketball')) {
      var ov = opts.fieldOverrides || {}; var mv = opts.manualValues || {};
      var logoUrl = (opts.logoUrl && String(opts.logoUrl).trim()) ? String(opts.logoUrl).trim().replace(/"/g,'&quot;') : '';
      if (logoUrl && !/^(https?:|data:)/i.test(logoUrl)) logoUrl = '';
      var logoSlot = logoUrl ? '<div class="logo-slot"><img src="'+logoUrl+'" alt="Logo"></div>' : '';
      if (sport === 'baseball') {
        var gName = ov.guestTeamName ? (mv.guestTeamName != null ? String(mv.guestTeamName).trim() : '') : (d.guest_team_name && String(d.guest_team_name).trim());
        var hName = ov.homeTeamName ? (mv.homeTeamName != null ? String(mv.homeTeamName).trim() : '') : (d.home_team_name && String(d.home_team_name).trim());
        var gD = gName ? String(gName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---'; var hD = hName ? String(hName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---';
        var gSc = ov.guestScore ? (Number(mv.guestScore)||0) : (Number(d.guest_score)||0); var hSc = ov.homeScore ? (Number(mv.homeScore)||0) : (Number(d.home_score)||0);
        var ord = function(n){ n=Number(n)||1; var s=['th','st','nd','rd']; var v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
        var inn = ord(ov.inning ? (Number(mv.inning)||1) : (Number(d.inning)||1));
        var top = (ov.topBottom ? (mv.topBottom==='bottom'?'bottom':'top') : String(d.top_bottom_inning||'').toLowerCase()).indexOf('top')>=0 ? '▲' : '▼';
        var bal = ov.ball ? (Number(mv.ball)??0) : (Number(d.ball)??0); var str = ov.strike ? (Number(mv.strike)??0) : (Number(d.strike)??0);
        var out = ov.out ? (Number(mv.out)??0) : (Number(d.out)??0);
        var outsD = '●'.repeat(out) + '○'.repeat(3-Math.min(3,out));
        var teams = '<div class="teams-area"><div class="team-row"><span>'+gD+'</span> <span class="score">'+gSc+'</span></div><div class="team-row"><span>'+hD+'</span> <span class="score">'+hSc+'</span></div></div>';
        var inning = '<div class="data-slot"><div class="label">Inning</div><div class="value">'+top+' '+inn+'</div></div>';
        var status = '<div class="status-slot"><div class="label">Count / Outs</div><div class="value count-text">'+bal+'-'+str+' <span style="color:#ff4d4d;font-size:14px;">'+outsD+'</span></div></div>';
        sb.innerHTML = '<div class="scorebug baseball-border">'+logoSlot+teams+inning+status+'</div>';
      } else {
        var gName = ov.guestTeamName ? (mv.guestTeamName != null ? String(mv.guestTeamName).trim() : '') : (d.guest_team_name && String(d.guest_team_name).trim());
        var hName = ov.homeTeamName ? (mv.homeTeamName != null ? String(mv.homeTeamName).trim() : '') : (d.home_team_name && String(d.home_team_name).trim());
        var gD = gName ? String(gName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---'; var hD = hName ? String(hName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---';
        var gSc = ov.guestScore ? (Number(mv.guestScore)||0) : (Number(d.away_score)||0); var hSc = ov.homeScore ? (Number(mv.homeScore)||0) : (Number(d.home_score)||0);
        var ord = function(n){ n=Number(n)||1; var s=['th','st','nd','rd']; var v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
        var period = ord(d.period || 1) + ' QTR';
        var clock = (d.clock != null ? String(d.clock) : '') || '0:00';
        var shot = (d.shot_clock != null ? String(d.shot_clock) : '') || '24';
        var teams = '<div class="teams-area"><div class="team-row"><span>'+gD+'</span> <span class="score">'+gSc+'</span></div><div class="team-row"><span>'+hD+'</span> <span class="score">'+hSc+'</span></div></div>';
        var timeSlot = '<div class="data-slot"><div class="label">Time</div><div class="value clock-text">'+clock.replace(/</g,'&lt;')+'</div></div>';
        var shotSlot = '<div class="data-slot"><div class="label">Shot</div><div class="value clock-text">'+shot.replace(/</g,'&lt;')+'</div></div>';
        var status = '<div class="status-slot"><div class="label">Period</div><div class="value">'+period+'</div></div>';
        sb.innerHTML = '<div class="scorebug basketball-border">'+logoSlot+teams+timeSlot+shotSlot+status+'</div>';
      }
    }
  }).catch(function(){}).then(function(){ setTimeout(poll, 1000); });
})();
</script>
</body>
</html>`;
  return full.replace('__GRAPHIC_OPTIONS__', JSON.stringify(settings));
}

/**
 * Build basketball logo-template scorebug HTML (full document).
 */
function renderBasketballLogo(data, options) {
  const gs = graphicsSettings.get();
  const settings = { ...gs };
  if (options) {
    if (options.accentColor != null) settings.accentColor = options.accentColor;
    if (options.elements) settings.elements = { ...settings.elements, ...options.elements };
  }
  if (options && options.effectiveSport !== undefined && options.effectiveSport !== null) {
    settings.effectiveSport = options.effectiveSport;
  } else {
    settings.effectiveSport = data.sport || 'basketball';
  }
  const ov = settings.fieldOverrides || {};
  const mv = settings.manualValues || {};
  const guestName = ov.guestTeamName ? (mv.guestTeamName != null ? String(mv.guestTeamName).trim() : '') : data.guest_team_name;
  const homeName = ov.homeTeamName ? (mv.homeTeamName != null ? String(mv.homeTeamName).trim() : '') : data.home_team_name;
  const guestAbbr = abbr(guestName);
  const homeAbbr = abbr(homeName);
  const awayScore = ov.guestScore ? (Number(mv.guestScore) || 0) : (Number(data.away_score) || 0);
  const homeScore = ov.homeScore ? (Number(mv.homeScore) || 0) : (Number(data.home_score) || 0);
  const periodNum = Number(data.period) || 1;
  const clock = data.clock != null ? String(data.clock) : '0:00';
  const shotClock = data.shot_clock != null ? String(data.shot_clock) : '24';
  const logoUrl = safeLogoUrl(settings.logoUrl || '');

  const logoSlotHtml = logoUrl
    ? '<div class="logo-slot"><img src="' + logoUrl + '" alt="Logo"></div>'
    : '';
  const teamsHtml = '<div class="teams-area"><div class="team-row"><span>' + escapeHtml(guestAbbr) + '</span> <span class="score">' + awayScore + '</span></div><div class="team-row"><span>' + escapeHtml(homeAbbr) + '</span> <span class="score">' + homeScore + '</span></div></div>';
  const timeHtml = '<div class="data-slot"><div class="label">Time</div><div class="value clock-text">' + escapeHtml(clock) + '</div></div>';
  const shotHtml = '<div class="data-slot"><div class="label">Shot</div><div class="value clock-text">' + escapeHtml(shotClock) + '</div></div>';
  const periodHtml = '<div class="status-slot"><div class="label">Period</div><div class="value">' + ordinal(periodNum) + ' QTR</div></div>';
  const scorebugInner = logoSlotHtml + teamsHtml + timeHtml + shotHtml + periodHtml;
  const logoCss = getLogoTemplateCss(settings.accentColor, settings.logoBoxColor);

  const full = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>${logoCss}</style></head>
<body>
<div id="scorebug"><div class="scorebug basketball-border">${scorebugInner}</div></div>
<script>
window.__graphicOptions = __GRAPHIC_OPTIONS__;
(function poll() {
  fetch('/api/stats').then(function(r){ return r.json(); }).then(function(stats) {
    var d = stats.data || {};
    var opts = stats.graphicsSettings != null ? stats.graphicsSettings : (window.__graphicOptions || {});
    if (opts.accentColor && /^#[0-9a-fA-F]{3,8}$/.test(String(opts.accentColor))) document.documentElement.style.setProperty('--accent', opts.accentColor);
    if (opts.logoBoxColor && /^#[0-9a-fA-F]{3,8}$/.test(String(opts.logoBoxColor))) document.documentElement.style.setProperty('--logo-box-color', opts.logoBoxColor);
    var sport = (opts.autoSport !== false) ? (d.sport || null) : (opts.testSport || null);
    var tpl = opts.template || 'simple';
    var sb = document.getElementById('scorebug');
    if (!sb) return;
    if (tpl === 'logo' && (sport === 'baseball' || sport === 'basketball')) {
      var ov = opts.fieldOverrides || {}; var mv = opts.manualValues || {};
      var logoUrl = (opts.logoUrl && String(opts.logoUrl).trim()) ? String(opts.logoUrl).trim().replace(/"/g,'&quot;') : '';
      if (logoUrl && !/^(https?:|data:)/i.test(logoUrl)) logoUrl = '';
      var logoSlot = logoUrl ? '<div class="logo-slot"><img src="'+logoUrl+'" alt="Logo"></div>' : '';
      if (sport === 'baseball') {
        var gName = ov.guestTeamName ? (mv.guestTeamName != null ? String(mv.guestTeamName).trim() : '') : (d.guest_team_name && String(d.guest_team_name).trim());
        var hName = ov.homeTeamName ? (mv.homeTeamName != null ? String(mv.homeTeamName).trim() : '') : (d.home_team_name && String(d.home_team_name).trim());
        var gD = gName ? String(gName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---'; var hD = hName ? String(hName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---';
        var gSc = ov.guestScore ? (Number(mv.guestScore)||0) : (Number(d.guest_score)||0); var hSc = ov.homeScore ? (Number(mv.homeScore)||0) : (Number(d.home_score)||0);
        var ord = function(n){ n=Number(n)||1; var s=['th','st','nd','rd']; var v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
        var inn = ord(ov.inning ? (Number(mv.inning)||1) : (Number(d.inning)||1));
        var top = (ov.topBottom ? (mv.topBottom==='bottom'?'bottom':'top') : String(d.top_bottom_inning||'').toLowerCase()).indexOf('top')>=0 ? '▲' : '▼';
        var bal = ov.ball ? (Number(mv.ball)??0) : (Number(d.ball)??0); var str = ov.strike ? (Number(mv.strike)??0) : (Number(d.strike)??0);
        var out = ov.out ? (Number(mv.out)??0) : (Number(d.out)??0);
        var outsD = '●'.repeat(out) + '○'.repeat(3-Math.min(3,out));
        var teams = '<div class="teams-area"><div class="team-row"><span>'+gD+'</span> <span class="score">'+gSc+'</span></div><div class="team-row"><span>'+hD+'</span> <span class="score">'+hSc+'</span></div></div>';
        var inning = '<div class="data-slot"><div class="label">Inning</div><div class="value">'+top+' '+inn+'</div></div>';
        var status = '<div class="status-slot"><div class="label">Count / Outs</div><div class="value count-text">'+bal+'-'+str+' <span style="color:#ff4d4d;font-size:14px;">'+outsD+'</span></div></div>';
        sb.innerHTML = '<div class="scorebug baseball-border">'+logoSlot+teams+inning+status+'</div>';
      } else {
        var gName = ov.guestTeamName ? (mv.guestTeamName != null ? String(mv.guestTeamName).trim() : '') : (d.guest_team_name && String(d.guest_team_name).trim());
        var hName = ov.homeTeamName ? (mv.homeTeamName != null ? String(mv.homeTeamName).trim() : '') : (d.home_team_name && String(d.home_team_name).trim());
        var gD = gName ? String(gName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---'; var hD = hName ? String(hName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '---';
        var gSc = ov.guestScore ? (Number(mv.guestScore)||0) : (Number(d.away_score)||0); var hSc = ov.homeScore ? (Number(mv.homeScore)||0) : (Number(d.home_score)||0);
        var ord = function(n){ n=Number(n)||1; var s=['th','st','nd','rd']; var v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); };
        var period = ord(d.period || 1) + ' QTR';
        var clock = (d.clock != null ? String(d.clock) : '') || '0:00';
        var shot = (d.shot_clock != null ? String(d.shot_clock) : '') || '24';
        var teams = '<div class="teams-area"><div class="team-row"><span>'+gD+'</span> <span class="score">'+gSc+'</span></div><div class="team-row"><span>'+hD+'</span> <span class="score">'+hSc+'</span></div></div>';
        var timeSlot = '<div class="data-slot"><div class="label">Time</div><div class="value clock-text">'+clock.replace(/</g,'&lt;')+'</div></div>';
        var shotSlot = '<div class="data-slot"><div class="label">Shot</div><div class="value clock-text">'+shot.replace(/</g,'&lt;')+'</div></div>';
        var status = '<div class="status-slot"><div class="label">Period</div><div class="value">'+period+'</div></div>';
        sb.innerHTML = '<div class="scorebug basketball-border">'+logoSlot+teams+timeSlot+shotSlot+status+'</div>';
      }
    }
  }).catch(function(){}).then(function(){ setTimeout(poll, 1000); });
})();
</script>
</body>
</html>`;
  return full.replace('__GRAPHIC_OPTIONS__', JSON.stringify(settings));
}

/**
 * Render score graphic HTML for the given sport and data. Returns placeholder for unsupported sports.
 * Branches on graphicsSettings.template (simple vs logo) and sport.
 * @param {string} sport
 * @param {Record<string, unknown>} data
 * @param {{ accentColor?: string, elements?: Record<string, boolean> }} [options]
 * @returns {string}
 */
function render(sport, data, options) {
  const gs = graphicsSettings.get();
  const template = gs.template === 'logo' ? 'logo' : 'simple';
  if (template === 'logo') {
    if (sport === 'baseball') return renderBaseballLogo(data, options);
    if (sport === 'basketball') return renderBasketballLogo(data, options);
  } else {
    if (sport === 'baseball') return renderBaseball(data, options);
  }
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Score graphic</title></head><body><p>Score graphic not available for ' + escapeHtml(sport || 'this sport') + '.</p></body></html>';
}

module.exports = { render, renderBaseball, renderBaseballLogo, renderBasketballLogo };
