const BIN_COUNT = 127;
const VISIBLE_BIN_COUNT = BIN_COUNT - 1;
const BAUD_RATE = 921600;
const AXIS_MAX_KHZ = 2.5;
const AXIS_TICKS = 5;
const LOG_AXIS_WARP = 150;

const spectrumCanvas = document.getElementById('spectrumCanvas');
const spectrumContext = spectrumCanvas.getContext('2d');
const waterfallCanvas = document.getElementById('waterfallCanvas');
const waterfallContext = waterfallCanvas.getContext('2d');
const connectButton = document.getElementById('connectBtn');
const pauseButton = document.getElementById('pauseBtn');
const logAxisToggle = document.getElementById('logAxisToggle');
const freqAxis = document.getElementById('freqAxis');
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const statusWrap = statusText.parentElement;

const targetBins = new Float32Array(BIN_COUNT);
const displayBins = new Float32Array(BIN_COUNT);
const waterfallPalette = buildWaterfallPalette();

let port = null;
let reader = null;
let readableStreamClosed = null;
let serialBuffer = '';
let isConnected = false;
let dpr = Math.max(window.devicePixelRatio || 1, 1);
let waterfallImageData = null;
let waterfallPixels = null;
let waterfallColumnMap = null;
let waterfallWidth = 0;
let waterfallHeight = 0;
let useLogAxis = false;
let isPaused = false;

function setConnectionState(connected) {
  isConnected = connected;
  statusText.textContent = connected ? 'Connected' : 'Disconnected';
  statusWrap.classList.toggle('is-connected', connected);
  statusDot.setAttribute('aria-hidden', 'true');
  connectButton.textContent = connected ? 'Disconnect' : 'Connect';
}

function setPauseState(paused) {
  isPaused = paused;
  pauseButton.textContent = paused ? '▶' : '⏸';
  pauseButton.setAttribute('aria-pressed', String(paused));
  pauseButton.setAttribute('aria-label', paused ? 'Resume graphs' : 'Pause graphs');
  pauseButton.classList.toggle('is-paused', paused);
}

function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hueSection = hue / 60;
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSection >= 0 && hueSection < 1) {
    red = chroma;
    green = secondary;
  } else if (hueSection < 2) {
    red = secondary;
    green = chroma;
  } else if (hueSection < 3) {
    green = chroma;
    blue = secondary;
  } else if (hueSection < 4) {
    green = secondary;
    blue = chroma;
  } else if (hueSection < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const match = l - chroma / 2;
  return [
    Math.round((red + match) * 255),
    Math.round((green + match) * 255),
    Math.round((blue + match) * 255),
  ];
}

function buildWaterfallPalette() {
  const palette = new Uint8ClampedArray(256 * 4);

  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    const hue = 220 - t * 170;
    const saturation = 100;
    const lightness = 7 + t * 58;
    const [red, green, blue] = hslToRgb(hue, saturation, lightness);
    const offset = i * 4;
    palette[offset] = red;
    palette[offset + 1] = green;
    palette[offset + 2] = blue;
    palette[offset + 3] = 255;
  }

  return palette;
}

