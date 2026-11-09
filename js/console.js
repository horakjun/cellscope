/* CellScope – komunikace s konzolí Pylontech přes Web Serial.
   Posílá VÝHRADNĚ příkazy z pevného seznamu ALLOWED (jen čtení). Nic jiného odeslat nejde. */
(function (root) {
  "use strict";
  const P = root.CSParse || (typeof require !== "undefined" ? require("./parse.js") : null);

  const BAUD = 115200;
  const WAKE = "~20014682C0048520FCC3\r";        // přepnutí konzole z 1200 Bd na 115200 Bd
  const ALLOWED = [
    /^pwr$/, /^bat \d{1,2}$/, /^info( \d{1,2})?$/, /^time$/, /^stat( \d{1,2})?$/,
    /^soh( \d{1,2})?$/, /^log$/, /^data event$/, /^data history( \d{1,5})?$/
  ];
  const isAllowed = c => ALLOWED.some(r => r.test(c));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class Link {
    constructor(port) { this.port = port; this.buf = ""; this.baud = 0; this.reader = null; this.loop = null; this.wake = null; }

    async open(baud = BAUD) {
      await this.port.open({ baudRate: baud, dataBits: 8, parity: "none", stopBits: 1, flowControl: "none" });
      this.baud = baud;
      this.buf = "";
      const dec = new TextDecoder("ascii");
      this.reader = this.port.readable.getReader();
      this.loop = (async () => {
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) { this.buf += dec.decode(value, { stream: true }); this.wake && this.wake(); }
          }
        } catch (e) { /* port zavřen nebo kabel vytažen */ }
      })();
    }

    async close() {
      try { if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); } } catch (e) {}
      try { await this.loop; } catch (e) {}
      this.reader = null;
      try { await this.port.close(); } catch (e) {}
      this.baud = 0;
    }

    async writeRaw(s) {
      const w = this.port.writable.getWriter();
      try { await w.write(new TextEncoder().encode(s)); } finally { w.releaseLock(); }
    }

    /* čeká, dokud buffer nesplní podmínku (nebo do limitu).
       idleMs > 0: skončí i po takové pauze v datech – jen pro ping; odpovědi příkazů se čtou vždy až do „$$“,
       protože master u podřízených modulů dělá před odpovědí pauzu. */
    async waitFor(test, limitMs = 6000, idleMs = 0) {
      const t0 = Date.now();
      let last = Date.now(), len = this.buf.length;
      while (Date.now() - t0 < limitMs) {
        if (test(this.buf)) return true;
        await new Promise(r => { this.wake = r; setTimeout(r, 100); });
        this.wake = null;
        if (this.buf.length !== len) { len = this.buf.length; last = Date.now(); }
        else if (idleMs && len && Date.now() - last > idleMs) return test(this.buf);
      }
      return test(this.buf);
    }

    /* počká, až konzole přestane posílat (zbytky předchozí odpovědi), a buffer vyprázdní */
    async drain(quietMs = 400, limitMs = 3000) {
      const t0 = Date.now();
      let len = -1;
      while (Date.now() - t0 < limitMs && this.buf.length !== len) { len = this.buf.length; await sleep(quietMs); }
      this.buf = "";
    }

    /* jeden čtecí příkaz se stránkováním (na výzvu „Press [Enter]“ se posílá jen Enter).
       Vrací text; this.lastOk = false, když nedorazil konec odpovědi „$$“. */
    async cmd(c, maxPages = 60, limitMs = 15000) {
      if (!isAllowed(c)) throw new Error("Příkaz není povolen: " + c);
      this.buf = "";
      await this.writeRaw(c + "\r");
      let out = "";
      this.lastOk = false;
      for (let p = 0; p < maxPages; p++) {
        const got = await this.waitFor(b => /\$\$/.test(b) || /Press \[Enter\]/.test(b), limitMs);
        const done = /\$\$/.test(this.buf);
        if (done) {
          // po „$$“ ještě dorazí prompt – počkat na něj, ať nezůstane v odpovědi dalšího příkazu
          const k = this.buf.indexOf("$$");
          await this.waitFor(b => />\s*$/.test(b.slice(k)), 600);
          out += this.buf; this.buf = ""; this.lastOk = true; break;
        }
        out += this.buf;
        const more = got && /Press \[Enter\]/.test(this.buf);
        this.buf = "";
        if (!more) { await this.drain(); break; }    // konec nedorazil – nechat doběhnout, ať se nemíchá s dalším příkazem
        await this.writeRaw("\r");
      }
      return out;
    }

    /* prázdný řádek – jen zjistí, jestli konzole odpovídá promptem */
    async ping() {
      this.buf = "";
      await this.writeRaw("\r");
      return this.waitFor(b => />\s*$/.test(b) || /pylon/i.test(b), 1500, 600);
    }

    async wakeUp() {
      await this.close();
      await this.open(1200);
      await this.writeRaw(WAKE);
      await sleep(1500);
      await this.close();
      await this.open(BAUD);
      await sleep(300);
    }
  }

  /* Celé načtení baterie. onStep({key, vars, pct}) hlásí průběh, onRaw(cmd, text) surový výpis. */
  async function readAll(link, opt = {}, onStep = () => {}, onRaw = () => {}) {
    const raw = {};
    const step = (key, vars = {}, pct) => onStep({ key, vars, pct });
    /* příkaz; když nedorazí konec odpovědi, zkusí se ještě jednou */
    const run = async c => {
      let t = await link.cmd(c);
      if (!link.lastOk) { await link.drain(500, 4000); t = await link.cmd(c); }
      raw[c] = t; onRaw(c, t); return t;
    };

    step("step_open", { p: opt.portName || "COM" }, 2);
    await link.open(BAUD);
    let woke = false;
    // první dotaz krátce a bez opakování – spící konzole neodpoví vůbec
    let t = await link.cmd("pwr", 60, 3000);
    if (!/Power\s+Volt/.test(t)) await link.drain(300, 1500);
    else { raw.pwr = t; onRaw("pwr", t); }
    if (!/Power\s+Volt/.test(t)) {
      step("step_wake", {}, 5);
      await link.wakeUp();
      woke = true;
      t = await run("pwr");
      if (!/Power\s+Volt/.test(t)) throw new Error("NO_RESPONSE");
    }
    const pcTime = new Date();
    step("step_time", {}, 8);
    const batTime = P.time(await run("time"));

    const pw = P.pwr(t);
    const ids = pw.filter(m => m.present).map(m => m.id);
    const mods = [];
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      step("step_bat", { m: id, n: ids.length }, 10 + Math.round(k / ids.length * 55));
      let cells = P.bat(await run("bat " + id));
      if (!cells.length) { await link.drain(500, 4000); cells = P.bat(await run("bat " + id)); }
      const inf = P.info(await run("info " + id));
      const st = P.stat(await run("stat " + id));
      const sh = P.soh(await run("soh " + id));
      mods.push({ id, pwr: pw.find(m => m.id === id), cells, info: inf, stat: st, soh: sh });
    }

    step("step_log", {}, 68);
    const log = P.log(await run("log"));
    const events = P.events(await run("data event"));

    const history = [];
    const h0 = P.history(await run("data history"));
    if (h0) history.push(h0);
    const want = Math.max(0, (opt.history ?? 100) - 1);
    if (h0 && h0.index != null) {
      for (let i = 1; i <= want && h0.index - i >= 0; i++) {
        step("step_hist", { i, n: want }, 70 + Math.round(i / Math.max(1, want) * 28));
        const h = P.history(await run("data history " + (h0.index - i)));
        if (!h || h.index !== h0.index - i) break;   // jiný formát – raději skončit
        history.push(h);
      }
    }
    await link.close();
    step("step_done", { n: mods.length }, 100);

    return {
      pcTime: pcTime.toISOString(),
      batTime,
      clockOff: batTime ? Math.round((new Date(batTime) - new Date(localIso(pcTime))) / 60000) : null,
      woke, modules: mods, log, events, history: history.reverse(), raw
    };
  }

  /* místní čas PC bez zóny – stejný tvar jako čas baterie */
  function localIso(d) {
    const p = x => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  const api = { Link, readAll, isAllowed, localIso, BAUD };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CSConsole = api;
})(typeof window !== "undefined" ? window : globalThis);
