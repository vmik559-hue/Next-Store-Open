/* UI layer for the Mumbai Store Site Selector. All maths lives in model.js (window.SiteModel). */
(function () {
  "use strict";
  const M = window.SiteModel;

  const SAMPLE_CSV = `name,type,lat,lng,population_lakh,income_k_month,footfall_day,competitors,rent_sqft_month,access_score,actual_sales_cr
Andheri West,existing,19.1364,72.8296,3.2,150,42000,5,260,9,30.4
Dadar West,existing,19.0178,72.8478,2.6,130,48000,5,240,10,18.6
Powai,existing,19.1176,72.9060,2.0,210,30000,4,220,6,22.3
Chembur,existing,19.0522,72.9005,2.8,120,32000,4,170,8,20.1
Bandra West,candidate,19.0596,72.8295,1.8,260,45000,7,380,8,
Lower Parel,candidate,18.9980,72.8302,0.9,200,65000,4,350,9,
Goregaon East,candidate,19.1663,72.8526,3.0,140,36000,4,180,8,
Borivali West,candidate,19.2307,72.8567,4.0,120,40000,4,150,9,
Thane West,candidate,19.2183,72.9781,4.2,115,36000,4,110,8,
Ghatkopar East,candidate,19.0790,72.9080,3.0,125,38000,5,170,9,
Vashi,candidate,19.0771,72.9986,2.6,130,30000,3,120,7,
Mulund West,candidate,19.1726,72.9425,2.7,120,26000,3,130,7,`;

  // Sliders on the Assumptions tab
  const ACTL = [
    { k: "conv", l: "Passer-by conversion", min: 1, max: 6, step: 0.1, f: v => v.toFixed(1) + "%", h: "Share of daily footfall that buys" },
    { k: "basket", l: "Average basket", min: 300, max: 1200, step: 10, f: v => "₹" + v.toLocaleString("en-IN") },
    { k: "gm", l: "Gross margin", min: 15, max: 30, step: 0.5, f: v => v + "%" },
    { k: "radius", l: "Cannibalisation radius", min: 2, max: 8, step: 0.5, f: v => v + " km", h: "Our stores closer than this lose sales" },
    { k: "cannMax", l: "Max sales shifted at 0 km", min: 10, max: 70, step: 5, f: v => v + "%" },
    { k: "rentCap", l: "Rent alarm", min: 2, max: 10, step: 0.5, f: v => v + "% of sales", h: "Flag sites where rent exceeds this" }
  ];
  const HCTL = { k: "hurdle", l: "Maximum payback", min: 1, max: 6, step: 0.5, f: v => v + " yrs", h: "Sites slower than this are rejected" };

  let DATA = { existing: [], candidates: [] };
  let A = Object.assign({}, M.DEFAULTS);
  let W = Object.fromEntries(M.CRITERIA.map(c => [c.k, c.w]));
  let N = 2, SEL = null, LAST = null, TAB = "rec", SRC = "Mumbai sample";

  // ---------- Small helpers ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const strip = h => { const t = document.createElement("div"); t.innerHTML = h; return t.textContent; };
  const cr = v => (v / 1e7).toFixed(2), cr1 = v => (v / 1e7).toFixed(1), pct = v => Math.round(v * 100) + "%";
  const money = v => { const a = Math.abs(v), s = v < 0 ? "−" : ""; return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} cr` : `${s}₹${(a / 1e5).toFixed(1)} L`; };
  const yrs = v => (v >= 99 ? "never" : v.toFixed(1) + " yrs");
  const ST_OF = r => (r.pick >= 0 ? "open" : r.ok ? "reserve" : "avoid");
  const ST_LABEL = { open: "Open", reserve: "Reserve", avoid: "Avoid" };
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888";
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches; };
  function toast(t) { const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2200); }
  function saveFile(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // Highest monthly rent (₹/sq ft) at which a site still meets the payback bar.
  function maxRent(r) {
    const F = M.FIXED, h = A.hurdle;
    const E0 = r.incr + r.rentY, C0 = r.capex - r.rent * F.sqft * F.depositMonths;
    return (E0 - C0 / h) / (F.sqft * 12 + (F.sqft * F.depositMonths) / h);
  }

  // ---------- Tabs ----------
  const TABS = ["rec", "upload", "compare", "stress", "assumptions", "method", "memo"];
  function showTab(name, focus) {
    if (!TABS.includes(name)) name = "rec";
    TAB = name;
    document.querySelectorAll("[role=tab]").forEach(b => { const on = b.dataset.tab === name; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    TABS.forEach(t => { $(t).hidden = t !== name; });
    try { history.replaceState(null, "", "#" + name); } catch (e) { /* sandboxed */ }
    if (name === "rec" && LAST) requestAnimationFrame(() => { if (LMAP) LMAP.invalidateSize(); drawMap(LAST.base, LAST.picks); });
  }
  document.querySelectorAll("[role=tab]").forEach((b, i, all) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
    b.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const j = (i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length;
      showTab(all[j].dataset.tab, true);
    });
  });
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => { showTab(b.dataset.go); window.scrollTo({ top: $("t-rec").getBoundingClientRect().top + scrollY - 10, behavior: "smooth" }); }));

  // ---------- Data loading ----------
  function loadRows(rows, label) {
    const res = M.normalise(rows), box = $("msg");
    if (res.errors.length) {
      box.innerHTML = `<div class="msg err"><strong>Could not use ${esc(label)}.</strong><ul>${res.errors.slice(0, 6).map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
      return false;
    }
    DATA = { existing: res.existing, candidates: res.candidates };
    SEL = null; SRC = label; FIT_KEY = "";
    $("dataBadge").textContent = label === "Mumbai sample" ? "SYNTHETIC DATA" : "YOUR DATA";
    box.innerHTML = label === "Mumbai sample" ? "" :
      `<div class="msg ok">Loaded ${res.candidates.length} candidate site${res.candidates.length === 1 ? "" : "s"} and ${res.existing.length} existing store${res.existing.length === 1 ? "" : "s"} from ${esc(label)}. <button class="btn-link" type="button" data-go2="rec">See the recommendation →</button></div>` +
      (res.warnings.length ? `<div class="msg warn"><ul>${res.warnings.slice(0, 5).map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : "");
    box.querySelectorAll("[data-go2]").forEach(b => b.addEventListener("click", () => showTab("rec")));
    buildInputs();
    render();
    return true;
  }
  function readFile(file) {
    if (!file) return;
    const name = file.name, ext = name.split(".").pop().toLowerCase(), reader = new FileReader();
    reader.onerror = () => { $("msg").innerHTML = `<div class="msg err">Could not read ${esc(name)}.</div>`; };
    if (ext === "xlsx" || ext === "xls") {
      if (!window.XLSX) { $("msg").innerHTML = `<div class="msg err">The Excel reader did not load (are you offline?). Save the sheet as CSV and upload that instead.</div>`; return; }
      reader.onload = e => {
        try { const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" }); loadRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }), name); }
        catch (err) { $("msg").innerHTML = `<div class="msg err">That Excel file could not be opened: ${esc(err.message)}</div>`; }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = e => loadRows(M.parseCSV(e.target.result), name);
      reader.readAsText(file);
    }
  }

  // ---------- Narrative helpers ----------
  function flags(r) {
    const f = [];
    if (r.binding === "wallet" && r.traffic > 1.3 * r.wallet) f.push(["Footfall trap", "st-avoid"]);
    if (r.binding === "traffic" && r.wallet > 1.6 * r.traffic) f.push(["Untapped wallet", "st-open"]);
    const own = r.near.filter(n => !n.isNew);
    if (r.cann >= 0.1 && own.length) f.push(["Takes from " + own.map(n => n.name).join(", "), "st-reserve"]);
    if (r.rentB > A.rentCap / 100) f.push(["High rent", "st-avoid"]);
    if (r.comp >= 6) f.push(["Crowded", "st-reserve"]);
    if (r.access >= 9) f.push(["Easy access", "st-open"]);
    return f;
  }
  function prosCons(r) {
    const pro = [], con = [];
    if (r.binding === "wallet" && r.traffic > 1.3 * r.wallet) con.push(`Footfall could support ₹${cr1(r.traffic)} cr, but local households only support about ₹${cr1(r.wallet)} cr. The crowd is mostly commuters or office workers.`);
    else if (r.binding === "traffic" && r.wallet > 1.6 * r.traffic) con.push(`Households could spend ₹${cr1(r.wallet)} cr here, but footfall caps sales at ₹${cr1(r.traffic)} cr. A more visible unit would sell more.`);
    else pro.push(`Footfall and local spending agree (₹${cr1(r.traffic)} cr vs ₹${cr1(r.wallet)} cr), so the sales forecast is well supported.`);
    if (r.cann > 0.005) con.push(`${pct(r.cann)} of its sales would come from ${r.near.map(n => `${n.name} (${n.d.toFixed(1)} km)`).join(" and ")}, costing ${money(r.lost)} of margin a year at our own stores.`);
    else pro.push("No store of ours within the cannibalisation radius, so nearly every sale is new to the chain.");
    (r.rentB > A.rentCap / 100 ? con : pro).push(`Rent is ${(r.rentB * 100).toFixed(1)}% of sales (alarm at ${A.rentCap}%).`);
    if (r.comp >= 5) con.push(`${r.comp} competing supermarkets within 1.5 km.`); else if (r.comp <= 3) pro.push(`Only ${r.comp} competitor${r.comp === 1 ? "" : "s"} within 1.5 km.`);
    if (r.access >= 8) pro.push(`Strong access (${r.access}/10: rail, bus, parking).`); else if (r.access <= 5) con.push(`Weak access (${r.access}/10).`);
    (r.ok ? pro : con).push(r.ok ? `Pays back in ${yrs(r.pb)}, inside the ${A.hurdle}-year bar.` : `Pays back in ${yrs(r.pb)}, outside the ${A.hurdle}-year bar.`);
    return { pro, con };
  }
  function cardLine(r, skipped) {
    const s = ST_OF(r);
    if (s === "open") return `Open. Adds ${money(r.incr)} a year to chain profit; pays back in ${yrs(r.pb)}.`;
    if (s === "reserve") {
      const sk = skipped.find(x => x.name === r.name);
      return sk ? `Reserve. Works on its own (${yrs(r.pb)} payback), but next to ${sk.by.join(", ")} the two would share customers.` : `Reserve. Works on its own (${yrs(r.pb)} payback) but ranks below the funded picks.`;
    }
    if (r.incr <= 0) return `Avoid. Loses ${money(-r.incr)} a year once rent, running costs and sales taken from our stores are counted.`;
    const why = r.binding === "wallet" && r.traffic > 1.3 * r.wallet ? "busy, but few residents to buy" : r.cann >= 0.1 ? "much of its trade comes from our own stores" : r.rentB > A.rentCap / 100 ? "rent is too high for its sales" : "returns are too thin";
    return `Avoid. Pays back in ${yrs(r.pb)}, slower than the ${A.hurdle}-year bar: ${why}.`;
  }
  function tradeoffs(base, picks) {
    const why = [], seen = new Set(picks.map(p => p.name));
    const own = r => { const o = r.near.filter(n => !n.isNew); return o.map(n => n.name).join(" and ") + " store" + (o.length > 1 ? "s" : ""); };
    const net = r => r.incr > 0 ? `the chain nets only ${money(r.incr)} a year (${yrs(r.pb)} payback)` : `the chain loses ${money(-r.incr)} a year`;
    const add = (r, title, txt) => { if (r && !seen.has(r.name) && why.length < 3) { seen.add(r.name); why.push({ name: r.name, title, txt }); } };
    const topSales = [...base].sort((a, b) => b.rev - a.rev)[0];
    add(topSales, "Highest sales", `Biggest sales forecast (₹${cr1(topSales.rev)} cr), but ${topSales.cann > 0.05 ? `${pct(topSales.cann)} would come from our ${own(topSales)}, so ${net(topSales)}.` : `rent at ${(topSales.rentB * 100).toFixed(1)}% of sales and ${topSales.comp} competitors mean ${net(topSales)}.`}`);
    const topFoot = [...base].sort((a, b) => b.foot - a.foot)[0];
    add(topFoot, "Busiest footfall", `${topFoot.foot.toLocaleString("en-IN")} people a day, but ${topFoot.binding === "wallet" ? `too few live nearby: sales cap at ₹${cr1(topFoot.rev)} cr and ${net(topFoot)}.` : `${net(topFoot)}.`}`);
    const cannSite = base.filter(b => b.cann >= 0.1 && b.ebitda > 0).sort((a, b) => b.ebitda - a.ebitda)[0];
    if (cannSite) add(cannSite, "Profitable alone", `Makes ${money(cannSite.ebitda)} on its own, but it is ${Math.min(...cannSite.near.map(n => n.d)).toFixed(1)} km from our ${own(cannSite)}. After lost margin there, ${net(cannSite)}.`);
    const rich = [...base].sort((a, b) => b.inc - a.inc)[0];
    add(rich, "Richest area", `Households earn ₹${rich.inc}k a month, but ${rich.comp} competitors and rent at ${(rich.rentB * 100).toFixed(1)}% of sales mean ${net(rich)}.`);
    return why;
  }

  // ---------- Stress test ----------
  function withFixed(patch, fn) {
    const old = {}; for (const k in patch) { old[k] = M.FIXED[k]; M.FIXED[k] = patch[k]; }
    try { return fn(); } finally { Object.assign(M.FIXED, old); }
  }
  function runVariant(o) {
    const D = o.rent ? { existing: DATA.existing, candidates: DATA.candidates.map(c => Object.assign({}, c, { rent: c.rent * o.rent })) } : DATA;
    return withFixed(o.F || {}, () => M.run(D, Object.assign({}, A, o.A || {}), o.W || W, N));
  }
  function stressTest(basePicks) {
    const eq = Object.fromEntries(M.CRITERIA.map(c => [c.k, 10]));
    const profit = Object.fromEntries(M.CRITERIA.map(c => [c.k, 0])); profit.incr = 60; profit.pb = 40;
    const S = [
      ["Fewer passers-by buy", `Conversion ${A.conv}% → ${(A.conv * 0.8).toFixed(1)}%`, { A: { conv: A.conv * 0.8 } }],
      ["Smaller baskets", `Basket ₹${A.basket} → ₹${Math.round(A.basket * 0.9)}`, { A: { basket: A.basket * 0.9 } }],
      ["Landlords ask more", "All candidate rents +15%", { rent: 1.15 }],
      ["Thinner margins", `Gross margin ${A.gm}% → ${A.gm - 2}%`, { A: { gm: A.gm - 2 } }],
      ["Stronger cannibalisation", `Radius ${A.radius} → ${A.radius + 2} km, max ${A.cannMax}% → ${Math.min(70, A.cannMax + 10)}%`, { A: { radius: A.radius + 2, cannMax: Math.min(70, A.cannMax + 10) } }],
      ["Different priorities: equal", "Every factor weighted equally", { W: eq }],
      ["Different priorities: money only", "Only net gain (60) and payback (40)", { W: profit }]
    ];
    const baseNames = basePicks.map(p => p.name), count = {}, rows = [];
    for (const [label, desc, o] of S) {
      const names = runVariant(o).picks.map(p => p.name);
      names.forEach(n => (count[n] = (count[n] || 0) + 1));
      rows.push({ label, desc, names, same: names.length === baseNames.length && names.every(n => baseNames.includes(n)) });
    }
    const sameN = rows.filter(r => r.same).length;
    let verdict;
    if (!basePicks.length) verdict = "No site is funded in the base case, so there is nothing to stress-test.";
    else if (sameN >= S.length - 1) verdict = `Robust: the same ${basePicks.length > 1 ? "sites are" : "site is"} chosen in ${sameN} of ${S.length} scenarios. The decision does not hinge on any single assumption.`;
    else {
      const weakest = basePicks.reduce((a, p) => ((count[p.name] || 0) < (count[a.name] || 0) ? p : a));
      verdict = `Partly sensitive: the funded set changes in ${S.length - sameN} of ${S.length} scenarios. ${weakest.name} is the least certain pick (${count[weakest.name] || 0}/${S.length}); validate its footfall and rent before committing.`;
    }
    return { rows, count, total: S.length, baseNames, sameN, verdict };
  }

  // ---------- Assumptions register ----------
  function registerRows(res) {
    const F = M.FIXED, cal = res.cal;
    const wTot = M.CRITERIA.reduce((x, c) => x + W[c.k], 0) || 1;
    const wTxt = `Net gain ${Math.round(W.incr / wTot * 100)}%, payback ${Math.round(W.pb / wTot * 100)}%, five others ${Math.round((wTot - W.incr - W.pb) / wTot * 100)}%`;
    return [
      ["Demand"],
      ["Household size", `${F.hhSize} people`, "Typical urban Indian household; turns catchment population into households.", "Assumed", { F: { hhSize: F.hhSize + 1 } }, `${F.hhSize + 1} people per household`],
      ["Grocery and daily-needs share of income", `${Math.round(F.categoryShare * 100)}%`, "Food and household essentials take a large slice of urban household budgets; 12% is a conservative middle estimate.", "Rule of thumb", { F: { categoryShare: F.categoryShare - 0.02 } }, `${Math.round(F.categoryShare * 100) - 2}% of income`],
      ["Supermarket (modern-trade) share", `${Math.round(F.mtBase * 100)}% + ${Math.round(F.mtSlope * 100)}% per ₹1 L/month income`, "Most grocery spend in India still goes to kirana stores; richer households use supermarkets more.", "Assumed", { F: { mtBase: F.mtBase * 0.75, mtSlope: F.mtSlope * 0.75 } }, "A quarter lower"],
      ["Our pull against competitors", `${F.pullBase} + ${F.pullPerAccess} × access; each rival = 1`, "A well-connected store draws more than an average rival. Every competitor is treated as equally strong.", "Assumed", { F: { pullBase: F.pullBase - 0.2 } }, `Base pull ${(F.pullBase - 0.2).toFixed(1)}`],
      ["Catchment definitions", "Residents within 2 km; rivals within 1.5 km", "Walking or short auto-ride distance for a neighbourhood supermarket.", "Data definition", null],
      ["Footfall"],
      ["Passer-by conversion", `${A.conv.toFixed(1)}%`, "Share of people passing the shopfront who enter and buy. The calibration factor corrects it against our own stores.", "Slider · calibrated", { A: { conv: A.conv * 0.8 } }, "20% lower"],
      ["Average basket", `₹${A.basket}`, "Typical Mumbai supermarket top-up bill.", "Slider", { A: { basket: A.basket * 0.85 } }, "15% smaller"],
      ["Trading days", `${F.days} a year`, "Closed on a handful of festival days.", "Assumed", null],
      ["Calibration"],
      ["Calibration factor", cal.rows.length ? cal.k.toFixed(2) : "1.00 (none)", cal.rows.length ? `Average of actual ÷ model sales at our ${cal.rows.length} existing stores; average error ${(cal.mape * 100).toFixed(0)}%.` : "No existing-store sales supplied, so the raw model is used.", "Calculated from data", null],
      ["Cannibalisation"],
      ["Cannibalisation radius", `${A.radius} km`, "Beyond this, shoppers are unlikely to switch between two of our stores.", "Slider", { A: { radius: A.radius + 2 } }, `${A.radius + 2} km`],
      ["Sales shifted when next door", `${A.cannMax}%, fading to 0 at the radius`, "Share of a new store's sales that would come from our store if they were side by side.", "Slider", { A: { cannMax: Math.min(70, A.cannMax + 10) } }, `${Math.min(70, A.cannMax + 10)}%`],
      ["Cap on cannibalisation", `${Math.round(F.cannCap * 100)}% of sales`, "A new store always wins some genuinely new customers.", "Assumed", null],
      ["Running costs"],
      ["Store size", `${F.sqft.toLocaleString("en-IN")} sq ft`, "Mid-size neighbourhood supermarket format, same for every site.", "Policy", null],
      ["Gross margin", `${A.gm}%`, "Typical for grocery-led Indian supermarkets.", "Slider", { A: { gm: A.gm - 2 } }, `${A.gm - 2}%`],
      ["Staff, power, security, maintenance", `₹${(F.fixedOpex / 1e7).toFixed(1)} cr a year`, `Fixed cost of running a ${F.sqft.toLocaleString("en-IN")} sq ft store.`, "Assumed", { F: { fixedOpex: F.fixedOpex * 1.2 } }, "20% higher"],
      ["Other variable costs", `${Math.round(F.varOpex * 100)}% of sales`, "Packaging, card fees, shrinkage and local marketing.", "Assumed", { F: { varOpex: F.varOpex + 0.02 } }, `${Math.round(F.varOpex * 100) + 2}% of sales`],
      ["Rent", "Quoted per site", "From the input data, ₹ per sq ft per month.", "Input data", { rent: 1.15 }, "All quotes +15%"],
      ["Investment"],
      ["Fit-out", `₹${F.fitoutPerSqft.toLocaleString("en-IN")}/sq ft (₹${(F.fitoutPerSqft * F.sqft / 1e7).toFixed(1)} cr)`, "Interiors, refrigeration, racking and IT.", "Assumed", { F: { fitoutPerSqft: F.fitoutPerSqft * 1.25 } }, "25% higher"],
      ["Opening stock", `₹${(F.openingStock / 1e7).toFixed(1)} cr`, "About three weeks of sales for a typical site.", "Assumed", { F: { openingStock: F.openingStock * 1.25 } }, "25% higher"],
      ["Rent deposit", `${F.depositMonths} months' rent`, "Common in Mumbai commercial leases; refundable but ties up capital.", "Market practice", null],
      ["Decision rules"],
      ["Payback bar", `${A.hurdle} years`, "Management's capital-recovery rule; sites slower than this are rejected outright.", "Policy · slider", { A: { hurdle: Math.max(1, A.hurdle - 0.5) } }, `${Math.max(1, A.hurdle - 0.5)} years`],
      ["Priority weights", wTxt, "Management priorities among sites that pass the bar; profit and payback carry half the weight.", "Policy · sliders", { W: Object.fromEntries(M.CRITERIA.map(c => [c.k, 10])) }, "All weights equal"],
      ["Score scale", "0–100, relative to the shortlist", "Each factor is scaled between the best and worst site; adding or removing a site changes every score.", "Method", null],
      ["Time horizon", "Year 1, steady state", "No ramp-up, inflation, tax, depreciation or discounting. Keeps the comparison simple and equal across sites.", "Simplification", null]
    ];
  }
  function renderRegister(res) {
    const baseNames = res.picks.map(p => p.name);
    let tested = 0, held = 0;
    $("register").querySelector("tbody").innerHTML = registerRows(res).map(r => {
      if (r.length === 1) return `<tr><td colspan="5" class="cat">${r[0]}</td></tr>`;
      const [label, val, why, basis, test, testLabel] = r;
      let sens = `<span class="sens na">Not tested</span>`;
      if (test) {
        tested++;
        const names = runVariant(test).picks.map(p => p.name);
        const same = names.length === baseNames.length && names.every(n => baseNames.includes(n));
        if (same) held++;
        sens = `<div class="small muted" style="margin-bottom:3px">${esc(testLabel)}:</div>` + (same ? `<span class="sens hold">Same picks</span>` : !names.length ? `<span class="sens none">No site passes</span>` : `<span class="sens flip">Picks: ${esc(names.join(", "))}</span>`);
      }
      return `<tr><td><strong>${esc(label)}</strong></td><td class="val">${esc(val)}</td><td class="why">${esc(why)}</td><td class="src">${esc(basis)}</td><td>${sens}</td></tr>`;
    }).join("");
    $("regNote").textContent = `${held} of ${tested} tested assumptions can move in the unfavourable direction without changing the recommendation.`;
    res.reg = { held, tested };
  }

  // ---------- Render ----------
  function render() {
    if (!DATA.candidates.length) return;
    const res = M.run(DATA, A, W, N);
    LAST = res;
    const { base, picks, skipped, cal } = res;
    if (!SEL || !base.some(b => b.name === SEL)) SEL = (picks[0] || base[0]).name;
    const ST = stressTest(picks); res.stress = ST;
    res.why = tradeoffs(base, picks);
    $("dsLine").innerHTML = `Showing <b>${esc(SRC)}</b>: ${DATA.candidates.length} candidate site${DATA.candidates.length === 1 ? "" : "s"}, ${DATA.existing.length} existing store${DATA.existing.length === 1 ? "" : "s"}`;

    // Verdict banner
    const v = $("verdict");
    if (!picks.length) {
      v.innerHTML = `<div class="eyebrow">Recommendation · budget for ${N} store${N > 1 ? "s" : ""}</div><h2>Hold. No site pays back within ${A.hurdle} years.</h2><p>Renegotiate rents, relax the payback bar, or add more candidate sites. The best option is ${esc(base[0].name)} at ${yrs(base[0].pb)}.</p>`;
    } else {
      const names = picks.map(p => p.name), head = names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
      const tCap = picks.reduce((a, p) => a + p.capex, 0), tInc = picks.reduce((a, p) => a + p.incr, 0), tRev = picks.reduce((a, p) => a + p.rev, 0);
      v.innerHTML = `<div class="eyebrow">Recommendation · budget for ${N} store${N > 1 ? "s" : ""}</div>
        <h2>Open ${esc(head)}${picks.length > 1 ? ", in that order" : ""}.</h2>
        <p>Together ${picks.length > 1 ? "they cost" : "it costs"} ${money(tCap)} to set up and add ${money(tInc)} a year to chain profit after the sales ${picks.length > 1 ? "they'd" : "it'd"} take from our existing stores, paying back in ${(tCap / tInc).toFixed(1)} years.${picks.length < N ? ` Only ${picks.length} site${picks.length > 1 ? "s pass" : " passes"} the ${A.hurdle}-year payback bar, so hold the rest of the budget.` : ""}</p>
        <div class="kpis3"><div><b>${money(tCap)}</b><span>One-off capex</span></div><div><b>${money(tRev)}</b><span>Sales a year</span></div><div><b>${money(tInc)}</b><span>Net gain a year</span></div><div><b>${(tCap / tInc).toFixed(1)} yrs</b><span>Payback</span></div></div>
        <div class="stress">${esc(ST.verdict)}</div>
        <div class="actions"><button class="btn" type="button" data-go3="stress">See stress test</button><button class="btn" type="button" data-go3="assumptions">Check assumptions</button><button class="btn" type="button" data-go3="memo">Read decision memo</button></div>`;
      v.querySelectorAll("[data-go3]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.go3)));
    }

    // Ranked cards
    $("ranking").innerHTML = base.map((r, i) => {
      const s = ST_OF(r);
      return `<li><button type="button" class="rk st-${s}" data-name="${esc(r.name)}" aria-current="${r.name === SEL}">
        <span class="n">${i + 1}</span>
        <span><span class="name">${esc(r.name)}</span><span class="pill">${ST_LABEL[s]}</span>
        <div class="line">${esc(cardLine(r, skipped))}</div>
        <div class="stats"><span>Net gain <b>${money(r.incr)}</b></span><span>Payback <b>${yrs(r.pb)}</b></span><span>Score <b>${Math.round(r.score)}</b></span><span>Stress <b>${ST.count[r.name] || 0}/${ST.total}</b></span></div></span></button></li>`;
    }).join("");
    $("ranking").querySelectorAll(".rk").forEach(b => b.addEventListener("click", () => { SEL = b.dataset.name; POPUP_FOR = SEL; render(); }));

    // Trade-offs
    $("tradeoffs").innerHTML = `<h3>Why not the obvious choices?</h3><div class="tlist">${res.why.length ? res.why.map(w => `<div class="t"><span class="eyebrow">${esc(w.title)}</span><strong>${esc(w.name)}</strong>${esc(w.txt)}</div>`).join("") : `<div class="t">The recommended sites are also the biggest, busiest and richest options, so there is no trade-off to explain.</div>`}</div>`;
    $("tradeoffs").hidden = false;

    renderDetail(base);
    if (TAB === "rec") drawMap(base, picks);
    renderCompare(base);
    renderStress(ST);
    renderRegister(res);
    renderCalib(cal);
    renderNearest();
    $("memoText").textContent = memoText(res);
  }

  function renderDetail(base) {
    const d = base.find(b => b.name === SEL), s = ST_OF(d), { pro, con } = prosCons(d), mr = maxRent(d);
    const row = (l, v, c = "") => `<tr class="${c}"><td>${l}</td><td class="r ${v < 0 ? "neg" : ""}">${cr(v)}</td></tr>`;
    const mx = Math.max(d.wallet, d.traffic);
    $("detail").innerHTML = `
      <div class="detail-head"><h2>${esc(d.name)} <span class="pill st-${s}" style="font-size:12px">${ST_LABEL[s]}</span></h2>
        <span class="sub">Rank #${base.indexOf(d) + 1} of ${base.length} · <a href="https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}" target="_blank" rel="noopener">View on Google Maps</a></span></div>
      <div class="kpis">
        <div class="kpi"><div class="k">Gross sales a year</div><div class="v">${money(d.rev)}</div></div>
        <div class="kpi"><div class="k">Net gain to chain</div><div class="v ${d.incr < 0 ? "neg" : ""}">${money(d.incr)}</div></div>
        <div class="kpi"><div class="k">Payback</div><div class="v">${yrs(d.pb)}</div></div>
        <div class="kpi"><div class="k">Max rent to pass the bar</div><div class="v">${mr > 0 ? "₹" + Math.floor(mr) : "none"}<span class="small muted"> /sq ft · quoted ₹${d.rent}</span></div></div>
      </div>
      <div class="cols3">
        <div><h3>Strengths</h3><ul class="reasons pro">${pro.map(t => `<li>${esc(t)}</li>`).join("") || "<li>None stand out.</li>"}</ul>
          <h3 style="margin-top:14px">Concerns</h3><ul class="reasons con">${con.map(t => `<li>${esc(t)}</li>`).join("") || "<li>None found.</li>"}</ul></div>
        <div><h3>Year-1 P&amp;L (₹ crore)</h3><table class="pl">${row("Sales", d.rev)}${row(`Gross margin (${A.gm}%)`, d.gross)}${row("Rent", -d.rentY)}${row("Staff, power, security", -M.FIXED.fixedOpex)}${row(`Other costs (${Math.round(M.FIXED.varOpex * 100)}%)`, -d.other)}${row("Store EBITDA", d.ebitda, "tot")}${row("Margin lost at our stores", -d.lost)}${row("Net gain to chain", d.incr, "tot")}${row("One-off capex", d.capex)}<tr><td>Payback</td><td class="r">${yrs(d.pb)}</td></tr></table></div>
        <div><h3>Where sales come from (₹ cr)</h3>
          <div class="sbars"><span>Local households</span><span class="sbar"><span style="width:${d.wallet / mx * 100}%"></span></span><span class="num">${cr1(d.wallet)}</span>
          <span>Passing footfall</span><span class="sbar"><span class="alt" style="width:${d.traffic / mx * 100}%"></span></span><span class="num">${cr1(d.traffic)}</span></div>
          <p class="small muted" style="margin:6px 0 14px">Forecast uses the lower: limited by ${d.binding === "wallet" ? "local spending" : "footfall"}.</p>
          <h3>Score build-up · ${Math.round(d.score)}/100</h3>
          <div class="sbars">${M.CRITERIA.map(c => `<span>${c.l}</span><span class="sbar"><span style="width:${d.parts[c.k].n * 100}%"></span></span><span class="num">${d.parts[c.k].pts.toFixed(0)}</span>`).join("")}</div>
          <p class="small muted" style="margin:6px 0 0">Bars: how this site ranks against the others on each factor. Numbers: weighted points.</p></div>
      </div>`;
  }

  function renderCompare(base) {
    $("cmpTable").querySelector("tbody").innerHTML = base.map(r => {
      const s = ST_OF(r), mr = maxRent(r);
      return `<tr class="click" data-name="${esc(r.name)}"><td class="sticky"><strong>${esc(r.name)}</strong></td><td><span class="pill st-${s}" style="margin:0">${ST_LABEL[s]}</span></td>
        <td class="r">${Math.round(r.score)}</td><td class="r">${r.foot.toLocaleString("en-IN")}</td><td class="r">₹${r.inc}k/mo</td><td class="r">${r.comp}</td><td class="r">₹${r.rent}</td><td class="r">${r.access}/10</td>
        <td class="r">${cr1(r.rev)}</td><td>${r.binding === "wallet" ? "Local spending" : "Footfall"}</td><td class="r">${r.cann > 0.005 ? `${cr1(r.rev * r.cann)} (${pct(r.cann)})` : "none"}</td>
        <td class="r ${r.ebitda < 0 ? "neg" : ""}">${cr(r.ebitda)}</td><td class="r ${r.incr < 0 ? "neg" : ""}"><strong>${cr(r.incr)}</strong></td><td class="r">${cr1(r.capex)}</td><td class="r">${yrs(r.pb)}</td><td class="r">${mr > 0 ? "₹" + Math.floor(mr) : "none"}</td></tr>`;
    }).join("");
    $("cmpTable").querySelectorAll("tr.click").forEach(tr => tr.addEventListener("click", () => { SEL = tr.dataset.name; POPUP_FOR = SEL; showTab("rec"); render(); }));
    renderScatter(base);
    renderFootfall(base);
  }

  function renderScatter(base) {
    const Wd = 600, Ht = 380, L = 64, R = 20, T = 20, B = 46;
    const xMax = 10, xv = r => Math.min(r.pb, xMax);
    const ys = base.map(r => r.incr / 1e7), lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), padY = (hi - lo) * 0.12 || 0.5;
    const y0 = lo - padY, y1 = hi + padY;
    const X = v => L + (v / xMax) * (Wd - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (Ht - T - B);
    const step = (y1 - y0) > 4 ? 1 : 0.5;
    let g = "";
    for (let t = Math.ceil(y0 / step) * step; t <= y1; t += step) g += `<line x1="${L}" x2="${Wd - R}" y1="${Y(t)}" y2="${Y(t)}" style="stroke:var(--line)"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" style="fill:var(--muted)">₹${t.toFixed(step < 1 ? 1 : 0)} cr</text>`;
    for (let t = 0; t <= xMax; t += 2) g += `<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${Ht - B}" style="stroke:var(--line)"/><text x="${X(t)}" y="${Ht - B + 16}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${t === xMax ? "10+" : t}</text>`;
    g += `<line x1="${L}" x2="${Wd - R}" y1="${Y(0)}" y2="${Y(0)}" style="stroke:var(--ink)" stroke-width="1"/>`;
    g += `<line x1="${X(A.hurdle)}" x2="${X(A.hurdle)}" y1="${T}" y2="${Ht - B}" style="stroke:var(--ink)" stroke-dasharray="5 5"/><text x="${X(A.hurdle) + 6}" y="${T + 12}" font-size="11.5" style="fill:var(--ink)">payback bar ${A.hurdle} yrs</text>`;
    g += `<text x="${(L + Wd - R) / 2}" y="${Ht - 8}" text-anchor="middle" font-size="12" style="fill:var(--muted)">Payback (years)</text>`;
    g += `<text transform="translate(14 ${(T + Ht - B) / 2}) rotate(-90)" text-anchor="middle" font-size="12" style="fill:var(--muted)">Net gain to chain per year</text>`;
    const pts = base.map(r => ({ r, x: X(xv(r)), y: Y(r.incr / 1e7) })).sort((a, b) => a.y - b.y);
    const placed = pts.map(p => ({ y: p.y + 4, x0: p.x - 9, x1: p.x + 9 }));
    for (const p of pts) {
      const s = ST_OF(p.r), col = s === "open" ? "var(--go)" : s === "reserve" ? "var(--hold)" : "var(--stop)";
      const left = p.x > Wd * 0.62, w = p.r.name.length * 6.6 + 8;
      let ly = p.y + 4;
      for (const dy of [0, 14, -14, 28, -28, 42]) {
        const cand = p.y + 4 + dy, x0 = left ? p.x - 10 - w : p.x + 10;
        if (!placed.some(b => Math.abs(b.y - cand) < 13 && x0 < b.x1 && x0 + w > b.x0)) { ly = cand; placed.push({ y: cand, x0, x1: x0 + w }); break; }
      }
      g += `<g data-name="${esc(p.r.name)}" style="cursor:pointer"><circle cx="${p.x}" cy="${p.y}" r="${p.r.name === SEL ? 9 : 7}" style="fill:${col};stroke:var(--surface)" stroke-width="2"/>
        <text x="${left ? p.x - 10 : p.x + 10}" y="${ly}" text-anchor="${left ? "end" : "start"}" font-size="12" font-weight="700" style="fill:var(--ink)">${esc(p.r.name)}</text></g>`;
    }
    $("scatter").innerHTML = `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="Scatter chart of net gain against payback">${g}</svg>`;
    $("scatter").querySelectorAll("g[data-name]").forEach(n => n.addEventListener("click", () => { SEL = n.dataset.name; POPUP_FOR = SEL; showTab("rec"); render(); }));
  }

  function renderFootfall(base) {
    const rows = [...base].sort((a, b) => b.foot - a.foot), fMax = Math.max(...rows.map(r => r.foot));
    const lo = Math.min(0, ...rows.map(r => r.incr)), hi = Math.max(0, ...rows.map(r => r.incr)), span = hi - lo || 1, axis = (-lo / span) * 100;
    const byGain = [...base].sort((a, b) => b.incr - a.incr).map(r => r.name);
    $("ffchart").innerHTML = `<div class="ff"><div class="ffhead"><span>Site</span><span>Footfall / day</span><span>Net gain, ₹ cr/yr</span></div>${rows.map(r => {
      const w = Math.abs(r.incr) / span * 100, left = r.incr >= 0 ? axis : axis - w;
      const labLeft = r.incr >= 0 ? Math.min(axis + w, 74) : Math.max(axis - w - 24, 0);
      return `<div class="ffrow"><span class="nm" title="${esc(r.name)}">${esc(r.name)}</span>
        <span class="ffbar foot"><span style="width:${r.foot / fMax * 100}%"></span><em style="left:0">${(r.foot / 1000).toFixed(0)}k</em></span>
        <span class="ffbar"><span class="axis" style="left:${axis}%"></span><span class="${r.incr >= 0 ? "pos" : "neg"}" style="left:${left}%;width:${w}%"></span><em style="left:${labLeft}%">${r.incr >= 0 ? "" : "−"}${cr(Math.abs(r.incr))}</em></span></div>`;
    }).join("")}</div>`;
    const top = rows[0], rank = byGain.indexOf(top.name) + 1;
    $("ffchart").insertAdjacentHTML("beforeend", rank > 1
      ? `<div class="callout"><strong>${esc(top.name)}</strong> has the most footfall (${top.foot.toLocaleString("en-IN")} a day) but ranks <strong>#${rank} of ${rows.length}</strong> on profit to the chain. ${top.binding === "wallet" ? "Too few people live nearby to turn that crowd into sales." : "Rent, competition or cannibalisation absorb the extra sales."}</div>`
      : `<div class="callout">Here the busiest site is also the most profitable, so footfall is a fair guide for this data set.</div>`);
  }

  function renderStress(ST) {
    const names = Object.keys(ST.count).sort((a, b) => ST.count[b] - ST.count[a]);
    for (const n of ST.baseNames) if (!names.includes(n)) names.unshift(n);
    $("robust").innerHTML = (names.length ? names.map(n => {
      const c = ST.count[n] || 0, isPick = ST.baseNames.includes(n);
      return `<div class="rrow"><span>${esc(n)}${isPick ? " ★" : ""}</span><span class="track"><span class="${isPick ? "" : "weak"}" style="width:${c / ST.total * 100}%"></span></span><span class="num">${c}/${ST.total}</span></div>`;
    }).join("") : `<p class="muted">No site is picked in any scenario.</p>`) + `<div class="vbox ${ST.sameN >= ST.total - 1 ? "" : "mixed"}">${esc(ST.verdict)}</div>`;
    $("stressTable").querySelector("tbody").innerHTML = `<tr><td><strong>Base case</strong></td><td class="muted">Current settings</td><td>${esc(ST.baseNames.join(", ") || "none")}</td><td>–</td></tr>` +
      ST.rows.map(r => `<tr><td><strong>${esc(r.label)}</strong></td><td class="muted">${esc(r.desc)}</td><td>${esc(r.names.join(", ") || "none")}</td><td class="${r.same ? "yes" : "no"}">${r.same ? "Yes" : "Changes"}</td></tr>`).join("");
  }

  function renderCalib(cal) {
    $("calib").querySelector("tbody").innerHTML = cal.rows.length ? cal.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="r">${cr1(r.model)}</td><td class="r">${cr1(r.actual)}</td><td class="r">${r.err >= 0 ? "+" : ""}${(r.err * 100).toFixed(0)}%</td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">No existing-store sales in this data set.</td></tr>`;
    $("calibNote").textContent = cal.rows.length
      ? `The raw model is multiplied by ${cal.k.toFixed(2)} so it matches what our own stores actually sell. Average error after calibration: ${(cal.mape * 100).toFixed(0)}%, which is why forecasts should be read as ±15%.`
      : "Add actual_sales_cr for existing stores to calibrate the model to your chain.";
  }
  function renderNearest() {
    [...DATA.existing, ...DATA.candidates].forEach((s, i) => {
      const cell = $("nr-" + i); if (!cell) return;
      const others = DATA.existing.filter(e => e.name !== s.name);
      if (!others.length) { cell.textContent = "–"; return; }
      const n = others.map(e => ({ e, d: M.km(s, e) })).sort((a, b) => a.d - b.d)[0];
      cell.textContent = `${n.e.name} · ${n.d.toFixed(1)} km`;
    });
  }

  // ---------- Decision memo ----------
  function memoText(res) {
    const { picks, base, stress: ST, cal } = res;
    const L = [], today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    L.push("DECISION MEMO: WHERE TO OPEN THE NEXT STORE", `Date: ${today}`, `Data: ${SRC} (${DATA.candidates.length} candidate sites, ${DATA.existing.length} existing stores)`, `Budget: ${N} new store${N > 1 ? "s" : ""}`, "");
    L.push("RECOMMENDATION");
    if (!picks.length) L.push(`Hold. No candidate pays back within ${A.hurdle} years under current assumptions.`, "");
    else {
      const tCap = picks.reduce((a, p) => a + p.capex, 0), tInc = picks.reduce((a, p) => a + p.incr, 0), tRev = picks.reduce((a, p) => a + p.rev, 0);
      L.push(`Open ${picks.map(p => p.name).join(", then ")}.`, `Capex ${money(tCap)} | Sales ${money(tRev)} a year | Net gain to chain ${money(tInc)} a year | Payback ${(tCap / tInc).toFixed(1)} years`, "");
      L.push("WHY THESE SITES");
      picks.forEach((p, i) => {
        const { pro, con } = prosCons(p);
        L.push(`${i + 1}. ${p.name} (score ${Math.round(p.score)}/100)`);
        pro.forEach(t => L.push("   + " + t)); con.forEach(t => L.push("   - " + t));
        const mr = maxRent(p);
        if (mr > 0) L.push(`   > Negotiation ceiling: rent can rise to ₹${Math.floor(mr)}/sq ft/month (quoted ₹${p.rent}) before the site fails the payback bar.`);
      });
      L.push("");
    }
    if (res.why.length) { L.push("TRADE-OFFS CONSIDERED"); res.why.forEach(w => L.push(`- Why not ${w.name}? ${w.txt}`)); L.push(""); }
    if (picks.length) { L.push("ROBUSTNESS"); L.push(ST.verdict); ST.rows.forEach(r => L.push(`- ${r.label} (${r.desc}): ${r.names.join(", ") || "none"}${r.same ? "" : "  <- changes"}`)); L.push(""); }
    L.push("FULL RANKING (₹ crore a year)");
    base.forEach((r, i) => L.push(`${String(i + 1).padStart(2)}. ${r.name.padEnd(18)} ${ST_LABEL[ST_OF(r)].padEnd(8)} score ${String(Math.round(r.score)).padStart(3)} | sales ${cr1(r.rev).padStart(5)} | net gain ${cr(r.incr).padStart(6)} | payback ${yrs(r.pb).padStart(9)}`));
    L.push("", "KEY ASSUMPTIONS (full register on the Assumptions tab)");
    registerRows(res).filter(r => r.length > 1).forEach(r => L.push(`- ${r[0]}: ${r[1]}`));
    if (res.reg) L.push(`Sensitivity: ${res.reg.held} of ${res.reg.tested} tested assumptions can be worse without changing the picks.`);
    L.push(cal.rows.length ? `Calibration: ${cal.rows.length} existing stores, factor ${cal.k.toFixed(2)}, average error ${(cal.mape * 100).toFixed(0)}%.` : "Calibration: none (no existing-store sales supplied).");
    L.push("Data: neighbourhood names and coordinates are real; population, income, footfall, competitors, rents and store sales are synthetic.", "");
    L.push("KEY LIMITATION", "Catchments are straight-line circles. Shoppers follow rail lines, creeks and flyovers, so cannibalisation and competition should be confirmed with travel-time catchments and loyalty-card data.", "");
    L.push("NEXT STEPS",
      "1. Count footfall at each recommended site on two weekdays and one weekend day to validate the forecast.",
      "2. Negotiate rent below the ceilings above; walk away if the landlord will not go below them.",
      "3. Check travel-time catchments and loyalty-card overlap with the nearest existing stores before signing.");
    return L.join("\n");
  }

  // ---------- Map: real basemap (Leaflet) with SVG fallback ----------
  let LMAP = null, TILE = null, G = null, FIT_KEY = "", POPUP_FOR = null, TILE_ERR = 0;
  function tileLayer() {
    const url = isDark() ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
    const t = L.tileLayer(url, { subdomains: "abcd", maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' });
    t.on("tileerror", () => {
      if (++TILE_ERR === 6 && TILE === t) {
        LMAP.removeLayer(t);
        TILE = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(LMAP);
      }
    });
    return t;
  }
  function initLeaflet() {
    LMAP = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.25 });
    TILE = tileLayer().addTo(LMAP);
    G = { zones: L.layerGroup().addTo(LMAP), links: L.layerGroup().addTo(LMAP), stores: L.layerGroup().addTo(LMAP), sites: L.layerGroup().addTo(LMAP), labels: L.layerGroup().addTo(LMAP) };
    L.control.layers(null, { "Catchment zones": G.zones, "Cannibalisation links": G.links, "Site names": G.labels }, { collapsed: true }).addTo(LMAP);
    L.control.scale({ imperial: false }).addTo(LMAP);
    LMAP.on("overlayadd overlayremove", e => { if (e.layer === G.labels) $("map").classList.toggle("hide-labels", e.type === "overlayremove"); });
    LMAP.on("focus", () => LMAP.scrollWheelZoom.enable());
    LMAP.on("blur", () => LMAP.scrollWheelZoom.disable());
    LMAP.on("click", e => {
      const ll = e.latlng, here = { lat: ll.lat, lng: ll.lng };
      const near = DATA.existing.map(x => ({ x, d: M.km(here, x) })).sort((a, b) => a.d - b.d)[0];
      const box = document.createElement("div");
      box.className = "pop";
      box.innerHTML = `<h4>Test this spot</h4><div class="st" style="color:var(--muted)">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div>
        <dl>${near ? `<dt>Nearest store of ours</dt><dd>${esc(near.x.name)}</dd><dt>Distance</dt><dd>${near.d.toFixed(1)} km</dd><dt>Inside its catchment?</dt><dd>${near.d < A.radius ? "Yes" : "No"}</dd>` : ""}</dl>
        <button class="btn primary" type="button">Analyse this spot</button>`;
      box.querySelector("button").addEventListener("click", () => {
        $("f-lat").value = ll.lat.toFixed(5); $("f-lng").value = ll.lng.toFixed(5);
        LMAP.closePopup(); showTab("upload");
        $("addForm").scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => $("f-name").focus(), 400);
      });
      L.popup().setLatLng(ll).setContent(box).openOn(LMAP);
    });
    const swap = () => { if (!LMAP) return; LMAP.removeLayer(TILE); TILE_ERR = 0; TILE = tileLayer().addTo(LMAP); if (LAST && TAB === "rec") drawLeaflet(LAST.base, LAST.picks); };
    try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", swap); } catch (e) { /* old Safari */ }
    new MutationObserver(swap).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  function sitePopup(r, rank) {
    const box = document.createElement("div"), s = ST_OF(r);
    box.className = "pop";
    box.innerHTML = `<h4>${esc(r.name)}</h4><div class="st" style="color:var(--${s === "open" ? "go" : s === "reserve" ? "hold" : "stop"})">Rank #${rank} · ${ST_LABEL[s]}</div>
      <dl><dt>Score</dt><dd>${Math.round(r.score)}/100</dd><dt>Sales</dt><dd>${money(r.rev)}</dd><dt>Net gain to chain</dt><dd>${money(r.incr)}</dd>
      <dt>Payback</dt><dd>${yrs(r.pb)}</dd><dt>From our stores</dt><dd>${pct(r.cann)}</dd><dt>Rent / sales</dt><dd>${(r.rentB * 100).toFixed(1)}%</dd><dt>Footfall</dt><dd>${r.foot.toLocaleString("en-IN")}/day</dd></dl>
      <button class="btn primary" type="button">See full case</button>`;
    box.querySelector("button").addEventListener("click", () => { LMAP.closePopup(); $("detail").scrollIntoView({ behavior: "smooth", block: "start" }); });
    return box;
  }
  function drawLeaflet(base, picks) {
    if (!LMAP) initLeaflet();
    Object.values(G).forEach(g => g.clearLayers());
    const cEx = "#172235", cGo = cssVar("--go"), cStop = cssVar("--stop");
    for (const e of DATA.existing) {
      L.circle([e.lat, e.lng], { radius: A.radius * 1000, color: isDark() ? "#9AA7B6" : cEx, weight: 1.2, dashArray: "5 6", fillColor: isDark() ? "#9AA7B6" : cEx, fillOpacity: 0.05, interactive: false }).addTo(G.zones);
      const m = L.marker([e.lat, e.lng], { title: e.name, zIndexOffset: 200, icon: L.divIcon({ className: "pin-wrap", iconSize: [22, 22], iconAnchor: [11, 11],
        html: `<div class="store"><svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M3 9l2-5h14l2 5v1a3 3 0 01-6 0 3 3 0 01-6 0 3 3 0 01-6 0V9zm2 4.5V20h5v-4h4v4h5v-6.5a4.9 4.9 0 01-4.5-.5A5 5 0 0112 14a5 5 0 01-2.5-1 4.9 4.9 0 01-4.5.5z"/></svg></div><span class="pin-label">${esc(e.name)} · our store</span>` }) });
      m.bindPopup(`<div class="pop"><h4>${esc(e.name)}</h4><div class="st" style="color:var(--muted)">Our existing store</div><dl>${e.actual ? `<dt>Last year's sales</dt><dd>₹${e.actual.toFixed(1)} cr</dd>` : ""}<dt>Footfall</dt><dd>${e.foot.toLocaleString("en-IN")}/day</dd><dt>Catchment radius</dt><dd>${A.radius} km</dd></dl></div>`);
      m.addTo(G.stores);
    }
    for (const p of picks) L.circle([p.lat, p.lng], { radius: A.radius * 1000, color: cGo, weight: 1.5, dashArray: "5 6", fillColor: cGo, fillOpacity: 0.07, interactive: false }).addTo(G.zones);
    const d = base.find(b => b.name === SEL);
    if (d) for (const n of d.near) {
      const t = DATA.existing.find(x => x.name === n.name) || picks.find(x => x.name === n.name);
      if (!t) continue;
      L.polyline([[d.lat, d.lng], [t.lat, t.lng]], { color: cStop, weight: 2.5, dashArray: "6 6", interactive: false }).addTo(G.links);
      L.marker([(d.lat + t.lat) / 2, (d.lng + t.lng) / 2], { interactive: false, icon: L.divIcon({ className: "", iconSize: null, html: `<span class="cann-tag">−${Math.round(n.f * 100)}% sales</span>` }) }).addTo(G.links);
    }
    base.forEach((r, i) => {
      const s = ST_OF(r), sz = Math.round(22 + (r.score / 100) * 12), sel = r.name === SEL;
      const m = L.marker([r.lat, r.lng], { title: r.name, riseOnHover: true, zIndexOffset: sel ? 1000 : s === "open" ? 600 : 300,
        icon: L.divIcon({ className: "pin-wrap", iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2], popupAnchor: [0, -sz / 2],
          html: `<div class="pin ${s}${sel ? " sel" : ""}">${i + 1}</div><span class="pin-label">${esc(r.name)}</span>` }) });
      m.bindPopup(sitePopup(r, i + 1));
      m.on("click", () => { if (SEL !== r.name) { POPUP_FOR = r.name; SEL = r.name; render(); } });
      m.addTo(G.sites);
      if (POPUP_FOR === r.name) setTimeout(() => m.openPopup(), 0);
    });
    POPUP_FOR = null;
    const key = [...DATA.existing, ...DATA.candidates].map(x => x.name + x.lat + x.lng).join("|");
    if (key !== FIT_KEY) {
      FIT_KEY = key;
      LMAP.fitBounds(L.latLngBounds([...DATA.existing, ...base].map(x => [x.lat, x.lng])).pad(0.12), { maxZoom: 14 });
    }
  }
  function drawSvgMap(base, picks) {
    const pts = [...DATA.existing, ...base];
    const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    const kx = 111.32 * Math.cos(lat0 * Math.PI / 180), ky = 110.57;
    const xs = pts.map(p => p.lng * kx), ys = pts.map(p => p.lat * ky), pad = 2.5;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const Wd = 520, Ht = 440, m = 20;
    const s = Math.min((Wd - 2 * m) / (maxX - minX), (Ht - 2 * m) / (maxY - minY));
    const ox = (Wd - (maxX - minX) * s) / 2, oy = (Ht - (maxY - minY) * s) / 2;
    const X = p => ox + (p.lng * kx - minX) * s, Y = p => Ht - oy - (p.lat * ky - minY) * s;
    let g = `<rect x="0" y="0" width="${Wd}" height="${Ht}" rx="6" style="fill:var(--surface-2)"/>`;
    for (let gx = Math.ceil(minX / 2) * 2; gx <= maxX; gx += 2) { const x = ox + (gx - minX) * s; g += `<line x1="${x}" y1="0" x2="${x}" y2="${Ht}" style="stroke:var(--line)"/>`; }
    for (let gy = Math.ceil(minY / 2) * 2; gy <= maxY; gy += 2) { const y = Ht - oy - (gy - minY) * s; g += `<line x1="0" y1="${y}" x2="${Wd}" y2="${y}" style="stroke:var(--line)"/>`; }
    g += `<line x1="${Wd - 20 - 5 * s}" y1="${Ht - 16}" x2="${Wd - 20}" y2="${Ht - 16}" style="stroke:var(--ink)" stroke-width="2"/><text x="${Wd - 20 - 2.5 * s}" y="${Ht - 22}" text-anchor="middle" font-size="10" style="fill:var(--ink)">5 km</text>`;
    g += `<text x="${Wd - 16}" y="22" text-anchor="end" font-size="11" style="fill:var(--muted)">N ↑</text>`;
    const R = A.radius * s;
    for (const e of DATA.existing) g += `<circle cx="${X(e)}" cy="${Y(e)}" r="${R}" style="fill:var(--existing);fill-opacity:.05;stroke:var(--existing);stroke-opacity:.5" stroke-dasharray="3 4"/>`;
    for (const p of picks) g += `<circle cx="${X(p)}" cy="${Y(p)}" r="${R}" style="fill:var(--go);fill-opacity:.07;stroke:var(--go);stroke-opacity:.6" stroke-dasharray="3 4"/>`;
    for (const e of DATA.existing) { const right = X(e) < Wd * 0.72; g += `<rect x="${X(e) - 6}" y="${Y(e) - 6}" width="12" height="12" rx="2" style="fill:var(--existing)"/><text x="${X(e) + (right ? 10 : -10)}" y="${Y(e) + 4}" text-anchor="${right ? "start" : "end"}" font-size="10.5" style="fill:var(--muted)">${esc(e.name)} store</text>`; }
    base.forEach((r, i) => {
      const st = ST_OF(r), col = st === "open" ? "var(--go)" : st === "reserve" ? "var(--hold)" : "var(--stop)", rad = 8 + r.score / 20, right = X(r) < Wd * 0.72;
      g += `<g data-name="${esc(r.name)}" style="cursor:pointer">${r.name === SEL ? `<circle cx="${X(r)}" cy="${Y(r)}" r="${rad + 5}" style="fill:none;stroke:var(--accent)" stroke-width="2"/>` : ""}
        <circle cx="${X(r)}" cy="${Y(r)}" r="${rad}" style="fill:${col};stroke:var(--surface)" stroke-width="2"/><text x="${X(r)}" y="${Y(r) + 4}" text-anchor="middle" font-size="11" font-weight="700" style="fill:#fff">${i + 1}</text>
        <text x="${X(r) + (right ? rad + 4 : -rad - 4)}" y="${Y(r) + 4}" text-anchor="${right ? "start" : "end"}" font-size="11.5" font-weight="700" style="fill:var(--ink)">${esc(r.name)}</text></g>`;
    });
    const svg = $("mapSvg"); svg.innerHTML = g;
    svg.querySelectorAll("g[data-name]").forEach(n => n.addEventListener("click", () => { SEL = n.dataset.name; render(); }));
  }
  function drawMap(base, picks) {
    if (window.L && typeof L.map === "function") { $("mapSvg").hidden = true; $("map").hidden = false; drawLeaflet(base, picks); }
    else { $("map").hidden = true; $("mapSvg").hidden = false; drawSvgMap(base, picks); }
  }

  // ---------- Inputs table + controls ----------
  function buildInputs() {
    const all = [...DATA.existing.map(s => [s, "existing"]), ...DATA.candidates.map(s => [s, "candidate"])];
    const fields = ["pop", "inc", "foot", "comp", "rent", "access", "actual"];
    $("inputs").querySelector("tbody").innerHTML = all.map(([s, t], i) => `<tr><td class="sticky"><strong>${esc(s.name)}</strong></td><td><span class="tag ${t === "existing" ? "ex" : "ca"}">${t}</span></td>${fields.map(f =>
      f === "actual" && t !== "existing" ? `<td class="r muted">–</td>` :
      `<td class="r"><input id="in-${i}-${f}" type="number" step="${f === "pop" || f === "actual" ? 0.1 : f === "foot" ? 500 : 1}" min="0" value="${s[f]}" data-i="${i}" data-f="${f}" aria-label="${esc(s.name)} ${f}"></td>`).join("")}<td class="r" id="nr-${i}"></td></tr>`).join("");
    $("inputs").querySelectorAll("input").forEach(inp => inp.addEventListener("input", () => {
      const v = parseFloat(inp.value); if (isNaN(v) || v < 0) return;
      all[+inp.dataset.i][0][inp.dataset.f] = v; render();
    }));
  }
  const ctlHTML = (c, val, prefix) => `<div class="ctl"><label for="${prefix}-${c.k}">${c.l}</label><output id="${prefix}o-${c.k}">${c.f(val)}</output><input type="range" id="${prefix}-${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${val}">${c.h ? `<small>${c.h}</small>` : ""}</div>`;
  function buildControls() {
    $("hurdleCtl").innerHTML = ctlHTML(HCTL, A.hurdle, "a");
    $("a-hurdle").addEventListener("input", e => { A.hurdle = +e.target.value; $("ao-hurdle").textContent = HCTL.f(A.hurdle); render(); });
    $("weights").innerHTML = M.CRITERIA.map(c => ctlHTML({ k: c.k, l: c.l, min: 0, max: 50, step: 5, f: v => String(v) }, W[c.k], "w")).join("");
    const sum = () => { const t = M.CRITERIA.reduce((a, c) => a + W[c.k], 0) || 1; $("wsum").textContent = "Shares: " + M.CRITERIA.map(c => `${Math.round(W[c.k] / t * 100)}%`).join(" · "); };
    M.CRITERIA.forEach(c => $("w-" + c.k).addEventListener("input", e => { W[c.k] = +e.target.value; $("wo-" + c.k).textContent = W[c.k]; sum(); render(); }));
    sum();
    $("assume").innerHTML = ACTL.map(c => ctlHTML(c, A[c.k], "s")).join("");
    ACTL.forEach(c => $("s-" + c.k).addEventListener("input", e => { A[c.k] = +e.target.value; $("so-" + c.k).textContent = c.f(A[c.k]); render(); }));
  }

  function exportCSV() {
    if (!LAST) return;
    const head = ["rank", "name", "decision", "score", "sales_cr", "store_ebitda_cr", "cannibalisation_pct", "net_gain_cr", "capex_cr", "payback_years", "max_rent_sqft", "limited_by", "stress_picked_of_7", "lat", "lng"];
    const lines = [head.join(",")].concat(LAST.base.map((r, i) => [i + 1, `"${r.name.replace(/"/g, '""')}"`, ST_LABEL[ST_OF(r)], r.score.toFixed(1), cr(r.rev), cr(r.ebitda), (r.cann * 100).toFixed(1), cr(r.incr), cr(r.capex),
      r.pb >= 99 ? "" : r.pb.toFixed(2), Math.max(0, Math.floor(maxRent(r))), r.binding === "wallet" ? "local spending" : "footfall", LAST.stress.count[r.name] || 0, r.lat, r.lng].join(",")));
    saveFile("site-ranking.csv", "﻿" + lines.join("\n"), "text/csv;charset=utf-8");
  }

  // ---------- Wire up ----------
  const drop = $("drop"), file = $("file");
  file.addEventListener("change", () => { readFile(file.files[0]); file.value = ""; });
  drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => readFile(e.dataTransfer.files[0]));
  $("loadSample").addEventListener("click", () => loadRows(M.parseCSV(SAMPLE_CSV), "Mumbai sample"));
  $("exportCsv").addEventListener("click", exportCSV);
  document.querySelectorAll("#nseg button").forEach(b => b.addEventListener("click", () => {
    N = +b.dataset.n; $("nOut").textContent = N;
    document.querySelectorAll("#nseg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); render();
  }));
  $("resetW").addEventListener("click", () => { M.CRITERIA.forEach(c => (W[c.k] = c.w)); buildControls(); render(); });
  $("resetA").addEventListener("click", () => { const h = A.hurdle; A = Object.assign({}, M.DEFAULTS, { hurdle: h }); buildControls(); render(); });
  $("addForm").addEventListener("submit", e => {
    e.preventDefault();
    const g = id => parseFloat($("f-" + id).value), name = $("f-name").value.trim();
    if (!name) return;
    if ([...DATA.existing, ...DATA.candidates].some(s => s.name.toLowerCase() === name.toLowerCase())) {
      $("msg").innerHTML = `<div class="msg err">A location called “${esc(name)}” already exists. Use a different name.</div>`; $("msg").scrollIntoView({ block: "center" }); return;
    }
    DATA.candidates.push({ name, lat: g("lat"), lng: g("lng"), pop: g("pop"), inc: g("inc"), foot: g("foot"), comp: g("comp"), rent: g("rent"), access: Math.min(10, g("access")) });
    SEL = name; POPUP_FOR = name; buildInputs(); showTab("rec"); render();
    toast(`${name} added and analysed`);
    $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("copyMemo").addEventListener("click", () => {
    const t = $("memoText").textContent;
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($("memoText")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Memo selected. Press Ctrl+C to copy."); };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast("Memo copied"), fallback); else fallback();
  });
  $("dlMemo").addEventListener("click", () => saveFile("store-decision-memo.txt", $("memoText").textContent, "text/plain;charset=utf-8"));

  buildControls();
  loadRows(M.parseCSV(SAMPLE_CSV), "Mumbai sample");
  showTab((location.hash || "#rec").slice(1));
})();
