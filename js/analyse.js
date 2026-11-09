/* CellScope – vyhodnocení měření podle hranic (výchozí hodnoty odsouhlasené pro HA „Zdraví baterie“). */
(function (root) {
  "use strict";

  const DEF_THR = { spread: 30, dev: 15, lo: 3.05, hi: 3.55, temp: 5, endS: 60, endD: 25, mos: 5, clock: 10, hist: 100 };

  /* počítadla ze „stat“: [text, úroveň] – 1 = sledovat (upozornění), 2 = problém (zásah ochrany) */
  const CNT = {
    "Bat OV Times": ["bat_ov", 2], "Bat HV Times": ["bat_hv", 1], "Bat LV Times": ["bat_lv", 1], "Bat UV Times": ["bat_uv", 2],
    "Pwr OV Times": ["pwr_ov", 2], "Pwr HV Times": ["pwr_hv", 1], "Pwr LV Times": ["pwr_lv", 1], "Pwr UV Times": ["pwr_uv", 2],
    "COC Times": ["coc", 2], "COC2 Times": ["coc", 2], "COCA Times": ["coc", 2],
    "DOC Times": ["doc", 2], "DOC2 Times": ["doc", 2], "DOCA Times": ["doc", 2], "SC Times": ["sc", 2],
    "COT Times": ["t_chg_hi", 2], "CHT Times": ["t_chg_hi", 2], "CUT Times": ["t_chg_lo", 2], "CLT Times": ["t_chg_lo", 2],
    "DOT Times": ["t_dis_hi", 2], "DHT Times": ["t_dis_hi", 2], "DUT Times": ["t_dis_lo", 2], "DLT Times": ["t_dis_lo", 2],
    "Shut Times": ["shut", 2], "BMICERR Times": ["bmic", 2], "SOH Times": ["soh", 2],
    "LifeWarn Times": ["life", 2], "LifeAlarm Times": ["life", 2], "Input OV Times": ["inov", 2]
  };

  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const mv = m => (m.cells || []).map(c => c.mv);

  /* sečte počítadla jednoho modulu podle textu → [{label, n, lvl}] */
  function counters(stat) {
    const g = {};
    for (const [k, [label, lvl]] of Object.entries(CNT)) {
      const n = stat && stat.counters ? stat.counters[k] || 0 : 0;
      if (!n) continue;
      g[label] = g[label] || { label, n: 0, lvl };
      g[label].n += n;
      g[label].lvl = Math.max(g[label].lvl, lvl);
    }
    return Object.values(g).sort((a, b) => b.lvl - a.lvl || b.n - a.n);
  }

  function analyse(d, thr = DEF_THR, prev = null) {
    const th = Object.assign({}, DEF_THR, thr);
    const F = [];
    let lvl = 0;
    const add = (l, k, v = {}) => { lvl = Math.max(lvl, l); F.push({ l, k, v }); };
    const mods = d.modules || [];
    const all = [];
    mods.forEach(m => mv(m).forEach((v, i) => all.push({ m: m.id, c: i + 1, v })));
    if (!all.length) return { lvl: 0, f: [], spread: null, min: null, max: null, lim: { s: th.spread, d: th.dev }, mosHot: [], clockBad: false, empty: true };

    // neúplně načtené moduly (chybí články, info nebo statistika)
    mods.forEach(m => {
      const miss = [!(m.cells || []).length && "bat", !(m.info && m.info.barcode) && "info", !(m.stat && m.stat.cycles != null) && "stat", !(m.soh || []).length && "soh"].filter(Boolean);
      if (miss.length) add(1, "f_noread", { m: m.id, what: miss.join(", ") });
    });
    const min = all.reduce((a, b) => (b.v < a.v ? b : a));
    const max = all.reduce((a, b) => (b.v > a.v ? b : a));
    const spread = max.v - min.v;
    const endChg = max.v >= 3450 || mods.some(m => (m.pwr && m.pwr.soc) >= 97);
    const lim = endChg ? { s: th.endS, d: th.endD } : { s: th.spread, d: th.dev };

    // stavy z pwr – cokoli jiného než Normal je problém
    mods.forEach(m => Object.entries((m.pwr && m.pwr.st) || {}).forEach(([s, v]) => { if (!/^normal$/i.test(v)) add(2, "f_state", { m: m.id, s, v }); }));
    // napětí článků mimo rozsah
    all.forEach(x => { if (x.v / 1000 < th.lo || x.v / 1000 > th.hi) add(2, "f_range", { m: x.m, c: x.c, v: x.v / 1000, lo: th.lo, hi: th.hi }); });
    // rozptyl baterie
    if (spread > lim.s) add(1, "f_spread", { s: spread, l: lim.s });
    // článek proti průměru modulu
    let maxDev = 0;
    mods.forEach(m => {
      const a = avg(mv(m));
      mv(m).forEach((v, i) => {
        const dv = v - a;
        if (Math.abs(dv) > Math.abs(maxDev)) maxDev = dv;
        if (Math.abs(dv) > lim.d) add(1, "f_dev", { m: m.id, c: i + 1, d: dv });
      });
    });
    // nízká teplota článků
    mods.forEach(m => {
      const ts = (m.cells || []).map(c => c.temp).filter(x => x != null);
      if (ts.length && Math.min(...ts) < th.temp) add(1, "f_temp", { m: m.id, t: Math.min(...ts), l: th.temp });
    });
    // teplota MOSFET proti ostatním modulům
    const mosHot = [];
    const withMos = mods.filter(m => m.pwr && m.pwr.mos != null);
    if (withMos.length > 1) withMos.forEach(m => {
      const o = avg(withMos.filter(x => x !== m).map(x => x.pwr.mos));
      const dv = m.pwr.mos - o;
      if (dv > th.mos) { mosHot.push(m.id); add(1, "f_mos", { m: m.id, t: m.pwr.mos, d: dv }); }
    });
    // počítadla ochran ze stat
    mods.forEach(m => counters(m.stat).forEach(c => add(c.lvl, c.lvl === 2 ? "f_stat_bad" : "f_stat_watch", { m: m.id, what: "cnt_" + c.label, n: c.n })));
    // SOH po článcích
    mods.forEach(m => (m.soh || []).forEach(c => { if (c.count > 0 || !/^normal$/i.test(c.status)) add(1, "f_soh", { m: m.id, c: c.i, s: c.status, n: c.count }); }));
    // restarty BMS navíc od minulého měření
    if (prev) mods.forEach(m => {
      const p = (prev.modules || []).find(x => x.id === m.id && x.info && m.info && x.info.barcode === m.info.barcode);
      const a = m.stat && m.stat.counters["Reset Times"], b = p && p.stat && p.stat.counters["Reset Times"];
      if (a != null && b != null && a > b) add(1, "f_reset", { m: m.id, n: a - b });
    });
    // hodiny baterie – jen upozornění, neovlivní verdikt
    const clockBad = d.clockOff != null && Math.abs(d.clockOff) > th.clock;
    if (clockBad) F.push({ l: 0, k: "f_clock", v: { d: d.clockOff } });
    if (endChg) F.push({ l: 0, k: "f_endchg", v: {} });

    F.sort((a, b) => b.l - a.l);
    return { lvl, f: F, spread, min, max, maxDev, lim, endChg, mosHot, clockBad };
  }

  /* rozptyl článků v historii (master modul) */
  function histSeries(d) {
    return (d.history || []).filter(h => h.cells && h.cells.length).map(h => ({
      t: h.time, soc: h.soc, spread: Math.max(...h.cells) - Math.min(...h.cells), curr: h.curr
    }));
  }

  const api = { DEF_THR, CNT, analyse, counters, histSeries, avg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CSAnalyse = api;
})(typeof window !== "undefined" ? window : globalThis);
