(function () {
  const API = '/api';

  const accentColor = document.getElementById('accent-color');
  const accentHex = document.getElementById('accent-hex');
  const btnSave = document.getElementById('btn-save');
  const autoSport = document.getElementById('auto-sport');
  const testSport = document.getElementById('test-sport');
  const templateSimple = document.getElementById('template-simple');
  const templateLogo = document.getElementById('template-logo');
  const logoUrlRow = document.getElementById('logo-url-row');
  const logoUrlInput = document.getElementById('logo-url');
  const logoBoxColorRow = document.getElementById('logo-box-color-row');
  const logoBoxColor = document.getElementById('logo-box-color');
  const logoBoxHex = document.getElementById('logo-box-hex');

  const elementIds = ['teams', 'awayScore', 'homeScore', 'inning', 'count', 'outs', 'clock'];

  function updateLogoUrlVisibility() {
    const show = templateLogo.checked;
    logoUrlRow.style.display = show ? '' : 'none';
    logoBoxColorRow.style.display = show ? '' : 'none';
  }
  templateSimple.addEventListener('change', updateLogoUrlVisibility);
  templateLogo.addEventListener('change', updateLogoUrlVisibility);

  const MANUAL_FIELD_IDS = ['guestTeamName', 'homeTeamName', 'guestScore', 'homeScore', 'inning', 'topBottom', 'ball', 'strike', 'out', 'clock'];

  function updateTestSportDisabled() {
    testSport.disabled = autoSport.checked;
  }

  autoSport.addEventListener('change', updateTestSportDisabled);

  function hexToInputColor(hex) {
    if (!hex || typeof hex !== 'string') return '#00ff41';
    const m = hex.trim().match(/^#?([0-9A-Fa-f]{6})$/);
    return m ? '#' + m[1] : '#00ff41';
  }

  function syncColorToHex() {
    accentHex.value = accentColor.value;
  }

  function syncHexToColor() {
    const hex = accentHex.value.trim();
    if (/^#?[0-9A-Fa-f]{6}$/.test(hex)) {
      accentColor.value = hexToInputColor(hex);
    }
  }

  accentColor.addEventListener('input', syncColorToHex);
  accentHex.addEventListener('input', syncHexToColor);
  accentHex.addEventListener('blur', syncHexToColor);

  function syncLogoBoxColorToHex() {
    logoBoxHex.value = logoBoxColor.value;
  }
  function syncLogoBoxHexToColor() {
    const hex = logoBoxHex.value.trim();
    if (/^#?[0-9A-Fa-f]{6}$/.test(hex)) {
      logoBoxColor.value = hexToInputColor(hex);
    }
  }
  logoBoxColor.addEventListener('input', syncLogoBoxColorToHex);
  logoBoxHex.addEventListener('input', syncLogoBoxHexToColor);
  logoBoxHex.addEventListener('blur', syncLogoBoxHexToColor);

  function load() {
    fetch(API + '/graphics-settings')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        autoSport.checked = data.autoSport !== false;
        if (data.testSport && testSport.querySelector('option[value="' + data.testSport + '"]')) {
          testSport.value = data.testSport;
        }
        updateTestSportDisabled();
        if (data.template === 'logo') {
          templateLogo.checked = true;
          templateSimple.checked = false;
        } else {
          templateSimple.checked = true;
          templateLogo.checked = false;
        }
        logoUrlInput.value = data.logoUrl != null ? data.logoUrl : '';
        const lbColor = hexToInputColor(data.logoBoxColor);
        logoBoxColor.value = lbColor;
        logoBoxHex.value = lbColor;
        updateLogoUrlVisibility();
        var fo = data.fieldOverrides || {};
        var mv = data.manualValues || {};
        MANUAL_FIELD_IDS.forEach(function (id) {
          var ovEl = document.getElementById('ov-' + id);
          var manualEl = document.getElementById('manual-' + id);
          if (ovEl) ovEl.checked = fo[id] === true;
          if (manualEl) {
            var v = mv[id];
            if (v !== undefined && v !== null) manualEl.value = v;
            else if (id === 'topBottom') manualEl.value = 'top';
            else if (id === 'guestTeamName' || id === 'homeTeamName' || id === 'clock') manualEl.value = '';
            else manualEl.value = 0;
            if (id === 'inning') manualEl.value = Number(manualEl.value) || 1;
          }
        });
        const color = hexToInputColor(data.accentColor);
        accentColor.value = color;
        accentHex.value = color;
        const el = data.elements || {};
        elementIds.forEach(function (id) {
          const cb = document.getElementById('el-' + id);
          if (cb) cb.checked = el[id] !== false;
        });
      })
      .catch(function () {});
  }

  function save() {
    const elements = {};
    elementIds.forEach(function (id) {
      const cb = document.getElementById('el-' + id);
      elements[id] = cb ? cb.checked : true;
    });
    var fieldOverrides = {};
    var manualValues = {};
    MANUAL_FIELD_IDS.forEach(function (id) {
      var ovEl = document.getElementById('ov-' + id);
      var manualEl = document.getElementById('manual-' + id);
      if (ovEl) fieldOverrides[id] = ovEl.checked;
      if (manualEl) {
        if (id === 'guestTeamName' || id === 'homeTeamName' || id === 'clock') manualValues[id] = manualEl.value.trim();
        else if (id === 'topBottom') manualValues[id] = manualEl.value === 'bottom' ? 'bottom' : 'top';
        else if (id === 'guestScore' || id === 'homeScore' || id === 'inning' || id === 'ball' || id === 'strike' || id === 'out') manualValues[id] = parseInt(manualEl.value, 10) || 0;
        else manualValues[id] = manualEl.value;
        if (id === 'inning' && (manualValues[id] < 1 || manualValues[id] > 10)) manualValues[id] = 1;
      }
    });
    const payload = {
      accentColor: accentHex.value.trim() || accentColor.value,
      elements: elements,
      autoSport: autoSport.checked,
      testSport: testSport.value || 'baseball',
      fieldOverrides: fieldOverrides,
      manualValues: manualValues,
      template: templateLogo.checked ? 'logo' : 'simple',
      logoUrl: logoUrlInput.value.trim(),
      logoBoxColor: logoBoxHex.value.trim() || logoBoxColor.value,
    };
    fetch(API + '/graphics-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function () {
        var label = btnSave.textContent;
        btnSave.textContent = 'Saved';
        setTimeout(function () { btnSave.textContent = label; }, 1500);
      })
      .catch(function () {
        alert('Failed to save settings');
      });
  }

  btnSave.addEventListener('click', save);
  load();
})();
