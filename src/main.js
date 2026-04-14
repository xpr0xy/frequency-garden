import * as THREE from 'three';
import { EffectComposer } from 'postprocessing';
import { BloomEffect } from 'postprocessing';
import './style.css';

// === GLOBALS ===
let scene, camera, renderer, composer, particles, particleGeometry;
let analyser, audioContext, source, oscNode, gainNode;
let analyserData, smoothedData;
let isPlaying = false, isFileMode = false;
let currentFileUrl = null;
let animationId;
let vuBars;

// === CONSTANTS ===
const PARTICLE_COUNT = 4000;
const positions = new Float32Array(PARTICLE_COUNT * 3);
const velocities = new Float32Array(PARTICLE_COUNT * 3);
const colors = new Float32Array(PARTICLE_COUNT * 3);
const sizes = new Float32Array(PARTICLE_COUNT);

const state = {
  sensitivity: 1.2,
  decay: 0.92,
  bloom: 1.8,
  bass: 0,
  mid: 0,
  high: 0,
  oscFreq: 220,
  oscWave: 'sine'
};

// === VU METER ===
function updateVUMeter(bass, mid, high) {
  if (!vuBars) return;
  const levels = [bass, bass, mid, mid, mid, high, high, high];
  const rgbs = [
    '127,255,255', '127,255,255', '127,255,255',
    '127,255,255', '127,255,255',
    '255,165,0', '255,165,0',
    '255,68,68'
  ];
  vuBars.forEach((bar, i) => {
    const h = Math.max(4, Math.min(24, levels[i] * 30));
    bar.style.height = h + 'px';
    bar.style.background = `rgba(${rgbs[i]}, ${0.3 + levels[i] * 0.7})`;
  });
}

// === COLOR MATH ===
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r, g, b];
}

// === THREE.JS SETUP ===
function init() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000508, 0.08);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 50;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000508, 1);
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  const bloomEffect = new BloomEffect({
    intensity: state.bloom,
    luminanceThreshold: 0.1,
    luminanceSmoothing: 0.9,
    mipmapBlur: true
  });

  composer = new EffectComposer(renderer);
  composer.addPass(bloomEffect);

  particleGeometry = new THREE.BufferGeometry();
  initParticles();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float uTime;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float dist = length(mvPosition.xyz);
        vAlpha = smoothstep(80.0, 20.0, dist);
        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float alpha = smoothstep(0.5, 0.1, d) * vAlpha;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  window.addEventListener('resize', onResize);
  animate();
}

function initParticles() {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 20 + Math.random() * 30;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    velocities[i * 3] = (Math.random() - 0.5) * 0.02;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;

    const t = Math.random();
    colors[i * 3] = 0.1 + t * 0.4;
    colors[i * 3 + 1] = 0.6 + t * 0.3;
    colors[i * 3 + 2] = 0.9 - t * 0.5;
    sizes[i] = 0.5 + Math.random() * 1.5;
  }
}

// === AUDIO ===
function initAudio() {
  if (audioContext && audioContext.state !== 'closed') return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyserData = new Uint8Array(analyser.frequencyBinCount);
  smoothedData = new Float32Array(analyser.frequencyBinCount).fill(0);

  gainNode = audioContext.createGain();
  gainNode.gain.value = 0.4;
  gainNode.connect(analyser);
  analyser.connect(audioContext.destination);
}

function startOscillator() {
  initAudio();
  if (audioContext.state === 'suspended') audioContext.resume();
  if (oscNode) oscNode.stop();
  oscNode = audioContext.createOscillator();
  oscNode.type = state.oscWave;
  oscNode.frequency.value = state.oscFreq;
  oscNode.connect(gainNode);
  oscNode.start();
  isPlaying = true;
  isFileMode = false;
  updatePlayStateUI(true, false);
}

function loadAudioFile(file) {
  initAudio();
  if (audioContext.state === 'suspended') audioContext.resume();
  if (currentFileUrl) URL.revokeObjectURL(currentFileUrl);
  currentFileUrl = URL.createObjectURL(file);
  if (source) { try { source.stop(); } catch(e){} source.disconnect(); }
  source = audioContext.createBufferSource();
  fetch(currentFileUrl)
    .then(res => res.arrayBuffer())
    .then(buffer => audioContext.decodeAudioData(buffer))
    .then(decoded => {
      source.buffer = decoded;
      source.connect(analyser);
      source.start(0);
      isPlaying = true;
      isFileMode = true;
      updatePlayStateUI(true, true);
    })
    .catch(err => console.error('Audio decode error:', err));
}

function stopAudio() {
  if (oscNode) { oscNode.stop(); oscNode = null; }
  if (source) { try { source.stop(); } catch(e){} source.disconnect(); }
  isPlaying = false;
  updatePlayStateUI(false, isFileMode);
}

function toggleAudio() {
  if (isPlaying) { stopAudio(); return; }
  if (isFileMode && currentFileUrl) {
    loadAudioFile(document.getElementById('audio-file').files[0]);
  } else {
    startOscillator();
  }
}

function updatePlayStateUI(playing, isFile) {
  const playBtn = document.getElementById('play-btn');
  const playIcon = document.getElementById('play-icon');
  const oscGroup = document.getElementById('osc-controls');
  if (playing) {
    playIcon.innerHTML = '&#9646;&#9646;';
    playBtn.style.borderColor = '#7ff';
  } else {
    playIcon.innerHTML = '&#9654;';
    playBtn.style.borderColor = '';
  }
  oscGroup.style.opacity = (playing && !isFile) ? '1' : '0.5';
  oscGroup.style.pointerEvents = (playing && !isFile) ? '' : 'none';
}

