// ═══════════════════════════════════════════════════
// FREQUENCY GARDEN — Audio Reactive Particle Field
// ═══════════════════════════════════════════════════

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// State
let audioCtx = null;
let analyser = null;
let freqData = null;
let source = null;
let isPlaying = false;
let oscNode = null;
let fileSource = null;
let analyserNode = null;

// Garden particles
const particles = [];
const MAX_PARTICLES = 1200;

// Tweakables
const sensitivity = { value: 1.8 };
const decayRate = { value: 0.965 };
const bloomAmount = { value: 0.4 };

// Colors
const PALETTE = [
  { r: 0, g: 229, b: 255 },   // cyan
  { r: 0, g: 255, b: 136 },   // green
  { r: 255, g: 107, b: 53 },   // orange
  { r: 0, g: 180, b: 220 },   // sky
  { r: 120, g: 220, b: 180 }, // mint
];

// ─── Canvas ────────────────────────────────────────
let W, H;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(dpr, dpr);
}
resize();
window.addEventListener('resize', resize);

// ─── Particle System ────────────────────────────────
class Particle {
  constructor(x, y, type, intensity) {
    this.x = x;
    this.y = y;
    this.type = type; // 'bass' | 'mid' | 'high'
    this.intensity = intensity;
    this.age = 0;
    this.maxAge = this._maxAge();
    this.color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    this.alpha = 0;
    this.scale = 0;
    this.vx = (Math.random() - 0.5) * this._speed();
    this.vy = (Math.random() - 0.5) * this._speed() - this._drift();
    this.angle = Math.random() * Math.PI * 2;
    this.angleSpeed = (Math.random() - 0.5) * 0.04;
    this.rot = 0;
    this.growing = true;
    this.shape = Math.floor(Math.random() * 3); // 0=circle, 1=petal, 2=hex
    this.ring = false;
    this.ringRadius = 0;
  }

  _speed() {
    if (this.type === 'bass') return 0.3;
    if (this.type === 'mid') return 0.8;
    return 2.5;
  }

  _maxAge() {
    if (this.type === 'bass') return 180 + Math.random() * 120;
    if (this.type === 'mid') return 90 + Math.random() * 60;
    return 40 + Math.random() * 30;
  }

  _drift() {
    if (this.type === 'bass') return 0.15;
    if (this.type === 'mid') return 0.3;
    return 0.5;
  }

  _size() {
    const base = this.type === 'bass' ? 14 : this.type === 'mid' ? 7 : 3;
    return base * (0.5 + this.intensity * 0.8);
  }

  update() {
    this.age++;
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.003; // gentle gravity
    this.vx *= 0.998;
    this.vy *= 0.998;
    this.angle += this.angleSpeed;
    this.rot += this.angleSpeed * 0.3;

    if (this.growing) {
      this.scale = Math.min(this.scale + 0.08, 1);
      this.alpha = Math.min(this.alpha + 0.06, this.intensity * 0.85);
      if (this.scale >= 1) this.growing = false;
    } else {
      this.alpha *= decayRate.value;
    }

    // Bloom ring for bass
    if (this.type === 'bass' && this.intensity > 0.5 && !this.ring) {
      if (Math.random() < 0.01) {
        this.ring = true;
        this.ringRadius = 0;
      }
    }
    if (this.ring) {
      this.ringRadius += 1.5;
      if (this.ringRadius > this._size() * 4) this.ring = false;
    }
  }

