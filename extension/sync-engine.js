/*
 * SyncWatch — motor de sincronização (compartilhado entre o site e a extensão).
 *
 * A sala guarda um estado "oficial": { playing, position, at, seq }.
 *   position = segundo do vídeo no instante `at` (relógio do servidor, em ms).
 * Cada cliente calcula onde o vídeo DEVERIA estar agora e corrige o player:
 *   - diferença grande  -> pula (seek)
 *   - diferença pequena -> acelera/desacelera levemente até alcançar (imperceptível)
 *
 * O adapter abstrai o player (YouTube IFrame API ou <video> HTML5).
 */
(function (root) {
  'use strict';

  const HARD_SEEK = 1.0;      // s: acima disso, pula direto
  const HARD_SEEK_NO_RATE = 0.35; // s: limite quando o player não aceita velocidades finas
  const SOFT = 0.06;          // s: a partir disso começa a ajustar a velocidade
  const SETTLED = 0.03;       // s: abaixo disso considera sincronizado
  const MAX_NUDGE = 0.1;      // velocidade máxima de ajuste: 0,9x a 1,1x
  const LOCAL_TOLERANCE = 1.0; // s: eventos locais dentro disso são tratados como eco das nossas correções

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class SyncEngine {
    /**
     * @param adapter { ready, time, duration, paused, buffering, play, pause, seek, setRate, rate }
     * @param opts { serverNow: () => ms, onLocalChange: ({playing, position}) => void }
     */
    constructor(adapter, opts) {
      this.a = adapter;
      this.serverNow = opts.serverNow;
      this.onLocalChange = opts.onLocalChange;
      this.state = null;
      this.rateMode = 'unknown'; // 'unknown' | 'fine' | 'none'
      this.currentRate = 1;
      this.rateCheck = null;
      this.lastDiff = null;
      this.enabled = true;
      this.mutedUntil = 0;
    }

    /** Ignora eventos do player por um tempo (eles vêm das nossas próprias ações). */
    mute(ms) { this.mutedUntil = Math.max(this.mutedUntil, Date.now() + ms); }

    /** Onde o vídeo deveria estar agora, segundo a sala. */
    expected() {
      const s = this.state;
      if (!s) return null;
      let p = s.position;
      if (s.playing) p += Math.max(0, (this.serverNow() - s.at) / 1000);
      const d = this.a.duration();
      if (d && isFinite(d) && d > 0) p = Math.min(p, d);
      return p;
    }

    /** Novo estado vindo do servidor. */
    applyRemote(state) {
      if (!state) return;
      if (this.state && typeof state.seq === 'number' && state.seq <= this.state.seq) return;
      this.state = state;
      this.correct();
    }

    /** Chamado quando o usuário mexe no player (play, pause, seek). */
    localEvent() {
      if (!this.enabled || !this.a.ready()) return;
      if (Date.now() < this.mutedUntil) return;
      const playing = !this.a.paused();
      const position = this.a.time();
      const exp = this.expected();
      if (this.state && playing === this.state.playing && exp != null &&
          Math.abs(position - exp) < LOCAL_TOLERANCE) {
        return; // bate com a sala: é só o eco de uma correção nossa
      }
      this.onLocalChange({ playing, position });
    }

    setRate(r) {
      r = Math.round(r * 100) / 100;
      if (this.rateMode === 'none') r = 1;
      if (r === this.currentRate) return;
      this.currentRate = r;
      try { this.a.setRate(r); } catch (_) { /* ignora */ }
      if (r !== 1 && this.rateMode === 'unknown') this.rateCheck = r;
    }

    /** Roda periodicamente. Retorna a diferença em segundos (positivo = atrasado). */
    correct() {
      if (!this.enabled || !this.state || !this.a.ready()) { this.lastDiff = null; return null; }

      // Descobre se o player aceita velocidades como 1,05x
      if (this.rateCheck !== null) {
        let actual = 1;
        try { actual = this.a.rate(); } catch (_) { /* ignora */ }
        if (Math.abs(actual - this.rateCheck) < 0.011) this.rateMode = 'fine';
        else {
          this.rateMode = 'none';
          this.currentRate = 1;
          try { this.a.setRate(1); } catch (_) { /* ignora */ }
        }
        this.rateCheck = null;
      }

      const s = this.state;
      const exp = this.expected();

      if (!s.playing) {
        if (!this.a.paused()) { this.mute(1500); this.a.pause(); }
        if (Math.abs(this.a.time() - exp) > 0.25) { this.mute(1500); this.a.seek(exp); }
        this.setRate(1);
        this.lastDiff = exp - this.a.time();
        return this.lastDiff;
      }

      if (this.a.paused()) {
        // Dá play no máximo a cada 1,5 s (evita martelar o player se o navegador bloquear)
        const t = Date.now();
        if (t - (this.lastKick || 0) > 1500) {
          this.lastKick = t;
          this.mute(2500);
          this.a.seek(exp);
          this.a.play();
        }
        this.lastDiff = null;
        return null;
      }

      if (this.a.buffering && this.a.buffering()) { this.setRate(1); return this.lastDiff; }

      const diff = exp - this.a.time();
      const hard = this.rateMode === 'none' ? HARD_SEEK_NO_RATE : HARD_SEEK;
      if (Math.abs(diff) > hard) {
        // um pouquinho à frente quando atrasado, para compensar o tempo do próprio seek
        this.mute(1500);
        this.a.seek(exp + (diff > 0 ? 0.1 : 0));
        this.setRate(1);
      } else if (this.rateMode !== 'none') {
        if (Math.abs(diff) < SETTLED) this.setRate(1);
        else if (Math.abs(diff) > SOFT || this.currentRate !== 1) {
          this.setRate(1 + clamp(diff * 0.8, -MAX_NUDGE, MAX_NUDGE));
        }
      }
      this.lastDiff = diff;
      return diff;
    }
  }

  /** Sincronização de relógio estilo NTP: guarda as amostras com menor latência. */
  class ClockSync {
    constructor() { this.samples = []; this.offset = 0; this.rtt = null; }
    /** c = Date.now() no envio, s = hora do servidor, r = Date.now() na resposta */
    add(c, s, r) {
      const rtt = r - c;
      this.samples.push({ rtt, offset: s - (c + rtt / 2) });
      if (this.samples.length > 12) this.samples.shift();
      const best = this.samples.slice().sort((a, b) => a.rtt - b.rtt).slice(0, 3);
      this.offset = best.reduce((acc, x) => acc + x.offset, 0) / best.length;
      this.rtt = best[0].rtt;
    }
    now() { return Date.now() + this.offset; }
  }

  root.SyncEngine = SyncEngine;
  root.ClockSync = ClockSync;
  if (typeof module !== 'undefined' && module.exports) module.exports = { SyncEngine, ClockSync };
})(typeof globalThis !== 'undefined' ? globalThis : this);
