/* CellScope – rozbor textových výpisů konzole Pylontech (US2000 / US3000 / US5000).
   Ověřeno na US5000 FW B69.16.0.0 (pwr, bat, info, stat, soh, log, data history, time).
   Funguje v prohlížeči (window.CSParse) i v Node (module.exports) kvůli testům. */
(function (root) {
  "use strict";

  /* odstraní ozvěnu příkazu, „@“, „$$“, prompt a výzvy ke stránkování */
  function clean(txt) {
    return String(txt || "")
      .replace(/\r/g, "")
      .replace(/Press \[Enter\] to be continued,other key to exit\s*/g, "\n")
      .split("\n")
      .filter(l => !/^\s*(@|\$\$|pylon\w*>.*|Command completed successfully)\s*$/.test(l))
      .join("\n");
  }

  const num = s => {
    if (s == null) return null;
    const m = String(s).match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  /* teploty: konzole dává m°C (18500), starší FW někdy °C */
  const temp = v => (v == null ? null : Math.abs(v) > 200 ? Math.round(v / 100) / 10 : v);

  /* pwr – tabulka modulů, mapuje se podle hlavičky (sloupce se mezi FW liší) */
  function pwr(txt) {
    const lines = clean(txt).split("\n");
    const hi = lines.findIndex(l => /^\s*Power\s+Volt/.test(l));
    if (hi < 0) return [];
    const head = lines[hi].trim().split(/\s+/);
    const out = [];
    for (const l of lines.slice(hi + 1)) {
      let t = l.trim().split(/\s+/);
      if (!t.length || !/^\d+$/.test(t[0])) continue;
      // datum a čas jsou dvě slova → spojit
      const di = t.findIndex((x, i) => /^\d{4}-\d{2}-\d{2}$/.test(x) && /^\d{2}:\d{2}:\d{2}$/.test(t[i + 1] || ""));
      if (di > 0) t = [...t.slice(0, di), t[di] + " " + t[di + 1], ...t.slice(di + 2)];
      const id = +t[0];
      if (/absent/i.test(l) || t[1] === "-" || t.length < 6) { out.push({ id, present: false }); continue; }
      const r = {};
      head.forEach((h, i) => (r[h] = t[i]));
      out.push({
        id, present: true,
        volt: num(r.Volt) / 1000,
        curr: num(r.Curr) / 1000,
        temp: temp(num(r.Tempr)),
        tlow: temp(num(r.Tlow)), thigh: temp(num(r.Thigh)),
        vlow: num(r.Vlow), vhigh: num(r.Vhigh),
        state: r["Base.St"] || null,
        soc: num(r.Coulomb),
        time: r.Time || null,
        mos: r.MosTempr != null ? temp(num(r.MosTempr)) : null,
        st: Object.fromEntries(["Volt.St", "Curr.St", "Temp.St", "B.V.St", "B.T.St", "M.T.St"]
          .filter(k => r[k] != null).map(k => [k, r[k]]))
      });
    }
    return out;
  }

  /* bat N – 15 (nebo 16) článků: idx mV mA m°C stavy… SOC Coulomb BAL */
  function bat(txt) {
    const cells = [];
    for (const l of clean(txt).split("\n")) {
      const t = l.trim().split(/\s+/);
      if (t.length < 5 || !/^\d+$/.test(t[0]) || !/^\d+$/.test(t[1])) continue;
      const mv = +t[1];
      if (mv < 2000 || mv > 4000) continue;
      const last = t[t.length - 1];
      cells.push({
        i: +t[0] + 1, mv,
        temp: temp(num(t[3])),
        bal: /^(Y|Yes)$/i.test(last),
        soc: num((t.find(x => /^\d{1,3}%$/.test(x)) || ""))
      });
    }
    return cells.sort((a, b) => a.i - b.i);
  }

  /* info / stat – řádky „Klíč : hodnota“ */
  function kv(txt) {
    const o = {};
    for (const l of clean(txt).split("\n")) {
      let m = l.match(/^\s*([A-Za-z][\w .@#\/-]*?)\s*:\s*(.*?)\s*$/);
      if (!m) m = l.match(/^\s*(Device address)\s+(\d+)\s*$/);
      if (m && m[1]) o[m[1].trim()] = m[2].trim();
    }
    return o;
  }
  function info(txt) {
    const o = kv(txt);
    return {
      addr: num(o["Device address"]),
      name: o["Device name"] || null,
      board: o["Board version"] || null,
      mainSoft: o["Main Soft version"] || null,
      soft: o["Soft  version"] || o["Soft version"] || null,
      release: o["Release Date"] || null,
      barcode: o["Barcode"] || null,
      spec: o["Specification"] || null,
      cells: num(o["Cell Number"]),
      raw: o
    };
  }
  /* počítadla ze stat → čísla; SOH 0 = hodnota není k dispozici */
  function stat(txt) {
    const o = kv(txt), n = {};
    for (const [k, v] of Object.entries(o)) {
      const x = num(v);
      if (x != null) n[k.replace(/\s+/g, " ")] = x;
    }
    return {
      addr: n["Device address"] ?? null,
      cycles: n["CYCLE Times"] ?? null,
      soh: n["SOH"] ? n["SOH"] : null,
      percent: n["Pwr Percent"] ?? null,
      counters: n
    };
  }

  /* soh N – článek, napětí, počet, stav */
  function soh(txt) {
    const out = [];
    for (const l of clean(txt).split("\n")) {
      const t = l.trim().split(/\s+/);
      if (t.length >= 4 && /^\d+$/.test(t[0]) && /^\d+$/.test(t[1]) && /^\d+$/.test(t[2]))
        out.push({ i: +t[0] + 1, mv: +t[1], count: +t[2], status: t[3] });
    }
    return out;
  }

  /* log – bloky Index / Time / ModID / Code / Info */
  function log(txt) {
    const out = [];
    let cur = null;
    for (const l of clean(txt).split("\n")) {
      const m = l.match(/^\s*(Index|Time|ModID|Code|Info)\s*:\s*(.*?)\s*$/);
      if (!m) continue;
      if (m[1] === "Index") { cur = { index: +m[2] }; out.push(cur); }
      else if (cur) cur[m[1].toLowerCase()] = m[2];
    }
    out.forEach(e => { e.date = toIso(e.time); });
    return out;
  }

  /* „26-11-09 19:59:49“ nebo „2026-11-09 20:23:45“ → ISO bez zóny */
  function toIso(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{2,4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const y = m[1].length === 2 ? 2000 + +m[1] : +m[1];
    const p = x => String(x).padStart(2, "0");
    return `${y}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}:${m[6]}`;
  }

  function time(txt) {
    const m = clean(txt).match(/RTC\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    return m ? toIso(m[1]) : null;
  }

  /* data history [item] – jeden záznam: souhrn + články */
  function history(txt) {
    const c = clean(txt);
    if (!/Rec Item Index/.test(c)) return null;
    const o = kv(c);
    return {
      index: num(o["Rec Item Index"]),
      time: toIso(o["Time"]),
      volt: num(o["Voltage"]) / 1000,
      curr: num(o["Current"]) / 1000,
      temp: temp(num(o["Temperature"])),
      soc: num(o["Percent"]),
      state: o["Base State"] || null,
      volts: o["Volt. State"] || null, currs: o["Curr. State"] || null, temps: o["Tempr. State"] || null,
      pwrEvents: o["Power Events"] || null, batEvents: o["Bat Events"] || null, fault: o["System Fault"] || null,
      cells: bat(c.split(/-{10,}/).pop()).map(x => x.mv)
    };
  }

  /* data event – zatím bez ukázky s obsahem: vrací neprázdné řádky */
  function events(txt) {
    return clean(txt).split("\n").map(s => s.trim()).filter(s => s && !/^data event$/i.test(s));
  }

  const api = { clean, pwr, bat, info, stat, soh, log, time, history, events, toIso };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CSParse = api;
})(typeof window !== "undefined" ? window : globalThis);
