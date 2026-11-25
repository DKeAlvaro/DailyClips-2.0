// Minimal controller for the embedded YouTube player. It speaks the same postMessage protocol
// as YouTube's iframe API script, without downloading that script.
const ORIGIN = 'https://www.youtube-nocookie.com';
let seq = 0;

export class YT {
  constructor(mount, { id, start = 0, onReady, onState, onError }) {
    this.pid = 'dc' + ++seq;
    this.onReady = onReady;
    this.onState = onState;
    this.onError = onError;
    this.state = -1; // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    this.t = start;
    this.at = performance.now();
    this.rate = 1;
    this.ready = false;
    this.started = false;
    this.target = null;
    const params = new URLSearchParams({
      enablejsapi: 1, playsinline: 1, controls: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1,
      hl: 'en', origin: location.origin, widgetid: seq, start: Math.max(0, Math.floor(start)),
    });
    const f = (this.iframe = document.createElement('iframe'));
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.title = 'YouTube video';
    f.src = `${ORIGIN}/embed/${id}?${params}`;
    this.onMsg = this.onMsg.bind(this);
    window.addEventListener('message', this.onMsg);
    f.addEventListener('load', () => {
      clearInterval(this.hello);
      let n = 0;
      this.hello = setInterval(() => {
        if (this.ready || ++n > 80) clearInterval(this.hello);
        else this.post({ event: 'listening' });
      }, 250);
      this.post({ event: 'listening' });
    });
    mount.textContent = '';
    mount.append(f);
  }

  destroy() {
    clearInterval(this.hello);
    clearTimeout(this.timer);
    window.removeEventListener('message', this.onMsg);
    if (this.done) this.done('cancel');
    this.iframe.remove();
  }

  post(obj) {
    try {
      this.iframe.contentWindow.postMessage(JSON.stringify({ ...obj, id: this.pid, channel: 'widget' }), ORIGIN);
    } catch { /* iframe not there yet */ }
  }

  cmd(func, ...args) {
    this.post({ event: 'command', func, args });
  }

  onMsg(e) {
    if (e.source !== this.iframe.contentWindow || typeof e.data !== 'string') return;
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!this.ready && (m.event === 'onReady' || m.event === 'initialDelivery' || m.event === 'infoDelivery')) {
      this.ready = true;
      for (const ev of ['onStateChange', 'onError']) this.cmd('addEventListener', ev);
      if (this.onReady) this.onReady();
    }
    if (m.event === 'apiInfoDelivery' && m.info && (m.info.namespaces || []).includes('captions')) this.captionsOff();
    if (m.event === 'onError') {
      if (this.onError) this.onError(m.info);
      return;
    }
    const info = m.event === 'onStateChange' ? { playerState: m.info } : m.info;
    if (!info || typeof info !== 'object') return;
    if (typeof info.currentTime === 'number') {
      if (this.seekTo == null || Math.abs(info.currentTime - this.seekTo) < 1.2) {
        this.seekTo = null;
        this.t = info.currentTime;
        this.at = performance.now();
      }
    }
    if (typeof info.playbackRate === 'number') this.rate = info.playbackRate;
    if (typeof info.playerState === 'number' && info.playerState !== this.state) {
      // freeze the clock at the moment the state changes
      this.t = this.now();
      this.at = performance.now();
      this.state = info.playerState;
      if (this.state === 1 && !this.started) {
        this.started = true;
        this.cmd('unMute');
        this.cmd('setVolume', 100);
        this.captionsOff();
      }
      if (this.onState) this.onState(this.state);
      if (this.state === 0 && this.done) this.finish('end');
    }
    this.tick();
  }

  /** The app shows the line itself: YouTube's own captions would sit on top of it. */
  captionsOff() {
    this.cmd('setOption', 'captions', 'track', {});
    this.cmd('unloadModule', 'captions');
  }

  /** Best estimate of the current position, extrapolated between player reports. */
  now() {
    if (this.state === 1 && this.seekTo == null) return this.t + ((performance.now() - this.at) / 1000) * this.rate;
    return this.t;
  }

  /** Plays [from, to] and pauses. Resolves 'end' when `to` is reached, 'cancel' when superseded. */
  play({ from = null, to, rate = 1 }) {
    if (this.done) this.done('cancel');
    return new Promise((resolve) => {
      this.done = resolve;
      this.target = to;
      this.stallAt = performance.now();
      if (rate !== this.rate) {
        this.cmd('setPlaybackRate', rate);
        this.rate = rate;
      }
      if (from != null) {
        this.seekTo = from;
        this.t = from;
        this.at = performance.now();
        this.cmd('seekTo', from, true);
      }
      this.cmd('playVideo');
      this.tick();
    });
  }

  finish(why) {
    clearTimeout(this.timer);
    const d = this.done;
    this.done = null;
    this.target = null;
    if (d) d(why);
  }

  tick() {
    clearTimeout(this.timer);
    if (this.target == null) return;
    const left = (this.target - this.now()) / this.rate;
    if (this.state === 1 && this.seekTo == null && left <= 0.03) {
      this.cmd('pauseVideo');
      this.t = this.target;
      this.at = performance.now();
      return this.finish('end');
    }
    this.timer = setTimeout(() => this.tick(), this.state === 1 ? Math.max(12, Math.min(180, left * 1000 - 8)) : 150);
  }

  pause() {
    if (this.done) this.finish('cancel');
    this.cmd('pauseVideo');
  }
}

export const posterUrl = (clip) => `https://i.ytimg.com/vi/${clip.yt}/${clip.poster || (clip.ar < 1 ? 'oar2' : 'hqdefault')}.jpg`;
