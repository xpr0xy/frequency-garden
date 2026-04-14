import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';

// ─── GLOBALS ─────────────────────────────────────────────────────────────────
let scene, camera, renderer, particles, geom;
let analyser, audioCtx, oscNode, gainNode, sourceNode;
let animId;
let isPlaying = false, isFileMode = false, currentFileUrl = null;

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PARTICLE_COUNT  = 3500;
const ANALYZER_SIZE  = 256;
const SENSITIVITY_DEFAULT = 8;
const DECAY_DEFAULT   = 0.88;
const BLOOM_DEFAULT   = 1.4;

const state = {
  sensitivity: SENSITIVITY_DEFAULT,
  decay:       DECAY_DEFAULT,
  bloom:       BLOOM_DEFAULT,
  bass: 0, mid: 0, high: 0,
  oscFreq: 220,
  oscWave: 'sine',
  fileName: 'drop audio or click to browse',
};

// ─── COLOR MATH ───────────────────────────────────────────────────────────────
function hslColor(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l - q;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p+(q-p)*6*t;
      if (t < 1/2) return q;
      if (t < 2/3) return p+(q-p)*(2/3-t)*6;
      return p;
    };
    r = hue2rgb(p, q, h+1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h-1/3);
  }
  return [r, g, b];
}

// ─── AUDIO SETUP ─────────────────────────────────────────────────────────────
function initAudioCtx() {
  if (audioCtx && audioCtx.state !== 'closed') {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
  analyser  = audioCtx.createAnalyser();
  analyser.fftSize = ANALYZER_SIZE;
  gainNode  = audioCtx.createGain();
  gainNode.gain.value = 0.5;
  gainNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function startOscillator() {
  initAudioCtx();
  if (oscNode) { try { oscNode.stop(); } catch(e){} }
  oscNode = audioCtx.createOscillator();
  oscNode.type = state.oscWave;
  oscNode.frequency.value = state.oscFreq;
  oscNode.connect(gainNode);
  oscNode.start();
  isPlaying = true;
  isFileMode = false;
  syncUI(true, false);
}

function loadAudioFile(file) {
  initAudioCtx();
  if (currentFileUrl) URL.revokeObjectURL(currentFileUrl);
  currentFileUrl = URL.createObjectURL(file);
  if (sourceNode) { try { sourceNode.stop(); } catch(e){} sourceNode.disconnect(); }
  sourceNode = audioCtx.createBufferSource();
  fetch(currentFileUrl)
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(decoded => {
      sourceNode.buffer = decoded;
      sourceNode.connect(analyser);
      sourceNode.start(0);
      isPlaying = true;
      isFileMode = true;
      state.fileName = file.name;
      document.getElementById('file-label').textContent = state.fileName;
      syncUI(true, true);
    })
    .catch(err => console.error('decode error:', err));
}

function stopAudio() {
  if (oscNode)      { try { oscNode.stop(); } catch(e){} oscNode = null; }
  if (sourceNode)  { try { sourceNode.stop(); } catch(e){} sourceNode.disconnect(); sourceNode = null; }
  isPlaying = false;
  syncUI(false, isFileMode);
}

function toggleAudio() {
  if (isPlaying) { stopAudio(); return; }
  if (isFileMode && currentFileUrl) {
    loadAudioFile(document.getElementById('audio-file').files[0]);
  } else {
    startOscillator();
  }
}

function syncUI(playing, isFile) {
  const btn = document.getElementById('play-btn');
  const icon = document.getElementById('play-icon');
  const osc  = document.getElementById('osc-controls');
  icon.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
  btn.style.borderColor = playing ? '#7ff' : '';
  osc.style.opacity    = (playing && !isFile) ? '1' : '0.4';
  osc.style.pointerEvents = (playing && !isFile) ? '' : 'none';
}

// ─── THREE.JS SCENE ───────────────────────────────────────────────────────────
// Orbital physics arrays - each particle has stable orbit that it NEVER leaves
const positions      = new Float32Array(PARTICLE_COUNT * 3);  // current display position
const pColors       = new Float32Array(PARTICLE_COUNT * 3);
const pSizes        = new Float32Array(PARTICLE_COUNT);

// Per-particle orbital data (stored separately, never gets pulled to center)
const restRadii     = new Float32Array(PARTICLE_COUNT);       // stable orbital radius
const restAngles    = new Float32Array(PARTICLE_COUNT);       // base angle in orbital plane
const restHeights   = new Float32Array(PARTICLE_COUNT);        // base height offset
const angularSpeeds = new Float32Array(PARTICLE_COUNT);       // base angular speed

// Dynamic offsets driven by audio (spring back to 0 each frame)
const radiusOffsets = new Float32Array(PARTICLE_COUNT);       // bass-driven radius delta
const heightOffsets = new Float32Array(PARTICLE_COUNT);       // high-driven vertical delta

function initParticles() {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    
    // Stable orbital parameters - each particle has its own orbit
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2*Math.random() - 1);
    const r     = 18 + Math.random() * 35;
    
    restRadii[i]     = r;
    restAngles[i]    = theta;
    restHeights[i]   = r * Math.cos(phi);
    angularSpeeds[i] = 0.003 + Math.random() * 0.008;
    
    // Initialize dynamic offsets to 0 (rest state)
    radiusOffsets[i] = 0;
    heightOffsets[i] = 0;
    
    // Set initial display positions using spherical coords
    positions[i3]   = r*Math.sin(phi)*Math.cos(theta);
    positions[i3+1] = r*Math.sin(phi)*Math.sin(theta);
    positions[i3+2] = r*Math.cos(phi);
    
    // Subtle idle glow - always visible
    const t = Math.random();
    pColors[i3]   = 0.05 + t*0.15;
    pColors[i3+1] = 0.50 + t*0.35;
    pColors[i3+2] = 0.80 + t*0.18;
    pSizes[i] = 0.8 + Math.random() * 1.8;
  }
}