function resizeCanvas(canvas, context) {
  const bounds = canvas.getBoundingClientRect();
  dpr = Math.max(window.devicePixelRatio || 1, 1);
  const width = Math.max(1, Math.floor(bounds.width * dpr));
  const height = Math.max(1, Math.floor(bounds.height * dpr));
  canvas.width = width;
  canvas.height = height;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function axisMap(normalized) {
  const clamped = Math.min(1, Math.max(0, normalized));
  if (!useLogAxis) {
    return clamped;
  }
  const denominator = Math.log10(1 + LOG_AXIS_WARP);
  return Math.log10(1 + clamped * LOG_AXIS_WARP) / denominator;
}

function axisUnmap(position) {
  const clamped = Math.min(1, Math.max(0, position));
  if (!useLogAxis) {
    return clamped;
  }
  const exponent = clamped * Math.log10(1 + LOG_AXIS_WARP);
  return (Math.pow(10, exponent) - 1) / LOG_AXIS_WARP;
}

function renderFrequencyAxisTicks() {
  if (!freqAxis) {
    return;
  }

  freqAxis.innerHTML = '';

  for (let i = 0; i <= AXIS_TICKS; i += 1) {
    const normalized = i / AXIS_TICKS;
    const left = axisMap(normalized) * 100;
    const tick = document.createElement('span');
    tick.className = 'freq-tick';
    const tickValue = (i * AXIS_MAX_KHZ) / AXIS_TICKS;
    const tickText = (Math.abs(tickValue - Math.round(tickValue)) < 1e-6) ? `${Math.round(tickValue)}` : tickValue.toFixed(1);
    tick.textContent = `${tickText} kHz`;
    tick.style.left = `${left}%`;

    if (i === 0) {
      tick.classList.add('is-start');
    } else if (i === AXIS_TICKS) {
      tick.classList.add('is-end');
    }

    freqAxis.appendChild(tick);
  }
}

function resizeWaterfallBuffer() {
  const { width, height } = resizeCanvas(waterfallCanvas, waterfallContext);
  waterfallWidth = width;
  waterfallHeight = height;
  waterfallImageData = waterfallContext.createImageData(width, height);
  waterfallPixels = waterfallImageData.data;
  waterfallColumnMap = new Uint16Array(width);

  for (let x = 0; x < width; x += 1) {
    const normalizedAxisPosition = (x + 0.5) / width;
    const linearBinPosition = axisUnmap(normalizedAxisPosition);
    const mappedBin = Math.floor(linearBinPosition * VISIBLE_BIN_COUNT);
    waterfallColumnMap[x] = Math.min(VISIBLE_BIN_COUNT - 1, mappedBin);
  }
}

function clearBins() {
  targetBins.fill(0);
  displayBins.fill(0);
}

function clearWaterfall() {
  if (!waterfallPixels || !waterfallImageData) {
    return;
  }

  waterfallPixels.fill(0);
  waterfallContext.putImageData(waterfallImageData, 0, 0);
}

function applyLine(line) {
  if (!line || line[0] !== '>') {
    return;
  }

  const separatorIndex = line.indexOf(':');
  if (separatorIndex === -1) {
    return;
  }

  const key = line.slice(1, separatorIndex).trim();
  const value = Number.parseFloat(line.slice(separatorIndex + 1).trim());
  if (!Number.isFinite(value)) {
    return;
  }

  const binMatch = /^Bin_(\d+)$/.exec(key);
  if (!binMatch) {
    return;
  }

  const binIndex = Number.parseInt(binMatch[1], 10) - 1;
  if (binIndex < 0 || binIndex >= BIN_COUNT) {
    return;
  }

  targetBins[binIndex] = value;
}

function consumeBuffer(text) {
  serialBuffer += text;

  let newlineIndex = serialBuffer.indexOf('\n');
  while (newlineIndex !== -1) {
    const line = serialBuffer.slice(0, newlineIndex).replace(/\r$/, '');
    applyLine(line);
    serialBuffer = serialBuffer.slice(newlineIndex + 1);
    newlineIndex = serialBuffer.indexOf('\n');
  }
}

function normalizeValue(value, maxValue) {
  if (!Number.isFinite(value) || maxValue <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, value / maxValue));
}

function drawSpectrum() {
  if (isPaused) {
    return;
  }

  const width = spectrumCanvas.clientWidth;
  const height = spectrumCanvas.clientHeight;

  spectrumContext.clearRect(0, 0, width, height);

  const paddingX = Math.max(10, width * 0.012);
  const paddingTop = Math.max(12, height * 0.06);
  const paddingBottom = Math.max(8, height * 0.04);
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingTop - paddingBottom;
  const maxValue = Math.max(1000, ...targetBins);

  const backgroundGradient = spectrumContext.createLinearGradient(0, 0, 0, height);
  backgroundGradient.addColorStop(0, 'rgba(255,255,255,0.03)');
  backgroundGradient.addColorStop(1, 'rgba(255,255,255,0.01)');
  spectrumContext.fillStyle = backgroundGradient;
  spectrumContext.fillRect(0, 0, width, height);

  spectrumContext.fillStyle = 'rgba(255,255,255,0.04)';
  for (let i = 0; i <= 4; i += 1) {
    const y = paddingTop + (plotHeight / 4) * i;
    spectrumContext.fillRect(paddingX, y, plotWidth, 1);
  }

  for (let i = 0; i < VISIBLE_BIN_COUNT; i += 1) {
    const target = targetBins[i + 1];
    displayBins[i] += (target - displayBins[i]) * 0.22;

    const normalized = normalizeValue(displayBins[i], maxValue);
    const barHeight = Math.max(1.5, normalized * plotHeight);
    const leftNorm = axisMap(i / VISIBLE_BIN_COUNT);
    const rightNorm = axisMap((i + 1) / VISIBLE_BIN_COUNT);
    const startX = paddingX + leftNorm * plotWidth;
    const endX = paddingX + rightNorm * plotWidth;
    const x = startX + 0.25;
    const barWidth = Math.max(1, endX - startX - 0.5);
    const y = paddingTop + (plotHeight - barHeight);

    const gradient = spectrumContext.createLinearGradient(0, y, 0, y + barHeight);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.22, 'rgba(125,240,165,0.95)');
    gradient.addColorStop(1, 'rgba(35, 226, 127, 0.18)');

    spectrumContext.fillStyle = 'rgba(125,240,165,0.05)';
    spectrumContext.shadowColor = 'rgba(125,240,165,0.2)';
    spectrumContext.shadowBlur = 10;
    spectrumContext.fillRect(x, y, barWidth, barHeight);

    spectrumContext.shadowBlur = 0;
    spectrumContext.fillStyle = gradient;
    spectrumContext.fillRect(x, y, barWidth, barHeight);

  }
}

