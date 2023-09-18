const audioFileInput = document.getElementById('audio-file');
const startSynthesisButton = document.getElementById('start-synthesis');
const stopSynthesisButton = document.getElementById('stop-synthesis');
const grainSizeControl = document.getElementById('grain-size');
const playbackRateVarianceControl = document.getElementById('playback-rate-variance');
const baseStartTimeControl = document.getElementById('start-time');
const basePlaybackRateControl = document.getElementById('base-playback-rate');
const grainIntervalControl = document.getElementById('grain-interval');
const startTimeVarianceControl = document.getElementById('start-time-variance');

let audioContext;
let audioBuffer = null;
let grainSize = 1;
let playbackRateVariance = 0;
let grainInterval = 0.05;
let baseStartTime = 0;
let isSynthesizing = false;
let basePlaybackRate = 1;
let startTimeVariance = 0;

audioFileInput.addEventListener('change', handleAudioFile);
startSynthesisButton.addEventListener('click', startSynthesis);
stopSynthesisButton.addEventListener('click', stopSynthesis);
grainSizeControl.addEventListener('input', updateGrainSize);
playbackRateVarianceControl.addEventListener('input', updateplaybackRateVariance);
baseStartTimeControl.addEventListener('input', updateBaseStartTime);
basePlaybackRateControl.addEventListener('input', updateBasePlaybackRate);
grainIntervalControl.addEventListener('input', updateGrainInterval);
startTimeVarianceControl.addEventListener('input', updateStartTimeVariance);


async function handleAudioFile(event) {
    const file = event.target.files[0];
    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Draw the waveform once the audioBuffer is loaded
    drawWaveform();
}

document.getElementById('startAudioContext').addEventListener('click', () => {
        audioContext = new AudioContext();
        gainNode = audioContext.createGain();
        gainNode.gain.value = 0.2;  // 50% volume
        gainNode.connect(audioContext.destination);

        document.getElementById('startAudioContext').disabled = true;
    });


function startSynthesis() {
    if (!audioBuffer) {
        alert('Please select an audio file first.');
        return;
    }
    isSynthesizing = true;
    granularSynthesis();
}

function stopSynthesis() {
    isSynthesizing = false;
}

function updateGrainSize(event) {
    grainSize = parseFloat(event.target.value);
}

function updateplaybackRateVariance(event) {
    playbackRateVariance = parseFloat(event.target.value);
}

function updateBasePlaybackRate(event) {
    basePlaybackRate = parseFloat(event.target.value);
}

function updateBaseStartTime(event) {
    baseStartTime = parseFloat(event.target.value) * audioBuffer.duration;
}

function updateGrainInterval(event) {
    grainInterval = parseFloat(event.target.value) / 1000;
}

function updateStartTimeVariance(event) {
    startTimeVariance = parseFloat(event.target.value);
}


function granularSynthesis() {
    if (!isSynthesizing) {
        return;
    }

    const grainSource = audioContext.createBufferSource();
    grainSource.buffer = audioBuffer;
    grainSource.connect(gainNode);


    playbackRate = basePlaybackRate + (Math.random() * 2 - 1) * playbackRateVariance;

    if (playbackRate < 0)
        playbackRate = 0;

    startTime = baseStartTime + (Math.random() * 2 - 1) * startTimeVariance * audioBuffer.duration;

    if (startTime < 0){
        startTime = 0;
    }
    if (startTime + grainSize > audioContext.duration){
        //TBD: make grainSize smaller..? 
        startTime = audioContext.duration - grainSize;
    }

    grainSource.playbackRate.setValueAtTime(playbackRate, audioContext.currentTime);
    // grainSource.connect(audioContext.destination);

    grainSource.start(audioContext.currentTime, startTime, grainSize);
    grainSource.stop(audioContext.currentTime + grainSize);

    setTimeout(granularSynthesis, grainInterval * 1000);

    updatePlayhead(startTime);
    emitParticle(playbackRate)
}

//waveform visualizer: 
const waveformCanvas = document.getElementById('waveform');
const waveformCtx = waveformCanvas.getContext('2d');

function drawWaveform() {
    console.log('drawWaveForm')
    if (!audioBuffer) {
        console.log('ERROR: drawWaveForm() !audioBuffer')
        return;
    }

    const bufferLength = audioBuffer.length;
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    const data = new Float32Array(bufferLength);

    audioBuffer.copyFromChannel(data, 0);

    waveformCtx.clearRect(0, 0, width, height);
    waveformCtx.strokeStyle = 'black';
    waveformCtx.lineWidth = 2;
    waveformCtx.beginPath();

    const sliceWidth = width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = data[i] * (height / 2);
        const y = (height / 2) - v;

        if (i === 0) {
            waveformCtx.moveTo(x, y);
        } else {
            waveformCtx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    waveformCtx.stroke();
}

function drawPlayhead(position) {
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;

    waveformCtx.beginPath();
    waveformCtx.strokeStyle = 'red';
    waveformCtx.lineWidth = 2;
    waveformCtx.moveTo(position, 0);
    waveformCtx.lineTo(position, height);
    waveformCtx.stroke();
}

function updatePlayhead(startTime) {
    if (!isSynthesizing || !audioBuffer) return;
    const position = startTime / audioBuffer.duration * waveformCanvas.width;
    drawWaveform(); // Redraw waveform to clear the previous playhead position
    drawPlayhead(position);
}












//Particle emitter: 

class Particle {
    constructor(x, y, color, playbackRate) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.opacity = .8;
        this.size = 25 / playbackRate;
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = (Math.random() - 0.5) * 2;
        this.gravity = 0.05;
        this.bounceFactor = 0.9;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
        ctx.restore();
    }

    update(dt) {
        this.opacity -= (1 * dt)/(grainSize);
        this.vy += this.gravity;
        this.x += this.vx;
        this.y += this.vy;

        // Bounce on edges
        if (this.x + this.size > canvas.width || this.x - this.size < 0) {
            this.vx = -this.vx * this.bounceFactor;
        }
        if (this.y + this.size > canvas.height || this.y - this.size < 0) {
            this.vy = -this.vy * this.bounceFactor;
        }
    }
}

const canvas = document.getElementById('particleCanvas');
const ctx = canvas.getContext('2d');
const particles = [];
let lastTime = 0;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function randomColor() {
    return `rgb(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255})`;
}

function emitParticle(playbackRate) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const color = randomColor();
    const particle = new Particle(x, y, color, playbackRate);
    particles.push(particle);
}

function animate(time) {
    requestAnimationFrame(animate);
    const dt = (time - lastTime) / 1000;
    lastTime = time;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach((particle, index) => {
        particle.update(dt);
        particle.draw(ctx);

        if (particle.opacity <= 0.1) {
            particles.splice(index, 1);
        }
    });
}

window.addEventListener('resize', resizeCanvas);
// window.addEventListener('click', emitParticle);
resizeCanvas();
animate(0);