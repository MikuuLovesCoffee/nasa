import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mesh as topoMesh } from "topojson-client";

const D2R = Math.PI / 180;

export function latLonToVec3(lat, lon, r = 1, out = new THREE.Vector3()) {
  const la = lat * D2R, lo = lon * D2R;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

export function vec3ToLatLon(v) {
  const r = v.length();
  return { lat: Math.asin(v.y / r) / D2R, lon: Math.atan2(-v.z, v.x) / D2R };
}

const earthVert = /* glsl */ `
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

// Desaturated, darkened Blue Marble so fire marks carry the colour.
const earthFrag = /* glsl */ `
  uniform sampler2D uDay; uniform sampler2D uWater;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
  void main() {
    vec3 c = texture2D(uDay, vUv).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float water = texture2D(uWater, vUv).r;
    vec3 land = mix(vec3(l), c, 0.38) * 0.62 + vec3(0.012, 0.016, 0.024);
    vec3 sea = vec3(0.020, 0.032, 0.055) + c * 0.06;
    vec3 col = mix(land, sea, smoothstep(0.4, 0.6, water));
    float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
    col += vec3(0.20, 0.38, 0.75) * rim * 0.55;
    float light = 0.78 + 0.22 * max(dot(vNormal, normalize(vec3(-0.4, 0.5, 1.0))), 0.0);
    gl_FragColor = vec4(col * light, 1.0);
  }`;

const atmoFrag = /* glsl */ `
  varying vec3 vNormal; varying vec3 vView;
  void main() {
    // back faces: -dot is 0 at the outer silhouette and grows toward the planet
    float i = pow(clamp(-dot(vNormal, vView), 0.0, 1.0), 2.4);
    gl_FragColor = vec4(0.30, 0.52, 1.0, 1.0) * i * 1.1;
  }`;
const atmoVert = /* glsl */ `
  varying vec3 vNormal; varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

// Fire / risk points. aV in 0..1 drives colour + size; ramp chosen per layer.
const pointVert = /* glsl */ `
  attribute float aV;
  uniform float uScale; uniform float uSize; uniform float uMin; uniform float uTime; uniform float uTw;
  varying float vV; varying float vFacing; varying float vPulse;
  void main() {
    vV = aV;
    // optional twinkle (labs): each point pulses with its own phase; uTw = 0 keeps the classic look
    float ph = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2831;
    vPulse = 0.5 + 0.5 * sin(uTime * (1.6 + 1.4 * fract(ph * 3.7)) + ph);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * position);
    vFacing = dot(n, normalize(-mv.xyz));
    float s = uSize * (uMin + (1.0 - uMin) * sqrt(aV)) * (1.0 + uTw * 0.5 * (vPulse - 0.5));
    gl_PointSize = max(1.5, s * uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const pointFrag = /* glsl */ `
  uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
  uniform float uOpacity; uniform float uSoft; uniform float uTw;
  varying float vV; varying float vFacing; varying float vPulse;
  vec3 ramp(float t) {
    if (t < 0.33) return mix(uC0, uC1, t / 0.33);
    if (t < 0.66) return mix(uC1, uC2, (t - 0.33) / 0.33);
    return mix(uC2, uC3, (t - 0.66) / 0.34);
  }
  void main() {
    if (vFacing < 0.02) discard;
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float core = 1.0 - smoothstep(uSoft, 1.0, d);
    float edge = smoothstep(0.02, 0.25, vFacing);
    gl_FragColor = vec4(ramp(vV) * (1.0 + uTw * 0.35 * (vPulse - 0.5)), core * uOpacity * edge * (0.35 + 0.65 * vV) * (1.0 - uTw * 0.6 * (1.0 - vPulse)));
  }`;

export const RAMPS = {
  heat: ["#7a1d0b", "#d9471f", "#f59a23", "#ffe39a"],
  risk: ["#c98500", "#e66a2c", "#ff4d5e", "#ff2d6f"], // = forecast classes Moderate..Extreme
  modis: ["#1c3f73", "#2a78d6", "#3987e5", "#9ec5f4"],
  viirs: ["#0d5240", "#199e70", "#2fbf8a", "#a6ecd0"],
  industrial: ["#4a4f5a", "#7d8594", "#a9b0bd", "#d6dbe3"],
  // hidden non-fire heat in "Fires only" view: one hue per kind, kept away from fire oranges
  volcano: ["#8b3fd9", "#a95ff0", "#c084fc", "#ddb8ff"],
  flare: ["#0e8fb0", "#1bb3d6", "#38d1f0", "#a5ecfa"],
  // Labs · trend map: falling (blue) .. rising (orange-red), 0.5 = no change
  trend: ["#2f6fd0", "#a9c8f0", "#f6b07a", "#e8402a"],
};

export class Globe {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x07090d, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    this.camera.position.copy(latLonToVec3(18, 20, 3.3));
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.07, enablePan: false,
      minDistance: 1.25, maxDistance: 6, rotateSpeed: 0.45, zoomSpeed: 0.7,
      autoRotate: true, autoRotateSpeed: 0.35,
    });
    this.layers = {};
    this.listeners = { click: [], hover: [] };
    this._buildScene();
    this._bindEvents();
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _buildScene() {
    const tl = new THREE.TextureLoader();
    const day = tl.load("/textures/earth-blue-marble.jpg");
    const water = tl.load("/textures/earth-water.png");
    day.colorSpace = THREE.SRGBColorSpace;
    day.anisotropy = 8;
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 160, 160),
      new THREE.ShaderMaterial({ uniforms: { uDay: { value: day }, uWater: { value: water } }, vertexShader: earthVert, fragmentShader: earthFrag })
    );
    this.scene.add(this.earth);

    const atmo = this.atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.14, 96, 96),
      new THREE.ShaderMaterial({ vertexShader: atmoVert, fragmentShader: atmoFrag, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
    );
    this.scene.add(atmo);

    // starfield
    const n = 4000, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 30);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x8fa3c7, size: 0.06, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false })));

    // selection: a pin at the exact clicked point (constant size on screen) ...
    this.marker = new THREE.Group();
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    this.marker.add(new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), pinMat));
    this.marker.add(new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), pinMat));
    this.marker.visible = false;
    this.scene.add(this.marker);
    // ... and the outline of the grid square the data comes from (its real size on the ground)
    this.square = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd2a8, transparent: true, opacity: 1, depthWrite: false }));
    this.square.visible = false;
    this.scene.add(this.square);
  }

  async loadBorders(url) {
    const topo = await (await fetch(url)).json();
    const m = topoMesh(topo, topo.objects.countries);
    const pts = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const line of m.coordinates) {
      for (let i = 1; i < line.length; i++) {
        latLonToVec3(line[i - 1][1], line[i - 1][0], 1.0015, a);
        latLonToVec3(line[i][1], line[i][0], 1.0015, b);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.borders = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.16, depthWrite: false }));
    this.scene.add(this.borders);
  }

  /**
   * Replace a point layer.
   * lats/lons/values are typed arrays (values already normalised 0..1).
   */
  setPoints(name, { lats, lons, values, ramp = "heat", size = 0.012, minSize = 0.35, opacity = 0.9, soft = 0.15, blending = THREE.AdditiveBlending, radius = 1.004, twinkle = 0 }) {
    const n = values.length;
    const pos = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      latLonToVec3(lats[i], lons[i], radius, v);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    let layer = this.layers[name];
    if (!layer) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uScale: { value: 1 }, uSize: { value: size }, uMin: { value: minSize }, uOpacity: { value: opacity }, uSoft: { value: soft }, uTime: { value: 0 }, uTw: { value: 0 },
          uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() },
        },
        vertexShader: pointVert, fragmentShader: pointFrag, transparent: true, depthWrite: false, blending,
      });
      layer = new THREE.Points(new THREE.BufferGeometry(), mat);
      layer.frustumCulled = false;
      this.layers[name] = layer;
      this.scene.add(layer);
    }
    const u = layer.material.uniforms;
    u.uSize.value = size; u.uMin.value = minSize; u.uOpacity.value = opacity; u.uSoft.value = soft; u.uTw.value = twinkle;
    layer.material.blending = blending;
    RAMPS[ramp].forEach((hex, i) => u["uC" + i].value.set(hex));
    layer.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aV", new THREE.BufferAttribute(values, 1));
    layer.geometry = g;
    layer.visible = true;
    this._updateScale();
  }

  hideLayer(name) { if (this.layers[name]) this.layers[name].visible = false; }
  hideAll() { Object.values(this.layers).forEach((l) => (l.visible = false)); if (this.dataMesh) this.dataMesh.visible = false; }

  /**
   * Labs: swap the Earth for another body at the same place and size, so picking, dots, outlines and flyTo
   * all keep working ('moon' | 'mars' with an equirectangular texture url), or back to Earth (null).
   */
  setBody(kind, url, { tint = [1, 1, 1], rim = [0, 0, 0] } = {}) {
    const earthParts = [this.earth, this.atmo, this.borders].filter(Boolean);
    this.bodies ??= {};
    Object.values(this.bodies).forEach((b) => (b.visible = false));
    if (!kind) { earthParts.forEach((o) => (o.visible = true)); this.bodyKind = null; return; }
    let b = this.bodies[kind];
    if (!b) {
      const tex = new THREE.TextureLoader().load(url);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      b = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), new THREE.ShaderMaterial({
        uniforms: { uMap: { value: tex }, uTint: { value: new THREE.Color(...tint) }, uRim: { value: new THREE.Color(...rim) } },
        vertexShader: earthVert,
        fragmentShader: `uniform sampler2D uMap; uniform vec3 uTint; uniform vec3 uRim; varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
          void main() {
            vec3 c = texture2D(uMap, vUv).rgb * uTint;
            float light = 0.55 + 0.6 * max(dot(vNormal, normalize(vec3(-0.4, 0.5, 1.0))), 0.0);
            float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
            gl_FragColor = vec4(c * light + uRim * rim * 0.6, 1.0);
          }`,
      }));
      this.scene.add(b);
      this.bodies[kind] = b;
    }
    b.visible = true;
    earthParts.forEach((o) => (o.visible = false));
    this.bodyKind = kind;
  }

  /** Labs: an equirectangular canvas (x = lon −180..180, y = lat 90..−90) draped smoothly over the globe; null hides it. */
  setDataCanvas(canvas, opacity = 1) {
    if (!canvas) { if (this.dataMesh) this.dataMesh.visible = false; return; }
    if (!this.dataMesh) {
      this.dataTex = new THREE.CanvasTexture(canvas);
      this.dataTex.colorSpace = THREE.SRGBColorSpace;
      this.dataTex.anisotropy = 4;
      const mat = new THREE.MeshBasicMaterial({ map: this.dataTex, transparent: true, depthWrite: false, opacity });
      this.dataMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0022, 160, 80), mat);
      this.scene.add(this.dataMesh);
    } else if (this.dataTex.image !== canvas) this.dataTex.image = canvas;
    this.dataTex.needsUpdate = true;
    this.dataMesh.material.opacity = opacity;
    this.dataMesh.visible = true;
  }

  /** Drape a global equirectangular image (e.g. today's smoke from NASA GIBS) over the globe; null removes it. */
  // mode 0: keep reds/oranges (smoke index: yellow = little, red = thick); mode 1: keep warm vs blue (CO: blue = low)
  setOverlayImage(url, mode = 0) {
    if (!url) { if (this.overlay) this.overlay.visible = false; return; }
    if (!this.overlay) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: null }, uMode: { value: 0 } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: `uniform sampler2D uMap; uniform float uMode; varying vec2 vUv;
          void main(){
            vec4 c = texture2D(uMap, vUv);
            float a = uMode < 0.5 ? clamp((c.r - c.g) * 2.2, 0.0, 1.0) : clamp((c.r - c.b) * 1.6, 0.0, 1.0);
            a *= c.a * 0.85;
            if (a < 0.03) discard;
            gl_FragColor = vec4(c.rgb, a);
          }`,
        transparent: true, depthWrite: false,
      });
      this.overlay = new THREE.Mesh(new THREE.SphereGeometry(1.0025, 128, 64), mat);
      this.scene.add(this.overlay);
    }
    this.overlay.material.uniforms.uMode.value = mode;
    if (this._overlayUrl !== url) {
      this._overlayUrl = url;
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(url, (tex) => {
        const u = this.overlay.material.uniforms.uMap;
        if (u.value) u.value.dispose();
        u.value = tex;
      });
    }
    this.overlay.visible = true;
  }

  /** Pin at (lat, lon); optional square = { lat0, lon0, size } (degrees) is outlined too. */
  setMarker(lat, lon, square = null) {
    if (lat == null) { this.marker.visible = false; this.square.visible = false; return; }
    const p = latLonToVec3(lat, lon, 1.007);
    this.marker.position.copy(p);
    this.marker.lookAt(p.clone().multiplyScalar(2));
    this.marker.visible = true;
    this.square.visible = !!square;
    if (!square) return;
    const { lat0, lon0, size } = square, n = 24, pts = [], v = new THREE.Vector3();
    const edge = (fn) => { for (let i = 0; i < n; i++) { const [a, b] = fn(i / n); latLonToVec3(a, b, 1.006, v); pts.push(v.x, v.y, v.z); } };
    edge((t) => [lat0, lon0 + t * size]);
    edge((t) => [lat0 + t * size, lon0 + size]);
    edge((t) => [lat0 + size, lon0 + size - t * size]);
    edge((t) => [lat0 + size - t * size, lon0]);
    this.square.geometry.dispose();
    this.square.geometry = new THREE.BufferGeometry();
    this.square.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  }

  /** Outline an area of interest: rings = [[[lon, lat], ...], ...]; null removes it. */
  setOutline(rings) {
    if (!this.outline) {
      this.outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd2a8, transparent: true, opacity: 0.95, depthWrite: false }));
      this.scene.add(this.outline);
    }
    if (!rings) { this.outline.visible = false; return; }
    const pts = [], a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const [x0, y0] = ring[i - 1], [x1, y1] = ring[i];
        // densify long edges (drawn boxes) so they follow the sphere
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 1.5));
        for (let k = 0; k < n; k++) {
          latLonToVec3(y0 + ((y1 - y0) * k) / n, x0 + ((x1 - x0) * k) / n, 1.0045, a);
          latLonToVec3(y0 + ((y1 - y0) * (k + 1)) / n, x0 + ((x1 - x0) * (k + 1)) / n, 1.0045, b);
          pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.BufferGeometry();
    this.outline.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.outline.visible = true;
  }

  flyTo(lat, lon, dist) {
    const from = this.camera.position.clone();
    const d = dist ?? Math.min(from.length(), 2.6);
    const to = latLonToVec3(lat, lon, d);
    const t0 = performance.now(), dur = 1400;
    this.controls.autoRotate = false;
    this._fly = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const len = from.length() + (d - from.length()) * e;
      this.camera.position.copy(from.clone().normalize().lerp(to.clone().normalize(), e).normalize().multiplyScalar(len));
      if (t >= 1) this._fly = null;
    };
  }

  on(evt, fn) { this.listeners[evt].push(fn); }

  _pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hit = rc.intersectObject(this.earth)[0];
    return hit ? vec3ToLatLon(hit.point) : null;
  }

  _bindEvents() {
    window.addEventListener("resize", () => this.resize());
    let down = null, idleTimer;
    const stopSpin = () => {
      this.controls.autoRotate = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (!this.pinned) this.controls.autoRotate = true; }, 12000);
    };
    this.canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; stopSpin(); });
    this.canvas.addEventListener("wheel", stopSpin, { passive: true });
    this.canvas.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const ll = this._pick(e.clientX, e.clientY);
        this.listeners.click.forEach((fn) => fn(ll, e));
      }
      down = null;
    });
    let raf = 0;
    this.canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch" || down) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ll = this._pick(e.clientX, e.clientY);
        this.listeners.hover.forEach((fn) => fn(ll, e));
      });
    });
    this.canvas.addEventListener("pointerleave", () => this.listeners.hover.forEach((fn) => fn(null)));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep globe comfortably framed on narrow screens
    this.camera.fov = w < 700 ? 58 : 42;
    this.camera.updateProjectionMatrix();
    this._updateScale();
  }

  _updateScale() {
    const h = this.renderer.domElement.height;
    const scale = h / (2 * Math.tan((this.camera.fov * D2R) / 2));
    Object.values(this.layers).forEach((l) => (l.material.uniforms.uScale.value = scale));
  }

  _loop(now) {
    if (this._fly) this._fly(now);
    this.controls.update();
    // slow the spin and soften borders as we zoom in
    const dist = this.camera.position.length();
    this.controls.rotateSpeed = 0.15 + 0.12 * (dist - 1);
    if (this.borders) this.borders.material.opacity = 0.12 + 0.18 * Math.max(0, (3 - dist) / 1.8);
    if (this.marker.visible) this.marker.scale.setScalar(Math.max(dist - 1, 0.02) * 0.0045); // same size on screen at any zoom
    const t = now / 1000;
    for (const l of Object.values(this.layers)) if (l.visible && l.material.uniforms.uTw.value > 0) l.material.uniforms.uTime.value = t;
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);
  }
}
