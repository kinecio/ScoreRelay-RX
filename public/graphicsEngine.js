/**
 * Shared helpers for applying data-field bindings to a loaded Fabric canvas.
 * Used by both the designer's live preview and the /output/:id player.
 * A binding is { index, field, template, ordinal } where `index` is the
 * object's position in canvas.getObjects() (bindings are not embedded in the
 * canvas JSON itself, since Fabric doesn't round-trip custom object props).
 */
(function (global) {
  function ordinal(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n == null ? '' : n);
    const s = ['th', 'st', 'nd', 'rd'];
    const v = Math.abs(num) % 100;
    return num + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /**
   * @param {{ field: string, template?: string, ordinal?: boolean }} binding
   * @param {Record<string, unknown>} data
   * @returns {string}
   */
  function resolveBindingText(binding, data) {
    let raw = data ? data[binding.field] : undefined;
    if (raw === undefined || raw === null) raw = '';
    const value = binding.ordinal ? ordinal(raw) : String(raw);
    const tmpl = binding.template && binding.template.indexOf('{value}') !== -1 ? binding.template : '{value}';
    return tmpl.split('{value}').join(value);
  }

  /**
   * Apply all bindings for a design to its (already loaded) Fabric canvas.
   * @param {fabric.StaticCanvas|fabric.Canvas} canvas
   * @param {Array<{index:number, field:string, template?:string, ordinal?:boolean}>} bindings
   * @param {Record<string, unknown>} data
   */
  function applyBindings(canvas, bindings, data) {
    if (!canvas || !Array.isArray(bindings)) return;
    const objects = canvas.getObjects();
    bindings.forEach((b) => {
      const obj = objects[b.index];
      if (!obj || typeof obj.set !== 'function') return;
      if (obj.type !== 'textbox' && obj.type !== 'text' && obj.type !== 'i-text') return;
      obj.set('text', resolveBindingText(b, data || {}));
    });
    canvas.requestRenderAll();
  }

  /** Inject @font-face rules for custom fonts embedded in a design (design.fonts: [{name, dataUrl, format}]). */
  function injectFonts(fonts) {
    if (!Array.isArray(fonts) || !fonts.length) return;
    let style = document.getElementById('sr-custom-fonts');
    if (!style) {
      style = document.createElement('style');
      style.id = 'sr-custom-fonts';
      document.head.appendChild(style);
    }
    const rules = fonts.map((f) => `@font-face { font-family: '${String(f.name).replace(/[^\w -]/g, '')}'; src: url(${f.dataUrl}) format('${f.format || 'truetype'}'); }`);
    style.textContent = rules.join('\n');
  }

  global.GraphicsEngine = { ordinal, resolveBindingText, applyBindings, injectFonts };
})(window);
