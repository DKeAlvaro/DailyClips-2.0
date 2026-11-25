// Real Chrome with a fake microphone that plays a WAV file. The file can be swapped between
// recordings (Chrome reopens it for every capture), which is how the tests "speak" each phrase.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MIC = path.join(os.tmpdir(), 'dailyclips-mic.wav');

export function speak(wav) {
  fs.copyFileSync(wav, MIC);
}

export async function launch({ headless = true, profile = null, width = 390, height = 844, throttle = 0 } = {}) {
  if (!fs.existsSync(MIC)) fs.writeFileSync(MIC, Buffer.alloc(0));
  const dir = profile || fs.mkdtempSync(path.join(os.tmpdir(), 'dc-chrome-'));
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chrome', headless,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${MIC}`,
      '--mute-audio', '--window-position=-2400,0', '--no-first-run', '--no-default-browser-check'],
    viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
    locale: 'es-ES', permissions: ['microphone'],
  });
  // Chrome's fake microphone reaches getUserMedia but not SpeechRecognition.start(). Under automation
  // the recogniser is started with the fake microphone's own track instead (start(track), Chrome 139+).
  await context.addInitScript(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || window.top !== window) return;
    const start = SR.prototype.start;
    SR.prototype.start = function () {
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then((stream) => {
        this.addEventListener('end', () => stream.getTracks().forEach((t) => t.stop()), { once: true });
        start.call(this, stream.getAudioTracks()[0]);
      });
    };
  });
  const page = context.pages()[0] || (await context.newPage());
  if (throttle) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  return { context, page, dir };
}
