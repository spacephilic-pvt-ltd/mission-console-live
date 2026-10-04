/* Recovery presentation assets. The vessel is a generic illustrative recovery ship,
   not team CAD or a specified mission contractor. Water and fabric detail are visual
   approximations; the caller owns vehicle position, deployment, recovery and time.
   Ship/canopy: metres. Ocean: kilometres. All time comes from the mission replay. */
(function (scope) {
  'use strict';

  function buildShip(T) {
    const ship = new T.Group(); ship.name = 'Illustrative recovery vessel';
    const mat = (color, roughness = .5, metalness = .2) => new T.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: .85 });
    const navy = mat(0x183344, .4, .35), red = mat(0x8e382a, .62, .16), white = mat(0xdce4e6, .43, .12);
    const deckMat = mat(0x596c73, .84, .12), black = mat(0x1c282e, .65, .1), yellow = mat(0xd8ae44, .4, .35);
    const steel = mat(0x879ba3, .34, .65), orange = mat(0xd76a2c, .47, .08);
    const glass = new T.MeshPhysicalMaterial({ color: 0x193b51, roughness: .15, metalness: .45, clearcoat: .8, envMapIntensity: 1.4 });
    const vec = (x, y, z) => new T.Vector3(x, y, z);
    const box = (w, h, d, material, x, y, z, parent = ship) => {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    const cylinder = (radius, length, material, x, y, z, parent = ship) => {
      const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, length, 12), material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    };
    const strut = (a, b, radius, material, parent = ship) => {
      const direction = b.clone().sub(a), mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, direction.length(), 8), material);
      mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(vec(0, 1, 0), direction.normalize()); parent.add(mesh); return mesh;
    };
    const polyline = (points, material, radius = .055) => {
      const curve = new T.CatmullRomCurve3(points, false, 'centripetal');
      const mesh = new T.Mesh(new T.TubeGeometry(curve, Math.max(16, points.length * 4), radius, 5, false), material); ship.add(mesh); return mesh;
    };

    // Lofted hull: a rounded bilge, slight tumblehome, full working stern and a fine bow.
    // The 62 m length / 13 m beam and deck height preserve the prior illustrative envelope.
    const stations = [[-31, 4.9], [-29, 5.95], [-24, 6.45], [-12, 6.5], [2, 6.5], [14, 6.15], [22, 5], [27, 3.35], [30, 1.25], [31, .05]];
    const profile = [[0, -2.8], [.55, -2.45], [.9, -.65], [.985, .25], [1, .72], [1, 2.8], [.97, 5.7], [.95, 6.6], [-.95, 6.6], [-.97, 5.7], [-1, 2.8], [-1, .72], [-.985, .25], [-.9, -.65], [-.55, -2.45]];
    const positions = [], indices = [], groups = [], buckets = [[], [], [], []];
    stations.forEach(([x, width]) => profile.forEach(([fraction, y]) => positions.push(x, y, width * fraction)));
    for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < profile.length; j++) {
      const next = (j + 1) % profile.length, a = i * profile.length + j, b = (i + 1) * profile.length + j;
      const middleY = (profile[j][1] + profile[next][1]) * .5;
      const materialIndex = j === 7 ? 3 : middleY < .25 ? 1 : middleY > 5.7 ? 2 : 0;
      buckets[materialIndex].push(a, b, a - j + next, b, b - j + next, a - j + next);
    }
    // End caps keep the stern closed; the narrow bow cap terminates the loft.
    [0, stations.length - 1].forEach((s, end) => {
      const base = s * profile.length;
      for (let j = 1; j < profile.length - 1; j++) {
        buckets[0].push(base, base + (end ? j + 1 : j), base + (end ? j : j + 1));
      }
    });
    buckets.forEach((bucket, materialIndex) => { groups.push([indices.length, bucket.length, materialIndex]); indices.push(...bucket); });
    const hullGeometry = new T.BufferGeometry(); hullGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); hullGeometry.setIndex(indices);
    groups.forEach(g => hullGeometry.addGroup(...g)); hullGeometry.computeVertexNormals();
    const hull = new T.Mesh(hullGeometry, [navy, red, white, deckMat]); hull.name = 'Curved vessel hull'; ship.add(hull);

    // Deck edge and two-course rails. The recovery opening remains clear on the aft starboard side.
    [-1, 1].forEach(side => {
      const edge = stations.slice(0, -1).map(([x, width]) => vec(x, 6.65, side * width * .94)); edge.push(vec(31, 6.65, 0));
      polyline(edge, white, .14);
      for (const elevation of [7.25, 7.75]) polyline(stations.slice(0, -1).map(([x, width]) => vec(x, elevation, side * width * .93)).concat([vec(30.7, elevation, 0)]), white, .045);
      for (let i = 0; i < stations.length - 1; i++) {
        const [x, width] = stations[i]; strut(vec(x, 6.65, side * width * .93), vec(x, 7.78, side * width * .93), .05, steel);
      }
    });
    // Quiet deck panels, drainage channels and a clear marked receiving area beneath the hoist.
    for (let x = -27; x < 8; x += 3.1) box(.045, .012, 10.4, steel, x, 6.615, 0);
    [-1, 1].forEach(s => box(35, .025, .13, black, -10, 6.64, s * 5.8));
    const landing = new T.Mesh(new T.RingGeometry(1.75, 1.84, 64), yellow); landing.rotation.x = -Math.PI / 2; landing.position.set(-14, 6.645, 3); ship.add(landing);
    for (const s of [-1, 1]) {
      box(4.5, .035, .12, yellow, -14, 6.65, 3 + s * 2.3);
      box(.12, .035, 4.5, yellow, -14 + s * 2.3, 6.65, 3);
    }
    // Bridge terraces and overhung wheelhouse: separate volumes, glazed front and side windows.
    box(14, 3, 10.4, white, 17, 8.1, 0);
    box(14.5, 3.3, 10.7, white, 17.5, 11.2, 0);
    box(15.6, .34, 11.7, white, 17.7, 13.05, 0);
    box(12.5, .16, 10.9, navy, 17.5, 9.65, 0);
    [-1, 1].forEach(s => {
      for (let x = 11.3; x < 24; x += 2.03) box(1.72, 1.28, .065, glass, x, 11.47, s * 5.39);
      for (let x = 12; x <= 22; x += 2.5) box(1.2, .8, .07, glass, x, 8.4, s * 5.25);
      box(.85, 1.8, .12, navy, 10.07, 7.6, s * 3.6);
    });
    for (let z = -4.3; z <= 4.4; z += 1.75) box(.07, 1.36, 1.48, glass, 24.79, 11.48, z);
    // An external stair connects the working deck to the bridge's lower terrace.
    for (let i = 0; i < 9; i++) box(.45, .18, 1.7, deckMat, 7.9 + i * .3, 6.72 + i * .34, -3.7);
    [-4.55, -2.85].forEach(z => strut(vec(7.7, 7.6, z), vec(10.7, 10.6, z), .05, white));

    // Mast, radar platform, antennae, navigation lights and ventilation trunks.
    strut(vec(17.5, 13.2, 0), vec(17.5, 22.3, 0), .22, white);
    box(4.3, .2, 2.6, steel, 17.5, 18.8, 0);
    box(3.8, .24, .38, white, 17.5, 22.25, 0);
    cylinder(.32, .48, white, 17.5, 21.9, 0);
    for (const z of [-2, 2]) strut(vec(17.5, 17.2, 0), vec(17.5, 19.9, z), .075, steel);
    for (const x of [13.4, 20.4]) strut(vec(x, 13.2, 1.5), vec(x, 17, 1.5), .055, white);
    box(2.2, 2.6, 2.3, navy, 12, 14.4, 0);
    for (let i = 0; i < 4; i++) box(.035, .11, 1.8, black, 10.88, 13.65 + i * .36, 0);
    [-1, 1].forEach(s => {
      const light = new T.Mesh(new T.SphereGeometry(.13, 8, 6), new T.MeshBasicMaterial({ color: s > 0 ? 0x71b997 : 0xe76f5c })); light.position.set(21.5, 13.4, s * 5.1); ship.add(light);
    });

    // A compact rescue boat and its launch cradle; these are generic vessel fixtures.
    const rescue = new T.Group(); rescue.position.set(4.2, 8.05, -6.25); ship.add(rescue);
    const rescueHull = new T.Mesh(new T.SphereGeometry(1, 20, 10), orange); rescueHull.scale.set(3.4, .65, 1.15); rescue.add(rescueHull);
    box(3.8, .65, 1.35, white, .35, .58, 0, rescue); box(1.15, .52, 1.1, glass, 1.25, .87, 0, rescue);
    [-1.8, 1.8].forEach(x => strut(vec(x, -.7, -.7), vec(x, -.7, .7), .08, steel, rescue));
    [-1, 1].forEach(s => {
      for (const x of [-28, -24, 25]) { cylinder(.2, .55, steel, x, 6.92, s * (x > 0 ? 3.6 : 4.7)); box(.8, .13, .22, steel, x, 7.15, s * (x > 0 ? 3.6 : 4.7)); }
      for (const x of [-21, -9, 4]) { const fender = cylinder(.3, 1.4, black, x, 4.5, s * 6.5); fender.rotation.x = .09 * s; }
    });
    box(5.5, 1.6, 3.7, white, -25.5, 7.4, -1.1);
    for (let i = 0; i < 3; i++) box(4.9, .045, .06, steel, -25.5, 8.23, -2.3 + i * 1.1);
    const winch = cylinder(.62, 1.55, navy, -21.4, 7.35, -3.9); winch.rotation.x = Math.PI / 2;
    cylinder(.23, .8, steel, -21.4, 6.98, -3.9);

    // Articulated pedestal crane: two fixed-length links reach overboard, then swing
    // over the receiving pad. The replay decides when the manoeuvre takes place.
    const crane = new T.Group(); crane.name = 'Recovery deck crane'; ship.add(crane);
    cylinder(.95, 1.35, yellow, -5, 7.275, 3, crane);
    cylinder(.63, 3.5, yellow, -5, 9.65, 3, crane);
    const shoulder = vec(-5, 10.3, 3), linkLength = 8;
    const boomLinks = [.52, .37].map(radius => strut(vec(0, 0, 0), vec(0, linkLength, 0), radius, yellow, crane));
    const hinges = [0, 1, 2].map(() => cylinder(.48, .92, navy, 0, 0, 0, crane));
    const hydraulics = [0, 1].map(() => ({
      sleeve: strut(vec(0, 0, 0), vec(0, 1, 0), .17, yellow, crane),
      piston: strut(vec(0, 0, 0), vec(0, 1, 0), .09, steel, crane)
    }));
    box(1.8, 1.5, 1.7, navy, -3.8, 8.65, 3, crane);
    // No static cable or automatic wake: the replay integrates the actual transit and hoist.

    const labelCanvas = document.createElement('canvas'); labelCanvas.width = 768; labelCanvas.height = 128;
    const context = labelCanvas.getContext('2d'); context.clearRect(0, 0, 768, 128); context.fillStyle = '#ecf1f1'; context.font = '600 78px Arial, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('RECOVERY', 384, 64);
    const labelTexture = new T.CanvasTexture(labelCanvas); labelTexture.encoding = T.sRGBEncoding;
    [-1, 1].forEach(side => { const label = new T.Mesh(new T.PlaneGeometry(12, 2), new T.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false })); label.position.set(-1, 4.4, side * 6.49); if (side < 0) label.rotation.y = Math.PI; ship.add(label); });
    ship.userData = { illustrative: true, dimensionsMetres: { length: 62, beam: 13, deckHeight: 6.6 },
      craneTip: vec(-14, 19, 10), recoveryPoint: vec(-14, 6.6, 3),
      craneRig: { shoulder, linkLength, boomLinks, hinges, hydraulics, elbow: vec(0, 0, 0), swing: 0 }
    };
    updateCrane(ship, 0);
    return ship;
  }

  function updateCrane(ship, swing = 0) {
    const rig = ship && ship.userData.craneRig;
    if (!rig) return null;
    const f = Math.max(0, Math.min(1, Number.isFinite(swing) ? swing : 0));
    const tip = ship.userData.craneTip; tip.set(-14, 19, 10 - 7 * f);
    const up = rig.shoulder.clone().set(0, 1, 0), delta = tip.clone().sub(rig.shoulder);
    const horizontal = Math.hypot(delta.x, delta.z), distance = delta.length();
    const radial = delta.clone().setY(0).normalize(), axis = radial.clone().cross(up).normalize();
    // Equal 8 m links have sufficient reach throughout the lateral move. Solve the
    // shoulder angle; the elbow-up solution keeps both links above the deck/rail.
    const shoulderAngle = Math.atan2(delta.y, horizontal) + Math.acos(Math.min(1, distance / (2 * rig.linkLength)));
    const elbow = rig.elbow.copy(rig.shoulder).addScaledVector(radial, rig.linkLength * Math.cos(shoulderAngle)).addScaledVector(up, rig.linkLength * Math.sin(shoulderAngle));
    const place = (mesh, a, b) => {
      const direction = b.clone().sub(a), length = direction.length();
      mesh.position.copy(a).add(b).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(up, direction.multiplyScalar(1 / Math.max(length, 1e-8)));
      mesh.scale.y = length / mesh.geometry.parameters.height;
    };
    place(rig.boomLinks[0], rig.shoulder, elbow); place(rig.boomLinks[1], elbow, tip);
    [rig.shoulder, elbow, tip].forEach((point, i) => { rig.hinges[i].position.copy(point); rig.hinges[i].quaternion.setFromUnitVectors(up, axis); });
    const first = elbow.clone().sub(rig.shoulder).normalize(), second = tip.clone().sub(elbow).normalize();
    const mounts = [
      [rig.shoulder.clone().addScaledVector(up, -1.1).addScaledVector(radial, .6), elbow.clone().addScaledVector(first, -.9)],
      [elbow.clone().addScaledVector(first, -2), elbow.clone().addScaledVector(second, 2)]
    ];
    mounts.forEach(([a, b], i) => {
      a.addScaledVector(axis, .55); b.addScaledVector(axis, .55);
      place(rig.hydraulics[i].sleeve, a, a.clone().lerp(b, .66));
      place(rig.hydraulics[i].piston, a.clone().lerp(b, .56), b);
    });
    rig.swing = f;
    return tip;
  }

  function buildOcean(T) {
    const ocean = new T.Group(); ocean.name = 'Illustrative animated ocean';
    const uniforms = T.UniformsUtils.merge([T.UniformsLib.fog, { time: { value: 0 }, waveScale: { value: 1 }, sunDirection: { value: new T.Vector3(-.4, .65, -.64).normalize() } }]);
    const material = new T.ShaderMaterial({ uniforms, fog: true,
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        #include <fog_pars_vertex>
        uniform float time;
        uniform float waveScale;
        uniform vec3 sunDirection;
        varying vec2 vWater;
        varying vec3 vWorld;
        varying vec3 vAxisX;
        varying vec3 vAxisZ;
        varying vec3 vUp;
        varying vec3 vSun;
        void main() {
          vec3 p = position;
          float swell = sin(dot(p.xz, vec2(1.9, 1.1)) + time * .21) * .0022;
          swell += sin(dot(p.xz, vec2(-1.4, 3.0)) - time * .29) * .0012;
          p.y += swell * waveScale - dot(p.xz, p.xz) / 12742.0;
          vWater = p.xz;
          vec4 world = modelMatrix * vec4(p, 1.0); vWorld = world.xyz;
          vAxisX = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
          vAxisZ = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
          vUp = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
          vSun = normalize(mat3(modelMatrix) * sunDirection);
          vec4 mvPosition = viewMatrix * world; gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        #include <fog_pars_fragment>
        uniform float time;
        uniform float waveScale;
        varying vec2 vWater;
        varying vec3 vWorld;
        varying vec3 vAxisX;
        varying vec3 vAxisZ;
        varying vec3 vUp;
        varying vec3 vSun;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 eye = normalize(cameraPosition - vWorld);
          float distanceToEye = length(cameraPosition - vWorld);
          float detail = 1.0 / (1.0 + distanceToEye * .12);
          vec2 q = vWater;
          float a = dot(q, vec2(1.9, 1.1)) + time * .21;
          float b = dot(q, vec2(-1.4, 3.0)) - time * .29;
          float c = dot(q, vec2(23.0, 15.0)) + time * .9;
          float d = dot(q, vec2(-43.0, 27.0)) - time * 1.2;
          vec2 slope = cos(a) * vec2(1.9, 1.1) * .038 + cos(b) * vec2(-1.4, 3.0) * .026;
          slope += (cos(c) * vec2(23.0, 15.0) * .0022 + cos(d) * vec2(-43.0, 27.0) * .0011) * detail;
          slope = slope * waveScale - q / 6371.0;
          vec3 n = normalize(vUp - vAxisX * slope.x - vAxisZ * slope.y);
          float facing = clamp(dot(n, eye), 0.0, 1.0);
          float fresnel = .035 + .965 * pow(1.0 - facing, 4.5);
          float wave = sin(a) * .5 + sin(b) * .3 + sin(c) * .2 * detail;
          vec3 deep = vec3(.018, .095, .135);
          vec3 shallow = vec3(.045, .20, .24);
          vec3 water = mix(deep, shallow, .42 + wave * .18);
          vec3 sky = mix(vec3(.18, .31, .40), vec3(.44, .60, .67), pow(1.0 - facing, 2.0));
          vec3 color = mix(water, sky, fresnel * .76);
          vec3 halfVector = normalize(normalize(vSun) + eye);
          float specular = pow(max(dot(n, halfVector), 0.0), 110.0);
          float broad = pow(max(dot(n, halfVector), 0.0), 18.0);
          color += vec3(.86, .91, .90) * (specular * .72 + broad * .085);
          float foam = smoothstep(.92, 1.04, sin(a) * .52 + sin(b) * .30 + sin(c) * .20);
          foam *= smoothstep(.08, .55, facing) * detail;
          color = mix(color, vec3(.55, .68, .70), foam * .33);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
          #include <fog_fragment>
        }`
    });
    const geometry = new T.PlaneGeometry(360, 360, 160, 160); geometry.rotateX(-Math.PI / 2);
    const surface = new T.Mesh(geometry, material); surface.frustumCulled = false; surface.name = 'Wave surface, kilometres'; ocean.add(surface);
    ocean.userData = { illustrative: true, surface, uniforms, time: 0 };
    return ocean;
  }

  function updateOcean(ocean, missionSeconds, options = {}) {
    if (!ocean || !ocean.userData.uniforms) return;
    const time = Number.isFinite(missionSeconds) ? missionSeconds : 0;
    const speed = Number.isFinite(options.speed) ? options.speed : 1;
    ocean.userData.time = time;
    // A bounded phase keeps sub-second ripples precise even after a multi-day mission.
    ocean.userData.uniforms.time.value = (time * speed) % 4096;
    ocean.userData.uniforms.waveScale.value = Number.isFinite(options.waveScale) ? Math.max(0, options.waveScale) : 1;
  }

  function buildCanopy(T, radius, riser, colorA = '#db6b35', colorB = '#eeeee3', y0 = 0) {
    const root = new T.Group(); root.position.y = y0; root.name = 'Illustrative vented fabric canopy';
    const canopy = new T.Group(), lines = new T.Group(); root.add(canopy, lines);
    const rimTheta = Math.PI * .42, ventTheta = .10, goreCount = 16;
    canopy.position.y = riser - radius * Math.cos(rimTheta);
    const cloth = document.createElement('canvas'); cloth.width = cloth.height = 64; const context = cloth.getContext('2d');
    context.fillStyle = '#ddddcf'; context.fillRect(0, 0, 64, 64); context.strokeStyle = '#ffffff'; context.globalAlpha = .22; context.lineWidth = 1;
    for (let i = 0; i < 64; i += 4) { context.beginPath(); context.moveTo(i, 0); context.lineTo(i, 64); context.moveTo(0, i); context.lineTo(64, i); context.stroke(); }
    const fabric = new T.CanvasTexture(cloth); fabric.wrapS = fabric.wrapT = T.RepeatWrapping; fabric.repeat.set(2, 5);
    const materials = [colorA, colorB].map(color => new T.MeshStandardMaterial({ color, roughness: .95, metalness: 0, bumpMap: fabric, bumpScale: .002, side: T.DoubleSide }));
    const point = (theta, angle, local = 0) => { const billow = 1 + .017 * Math.sin(local * Math.PI) * Math.sin(theta); return new T.Vector3(radius * Math.sin(theta) * Math.cos(angle) * billow, radius * Math.cos(theta), radius * Math.sin(theta) * Math.sin(angle) * billow); };
    const seamPoints = [], suspension = [];
    for (let gore = 0; gore < goreCount; gore++) {
      const vertices = [], uv = [], index = [], rows = 18, columns = 4;
      for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
        const theta = ventTheta + (rimTheta - ventTheta) * row / rows, angle = (gore + col / columns) * Math.PI * 2 / goreCount;
        const p = point(theta, angle, col / columns); vertices.push(p.x, p.y, p.z); uv.push(col / columns, row / rows);
      }
      for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
        if (row === 10 || row === 14) continue; // narrow annular breathing slots, illustrative ringsail treatment
        const a = row * (columns + 1) + col, b = a + columns + 1; index.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(index); geometry.computeVertexNormals();
      canopy.add(new T.Mesh(geometry, materials[gore % 2]));
      const angle = gore * Math.PI * 2 / goreCount;
      for (let j = 0; j < 24; j++) seamPoints.push(point(ventTheta + (rimTheta - ventTheta) * j / 24, angle), point(ventTheta + (rimTheta - ventTheta) * (j + 1) / 24, angle));
      const rim = point(rimTheta, angle); suspension.push(new T.Vector3(0, 0, 0), new T.Vector3(rim.x, riser, rim.z));
    }
    canopy.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(seamPoints), new T.LineBasicMaterial({ color: 0xa5a49a, transparent: true, opacity: .75 })));
    lines.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(suspension), new T.LineBasicMaterial({ color: 0xe0e4df, transparent: true, opacity: .92 })));
    root.userData = { canopy, lines, illustrative: true }; root.visible = false; return root;
  }

  scope.RecoveryVisuals = { buildShip, updateCrane, buildOcean, updateOcean, buildCanopy };
})(window);
