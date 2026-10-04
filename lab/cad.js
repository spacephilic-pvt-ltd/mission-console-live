/* LELP-1 CAD inspection. Original GLB geometry/materials are retained. A single WebGL
   context renders on demand; the public LelpCad interface is shared by the configurator. */
(function () {
  'use strict';
  const el = document.querySelector('.cad-view');
  if (!el) return;
  const fail = msg => { el.classList.add('cad-off'); const p = document.createElement('p'); p.className = 'small'; p.textContent = msg; el.appendChild(p); };
  if (!window.THREE || !THREE.GLTFLoader || !THREE.OrbitControls) return fail('3D preview unavailable. You can still inspect the drawings and download the CAD files below.');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' }); }
  catch (e) { return fail('This browser cannot display the 3D preview. The drawings and CAD downloads remain available below.'); }
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvasBox = document.createElement('div'); canvasBox.className = 'cad-canvas'; canvasBox.appendChild(renderer.domElement);
  const bar = document.createElement('div'); bar.className = 'cad-bar';
  el.append(canvasBox, bar);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Interactive CAD model. Arrow keys rotate, plus and minus zoom, zero resets the view.');
  renderer.domElement.setAttribute('aria-describedby', 'cad-help');
  const scene = new THREE.Scene(); scene.background = new THREE.Color();
  // Neutral studio reflections restore readable metals without changing the source CAD geometry or colours.
  const envCanvas = document.createElement('canvas'); envCanvas.width = 512; envCanvas.height = 256;
  const envContext = envCanvas.getContext('2d'), envGradient = envContext.createLinearGradient(0, 0, 0, 256);
  envGradient.addColorStop(0, '#dce7f2'); envGradient.addColorStop(.35, '#6a7889'); envGradient.addColorStop(.6, '#263445'); envGradient.addColorStop(1, '#8e9caa');
  envContext.fillStyle = envGradient; envContext.fillRect(0, 0, 512, 256);
  envContext.fillStyle = '#eef5fb'; envContext.fillRect(80, 35, 130, 60); envContext.fillRect(365, 45, 48, 105);
  const envTexture = new THREE.CanvasTexture(envCanvas); envTexture.encoding = THREE.sRGBEncoding;
  const pmrem = new THREE.PMREMGenerator(renderer), envTarget = pmrem.fromEquirectangular(envTexture);
  scene.environment = envTarget.texture; pmrem.dispose(); envTexture.dispose();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
  const controls = new THREE.OrbitControls(cam, renderer.domElement);
  controls.enableDamping = !motionQuery.matches; controls.dampingFactor = .12;
  controls.enablePan = true; controls.rotateSpeed = .65; controls.zoomSpeed = .7;
  scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x273443, .6));
  const key = new THREE.DirectionalLight(0xfff7ed, 1.65); key.position.set(4, 6, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc7e4f5, .65); fill.position.set(-5, 2, -4); scene.add(fill);
  const front = new THREE.DirectionalLight(0xffffff, .65); front.position.set(1, 2, -6); scene.add(front); // module fronts face -z
  const grid = new THREE.GridHelper(6, 12, 0xffffff, 0xffffff); scene.add(grid); // 0.5 m squares
  const fine = new THREE.GridHelper(1, 20, 0xffffff, 0xffffff); fine.visible = false; scene.add(fine); // 5 cm squares
  [grid, fine].forEach(o => { o.material.transparent = true; o.material.opacity = .7; });
  const loader = new THREE.GLTFLoader();
  const satViews = (n, hasEntry) => [{ name: n, label: n.endsWith('-detail') ? 'Cutaway' : 'In orbit', kind: n.endsWith('-detail') ? 'detail' : 'sat' }]
    .concat(hasEntry ? [{ name: `${n}-entry`, base: n, label: 'Entry', kind: 'entry' }] : []);
  function parsed() {
    try { const v = JSON.parse(el.dataset.views || 'null'); if (Array.isArray(v) && v.length) return v; } catch (e) { /* use name */ }
    return el.dataset.name ? satViews(el.dataset.name, el.dataset.entry !== '0') : [];
  }
  let views = parsed(), cur = 0, model = null, dirty = true, marked = [], hl = '', framedAt = 0;
  let loadId = 0, frameId = 0, contextLost = false, onscreen = true, gridOn = true, disposed = false;
  const markMat = new THREE.MeshStandardMaterial({ roughness: .5, metalness: .2 });
  const view = () => views[cur] || {};
  function applyTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const styles = getComputedStyle(el);
    const color = (token, lightFallback, darkFallback) => new THREE.Color(styles.getPropertyValue(token).trim() || (dark ? darkFallback : lightFallback));
    scene.background.copy(color('--ctp-base', '#eff1f5', '#1e1e2e'));
    const major = color('--ctp-overlay0', '#9ca0b0', '#6c7086');
    const minor = color('--ctp-surface1', '#bcc0cc', '#45475a');
    [grid, fine].forEach(o => {
      // GridHelper carries vertex colours; update those directly so old blue values
      // cannot tint the selected palette. Every two vertices form one grid line.
      const positions = o.geometry.attributes.position, colors = o.geometry.attributes.color;
      for (let i = 0; i < positions.count; i += 2) {
        const center = (Math.abs(positions.getX(i)) < 1e-6 && Math.abs(positions.getX(i + 1)) < 1e-6)
          || (Math.abs(positions.getZ(i)) < 1e-6 && Math.abs(positions.getZ(i + 1)) < 1e-6);
        const c = center ? major : minor;
        colors.setXYZ(i, c.r, c.g, c.b); colors.setXYZ(i + 1, c.r, c.g, c.b);
      }
      colors.needsUpdate = true; o.material.color.setHex(0xffffff); o.material.opacity = .8;
    });
    markMat.color.copy(color('--ctp-mauve', '#8839ef', '#cba6f7'));
    markMat.emissive.copy(markMat.color).multiplyScalar(.06);
    renderSoon();
  }
  window.addEventListener('workspace:theme', applyTheme);
  function finishMaterials(root) {
    // The exporter defaults all materials to plastic (metallic=.15, roughness=.6).
    // Restore optical classes for named engineering parts; these are presentation materials,
    // not measured surface properties. Original CAD colours/transparency remain authoritative.
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const ancestors = []; for (let o = mesh; o && o !== root; o = o.parent) ancestors.push(o.name || '');
      const name = ancestors.join(' ').toLowerCase();
      mesh.material = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(source => {
        const material = source.clone();
        if (!material.isMeshStandardMaterial || material.transparent) return material;
        if (/bay_[lm]|foil|mli/.test(name)) { material.metalness = .72; material.roughness = .4; }
        else if (/solar|cell|wing/.test(name)) { material.metalness = .42; material.roughness = .28; }
        else if (/ring|rail|bracket|core|dexter|arm|engine|nozzle|grapple|adapter|stage/.test(name)) { material.metalness = .58; material.roughness = .34; }
        material.envMapIntensity = .85;
        return material;
      });
      if (mesh.material.length === 1) mesh.material = mesh.material[0];
    });
  }
  function renderSoon() {
    dirty = true;
    if (!frameId && !disposed && !contextLost && onscreen && !document.hidden) frameId = requestAnimationFrame(draw);
  }
  function draw() {
    frameId = 0;
    if (disposed || contextLost || !onscreen || document.hidden) return;
    controls.update();
    if (dirty && canvasBox.clientWidth && canvasBox.clientHeight) { renderer.render(scene, cam); dirty = false; }
  }
  function disposeModel(obj) {
    if (!obj) return;
    const materials = new Set(), textures = new Set();
    obj.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      const ms = Array.isArray(c.material) ? c.material.slice() : [c.material];
      if (c.userData.mat0) ms.push(...(Array.isArray(c.userData.mat0) ? c.userData.mat0 : [c.userData.mat0]));
      ms.forEach(m => { if (m && m !== markMat) materials.add(m); });
    });
    materials.forEach(m => { Object.values(m).forEach(v => { if (v && v.isTexture) textures.add(v); }); m.dispose(); });
    textures.forEach(t => t.dispose());
  }
  function paint() {
    if (!model) return;
    model.traverse(c => {
      if (!c.isMesh) return;
      let on = false;
      for (let o = c; o && o !== scene; o = o.parent) {
        const n = o.name || '', m = /^bay_[LM]_(\d+)/.exec(n);
        if (m) { on = marked.includes(+m[1]); break; }
        if (hl && n.startsWith(hl)) { on = true; break; }
      }
      if (on) { if (!c.userData.mat0) c.userData.mat0 = c.material; c.material = markMat; }
      else if (c.userData.mat0) c.material = c.userData.mat0;
    });
    renderSoon();
  }
  function showGrid() {
    const mod = view().kind === 'module'; grid.visible = gridOn && !mod; fine.visible = gridOn && mod;
    const b = bar.querySelector('[data-v="grid"]'); if (b) b.setAttribute('aria-pressed', String(gridOn));
    const note = bar.querySelector('.cad-grid-note'); if (note) note.textContent = gridOn ? `Grid: ${mod ? '5 cm' : '0.5 m'}` : 'Grid hidden';
    renderSoon();
  }
  function frame(obj, preset = 'iso') {
    obj.position.set(0, 0, 0);
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (box.isEmpty()) return;
    obj.position.sub(center); obj.position.y += size.y / 2;
    const mod = view().kind === 'module', r = Math.max(size.x, size.y, size.z, .001), rs = Math.max(size.length() / 2, .001);
    const asp = cam.aspect > .2 ? cam.aspect : 1.6;
    const vfov = THREE.MathUtils.degToRad(cam.fov / 2), hfov = Math.atan(Math.tan(vfov) * asp);
    const dist = rs / Math.sin(Math.min(vfov, hfov)) * 1.07;
    framedAt = canvasBox.clientWidth;
    const dir = (preset === 'front' ? new THREE.Vector3(0, .04, -1) : preset === 'top' ? new THREE.Vector3(0, 1, -.001)
      : mod ? new THREE.Vector3(.52, .42, -.74) : new THREE.Vector3(.62, .32, .72)).normalize();
    cam.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, size.y / 2, 0)); controls.target.set(0, size.y / 2, 0);
    cam.near = Math.max(.0001, r / 1000); cam.far = r * 80;
    controls.minDistance = rs * .35; controls.maxDistance = dist * 5;
    cam.updateProjectionMatrix(); controls.update(); showGrid(); renderSoon();
  }
  const NOTE = { module: 'Payload module · front panel removed for inspection', sat: 'Orbit configuration · heat shield packed', entry: 'Entry configuration · heat shield inflated', detail: 'Cutaway · side panel removed for inspection' };
  function load() {
    const v = view(); if (!v.name) return;
    const token = ++loadId, status = bar.querySelector('.cad-status');
    status.textContent = 'Loading CAD model…'; el.setAttribute('aria-busy', 'true'); el.dataset.cadState = 'loading'; links();
    if (model) { scene.remove(model); disposeModel(model); model = null; renderSoon(); }
    loader.load(`cad/${encodeURIComponent(v.name)}.glb`, g => {
      if (token !== loadId || disposed) { disposeModel(g.scene); return; }
      model = g.scene; finishMaterials(model); scene.add(model); frame(model); paint();
      status.textContent = `${v.base || v.name} · ${v.note || NOTE[v.kind] || 'Engineering model'}`;
      el.setAttribute('aria-busy', 'false'); el.dataset.cadState = 'ready';
    }, undefined, () => {
      if (token !== loadId || disposed) return;
      status.textContent = `The ${v.name} preview could not load. Choose another view or use the CAD downloads.`;
      el.setAttribute('aria-busy', 'false'); el.dataset.cadState = 'error'; renderSoon();
    });
  }
  function links() {
    const v = view(), base = v.base || v.name, dl = bar.querySelector('.cad-dl'); dl.replaceChildren();
    [[`cad/${encodeURIComponent(base)}-step.zip`, 'STEP file', true], [`cad/${encodeURIComponent(v.name)}.glb`, '3D model', true], [`cad/${encodeURIComponent(base)}.json`, 'Parts & mass', false]].forEach(([href, text, download]) => {
      const a = document.createElement('a'); a.href = href; a.textContent = text;
      if (download) a.download = ''; else a.title = 'View parts and mass properties';
      dl.appendChild(a);
    });
  }
  function buttons() {
    bar.replaceChildren();
    const toolbar = document.createElement('div'); toolbar.className = 'cad-toolbar';
    const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Model configuration');
    views.forEach((v, i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i; b.textContent = v.label; b.classList.toggle('on', i === cur); b.setAttribute('aria-pressed', String(i === cur)); b.onclick = () => select(i); seg.appendChild(b); });
    const actions = document.createElement('div'); actions.className = 'seg cad-actions'; actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Camera controls');
    [['reset', '↺ Reset'], ['front', 'Front'], ['top', 'Top'], ['grid', 'Grid']].forEach(([id, text]) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.v = id; b.textContent = text;
      if (id === 'grid') b.setAttribute('aria-pressed', String(gridOn));
      b.onclick = () => { if (id === 'grid') { gridOn = !gridOn; showGrid(); } else if (model) frame(model, id === 'reset' ? 'iso' : id); };
      actions.appendChild(b);
    });
    toolbar.append(seg, actions);
    const status = document.createElement('span'); status.className = 'cad-status small'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const help = document.createElement('span'); help.id = 'cad-help'; help.className = 'small cad-help'; help.textContent = 'Drag to orbit · scroll to zoom · arrow keys to rotate';
    const note = document.createElement('span'); note.className = 'small cad-grid-note';
    const dl = document.createElement('span'); dl.className = 'cad-dl';
    bar.append(toolbar, status, help, note, dl); showGrid();
  }
  function select(i) {
    if (i < 0 || i >= views.length) return;
    cur = i; bar.querySelectorAll('button[data-i]').forEach(x => { const on = +x.dataset.i === cur; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); load();
  }
  function setViews(list, i = 0) { if (!Array.isArray(list) || !list.length) return; views = list; cur = Math.max(0, Math.min(i, list.length - 1)); buttons(); load(); }
  buttons();
  const pick = document.querySelector('.cad-pick');
  if (pick) pick.onchange = () => { const option = pick.selectedOptions[0]; if (!option) return;
    setViews(option.dataset.views ? JSON.parse(option.dataset.views) : satViews(pick.value, option.dataset.entry !== '0')); };
  document.addEventListener('click', ev => {
    const t = ev.target.closest && ev.target.closest('[data-cad]'); if (!t) return; ev.preventDefault();
    const i = views.findIndex(v => v.name === t.dataset.cad); if (i >= 0) select(i);
    el.scrollIntoView({ behavior: motionQuery.matches ? 'auto' : 'smooth', block: 'center' });
  });
  renderer.domElement.addEventListener('keydown', ev => {
    if (!model || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0'].includes(ev.key)) return;
    ev.preventDefault(); if (ev.key === '0') { frame(model); return; }
    const offset = cam.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(offset);
    if (ev.key === 'ArrowLeft') s.theta -= .12; if (ev.key === 'ArrowRight') s.theta += .12;
    if (ev.key === 'ArrowUp') s.phi -= .12; if (ev.key === 'ArrowDown') s.phi += .12;
    if (ev.key === '+' || ev.key === '=') s.radius *= .88; if (ev.key === '-') s.radius /= .88;
    s.radius = THREE.MathUtils.clamp(s.radius, controls.minDistance, controls.maxDistance); s.makeSafe();
    cam.position.copy(controls.target).add(offset.setFromSpherical(s)); controls.update(); renderSoon();
  });
  renderer.domElement.addEventListener('webglcontextlost', ev => { ev.preventDefault(); contextLost = true; bar.querySelector('.cad-status').textContent = '3D preview paused by the browser. CAD downloads are still available.'; });
  renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; load(); });
  window.LelpCad = {
    show(n, hasEntry = true) { setViews(satViews(n, hasEntry)); }, views(list, i = 0) { setViews(list, i); },
    select(n) { select(typeof n === 'number' ? n : views.findIndex(v => v.name === n)); },
    mark(bays) { marked = bays || []; paint(); }, highlight(prefix) { hl = prefix || ''; paint(); }, get name() { return view().name; },
    debug() { return { cam: cam.position.toArray().map(v => +v.toFixed(3)), target: controls.target.toArray(), model: !!model, aspect: +cam.aspect.toFixed(2), framedAt,
      view: view().name, pos: model ? model.position.toArray().map(v => +v.toFixed(3)) : null, state: el.dataset.cadState,
      lit: (() => { let n = 0; if (model) model.traverse(c => { if (c.isMesh && c.material === markMat) n++; }); return n; })() }; }
  };
  controls.addEventListener('change', renderSoon);
  function size() {
    const w = canvasBox.clientWidth, h = canvasBox.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    if (model && framedAt !== w) frame(model); renderSoon();
  }
  let resizeObserver, visibilityObserver;
  if (window.ResizeObserver) { resizeObserver = new ResizeObserver(size); resizeObserver.observe(canvasBox); } else window.addEventListener('resize', size);
  if (window.IntersectionObserver) { visibilityObserver = new IntersectionObserver(entries => { onscreen = entries[0].isIntersecting; if (onscreen) { size(); renderSoon(); } }); visibilityObserver.observe(el); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { size(); renderSoon(); } });
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', ev => { controls.enableDamping = !ev.matches; renderSoon(); });
  window.addEventListener('pagehide', ev => { if (ev.persisted) return; disposed = true; loadId++; if (frameId) cancelAnimationFrame(frameId);
    if (resizeObserver) resizeObserver.disconnect(); if (visibilityObserver) visibilityObserver.disconnect();
    disposeModel(model); markMat.dispose(); envTarget.dispose(); controls.dispose(); renderer.dispose();
    window.removeEventListener('workspace:theme', applyTheme);
  });
  applyTheme(); size(); if (views.length) load();
})();
