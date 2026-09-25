(function () {
  const API = '/api';
  const FONT_CHOICES = ['Arial', 'Georgia', 'Verdana', 'Impact', 'Trebuchet MS', 'Courier New', 'monospace'];

  const canvasEl = document.getElementById('canvas');
  const canvas = new fabric.Canvas(canvasEl, { preserveObjectStacking: true });

  const nameInput = document.getElementById('design-name');
  const sportSelect = document.getElementById('design-sport');
  const widthInput = document.getElementById('canvas-width');
  const heightInput = document.getElementById('canvas-height');
  const presetSelect = document.getElementById('canvas-preset');
  const bgTransparent = document.getElementById('bg-transparent');
  const bgColorRow = document.getElementById('bg-color-row');
  const bgColor = document.getElementById('bg-color');
  const objectPanel = document.getElementById('object-panel');
  const bindingPanel = document.getElementById('binding-panel');
  const layersList = document.getElementById('layers-list');
  const fontsList = document.getElementById('fonts-list');
  const previewSource = document.getElementById('preview-source');

  let currentId = null;
  let customFonts = []; // { name, dataUrl, format }
  let bindings = new Map(); // fabric object -> { field, template, ordinal }
  let fieldsCache = {}; // sport -> [fields]

  // ---------------- Canvas setup ----------------

  function applyCanvasSize() {
    const w = Math.max(1, Math.min(7680, parseInt(widthInput.value, 10) || 1920));
    const h = Math.max(1, Math.min(4320, parseInt(heightInput.value, 10) || 1080));
    canvas.setDimensions({ width: w, height: h });
    canvas.backgroundColor = bgTransparent.checked ? '' : bgColor.value;
    canvas.requestRenderAll();
  }

  presetSelect.addEventListener('change', () => {
    if (!presetSelect.value) return;
    const [w, h] = presetSelect.value.split('x');
    widthInput.value = w;
    heightInput.value = h;
    applyCanvasSize();
  });
  document.getElementById('btn-apply-canvas-size').addEventListener('click', applyCanvasSize);
  bgTransparent.addEventListener('change', () => {
    bgColorRow.style.display = bgTransparent.checked ? 'none' : '';
    applyCanvasSize();
  });
  bgColor.addEventListener('input', applyCanvasSize);

  // ---------------- Object creation tools ----------------

  function centerPos() {
    return { left: canvas.getWidth() / 2 - 60, top: canvas.getHeight() / 2 - 30 };
  }

  function addAndSelect(obj) {
    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    refreshLayers();
  }

  document.getElementById('tool-rect').addEventListener('click', () => {
    const p = centerPos();
    addAndSelect(new fabric.Rect({ left: p.left, top: p.top, width: 160, height: 90, fill: '#00c2ff', rx: 4, ry: 4 }));
  });
  document.getElementById('tool-circle').addEventListener('click', () => {
    const p = centerPos();
    addAndSelect(new fabric.Circle({ left: p.left, top: p.top, radius: 50, fill: '#00c2ff' }));
  });
  document.getElementById('tool-line').addEventListener('click', () => {
    const p = centerPos();
    addAndSelect(new fabric.Line([p.left, p.top, p.left + 150, p.top], { stroke: '#ffffff', strokeWidth: 3 }));
  });
  document.getElementById('tool-text').addEventListener('click', () => {
    const p = centerPos();
    addAndSelect(new fabric.Textbox('Text', { left: p.left, top: p.top, width: 200, fontSize: 28, fill: '#ffffff', fontFamily: 'Arial' }));
  });
  document.getElementById('tool-delete').addEventListener('click', deleteSelected);
  document.getElementById('tool-front').addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (o) { canvas.bringObjectToFront(o); refreshLayers(); }
  });
  document.getElementById('tool-back').addEventListener('click', () => {
    const o = canvas.getActiveObject();
    if (o) { canvas.sendObjectToBack(o); refreshLayers(); }
  });

  function deleteSelected() {
    const active = canvas.getActiveObjects();
    active.forEach((o) => { bindings.delete(o); canvas.remove(o); });
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    refreshLayers();
    updateSelectionPanels();
  }

  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement === document.body) {
      if (canvas.getActiveObject()) { deleteSelected(); e.preventDefault(); }
    }
  });

  // ---------------- Image import ----------------

  const imageInput = document.getElementById('image-input');
  document.getElementById('tool-image').addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const p = centerPos();
      fabric.FabricImage.fromURL(reader.result, {}, { left: p.left, top: p.top }).then((img) => {
        img.scaleToWidth(Math.min(400, canvas.getWidth() * 0.5));
        addAndSelect(img);
      });
    };
    reader.readAsDataURL(file);
    imageInput.value = '';
  });

  // ---------------- Custom fonts ----------------

  const fontInput = document.getElementById('font-input');
  document.getElementById('btn-upload-font').addEventListener('click', () => fontInput.click());
  fontInput.addEventListener('change', () => {
    const file = fontInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ext = (file.name.split('.').pop() || 'ttf').toLowerCase();
      const format = ext === 'otf' ? 'opentype' : ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : 'truetype';
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w -]/g, '') || 'CustomFont' + (customFonts.length + 1);
      customFonts.push({ name, dataUrl: reader.result, format });
      GraphicsEngine.injectFonts(customFonts);
      renderFontsList();
      populateFontFamilyOptions();
    };
    reader.readAsDataURL(file);
    fontInput.value = '';
  });

  function renderFontsList() {
    fontsList.innerHTML = '';
    if (!customFonts.length) {
      fontsList.appendChild(li('empty-hint', 'No custom fonts uploaded.'));
      return;
    }
    customFonts.forEach((f, i) => {
      const item = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.style.fontFamily = "'" + f.name + "'";
      nameSpan.textContent = f.name;
      item.appendChild(nameSpan);
      const rm = document.createElement('button');
      rm.className = 'secondary';
      rm.textContent = '✕';
      rm.addEventListener('click', () => {
        customFonts.splice(i, 1);
        GraphicsEngine.injectFonts(customFonts);
        renderFontsList();
        populateFontFamilyOptions();
      });
      item.appendChild(rm);
      fontsList.appendChild(item);
    });
  }

  function li(cls, text) {
    const e = document.createElement('li');
    e.className = cls;
    e.textContent = text;
    return e;
  }

  let fontFamilySelectRef = null;
  function populateFontFamilyOptions() {
    if (!fontFamilySelectRef) return;
    const current = fontFamilySelectRef.value;
    fontFamilySelectRef.innerHTML = '';
    FONT_CHOICES.concat(customFonts.map((f) => f.name)).forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      fontFamilySelectRef.appendChild(opt);
    });
    if (Array.from(fontFamilySelectRef.options).some((o) => o.value === current)) {
      fontFamilySelectRef.value = current;
    }
  }

  // ---------------- Layers panel ----------------

  function refreshLayers() {
    layersList.innerHTML = '';
    const objs = canvas.getObjects().slice().reverse();
    if (!objs.length) {
      layersList.appendChild(li('empty-hint', 'No objects yet — add one from the toolbar.'));
      return;
    }
    const active = canvas.getActiveObject();
    objs.forEach((obj) => {
      const item = document.createElement('li');
      if (obj === active) item.className = 'active';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = labelFor(obj);
      item.appendChild(nameSpan);
      if (bindings.has(obj)) item.appendChild(spanBadge('bound'));
      item.addEventListener('click', () => {
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
      });
      layersList.appendChild(item);
    });
  }

  function spanBadge(text) {
    const s = document.createElement('span');
    s.className = 'badge';
    s.textContent = text;
    return s;
  }

  function labelFor(obj) {
    if (obj.type === 'textbox' || obj.type === 'text' || obj.type === 'i-text') {
      return 'Text: ' + (obj.text || '').slice(0, 24);
    }
    return obj.type.charAt(0).toUpperCase() + obj.type.slice(1);
  }

  // ---------------- Object properties panel ----------------

  function row(labelText) {
    const r = document.createElement('div');
    r.className = 'field-row';
    const l = document.createElement('label');
    l.textContent = labelText;
    r.appendChild(l);
    return r;
  }

  function updateSelectionPanels() {
    const obj = canvas.getActiveObject();
    objectPanel.innerHTML = '';
    bindingPanel.innerHTML = '';
    fontFamilySelectRef = null;
    if (!obj) {
      objectPanel.appendChild(li('empty-hint', 'Select an object to edit its properties.'));
      bindingPanel.appendChild(li('empty-hint', 'Select a text object to bind it to live data.'));
      refreshLayers();
      return;
    }

    const isText = obj.type === 'textbox' || obj.type === 'text' || obj.type === 'i-text';

    if (isText) {
      const r1 = row('Text');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = obj.text || '';
      input.addEventListener('input', () => { obj.set('text', input.value); canvas.requestRenderAll(); refreshLayers(); });
      r1.appendChild(input);
      objectPanel.appendChild(r1);

      const r2 = row('Font');
      const fontSelect = document.createElement('select');
      fontFamilySelectRef = fontSelect;
      populateFontFamilyOptions();
      fontSelect.value = obj.fontFamily || 'Arial';
      fontSelect.addEventListener('change', () => { obj.set('fontFamily', fontSelect.value); canvas.requestRenderAll(); });
      r2.appendChild(fontSelect);
      objectPanel.appendChild(r2);

      const r3 = row('Size');
      const sizeInput = document.createElement('input');
      sizeInput.type = 'number';
      sizeInput.min = '4'; sizeInput.max = '400';
      sizeInput.value = obj.fontSize || 24;
      sizeInput.addEventListener('input', () => { obj.set('fontSize', Number(sizeInput.value) || 24); canvas.requestRenderAll(); });
      r3.appendChild(sizeInput);
      objectPanel.appendChild(r3);

      const r4 = row('Style');
      const boldBtn = document.createElement('button');
      boldBtn.className = 'secondary';
      boldBtn.textContent = 'B';
      boldBtn.style.fontWeight = '900';
      boldBtn.addEventListener('click', () => {
        const bold = obj.fontWeight === 'bold' || obj.fontWeight === '700' || obj.fontWeight === 700;
        obj.set('fontWeight', bold ? 'normal' : 'bold');
        canvas.requestRenderAll();
      });
      const italicBtn = document.createElement('button');
      italicBtn.className = 'secondary';
      italicBtn.textContent = 'I';
      italicBtn.style.fontStyle = 'italic';
      italicBtn.addEventListener('click', () => {
        obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic');
        canvas.requestRenderAll();
      });
      r4.appendChild(boldBtn);
      r4.appendChild(italicBtn);
      objectPanel.appendChild(r4);

      const r5 = row('Align');
      const alignSelect = document.createElement('select');
      ['left', 'center', 'right'].forEach((a) => {
        const opt = document.createElement('option');
        opt.value = a; opt.textContent = a;
        alignSelect.appendChild(opt);
      });
      alignSelect.value = obj.textAlign || 'left';
      alignSelect.addEventListener('change', () => { obj.set('textAlign', alignSelect.value); canvas.requestRenderAll(); });
      r5.appendChild(alignSelect);
      objectPanel.appendChild(r5);
    }

    if (obj.type !== 'image') {
      const rf = row('Fill');
      const fillInput = document.createElement('input');
      fillInput.type = 'color';
      fillInput.value = toHex(obj.fill) || '#ffffff';
      fillInput.addEventListener('input', () => { obj.set('fill', fillInput.value); canvas.requestRenderAll(); });
      rf.appendChild(fillInput);
      objectPanel.appendChild(rf);
    }

    if (obj.type === 'rect' || obj.type === 'line' || obj.type === 'circle') {
      const rs = row('Stroke');
      const strokeInput = document.createElement('input');
      strokeInput.type = 'color';
      strokeInput.value = toHex(obj.stroke) || '#ffffff';
      strokeInput.addEventListener('input', () => { obj.set('stroke', strokeInput.value); canvas.requestRenderAll(); });
      rs.appendChild(strokeInput);
      const swInput = document.createElement('input');
      swInput.type = 'number';
      swInput.min = '0'; swInput.max = '40';
      swInput.value = obj.strokeWidth || 0;
      swInput.style.marginLeft = '0.4rem';
      swInput.addEventListener('input', () => { obj.set('strokeWidth', Number(swInput.value) || 0); canvas.requestRenderAll(); });
      rs.appendChild(swInput);
      objectPanel.appendChild(rs);
    }

    if (obj.type === 'rect') {
      const rr = row('Corner radius');
      const rxInput = document.createElement('input');
      rxInput.type = 'number';
      rxInput.min = '0'; rxInput.max = '200';
      rxInput.value = obj.rx || 0;
      rxInput.addEventListener('input', () => {
        const v = Number(rxInput.value) || 0;
        obj.set({ rx: v, ry: v });
        canvas.requestRenderAll();
      });
      rr.appendChild(rxInput);
      objectPanel.appendChild(rr);
    }

    const ro = row('Opacity');
    const opInput = document.createElement('input');
    opInput.type = 'number';
    opInput.min = '0'; opInput.max = '1'; opInput.step = '0.05';
    opInput.value = obj.opacity != null ? obj.opacity : 1;
    opInput.addEventListener('input', () => { obj.set('opacity', Number(opInput.value)); canvas.requestRenderAll(); });
    ro.appendChild(opInput);
    objectPanel.appendChild(ro);

    // Binding panel (text objects only)
    if (isText) {
      renderBindingPanel(obj);
    } else {
      bindingPanel.appendChild(li('empty-hint', 'Only text objects can be bound to data.'));
    }

    refreshLayers();
  }

  function toHex(v) {
    if (typeof v !== 'string') return null;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    return null;
  }

  function renderBindingPanel(obj) {
    const current = bindings.get(obj);
    const r1 = row('Bind');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!current;
    r1.appendChild(checkbox);
    bindingPanel.appendChild(r1);

    const r2 = row('Field');
    const fieldSelect = document.createElement('select');
    fieldSelect.disabled = !current;
    r2.appendChild(fieldSelect);
    bindingPanel.appendChild(r2);

    const r3 = row('Template');
    const tmplInput = document.createElement('input');
    tmplInput.type = 'text';
    tmplInput.placeholder = '{value}';
    tmplInput.value = current ? (current.template || '{value}') : '{value}';
    tmplInput.disabled = !current;
    r3.appendChild(tmplInput);
    bindingPanel.appendChild(r3);

    const r4 = row('Ordinal (1st/2nd)');
    const ordCheck = document.createElement('input');
    ordCheck.type = 'checkbox';
    ordCheck.checked = current ? !!current.ordinal : false;
    ordCheck.disabled = !current;
    r4.appendChild(ordCheck);
    bindingPanel.appendChild(r4);

    function commit() {
      if (!checkbox.checked) {
        bindings.delete(obj);
      } else {
        bindings.set(obj, {
          field: fieldSelect.value,
          template: tmplInput.value || '{value}',
          ordinal: ordCheck.checked,
        });
      }
      refreshLayers();
    }

    loadFields(sportSelect.value).then((fields) => {
      fieldSelect.innerHTML = '';
      fields.forEach((f) => {
        const opt = document.createElement('option');
        opt.value = f; opt.textContent = f;
        fieldSelect.appendChild(opt);
      });
      if (current && fields.includes(current.field)) fieldSelect.value = current.field;
    });

    checkbox.addEventListener('change', () => {
      fieldSelect.disabled = !checkbox.checked;
      tmplInput.disabled = !checkbox.checked;
      ordCheck.disabled = !checkbox.checked;
      commit();
    });
    fieldSelect.addEventListener('change', commit);
    tmplInput.addEventListener('input', commit);
    ordCheck.addEventListener('change', commit);
  }

  function loadFields(sport) {
    const key = sport || 'generic';
    if (fieldsCache[key]) return Promise.resolve(fieldsCache[key]);
    const qs = sport && sport !== 'generic' ? '?sport=' + encodeURIComponent(sport) : '';
    return fetch(API + '/fields' + qs).then((r) => r.json()).then((data) => {
      fieldsCache[key] = data.fields;
      return data.fields;
    });
  }

  canvas.on('selection:created', updateSelectionPanels);
  canvas.on('selection:updated', updateSelectionPanels);
  canvas.on('selection:cleared', updateSelectionPanels);
  canvas.on('object:added', refreshLayers);
  canvas.on('object:removed', refreshLayers);
  canvas.on('object:modified', refreshLayers);
  sportSelect.addEventListener('change', () => { fieldsCache = {}; updateSelectionPanels(); });

  // ---------------- Save / Load / New / Templates ----------------

  function buildBindingsArray() {
    const objs = canvas.getObjects();
    const out = [];
    bindings.forEach((cfg, obj) => {
      const index = objs.indexOf(obj);
      if (index !== -1) out.push({ index, field: cfg.field, template: cfg.template, ordinal: cfg.ordinal });
    });
    return out;
  }

  function currentPayload() {
    return {
      name: nameInput.value.trim() || 'Untitled graphic',
      sport: sportSelect.value,
      width: canvas.getWidth(),
      height: canvas.getHeight(),
      background: bgTransparent.checked ? 'transparent' : bgColor.value,
      canvas: canvas.toJSON(),
      bindings: buildBindingsArray(),
      fonts: customFonts,
    };
  }

  function save() {
    const payload = currentPayload();
    const req = currentId
      ? fetch(API + '/designs/' + currentId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : fetch(API + '/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    req.then((r) => r.json()).then((d) => {
      currentId = d.id;
      flash(document.getElementById('btn-save'), 'Saved');
    });
  }

  function saveAsNew() {
    currentId = null;
    save();
  }

  function flash(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1200);
  }

  function loadDesignData(design, keepId) {
    currentId = keepId ? design.id : null;
    nameInput.value = design.name || 'Untitled graphic';
    sportSelect.value = design.sport && Array.from(sportSelect.options).some((o) => o.value === design.sport) ? design.sport : 'generic';
    widthInput.value = design.width || 1920;
    heightInput.value = design.height || 1080;
    const transparent = !design.background || design.background === 'transparent';
    bgTransparent.checked = transparent;
    bgColorRow.style.display = transparent ? 'none' : '';
    if (!transparent) bgColor.value = design.background;
    customFonts = Array.isArray(design.fonts) ? design.fonts.slice() : [];
    GraphicsEngine.injectFonts(customFonts);
    renderFontsList();

    canvas.clear();
    canvas.setDimensions({ width: design.width || 1920, height: design.height || 1080 });
    canvas.backgroundColor = transparent ? '' : design.background;
    canvas.loadFromJSON(design.canvas || { objects: [] }).then(() => {
      bindings = new Map();
      const objs = canvas.getObjects();
      (design.bindings || []).forEach((b) => {
        const obj = objs[b.index];
        if (obj) bindings.set(obj, { field: b.field, template: b.template, ordinal: b.ordinal });
      });
      fieldsCache = {};
      canvas.requestRenderAll();
      refreshLayers();
      populateFontFamilyOptions();
      updateSelectionPanels();
    });
  }

  function newDesign() {
    currentId = null;
    nameInput.value = 'Untitled graphic';
    sportSelect.value = 'generic';
    widthInput.value = 1920;
    heightInput.value = 1080;
    bgTransparent.checked = true;
    bgColorRow.style.display = 'none';
    customFonts = [];
    bindings = new Map();
    canvas.clear();
    canvas.setDimensions({ width: 1920, height: 1080 });
    canvas.backgroundColor = '';
    canvas.requestRenderAll();
    renderFontsList();
    refreshLayers();
    updateSelectionPanels();
  }

  function deleteCurrent() {
    if (!currentId) { newDesign(); return; }
    if (!confirm('Delete "' + nameInput.value + '"? This cannot be undone.')) return;
    fetch(API + '/designs/' + currentId, { method: 'DELETE' }).then(() => newDesign());
  }

  document.getElementById('btn-save').addEventListener('click', save);
  document.getElementById('btn-save-as').addEventListener('click', saveAsNew);
  document.getElementById('btn-new').addEventListener('click', () => {
    if (confirm('Start a new graphic? Unsaved changes will be lost.')) newDesign();
  });
  document.getElementById('btn-delete').addEventListener('click', deleteCurrent);

  // ---------------- Open modal ----------------

  const modalOpen = document.getElementById('modal-open');
  document.getElementById('btn-open').addEventListener('click', () => {
    fetch(API + '/designs').then((r) => r.json()).then((list) => {
      const grid = document.getElementById('open-grid');
      grid.innerHTML = '';
      if (!list.length) grid.appendChild(li('empty-hint', 'No saved graphics yet.'));
      list.forEach((d) => {
        const card = document.createElement('div');
        card.className = 'design-card';
        const title = document.createElement('div');
        title.textContent = d.name;
        const sport = document.createElement('div');
        sport.className = 'sport';
        sport.textContent = (d.sport || 'generic') + ' · ' + d.width + '×' + d.height;
        card.appendChild(title);
        card.appendChild(sport);
        card.addEventListener('click', () => {
          fetch(API + '/designs/' + d.id).then((r) => r.json()).then((full) => {
            loadDesignData(full, true);
            modalOpen.classList.add('hidden');
          });
        });
        grid.appendChild(card);
      });
      modalOpen.classList.remove('hidden');
    });
  });
  document.getElementById('close-open').addEventListener('click', () => modalOpen.classList.add('hidden'));

  // ---------------- Templates modal ----------------

  const modalTemplates = document.getElementById('modal-templates');
  document.getElementById('btn-templates').addEventListener('click', () => {
    fetch(API + '/templates').then((r) => r.json()).then((list) => {
      const grid = document.getElementById('templates-grid');
      grid.innerHTML = '';
      if (!list.length) grid.appendChild(li('empty-hint', 'No templates found.'));
      list.forEach((t) => {
        const card = document.createElement('div');
        card.className = 'template-card';
        const cat = document.createElement('div');
        cat.className = 'cat';
        cat.textContent = t.category;
        const title = document.createElement('div');
        title.textContent = t.name;
        const sport = document.createElement('div');
        sport.className = 'sport';
        sport.textContent = (t.sport || 'generic') + ' · ' + t.width + '×' + t.height;
        card.appendChild(cat);
        card.appendChild(title);
        card.appendChild(sport);
        card.addEventListener('click', () => {
          fetch(API + '/templates/' + t.id).then((r) => r.json()).then((full) => {
            loadDesignData(full, false);
            modalTemplates.classList.add('hidden');
          });
        });
        grid.appendChild(card);
      });
      modalTemplates.classList.remove('hidden');
    });
  });
  document.getElementById('close-templates').addEventListener('click', () => modalTemplates.classList.add('hidden'));

  // ---------------- Live/test preview ----------------

  function testDataFor(sport) {
    const data = { sport: sport };
    return loadFields(sport).then((fields) => {
      fields.forEach((f) => {
        if (f === 'sport') return;
        if (/team_name/.test(f)) data[f] = f.indexOf('home') === 0 ? 'HOME TEAM' : 'AWAY TEAM';
        else if (/score/.test(f)) data[f] = 7;
        else if (/clock/.test(f)) data[f] = '12:00';
        else if (/(inning|period|quarter|half|set)$/.test(f)) data[f] = 3;
        else if (f === 'ball') data[f] = 2;
        else if (f === 'strike') data[f] = 1;
        else if (f === 'out') data[f] = 1;
        else if (f === 'down') data[f] = 2;
        else if (f === 'to_go') data[f] = 7;
        else data[f] = '—';
      });
      return data;
    });
  }

  function tickPreview() {
    const bArr = buildBindingsArray();
    if (!bArr.length) return;
    if (previewSource.value === 'test') {
      testDataFor(sportSelect.value).then((data) => GraphicsEngine.applyBindings(canvas, bArr, data));
    } else {
      fetch(API + '/stats').then((r) => r.json()).then((stats) => {
        GraphicsEngine.applyBindings(canvas, bArr, stats.data || {});
      }).catch(() => {});
    }
  }
  setInterval(tickPreview, 1000);

  // ---------------- Init ----------------

  applyCanvasSize();
  renderFontsList();
  refreshLayers();
  updateSelectionPanels();
})();
