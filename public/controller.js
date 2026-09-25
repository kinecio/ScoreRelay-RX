(function () {
  const API = '/api';
  const list = document.getElementById('output-list');
  const btnNewOutput = document.getElementById('btn-new-output');

  let outputs = [];
  let designs = [];

  function designName(id) {
    const d = designs.find((x) => x.id === id);
    return d ? d.name : '(deleted design)';
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render() {
    list.innerHTML = '';
    if (!outputs.length) {
      list.appendChild(el('li', 'empty-hint', 'No outputs yet. Create one, then assign saved graphics to it below.'));
      return;
    }
    outputs.forEach((output) => {
      const li = el('li');
      const card = el('div', 'output-card');

      const head = el('div', 'head');
      const nameInput = el('input');
      nameInput.type = 'text';
      nameInput.value = output.name;
      nameInput.addEventListener('change', () => renameOutput(output.id, nameInput.value));
      head.appendChild(nameInput);
      const delBtn = el('button', 'danger', 'Delete output');
      delBtn.addEventListener('click', () => deleteOutput(output.id));
      head.appendChild(delBtn);
      card.appendChild(head);

      const resRow = el('div', 'graphic-row');
      resRow.appendChild(el('span', 'name', 'Resolution'));
      const widthInput = document.createElement('input');
      widthInput.type = 'number';
      widthInput.min = '16'; widthInput.max = '7680';
      widthInput.style.width = '90px';
      widthInput.value = output.width || 1920;
      const xSpan = el('span', null, '×');
      const heightInput = document.createElement('input');
      heightInput.type = 'number';
      heightInput.min = '16'; heightInput.max = '4320';
      heightInput.style.width = '90px';
      heightInput.value = output.height || 1080;
      const applyRes = () => resizeOutput(output.id, widthInput.value, heightInput.value);
      widthInput.addEventListener('change', applyRes);
      heightInput.addEventListener('change', applyRes);
      const preset169 = el('button', 'secondary', '1920×1080 (16:9)');
      preset169.addEventListener('click', () => resizeOutput(output.id, 1920, 1080));
      resRow.appendChild(widthInput);
      resRow.appendChild(xSpan);
      resRow.appendChild(heightInput);
      resRow.appendChild(preset169);
      card.appendChild(resRow);
      card.appendChild(el('p', 'hint', 'This is the reference size graphics are positioned in. The output page scales it to fit whatever pixel size you set the OBS/vMix browser source to, so nothing gets cropped.'));

      const url = location.origin + '/output/' + output.id;
      const urlRow = el('div', 'url', url);
      const copyBtn = el('button', 'secondary', 'Copy URL');
      copyBtn.style.marginLeft = '0.5rem';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(url).catch(() => {});
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 1200);
      });
      const urlWrap = el('div');
      urlWrap.appendChild(urlRow);
      urlWrap.appendChild(copyBtn);
      card.appendChild(urlWrap);

      const gList = el('div');
      gList.style.marginTop = '0.6rem';
      if (!output.graphics.length) {
        gList.appendChild(el('div', 'empty-hint', 'No graphics assigned.'));
      }
      output.graphics.forEach((g) => {
        const row = el('div', 'graphic-row');
        row.appendChild(el('span', 'name', designName(g.designId)));
        const toggle = el('button', 'toggle-btn' + (g.visible ? ' on' : ''), g.visible ? 'ON' : 'OFF');
        toggle.addEventListener('click', () => toggleGraphic(output.id, g.designId));
        row.appendChild(toggle);
        const remove = el('button', 'secondary', 'Remove');
        remove.addEventListener('click', () => unassign(output.id, g.designId));
        row.appendChild(remove);
        gList.appendChild(row);
      });
      card.appendChild(gList);

      const addRow = el('div');
      addRow.style.marginTop = '0.5rem';
      const select = document.createElement('select');
      const assignedIds = new Set(output.graphics.map((g) => g.designId));
      const available = designs.filter((d) => !assignedIds.has(d.id));
      if (!available.length) {
        select.disabled = true;
        select.appendChild(el('option', null, 'No more graphics to add'));
      } else {
        available.forEach((d) => {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = d.name + (d.sport ? ' (' + d.sport + ')' : '');
          select.appendChild(opt);
        });
      }
      addRow.appendChild(select);
      const addBtn = el('button', 'secondary', 'Add graphic');
      addBtn.style.marginLeft = '0.5rem';
      addBtn.disabled = !available.length;
      addBtn.addEventListener('click', () => assign(output.id, select.value));
      addRow.appendChild(addBtn);
      card.appendChild(addRow);

      li.appendChild(card);
      list.appendChild(li);
    });
  }

  function loadAll() {
    return Promise.all([
      fetch(API + '/outputs').then((r) => r.json()),
      fetch(API + '/designs').then((r) => r.json()),
    ]).then(([o, d]) => {
      outputs = o;
      designs = d;
      render();
    });
  }

  function createOutput() {
    const name = prompt('Output name (e.g. "OBS scorebug", "vMix sponsor bug"):', 'Output ' + (outputs.length + 1));
    if (name === null) return;
    fetch(API + '/outputs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(loadAll);
  }

  function renameOutput(id, name) {
    fetch(API + '/outputs/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(loadAll);
  }

  function resizeOutput(id, width, height) {
    fetch(API + '/outputs/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: Number(width), height: Number(height) }),
    }).then(loadAll);
  }

  function deleteOutput(id) {
    if (!confirm('Delete this output? Its URL will stop serving graphics.')) return;
    fetch(API + '/outputs/' + id, { method: 'DELETE' }).then(loadAll);
  }

  function assign(outputId, designId) {
    if (!designId) return;
    fetch(API + '/outputs/' + outputId + '/graphics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ designId }),
    }).then(loadAll);
  }

  function unassign(outputId, designId) {
    fetch(API + '/outputs/' + outputId + '/graphics/' + designId, { method: 'DELETE' }).then(loadAll);
  }

  function toggleGraphic(outputId, designId) {
    fetch(API + '/outputs/' + outputId + '/graphics/' + designId + '/toggle', { method: 'POST' }).then(loadAll);
  }

  btnNewOutput.addEventListener('click', createOutput);

  loadAll();
  setInterval(loadAll, 5000);
})();