// === SLIDER UPDATES ===
function updateOscFreq(val) {
  state.oscFreq = parseFloat(val);
  document.getElementById('osc-freq-label').textContent = Math.round(state.oscFreq) + ' Hz';
  if (oscNode) oscNode.frequency.setTargetAtTime(state.oscFreq, audioContext.currentTime, 0.01);
}

function updateOscWave(wave) {
  state.oscWave = wave;
  if (oscNode) oscNode.type = wave;
  document.querySelectorAll('.wave-btn').forEach(b => b.classList.toggle('active', b.dataset.wave === wave));
}

function updateSensitivity(val) {
  state.sensitivity = parseFloat(val);
  document.getElementById('sensitivity-label').textContent = val;
}

function updateDecay(val) {
  state.decay = parseFloat(val);
  document.getElementById('decay-label').textContent = val;
}

function updateBloom(val) {
  state.bloom = parseFloat(val);
  document.getElementById('bloom-label').textContent = val;
  if (composer && composer.passes[0]) composer.passes[0].intensity = state.bloom;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

// === RENDER LOOP ===
function animate(time) {
  animationId = requestAnimationFrame(animate);

  if (analyser) {
    analyser.getByteFrequencyData(analyserData);
    const binCount = analyser.frequencyBinCount;
    const bassEnd = Math.floor(binCount * 0.1);
    const midEnd = Math.floor(binCount * 0.5);

    let bassSum = 0, midSum = 0, highSum = 0;
    for (let i = 0; i < binCount; i++) {
      const val = analyserData[i] / 255;
      smoothedData[i] = smoothedData[i] * state.decay + val * (1 - state.decay);
      if (i < bassEnd) bassSum += smoothedData[i];
      else if (i < midEnd) midSum += smoothedData[i];
      else highSum += smoothedData[i];
    }
    state.bass = (bassSum / bassEnd) * state.sensitivity;
    state.mid = (midSum / (midEnd - bassEnd)) * state.sensitivity;
    state.high = (highSum / (binCount - midEnd)) * state.sensitivity;
  }

  const posAttr = particleGeometry.attributes.position;
  const colAttr = particleGeometry.attributes.color;
  const sizeAttr = particleGeometry.attributes.size;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    const px = positions[i3], py = positions[i3 + 1], pz = positions[i3 + 2];
    const dx = 50 - px, dy = 50 - py, dz = 50 - pz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    velocities[i3] += (dx / dist) * state.bass * 0.15 + (Math.random() - 0.5) * state.mid * 0.05;
    velocities[i3 + 1] += (dy / dist) * state.bass * 0.15 + (Math.random() - 0.5) * state.high * 0.05;
    velocities[i3 + 2] += (dz / dist) * state.mid * 0.1;

    velocities[i3] *= 0.99;
    velocities[i3 + 1] *= 0.99;
    velocities[i3 + 2] *= 0.99;

    positions[i3] += velocities[i3];
    positions[i3 + 1] += velocities[i3 + 1];
    positions[i3 + 2] += velocities[i3 + 2];

    const sphereDist = Math.sqrt(positions[i3]**2 + positions[i3+1]**2 + positions[i3+2]**2);
    if (sphereDist > 60) {
      const scale = 50 / sphereDist;
      positions[i3] *= scale; positions[i3+1] *= scale; positions[i3+2] *= scale;
      velocities[i3] *= -0.5; velocities[i3+1] *= -0.5; velocities[i3+2] *= -0.5;
    }

    const energy = (state.bass + state.mid + state.high) / 3;
    const hue = 0.52 + energy * 0.35;
    const [r, g, b] = hslToRgb(hue, 0.9, 0.55 + energy * 0.3);
    colAttr.array[i3] = r;
    colAttr.array[i3 + 1] = g;
    colAttr.array[i3 + 2] = b;
    sizeAttr.array[i] = (0.8 + energy * 3) * (0.5 + Math.random() * 0.5);
  }

  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
  sizeAttr.needsUpdate = true;

  particles.rotation.y += 0.001 + state.bass * 0.003;
  particles.rotation.x += 0.0005 + state.mid * 0.002;

  updateVUMeter(state.bass, state.mid, state.high);
  composer.render();
}

// === BOOT ===
vuBars = document.querySelectorAll('.vu-bar');
init();

// === EVENT LISTENERS ===
document.getElementById('play-btn').addEventListener('click', toggleAudio);

document.getElementById('audio-file').addEventListener('change', (e) => {
  if (e.target.files[0]) {
    if (oscNode) { oscNode.stop(); oscNode = null; }
    document.getElementById('file-label').textContent = e.target.files[0].name;
    loadAudioFile(e.target.files[0]);
  }
});

document.getElementById('osc-freq').addEventListener('input', (e) => updateOscFreq(e.target.value));
document.querySelectorAll('.wave-btn').forEach(b => {
  b.addEventListener('click', () => updateOscWave(b.dataset.wave));
});
document.getElementById('sensitivity').addEventListener('input', (e) => updateSensitivity(e.target.value));
document.getElementById('decay').addEventListener('input', (e) => updateDecay(e.target.value));
document.getElementById('bloom').addEventListener('input', (e) => updateBloom(e.target.value));

// Set defaults
updateOscFreq(220);
updateSensitivity(1.2);
updateDecay(0.92);
updateBloom(1.8);