  draw() {
    if (this.alpha < 0.01) return;
    const size = this._size() * this.scale;
    const { r, g, b } = this.color;
    const a = this.alpha;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.globalAlpha = a;

    if (this.ring) {
      ctx.strokeStyle = `rgba(${r},${g},${b},${a * 0.3})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, this.ringRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Glow
    if (bloomAmount.value > 0) {
      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, size * (1 + bloomAmount.value));
      grd.addColorStop(0, `rgba(${r},${g},${b},${a * 0.4 * bloomAmount.value})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, size * (1 + bloomAmount.value * 2), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;

    if (this.shape === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.shape === 1) {
      // Petal
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.4, size, i * Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Hex
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a2 = i * Math.PI / 3;
        i === 0 ? ctx.moveTo(Math.cos(a2)*size, Math.sin(a2)*size)
                : ctx.lineTo(Math.cos(a2)*size, Math.sin(a2)*size);
      }
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  isDead() {
    return this.alpha < 0.008 || this.age > this.maxAge || this.y > H + 50 || this.x < -50 || this.x > W + 50;
  }
}

// ─── Spawn Particles from FFT ───────────────────────
let lastSpawnTime = 0;

function spawnFromFFT(timestamp) {
  if (!analyser || !isPlaying) return;
  if (timestamp - lastSpawnTime < 16) return; // ~60fps spawn
  lastSpawnTime = timestamp;

  analyser.getByteFrequencyData(freqData);
  const len = freqData.length;
  const nyquist = audioCtx ? audioCtx.sampleRate / 2 : 22050;
  const binSize = nyquist / len;

  // Partition: bass < 200Hz, mid 200-2000Hz, high > 2000Hz
  let bassSum = 0, bassCount = 0;
  let midSum = 0, midCount = 0;
  let highSum = 0, highCount = 0;

  for (let i = 0; i < len; i++) {
    const freq = i * binSize;
    const v = freqData[i] / 255;
    if (freq < 200) { bassSum += v; bassCount++; }
    else if (freq < 2000) { midSum += v; midCount++; }
    else { highSum += v; highCount++; }
  }

  const bassAvg = bassCount ? bassSum / bassCount : 0;
  const midAvg = midCount ? midSum / midCount : 0;
  const highAvg = highCount ? highSum / highCount : 0;

  // Spawn based on intensity
  const spawnCount = Math.floor(1 + bassAvg * 3 + midAvg * 2 + highAvg * 4);
  for (let i = 0; i < spawnCount && particles.length < MAX_PARTICLES; i++) {
    const cx = W / 2 + (Math.random() - 0.5) * W * 0.6;
    const cy = H / 2 + (Math.random() - 0.5) * H * 0.4;
    const r = Math.random();
    let type, avg, intensity;
    if (bassAvg > 0.1 && r < 0.15 + bassAvg * 0.3) {
      type = 'bass'; avg = bassAvg; intensity = bassAvg * sensitivity.value;
    } else if (midAvg > 0.08 && r < 0.5) {
      type = 'mid'; avg = midAvg; intensity = midAvg * sensitivity.value;
    } else {
      type = 'high'; avg = highAvg; intensity = highAvg * sensitivity.value;
    }
    if (intensity > 0.05) {
      particles.push(new Particle(cx, cy, type, Math.min(intensity, 1)));
    }
  }

  // Update BPM estimate
  updateBPM(bassAvg);
}

// ─── BPM Detection ─────────────────────────────────
let lastBassTime = 0;
let bassIntervals = [];

function updateBPM(intensity) {
  const now = performance.now();
  if (intensity > 0.5) {
    if (now - lastBassTime > 200) {
      bassIntervals.push(now - lastBassTime);
      if (bassIntervals.length > 8) bassIntervals.shift();
      lastBassTime = now;
    }
  }
  if (bassIntervals.length >= 4) {
    const avgInterval = bassIntervals.reduce((a,b)=>a+b,0) / bassIntervals.length;
    const bpm = Math.round(60000 / avgInterval);
    if (bpm > 60 && bpm < 200) {
      document.getElementById('bpm').textContent = bpm + ' bpm';
    }
  }
}

// ─── Render Loop ────────────────────────────────────
let frameCount = 0;

function draw(timestamp) {
  requestAnimationFrame(draw);

  frameCount++;

  // Background fade
  ctx.fillStyle = 'rgba(6, 8, 16, 0.18)';
  ctx.fillRect(0, 0, W, H);

  // Grid lines (very subtle)
  if (frameCount % 60 === 0 && particles.length < 50) {
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.03)';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x < W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  spawnFromFFT(timestamp);

  // Update and draw particles
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw();
    if (particles[i].isDead()) particles.splice(i, 1);
  }

  // Center glow when playing
  if (isPlaying) {
    const grd = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.min(W, H) * 0.35);
    grd.addColorStop(0, 'rgba(0, 229, 255, 0.03)');
    grd.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
  }
}

requestAnimationFrame(draw);

// ─── Audio Setup ───────────────────────────────────
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    analyserNode = analyser;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function stopAll() {
  if (oscNode) { try { oscNode.stop(); } catch(e){} oscNode = null; }
  if (fileSource) { try { fileSource.stop(); } catch(e){} fileSource = null; }
  if (source) { source.disconnect(); source = null; }
  isPlaying = false;
  document.getElementById('status').textContent = 'idle';
  document.getElementById('mode').textContent = 'stopped';
  document.getElementById('bpm').textContent = '-- bpm';
  bassIntervals = [];
}

// ─── Buttons ───────────────────────────────────────
const btnMic = document.getElementById('btn-mic');
const btnFile = document.getElementById('btn-file');
const btnOsc = document.getElementById('btn-osc');
const btnStop = document.getElementById('btn-stop');
const fileInput = document.getElementById('file-input');

let micStream = null;

