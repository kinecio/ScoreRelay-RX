(function () {
  const m = location.pathname.match(/\/output\/([a-zA-Z0-9_-]+)/);
  const outputId = m ? m[1] : null;
  const viewport = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  if (!outputId) {
    document.body.textContent = 'No output id in URL.';
    return;
  }

  // designId -> { wrap, canvasEl, fabricCanvas, bindings, updatedAt }
  const loaded = new Map();
  let latestData = {};
  let refWidth = 1920;
  let refHeight = 1080;

  // Scale the fixed reference stage (default 1920x1080/16:9) to fit
  // whatever pixel size OBS/vMix actually gives this browser source, so
  // graphics resize to fit the source instead of being cropped or tiny.
  function layout() {
    stage.style.width = refWidth + 'px';
    stage.style.height = refHeight + 'px';
    const vw = viewport.clientWidth || window.innerWidth;
    const vh = viewport.clientHeight || window.innerHeight;
    const scale = Math.min(vw / refWidth, vh / refHeight) || 1;
    const offsetX = (vw - refWidth * scale) / 2;
    const offsetY = (vh - refHeight * scale) / 2;
    stage.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
  }

  function makeSlot(designId) {
    const wrap = document.createElement('div');
    wrap.className = 'gfx-wrap';
    const canvasEl = document.createElement('canvas');
    wrap.appendChild(canvasEl);
    stage.appendChild(wrap);
    return { wrap, canvasEl };
  }

  function loadGraphic(g) {
    const design = g.design;
    let entry = loaded.get(g.designId);
    const needsRebuild = !entry || entry.updatedAt !== design.updatedAt;
    if (needsRebuild) {
      if (entry) {
        entry.wrap.remove();
      }
      const slot = makeSlot(g.designId);
      const fabricCanvas = new fabric.StaticCanvas(slot.canvasEl, {
        width: design.width,
        height: design.height,
        backgroundColor: design.background === 'transparent' ? '' : design.background,
      });
      entry = {
        wrap: slot.wrap,
        canvasEl: slot.canvasEl,
        fabricCanvas,
        bindings: design.bindings || [],
        updatedAt: design.updatedAt,
      };
      loaded.set(g.designId, entry);
      if (Array.isArray(design.fonts) && design.fonts.length) {
        GraphicsEngine.injectFonts(design.fonts);
      }
      fabricCanvas.loadFromJSON(design.canvas || { objects: [] }).then(() => {
        fabricCanvas.requestRenderAll();
        GraphicsEngine.applyBindings(fabricCanvas, entry.bindings, latestData);
      });
    }
    entry.wrap.style.left = (g.x || 0) + 'px';
    entry.wrap.style.top = (g.y || 0) + 'px';
    entry.wrap.style.display = g.visible ? '' : 'none';
  }

  function refreshStructure() {
    fetch('/api/outputs/' + outputId + '/full')
      .then((r) => r.json())
      .then((state) => {
        const newRefW = state.width || 1920;
        const newRefH = state.height || 1080;
        if (newRefW !== refWidth || newRefH !== refHeight) {
          refWidth = newRefW;
          refHeight = newRefH;
          layout();
        }
        const seen = new Set();
        (state.graphics || []).forEach((g) => {
          seen.add(g.designId);
          loadGraphic(g);
        });
        loaded.forEach((entry, id) => {
          if (!seen.has(id)) {
            entry.wrap.remove();
            loaded.delete(id);
          }
        });
      })
      .catch(() => {});
  }

  function refreshData() {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((stats) => {
        latestData = stats.data || {};
        loaded.forEach((entry) => {
          GraphicsEngine.applyBindings(entry.fabricCanvas, entry.bindings, latestData);
        });
      })
      .catch(() => {});
  }

  window.addEventListener('resize', layout);
  layout();
  refreshStructure();
  refreshData();
  setInterval(refreshStructure, 3000);
  setInterval(refreshData, 700);
})();