function drawWaterfall() {
  if (isPaused) {
    return;
  }

  if (!waterfallImageData || !waterfallPixels || !waterfallColumnMap) {
    return;
  }

  const width = waterfallCanvas.clientWidth;
  const maxValue = Math.max(1000, ...targetBins);
  const rowStride = waterfallWidth * 4;

  if (waterfallHeight > 1) {
    waterfallPixels.copyWithin(rowStride, 0, rowStride * (waterfallHeight - 1));
  }

  const topRow = waterfallPixels.subarray(0, rowStride);

  for (let x = 0; x < waterfallWidth; x += 1) {
    const binIndex = waterfallColumnMap[x];
    const normalized = normalizeValue(displayBins[binIndex], maxValue);
    const paletteIndex = Math.max(0, Math.min(255, Math.round(normalized * 255))) * 4;
    const pixelOffset = x * 4;
    topRow[pixelOffset] = waterfallPalette[paletteIndex];
    topRow[pixelOffset + 1] = waterfallPalette[paletteIndex + 1];
    topRow[pixelOffset + 2] = waterfallPalette[paletteIndex + 2];
    topRow[pixelOffset + 3] = 255;
  }

  waterfallContext.putImageData(waterfallImageData, 0, 0);

  waterfallContext.strokeStyle = 'rgba(236,241,247,0.16)';
  waterfallContext.lineWidth = 1;
  waterfallContext.beginPath();
  waterfallContext.moveTo(0, 0.5);
  waterfallContext.lineTo(width, 0.5);
  waterfallContext.stroke();
}

function renderFrame() {
  drawSpectrum();
  drawWaterfall();

  requestAnimationFrame(renderFrame);
}

async function closeSerialPort() {
  try {
    if (reader) {
      await reader.cancel();
      reader.releaseLock();
      reader = null;
    }
  } catch (error) {
    console.warn('Reader close warning:', error);
  }

  try {
    if (readableStreamClosed) {
      await readableStreamClosed.catch(() => {});
      readableStreamClosed = null;
    }
  } catch (error) {
    console.warn('Readable stream close warning:', error);
  }

  try {
    if (port) {
      await port.close();
    }
  } catch (error) {
    console.warn('Port close warning:', error);
  }

  port = null;
}

async function readSerialStream() {
  const textDecoder = new TextDecoderStream();
  readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  reader = textDecoder.readable.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      consumeBuffer(value);
    }
  } catch (error) {
    if (isConnected) {
      console.error('Serial read error:', error);
    }
  } finally {
    if (reader) {
      reader.releaseLock();
      reader = null;
    }
  }
}

async function connectSerial() {
  if (!('serial' in navigator)) {
    alert('Web Serial API is not supported in this browser. Use Chromium-based browsers over HTTPS or localhost.');
    return;
  }

  connectButton.disabled = true;

  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD_RATE });
    setConnectionState(true);

    void readSerialStream().then(async () => {
      // If the stream ends without an explicit user disconnect, reset UI/state.
      if (isConnected) {
        await disconnectSerial();
      }
    });
  } catch (error) {
    if (error?.name !== 'NotFoundError') {
      console.error('Connection failed:', error);
      alert(`Unable to connect to the ESP32: ${error.message || error}`);
    }
    await disconnectSerial();
  } finally {
    connectButton.disabled = false;
  }
}

async function disconnectSerial() {
  setConnectionState(false);
  serialBuffer = '';
  clearBins();
  clearWaterfall();
  await closeSerialPort();
}

async function toggleConnection() {
  if (isConnected) {
    connectButton.disabled = true;
    try {
      await disconnectSerial();
    } finally {
      connectButton.disabled = false;
    }
    return;
  }

  await connectSerial();
}

function syncCanvasSizes() {
  resizeCanvas(spectrumCanvas, spectrumContext);
  resizeWaterfallBuffer();
  renderFrequencyAxisTicks();
}

function toggleAxisMode() {
  useLogAxis = logAxisToggle.checked;
  resizeWaterfallBuffer();
  renderFrequencyAxisTicks();
}

function togglePause() {
  setPauseState(!isPaused);
}

window.addEventListener('resize', syncCanvasSizes);
connectButton.addEventListener('click', toggleConnection);
pauseButton.addEventListener('click', togglePause);
logAxisToggle.addEventListener('change', toggleAxisMode);

syncCanvasSizes();
clearBins();
clearWaterfall();
setConnectionState(false);
setPauseState(false);
logAxisToggle.checked = false;
requestAnimationFrame(renderFrame);
