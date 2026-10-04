/* 3-D scene for the mission console (three.js r128, no post-processing).
   Two sub-scenes: LAUNCH (pad -> ascent -> separation -> booster barge landing) and OPS (LELP over a
   textured Earth: modules, arm reaching the module in transfer, solar wings, relays, return capsule).
   API used by app.js: new Scene3D(canvas); setPhase('launch'|'ops'); updateLaunch(latest, hasSep, dt);
   updateOps(frame, states, isolatedNodes, dt, ctx); setSolar(bool); setLandingZone(km).
   `latest` = { stack | upper, booster } telemetry samples; each may carry `att` (rad from the local vertical towards
   downrange) and the object may carry `sepAtt` (stack attitude at separation) and `sepAge` (s since MECO).
   Swap meshes for CAD glTF later; keep the node names (rocket.*, lelp.modules[i], lelp.arm, capsule). */
(function () {
  const BASE = window.SCENE_BASE || '';   // pages outside the site root (lab/simulate.html) set '../' so the models resolve
  const TEX = BASE + 'static/textures/';   // bundled Earth assets: no third-party request during playback
  const C = { gold: 0xb08a3e, goldActive: 0x3f9a5a, warn: 0xd09a2a, crit: 0xb03030, move: 0x2d7fe0,
              body: 0x23262b, trim: 0x474c55, cell: 0x14213d, flame: 0xffb060, flameCore: 0xfff3d0 };
  const lerp = (a, b, k) => a + (b - a) * k;
  const sstep = (k) => { k = Math.min(Math.max(k, 0), 1); return k * k * (3 - 2 * k); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  function solarTexture() {   // procedural solar-cell grid
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#0f1a33'; g.fillRect(0, 0, 256, 64); g.strokeStyle = '#3b4f7a'; g.lineWidth = 2;
    for (let x = 0; x <= 256; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
    for (let y = 0; y <= 64; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1); return t;
  }
  function mliTexture() {     // crinkled gold MLI
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#a78b4d'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) { g.strokeStyle = `rgba(${180 + Math.random() * 65},${145 + Math.random() * 65},${70 + Math.random() * 65},${0.16 + Math.random() * 0.35})`;
      g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const x = Math.random() * 256, y = Math.random() * 256; g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 40, y + (Math.random() - .5) * 40); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function reflectionEnvironment(renderer) {
    // Low-energy Earth bounce and a broad sunlight reflection let metal read as metal.
    // This is render lighting, not a solar or thermal model.
    const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
    const gradient = g.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#8592a2'); gradient.addColorStop(.3, '#253344'); gradient.addColorStop(.52, '#0b121e');
    gradient.addColorStop(.72, '#254666'); gradient.addColorStop(1, '#101b2c');
    g.fillStyle = gradient; g.fillRect(0, 0, 512, 256);
    const source = g.createRadialGradient(350, 65, 0, 350, 65, 75);
    source.addColorStop(0, '#fff7df'); source.addColorStop(.15, '#d8dee4'); source.addColorStop(1, 'rgba(140,160,185,0)');
    g.fillStyle = source; g.fillRect(0, 0, 512, 256);
    const texture = new THREE.CanvasTexture(c); texture.encoding = THREE.sRGBEncoding;
    const pmrem = new THREE.PMREMGenerator(renderer), target = pmrem.fromEquirectangular(texture);
    texture.dispose(); pmrem.dispose(); return target;
  }
  function stars(n, r) {
    const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), colors = new Float32Array(n * 3);
    let seed = 87231; const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < n; i++) {
      const u = random() * 2 - 1, th = random() * Math.PI * 2, s = Math.sqrt(1 - u * u), intensity = .3 + Math.pow(random(), 3) * .7;
      p.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      colors.set([intensity * .91, intensity * .96, intensity], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ vertexColors: true, size: 1, sizeAttenuation: false, transparent: true, opacity: .38, depthWrite: false, fog: false }));
  }
  function daylightSky() {
    // An illustrative daylight-scattering backdrop. Altitude comes from telemetry; this is not a weather model.
    const material = new THREE.ShaderMaterial({
      uniforms: { up: { value: V(0, 1, 0) }, sunDirection: { value: V(0, 1, 0) }, density: { value: 1 } },
      vertexShader: `varying vec3 vDirection;
        void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 up; uniform vec3 sunDirection; uniform float density; varying vec3 vDirection;
        void main() {
          vec3 direction = normalize(vDirection);
          float elevation = max(0.0, dot(direction, up));
          float horizon = pow(1.0 - elevation, 4.0);
          float sunward = pow(max(0.0, dot(direction, sunDirection)), 9.0);
          vec3 zenith = vec3(.045, .205, .43), haze = vec3(.60, .74, .82);
          vec3 color = mix(zenith, haze, pow(1.0 - elevation, .68));
          color += vec3(.17, .135, .07) * sunward * (.22 + horizon * .5);
          color = mix(vec3(.003, .006, .013), color, density);
          gl_FragColor = vec4(color, density);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90000, 32, 16), material); sky.renderOrder = -100;
    sky.frustumCulled = false; return sky;
  }
  function flame(r, len, color) {
    const grp = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.ConeGeometry(r, len, 20, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .62, side: THREE.DoubleSide, depthWrite: false }));   // normal blending: stays orange against a daylight sky
    const core = new THREE.Mesh(new THREE.ConeGeometry(r * .5, len * .7, 16, 1, true), new THREE.MeshBasicMaterial({ color: C.flameCore, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
    [outer, core].forEach(m => { m.rotation.x = Math.PI; m.position.y = -len / 2 * (m === core ? .7 : 1); grp.add(m); });
    grp.userData = { outer, core, len };
    return grp;
  }
  function exhaust(count) {   // particle puff cloud (sprites)
    const g = new THREE.BufferGeometry(), p = new Float32Array(count * 3); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc896, size: 3.5, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.userData = { life: new Float32Array(count), vel: new Float32Array(count * 3), i: 0 }; pts.frustumCulled = false; return pts;
  }

  function puffTexture() {    // soft round puff for exhaust clouds
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 1, 32, 32, 31);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.45, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  function terrainTexture() { // subtle material grain, not geographic imagery
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d'), pixels = g.createImageData(128, 128); let seed = 319;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (1664525 * seed + 1013904223) >>> 0; const value = 180 + (seed >>> 27);
      pixels.data[i] = value; pixels.data[i + 1] = value; pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
    }
    g.putImageData(pixels, 0, 0); const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(6, 6); return texture;
  }
  function cloudPool(n) {     // billowing exhaust and steam at the pad: soft sprites that spread, grow, rise and fade
    const grp = new THREE.Group(), tex = puffTexture(); grp.userData = { p: [], i: 0, acc: 0 };
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xe9e6e1, transparent: true, opacity: 0, depthWrite: false }));
      sp.visible = false; grp.add(sp); grp.userData.p.push({ sp, life: 0, max: 1, v: new THREE.Vector3(), up: new THREE.Vector3(), s0: .1, s1: 1, live: false });
    }
    return grp;
  }

  // Inflatable heat shield (HIAD) in metres (sentinel/lelp/reentry.py): 70 deg sphere-cone, nose at y = 0 facing -y,
  // rigid 1.1 m centerbody (the lab sits on it at y = 0.15), flexible TPS skin over stacked tori, radial straps.
  function buildHIAD(skinMat, toriMat, rigidMat, D = 2.6, nTori = 4) {
    const g = new THREE.Group(), R = D / 2, rc = 0.55, t20 = Math.tan(THREE.MathUtils.degToRad(20)), tube = (R - rc) / (2 * nTori);
    const yAt = (r) => 0.12 + (r - rc) * t20;
    const nose = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.25, 0.02), new THREE.Vector2(0.45, 0.07), new THREE.Vector2(rc, 0.12)];
    g.add(new THREE.Mesh(new THREE.LatheGeometry(nose, 48), rigidMat));
    const flex = [];
    for (let k = 0; k <= 16; k++) { const r = rc + (R - rc) * k / 16; flex.push(new THREE.Vector2(r, yAt(r))); }
    flex.push(new THREE.Vector2(R + 0.03, yAt(R) + 0.07), new THREE.Vector2(R - 0.06, yAt(R) + 0.2));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(flex, 72), skinMat));
    for (let i = 0; i < nTori; i++) {
      const Ri = rc + tube + i * 2 * tube, t = new THREE.Mesh(new THREE.TorusGeometry(Ri, tube * 0.98, 12, 72), toriMat);
      t.rotation.x = Math.PI / 2; t.position.y = yAt(Ri) + tube * 0.95; g.add(t);
    }
    const pts = [];
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      pts.push(new THREE.Vector3(c * rc, yAt(rc) + 2 * tube, sn * rc), new THREE.Vector3(c * (R - tube), yAt(R) + 2 * tube, sn * (R - tube))); }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x6b5a3a })));
    g.userData = { R, shoulderY: yAt(R) };
    return g;
  }

  class Scene3D {
    constructor(canvas) {
      this.canvas = canvas;
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.motionQuery.matches;
      this._motionChange = e => { this.reducedMotion = e.matches; };
      if (this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', this._motionChange);
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.outputEncoding = THREE.sRGBEncoding; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1;
      this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x080f1b);
      this.environmentTarget = reflectionEnvironment(this.renderer); this.scene.environment = this.environmentTarget.texture;
      this.groundFog = new THREE.Fog(0x9baeba, 1.8, 42);
      this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 2.0e6);
      this.camPos = V(0, 30, 120); this.camTarget = V(0, 20, 0);
      this.sun = new THREE.DirectionalLight(0xfff5e5, 1.6); this.sun.position.set(30000, 22000, 18000); this.scene.add(this.sun);
      this.sunDirection = this.sun.position.clone().normalize(); this.scene.add(this.sun.target);
      this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.camera.near = .1; this.sun.shadow.camera.far = 25;
      Object.assign(this.sun.shadow.camera, { left: -1.3, right: 1.3, top: 1.3, bottom: -1.3 });
      this.sun.shadow.normalBias = .001; this.sun.shadow.bias = -.00002;
      this.skyFill = new THREE.HemisphereLight(0xc8d6e3, 0x143755, .32); this.scene.add(this.skyFill);
      this.rim = new THREE.DirectionalLight(0xbbd9ef, .65); this.rim.position.set(-24000, 12000, -18000); this.scene.add(this.rim); this.scene.add(this.rim.target);
      this.stars = stars(1350, 6.0e5); this.scene.add(this.stars);
      this.daySky = daylightSky(); this.scene.add(this.daySky);
      this.loader = new THREE.TextureLoader(); this.loader.setCrossOrigin('anonymous');
      this._textures = new Map();
      this.t = 0; this.phase = null;
      this._buildLaunch(); this._buildReturn(); this._buildOps();
      this.setPhase('launch');
      this._resize(); this._onResize = () => this._resize(); addEventListener('resize', this._onResize);
      if (window.ResizeObserver) { this._resizeObserver = new ResizeObserver(this._onResize); this._resizeObserver.observe(canvas); }
    }
    _resize() { const w = this.canvas.clientWidth, h = this.canvas.clientHeight; if (w < 1 || h < 1) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    _std(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .46, metalness: .35, envMapIntensity: .85 }, o)); }
    _tex(name, onload, color = true) {
      // Share textures between launch and orbit; scalar maps must stay in linear colour space.
      if (!this._textures.has(name)) this._textures.set(name, new Promise(resolve => {
        this.loader.load(TEX + name, t => { t.encoding = color ? THREE.sRGBEncoding : THREE.LinearEncoding;
          t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy()); resolve(t);
        }, undefined, () => { this.canvas.dataset.textureStatus = 'unavailable'; resolve(null); });
      }));
      this._textures.get(name).then(t => { if (t) onload(t); });
    }
    _earthMaterial() {
      const material = new THREE.MeshPhongMaterial({ color: 0x234b6d, shininess: 56, specular: 0x101d2b });
      this._tex('earth-blue-marble.jpg', t => { material.map = t; material.color.set(0xffffff); material.needsUpdate = true; });
      this._tex('earth_specular_2048.jpg', t => { material.specularMap = t; material.needsUpdate = true; }, false);
      this._tex('earth_normal_2048.jpg', t => { material.normalMap = t; material.normalScale.set(.28, .28); material.needsUpdate = true; }, false);
      return material;
    }
    _cloudLayer(earth, radius) {
      const material = new THREE.MeshPhongMaterial({ color: 0xf1f4f8, transparent: true, opacity: .48, depthWrite: false, shininess: 1 });
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.0018, 96, 64), material);
      clouds.visible = false; earth.add(clouds);
      this._tex('earth_clouds_1024.png', t => { material.map = t; material.needsUpdate = true; clouds.visible = true; });
      return clouds;
    }
    _atmosphere(radius, thickness) {
      // A visual limb-scattering approximation; this does not alter the twin's atmosphere or trajectories.
      return new THREE.Mesh(new THREE.SphereGeometry(radius + thickness, 96, 64), new THREE.ShaderMaterial({
        uniforms: { tint: { value: new THREE.Color(0x7bb9e2) }, sunDirection: { value: this.sunDirection } },
        vertexShader: `#include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vNormal; varying vec3 vPosition;
          void main() { vec4 p = modelMatrix * vec4(position, 1.0); vPosition = p.xyz;
            vNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * p;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `#include <logdepthbuf_pars_fragment>
          uniform vec3 tint; uniform vec3 sunDirection; varying vec3 vNormal; varying vec3 vPosition;
          void main() {
            #include <logdepthbuf_fragment>
            vec3 n = normalize(vNormal); vec3 eye = normalize(cameraPosition - vPosition);
            float limb = pow(1.0 - abs(dot(n, eye)), 4.8);
            float day = smoothstep(-0.3, 0.6, dot(n, sunDirection));
            gl_FragColor = vec4(tint, limb * (0.025 + 0.31 * day)); }`,
        transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
      }));
    }

    // ================= LAUNCH: true scale, 1 unit = 1 km =================
    // Earth is a 6 371 km sphere at the origin (y = north pole). The pad is at APJ Abdul Kalam Island
    // (20.758 N, 87.085 E); the twin's downrange distance is laid along the easterly great circle, altitude
    // along the local vertical. Vehicles, pad and barge are drawn 40x larger than life so a 20 m rocket is
    // visible in a chase shot; at 1 000 km altitude a 0.6 km tower is sub-pixel, as it should be.
    _geo() {
      const R = 6371.0, lat = THREE.MathUtils.degToRad(20.758), lon = THREE.MathUtils.degToRad(87.085);
      const up = V(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));     // matches SphereGeometry uv mapping
      const east = V(-Math.sin(lon), 0, -Math.cos(lon));
      const north = new THREE.Vector3().crossVectors(up, east).negate();
      // launch azimuth 192 deg (RUPAK: dawn-dusk SSO, south-south-west over the Bay of Bengal)
      const az = THREE.MathUtils.degToRad(192), dir = north.clone().multiplyScalar(Math.cos(az)).add(east.clone().multiplyScalar(Math.sin(az))).normalize();
      return { R, up, east: dir, north };
    }
    _place(downrangeKm, altKm) {
      const { R, up, east } = this._geo(), ang = downrangeKm / R;
      const u = up.clone().multiplyScalar(Math.cos(ang)).add(east.clone().multiplyScalar(Math.sin(ang)));   // local up
      const f = up.clone().multiplyScalar(-Math.sin(ang)).add(east.clone().multiplyScalar(Math.cos(ang)));  // local forward (downrange)
      return { pos: u.clone().multiplyScalar(R + altKm), up: u, fwd: f, side: new THREE.Vector3().crossVectors(u, f).normalize() };
    }
    _orient(obj, up, fwd, tiltRad) {
      const b = up.clone().multiplyScalar(Math.cos(tiltRad)).add(fwd.clone().multiplyScalar(Math.sin(tiltRad))).normalize();
      obj.quaternion.setFromUnitVectors(V(0, 1, 0), b);
    }
    _buildLaunch() {
      const g = this.launch = new THREE.Group(); this.scene.add(g);
      const R = this.earthR = 6371.0;
      const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 192, 128), this._earthMaterial());
      g.add(earth); this.lEarth = earth;
      this._cloudLayer(earth, R);
      const atmo = this._atmosphere(R, 48);
      g.add(atmo);
      const VS = 0.04;   // scene km per real metre with the 40x exaggeration
      // pad + tower (40x): tower 15 m -> 0.6 km
      this.pad = new THREE.Group(); g.add(this.pad);
      const padMesh = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, .8, 32), this._std(0x3a3d42, { roughness: .9 })); padMesh.position.y = .4; this.pad.add(padMesh);
      const contact = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: puffTexture(), color: 0x03090c, transparent: true, opacity: .55, depthWrite: false }));
      contact.rotation.x = -Math.PI / 2; contact.position.y = .82; this.pad.add(contact); this.padContact = contact;
      const towerSteel = this._std(0xa1aeb4, { roughness: .52, metalness: .62 });
      const brace = (a, b, radius = .15) => { const delta = b.clone().sub(a), strut = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), towerSteel); strut.position.copy(a).add(b).multiplyScalar(.5); strut.quaternion.setFromUnitVectors(V(0, 1, 0), delta.normalize()); strut.castShadow = true; this.pad.add(strut); };
      for (const x of [-8.2, -5.8]) for (const z of [-1.2, 1.2]) brace(V(x, 0, z), V(x, 46, z), .22);
      for (let y = 0; y < 45; y += 7.5) for (const z of [-1.2, 1.2]) { brace(V(-8.2, y, z), V(-5.8, y + 7.5, z)); brace(V(-5.8, y, z), V(-8.2, y + 7.5, z)); }
      for (let y = 7.5; y <= 45; y += 7.5) { const platform = new THREE.Mesh(new THREE.BoxGeometry(3.1, .23, 3.1), towerSteel); platform.position.set(-7, y, 0); this.pad.add(platform); }
      for (let i = 1; i < 6; i++) { const arm = new THREE.Mesh(new THREE.BoxGeometry(5, .5, .8), this._std(0x8a8f98)); arm.position.set(-4.5, i * 7.5, 0); this.pad.add(arm); }
      this.pad.scale.setScalar(VS / 3.0);
      // barge (40x)
      this.barge = new THREE.Group(); g.add(this.barge);
      // droneship: 30 x 18 m deck (3 units per metre), sized like a Falcon droneship for RUPAK's 8.25 m leg span
      const deck = new THREE.Mesh(new THREE.BoxGeometry(90, 4, 54), this._std(0x2c3340, { roughness: .8 })); deck.position.y = 2; this.barge.add(deck);
      const mark = new THREE.Mesh(new THREE.RingGeometry(13.4, 15, 64), new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide })); mark.rotation.x = -Math.PI / 2; mark.position.y = 4.06; this.barge.add(mark);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide })); dot.rotation.x = -Math.PI / 2; dot.position.y = 4.06; this.barge.add(dot);
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => { const pod = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 7), this._std(0x4a5260, { roughness: .7 })); pod.position.set(sx * 40, 6.5, sz * 22); this.barge.add(pod); });
      const sea2 = new THREE.Mesh(new THREE.CircleGeometry(90 / (VS / 3.0), 64), this._std(0x173a55, { roughness: .35, metalness: .15 })); sea2.rotation.x = -Math.PI / 2; sea2.position.y = .6; this.barge.add(sea2);   // 90 km of open water
      this.barge.scale.setScalar(VS / 3.0); this.deckTop = 4.06;
      // vehicle (procedural fallback, replaced by the CAD); built at 3 units per metre, scaled to VS
      const skin = this._std(0xe6e6e0, { roughness: .45, metalness: .25 });
      this.booster = new THREE.Group(); g.add(this.booster);
      const bBody = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 42, 32), skin); bBody.position.y = 21; this.booster.add(bBody);
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 3, 32), this._std(0x2a2a2a)); skirt.position.y = 1.5; this.booster.add(skirt);
      this.engines = new THREE.Group(); this.booster.add(this.engines);
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, r = i ? 1.4 : 0; const e = new THREE.Mesh(new THREE.ConeGeometry(.5, 1.6, 16, 1, true), this._std(0x555a63, { side: THREE.DoubleSide, metalness: .8 })); e.position.set(Math.cos(a) * r, -.6, Math.sin(a) * r); e.rotation.x = Math.PI; this.engines.add(e); }
      this.bFlame = flame(2.0, 26, C.flame); this.bFlame.position.y = -1; this.booster.add(this.bFlame);
      this.legs = []; this.fins = [];
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4;
        const pivot = new THREE.Group(); pivot.position.set(Math.cos(a) * 2.2, 4, Math.sin(a) * 2.2); pivot.rotation.y = -a; this.booster.add(pivot);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(.5, 12, 1.1), this._std(0x1f2226)); leg.position.set(0, -6, 0); pivot.add(leg); this.legs.push(pivot);
        const fp = new THREE.Group(); fp.position.set(Math.cos(a) * 2.2, 40, Math.sin(a) * 2.2); fp.rotation.y = -a; this.booster.add(fp);
        const fin = new THREE.Mesh(new THREE.BoxGeometry(2.6, .25, 2.0), this._std(0x3a3a3a, { metalness: .6 })); fin.position.x = 1.3; fp.add(fin); fp.rotation.z = Math.PI / 2; this.fins.push(fp);
      }
      this.upper = new THREE.Group(); g.add(this.upper);
      const uBody = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 12, 32), skin); uBody.position.y = 6; this.upper.add(uBody);
      const fairing = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 32), skin); fairing.position.y = 16.5; this.upper.add(fairing);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), skin); nose.position.y = 21; this.upper.add(nose);
      const vacEngine = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.2, 24, 1, true), this._std(0x555a63, { side: THREE.DoubleSide, metalness: .8 })); vacEngine.position.y = -2.4; vacEngine.rotation.x = Math.PI; this.upper.add(vacEngine);
      this.uFlame = flame(1.3, 16, 0xa0c8ff); this.uFlame.position.y = -3; this.upper.add(this.uFlame);
      this.vehScale = VS / 3.0; this.booster.scale.setScalar(this.vehScale); this.upper.scale.setScalar(this.vehScale);
      this.stackH = 42 * this.vehScale;    // booster height in km (procedural); CAD overrides
      this.plume = exhaust(300); g.add(this.plume);
      this.cloud = cloudPool(110); g.add(this.cloud);
      // engine light on the pad, the vehicle and the cloud (km; the vehicle groups are scaled, the light range is not)
      this.bLight = new THREE.PointLight(0xffa24a, 0, 4, 2); this.bLight.position.y = -3; this.booster.add(this.bLight);
      this.uLight = new THREE.PointLight(0xa8c8ff, 0, 3, 2); this.uLight.position.y = -4; this.upper.add(this.uLight);
      this.plume.material.size = 0.05; this.plume.material.sizeAttenuation = true; this.plume.material.opacity = .45;
      this.sepT = null;
      // Near-field coastline is illustrative; NASA's global texture remains the georeferenced surface at altitude.
      const site = this._place(0, 0); this.pad.position.copy(site.pos); this._orient(this.pad, site.up, site.fwd, 0);
      this._buildCoastalSite(site);
      this.pad.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); this.padContact.castShadow = false;
      this._loadCad();
    }
    _buildCoastalSite(site) {
      const ground = this.launchGround = new THREE.Group(); ground.name = 'Illustrative coastal launch setting'; this.launch.add(ground);
      ground.position.copy(site.pos); ground.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(site.side, site.up, site.fwd));
      const soil = terrainTexture(), sand = this._std(0xa69a78, { map: soil, roughness: 1, metalness: 0 });
      const vegetation = this._std(0x405e48, { map: soil, roughness: 1, metalness: 0 });
      const asphalt = this._std(0x3b4d52, { roughness: .95, metalness: 0 }), concrete = this._std(0x8c9897, { roughness: .94, metalness: 0 });
      if (window.RecoveryVisuals) {
        this.launchOcean = window.RecoveryVisuals.buildOcean(THREE); ground.add(this.launchOcean);
        this._launchOceanOptions = { waveScale: .36, speed: .08 };
        this.launchOcean.position.y = -.006;
      } else {
        const water = new THREE.Mesh(new THREE.CircleGeometry(90, 96), new THREE.MeshPhongMaterial({ color: 0x285769, shininess: 65, specular: 0x738d94 }));
        water.rotation.x = -Math.PI / 2; water.position.y = -.006; ground.add(water);
      }
      const surface = (shape, material, y) => {
        const geometry = new THREE.ShapeGeometry(shape, 48); geometry.rotateX(-Math.PI / 2);
        const p = geometry.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, y - (p.getX(i) ** 2 + p.getZ(i) ** 2) / (2 * this.earthR));
        geometry.computeVertexNormals(); const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = true; ground.add(mesh); return mesh;
      };
      // Soft shore profiles remove the rectangular land tiles; no survey accuracy is implied.
      const mainland = new THREE.Shape(); mainland.moveTo(-28, -45); mainland.lineTo(-28, 45); mainland.lineTo(-5.8, 45);
      mainland.bezierCurveTo(-8, 22, -2.6, 8, -3.8, 0); mainland.bezierCurveTo(-5.1, -14, -1.9, -24, -4.8, -45); mainland.closePath();
      surface(mainland, vegetation, -.01);
      const islandShape = new THREE.Shape(); islandShape.moveTo(-.50, -1.95);
      islandShape.bezierCurveTo(-.84, -.8, -.76, .7, -.32, 1.95); islandShape.bezierCurveTo(.15, 2.1, .44, 1.3, .57, .25);
      islandShape.bezierCurveTo(.65, -.9, .24, -1.82, -.50, -1.95); islandShape.closePath();
      surface(islandShape, sand, .003);
      const interior = surface(islandShape, vegetation, .005); interior.scale.set(.83, 1, .96);
      const patch = (w, d, x, z, material, y = .009) => { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); mesh.receiveShadow = true; ground.add(mesh); return mesh; };
      patch(.36, .45, -.025, .035, concrete); patch(.065, 2.4, -.20, -.94, asphalt);
      patch(.48, .038, -.02, -.18, asphalt); patch(.32, .2, -.27, -.53, concrete);
      const paint = new THREE.MeshBasicMaterial({ color: 0xdedeca });
      for (let i = 0; i < 17; i++) patch(.004, .041, -.2, .19 - i * .125, paint, .01);
      const perimeter = new THREE.Mesh(new THREE.RingGeometry(.177, .18, 96), paint); perimeter.rotation.x = -Math.PI / 2; perimeter.position.y = .0095; ground.add(perimeter);
      // Low service structures provide scale. These are site dressing, not an engineering layout.
      for (const [x, z, w, d, h] of [[-.32, -.53, .13, .09, .025], [-.40, -.8, .08, .12, .016], [-.32, -1.12, .10, .08, .02]]) {
        const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), concrete); building.position.set(x, .008 + h / 2, z); building.castShadow = true; building.receiveShadow = true; ground.add(building);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, .002, d * 1.04), this._std(0x8c9da3, { roughness: .7, metalness: .25 })); roof.position.copy(building.position); roof.position.y += h / 2; ground.add(roof);
      }
      for (const x of [-.38, -.29]) { const tank = new THREE.Mesh(new THREE.CylinderGeometry(.024, .024, .048, 20), this._std(0xd5d9d7, { roughness: .42, metalness: .36 })); tank.position.set(x, .032, -1.43); tank.castShadow = true; ground.add(tank); }
    }
    _brandRocket(root, bounds) {
      if (root.userData.brandRequested) return; root.userData.brandRequested = true;
      const image = new Image();
      image.onload = () => {
        // Preserve the supplied artwork, remove its black surround, and print it in a quiet navy ink.
        // Composition happens once at bounded resolution, never in the animation loop.
        const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = Math.max(1, Math.round(1024 * image.height / image.width));
        const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height); let x0 = canvas.width, y0 = canvas.height, x1 = 0, y1 = 0;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4, alpha = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
          pixels.data[i] = 30; pixels.data[i + 1] = 53; pixels.data[i + 2] = 71; pixels.data[i + 3] = alpha;
          if (alpha > 50) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
        if (x1 <= x0 || y1 <= y0) return; context.putImageData(pixels, 0, 0);
        const crop = document.createElement('canvas'); crop.width = x1 - x0 + 1; crop.height = y1 - y0 + 1;
        crop.getContext('2d').drawImage(canvas, x0, y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
        const texture = new THREE.CanvasTexture(crop); texture.encoding = THREE.sRGBEncoding; texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
        const height = bounds.max.y - bounds.min.y, centerY = bounds.min.y + height * .62;
        let radius = 0; root.traverse(o => { if (o.isMesh) { const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - centerY) < height * .08) radius = Math.max(radius, Math.hypot(p.getX(i), p.getZ(i))); } });
        if (!(radius > 0)) { texture.dispose(); return; }
        const arc = 1.95, decalHeight = Math.min(height * .13, radius * arc * crop.height / crop.width);
        const material = this._std(0xffffff, { map: texture, transparent: true, alphaTest: .04, depthWrite: false, roughness: .77, metalness: .03, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        for (let i = 0; i < 3; i++) {
          const decal = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.003, radius * 1.003, decalHeight, 32, 1, true, i * Math.PI * 2 / 3 - arc / 2, arc), material);
          decal.position.y = centerY; decal.name = 'SPACE PHILIC supplied artwork'; decal.renderOrder = 2; root.add(decal);
        }
      };
      image.onerror = () => { this.canvas.dataset.brandStatus = 'unavailable'; };
      image.src = BASE + 'static/brand/space-philic-logo.png';
    }
    // ================= RETURN: capsule entry, parachutes and splashdown, true scale (1 unit = 1 km) =================
    // Same Earth and the same 40x vehicle exaggeration as the launch; positions come from the twin's capsule model
    // (sentinel/lelp/reentry.py). The 9 m main opens at the model's 4 km event; no fictional drogue.
    _buildReturn() {
      const r = this.ret = new THREE.Group(); r.visible = false; this.launch.add(r);
      const cap = this.rcap = new THREE.Group(); r.add(cap);                 // the Return Module in metres; local +y = aft
      const mliMat = this._std(0xffffff, { map: mliTexture(), roughness: .4, metalness: .75 }), shell = this._std(0xd6d9dd, { roughness: .5, metalness: .35 });
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.4, 8), mliMat); stack.position.y = 0.85; cap.add(stack);       // 32 modules
      const labDome = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.55, 0.35, 8), shell); labDome.position.y = 1.725; cap.add(labDome); // central chamber
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.14, 24), this._std(0x2b2e33, { roughness: .6 })); can.position.y = 1.97; cap.add(can);   // parachute canister
      this.rHiad = buildHIAD(this._std(0xb6ab98, { roughness: .85, metalness: .05, side: THREE.DoubleSide }), this._std(0xd9b46a, { roughness: .7, metalness: .1 }),
                             this._std(0x3b2a20, { roughness: .9, metalness: .05 })); cap.add(this.rHiad);
      const glow = (color, op) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending });
      this.rPlasma = new THREE.Mesh(new THREE.SphereGeometry(1.6, 32, 16), glow(0xff5a12, 0)); this.rPlasma.position.y = -0.15; this.rPlasma.scale.set(1, .32, 1); cap.add(this.rPlasma);
      this.rWake = new THREE.Mesh(new THREE.ConeGeometry(1.3, 11, 32, 1, true), glow(0xff6a20, 0)); this.rWake.position.y = 6.2; cap.add(this.rWake);
      this.rBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); this.rBeacon.position.y = 2.08; cap.add(this.rBeacon);   // recovery strobe
      // main canopy: origin at the canister, risers to the rim, canopy downwind (+y)
      const gores = (a, b) => { const c = document.createElement('canvas'); c.width = 256; c.height = 8; const g = c.getContext('2d');
        for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 16, 0, 16, 8); } return new THREE.CanvasTexture(c); };
      const chute = (radius, riser, a, b, y0) => {
        if (window.RecoveryVisuals) { const grp = RecoveryVisuals.buildCanopy(THREE, radius, riser, a, b, y0); cap.add(grp); return grp; }
        const grp = new THREE.Group(); grp.position.y = y0;
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
          new THREE.MeshStandardMaterial({ map: gores(a, b), roughness: .9, metalness: 0, side: THREE.DoubleSide }));
        canopy.position.y = riser - radius * Math.cos(Math.PI * 0.42); grp.add(canopy);
        const rim = radius * Math.sin(Math.PI * 0.42), pts = [];
        for (let i = 0; i < 16; i++) { const q = i / 16 * Math.PI * 2; pts.push(V(0, 0, 0), V(Math.cos(q) * rim, riser, Math.sin(q) * rim)); }
        const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xdedede, transparent: true, opacity: .8 })); grp.add(lines);
        grp.userData = { canopy, lines }; grp.visible = false; cap.add(grp); return grp;
      };
      this.rMain = chute(4.5, 14, '#ff7a1a', '#f4f4f4', 2.04);              // 9 m ringsail on a 14 m riser
      cap.scale.setScalar(0.04);                                             // 40x, like the booster
      // Use the existing generated entry CAD when available. Keep the lightweight silhouette only
      // as a loading/failure fallback; all recovery positions still come from the same mission model.
      const fallback = [stack, labDome, can, this.rHiad];
      this._loadReturnCad = () => {
        if (!THREE.GLTFLoader || this._returnCadRequested) return;
        this._returnCadRequested = true;
        new THREE.GLTFLoader().load(BASE + 'lab/cad/LELP-1-entry.glb', gltf => {
          const root = gltf.scene, box = new THREE.Box3().setFromObject(root);
          root.position.y -= box.min.y;
          root.traverse(mesh => {
            if (!mesh.isMesh) return;
            const names = []; for (let n = mesh; n && n !== root; n = n.parent) names.push(n.name || '');
            const name = names.join(' ').toLowerCase();
            const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const materials = source.map(m => { const mat = m.clone();
              if (mat.isMeshStandardMaterial) {
                if (/bay_[lm]/.test(name)) { mat.map = mliMat.map; mat.metalness = .64; mat.roughness = .4; }
                else if (/torus|tps|nose/.test(name)) { mat.metalness = .08; mat.roughness = .8; }
                else { mat.metalness = .45; mat.roughness = .36; }
                mat.envMapIntensity = .8;
              } return mat; });
            mesh.material = materials.length === 1 ? materials[0] : materials;
          });
          cap.add(root); fallback.forEach(o => o.visible = false);
          this.canvas.dataset.returnModel = 'cad';
        }, undefined, () => { this.canvas.dataset.returnModel = 'fallback'; });
      };
      // splash zone: open sea, a foam ring at splashdown, the recovery ship (built in metres, bow along +x)
      this.retSea = new THREE.Group(); r.add(this.retSea);
      if (window.RecoveryVisuals) { this.returnOcean = RecoveryVisuals.buildOcean(THREE); this.retSea.add(this.returnOcean); }
      else { const sea = new THREE.Mesh(new THREE.CircleGeometry(120, 96), this._std(0x173a55, { roughness: .35, metalness: .15 })); sea.rotation.x = -Math.PI / 2; this.retSea.add(sea); }
      const skyCanvas = document.createElement('canvas'); skyCanvas.width = 512; skyCanvas.height = 256;
      const skyContext = skyCanvas.getContext('2d'), gradient = skyContext.createLinearGradient(0, 0, 0, 256);
      [[0,'#438ac1'],[.38,'#87bedf'],[.5,'#d2e5ed'],[.54,'#8ab3c5'],[1,'#346c90']].forEach(([p,c])=>gradient.addColorStop(p,c));
      skyContext.fillStyle = gradient; skyContext.fillRect(0,0,512,256);
      const skyTexture = new THREE.CanvasTexture(skyCanvas); skyTexture.encoding = THREE.sRGBEncoding;
      this.returnSky = new THREE.Mesh(new THREE.SphereGeometry(200,32,16), new THREE.MeshBasicMaterial({map:skyTexture,side:THREE.BackSide,depthWrite:false,fog:false}));
      this.returnSky.renderOrder = -10; this.retSea.add(this.returnSky);
      const fillLight = new THREE.HemisphereLight(0xd9edff,0x2b748d,.65); this.retSea.add(fillLight);
      const sun = new THREE.DirectionalLight(0xfff5e6,.85); sun.position.set(-4,8,-6); this.retSea.add(sun); this.retSea.add(sun.target);
      const foamCanvas = document.createElement('canvas'); foamCanvas.width = foamCanvas.height = 256;
      const foamContext = foamCanvas.getContext('2d'); let foamSeed = 7123;
      const foamRandom = () => { foamSeed = (1664525 * foamSeed + 1013904223) >>> 0; return foamSeed / 4294967296; };
      for (let i = 0; i < 2600; i++) {
        const a = foamRandom() * Math.PI * 2, radius = 80 + (foamRandom() - .5) * 28 + Math.sin(a * 9) * 4;
        foamContext.fillStyle = `rgba(234,250,248,${.08 + foamRandom() * .24})`;
        foamContext.beginPath(); foamContext.arc(128 + Math.cos(a) * radius,128 + Math.sin(a) * radius,.5 + foamRandom() * 2.1,0,Math.PI * 2); foamContext.fill();
      }
      const foamTexture = new THREE.CanvasTexture(foamCanvas);
      this.rSplash = new THREE.Mesh(new THREE.PlaneGeometry(6,6), new THREE.MeshBasicMaterial({map:foamTexture, color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      this.rSplash.rotation.x = -Math.PI / 2; this.rSplash.position.y = 0.002; this.rSplash.scale.setScalar(0.04); this.retSea.add(this.rSplash);
      // after splashdown: fluorescein dye spreading round the capsule, and the released main canopy floating downwind
      this.rDye = new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.MeshBasicMaterial({ map:puffTexture(), color: 0x52b957, transparent: true, opacity: 0, depthWrite: false }));
      this.rDye.rotation.x = -Math.PI / 2; this.rDye.position.y = 0.001; this.retSea.add(this.rDye);
      const clothCanvas = document.createElement('canvas'); clothCanvas.width = clothCanvas.height = 256;
      const clothContext = clothCanvas.getContext('2d');
      for (let i=0;i<16;i++) { clothContext.beginPath(); clothContext.moveTo(128,128); clothContext.arc(128,128,121,i*Math.PI/8,(i+1)*Math.PI/8); clothContext.closePath(); clothContext.fillStyle = i%2 ? '#d98443' : '#e9e6d8'; clothContext.fill(); }
      const clothTexture = new THREE.CanvasTexture(clothCanvas); clothTexture.encoding = THREE.sRGBEncoding;
      const clothGeometry = new THREE.PlaneGeometry(9,9,32,32), clothPoints = clothGeometry.attributes.position;
      for (let i=0;i<clothPoints.count;i++) { const x=clothPoints.getX(i),y=clothPoints.getY(i); clothPoints.setZ(i,.2*Math.sin(x*2.3)+.14*Math.cos(y*1.8+x)); }
      clothGeometry.computeVertexNormals();
      this.rFloat = new THREE.Mesh(clothGeometry, new THREE.MeshStandardMaterial({map:clothTexture, roughness: .95, transparent: true, alphaTest:.1, side: THREE.DoubleSide }));
      this.rFloat.rotation.x = -Math.PI / 2; this.rFloat.position.set(0.35, 0.0015, 0.16); this.rFloat.scale.set(0.04, 0.04 * 0.6, 0.04); this.retSea.add(this.rFloat);
      const ship = this.ship = window.RecoveryVisuals ? RecoveryVisuals.buildShip(THREE) : new THREE.Group(); r.add(ship);
      const hullM = this._std(0x2e3a48, { roughness: .7 }), deckM = this._std(0x5b6470, { roughness: .8 }), whiteM = this._std(0xe8e8e6, { roughness: .6 }), craneM = this._std(0xd9a400, { roughness: .5, metalness: .4 });
      const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); ship.add(b); return b; };
      if (!window.RecoveryVisuals) {
        box(62, 6, 13, hullM, 0, 3, 0); box(60, 0.6, 12.4, deckM, 0, 6.3, 0); box(14, 9, 11, whiteM, 17, 11, 0); box(5, 4, 5, whiteM, 19, 17.5, 0);
        box(1.2, 14, 1.2, craneM, -12, 13, 3.5); const jib = box(16, 1, 1, craneM, -18, 19.5, 3.5); jib.rotation.z = -0.35;
      }
      ship.scale.setScalar(0.04); this.shipDeckKm = 6.6 * 0.04;
      this.recoveryCable = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0,0,0),V(0,1,0)]),new THREE.LineBasicMaterial({color:0x283c49}));
      this.recoveryCable.frustumCulled = false; r.add(this.recoveryCable);
      this.retSea.visible = true;
    }
    _basis(obj, xAxis, yAxis) {   // orient obj so its local +x and +y line up with the given world directions
      const y = yAxis.clone().normalize(), x = xAxis.clone().sub(y.clone().multiplyScalar(xAxis.dot(y))).normalize(), z = new THREE.Vector3().crossVectors(x, y);
      obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    }
    updateReturn(c, dt = 1 / 60) {
      /* c: capsule state at the replay time (replay.js capsuleAt): alt_km, speed_ms, x_km (along the launch azimuth line),
         fpa_deg, heat_kw_m2, phase, t and the key times tDrogue / tMain / tSplash / tRecovery, splashKm, shipKm, shipMs. */
      this._loadReturnCad();
      // Surface detail follows mission time, so pausing and revisiting a frame are deterministic.
      const motionTime = this.reducedMotion ? 0 : c.t - c.tSplash;
      const alt = Math.max(c.alt_km, 0);
      this._sky(alt);
      const floating = c.phase === 'floating', aboard = c.t >= c.tRecovery;
      const sz = this._place(c.splashKm, 0);
      this.retSea.position.copy(sz.pos); this._basis(this.retSea, sz.side, sz.up);
      this.returnSky.visible = alt < 12;
      if (alt < 12) { this.groundFog.color.setHex(0xb7d6e3); this.groundFog.near = 5; this.groundFog.far = 35; }
      if (this.returnOcean) RecoveryVisuals.updateOcean(this.returnOcean, motionTime, {speed:1});
      // recovery ship: on station beside the predicted point, steams to the capsule after splashdown, bow towards it
      const transit = c.shipKm * 1000 / Math.max(c.shipMs, .001);
      const remaining = Math.max(0, c.shipKm - Math.max(0, c.t - c.tSplash) * c.shipMs / 1000);
      const arrivedAt = c.tSplash + transit;
      const hoist = Math.min(1, Math.max(0, (c.t - arrivedAt) / Math.max(1, c.tRecovery - arrivedAt)));
      const lift = sstep(hoist / .4), swing = sstep((hoist - .4) / .4), lower = sstep((hoist - .8) / .2);
      const hoisting = floating && c.t >= arrivedAt && !aboard;
      // The crane pickup point is the position anchor. Hull-centre offsets compensate for 40x
      // vehicle display scale; the approach distance/speed agrees with the telemetry readout.
      this.ship.position.copy(sz.pos).add(sz.side.clone().multiplyScalar(remaining - .56)).add(sz.fwd.clone().multiplyScalar(.4));
      this._basis(this.ship, sz.side.clone().negate(), sz.up);
      if (window.RecoveryVisuals && RecoveryVisuals.updateCrane) RecoveryVisuals.updateCrane(this.ship, swing);
      // capsule: heat shield first along the velocity; hanging heat-shield-down under the canopies; afloat; then on deck
      const g = this._place(c.x_km, alt), gam = THREE.MathUtils.degToRad(c.fpa_deg);
      const vdir = g.fwd.clone().multiplyScalar(Math.cos(gam)).add(g.up.clone().multiplyScalar(Math.sin(gam))).normalize();
      const aft = floating ? sz.up.clone() : vdir.clone().negate();
      let pos = floating ? sz.pos.clone().add(sz.up.clone().multiplyScalar(-0.009 + Math.sin(motionTime * 1.7) * 0.0015)) : g.pos.clone();   // afloat on the aeroshell
      // Pick up outside the hull, clear the rail, swing inboard, then lower onto deck.
      // The manoeuvre illustrates the model's existing arrival-to-recovery interval.
      if (hoisting) pos = sz.pos.clone().add(sz.fwd.clone().multiplyScalar(.28 * swing))
        .add(sz.up.clone().multiplyScalar(hoist < .4 ? lerp(-.009, .55, lift) : lerp(.55, this.shipDeckKm + .012, lower)));
      if (aboard) pos = this.ship.position.clone().add(sz.side.clone().multiplyScalar(0.56)).add(sz.up.clone().multiplyScalar(this.shipDeckKm + 0.012)).add(sz.fwd.clone().multiplyScalar(-0.12));   // on deck under the crane
      this.rcap.position.copy(pos); this.rcap.quaternion.setFromUnitVectors(V(0, 1, 0), aft);
      const heat = Math.min(c.heat_kw_m2 / 600, 1), fl = 1 + Math.sin(motionTime * 31) * .08;
      this.rPlasma.visible = this.rWake.visible = heat > .01;
      this.rPlasma.material.opacity = .9 * heat; this.rPlasma.scale.set(fl, .32 * fl, fl);
      this.rWake.material.opacity = .45 * heat; this.rWake.scale.set(1, .5 + .7 * heat, 1);
      const fill = (chute, f) => { const { canopy, lines } = chute.userData; canopy.scale.set(.15 + .85 * f, .55 + .45 * f, .15 + .85 * f); lines.scale.set(.15 + .85 * f, 1, .15 + .85 * f); };
      this.rMain.visible = c.phase === 'main'; if (this.rMain.visible) fill(this.rMain, sstep((c.t - c.tMain) / 6.0));
      const ts = c.t - c.tSplash; this.rSplash.visible = ts > 0 && ts < 25;
      if (this.rSplash.visible) { this.rSplash.scale.setScalar(0.04 * (1 + ts * 0.45)); this.rSplash.material.opacity = .65 * (1 - ts / 25); this.rSplash.position.set(0, 0.004, 0); }
      const afloat = floating && !aboard;
      this.rDye.visible = afloat; if (afloat) { const d = sstep(ts / 90); this.rDye.scale.setScalar(0.04 + 0.14 * d); this.rDye.material.opacity = .3 * d; }
      this.rFloat.visible = floating;
      this.rBeacon.visible = floating && !aboard && Math.sin(motionTime * 6) > .6;
      this.recoveryCable.visible = hoisting;
      if (hoisting) {
        const tip = (this.ship.userData.craneTip || V(-14,19,3)).clone();
        this.ship.updateMatrixWorld(true); this.ship.localToWorld(tip);
        const top = pos.clone().add(sz.up.clone().multiplyScalar(.085));
        const points = this.recoveryCable.geometry.attributes.position;
        points.setXYZ(0,tip.x,tip.y,tip.z); points.setXYZ(1,top.x,top.y,top.z); points.needsUpdate = true;
      }
      // cameras: side-on through the entry with the plasma trailing, close on the drogue, wide on the main canopy,
      // low over the water for splashdown and recovery
      let from, at;
      const fit = Math.max(1, .95 / Math.max(.3, this.camera.aspect));
      if (aboard || hoisting) { // Inspect the capsule and crane on the working deck; bridge stays in context.
        from = pos.clone().add(sz.fwd.clone().multiplyScalar(-.62 * fit)).add(sz.side.clone().multiplyScalar(.42 * fit)).add(sz.up.clone().multiplyScalar(.27 * fit));
        at = pos.clone().add(sz.side.clone().multiplyScalar(-.08)).add(sz.up.clone().multiplyScalar(.065));
      } else if (floating) {  // low over the water: the lab afloat on its aeroshell, dye and canopy in front, the ship behind
        from = sz.pos.clone().add(sz.fwd.clone().multiplyScalar(-.48 * fit)).add(sz.side.clone().multiplyScalar(-.28 * fit)).add(sz.up.clone().multiplyScalar(.15 * fit));
        at = pos.clone().add(sz.side.clone().multiplyScalar(.065)).add(sz.up.clone().multiplyScalar(.045));
      } else if (c.phase === 'main') {   // 360 m canopy on a 560 m riser at this scale; from the side away from the ship, which
        // waits 2.6 km off on the other side (a camera on the ship's side ends up inside its superstructure near the water)
        const wideFit = Math.max(fit, 1.35 / Math.max(.3, this.camera.aspect));
        from = pos.clone().add(g.side.clone().multiplyScalar(-1.3 * wideFit)).add(g.fwd.clone().multiplyScalar(-2.2 * wideFit)).add(g.up.clone().multiplyScalar(.65 * wideFit));
        at = pos.clone().add(g.side.clone().multiplyScalar(.85)).add(g.up.clone().multiplyScalar(.36));
      } else {                // side-on through the entry, plasma ahead of the aeroshell and the wake trailing
        from = pos.clone().add(g.side.clone().multiplyScalar(.8)).add(aft.clone().multiplyScalar(.15)).add(g.up.clone().multiplyScalar(.1));
        at = pos.clone().add(aft.clone().multiplyScalar(.11));
      }
      const minR = this.earthR + 0.03; if (from.length() < minR) from.setLength(minR);       // never below the sea
      this.camPos.copy(from); this.camTarget.copy(at);
      this.camera.position.copy(from); this.camera.up.copy(from.clone().normalize()); this.camera.lookAt(at);
      this.renderer.render(this.scene, this.camera);
    }
    _loadCad() {
      /* Team CAD (scripts/cad_to_glb.py): booster.glb / upper.glb in metres, Y up, base at the origin.
         Inside the vehicle groups 1 unit = 1/3 m (procedural build scale), so the CAD gets scale 3. */
      if (!THREE.GLTFLoader) return;
      const loader = new THREE.GLTFLoader(), S = 3.0;
      const skin = new THREE.MeshPhysicalMaterial({ color: 0xe8ecec, roughness: .43, metalness: .12, clearcoat: .18, clearcoatRoughness: .45, envMapIntensity: .85 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x30343b, roughness: .38, metalness: .8, envMapIntensity: 1.15 });
      const attach = (grp, gltf, hideProcedural) => {
        const root = gltf.scene; root.scale.setScalar(S);
        root.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); const bb = new THREE.Box3().setFromObject(o); o.material = (bb.max.y - bb.min.y) < 2.5 ? dark : skin; o.material.side = THREE.DoubleSide; o.castShadow = true; o.receiveShadow = true; } });
        hideProcedural.forEach(o => o.visible = false);
        grp.add(root); grp.userData.cad = root;
        const bb = new THREE.Box3(); root.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox); } });
        grp.userData.cadHeight = (bb.max.y - bb.min.y) * S;   // metres x S = group units (independent of the group's own scale)
        this._brandRocket(root, bb);
      };
      // booster: CAD body, 4 legs with their support struts and the 4 drag fins as separate nodes so they can deploy
      // (scripts/cad_parts.py, scripts/cad_drag.py)
      loader.load(BASE + 'static/models/booster_body.glb?v=1', g => {
        attach(this.booster, g, this.booster.children.filter(c => c !== this.bFlame));
        this.legs.forEach(l => l.visible = false); this.fins.forEach(f => f.visible = false); this.engines.visible = false;
        this.bFlame.position.y = -0.5;
        this.cadBoosterH = this.booster.userData.cadHeight; this.stackH = this.cadBoosterH * this.vehScale;
      }, undefined, () => {});
      fetch(BASE + 'static/models/parts.json?v=2').then(r => r.json()).then(meta => {
        this.cadLegs = []; this.cadStruts = [];
        const prep = (g) => g.scene.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); o.material = dark; o.material.side = THREE.DoubleSide; } });
        const tangent = (deg) => { const a = THREE.MathUtils.degToRad(deg); return V(-Math.sin(a), 0, Math.cos(a)).normalize(); };
        // legs: hinged 0.36 m above the exit plane, the foot swings out and down
        loader.load(BASE + 'static/models/legs.glb?v=1', g => { prep(g);
          meta.legs.forEach(info => { const node = g.scene.getObjectByName(info.name); if (!node) return;
            const pivot = new THREE.Group(), h = info.hinge; pivot.position.set(h[0] * S, h[1] * S, h[2] * S);
            node.position.set(0, 0, 0); node.scale.setScalar(S); pivot.add(node); this.booster.add(pivot);
            this.cadLegs.push({ pivot, axis: tangent(info.angle_deg) }); });
        }, undefined, () => {});
        // Support struts: the thin 2 m rods of the CAD ("fin" nodes of parts.json, same azimuth as each leg) are the
        // telescoping braces of the legs, not aerodynamic fins. The lower end is pinned to the body, the upper end to the
        // leg 3.15 m from its hinge; the strut swings out and extends as the leg comes down (Falcon-style).
        loader.load(BASE + 'static/models/fins.glb?v=1', g => { prep(g);
          meta.fins.forEach((info, i) => { const node = g.scene.getObjectByName(info.name), leg = meta.legs[i]; if (!node || !leg) return;
            const h = info.hinge, len = info.length, pivot = new THREE.Group();
            pivot.position.set(h[0] * S, (h[1] - len) * S, h[2] * S);                     // body anchor = lower end of the rod
            node.position.set(0, len * S, 0); node.scale.setScalar(S); pivot.add(node); this.booster.add(pivot);
            this.cadStruts.push({ pivot, axis: tangent(info.angle_deg), len, rB: info.radius, yB: h[1] - len, yH: leg.hinge[1], s: h[1] - leg.hinge[1] }); });
        }, undefined, () => {});
        // Drag mechanism (scripts/cad_drag.py): four 1.04 x 0.41 m panels hinged on the base ring between the legs. The
        // GLB holds them stowed, flat on the skin with the free edge towards the nose; they swing out about the tangential
        // hinge axis to the angle of the CAD (32 deg), driven by the twin's deployment fraction.
        if (meta.drag) loader.load(BASE + 'static/models/drag.glb?v=1', g => {
          // heat-tinted Inconel: the panels sit at the engine end, and a darker metal reads against the white skin
          const finMat = new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: .34, metalness: .85, side: THREE.DoubleSide });
          g.scene.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); o.material = o.name === 'drag_ring' || (o.parent && o.parent.name === 'drag_ring') ? dark : finMat; } });
          this.cadDrag = [];
          meta.drag.forEach(info => { const node = g.scene.getObjectByName(info.name); if (!node) return;
            const pivot = new THREE.Group(), h = info.hinge; pivot.position.set(h[0] * S, h[1] * S, h[2] * S);
            node.position.set(0, 0, 0); node.scale.setScalar(S); pivot.add(node); this.booster.add(pivot);
            this.cadDrag.push({ pivot, axis: tangent(info.angle_deg), open: THREE.MathUtils.degToRad(info.deploy_deg) }); });
          const ring = g.scene.getObjectByName('drag_ring'); if (ring) { ring.scale.setScalar(S); this.booster.add(ring); }
        }, undefined, () => {});
      }).catch(() => {});
      this.legDeploy = 0; this.finDeploy = 0;
      loader.load(BASE + 'static/models/upper.glb?v=3', g => { attach(this.upper, g, this.upper.children.filter(c => c !== this.uFlame)); }, undefined, () => {});
    }
    _emit(pos, dir, n, spread, speed) {
      const u = this.plume.userData, p = this.plume.geometry.attributes.position.array;
      for (let k = 0; k < n; k++) { const i = u.i = (u.i + 1) % u.life.length; p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
        u.vel[i * 3] = dir.x * speed + (Math.random() - .5) * spread; u.vel[i * 3 + 1] = dir.y * speed + (Math.random() - .5) * spread; u.vel[i * 3 + 2] = dir.z * speed + (Math.random() - .5) * spread; u.life[i] = 1; }
    }
    _stepPlume(dt) {
      const u = this.plume.userData, p = this.plume.geometry.attributes.position.array;
      for (let i = 0; i < u.life.length; i++) { if (u.life[i] <= 0) continue; u.life[i] -= dt * 1.6; p[i * 3] += u.vel[i * 3] * dt; p[i * 3 + 1] += u.vel[i * 3 + 1] * dt; p[i * 3 + 2] += u.vel[i * 3 + 2] * dt; if (u.life[i] <= 0) p[i * 3 + 1] = -1e7; }
      this.plume.geometry.attributes.position.needsUpdate = true;
    }
    _puff(site) {                 // one puff from the flame trench: out along the trench, a little lift, growing as it slows
      const u = this.cloud.userData, q = u.p[u.i = (u.i + 1) % u.p.length], side = Math.random() < .5 ? -1 : 1;
      q.sp.position.copy(site.pos).add(site.up.clone().multiplyScalar(.04 + Math.random() * .05)).add(site.fwd.clone().multiplyScalar((Math.random() - .5) * .12));
      q.v.copy(site.side).multiplyScalar(side * (.25 + Math.random() * .35)).add(site.fwd.clone().multiplyScalar((Math.random() - .5) * .22)).add(site.up.clone().multiplyScalar(.02 + Math.random() * .05));
      q.up.copy(site.up); q.life = 0; q.max = 5 + Math.random() * 4; q.s0 = .12 + Math.random() * .1; q.s1 = .7 + Math.random() * .6; q.live = true; q.sp.visible = true;
      q.sp.material.color.setHex(0xffd9b0);
    }
    _stepCloud(dt) {
      for (const q of this.cloud.userData.p) {
        if (!q.live) continue;
        q.life += dt; const k = q.life / q.max;
        if (k >= 1) { q.live = false; q.sp.visible = false; continue; }
        q.sp.position.add(q.v.clone().multiplyScalar(dt)).add(q.up.clone().multiplyScalar(.012 * dt));     // drift and a slow rise
        q.v.multiplyScalar(Math.max(0, 1 - .7 * dt));
        const sz = q.s0 + (q.s1 - q.s0) * Math.sqrt(k); q.sp.scale.set(sz, sz, 1);
        q.sp.material.opacity = .62 * (1 - k) * Math.min(1, k * 10);
        if (k > .12) q.sp.material.color.setHex(0xdedbd6);                                                // flame-lit at first, then steam grey
      }
    }
    _clearCloud() { for (const q of this.cloud.userData.p) { q.live = false; q.sp.visible = false; } this.cloud.userData.acc = 0; }
    _flameOn(f, on, throttle, flicker) {
      f.visible = on; if (!on) return;
      const s = (0.75 + 0.35 * throttle) * (1 + Math.sin(flicker * 37) * .06); f.scale.set(1, s, 1);
    }
    _sky(alt) {
      const k = sstep(Math.max(alt, 0) / 90);
      this.scene.background.setRGB(.003, .006, .013);
      this.daySky.visible = this.phase === 'launch' && alt < 90;
      this.daySky.material.uniforms.density.value = 1 - k;
      this.stars.material.opacity = .38 * sstep((alt - 90) / 55);
      this.stars.visible = alt > 90;
      this.scene.fog = alt < 25 ? this.groundFog : null;
      this.groundFog.color.setRGB(lerp(.55, .06, k), lerp(.69, .11, k), lerp(.78, .19, k)); this.groundFog.near = 2.5; this.groundFog.far = 33 / Math.max(.03, 1 - alt / 25);
      this.launchGround.visible = this.phase === 'launch' && alt < 18;
      this.sun.castShadow = this.phase === 'launch' && alt < .8;
    }
    updateLaunch(s, hasSep, dt = 1 / 60) {
      this.t += dt;
      const hero = s.upper || s.stack, alt = hero ? hero.alt_km : 0;
      const seen = hasSep && s.booster ? s.booster.alt_km : alt;       // the sky belongs to the vehicle the camera is on
      this._sky(seen);
      this.padContact.visible = !hasSep && alt < .25; this.padContact.material.opacity = .55 * Math.max(0, 1 - alt / .25);
      const axisOf = (g, tilt) => g.up.clone().multiplyScalar(Math.cos(tilt)).add(g.fwd.clone().multiplyScalar(Math.sin(tilt)));
      const placeVeh = (obj, smp, tilt, lift = 0) => { const g = this._place(smp.downrange_km, Math.max(smp.alt_km, 0) + lift); obj.position.copy(g.pos); this._orient(obj, g.up, g.fwd, tilt); g.axis = axisOf(g, tilt); return g; };
      const DECK = this.deckTop * this.vehScale;                         // barge deck above the waterline (km at 40x)
      let camFrom = null, camAt = null;
      if (!hasSep) {
        const body = s.stack || { downrange_km: 0, alt_km: 0, throttle: 0 };
        const tilt = body.att != null ? body.att : Math.atan2(body.downrange_km, body.alt_km + 6) * .95;
        const g = placeVeh(this.booster, body, tilt);
        // the upper stage rides on top of the booster
        this.upper.position.copy(g.pos).add(g.axis.clone().multiplyScalar(this.stackH)); this.upper.quaternion.copy(this.booster.quaternion);
        const on = body.throttle > 0; this._flameOn(this.bFlame, on, body.throttle, this.t); this.uFlame.visible = false;
        // vehicles are drawn 40x on true-scale positions: near the pad the flame would reach into the ground, so it is cut at
        // the pad and the exhaust spreads into the trench as a cloud instead
        if (on) { const flen = this.bFlame.userData.len * this.vehScale; this.bFlame.scale.y = Math.max(.05, Math.min(this.bFlame.scale.y, (alt + .015) / flen)); }
        this.bLight.intensity = on ? 2.2 * body.throttle * (1 + Math.sin(this.t * 41) * .08) : 0; this.uLight.intensity = 0;
        if (!on && alt <= 0) this._clearCloud();
        else if (on && alt < 1.6) {
          const site = this._place(0, 0), u = this.cloud.userData;
          u.acc += 45 * body.throttle * Math.max(0, 1 - alt / 1.6) * dt;
          while (u.acc >= 1) { u.acc -= 1; this._puff(site); }
        }
        if (on) this._emit(g.pos.clone().sub(g.axis.clone().multiplyScalar(.04)), g.axis.clone().negate(), alt < 3 ? 10 : 3, alt < 3 ? .03 : .01, alt < 3 ? .06 : .03);
        const d = Math.max(2.3, alt * .09);                         // whole stack in frame on the pad; chase distance grows with altitude so the curvature shows
        camFrom = g.pos.clone().add(g.side.clone().multiplyScalar(d * .8)).add(g.fwd.clone().multiplyScalar(-d * .45)).add(g.up.clone().multiplyScalar(d * .3));
        camAt = g.pos.clone().add(g.axis.clone().multiplyScalar(this.stackH * .8));
        this.sepT = null; this._deploy(0, 0, .2);
      } else {
        if (this.sepT === null) this.sepT = this.t;
        const sepAge = s.sepAge != null ? s.sepAge : (this.t - this.sepT) * 8;
        let gb = null, gu = null, uTilt = 1.5;
        if (s.upper) { uTilt = s.upper.att != null ? s.upper.att : lerp(0.8, 1.5, Math.min(sepAge / 8, 1));
          gu = placeVeh(this.upper, s.upper, uTilt); this._flameOn(this.uFlame, s.upper.throttle > 0, s.upper.throttle, this.t);
          this.uLight.intensity = s.upper.throttle > 0 ? 1.6 : 0; }
        if (s.booster) {
          const b = s.booster, down = !!b.landed || b.phase === 'landed' || (b.alt_km <= 0.001 && b.speed_ms < 8);
          const landing = down || b.phase === 'landing_burn';
          const tilt = b.att != null ? b.att : (b.phase === 'coast' ? .5 : b.phase === 'boostback' ? -Math.PI / 2 : 0);
          gb = placeVeh(this.booster, b, tilt, landing ? DECK : 0);
          const burning = b.throttle > 0 && !down;
          this._flameOn(this.bFlame, burning, b.throttle, this.t); this.bLight.intensity = burning ? 2.0 * b.throttle : 0;
          if (burning) this._emit(gb.pos.clone(), gb.axis.clone().negate(), 2, .01, .03);
          const legsOut = down ? 1 : b.phase === 'landing_burn' ? Math.min(Math.max((1.3 - b.alt_km) / 0.9, 0), 1) : 0;
          this._deploy(legsOut, b.fins != null ? b.fins : 0, .12);
          // with the legs down the nozzles sit 1.28 m above the deck (docs/REENTRY.md): lift the body accordingly
          if (landing) this.booster.position.add(gb.up.clone().multiplyScalar(0.0512 * this.legDeploy));
          if (gu) {
            /* Vehicles are drawn 40x, positions are 1:1. Right after separation the true gap (metres) is far smaller than
               the models, so the upper stage is kept on the booster's nose and pulled away along the stack axis with the
               same 40x gain, blending into its true position once the gap exceeds the model size. */
            const sepAxis = axisOf(gb, s.sepAtt != null ? s.sepAtt : .8);
            const rel = gu.pos.clone().sub(gb.pos), d = rel.length();
            const w = Math.exp(-d / .3), dir = sepAxis.clone().multiplyScalar(w).add(rel.clone().normalize().multiplyScalar(1 - w)).normalize();
            this.upper.position.copy(gb.pos).add(sepAxis.clone().multiplyScalar(this.stackH * (1 - Math.exp(-0.4 / Math.max(d, 1e-4)))))
              .add(dir.multiplyScalar(d + 3.9 * (1 - Math.exp(-d / .1))));
          }
        }
        const lz = this._place(this.landingZoneKm || 0, 0); this.barge.position.copy(lz.pos); this._orient(this.barge, lz.up, lz.fwd, 0);
        const g = gb || gu, smp = s.booster || s.upper;
        if (gb && s.booster.alt_km < 4 && ['landing_burn', 'descent', 'landed'].includes(s.booster.phase)) {
          // off the deck corner: legs and struts visible; after touchdown the camera pushes in on the gear and drag fins
          const push = s.touchAge != null ? lerp(1, .5, sstep(s.touchAge / 10)) : 1;
          camFrom = lz.pos.clone().add(lz.side.clone().multiplyScalar(1.45 * push)).add(lz.fwd.clone().multiplyScalar(.9 * push)).add(lz.up.clone().multiplyScalar(.42 * push));
          camAt = gb.pos.clone().add(gb.up.clone().multiplyScalar(lerp(.12, .3, push)));
        } else if (gb) {
          // close on the separation, the flip and the divert burn, then ease out for the coast and the entry
          const far = Math.max(2.5, Math.min(smp.alt_km * .06, 7)), e = Math.min(Math.max((sepAge - 14) / 10, 0), 1), d = lerp(3.4, far, e * e * (3 - 2 * e));
          camFrom = g.pos.clone().add(g.side.clone().multiplyScalar(d * .8)).add(g.fwd.clone().multiplyScalar(-d * .5)).add(g.up.clone().multiplyScalar(d * .3));
          camAt = g.pos.clone().add(gb.axis.clone().multiplyScalar(this.stackH * .5 * Math.exp(-sepAge / 20)));
          if (gu) { const toUp = this.upper.position.clone().sub(camAt), du = toUp.length(); camAt.add(toUp.multiplyScalar(.35 * Math.exp(-du / 2.5))); }
          // second-stage ignition: cut to the upper stage from behind its engine for a few seconds after separation,
          // then back to the booster for the flip and the divert burn
          const w2 = gu ? sstep((sepAge - 2) / 1.5) * (1 - sstep((sepAge - 9.5) / 1.5)) : 0;
          if (w2 > 0) {
            const U = gu.axis, up = this.upper.position;
            camFrom.lerp(up.clone().add(gu.side.clone().multiplyScalar(.9)).add(U.clone().multiplyScalar(-1.25)).add(gu.up.clone().multiplyScalar(.2)), w2);
            camAt.lerp(up.clone().add(U.clone().multiplyScalar(-.12)), w2);
          }
          // drag fins: at 100 km the chase camera is kilometres away and the panels are a few pixels, so the director
          // dollies in on the engine end while they open (blend in from 5 s before, out from 6 s after the command)
          const w = s.finsAge != null ? sstep((s.finsAge + 5) / 3) * (1 - sstep((s.finsAge - 6) / 3)) : 0;
          if (w > 0) {
            const A = gb.axis, Sd = gb.side, F = new THREE.Vector3().crossVectors(Sd, A).normalize(), base = this.booster.position;
            const near = Sd.clone().multiplyScalar(.27).add(F.clone().multiplyScalar(.12)).add(A.clone().multiplyScalar(-.04));
            const far = camFrom.clone().sub(base), dist = Math.exp(lerp(Math.log(far.length()), Math.log(near.length()), w));   // log dolly
            camFrom = base.clone().add(far.normalize().lerp(near.clone().normalize(), w).normalize().multiplyScalar(dist));
            camAt.lerp(base.clone().add(A.clone().multiplyScalar(.05)), w);
          }
        } else {
          // the upper stage alone, on to orbit: a close chase keeps the 40x model in frame with the Earth's limb behind it,
          // circling slowly over the long coast to apogee; the circularisation burn plays in the same shot
          const a = this.reducedMotion ? .65 : this.t * .04, d = 2.6;
          const dir = g.side.clone().multiplyScalar(Math.cos(a)).add(g.fwd.clone().multiplyScalar(-.35 - .5 * Math.sin(a))).add(g.up.clone().multiplyScalar(.32)).normalize();
          camFrom = g.pos.clone().add(dir.multiplyScalar(d));
          camAt = g.pos.clone().add((gu ? gu.axis : g.up).clone().multiplyScalar(.15));
        }
      }
      if (camFrom) { this.camPos.copy(camFrom); this.camTarget.copy(camAt); }   // rigid chase: replay runs 20-300x real time
      this._stepPlume(dt); this._stepCloud(dt);
      this.camera.position.copy(this.camPos); this.camera.up.copy(this.camPos.clone().normalize()); this.camera.lookAt(this.camTarget);
      this.daySky.position.copy(this.camera.position); this.daySky.material.uniforms.up.value.copy(this.camera.position).normalize();
      if (this.launchOcean && this.launchGround.visible) {
        const waterSample = s.booster || hero, waterTime = waterSample && Number.isFinite(waterSample.t) ? waterSample.t : 0;
        window.RecoveryVisuals.updateOcean(this.launchOcean, this.reducedMotion ? 0 : waterTime, this._launchOceanOptions);
      }
      this.renderer.render(this.scene, this.camera);
    }
    _deploy(legs, fins, k) {
      /* Landing gear and drag fins. Legs rotate 115 deg about their base hinge; each telescoping strut stays pinned to the
         body at its lower end and to the leg at its upper end, so it swings out and extends (2.06 m -> 3.7 m). The drag
         fins open about their hinge on the base ring to the angle of the CAD. */
      this.legDeploy = lerp(this.legDeploy || 0, legs, k); this.finDeploy = lerp(this.finDeploy || 0, fins, k);
      const th = THREE.MathUtils.degToRad(115) * this.legDeploy;
      if (this.cadLegs) this.cadLegs.forEach(l => l.pivot.quaternion.setFromAxisAngle(l.axis, -th));
      if (this.cadStruts) this.cadStruts.forEach(c => {
        const dr = c.s * Math.sin(th), dy = c.yH + c.s * Math.cos(th) - c.yB;         // leg attachment point relative to the body anchor
        c.pivot.quaternion.setFromAxisAngle(c.axis, -Math.atan2(dr, dy)); c.pivot.scale.set(1, Math.hypot(dr, dy) / c.len, 1); });
      if (this.cadDrag) this.cadDrag.forEach(d => d.pivot.quaternion.setFromAxisAngle(d.axis, -d.open * this.finDeploy));
      if (!this.cadLegs && !this.cadBoosterH) {   // procedural fallback while the CAD is loading
        this.fins.forEach(f => f.rotation.z = lerp(Math.PI / 2, 0, this.finDeploy)); this.legs.forEach(l => l.rotation.z = -0.55 * this.legDeploy); }
    }

    // ================= OPS: LELP in orbit =================
    _buildOps() {
      const g = this.ops = new THREE.Group(); this.scene.add(g);
      const R = 420;
      const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), this._earthMaterial());
      earth.position.set(40, -R - 60, -180); g.add(earth); this.earth = earth;
      // The ops scene is an illustrative close-up, not a georeferenced tracking map. Aim its backdrop
      // at the Indian Ocean/Asia instead of presenting an unmoving polar cap directly beneath the lab.
      const lat = THREE.MathUtils.degToRad(12), lon = THREE.MathUtils.degToRad(85);
      const geography = V(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
      earth.quaternion.setFromUnitVectors(geography, V(60, 18, 60).sub(earth.position).normalize());
      this._cloudLayer(earth, R);
      const glow = this._atmosphere(R, R * .014);
      glow.position.copy(earth.position); g.add(glow);
      const lelp = this.lelp = new THREE.Group(); g.add(lelp);
      const mli = mliTexture(), foilBump = mli.clone(); foilBump.encoding = THREE.LinearEncoding; foilBump.needsUpdate = true;
      this.modules = [];
      const Rm = 5.2;
      const layers = [{ y: 0, h: 2.5 }, { y: 2.6, h: 2.5 }, { y: 5.2, h: 4.5 }, { y: 9.8, h: 4.5 }];
      layers.forEach(L => {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const m = new THREE.Mesh(new THREE.BoxGeometry(3.6, L.h - .3, 2.2), this._std(0xffffff, { map: mli, bumpMap: foilBump, bumpScale: .012, roughness: .38, metalness: .82, envMapIntensity: 1.3 }));
          m.position.set(Math.cos(a) * Rm, L.y + L.h / 2, Math.sin(a) * Rm); m.rotation.y = -a + Math.PI / 2;
          const led = new THREE.Mesh(new THREE.SphereGeometry(.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0x222222 })); led.position.set(1.4, -(L.h - .3) / 2 + .35, 1.15); m.add(led); m.userData.led = led;
          lelp.add(m); this.modules.push(m);
        }
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(Rm + 1.3, Rm + 1.3, .25, 8), this._std(0xd8d8d2, { metalness: .6, roughness: .3 })); ring.position.y = L.y; lelp.add(ring);
      });
      const core = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 15, 8), this._std(C.body)); core.position.y = 7.3; lelp.add(core);
      const lab = new THREE.Mesh(new THREE.CylinderGeometry(Rm + 1.3, Rm + 1.3, 5, 8), new THREE.MeshPhysicalMaterial({ color: 0xbfe0ff, transparent: true, opacity: .22, roughness: .05, metalness: 0, transmission: 0, side: THREE.DoubleSide })); lab.position.y = 17; lelp.add(lab);
      const rig = new THREE.Mesh(new THREE.BoxGeometry(5, .3, 5), this._std(0x9aa0aa, { metalness: .7 })); rig.position.y = 14.8; lelp.add(rig); this.rig = rig;
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(Rm + 1.4, Rm + 1.4, .3, 8), this._std(0xd8d8d2, { metalness: .6 })); lid.position.y = 19.6; lelp.add(lid);
      // Dexter-L (sentinel/lelp/arm.py): turntable ring J0 + 7 joints driven by the twin's joint angles; 9.5 scene
      // units per metre. Twin frame (x radial, y tangential, z up) maps to scene (x, z, y), so yaw/roll signs flip.
      // The team's arm CAD (models/arm_*.glb, a 0.93 m concept model) is stretched onto the 0.80 m links.
      const U = 9.5, L1m = 0.80, L2m = 0.80, L3m = 0.15;
      const link = (len, r, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * .85, len, 14), mat); m.rotation.z = -Math.PI / 2; m.position.x = len / 2; return m; };
      const jm = this._std(0x3a3f47, { metalness: .8, roughness: .35 }), lm = this._std(0xe8e8e2, { metalness: .4, roughness: .45 });
      this.armRing = new THREE.Group(); lelp.add(this.armRing);                                                  // J0 ring azimuth
      const track = new THREE.Mesh(new THREE.TorusGeometry(Rm + 1.5, .16, 8, 48), jm); track.rotation.x = Math.PI / 2; track.position.y = 1.52 * U; lelp.add(track);
      const outrigger = new THREE.Mesh(new THREE.BoxGeometry((0.85 - 0.70) * U + .6, .5, .9), jm); outrigger.position.set(0.775 * U, 1.56 * U, 0); this.armRing.add(outrigger);
      this.arm = new THREE.Group(); this.arm.position.set(0.85 * U, 1.60 * U, 0); this.armRing.add(this.arm);     // J1 yaw
      this.armBaseProc = new THREE.Mesh(new THREE.CylinderGeometry(.55, .65, 1.0, 16), jm); this.armBaseProc.position.y = -.2; this.arm.add(this.armBaseProc);
      this.j2 = new THREE.Group(); this.arm.add(this.j2);                                                         // J2 shoulder pitch (scene z)
      this.j2.add(new THREE.Mesh(new THREE.SphereGeometry(.55, 16, 16), jm));
      this.j3 = new THREE.Group(); this.j2.add(this.j3);                                                          // J3 upper-arm roll (scene x)
      this.armUpperProc = link(L1m * U, .3, lm); this.j3.add(this.armUpperProc);
      this.j4 = new THREE.Group(); this.j4.position.x = L1m * U; this.j3.add(this.j4);                            // J4 elbow
      this.j4.add(new THREE.Mesh(new THREE.SphereGeometry(.42, 16, 16), jm)); this.armForeProc = link(L2m * U, .24, lm); this.j4.add(this.armForeProc);
      this.j5 = new THREE.Group(); this.j5.position.x = L2m * U; this.j4.add(this.j5);                            // J5 wrist pitch
      this.j5.add(new THREE.Mesh(new THREE.SphereGeometry(.3, 12, 12), jm));
      this.j6 = new THREE.Group(); this.j5.add(this.j6);                                                          // J6 wrist roll
      this.j7 = new THREE.Group(); this.j6.add(this.j7);                                                          // J7 wrist yaw
      const cam = new THREE.Mesh(new THREE.BoxGeometry(.5, .35, .35), jm); cam.position.set(.6, .45, 0); this.j7.add(cam);
      this.gripper = new THREE.Mesh(new THREE.BoxGeometry(L3m * U, .9, 1.4), jm); this.gripper.position.x = L3m * U / 2; this.j7.add(this.gripper);
      this.carried = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 3.4), this._std(0xffffff, { map: mli, metalness: .7, roughness: .4 })); this.carried.position.x = L3m * U + 1.1; this.carried.visible = false; this.j7.add(this.carried);
      if (THREE.GLTFLoader) {
        const ld = new THREE.GLTFLoader(), armMat = this._std(0xd9dadc, { metalness: .6, roughness: .4 });
        const put = (url, parent, proc, sx, k, rotY) => ld.load(url, g => { const r = g.scene; r.scale.set(sx * U, k * U, k * U); if (rotY) r.rotation.y = rotY;
          r.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); o.material = armMat; o.material.side = THREE.DoubleSide; } });
          parent.add(r); if (proc) proc.visible = false; }, undefined, () => {});
        put(BASE + 'static/models/arm_upper.glb?v=1', this.j3, this.armUpperProc, L1m / 0.241, 2.0, 0);
        put(BASE + 'static/models/arm_fore.glb?v=1', this.j4, this.armForeProc, L2m / 0.457, 2.0, 0);
      }
      // solar wings with cell texture
      const cells = solarTexture();
      this.solar = new THREE.Group(); this.solar.position.y = -7; lelp.add(this.solar);
      [-1, 1].forEach(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(16, .12, 3.4), this._std(0xffffff, { map: cells, metalness: .5, roughness: .35 })); p.position.x = s * 12; this.solar.add(p);
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 4.5, 8), this._std(0x9aa0aa)); boom.rotation.z = Math.PI / 2; boom.position.x = s * 2.2; this.solar.add(boom); });
      this.solar.scale.set(.05, 1, 1);
      // upper stage below (integrated bus)
      const adapter = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.8, 2.4, 8, 1, true), this._std(0xd8d8d2, { side: THREE.DoubleSide, wireframe: true })); adapter.position.y = -1.6; lelp.add(adapter);
      const stage = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 22, 32), this._std(0xe6e6e0, { roughness: .45, metalness: .25 })); stage.position.y = -14; lelp.add(stage);
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4, 24, 1, true), this._std(0x555a63, { side: THREE.DoubleSide, metalness: .8 })); nozzle.position.y = -27; nozzle.rotation.x = Math.PI; lelp.add(nozzle);
      // whole-payload return: the inflatable heat shield is packed as a ring round the base of the stack, inside the 1.1 m
      // envelope (11.5 units per metre in this scene); after the stage separates it inflates to 2.6 m and the lab sits in its wake
      this.hiadMats = { skin: this._std(0xbdb3a2, { roughness: .85, metalness: .05, side: THREE.DoubleSide }), tori: this._std(0xd9b46a, { roughness: .7, metalness: .1 }),
                        rigid: this._std(0x3b2a20, { roughness: .9, metalness: .05 }) };
      this.hiad = buildHIAD(this.hiadMats.skin, this.hiadMats.tori, this.hiadMats.rigid); this.hiad.position.y = -1.75; this.hiad.visible = false; lelp.add(this.hiad);
      this.hiadPack = new THREE.Mesh(new THREE.TorusGeometry(4.9, .85, 12, 48), this.hiadMats.tori); this.hiadPack.rotation.x = Math.PI / 2; this.hiadPack.position.y = -0.9; lelp.add(this.hiadPack);
      // grapple post on the upper stage where Dexter-L parks for the return (arm.py STAGE_FIXTURE: 0.70 m out, 0.10 m below
      // the stack base, ring azimuth 22.5 deg between two module columns, outside the packed heat-shield ring)
      const fa = THREE.MathUtils.degToRad(22.5), fr = 0.70 * U;
      const fixture = this.fixture = new THREE.Group(); fixture.rotation.y = -fa; lelp.add(fixture);          // local x = radial out
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, 1.9, 10), jm); post.position.set(fr, -2.15, 0); fixture.add(post);
      this.grapplePin = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .55, 12), this._std(0xd9b44a, { metalness: .7, roughness: .3 }));
      this.grapplePin.position.set(fr, -1.0, 0); fixture.add(this.grapplePin);
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(fr - 4.4 + .3, .35, .7), jm); bracket.position.set((fr + 4.4) / 2, -3.0, 0); fixture.add(bracket);
      this.stageParts = [adapter, stage, nozzle, this.solar, fixture].map(o => ({ o, y: o.position.y }));
      // relays + ground stations as points on the Earth limb
      this.relays = []; this.links = new THREE.Group(); g.add(this.links);
      [[-70, 28, -60], [78, 36, -50]].forEach(p => { const r = new THREE.Group(); r.position.set(...p);
        const bus = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), this._std(0xffffff, { map: mli, metalness: .7 })); r.add(bus);
        [-1, 1].forEach(s => { const w = new THREE.Mesh(new THREE.BoxGeometry(4, .08, 1.4), this._std(0xffffff, { map: cells, metalness: .5 })); w.position.x = s * 3; r.add(w); });
        g.add(r); this.relays.push(r); });
      this.linkMat = { on: new THREE.LineBasicMaterial({ color: 0x5fd39a, transparent: true, opacity: .8 }), off: new THREE.LineBasicMaterial({ color: 0x9a3030, transparent: true, opacity: .8 }) };
      this.relayLinks = this.relays.map(r => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, 8, 0), r.position]), this.linkMat.on); l.visible = false; this.links.add(l); return l; });
    }
    updateOps(frame, states, isolatedNodes, dt, ctx = {}) {
      this.t += dt;
      this.scene.fog = null;
      this.scene.background.setRGB(.003, .006, .013); this.stars.material.opacity = .38; this.stars.visible = true; this.daySky.visible = false;
      this.lelp.rotation.y += dt * (this.reducedMotion || ctx.cam === 'arm' ? 0 : .018);
      // the Earth turns with mission time (one orbit per 95.7 min), capped so fast-forwarded days read as a time-lapse
      this.earth.rotateOnAxis(V(0, 1, 0), Math.min(Math.max((ctx.dtm || 0) * 2 * Math.PI / 5740, 0), dt * .18));
      const p = frame.platform, R = THREE.MathUtils.degToRad;
      // modules: colour + status LED
      states.forEach((s, i) => { const m = this.modules[i]; if (!m) return;
        const col = { idle: 0xffffff, good: 0xd8ffd8, warn: 0xffe0a0, crit: 0xffb0b0, move: 0xc0d8ff }[s] || 0xffffff;
        m.material.color.setHex(col); m.material.emissive.setHex(s === 'move' ? 0x0d2a5a : s === 'crit' ? 0x3a0a0a : 0x000000);
        m.userData.led.material.color.setHex({ idle: 0x222222, good: 0x1fe06a, warn: 0xffb020, crit: 0xff3030, move: 0x40a0ff }[s]);
        m.material.emissiveIntensity = 1; m.visible = true; });
      // customer experiments (replay.js expStates): what each experiment module is doing, readable from outside.
      // thaw orange, treatment violet, medium change cyan, preservation and cold storage blue, a white flash per imaging round
      this._flashAt = this._flashAt || {}; this._lastRound = this._lastRound || {};
      for (const x of ctx.exps || []) { const m = this.modules[x.module - 1]; if (!m || m.userData.isolated) continue;
        const pulse = this.reducedMotion ? .65 : .65 + .2 * Math.sin(this.t * 3);
        let em = null, k = 0, led = null;
        if (x.phase === 'cryo') led = 0x9fd8ff;
        if (x.glow === 'thaw') { em = 0xff8a3d; k = .6 * pulse; led = 0xffa040; }
        else if (x.glow === 'treat') { em = 0x8f63ff; k = .65 * pulse; led = 0xb090ff; }
        else if (x.glow === 'media') { em = 0x1fb3d6; k = .5 * pulse; led = 0x40c8ff; }
        else if (x.glow === 'preserve') { em = 0x2f6fd0; k = .7 * pulse; led = 0x6fa6ee; }
        else if (x.phase === 'preserved') { em = 0x2f6fd0; k = .25; led = 0x6fa6ee; }
        if (this._lastRound[x.module] === undefined) this._lastRound[x.module] = x.lastRound;
        else if (x.lastRound !== this._lastRound[x.module]) { this._lastRound[x.module] = x.lastRound; if (x.lastRound != null) this._flashAt[x.module] = this.t; }
        const fl = this._flashAt[x.module] != null ? Math.max(0, 1 - (this.t - this._flashAt[x.module]) / .4) : 0;
        if (fl > 0) { em = 0xffffff; k = Math.max(k, .9 * fl); led = 0xffffff; }
        if (em != null) { m.material.emissive.setHex(em); m.material.emissiveIntensity = k; }
        if (led != null) m.userData.led.material.color.setHex(led);
        if (x.module === ctx.focusModule && em != null) { this._focusCol = em; this._focusK = k; }
      }
      // a coloured light just outside the module the director is looking at, so the step reads in a wide shot too
      if (!this.focusLight) { this.focusLight = new THREE.PointLight(0xffffff, 0, 26); this.lelp.add(this.focusLight); }
      const fm = ctx.focusModule && this.modules[ctx.focusModule - 1];
      if (fm && this._focusCol != null) { this.focusLight.color.setHex(this._focusCol); fm.getWorldPosition(this.focusLight.position); this.lelp.worldToLocal(this.focusLight.position);
        this.focusLight.position.multiplyScalar(1.35); this.focusLight.intensity = lerp(this.focusLight.intensity, 2.2 * (this._focusK || 0) + .4, .2); }
      else this.focusLight.intensity = lerp(this.focusLight.intensity, 0, .1);
      this._focusCol = null;
      // South Atlantic Anomaly: a red cast on the lab while the dosimeter reads trapped protons
      if (!this.saaLight) { this.saaLight = new THREE.PointLight(0xff2a1f, 0, 70); this.saaLight.position.set(10, 9, 10); this.lelp.add(this.saaLight);
        this.saaLight2 = new THREE.PointLight(0xff2a1f, 0, 70); this.saaLight2.position.set(-10, 9, -10); this.lelp.add(this.saaLight2); }
      const saaI = ctx.saa ? 1.6 + (this.reducedMotion ? 0 : .35 * Math.sin(this.t * 3)) : 0;
      this.saaLight.intensity = lerp(this.saaLight.intensity, saaI, .08); this.saaLight2.intensity = this.saaLight.intensity;
      // Dexter-L: ring azimuth + joint angles straight from the twin (deg)
      const a = p.arm;
      if (a && a.joints) {
        const j = a.joints, k = ctx.snap ? 1 : a.parked ? .08 : .2;
        const ringT = R(-(a.ring_deg || 0)); let dr = ringT - this.armRing.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        this.armRing.rotation.y += dr * k;
        this.arm.rotation.y = lerp(this.arm.rotation.y, R(-j[0]), k); this.j2.rotation.z = lerp(this.j2.rotation.z, R(j[1]), k);
        this.j3.rotation.x = lerp(this.j3.rotation.x, R(-j[2]), k); this.j4.rotation.z = lerp(this.j4.rotation.z, R(j[3]), k);
        this.j5.rotation.z = lerp(this.j5.rotation.z, R(j[4]), k); this.j6.rotation.x = lerp(this.j6.rotation.x, R(-j[5]), k); this.j7.rotation.y = lerp(this.j7.rotation.y, R(-j[6]), k);
        this.carried.visible = !!a.grip;
        if (a.module && this.modules[a.module - 1] && a.grip) this.modules[a.module - 1].visible = false;
      }
      // solar wings
      this.solar.scale.x = lerp(this.solar.scale.x, this._solarDeployed ? 1 : .05, .04);
      // relays + links
      this.relays.forEach((r, i) => { const name = 'RELAY-' + (i + 1); const iso = isolatedNodes.includes(name); if (!this.reducedMotion) r.rotation.y += dt * .12;
        r.children[0].material.emissive.setHex(iso ? 0x5a1010 : 0x000000);
        const l = this.relayLinks[i]; l.visible = (frame.comms.visible || []).includes(name) || iso; l.material = iso ? this.linkMat.off : this.linkMat.on; });
      // return: the upper stage (with the solar wings) drifts away, then the heat shield inflates under the lab
      const rt = ctx.ret || { sep: false, sepAge: 0, inflate: 0 };
      this.stageParts.forEach(({ o, y }) => { o.position.y = rt.sep ? y - rt.sepAge * 1.5 : y; o.visible = !rt.sep || rt.sepAge < 160; });
      // Dexter-L parked on the stage grapple post leaves with the stage
      this.armRing.position.y = rt.sep ? -rt.sepAge * 1.5 : 0; this.armRing.visible = !rt.sep || rt.sepAge < 160;
      this.hiadPack.visible = rt.inflate <= 0; this.hiad.visible = rt.inflate > 0;
      if (this.hiad.visible) { const f = sstep(rt.inflate); this.hiad.scale.set(11.5 * lerp(.3, 1, f), 11.5 * lerp(.5, 1, f), 11.5 * lerp(.3, 1, f)); }
      // camera: slow orbit around LELP (console), close on the arm (customer view), pull back for the return; while
      // Dexter-L parks on the stage and for the first 20 s after separation, close on the arm, the post and the stage top
      const ret = rt.sep, sepA = rt.sep ? rt.sepAge : 0;
      if (rt.armParked && sepA < 20) {
        const pin = new THREE.Vector3(); this.grapplePin.getWorldPosition(pin);
        const out = pin.clone().setY(0).normalize(), side = new THREE.Vector3(-out.z, 0, out.x);
        const e = sstep(sepA / 20), ty = lerp(8, -7, e), d = lerp(52, 96, e), snap = ctx.snap || this._camSnap;
        this.camPos.lerp(V(out.x * 5, ty + 3, out.z * 5).add(out.clone().multiplyScalar(d * .55)).add(side.clone().multiplyScalar(d * .83)), snap ? 1 : .05);
        this.camTarget.lerp(V(out.x * 4, ty, out.z * 4), snap ? 1 : .06);
      } else if (ctx.focusModule && this.modules[ctx.focusModule - 1] && this.modules[ctx.focusModule - 1].visible && !ret) {
        // director: close on the experiment module while its protocol step happens (thaw, dosing, medium change, preservation)
        const mp = new THREE.Vector3(); this.modules[ctx.focusModule - 1].getWorldPosition(mp);
        const out = mp.clone().setY(0).normalize(), side = new THREE.Vector3(-out.z, 0, out.x), snap = ctx.snap || this._camSnap;
        this.camPos.lerp(mp.clone().add(out.multiplyScalar(34)).add(side.multiplyScalar(14)).add(V(0, 7, 0)), snap ? 1 : .05);
        this.camTarget.lerp(mp.clone().multiplyScalar(.55).add(V(0, mp.y * .45 + 2, 0)), snap ? 1 : .08);
      } else if (ctx.cam === 'arm' && !ret && !rt.armParked) {
        const base = new THREE.Vector3(); this.arm.getWorldPosition(base);
        const out = base.clone().setY(0).normalize(), side = new THREE.Vector3(-out.z, 0, out.x);
        const snap = ctx.snap || this._camSnap;
        this.camPos.lerp(base.clone().add(out.multiplyScalar(30)).add(side.multiplyScalar(20)).add(V(0, 8, 0)), snap ? 1 : .04);
        this.camTarget.lerp(V(base.x * .4, 11.5, base.z * .4), snap ? 1 : .06);
      } else {
        // The complete orbit stack spans y=-29..20; center that envelope with space around the solar wings.
        const ang = this.reducedMotion ? .65 : this.t * .022 + .65, d = ret ? 82 : 90;
        const snap = ctx.snap || this._camSnap;
        this.camPos.lerp(V(Math.cos(ang) * d, 16 + (this.reducedMotion ? 0 : Math.sin(this.t * .06) * 2), Math.sin(ang) * d), snap ? 1 : .02);
        this.camTarget.lerp(V(0, ret ? 4 : -3, 0), snap ? 1 : .04);
      }
      this._camSnap = false;
      this.camera.position.copy(this.camPos); this.camera.up.set(0, 1, 0); this.camera.lookAt(this.camTarget);
      this.renderer.render(this.scene, this.camera);
    }
    setPhase(p) { if (p === this.phase) return; this.phase = p; this.launch.visible = p === 'launch' || p === 'return'; this.ops.visible = p === 'ops';
      this.daySky.visible = p === 'launch'; this.launchGround.visible = p === 'launch';
      if (p !== 'launch') {
        this.sun.position.set(30000, 22000, 18000); this.sun.target.position.set(0, 0, 0); this.sunDirection.copy(this.sun.position).normalize();
        this.skyFill.position.set(0, 1, 0); this.skyFill.intensity = .32; this.rim.position.set(-24000, 12000, -18000); this.rim.target.position.set(0, 0, 0); this.rim.intensity = .65;
        this.sun.castShadow = false; this.sun.intensity = 1.6;
      } else {
        const site = this._place(0, 0);
        this.sunDirection.copy(site.up).multiplyScalar(.78).addScaledVector(site.side, .52).addScaledVector(site.fwd, -.35).normalize();
        this.sun.position.copy(site.pos).addScaledVector(this.sunDirection, 10); this.sun.target.position.copy(site.pos); this.sun.intensity = 1.35;
        this.skyFill.position.copy(site.up); this.skyFill.intensity = .42; this.rim.intensity = .45;
        this.rim.position.copy(site.pos).addScaledVector(site.up, 6).addScaledVector(site.side, -8); this.rim.target.position.copy(site.pos);
        this.daySky.material.uniforms.sunDirection.value.copy(this.sunDirection);
      }
      const ret = p === 'return'; this.ret.visible = ret; [this.booster, this.upper, this.pad, this.barge, this.plume, this.cloud].forEach(o => { o.visible = !ret; });
      if (ret) return;
      if (p === 'ops') { this.camera.up.set(0, 1, 0); this.camPos.set(60, 20, 60); this.camTarget.set(0, 8, 0); this._camSnap = true; } else { const g = this._place(0, 0); this.camPos.copy(g.pos.clone().add(g.side.clone().multiplyScalar(1.4)).add(g.up.clone().multiplyScalar(.5))); this.camTarget.copy(g.pos); } }
    setSolar(d) { this._solarDeployed = d; }
    setLandingZone(km) { this.landingZoneKm = km; }
  }
  window.Scene3D = Scene3D;
})();
