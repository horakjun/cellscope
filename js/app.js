/* CellScope – uživatelské rozhraní. */
(function () {
  "use strict";
  const L = window.CSI18N, P = window.CSParse, C = window.CSConsole, A = window.CSAnalyse, DB = window.CSStore;
  const VERSION = "1.1.0";
  const REPO = "https://github.com/horakjun/cellscope";

  /* ---------- stav ---------- */
  const S = {
    lang: "cs", theme: "system", tab: "connect", thr: { ...A.DEF_THR }, histOn: true,
    company: { name: "", addr: "", ico: "", contact: "" }, logo: null,
    customers: [], custId: null, newCust: false,
    meas: null, prev: null, demo: false, sel: 1,
    busy: false, log: [], pct: 0, err: null, cable: null, delArm: null
  };

  /* ---------- pomocníci ---------- */
  const t = (k, v = {}) => (L[S.lang][k] ?? L.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? ""));
  const loc = () => L[S.lang]._loc;
  const nf = (n, d = 0) => (n == null || isNaN(n) ? "–" : new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }).format(n));
  const df = s => (s ? new Intl.DateTimeFormat(loc(), { dateStyle: "medium" }).format(new Date(s)) : "–");
  const dtf = s => (s ? new Intl.DateTimeFormat(loc(), { dateStyle: "short", timeStyle: "short" }).format(new Date(s)) : "–");
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const durf = min => { if (min == null) return "–"; const s = min < 0 ? "−" : "+", a = Math.abs(min), h = Math.floor(a / 60), m = a % 60; return s + (h ? h + " h " : "") + m + " min"; };
  const sgn = (n, d = 0) => (n > 0 ? "+" : "") + nf(n, d);
  const $ = id => document.getElementById(id);
  const LV = ["ok", "watch", "bad"];
  const avg = A.avg;
  const realTime = iso => (iso && S.meas && S.meas.data.clockOff != null ? new Date(new Date(iso).getTime() - S.meas.data.clockOff * 60000) : iso ? new Date(iso) : null);
  const stateTxt = s => /^charge/i.test(s || "") ? t("st_chg") : /^dis/i.test(s || "") ? t("st_dis") : /^idle/i.test(s || "") ? t("st_idle") : (s || "–");
  const cust = id => S.customers.find(c => c.id === id);
  const VENDORS = { 0x067b: "Prolific PL2303", 0x0403: "FTDI", 0x1a86: "WCH CH340", 0x10c4: "Silicon Labs CP210x" };

  function toast(msg) {
    const el = $("toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (el.hidden = true), 4200);
  }
  function download(name, text, type = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  /* text nálezu – {what} je klíč popisu počítadla, čísla se formátují podle jazyka */
  function ftxt(f) {
    const v = { ...f.v };
    if (v.what && f.k !== "f_noread") v.what = t(v.what);
    if (f.k === "f_range") { v.v = nf(v.v, 3); v.lo = nf(v.lo, 2); v.hi = nf(v.hi, 2); }
    if (f.k === "f_dev") v.d = sgn(Math.round(v.d));
    if (f.k === "f_temp" || f.k === "f_mos") { v.t = nf(v.t, 1); if (v.d != null) v.d = nf(v.d, 1); }
    if (f.k === "f_clock") v.d = durf(v.d);
    return t(f.k, v);
  }

  /* ---------- měření ---------- */
  const mods = () => (S.meas ? S.meas.data.modules : []);
  const mv = m => m.cells.map(c => c.mv);
  const res = () => A.analyse(S.meas.data, S.thr, S.prev && S.prev.data);

  async function loadCustomers() {
    S.customers = (await DB.all("customers")).sort((a, b) => a.name.localeCompare(b.name, loc()));
  }
  async function measOf(custId) {
    return (await DB.all("measurements")).filter(m => m.custId === custId).sort((a, b) => b.date.localeCompare(a.date));
  }
  async function setMeas(m) {
    S.meas = m; S.demo = !!(m && m.demo); S.sel = null; S.prev = null;
    if (m && m.custId) {
      const list = await measOf(m.custId);
      S.prev = list.find(x => x.date < m.date) || null;
    }
  }

  /* ---------- čtení baterie ---------- */
  async function readBattery(demo) {
    if (S.busy) return;
    let port, custId = null;
    if (!demo) {
      if (!("serial" in navigator)) { S.err = t("no_serial"); return render(); }
      if (S.newCust || !S.custId) {
        const name = ($("newcust") && $("newcust").value.trim()) || "";
        if (!name) { toast(t("cust_name_ph")); $("newcust") && $("newcust").focus(); return; }
      }
      try { port = await navigator.serial.requestPort(); }
      catch (e) { toast(t("err_cancel")); return; }
      if (S.newCust || !S.custId) {
        const c = { id: DB.uid(), name: $("newcust").value.trim(), created: new Date().toISOString() };
        await DB.put("customers", c); await loadCustomers(); S.custId = c.id; S.newCust = false;
        DB.setSetting("lastCust", c.id);
      }
      custId = S.custId;
    } else {
      port = new window.CSDemo.FakePort({ asleep: true, delay: 12 });
    }
    const info = port.getInfo ? port.getInfo() : {};
    const portName = demo ? t("demo_badge") : (VENDORS[info.usbVendorId] || "USB") + (info.usbVendorId ? ` ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId || 0).toString(16).padStart(4, "0")}` : "");
    S.busy = true; S.err = null; S.log = []; S.pct = 0; S.cable = null;
    render();
    const link = new C.Link(port);
    const logLine = s => { S.log.push(s); const el = $("con"); if (el) { el.textContent = S.log.join("\n"); el.scrollTop = el.scrollHeight; } };
    try {
      const data = await C.readAll(link, { history: S.histOn ? S.thr.hist : 1, portName },
        st => { S.pct = st.pct; const pg = $("pg"); if (pg) pg.style.width = st.pct + "%"; logLine((st.key === "step_done" ? "✓ " : "› ") + t(st.key, st.vars)); },
        c => { if (!/^data history \d/.test(c)) logLine("pylon> " + c); });
      data.port = portName;
      const rec = { id: demo ? "demo" : DB.uid(), custId, date: data.pcTime, data, note: "", demo: !!demo, version: VERSION };
      if (!demo) { await DB.put("measurements", rec); toast(t("saved", { c: cust(custId).name })); }
      await setMeas(rec);
      S.busy = false; S.tab = "overview";
      render(); window.scrollTo(0, 0);
    } catch (e) {
      try { await link.close(); } catch (x) {}
      S.busy = false;
      S.err = e.message === "NO_RESPONSE" ? t("err_noresp") : /open|NetworkError|InvalidState/i.test(e.name + " " + e.message) ? t("err_port") : e.message;
      render();
    }
  }

  async function cableTest() {
    if (S.busy) return;
    if (!("serial" in navigator)) { S.err = t("no_serial"); return render(); }
    let port;
    try { port = await navigator.serial.requestPort(); } catch (e) { toast(t("err_cancel")); return; }
    const link = new C.Link(port);
    S.busy = true; render();
    let ok = false;
    try {
      await link.open(C.BAUD);
      ok = await link.ping();
      if (!ok) { await link.wakeUp(); ok = await link.ping(); }
    } catch (e) { S.err = t("err_port"); }
    try { await link.close(); } catch (e) {}
    S.busy = false; S.cable = ok; render();
  }

  /* ---------- obrazovky ---------- */
  const V = {};
  const kpi = (l, v, e, c = "") => `<div class="kpi ${c}"><small>${l}</small><b>${v}</b><em>${e || "&nbsp;"}</em></div>`;
  const emptyState = () => `<section class="panel empty"><h1>${t("empty_title")}</h1><p class="muted">${t("empty_text")}</p>
    <div class="row" style="justify-content:center"><button class="btn primary" data-go="connect">${t("nav_connect")}</button><button class="btn" data-act="demo">${t("demo_btn")}</button></div></section>`;

  V.connect = () => {
    const ser = "serial" in navigator;
    const opts = S.customers.map(c => `<option value="${c.id}" ${c.id === S.custId && !S.newCust ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    const showNew = S.newCust || !S.customers.length;
    return `
<div class="grid2">
 <section class="panel">
  <h1>${t("nav_connect")}</h1>
  ${ser ? `<p class="muted">${t("conn_help")}</p>` : `<div class="alert">${t("no_serial")}</div>`}
  <div class="row">
   <div class="field" style="flex:1;min-width:220px"><label for="custsel">${t("customer")}</label>
    <select id="custsel">${opts}<option value="__new" ${showNew ? "selected" : ""}>${t("new_customer")}</option></select></div>
   ${showNew ? `<div class="field" style="flex:1;min-width:220px"><label for="newcust">${t("cust_name_ph")}</label><input id="newcust" autocomplete="off"></div>` : ""}
  </div>
  <div class="row center">
   <label class="check"><input type="checkbox" id="histon" ${S.histOn ? "checked" : ""}> ${t("read_hist")}</label>
   <div class="field"><label for="histn">${t("hist_count")}</label><input id="histn" type="number" min="1" max="2000" step="10" value="${S.thr.hist}" style="width:110px"></div>
  </div>
  <div class="row center">
   <button class="btn primary" data-act="read" ${S.busy || !ser ? "disabled" : ""}>${S.busy ? t("conn_busy") : t("connect")}</button>
   <button class="btn" data-act="cable" ${S.busy || !ser ? "disabled" : ""}>${t("cable_test")}</button>
   <button class="btn" data-act="demo" ${S.busy ? "disabled" : ""}>${t("demo_btn")}</button>
  </div>
  ${S.cable != null ? `<p class="${S.cable ? "" : "alert warn"}">${S.cable ? "✓ " + t("cable_ok") : t("cable_none")}</p>` : ""}
  ${S.err ? `<div class="alert">${esc(S.err)}</div>` : ""}
  <div class="prog"><i id="pg" style="width:${S.pct}%"></i></div>
  <p class="muted" style="font-size:12.5px">${t("install_hint")}</p>
 </section>
 <section class="panel">
  <h2>${t("log_title")}</h2>
  <div class="console" id="con" aria-live="polite">${esc(S.log.join("\n"))}</div>
 </section>
</div>`;
  };

  /* ---------- přehled ve stylu karty „Zdraví baterie“ z HA ---------- */
  const COL = ["#34d399", "#f59e0b", "#ef4444"];
  const RANGE = 20;   // mV – plná barva článku při odchylce ±20 mV od průměru baterie (jako v HA)
  const cellColor = (v, p) => {
    const x = Math.max(-1, Math.min(1, (v - p) / RANGE)), u = Math.abs(x);
    const hue = x < 0 ? 150 + 65 * u : 150 - 150 * x;
    return `hsl(${hue.toFixed(0)},${(55 + 35 * u).toFixed(0)}%,${(36 + 8 * u).toFixed(0)}%)`;
  };
  const kwhOf = M => {
    const m = String((M[0] && M[0].info && M[0].info.spec) || "").match(/(\d+(?:\.\d+)?)\s*V\s*\/\s*(\d+(?:\.\d+)?)\s*AH/i);
    return m ? +m[1] * +m[2] / 1000 * M.length : null;
  };

  /* sloupcový graf rozptylu článků z historie BMS (jako denní špičky v HA) */
  function spreadBars(ser, lim, W = 480, H = 100) {
    if (ser.length < 2) return "";
    const top = Math.max(lim * 1.4, 10, ...ser.map(s => s.spread));
    const bw = W / Math.max(ser.length, 30), x0 = W - ser.length * bw;
    let g = `<svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="${esc(t("hist_title"))}">`;
    ser.forEach((s, i) => {
      const h = Math.max(1, Math.min(s.spread, top) / top * H);
      const fill = s.spread > lim ? "#ef4444" : s.spread > lim * 0.75 ? "#f59e0b" : "#34d399";
      g += `<rect x="${(x0 + i * bw + 0.5).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${fill}"><title>${esc(dtf(realTime(s.t)))}: ${s.spread} mV · SOC ${s.soc} %</title></rect>`;
    });
    const ly = H - lim / top * H;
    g += `<line x1="0" x2="${W}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#ef4444" stroke-dasharray="5 4"/><text x="2" y="${(ly - 4).toFixed(1)}" style="fill:#ef4444">limit ${lim} mV</text>`;
    g += `<text x="${Math.max(0, Math.min(x0, W - 160)).toFixed(1)}" y="${H + 13}">${esc(dtf(realTime(ser[0].t)))}</text><text x="${W}" y="${H + 13}" text-anchor="end">${esc(dtf(realTime(ser[ser.length - 1].t)))}</text></svg>`;
    return g;
  }

  V.overview = () => {
    if (!S.meas) return emptyState();
    const a = res(), d = S.meas.data, M = d.modules, th = S.thr;
    const pw = M.map(m => m.pwr || {});
    const type = (M[0] && M[0].info && M[0].info.name) || "US";
    const kwh = kwhOf(M);
    const sohs = M.map(m => m.stat && m.stat.soh).filter(x => x != null);
    const soh = sohs.length ? Math.min(...sohs) : null;
    const cyc = M.map(m => m.stat && m.stat.cycles).filter(x => x != null);
    const cycles = cyc.length ? Math.max(...cyc) : null;
    const read = M.filter(m => m.cells.length).length;
    const temps = M.flatMap(m => m.cells.map(c => c.temp)).filter(x => x != null);
    const tlo = temps.length ? Math.min(...temps) : null, thi = temps.length ? Math.max(...temps) : null;
    const mosL = M.filter(m => m.pwr && m.pwr.mos != null);
    const mosMax = mosL.length ? mosL.reduce((x, m) => (m.pwr.mos > x.pwr.mos ? m : x)) : null;
    const alarms = a.f.filter(f => f.k === "f_state");
    const ser = A.histSeries(d), hmax = ser.length ? Math.max(...ser.map(s => s.spread)) : null;
    const lim = a.lim.s;
    const col = COL[a.lvl];

    /* hodnocení – body s barevnými tečkami */
    const li = [];
    const fl = k => a.f.filter(f => f.k === k);
    li.push([a.spread > lim ? COL[1] : COL[0], `<b>${t("li_bal")}</b> ${a.spread > lim ? t("li_bal_w", { s: a.spread, l: lim }) : t("li_bal_ok", { s: a.spread })}${hmax != null ? t("li_bal_h", { h: hmax }) : ""}`]);
    let worst = null;
    M.forEach(m => { const p = avg(mv(m)); m.cells.forEach(c => { const dv = c.mv - p; if (!worst || dv < worst.d) worst = { m: m.id, c: c.i, d: dv }; }); });
    if (worst) {
      const bad = Math.abs(worst.d) > a.lim.d;
      li.push([bad ? COL[1] : COL[0], `<b>${t("li_cel")}</b> ${t("li_cel_t", { s: a.spread, m: worst.m, c: worst.c, d: nf(worst.d, 1) })}${bad ? t("li_cel_w") : t("li_cel_ok")}`]);
    }
    if (tlo != null) li.push([tlo < th.temp ? COL[1] : COL[0], `<b>${t("li_tmp")}</b> ${tlo < th.temp ? t("li_tmp_w", { a: nf(tlo, 1), b: nf(thi, 1), l: th.temp }) : t("li_tmp_ok", { a: nf(tlo, 1), b: nf(thi, 1) })}`]);
    if (soh != null) li.push([soh < 90 ? COL[1] : COL[0], `<b>${t("li_soh")}</b> ${t("li_soh_t", { s: soh, c: cycles ?? "–", v: t(soh >= 95 ? "soh_v1" : soh >= 90 ? "soh_v2" : "soh_v3") })}`]);
    if (mosL.length > 1) {
      const hot = fl("f_mos");
      li.push(hot.length ? [COL[1], `<b>${t("li_mos")}</b> ${hot.map(ftxt).map(esc).join(" ")}`] : [COL[0], `<b>${t("li_mos")}</b> ${t("li_mos_ok", { a: nf(Math.min(...mosL.map(m => m.pwr.mos)), 1), b: nf(mosMax.pwr.mos, 1) })}`]);
    }
    const bmsF = a.f.filter(f => /^f_stat|^f_soh|^f_reset/.test(f.k));
    const bmsL = Math.max(0, ...bmsF.map(f => f.l));
    li.push([bmsF.length || (d.events || []).length ? COL[bmsL || 1] : COL[0], `<b>${t("li_bms")}</b> ${bmsF.length || (d.events || []).length ? t("li_bms_w", { n: bmsF.length + (d.events || []).length }) : t("li_bms_ok")}`]);
    fl("f_range").forEach(f => li.push([COL[2], `<b>${t("li_cel")}</b> ${esc(ftxt(f))}`]));
    if (alarms.length) li.push([COL[2], `<b>${t("li_al")}</b> ${alarms.map(ftxt).map(esc).join(" ")}`]);
    fl("f_noread").forEach(f => li.push([COL[1], `<b>${t("li_rd")}</b> ${esc(ftxt(f))}`]));
    if (d.clockOff != null) li.push(["#60a5fa", `<b>${t("li_clk")}</b> ${a.clockBad ? t("li_clk_w", { d: durf(d.clockOff) }) : t("li_clk_ok")}`]);

    /* pruh modulů: největší odchylka článku pod / nad průměrem modulu */
    const md = M.map(m => {
      const v = mv(m);
      if (!v.length) return `<span data-mod="${m.id}" style="background:#334155"><b>${m.id}</b><br><small>–</small></span>`;
      const p = avg(v), lo = Math.min(...v) - p, hi = Math.max(...v) - p, s = Math.max(-lo, hi);
      const bg = s > a.lim.d ? "#b45309" : s > a.lim.d / 2 ? "#0f766e" : "#065f46";
      return `<span data-mod="${m.id}" style="background:${bg}${S.sel === m.id ? ";box-shadow:inset 0 0 0 2px #93c5fd" : ""}"><b>${m.id}</b><br><small>${-lo >= 1 ? "▼" + nf(-lo, 0) : "&nbsp;"}${hi >= 1 ? " ▲" + nf(hi, 0) : ""}</small></span>`;
    }).join("");

    /* mapa všech článků: moduly ve sloupcích, články v řádcích */
    const all = M.flatMap(m => mv(m)), pAll = avg(all);
    const n = Math.max(0, ...M.map(m => m.cells.length));
    const sel = S.sel, lo = a.min, hi = a.max;
    let g = `<div class="gscroll"><div class="gr" style="grid-template-columns:2.4em repeat(${M.length},minmax(42px,1fr));min-width:${40 + M.length * 46}px"><div></div>`;
    M.forEach(m => { g += `<button class="hd${sel === m.id ? " sel" : ""}" data-mod="${m.id}"><b>${m.id}</b><small>${m.pwr && m.pwr.soc != null ? m.pwr.soc + " %" : ""}</small></button>`; });
    for (let c = 0; c < n; c++) {
      g += `<div class="rl">${c + 1}</div>`;
      M.forEach(m => {
        const x = m.cells[c];
        if (!x) { g += "<div></div>"; return; }
        const k = (m.id === lo.m && c + 1 === lo.c ? " lo" : "") + (m.id === hi.m && c + 1 === hi.c ? " hi" : "") + (x.bal ? " bl" : "") + (sel && sel !== m.id ? " dm" : "");
        g += `<div class="ce${k}" data-mod="${m.id}" style="background:${cellColor(x.mv, pAll)}" title="${esc(t("det_t", { m: m.id }))} · ${t("cell")} ${c + 1}: ${x.mv} mV · ${nf(x.temp, 1)} °C">${x.mv}</div>`;
      });
    }
    g += "</div></div>";
    const bal = M.reduce((s, m) => s + m.cells.filter(c => c.bal).length, 0);

    /* detail vybraného modulu */
    let det = "";
    const sm = sel && M.find(m => m.id === sel);
    if (sm && sm.cells.length) {
      const cl = mv(sm), p = avg(cl), mn = Math.min(...cl), mx = Math.max(...cl), p0 = sm.pwr || {}, s0 = sm.stat || {}, i0 = sm.info || {};
      const W = 1200, Hh = 80, bw = W / cl.length, rr = Math.max(5, ...cl.map(v => Math.abs(v - p)));
      let sv = `<svg viewBox="0 0 ${W} ${Hh + 30}"><line x1="0" x2="${W}" y1="${Hh / 2}" y2="${Hh / 2}" stroke="rgba(255,255,255,.25)" stroke-dasharray="3 3"/>`;
      sm.cells.forEach((c, i) => {
        const dv = c.mv - p, h = Math.abs(dv) / rr * (Hh / 2 - 4), y = dv >= 0 ? Hh / 2 - h : Hh / 2;
        sv += `<rect x="${(i * bw + 3).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${cellColor(c.mv, pAll)}"/>`;
        sv += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${Hh + 14}" text-anchor="middle" style="fill:#e2e8f0">${c.mv}</text><text x="${(i * bw + bw / 2).toFixed(1)}" y="${Hh + 28}" text-anchor="middle">${t("cell_short")} ${i + 1}${c.bal ? " ⚖" : ""}</text>`;
      });
      sv += `<text x="2" y="10">+${nf(rr, 1)} mV</text><text x="2" y="${Hh - 2}">−${nf(rr, 1)} mV</text></svg>`;
      const ts = sm.cells.map(c => c.temp).filter(x => x != null), tset = [...new Set(ts)];
      const bl = sm.cells.filter(c => c.bal).map(c => c.i);
      det = `<div class="dt"><button class="x" data-mod="0">${t("close")}</button><b>${t("det_t", { m: sm.id })}</b> – ${t("det_s", { p: nf(p, 1) })} <span class="muted">· ${esc(i0.barcode || "")} ${i0.soft ? "· FW " + esc(i0.soft) : ""}</span>
        <div class="kp"><div><small>${t("k_voltage")}</small><b>${nf(p0.volt, 2)} V</b><i>${stateTxt(p0.state)}</i></div>
        <div><small>${t("k_current")}</small><b>${nf(p0.curr, 1)} A</b><i>${nf((p0.volt || 0) * (p0.curr || 0), 0)} W</i></div>
        <div><small>SOC · SOH</small><b>${p0.soc != null ? p0.soc + " %" : "–"}</b><i>SOH ${s0.soh != null ? s0.soh + " %" : t("soh_na")} · ${t("th_cycles")} ${s0.cycles ?? "–"}</i></div>
        <div><small>${t("k_spread")}</small><b class="${mx - mn > a.lim.s ? "wa" : "ok"}">${mx - mn} mV</b><i>${mn}–${mx} mV</i></div>
        <div><small>${t("det_tmp")}</small><b>${ts.length ? nf(Math.min(...ts), 1) + "–" + nf(Math.max(...ts), 1) + " °C" : "–"}</b><i>${tset.map(x => nf(x, 1)).join(" · ")} · MOS ${nf(p0.mos, 1)} °C</i></div>
        <div><small>${t("th_bal")}</small><b>${bl.length}</b><i>${bl.length ? t("det_list", { l: bl.join(", ") }) : t("det_none")}</i></div></div>${sv}</div>`;
    }

    /* deník událostí BMS */
    const L0 = (d.log || []).slice(0, 12);
    const ev = `<div class="mp"><div class="mph"><b class="t">${t("ev_t")}</b><span>${t("ev_s", { n: (d.log || []).length })}</span></div>` +
      (L0.length ? `<div class="scroll"><table>${L0.map(e => { const norm = /start (dis)?charg/i.test(e.info || ""); return `<tr><td style="width:1%"><span class="tg" style="background:${norm ? "#94a3b8" : "#f59e0b"}">${norm ? (/dis/i.test(e.info) ? t("st_dis") : t("st_chg")) : esc(e.code || "!")}</span></td><td class="mono" style="width:1%">${dtf(realTime(e.date))}</td><td class="tw">${esc(e.info || "")}</td></tr>`; }).join("")}</table></div>` : `<div class="leg">–</div>`) + `</div>`;

    /* tabulka modulů */
    const tbl = `<div class="mp"><div class="mph"><b class="t">${t("mods_t")}</b></div><div class="scroll"><table>
 <thead><tr><th>${t("th_module")}</th><th>${t("th_type")}</th><th>${t("th_sn")}</th><th>${t("th_fw")}</th><th class="num">${t("k_voltage")}</th><th class="num">${t("k_current")}</th><th class="num">SOC</th><th class="num">SOH</th><th class="num">${t("th_cycles")}</th><th class="num">${t("k_spread")}</th><th class="num">${t("th_mos")}</th><th>${t("th_state")}</th></tr></thead>
 <tbody>${M.map(m => {
   const v = mv(m), sp = v.length ? Math.max(...v) - Math.min(...v) : null, p = m.pwr || {}, i = m.info || {}, s = m.stat || {};
   const nonNorm = Object.values(p.st || {}).some(x => !/^normal$/i.test(x));
   return `<tr class="click" data-mod="${m.id}"><td><b>${m.id}</b>${m.id === M[0].id ? ' <span class="chip">master</span>' : ""}</td><td>${esc(i.name || "–")}</td><td class="mono">${esc(i.barcode || "–")}</td><td class="mono">${esc(i.soft || i.mainSoft || "–")}</td>
   <td class="num">${nf(p.volt, 2)} V</td><td class="num">${sgn(p.curr, 1)} A</td><td class="num">${p.soc != null ? p.soc + " %" : "–"}</td>
   <td class="num">${s.soh == null ? `<span class="muted">${t("soh_na")}</span>` : s.soh < 95 ? `<span class="chip warn">${s.soh} %</span>` : s.soh + " %"}</td>
   <td class="num">${s.cycles ?? "–"}</td><td class="num">${sp != null ? sp + " mV" : "–"}</td>
   <td class="num">${p.mos == null ? "–" : a.mosHot.includes(m.id) ? `<span class="chip warn">${nf(p.mos, 1)} °C</span>` : nf(p.mos, 1) + " °C"}</td>
   <td><span class="chip ${nonNorm ? "bad" : "acc"}">${stateTxt(p.state)}</span></td></tr>`;
 }).join("")}</tbody></table></div></div>`;

    const name = S.demo ? t("demo_badge") : (cust(S.meas.custId) || {}).name || "";
    return `<div class="c" style="--c:${col}">
 <div class="hero"><div class="pic"><img src="${window.CS_BATTERY_IMG || "icons/baterie.webp"}" alt="" onerror="this.style.display='none'"></div>
  <div class="inf"><small>${esc(t("hero", { n: M.length, type, kwh: kwh != null ? nf(kwh, 1) : "–" }))}</small>
   <div class="vd">${t(["vd_ok", "vd_watch", "vd_bad"][a.lvl])}</div>
   <div class="sb">${[alarms.length ? t("sb_al", { n: alarms.length }) : t("sb_al0"), a.spread > lim ? t("sb_bal", { s: a.spread }) : t("sb_bal0"), read < M.length ? t("sb_mod", { a: read, n: M.length }) : t("sb_mod0", { n: M.length })].join(" · ")}</div>
   <div class="sb" style="opacity:.55;margin-top:2px">${esc(name)} · ${dtf(S.meas.date)}</div></div>
  <div class="big"><b>${soh != null ? soh + " %" : "–"}</b><span> SOH</span><br><span>${t("soh_big")}</span></div></div>
 <div class="kp">
  <div><small>${t("kp_cyc")}</small><b>${cycles ?? "–"}</b><i>${cycles != null ? t("kp_cyc_sub", { p: nf(cycles / 6000 * 100, 1), max: 6000 }) : "&nbsp;"}</i></div>
  <div><small>${t("kp_bal")}</small><b class="${a.spread > lim ? "bad" : a.spread > lim * 0.75 ? "wa" : "ok"}">${a.spread} mV</b><i>${t("kp_bal_sub", { l: lim, h: hmax ?? "–" })}</i></div>
  <div><small>${t("kp_tmp")}</small><b class="${tlo != null && tlo < th.temp ? "wa" : ""}">${tlo != null ? nf(tlo, 1) + "–" + nf(thi, 1) + " °C" : "–"}</b><i>${temps.length ? t("kp_tmp_sub", { a: nf(avg(temps), 1) }) : "&nbsp;"}</i></div>
  <div><small>${t("kp_mod")}</small><b class="${read < M.length ? "bad" : "ok"}">${read} / ${M.length}</b><i>${t("kp_mod_sub")}</i></div>
  <div><small>${t("k_mos")}</small><b class="${a.mosHot.length ? "wa" : ""}">${mosMax ? nf(mosMax.pwr.mos, 1) + " °C" : "–"}</b><i>${mosMax ? t("kp_mos_sub", { m: mosMax.id }) : "&nbsp;"}</i></div>
 </div>
 <div class="mid"><div class="ch">${ser.length > 1 ? spreadBars(ser, lim) + `<div class="leg">${t("ch_leg", { n: ser.length })}</div>` : `<div class="leg">${t("ch_none")}</div>`}
   <div class="leg" style="margin-top:12px">${t("md_leg")}</div><div class="md">${md}</div></div>
  <ul class="hl">${li.map(x => `<li><u style="--d:${x[0]}"></u><p>${x[1]}</p></li>`).join("")}</ul></div>
 <div class="mp"><div class="mph"><b class="t">${t("map_t", { n: all.length })}</b><span>${t("map_s", { s: a.spread, a: lo.v, b: hi.v, p: nf(pAll, 1), k: bal })}</span>
   <i>${t("map_time", { t: dtf(S.meas.date) })}</i><button class="bt" data-act="reread" ${S.busy ? "disabled" : ""}>${t("reread")}</button></div>
  ${g}
  <div class="lg"><span>${t("map_lo")}<em></em>${t("map_hi", { r: RANGE })}</span><span>${t("map_fr", { lo: `<b>${lo.m}/${lo.c} ${lo.v} mV</b>`, hi: `<b>${hi.m}/${hi.c} ${hi.v} mV</b>` })}</span><span>${t("map_click")}</span></div>
  ${det}</div>
 ${ev}
 ${tbl}
</div>`;
  };

  V.bms = () => {
    if (!S.meas) return emptyState();
    const d = S.meas.data, M = d.modules, a = res();
    const statF = a.f.filter(f => /^f_stat|^f_soh|^f_reset/.test(f.k));
    const lv = statF.reduce((x, f) => Math.max(x, f.l), 0);
    const ser = A.histSeries(d);
    const flagged = M.flatMap(m => (m.soh || []).filter(c => c.count > 0 || !/^normal$/i.test(c.status)).map(c => ({ m: m.id, ...c })));
    return `
<section class="verdict v-${LV[lv]}"><span class="pill">${t("v_" + LV[lv])}</span><h2>${t("nav_bms")}</h2>
 ${statF.length ? `<ul>${statF.map(f => `<li>${esc(ftxt(f))}</li>`).join("")}</ul>` : `<p>${t("stat_zero")}</p>`}</section>
<section class="panel"><h2>${t("bms_life")} <span class="muted mono" style="font-size:12px">stat</span></h2>
 <div class="scroll"><table><thead><tr><th>${t("th_module")}</th><th class="num">${t("th_cycles")}</th><th class="num">SOH</th><th class="num">${t("cnt_reset")}</th><th>${t("th_counter")}</th></tr></thead>
 <tbody>${M.map(m => { const s = m.stat || { counters: {} }, cs = A.counters(s);
   return `<tr><td><b>${m.id}</b></td><td class="num">${s.cycles ?? "–"}</td><td class="num">${s.soh == null ? `<span class="muted">${t("soh_na")}</span>` : s.soh + " %"}</td><td class="num">${s.counters["Reset Times"] ?? "–"}</td>
   <td class="tw"><div class="chips">${cs.length ? cs.map(c => `<span class="chip ${c.lvl === 2 ? "bad" : "warn"}">${esc(t("cnt_" + c.label))}: ${c.n}×</span>`).join("") : `<span class="chip ok">0</span>`}</div></td></tr>`; }).join("")}</tbody></table></div>
 ${flagged.length ? `<h3>${t("flagged_cells")}</h3><div class="chips">${flagged.map(c => `<span class="chip warn">M${c.m} #${c.i}: ${esc(c.status)} · ${c.count}</span>`).join("")}</div>` : ""}
</section>
<section class="panel"><h2>${t("hist_title")} <span class="muted mono" style="font-size:12px">data history</span></h2>
 ${ser.length > 1 ? `<p class="muted">${t("hist_note", { n: ser.length, a: dtf(realTime(ser[0].t)), b: dtf(realTime(ser[ser.length - 1].t)) })}</p><div class="ch" style="width:100%">${spreadBars(ser, S.thr.spread, 1300, 170)}</div>` : `<p class="muted">${t("hist_none")}</p>`}
</section>
<div class="grid2">
<section class="panel"><h2>${t("bms_log")} <span class="muted mono" style="font-size:12px">log</span></h2>
 ${d.clockOff != null ? `<p class="muted">${esc(t("f_clock", { d: durf(d.clockOff) }))}</p>` : ""}
 <div class="scroll" style="max-height:420px"><table><thead><tr><th>${t("th_real")}</th><th>${t("th_date")}</th><th>${t("th_event")}</th></tr></thead>
 <tbody>${(d.log || []).map(e => `<tr><td class="mono">${dtf(realTime(e.date))}</td><td class="mono muted">${esc(e.time || "")}</td><td class="tw">${/start (dis)?charg/i.test(e.info || "") ? esc(e.info) : `<span class="chip warn">${esc(e.info || e.code || "")}</span>`}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">–</td></tr>`}</tbody></table></div>
</section>
<section class="panel"><h2>${t("ev_title")} <span class="muted mono" style="font-size:12px">data event</span></h2>
 ${(d.events || []).length ? `<div class="console" style="min-height:0">${esc(d.events.join("\n"))}</div>` : `<p><span class="chip ok">✓</span> ${t("ev_none")}</p>`}
 <h2 style="margin-top:8px">${t("info_title")} <span class="muted mono" style="font-size:12px">info</span></h2>
 <div class="scroll"><table><thead><tr><th>${t("th_module")}</th><th>${t("th_type")}</th><th>${t("th_board")}</th><th>FW</th><th>${t("th_release")}</th><th>Spec.</th></tr></thead>
 <tbody>${M.map(m => { const i = m.info || {}; return `<tr><td>${m.id}</td><td>${esc(i.name || "–")}</td><td class="mono">${esc(i.board || "–")}</td><td class="mono">${esc([i.mainSoft, i.soft].filter(Boolean).join(" / ") || "–")}</td><td class="mono">${esc(i.release || "–")}</td><td>${esc(i.spec || "–")}</td></tr>`; }).join("")}</tbody></table></div>
</section></div>`;
  };

  V.compare = () => {
    if (!S.meas) return emptyState();
    if (!S.prev) return `<section class="panel"><h1>${t("nav_compare")}</h1><p class="muted">${S.demo ? t("demo_note") : t("no_prev")}</p></section>`;
    const a = res(), b = A.analyse(S.prev.data, S.thr), M = mods(), PM = S.prev.data.modules;
    const prot = s => A.counters(s).filter(c => c.lvl === 2).reduce((x, c) => x + c.n, 0);
    const rows = [[t("k_spread"), b.spread, a.spread, "mV", -1], [t("k_min"), b.min.v, a.min.v, "mV", 1], [t("maxdev"), Math.round(Math.abs(b.maxDev)), Math.round(Math.abs(a.maxDev)), "mV", -1]];
    M.forEach(m => {
      const p = PM.find(x => x.id === m.id && (!m.info || !x.info || x.info.barcode === m.info.barcode));
      if (!p) return;
      const s = m.stat || {}, ps = p.stat || {};
      if (s.soh != null && ps.soh != null) rows.push([t("soh_m", { m: m.id }), ps.soh, s.soh, "%", 1]);
      if (s.cycles != null && ps.cycles != null) rows.push([t("cyc_m", { m: m.id }), ps.cycles, s.cycles, "", 0]);
      const r1 = s.counters && s.counters["Reset Times"], r0 = ps.counters && ps.counters["Reset Times"];
      if (r1 != null && r0 != null && r1 !== r0) rows.push([t("reset_m", { m: m.id }), r0, r1, "", -1]);
      const q1 = prot(s), q0 = prot(ps);
      if (q1 !== q0) rows.push([t("th_module") + " " + m.id + ": " + t("prot_sum"), q0, q1, "", -1]);
    });
    return `<section class="panel"><h1>${t("cmp_title", { d: df(S.prev.date) })}</h1>
 <div class="row center"><span class="chip ${["ok", "warn", "bad"][b.lvl]}">${t("cmp_prev")}: ${t("v_" + LV[b.lvl])}</span><span class="chip ${["ok", "warn", "bad"][a.lvl]}">${t("cmp_now")}: ${t("v_" + LV[a.lvl])}</span></div>
 <div class="scroll"><table><thead><tr><th></th><th class="num">${t("cmp_prev")}</th><th class="num">${t("cmp_now")}</th><th class="num">${t("cmp_change")}</th><th></th></tr></thead>
 <tbody>${rows.map(([l, p, n, u, dir]) => { const dv = n - p, good = dir === 0 ? null : dv * dir > 0, cls = dv === 0 || dir === 0 ? "" : good ? "delta-better" : "delta-worse";
   return `<tr><td>${esc(l)}</td><td class="num">${p} ${u}</td><td class="num">${n} ${u}</td><td class="num ${cls}">${dv > 0 ? "▲ +" : dv < 0 ? "▼ " : ""}${dv} ${u}</td><td class="${cls}">${dv === 0 ? t("same") : dir === 0 ? "" : good ? t("better") : t("worse")}</td></tr>`; }).join("")}</tbody></table></div></section>`;
  };

  V.customers = () => `
<div class="grid2">
 <section class="panel">
  <div class="row center spread"><h1>${t("cust_title")}</h1>
   <div class="row"><button class="btn small" data-act="export">${t("cust_export")}</button><label class="btn small" for="importf">${t("cust_import")}</label><input type="file" id="importf" accept=".json,application/json" hidden></div></div>
  <div class="row"><div class="field" style="flex:1"><label for="addcust">${t("cust_name_ph")}</label><input id="addcust" autocomplete="off"></div><button class="btn primary" data-act="addcust">${t("add")}</button></div>
  <div class="cust">${S.customers.map(c => `<button data-cust="${c.id}" aria-pressed="${c.id === S.custId}"><b>${esc(c.name)}</b><span></span><small>${df(c.created)}</small></button>`).join("") || `<p class="muted">–</p>`}</div>
 </section>
 <section class="panel" id="measpanel"><h2>${t("meas_list")}</h2><p class="muted">${S.custId ? "…" : t("sel_customer")}</p></section>
</div>
${S.meas && !S.demo ? `<section class="panel"><div class="field"><label for="note">${t("note")} · ${dtf(S.meas.date)}</label><textarea id="note" rows="3" placeholder="${esc(t("note_ph"))}">${esc(S.meas.note || "")}</textarea></div>
 <div><button class="btn small" data-act="raw">${t("raw_export")}</button></div></section>` : ""}`;

  async function fillMeas() {
    const el = $("measpanel");
    if (!el || !S.custId) return;
    const list = await measOf(S.custId);
    el.innerHTML = `<h2>${t("meas_list")} · ${esc((cust(S.custId) || {}).name || "")}</h2>` + (list.length ? `<div class="scroll"><table><thead><tr><th>${t("th_measured")}</th><th>${t("k_modules")}</th><th>${t("rep_result")}</th><th></th></tr></thead><tbody>` +
      list.map(m => { const a = A.analyse(m.data, S.thr); return `<tr><td class="mono">${dtf(m.date)}</td><td>${m.data.modules.length}× ${esc((m.data.modules[0] && m.data.modules[0].info && m.data.modules[0].info.name) || "")}</td><td><span class="chip ${["ok", "warn", "bad"][a.lvl]}">${t("v_" + LV[a.lvl])}</span></td>
       <td><div class="row" style="flex-wrap:nowrap"><button class="btn small ${S.meas && S.meas.id === m.id ? "primary" : ""}" data-open="${m.id}">${t("open")}</button><button class="btn small danger" data-delm="${m.id}">${S.delArm === m.id ? t("del_confirm") : t("del")}</button></div></td></tr>`; }).join("") + "</tbody></table></div>" : `<p class="muted">–</p>`) +
      `<div class="row"><button class="btn small danger" data-delc="${S.custId}">${S.delArm === S.custId ? t("del_confirm") : t("del")} – ${esc((cust(S.custId) || {}).name || "")}</button></div>`;
  }

  V.report = () => {
    if (!S.meas) return emptyState();
    const a = res(), c = S.company, lv = LV[a.lvl], M = mods(), d = S.meas.data;
    const name = S.demo ? t("demo_badge") : (cust(S.meas.custId) || {}).name || "";
    const type = (M[0] && M[0].info && M[0].info.name) || "";
    const fw = M[0] && M[0].info ? [M[0].info.mainSoft, M[0].info.soft].filter(Boolean).join(" / ") : "";
    return `<div class="row center spread noprint"><h1>${t("nav_report")}</h1><button class="btn primary" data-act="print">${t("rep_save")}</button></div>
 <p class="muted noprint">${t("rep_pdfnote")}</p>
 <div class="scroll"><article class="sheet">
  <div class="hd"><div>${S.logo ? `<img class="logo" src="${S.logo}" alt="">` : `<b style="font-size:16px">${esc(c.name)}</b>`}<div style="color:#555;margin-top:4px">${S.logo ? `<b>${esc(c.name)}</b><br>` : ""}${esc(c.addr)}${c.ico ? `<br>${t("set_ico")}: ${esc(c.ico)}` : ""}${c.contact ? ` · ${esc(c.contact)}` : ""}</div></div>
  <div style="text-align:right"><h2>${t("rep_title")}</h2><div style="color:#555">${t("rep_date")}: ${dtf(S.meas.date)}</div></div></div>
  <table><tbody><tr><th>${t("rep_cust")}</th><td>${esc(name)}</td></tr><tr><th>${t("rep_battery")}</th><td>${M.length}× ${esc(type)}${fw ? " · FW " + esc(fw) : ""}</td></tr><tr><th>${t("rep_tech")}</th><td>${esc(c.name)}</td></tr></tbody></table>
  <div class="res ${lv}">${t("rep_result")}: ${t("v_" + lv)} · ${t("k_spread")} ${a.spread} mV</div>
  <table><thead><tr><th>${t("th_module")}</th><th>${t("th_sn")}</th><th class="num">SOH</th><th class="num">${t("th_cycles")}</th><th class="num">min / max mV</th><th class="num">°C</th><th class="num">MOS °C</th></tr></thead>
  <tbody>${M.map(m => { const v = mv(m), ts = m.cells.map(x => x.temp).filter(x => x != null), s = m.stat || {}; return `<tr><td>${m.id}</td><td>${esc((m.info && m.info.barcode) || "–")}</td><td class="num">${s.soh != null ? s.soh + " %" : "–"}</td><td class="num">${s.cycles ?? "–"}</td><td class="num">${Math.min(...v)} / ${Math.max(...v)}</td><td class="num">${ts.length ? nf(Math.min(...ts), 1) + "–" + nf(Math.max(...ts), 1) : "–"}</td><td class="num">${nf(m.pwr && m.pwr.mos, 1)}</td></tr>`; }).join("")}</tbody></table>
  <h3>${t("rep_findings")}</h3>
  <ul>${a.f.length ? a.f.map(f => `<li>${esc(ftxt(f))}</li>`).join("") : `<li>${t("v_ok_text", { s: a.spread })}</li>`}${a.f.some(f => /^f_stat/.test(f.k)) ? "" : `<li>${t("stat_zero")}</li>`}</ul>
  ${S.meas.note ? `<h3>${t("note")}</h3><p>${esc(S.meas.note)}</p>` : ""}
  <div class="sign"><div>${t("rep_sign")}</div><div>${t("rep_signc")}</div></div>
  <p class="foot">CellScope ${VERSION} · ${esc(t("about_tm"))}</p>
 </article></div>`;
  };

  V.settings = () => {
    const c = S.company, th = S.thr;
    const f = (id, lab, val, type = "text", step = "") => `<div class="field"><label for="${id}">${lab}</label><input id="${id}" type="${type}" ${step ? `step="${step}"` : ""} value="${esc(val)}"></div>`;
    return `<div class="grid2">
 <section class="panel"><h2>${t("set_company")}</h2>
  ${f("c_name", t("set_name"), c.name)}${f("c_addr", t("set_addr"), c.addr)}<div class="row">${f("c_ico", t("set_ico"), c.ico)}${f("c_contact", t("set_contact"), c.contact)}</div>
  <div class="field"><label for="c_logo">${t("set_logo")}</label><input id="c_logo" type="file" accept="image/*"></div>
  ${S.logo ? `<div class="row center"><img src="${S.logo}" alt="" style="max-height:48px;max-width:160px;background:#fff;padding:4px;border-radius:4px"><button class="btn small danger" data-act="nologo">${t("del")}</button></div>` : ""}
 </section>
 <section class="panel"><h2>${t("set_thr")}</h2>
  <div class="thr">${f("t_spread", t("t_spread"), th.spread, "number", "1")}${f("t_dev", t("t_dev"), th.dev, "number", "1")}${f("t_lo", t("t_lo"), th.lo, "number", "0.01")}${f("t_hi", t("t_hi"), th.hi, "number", "0.01")}${f("t_temp", t("t_temp"), th.temp, "number", "1")}${f("t_endS", t("t_end_s"), th.endS, "number", "1")}${f("t_endD", t("t_end_d"), th.endD, "number", "1")}${f("t_mos", t("t_mos"), th.mos, "number", "0.5")}${f("t_clock", t("t_clock"), th.clock, "number", "1")}${f("t_hist", t("hist_count"), th.hist, "number", "10")}</div>
  <div><button class="btn" data-act="thrreset">${t("reset")}</button></div>
 </section></div>`;
  };

  V.about = () => `<section class="panel" style="max-width:760px">
 <h1>CellScope</h1><p class="muted">${t("sub")} · ${VERSION}</p>
 <p>${t("about_text")}</p><p>${t("about_lic")}</p><p class="muted">${t("about_tm")}</p>
 <p>${t("github")}: <a href="${REPO}" target="_blank" rel="noopener">${REPO.replace("https://", "")}</a></p>
 <p class="muted">${t("install_hint")}</p></section>`;

  /* ---------- vykreslení ---------- */
  const TABS = ["connect", "overview", "bms", "compare", "customers", "report", "settings", "about"];
  function render() {
    document.documentElement.lang = S.lang;
    $("sub").textContent = t("sub");
    $("tabs").innerHTML = TABS.map(k => `<button class="tab" role="tab" data-go="${k}" aria-selected="${S.tab === k}" ${S.busy && k !== "connect" ? "disabled" : ""}>${t("nav_" + k)}</button>`).join("");
    $("banner").hidden = !S.demo;
    $("bannerText").textContent = t("demo_note");
    $("view").innerHTML = V[S.tab]();
    if (S.tab === "customers") fillMeas();
    const con = $("con"); if (con) con.scrollTop = con.scrollHeight;
  }

  /* ---------- události ---------- */
  document.addEventListener("click", async e => {
    const el = e.target.closest("[data-go],[data-act],[data-mod],[data-cust],[data-open],[data-delm],[data-delc]");
    if (!el || el.disabled) return;
    const ds = el.dataset;
    if (ds.go) { S.tab = ds.go; S.delArm = null; render(); window.scrollTo(0, 0); return; }
    if (ds.mod) { const m = +ds.mod; S.sel = !m || S.sel === m ? null : m; if (S.tab !== "overview") S.tab = "overview"; render(); return; }
    if (ds.cust) { S.custId = ds.cust; S.newCust = false; S.delArm = null; DB.setSetting("lastCust", S.custId); render(); return; }
    if (ds.open) { await setMeas(await DB.get("measurements", ds.open)); S.tab = "overview"; render(); return; }
    if (ds.delm) {
      if (S.delArm !== ds.delm) { S.delArm = ds.delm; fillMeas(); return; }
      await DB.del("measurements", ds.delm); if (S.meas && S.meas.id === ds.delm) await setMeas(null);
      S.delArm = null; fillMeas(); return;
    }
    if (ds.delc) {
      if (S.delArm !== ds.delc) { S.delArm = ds.delc; fillMeas(); return; }
      for (const m of await measOf(ds.delc)) await DB.del("measurements", m.id);
      await DB.del("customers", ds.delc);
      if (S.meas && S.meas.custId === ds.delc) await setMeas(null);
      S.custId = null; S.delArm = null; await loadCustomers(); render(); return;
    }
    switch (ds.act) {
      case "read": readBattery(false); break;
      case "demo": S.tab = "connect"; readBattery(true); break;
      case "reread":
        if (S.demo) { S.tab = "connect"; readBattery(true); }
        else { S.custId = S.meas.custId; S.newCust = false; S.tab = "connect"; render(); readBattery(false); }
        break;
      case "cable": cableTest(); break;
      case "print": window.print(); break;
      case "thrreset": S.thr = { ...A.DEF_THR }; DB.setSetting("thr", S.thr); render(); break;
      case "nologo": S.logo = null; DB.setSetting("logo", null); render(); break;
      case "addcust": {
        const v = $("addcust").value.trim(); if (!v) { $("addcust").focus(); break; }
        const c = { id: DB.uid(), name: v, created: new Date().toISOString() };
        await DB.put("customers", c); await loadCustomers(); S.custId = c.id; render(); break;
      }
      case "export": download("cellscope-zaloha-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(await DB.exportAll())); toast(t("backup_ok")); break;
      case "raw": {
        const r = S.meas.data.raw || {};
        download("cellscope-" + S.meas.date.slice(0, 10) + ".txt", Object.entries(r).map(([k, v]) => "===== " + k + " =====\n" + v).join("\n"), "text/plain");
        break;
      }
    }
  });
  document.addEventListener("change", async e => {
    const id = e.target.id;
    if (id === "custsel") { const v = e.target.value; if (v === "__new") S.newCust = true; else { S.newCust = false; S.custId = v; DB.setSetting("lastCust", v); } render(); }
    if (id === "histon") { S.histOn = e.target.checked; DB.setSetting("histOn", S.histOn); }
    if (id === "c_logo" && e.target.files[0]) {
      const r = new FileReader();
      r.onload = () => { S.logo = r.result; DB.setSetting("logo", S.logo); render(); };
      r.readAsDataURL(e.target.files[0]);
    }
    if (id === "importf" && e.target.files[0]) {
      try { const n = await DB.importAll(JSON.parse(await e.target.files[0].text())); await loadCustomers(); toast(t("import_ok", n)); render(); }
      catch (x) { toast(t("import_bad")); }
    }
  });
  let noteT;
  document.addEventListener("input", e => {
    const id = e.target.id, v = e.target.value;
    if (id === "note" && S.meas && !S.demo) { S.meas.note = v; clearTimeout(noteT); noteT = setTimeout(() => DB.put("measurements", S.meas), 500); }
    if (id.startsWith("c_") && id !== "c_logo") { S.company[id.slice(2)] = v; DB.setSetting("company", S.company); }
    if (id.startsWith("t_") || id === "histn") {
      const n = parseFloat(v); if (isNaN(n)) return;
      S.thr[id === "histn" ? "hist" : id.slice(2)] = id === "histn" || id === "t_hist" ? Math.max(1, Math.min(2000, Math.round(n))) : n;
      DB.setSetting("thr", S.thr);
    }
  });
  $("lang").addEventListener("change", () => { S.lang = $("lang").value; DB.setSetting("lang", S.lang); render(); });

  /* ---------- start ---------- */
  (async function init() {
    const nav = (navigator.language || "en").slice(0, 2);
    S.lang = await DB.setting("lang", L[nav] ? nav : "en");
    if (!L[S.lang]) S.lang = "en";
    S.thr = { ...A.DEF_THR, ...(await DB.setting("thr", {})) };
    S.histOn = await DB.setting("histOn", true);
    S.company = { ...S.company, ...(await DB.setting("company", {})) };
    S.logo = await DB.setting("logo", null);
    await loadCustomers();
    const last = await DB.setting("lastCust", null);
    S.custId = cust(last) ? last : (S.customers[0] && S.customers[0].id) || null;
    $("lang").innerHTML = Object.entries(L).map(([k, v]) => `<option value="${k}">${v._n}</option>`).join("");
    $("lang").value = S.lang;
    render();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  })();
})();