btnMic.addEventListener('click', async () => {
  if (isPlaying && source && source.mediaStream) {
    // Toggle off
    stopAll();
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    btnMic.classList.remove('active');
    return;
  }

  try {
    stopAll();
    const ctx2 = getAudioContext();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    source = ctx2.createMediaStreamSource(micStream);
    source.connect(analyser);
    isPlaying = true;
    btnMic.classList.add('active');
    document.getElementById('status').textContent = 'live';
    document.getElementById('mode').textContent = 'mic';
  } catch(e) {
    document.getElementById('status').textContent = 'denied';
    console.error(e);
  }
});

btnFile.addEventListener('click', () => {
  if (isPlaying) { stopAll(); btnFile.classList.remove('active'); }
  else fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    stopAll();
    const ctx2 = getAudioContext();
    const buf = await file.arrayBuffer();
    const audioBuffer = await ctx2.decodeAudioData(buf);
    const bufSource = ctx2.createBufferSource();
    bufSource.buffer = audioBuffer;
    bufSource.connect(analyser);
    bufSource.start();
    fileSource = bufSource;
    isPlaying = true;
    btnFile.classList.add('active');
    document.getElementById('status').textContent = 'playing';
    document.getElementById('mode').textContent = file.name.slice(0, 18);
    bufSource.onended = () => { stopAll(); btnFile.classList.remove('active'); };
  } catch(e) {
    document.getElementById('status').textContent = 'error';
    console.error(e);
  }
});

btnOsc.addEventListener('click', () => {
  if (isPlaying) { stopAll(); btnOsc.classList.remove('active'); return; }
  stopAll();
  const ctx2 = getAudioContext();
  const osc = ctx2.createOscillator();
  const lfo = ctx2.createOscillator();
  const lfoGain = ctx2.createGain();
  const oscGain = ctx2.createGain();

  osc.type = 'sawtooth';
  osc.frequency.value = 110;

  lfo.type = 'sine';
  lfo.frequency.value = 0.8;
  lfoGain.gain.value = 0.7;

  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  osc.connect(oscGain);
  oscGain.connect(analyser);
  oscGain.gain.value = 0.5;

  osc.start();
  lfo.start();

  oscNode = osc;
  isPlaying = true;
  btnOsc.classList.add('active');
  document.getElementById('status').textContent = 'live';
  document.getElementById('mode').textContent = 'oscillator';
});

btnStop.addEventListener('click', () => {
  stopAll();
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  [btnMic, btnFile, btnOsc].forEach(b => b.classList.remove('active'));
});

btnStop.disabled = false;

// ─── Sliders ───────────────────────────────────────
document.getElementById('sensitivity').addEventListener('input', e => {
  sensitivity.value = parseFloat(e.target.value);
});

document.getElementById('decay').addEventListener('input', e => {
  decayRate.value = parseFloat(e.target.value);
});

document.getElementById('bloom').addEventListener('input', e => {
  bloomAmount.value = parseFloat(e.target.value);
});

// ─── Clear ─────────────────────────────────────────
document.getElementById('btn-clear').addEventListener('click', () => {
  particles.length = 0;
  bassIntervals = [];
  document.getElementById('bpm').textContent = '-- bpm';
});

// ─── Info ──────────────────────────────────────────
const infoOverlay = document.getElementById('info-overlay');
document.getElementById('btn-info').addEventListener('click', () => {
  infoOverlay.classList.remove('hidden');
});

infoOverlay.addEventListener('click', (e) => {
  if (e.target === infoOverlay) infoOverlay.classList.add('hidden');
});

document.addEventListener('keydown', (e) => {
  infoOverlay.classList.add('hidden');
});

// ─── Keyboard shortcuts ────────────────────────────
// m = mic, o = osc, s = stop, f = file
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'm' || e.key === 'M') btnMic.click();
  if (e.key === 'o' || e.key === 'O') btnOsc.click();
  if (e.key === 's' || e.key === 'S') btnStop.click();
  if (e.key === 'f' || e.key === 'F') btnFile.click();
  if (e.key === 'c' || e.key === 'C') particles.length = 0;
});

// Initial state
document.getElementById('status').textContent = 'ready';
document.getElementById('mode').textContent = 'waiting';

// Draw initial seed particles for visual interest
for (let i = 0; i < 8; i++) {
  const p = new Particle(
    W/2 + (Math.random()-0.5)*W*0.5,
    H/2 + (Math.random()-0.5)*H*0.3,
    ['bass','mid','high'][Math.floor(Math.random()*3)],
    0.15
  );
  p.alpha = 0.3;
  p.scale = 0.5;
  particles.push(p);
}