function init() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000812, 0.055);

  camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 2000);
  camera.position.set(0, 0, 55);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000812, 1);
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enableZoom    = true;
  controls.minDistance   = 20;
  controls.maxDistance   = 150;
  controls.autoRotate    = true;
  controls.autoRotateSpeed = 0.4;

  geom = new THREE.BufferGeometry();
  initParticles();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(pColors, 3));
  geom.setAttribute('size',     new THREE.BufferAttribute(pSizes, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        vCol = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = -mv.z;
        vAlpha = smoothstep(180.0, 20.0, d);
        gl_PointSize = clamp(size * (350.0 / d), 1.0, 20.0);
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vCol;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * vAlpha;
        gl_FragColor = vec4(vCol * 1.8, a);
      }
    `,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });

  particles = new THREE.Points(geom, mat);
  scene.add(particles);

  if (!analyser) {
    analyser = { _stub: true };
    state.bass = state.mid = state.high = 0.015;
  }

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  animate(0, controls);
}

function getAudioBands() {
  if (!analyser || analyser._stub) return;
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buf);
  const bins = analyser.frequencyBinCount;
  const bassEnd = Math.floor(bins * 0.12);
  const midEnd  = Math.floor(bins * 0.55);
  let bs = 0, ms = 0, hs = 0;
  for (let i = 0; i < bins; i++) {
    const v = buf[i] / 255;
    if      (i < bassEnd) bs += v;
    else if (i < midEnd)  ms += v;
    else                  hs += v;
  }
  const bassNorm = (bs/bassEnd) * state.sensitivity;
  const midNorm  = (ms/(midEnd-bassEnd)) * state.sensitivity;
  const highNorm = (hs/(bins-midEnd)) * state.sensitivity;
  state.bass = state.bass * state.decay + bassNorm * (1-state.decay);
  state.mid  = state.mid  * state.decay + midNorm  * (1-state.decay);
  state.high = state.high * state.decay + highNorm * (1-state.decay);
}

function animate(time, controls) {
  animId = requestAnimationFrame(t => animate(t, controls));

  getAudioBands();

  const posAttr  = geom.attributes.position;
  const colAttr  = geom.attributes.color;
  const sizeAttr = geom.attributes.size;

  const energy = (state.bass + state.mid + state.high) / 3;
  const hue    = 0.50 + energy * 0.40;

  // Physics constants
  const springK      = 0.08;  // spring constant back to rest state
  const radiusPushMax = 15;    // max bass-driven radius expansion
  const vertWobbleMax = 8;     // max high-driven vertical oscillation

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    
    // ── ORBITAL PHYSICS MODEL ──────────────────────────────────────────────
    // Each particle orbits at its own stable radius. Bass PUSHES outward,
    // mid INCREASES angular speed, high ADDS vertical wobble.
    // NO spring force toward center - particles NEVER leave their orbits.
    
    // 1. Update dynamic offsets based on audio
    //    Bass expands orbital radius (outward push from center)
    const bassDelta = state.bass * radiusPushMax;
    //    High adds vertical oscillation
    const highDelta = state.high * vertWobbleMax;
    
    // 2. Apply audio forces as delta offsets (additive, not replacements)
    radiusOffsets[i] += bassDelta * 0.3;
    heightOffsets[i] += highDelta * Math.sin(time * 0.005 + restAngles[i]) * 0.3;
    
    // 3. Spring dynamic offsets back toward 0 (decay back to rest state)
    radiusOffsets[i] *= (1 - springK);
    heightOffsets[i] *= (1 - springK * 0.5);
    
    // 4. Calculate current orbital parameters
    const currentRadius = restRadii[i] + radiusOffsets[i];
    const currentHeight = restHeights[i] + heightOffsets[i];
    
    // 5. Update angle - mid energy increases angular speed
    const angularSpeed = angularSpeeds[i] * (1 + state.mid * 3);
    restAngles[i] += angularSpeed;
    
    // 6. Convert orbital coords to Cartesian for display position
    //    Using spherical coords: radius + angle in XZ plane, height for Y
    const x = currentRadius * Math.cos(restAngles[i]);
    const z = currentRadius * Math.sin(restAngles[i]);
    const y = currentHeight;
    
    posAttr.array[i3]   = x;
    posAttr.array[i3+1] = y;
    posAttr.array[i3+2] = z;

    // ── COLOR & SIZE ───────────────────────────────────────────────────────
    const [r, g, b] = hslColor(hue, 0.88, 0.52 + energy*0.38);
    colAttr.array[i3]   = r;
    colAttr.array[i3+1] = g;
    colAttr.array[i3+2] = b;
    sizeAttr.array[i] = (0.7 + energy*4.5) * (0.7 + Math.random()*0.6);
  }

  posAttr.needsUpdate  = true;
  colAttr.needsUpdate  = true;
  sizeAttr.needsUpdate = true;

  const bars = document.querySelectorAll('.vu-bar');
  const levels = [state.bass, state.bass, state.mid, state.mid, state.mid, state.high, state.high, state.high];
  const rgbs   = ['127,255,255','127,255,255','127,255,255','127,255,255','127,255,255','255,165,0','255,165,0','255,68,68'];
  bars.forEach((b, i) => {
    const h = Math.max(3, Math.min(24, levels[i]*28));
    b.style.height     = h+'px';
    b.style.background = `rgba(${rgbs[i]}, ${0.25 + levels[i]*0.75})`;
  });

  controls.update();
  renderer.render(scene, camera);
}

// ─── BOOT & EVENTS ───────────────────────────────────────────────────────────
document.getElementById('play-btn').addEventListener('click', toggleAudio);

document.getElementById('audio-file').addEventListener('change', e => {
  if (e.target.files[0]) {
    if (oscNode) { try { oscNode.stop(); oscNode = null; } catch(e){} }
    loadAudioFile(e.target.files[0]);
  }
});

document.getElementById('osc-freq').addEventListener('input', e => {
  state.oscFreq = parseFloat(e.target.value);
  document.getElementById('osc-freq-label').textContent = Math.round(state.oscFreq)+' Hz';
  if (oscNode) oscNode.frequency.setTargetAtTime(state.oscFreq, audioCtx.currentTime, 0.01);
});

document.querySelectorAll('.wave-btn').forEach(b => {
  b.addEventListener('click', () => {
    state.oscWave = b.dataset.wave;
    document.querySelectorAll('.wave-btn').forEach(x => x.classList.toggle('active', x===b));
    if (oscNode) oscNode.type = state.oscWave;
  });
});

document.getElementById('sensitivity').addEventListener('input', e => {
  state.sensitivity = parseFloat(e.target.value);
  document.getElementById('sensitivity-label').textContent = e.target.value;
});

document.getElementById('decay').addEventListener('input', e => {
  state.decay = parseFloat(e.target.value);
  document.getElementById('decay-label').textContent = e.target.value;
});

document.getElementById('bloom').addEventListener('input', e => {
  state.bloom = parseFloat(e.target.value);
  document.getElementById('bloom-label').textContent = e.target.value;
});

document.getElementById('osc-freq-label').textContent  = '220 Hz';
document.getElementById('sensitivity-label').textContent = SENSITIVITY_DEFAULT;
document.getElementById('decay-label').textContent      = DECAY_DEFAULT;
document.getElementById('bloom-label').textContent       = BLOOM_DEFAULT;

init();
