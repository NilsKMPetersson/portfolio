'use strict';

const audioFileInput = document.getElementById('audio-file');
const startSynthesisButton = document.getElementById('start-synthesis');
const stopSynthesisButton = document.getElementById('stop-synthesis');
const grainSizeControl = document.getElementById('grain-size');
const playbackRateVarianceControl = document.getElementById('playback-rate-variance');
const baseStartTimeControl = document.getElementById('start-time');
const basePlaybackRateControl = document.getElementById('base-playback-rate');
const grainIntervalControl = document.getElementById('grain-interval');
const startTimeVarianceControl = document.getElementById('start-time-variance');
const volumeControl = document.getElementById('volume');
const statusEl = document.getElementById('granny-status');
const waveformCanvas = document.getElementById('waveform');

if (waveformCanvas && startSynthesisButton) {
  const waveformCtx = waveformCanvas.getContext('2d');
  const DEMO_URL = 'GrannySynth/demo.wav';

  let audioContext = null;
  let masterGain = null;
  let audioBuffer = null;
  let demoArrayBuffer = null;
  let usingDemo = true;
  let loadedName = 'built-in demo';
  let peaks = null;
  let isSynthesizing = false;
  let runId = 0;
  let playheadTime = null;
  let rafId = 0;
  let demoPromise = null;
  const activeSources = new Set();

  const controls = [
    grainSizeControl,
    playbackRateVarianceControl,
    baseStartTimeControl,
    basePlaybackRateControl,
    grainIntervalControl,
    startTimeVarianceControl,
    volumeControl,
  ];

  audioFileInput.addEventListener('change', handleAudioFile);
  startSynthesisButton.addEventListener('click', startSynthesis);
  stopSynthesisButton.addEventListener('click', stopSynthesis);
  controls.forEach((control) => control.addEventListener('input', onControlInput));

  window.addEventListener('resize', resizeWaveform);
  resizeWaveform();
  updateReadouts();
  loadDemo();

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function controlSnapshot() {
    return {
      grainSize: parseFloat(grainSizeControl.value),
      playbackRateVariance: parseFloat(playbackRateVarianceControl.value),
      basePlaybackRate: Math.max(0.05, parseFloat(basePlaybackRateControl.value)),
      grainInterval: parseFloat(grainIntervalControl.value) / 1000,
      startTimeVariance: parseFloat(startTimeVarianceControl.value),
      startNorm: parseFloat(baseStartTimeControl.value),
      volume: parseFloat(volumeControl.value),
    };
  }

  function formatSeconds(seconds) {
    return `${seconds.toFixed(2)} s`;
  }

  function updateReadouts() {
    const settings = controlSnapshot();
    document.getElementById('grain-size-readout').textContent = `${Math.round(settings.grainSize * 1000)} ms`;
    document.getElementById('grain-interval-readout').textContent = `${Math.round(settings.grainInterval * 1000)} ms`;
    document.getElementById('base-playback-rate-readout').textContent = settings.basePlaybackRate.toFixed(2);
    document.getElementById('playback-rate-variance-readout').textContent = settings.playbackRateVariance.toFixed(2);
    document.getElementById('start-time-variance-readout').textContent = settings.startTimeVariance.toFixed(2);
    document.getElementById('volume-readout').textContent = `${Math.round(settings.volume * 100)}%`;

    const startReadout = document.getElementById('start-time-readout');
    if (audioBuffer) {
      startReadout.textContent = formatSeconds(settings.startNorm * audioBuffer.duration);
    } else {
      startReadout.textContent = `${Math.round(settings.startNorm * 100)}%`;
    }
  }

  function playingStatus() {
    const settings = controlSnapshot();
    const source = usingDemo ? 'built-in demo' : loadedName;
    const where = audioBuffer ? formatSeconds(settings.startNorm * audioBuffer.duration) : '';
    return `Playing ${source}. Grain ${Math.round(settings.grainSize * 1000)} ms, every ${Math.round(settings.grainInterval * 1000)} ms, rate ${settings.basePlaybackRate.toFixed(2)}, start ${where}.`;
  }

  function onControlInput() {
    updateReadouts();
    applyVolume();
    if (isSynthesizing) setStatus(playingStatus());
  }

  function applyVolume() {
    if (!masterGain || !audioContext) return;
    const now = audioContext.currentTime;
    const volume = parseFloat(volumeControl.value);
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(volume, now + 0.03);
  }

  async function ensureContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
      masterGain = audioContext.createGain();
      masterGain.gain.value = parseFloat(volumeControl.value);
      masterGain.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
  }

  async function decodeBuffer(arrayBuffer) {
    const copy = arrayBuffer.slice(0);
    try {
      const offline = new OfflineAudioContext(1, 1, 44100);
      return await offline.decodeAudioData(copy);
    } catch (unusedError) {
      await ensureContext();
      return audioContext.decodeAudioData(arrayBuffer.slice(0));
    }
  }

  function computePeaks(buffer) {
    const data = buffer.getChannelData(0);
    const buckets = 1024;
    const mins = new Float32Array(buckets);
    const maxs = new Float32Array(buckets);
    const length = data.length;
    for (let bucket = 0; bucket < buckets; bucket += 1) {
      const start = Math.floor((bucket * length) / buckets);
      const end = Math.max(start + 1, Math.floor(((bucket + 1) * length) / buckets));
      let min = 1;
      let max = -1;
      for (let i = start; i < end; i += 1) {
        const sample = data[i];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      mins[bucket] = min;
      maxs[bucket] = max;
    }
    return { mins, maxs, buckets };
  }

  function adoptBuffer(buffer, name, isDemo) {
    audioBuffer = buffer;
    usingDemo = isDemo;
    loadedName = name;
    peaks = computePeaks(buffer);
    playheadTime = null;
    resizeWaveform();
    updateReadouts();
    paint();
  }

  function loadDemo() {
    if (!demoPromise) {
      demoPromise = (async () => {
        const response = await fetch(DEMO_URL);
        if (!response.ok) throw new Error(`Demo sample request failed (${response.status})`);
        demoArrayBuffer = await response.arrayBuffer();
        const buffer = await decodeBuffer(demoArrayBuffer);
        if (usingDemo && !isSynthesizing) {
          adoptBuffer(buffer, 'built-in demo', true);
          setStatus('Built-in demo ready. Press Start Synthesis, or choose a file to replace it.');
        }
        return buffer;
      })().catch((error) => {
        demoPromise = null;
        setStatus('Could not load the built-in demo. Choose an audio file instead.');
        throw error;
      });
    }
    return demoPromise;
  }

  async function handleAudioFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    stopSynthesis();
    setStatus(`Decoding ${file.name}…`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await decodeBuffer(arrayBuffer);
      adoptBuffer(buffer, file.name, false);
      setStatus(`Loaded ${file.name}. Press Start Synthesis.`);
    } catch (error) {
      setStatus('Could not decode that file. Try WAV, MP3, or FLAC.');
    }
  }

  function resizeWaveform() {
    const width = Math.max(280, Math.min(720, Math.floor(waveformCanvas.parentElement.clientWidth)));
    if (waveformCanvas.width !== width || waveformCanvas.height !== 180) {
      waveformCanvas.width = width;
      waveformCanvas.height = 180;
    }
    paint();
  }

  function paint() {
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    waveformCtx.clearRect(0, 0, width, height);
    waveformCtx.fillStyle = '#fff';
    waveformCtx.fillRect(0, 0, width, height);

    if (!peaks) {
      waveformCtx.fillStyle = '#666';
      waveformCtx.font = '14px Poppins, sans-serif';
      waveformCtx.fillText('Loading waveform…', 16, height / 2);
      return;
    }

    waveformCtx.strokeStyle = '#222';
    waveformCtx.lineWidth = 1;
    waveformCtx.beginPath();
    const mid = height / 2;
    for (let x = 0; x < width; x += 1) {
      const bucket = Math.min(peaks.buckets - 1, Math.floor((x / width) * peaks.buckets));
      const y1 = mid - peaks.maxs[bucket] * (height * 0.45);
      const y2 = mid - peaks.mins[bucket] * (height * 0.45);
      waveformCtx.moveTo(x + 0.5, y1);
      waveformCtx.lineTo(x + 0.5, y2);
    }
    waveformCtx.stroke();

    if (playheadTime != null && audioBuffer && audioBuffer.duration > 0) {
      const x = (playheadTime / audioBuffer.duration) * width;
      waveformCtx.beginPath();
      waveformCtx.strokeStyle = '#f44336';
      waveformCtx.lineWidth = 2;
      waveformCtx.moveTo(x, 0);
      waveformCtx.lineTo(x, height);
      waveformCtx.stroke();
    }
  }

  function scheduleGrain(id) {
    if (!isSynthesizing || id !== runId || !audioBuffer) return;

    const settings = controlSnapshot();
    window.setTimeout(() => scheduleGrain(id), Math.max(10, settings.grainInterval * 1000));

    const duration = audioBuffer.duration;
    let start = settings.startNorm * duration;
    start += (Math.random() * 2 - 1) * settings.startTimeVariance * duration;
    start = Math.min(Math.max(0, start), Math.max(0, duration - 0.005));
    const grainDuration = Math.min(settings.grainSize, duration - start);
    if (grainDuration < 0.005) return;

    try {
      const rate = Math.max(
        0.05,
        settings.basePlaybackRate + (Math.random() * 2 - 1) * settings.playbackRateVariance
      );
      const outputDuration = grainDuration / rate;
      const now = audioContext.currentTime + 0.005;
      const steps = 64;
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i += 1) {
        curve[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (steps - 1)));
      }

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.setValueAtTime(rate, now);

      const grainGain = audioContext.createGain();
      grainGain.gain.setValueCurveAtTime(curve, now, outputDuration);

      source.connect(grainGain);
      grainGain.connect(masterGain);
      source.start(now, start, grainDuration);
      source.stop(now + outputDuration + 0.02);
      activeSources.add(source);
      source.onended = () => activeSources.delete(source);

      playheadTime = start;
    } catch (unusedError) {
      /* keep scheduling later grains */
    }
  }

  function animationLoop() {
    paint();
    if (isSynthesizing) rafId = window.requestAnimationFrame(animationLoop);
  }

  async function startSynthesis() {
    if (isSynthesizing) return;
    try {
      await ensureContext();
      if (!audioBuffer) {
        const buffer = await loadDemo();
        if (buffer && !audioBuffer) adoptBuffer(buffer, 'built-in demo', true);
      }
      if (!audioBuffer) {
        setStatus('No audio loaded yet.');
        return;
      }
      applyVolume();
      isSynthesizing = true;
      runId += 1;
      const id = runId;
      setStatus(playingStatus());
      scheduleGrain(id);
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(animationLoop);
    } catch (error) {
      isSynthesizing = false;
      setStatus('Could not start audio. Press Start again after choosing a file.');
    }
  }

  function stopSynthesis() {
    const stopId = runId + 1;
    isSynthesizing = false;
    runId = stopId;
    playheadTime = null;
    window.cancelAnimationFrame(rafId);
    if (masterGain && audioContext) {
      const now = audioContext.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0, now + 0.04);
      window.setTimeout(() => {
        if (runId !== stopId) return;
        activeSources.forEach((source) => {
          try { source.stop(); } catch (unusedError) { /* already stopped */ }
        });
        activeSources.clear();
        if (masterGain && audioContext) {
          masterGain.gain.setValueAtTime(parseFloat(volumeControl.value), audioContext.currentTime);
        }
      }, 50);
    }
    paint();
    if (audioBuffer) {
      const source = usingDemo ? 'built-in demo' : loadedName;
      setStatus(`Stopped. Ready to play ${source}.`);
    }
  }
}
