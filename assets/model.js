/*
 * Site selection model — pure functions, no DOM.
 * Works in the browser (window.SiteModel) and in Node (module.exports) for testing.
 * All money is in Indian rupees. 1 crore = 1,00,00,000. 1 lakh = 1,00,000.
 */
(function (root) {
  "use strict";

  // Fixed business inputs for a Mumbai supermarket format. Edit here to change the format.
  const FIXED = {
    sqft: 6000,          // store size, sq ft
    hhSize: 4,           // people per household
    categoryShare: 0.12, // share of household income spent on groceries & daily needs
    days: 360,           // trading days a year
    fixedOpex: 1.6e7,    // staff, utilities, security: ₹1.6 crore a year
    varOpex: 0.04,       // other costs, share of sales
    fitoutPerSqft: 4000, // ₹ per sq ft
    openingStock: 1.5e7, // ₹1.5 crore
    depositMonths: 10,   // Mumbai landlords often ask 10 months' rent as deposit
    mtBase: 0.04,        // modern-trade (supermarket) share of grocery spend at zero income
    mtSlope: 0.04,       // + this much per ₹1 lakh of monthly household income
    pullBase: 0.7,       // our store's pull vs one average competitor (=1.0) ...
    pullPerAccess: 0.06, // ... plus this per access point (0-10)
    cannCap: 0.6         // a new store always wins at least 40% genuinely new sales
  };

  // Assumptions the user can change with sliders.
  const DEFAULTS = { conv: 3.0, basket: 650, gm: 22, radius: 5, cannMax: 40, hurdle: 3.5, rentCap: 5 };

  // Scoring criteria. hi=true means higher is better.
  const CRITERIA = [
    { k: "incr",   l: "Net gain to chain",    w: 30, hi: true },
    { k: "pb",     l: "Payback speed",        w: 20, hi: false },
    { k: "demand", l: "Local spending power", w: 10, hi: true },
    { k: "comp",   l: "Low competition",      w: 10, hi: false },
    { k: "access", l: "Accessibility",        w: 10, hi: true },
    { k: "rentB",  l: "Low rent burden",      w: 10, hi: false },
    { k: "cann",   l: "Low cannibalisation",  w: 10, hi: false }
  ];

  // Great-circle distance in km.
  function km(a, b) {
    const r = d => d * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }

  // Two independent sales ceilings, in ₹ a year.
  function rawSales(s, A) {
    const households = (s.pop * 1e5) / FIXED.hhSize;
    const pool = households * s.inc * 1e3 * FIXED.categoryShare * 12; // category spend in the catchment
    const modernShare = FIXED.mtBase + FIXED.mtSlope * (s.inc / 100);                   // richer areas shop more in supermarkets
    const attraction = FIXED.pullBase + FIXED.pullPerAccess * s.access;                         // better access, bigger pull
    const ourShare = attraction / (attraction + s.comp);
    return {
      wallet: pool * modernShare * ourShare,
      traffic: s.foot * (A.conv / 100) * A.basket * FIXED.days
    };
  }

  // Calibration factor: makes the model match what existing stores really sell.
  function calibrate(existing, A) {
    const usable = existing.filter(e => e.actual > 0);
    if (!usable.length) return { k: 1, rows: [], mape: null };
    const ratios = usable.map(e => { const m = rawSales(e, A); return (e.actual * 1e7) / Math.min(m.wallet, m.traffic); });
    const k = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const rows = usable.map(e => {
      const m = rawSales(e, A), model = Math.min(m.wallet, m.traffic) * k;
      return { name: e.name, model, actual: e.actual * 1e7, err: (model - e.actual * 1e7) / (e.actual * 1e7) };
    });
    const mape = rows.reduce((a, r) => a + Math.abs(r.err), 0) / rows.length;
    return { k, rows, mape };
  }

  // Full economics for one site against a network of own stores.
  function evaluate(s, network, k, A) {
    const r = rawSales(s, A);
    const wallet = r.wallet * k, traffic = r.traffic * k, rev = Math.min(wallet, traffic);
    const near = [];
    let cann = 0;
    for (const e of network) {
      if (e.name === s.name) continue;
      const d = km(s, e);
      if (d < A.radius) { const f = (A.cannMax / 100) * (1 - d / A.radius); cann += f; near.push({ name: e.name, d, f, isNew: !!e.isNew }); }
    }
    cann = Math.min(cann, FIXED.cannCap);
    const gm = A.gm / 100;
    const rentY = s.rent * FIXED.sqft * 12;
    const gross = rev * gm, other = rev * FIXED.varOpex;
    const ebitda = gross - rentY - FIXED.fixedOpex - other;
    const lost = rev * cann * gm;           // margin our other stores lose
    const incr = ebitda - lost;             // what the chain really gains
    const capex = FIXED.fitoutPerSqft * FIXED.sqft + FIXED.openingStock + s.rent * FIXED.sqft * FIXED.depositMonths;
    const pb = incr > 0 ? capex / incr : 99;
    return Object.assign({}, s, {
      wallet, traffic, rev, binding: wallet < traffic ? "wallet" : "traffic",
      demand: wallet, cann, near, gross, rentY, other, ebitda, lost, incr, capex, pb,
      rentB: rev > 0 ? rentY / rev : 1, ok: incr > 0 && pb <= A.hurdle
    });
  }

  // Min-max normalise each criterion across the list, then weight.
  function score(list, W) {
    const tot = CRITERIA.reduce((a, c) => a + W[c.k], 0) || 1;
    const val = (r, k) => (k === "pb" ? Math.min(r.pb, 10) : r[k]);
    for (const r of list) r.parts = {};
    for (const c of CRITERIA) {
      const vs = list.map(r => val(r, c.k)), lo = Math.min(...vs), hi = Math.max(...vs);
      for (const r of list) {
        let n = hi === lo ? 0.5 : (val(r, c.k) - lo) / (hi - lo);
        if (!c.hi) n = 1 - n;
        r.parts[c.k] = { n, pts: (n * W[c.k] / tot) * 100 };
      }
    }
    for (const r of list) r.score = Object.values(r.parts).reduce((a, p) => a + p.pts, 0);
    return list;
  }

  // Rank all sites, then pick N one at a time; each pick joins the network before the next is rated.
  function run(data, A, W, N) {
    const cal = calibrate(data.existing, A);
    const k = cal.k;
    const base = score(data.candidates.map(s => evaluate(s, data.existing, k, A)), W);
    const net = data.existing.slice(), picks = [];
    for (let i = 0; i < N; i++) {
      const left = data.candidates.filter(s => !picks.some(p => p.name === s.name));
      if (!left.length) break;
      const pool = score(left.map(s => evaluate(s, net, k, A)), W);
      const best = pool.filter(r => r.ok).sort((a, b) => b.score - a.score)[0];
      if (!best) break;
      picks.push(best);
      net.push(Object.assign({}, best, { isNew: true }));
    }
    const skipped = [];
    const after = data.candidates.filter(s => !picks.some(p => p.name === s.name)).map(s => evaluate(s, net, k, A));
    for (const b of base) {
      const f = after.find(x => x.name === b.name);
      if (f && b.ok && !f.ok && f.near.some(n => n.isNew)) skipped.push({ name: b.name, by: f.near.filter(n => n.isNew).map(n => n.name) });
    }
    for (const p of picks) { const b = base.find(x => x.name === p.name); p.score = b.score; p.parts = b.parts; }
    base.sort((a, b) => (b.ok - a.ok) || (b.score - a.score));
    for (const r of base) r.pick = picks.findIndex(p => p.name === r.name);
    return { cal, k, base, picks, skipped };
  }

  // ---------- File parsing ----------
  const ALIASES = {
    name: ["name", "location", "site", "neighbourhood", "neighborhood", "area"],
    type: ["type", "kind", "status", "category"],
    lat: ["lat", "latitude"],
    lng: ["lng", "lon", "long", "longitude"],
    pop: ["populationlakh", "population", "pop", "catchmentpopulation"],
    inc: ["incomekmonth", "householdincome", "income", "hhincome", "monthlyincome"],
    foot: ["footfallday", "footfall", "dailyfootfall"],
    comp: ["competitors", "competition", "competitorcount"],
    rent: ["rentsqftmonth", "rent", "rentpersqft"],
    access: ["accessscore", "accessibility", "access"],
    actual: ["actualsalescr", "salescr", "actualsales", "sales", "annualsales"]
  };
  const HEADERS = { name: "name", type: "type", lat: "lat", lng: "lng", pop: "population_lakh", inc: "income_k_month", foot: "footfall_day", comp: "competitors", rent: "rent_sqft_month", access: "access_score", actual: "actual_sales_cr" };
  const clean = h => String(h).toLowerCase().replace(/[^a-z]/g, "");

  // Minimal RFC-4180 CSV parser (quotes, commas and newlines inside quotes).
  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    const nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== ""));
    if (!nonEmpty.length) return [];
    const head = nonEmpty[0];
    return nonEmpty.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
  }

  // Turn raw rows (objects keyed by any header spelling) into clean site records.
  function normalise(rawRows) {
    const errors = [], warnings = [], existing = [], candidates = [];
    if (!rawRows.length) return { errors: ["The file has no data rows."], warnings, existing, candidates };
    const headers = Object.keys(rawRows[0]);
    const map = {};
    for (const [field, names] of Object.entries(ALIASES)) {
      const h = headers.find(x => names.includes(clean(x)));
      if (h) map[field] = h;
    }
    const required = ["name", "lat", "lng", "pop", "inc", "foot", "comp", "rent", "access"];
    const missing = required.filter(f => !map[f]);
    if (missing.length) {
      errors.push("Missing column(s): " + missing.map(f => HEADERS[f]).join(", ") + ". Download the template to see the expected headers.");
      return { errors, warnings, existing, candidates };
    }
    const num = v => { const n = parseFloat(String(v).replace(/[₹,\s]/g, "")); return isNaN(n) ? NaN : n; };
    const seen = new Set();
    rawRows.forEach((r, i) => {
      const line = i + 2;
      const name = String(r[map.name] || "").trim();
      if (!name) return;
      if (seen.has(name)) { errors.push(`Row ${line}: duplicate name "${name}".`); return; }
      seen.add(name);
      const s = { name };
      for (const f of ["lat", "lng", "pop", "inc", "foot", "comp", "rent", "access"]) {
        s[f] = num(r[map[f]]);
        if (isNaN(s[f])) { errors.push(`Row ${line} (${name}): "${f === "pop" ? "population_lakh" : f}" is not a number.`); return; }
      }
      // Friendly unit detection
      if (s.pop > 1000) { s.pop = s.pop / 1e5; warnings.push(`${name}: population read as people, converted to lakh.`); }
      if (s.inc > 5000) { s.inc = s.inc / 1000; warnings.push(`${name}: income read as ₹/month, converted to ₹ thousand.`); }
      if (s.access > 10) s.access = Math.min(10, s.access / 10);
      if (Math.abs(s.lat) > 90 || Math.abs(s.lng) > 180) { errors.push(`Row ${line} (${name}): latitude/longitude out of range.`); return; }
      const t = clean(map.type ? r[map.type] : "candidate");
      const isExisting = ["existing", "store", "current", "open", "own"].includes(t);
      if (isExisting) {
        let a = map.actual ? num(r[map.actual]) : NaN;
        if (a > 1e5) a = a / 1e7;
        s.actual = isNaN(a) ? 0 : a;
        existing.push(s);
      } else candidates.push(s);
    });
    if (!candidates.length && !errors.length) errors.push('No candidate sites found. Set the "type" column to "candidate" for sites you want to test.');
    if (!existing.some(e => e.actual > 0)) warnings.push("No existing-store sales given, so the model is not calibrated (factor 1.00).");
    return { errors, warnings, existing, candidates };
  }

  const api = { FIXED, DEFAULTS, CRITERIA, km, rawSales, calibrate, evaluate, score, run, parseCSV, normalise };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SiteModel = api;
})(typeof window !== "undefined" ? window : globalThis);
