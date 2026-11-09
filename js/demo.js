/* CellScope – ukázková baterie: simulovaný sériový port, který odpovídá ve stejném formátu
   jako skutečná konzole Pylontech. Slouží pro ukázkový režim aplikace a pro testy. */
(function (root) {
  "use strict";

  function model(seedIn = 11) {
    let seed = seedIn;
    const rnd = () => (seed = (seed * 16807) % 2147483647, (seed - 1) / 2147483646);
    const N = 6, mods = [];
    for (let i = 1; i <= N; i++) {
      const base = 3331 + Math.round(rnd() * 3);
      const cells = Array.from({ length: 15 }, () => base + Math.round((rnd() - .5) * 8));
      if (i === 4) cells[6] = base - 28;
      if (i === 2) cells[10] = base + 9;
      const temps = Array.from({ length: 15 }, (_, k) => 15200 + Math.round(rnd() * 1800) + (k < 4 ? 500 : 0));
      mods.push({
        id: i, cells, temps, bal: cells.map((v, k) => i === 2 && k === 10),
        curr: 4100 + Math.round(rnd() * 500), soc: [71, 71, 70, 69, 71, 70][i - 1],
        mos: 16800 + Math.round(rnd() * 1500) + (i === 6 ? 7600 : 0),
        sn: "PPTBH0215" + String(410200 + i * 173).padStart(7, "0"),
        cycles: [742, 738, 751, 768, 744, 739][i - 1], soh: [97, 97, 97, 94, 97, 96][i - 1],
        lv: i === 4 ? 5 : 0, reset: 3 + (i % 3)
      });
    }
    const offMin = 134;   // hodiny baterie napřed o 2 h 14 min
    return { mods, offMin, histCount: 1450 };
  }

  const pad = (s, n) => String(s).padEnd(n);
  const fmtT = d => {
    const p = x => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const sum = a => a.reduce((s, x) => s + x, 0);

  function answers(M) {
    const now = () => new Date(Date.now() + M.offMin * 60000);
    const pwr = () => {
      const h = "Power Volt   Curr   Tempr  Tlow   Thigh  Vlow   Vhigh  Base.St  Volt.St  Curr.St  Temp.St  Coulomb  Time                 B.V.St   B.T.St   MosTempr M.T.St  ";
      const rows = M.mods.map(m => [pad(m.id, 6), pad(sum(m.cells), 7), pad(m.curr, 7), pad(Math.round(sum(m.temps) / 15), 7),
        pad(Math.min(...m.temps), 7), pad(Math.max(...m.temps), 7), pad(Math.min(...m.cells), 7), pad(Math.max(...m.cells), 7),
        pad("Charge", 9), pad("Normal", 9), pad("Normal", 9), pad("Normal", 9), pad(m.soc + "%", 9), pad(fmtT(now()), 21),
        pad("Normal", 9), pad("Normal", 8), pad(m.mos, 9), "Normal"].join(""));
      for (let i = M.mods.length + 1; i <= 8; i++) rows.push(pad(i, 6) + "-      -      -      -      -      -      -      Absent   -        -        -        -        -                    -        -       -        -");
      return [h, ...rows];
    };
    const bat = id => {
      const m = M.mods.find(x => x.id === id);
      if (!m) return ["Battery  Volt     Curr     Tempr    Base State   Volt. State  Curr. State  Temp. State  SOC          Coulomb      BAL"];
      return ["Battery  Volt     Curr     Tempr    Base State   Volt. State  Curr. State  Temp. State  SOC          Coulomb      BAL         ",
        ...m.cells.map((v, k) => [pad(k, 9), pad(v, 9), pad(m.curr, 9), pad(m.temps[k], 9), pad("Charge", 13), pad("Normal", 13), pad("Normal", 13), pad("Normal", 13), pad(m.soc + "%", 12), pad(Math.round(m.soc * 740) + " mAH", 15), m.bal[k] ? "Y" : "N"].join(""))];
    };
    const info = id => {
      const m = M.mods.find(x => x.id === id) || M.mods[0];
      return [["Device address", m.id], ["Manufacturer", "Pylon"], ["Device name", "US3000C"], ["Board version", "V10R03"], ["Board", "NF3.C2"],
        ["Main Soft version", "B66.6.0.0"], ["Soft  version", "V2.8"], ["Boot  version", "V1.0"], ["Comm version", "V2.0"], ["Release Date", "21-11-18"],
        ["Barcode", m.sn], ["", ""], ["Specification", "48V/74AH"], ["Cell Number", "15"], ["Max Dischg Curr", "-100000mA"], ["Max Charge Curr", "100000mA"]]
        .map(([k, v]) => k ? pad(k, 20) + ": " + v : "");
    };
    const KEYS = ["Data Items", "HisData Items", "Charge Cnt.", "Discharge Cnt.", "Charge Times", "Status Cnt.", "Idle Times", "COC Times", "COC2 Times", "DOC Times", "DOC2 Times", "COCA Times", "DOCA Times", "SC Times", "Bat OV Times", "Bat HV Times", "Bat LV Times", "Bat UV Times", "Bat SLP Times", "Pwr OV Times", "Pwr HV Times", "Pwr LV Times", "Pwr UV Times", "Pwr SLP Times", "COT Times", "CUT Times", "DOT Times", "DUT Times", "CHT Times", "CLT Times", "DHT Times", "DLT Times", "Shut Times", "Reset Times", "RV Times", "Input OV Times", "SOH Times", "BMICERR Times", "CYCLE Times", "SOH", "Pwr Percent", "Pwr Coulomb", "Dsg Cap", "HT@0.5C Cnt", "LT@0.5C Cnt", "HT Cnt", "LT Cnt", "LV Cnt", "LifeWarn Times", "LifeAlarm Times"];
    const stat = id => {
      const m = M.mods.find(x => x.id === id) || M.mods[0];
      const v = { "HisData Items": M.histCount, "Charge Cnt.": 1210, "Status Cnt.": 1209, "Charge Times": 51200, "Idle Times": 40210, "Bat LV Times": m.lv, "Reset Times": m.reset, "CYCLE Times": m.cycles, "SOH": m.soh, "Pwr Percent": m.soc, "Pwr Coulomb": 182000000, "Dsg Cap": 15200000, "LV Cnt": 9100 };
      return ["Device address           " + m.id, ...KEYS.map(k => pad(k, 16) + ": " + String(v[k] ?? 0).padStart(8))];
    };
    const soh = id => {
      const m = M.mods.find(x => x.id === id) || M.mods[0];
      return ["Power   " + m.id, "Battery    Voltage    SOHCount   SOHStatus ", ...m.cells.map((v, k) => pad(k, 11) + pad(v, 11) + pad(0, 11) + pad("Normal", 10))];
    };
    const logE = () => {
      const out = [], base = now().getTime();
      const ev = ["The device start charging.", "The device start discharging."];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(base - (12 - i) * 5.3 * 3600000);
        const ts = fmtT(d).slice(2);
        out.push([" Index   : " + pad(i, 6), " Time    : " + ts, " ModID   : BMM", " Code    : " + (i % 2 ? "0" : (0x9a00 + i).toString(16)), " Info    : " + ev[i % 2] + " ", ""]);
      }
      return out;
    };
    const hist = idx => {
      if (idx == null) idx = M.histCount - 1;
      const back = M.histCount - 1 - idx;
      const d = new Date(now().getTime() - back * 30 * 60000 - 10 * 60000);
      const ph = back / 48 * Math.PI * 2;
      const soc = Math.round(60 + 30 * Math.sin(ph));
      const spread = 6 + Math.round(4 * Math.abs(Math.sin(ph * 1.3))) + (soc > 85 ? 14 : 0);
      const cur = Math.round(4000 * Math.cos(ph));
      const cells = M.mods[0].cells.map((v, k) => v - 3332 + 3300 + Math.round(soc * 0.6) + (k === 4 ? spread : 0));
      return ["-----------------------------------------------",
        pad("Rec Item Index", 16) + ": " + idx, pad("Time", 16) + ": " + fmtT(d).slice(2),
        pad("Voltage", 16) + ": " + pad(sum(cells), 12) + "mV", pad("Current", 16) + ": " + pad(cur, 12) + "mA",
        pad("Temperature", 16) + ": " + pad(16500, 12) + "mC", pad("Percent", 16) + ": " + pad(soc, 12) + "%",
        pad("Total Coulomb", 16) + ": " + pad(74000, 12) + "mAH", pad("Base State", 16) + ": " + (cur >= 0 ? "Charge" : "Dischg"),
        pad("Volt. State", 16) + ": Normal", pad("Curr. State", 16) + ": Normal", pad("Tempr. State", 16) + ": Normal",
        pad("Power Events", 16) + ": 0x0", pad("Bat Events", 16) + ": 0x0", pad("System Fault", 16) + ": 0x0",
        "-----------------------------------------------", "",
        "Battery  Volt     Curr     Tempr    Base State   Volt. State  Curr. State  Temp. State  Coulomb     ",
        ...cells.map((v, k) => pad(k, 9) + pad(v, 9) + pad(cur, 9) + pad(16500, 9) + pad("Charge", 13) + pad("Normal", 13) + pad("Normal", 13) + pad("Normal", 13) + soc + "%")];
    };
    return {
      respond(c) {
        let m;
        if (c === "pwr") return { lines: pwr() };
        if ((m = c.match(/^bat (\d+)$/))) return { lines: bat(+m[1]) };
        if ((m = c.match(/^info(?: (\d+))?$/))) return { lines: info(+(m[1] || 1)) };
        if (c === "time") return { lines: ["RTC " + fmtT(now()), "Test result:pass"] };
        if ((m = c.match(/^stat(?: (\d+))?$/))) return { lines: stat(+(m[1] || 1)) };
        if ((m = c.match(/^soh(?: (\d+))?$/))) return { lines: soh(+(m[1] || 1)) };
        if (c === "log") return { pages: logE().reduce((a, e, i) => { if (i % 3 === 0) a.push([]); a[a.length - 1].push(...e); return a; }, []) };
        if (c === "data event") return { lines: [] };
        if ((m = c.match(/^data history(?: (\d+))?$/))) return { lines: hist(m[1] != null ? +m[1] : null) };
        return { lines: ["Unknown command '" + c + "' - try 'help'"] };
      }
    };
  }

  /* objekt se stejným rozhraním jako SerialPort z Web Serial */
  class FakePort {
    constructor(opt = {}) {
      this.M = model(opt.seed);
      this.ans = answers(this.M);
      this.awake = !opt.asleep;
      this.delay = opt.delay ?? 8;
      this.slavePause = opt.slavePause ?? 0;   // pauza masteru u podřízených modulů (jako skutečná baterie)
      this.info = { usbVendorId: 0x067b, usbProductId: 0x23c3 };
    }
    getInfo() { return this.info; }
    async open({ baudRate }) {
      this.baud = baudRate; this.inp = ""; this.pages = null;
      this.readable = new ReadableStream({ start: c => { this.ctl = c; }, cancel: () => { this.ctl = null; } });
      this.writable = new WritableStream({ write: chunk => this._rx(new TextDecoder().decode(chunk)) });
    }
    async close() { try { this.ctl && this.ctl.close(); } catch (e) {} this.ctl = null; this.baud = 0; }
    _tx(s) { setTimeout(() => { try { this.ctl && this.ctl.enqueue(new TextEncoder().encode(s)); } catch (e) {} }, this.delay); }
    _rx(s) {
      this.inp += s;
      let k;
      while ((k = this.inp.indexOf("\r")) >= 0) {
        const line = this.inp.slice(0, k).trim();
        this.inp = this.inp.slice(k + 1);
        if (this.baud === 1200) { if (line.includes("20014682C0048520FCC3")) this.awake = true; continue; }
        if (!this.awake) continue;
        if (this.pages && line === "") { this._page(); continue; }
        this.pages = null;
        if (line === "") { this._tx("\r\npylon_debug>"); continue; }
        const r = this.ans.respond(line);
        this.pages = r.pages ? r.pages.slice() : [r.lines];
        this._tx(line + "\r\n@\r\n");
        const pause = this.slavePause && /\s([2-9]|1\d)$/.test(line) ? this.slavePause : 0;
        if (pause) setTimeout(() => this._page(), pause); else this._page();
      }
    }
    _page() {
      const p = this.pages.shift();
      let s = p.join("\r\n") + "\r\n";
      if (this.pages.length) s += "Press [Enter] to be continued,other key to exit";
      else { s += "Command completed successfully\r\n$$\r\npylon_debug>"; this.pages = null; }
      this._tx(s);
    }
  }

  const api = { FakePort, model };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CSDemo = api;
})(typeof window !== "undefined" ? window : globalThis);
