const fmt = (n) => "$" + Math.round(n).toLocaleString();

// Escape third-party text (donor/candidate/town names are self-reported filing
// data) before interpolating into innerHTML — prevents stored XSS.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Design tokens, read from CSS so JS-drawn chart stays in sync with the theme.
const css = getComputedStyle(document.documentElement);
const INK = css.getPropertyValue("--ink").trim() || "#0b1f33";
const ACCENT = css.getPropertyValue("--accent").trim() || "#e2553c";
const BRASS = css.getPropertyValue("--brass").trim() || "#b6892f";
const MUTE = css.getPropertyValue("--ink-40").trim() || "rgba(11,31,51,.4)";
const FONT = "Archivo, system-ui, sans-serif";

async function load(name) {
  const res = await fetch(`data/${name}.json`);
  if (!res.ok) throw new Error(`failed to load ${name}.json`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Filter engine state. ROWS is the columnar dataset turned into objects once;
// every view is recomputed live from the rows matching the current filters.
// ---------------------------------------------------------------------------
let ROWS = [];                 // [{recipient, town, office, donor, donorKey, city, amount, year, type}]
let chart = null;              // Chart.js instance (recreated on filter change)

const state = {
  town: "",        // "" = all
  office: "",      // "" = all
  politician: "",  // exact recipient name, "" = none
  donor: "",       // donor-name substring; a global filter (every panel)
};

// Rows matching every active filter — Town, Office, Politician, and Donor.
// All four are global: every panel (headline, timeline, donors table, and the
// candidate/donor card) is recomputed from this set.
function globalRows() {
  const dq = state.donor.trim().toLowerCase();
  return ROWS.filter((r) =>
    (!state.town || r.town === state.town) &&
    (!state.office || r.office === state.office) &&
    (!state.politician || r.recipient === state.politician) &&
    (!dq || (r.donor || "").toLowerCase().includes(dq)));
}

// ---------------------------------------------------------------------------
// HERO
// ---------------------------------------------------------------------------
function renderHeadline(rows) {
  let total = 0;
  const cands = new Set();
  const donors = new Set();
  const byTown = new Map();
  let yMin = Infinity, yMax = -Infinity;

  for (const r of rows) {
    total += r.amount;
    cands.add(r.recipient);
    donors.add(r.donorKey);
    byTown.set(r.town, (byTown.get(r.town) || 0) + r.amount);
    if (r.year != null) {
      if (r.year < yMin) yMin = r.year;
      if (r.year > yMax) yMax = r.year;
    }
  }

  const range = yMin === Infinity ? "" :
    (yMin === yMax ? `· ${yMin}` : `· ${yMin}–${yMax}`);
  document.getElementById("date-range").textContent = range;

  document.getElementById("headline-stats").innerHTML = `
    <div class="stat"><span class="num">${fmt(total)}</span><span class="stat__label">raised</span></div>
    <div class="stat"><span class="num">${cands.size.toLocaleString()}</span><span class="stat__label">candidates</span></div>
    <div class="stat"><span class="num">${donors.size.toLocaleString()}</span><span class="stat__label">donors</span></div>
    <div class="stat"><span class="num">${rows.length.toLocaleString()}</span><span class="stat__label">contributions</span></div>`;

  // Per-town chips for the towns present in the current filter, sorted by total.
  const chips = [...byTown.entries()].sort((a, b) => b[1] - a[1]);
  document.getElementById("town-chips").innerHTML = chips
    .map(([town, amt]) =>
      `<span class="chip"><span class="chip__town">${esc(town)}</span><span class="chip__amt">${fmt(amt)}</span></span>`)
    .join("");
}

// ---------------------------------------------------------------------------
// TIMELINE
// ---------------------------------------------------------------------------
function timelineData(rows) {
  const byYear = new Map();
  for (const r of rows) {
    if (r.year == null) continue;
    byYear.set(r.year, (byYear.get(r.year) || 0) + r.amount);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  return { labels: years, amounts: years.map((y) => byYear.get(y)) };
}

function renderTimeline(rows) {
  const { labels, amounts } = timelineData(rows);
  const ctx = document.getElementById("timeline-chart");
  const g = ctx.getContext("2d").createLinearGradient(0, 0, 0, 320);
  g.addColorStop(0, ACCENT);
  g.addColorStop(1, "rgba(226,85,60,.55)");

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = amounts;
    chart.data.datasets[0].backgroundColor = g;
    chart.update();
    return;
  }

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Raised",
        data: amounts,
        backgroundColor: g,
        hoverBackgroundColor: BRASS,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 96,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: INK,
          titleFont: { family: FONT, weight: "700" },
          bodyFont: { family: FONT },
          padding: 10,
          cornerRadius: 6,
          displayColors: false,
          callbacks: { label: (c) => fmt(c.parsed.y) + " raised" },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: MUTE },
          ticks: { color: INK, font: { family: FONT, weight: "600", size: 13 } },
        },
        y: {
          grid: { color: "rgba(11,31,51,.08)" },
          border: { display: false },
          ticks: {
            color: MUTE,
            font: { family: FONT, size: 12 },
            callback: (v) => "$" + Number(v).toLocaleString(),
          },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// TOP DONORS
// ---------------------------------------------------------------------------
function donorAggregates(rows) {
  const map = new Map();
  for (const r of rows) {
    let d = map.get(r.donorKey);
    if (!d) {
      d = { name: r.donor, city: r.city, total: 0, gifts: 0, cands: new Set(), byCand: new Map() };
      map.set(r.donorKey, d);
    }
    d.total += r.amount;
    d.gifts += 1;
    d.cands.add(r.recipient);
    d.byCand.set(r.recipient, (d.byCand.get(r.recipient) || 0) + r.amount);
  }
  return [...map.values()];
}

// How many candidate rows to list under a donor before collapsing the rest
// into a "+N more" summary — keeps a prolific donor from flooding the table.
const BREAKDOWN_LIMIT = 12;

// Show the per-candidate breakdown when the view is narrowed by donor or
// town/office — but not when a single politician is picked (then every donor
// maps one-to-one to that candidate, so there's nothing to break down).
function showBreakdown() {
  return !state.politician && (state.donor.trim() || state.town || state.office);
}

// Indented sub-rows listing each candidate this donor funded, biggest first.
// Candidate name sits under Donor+City; the amount stays under the Total column.
function breakdownRows(d, rowIdx) {
  const cands = [...d.byCand.entries()].sort((a, b) => b[1] - a[1]);
  const shown = cands.slice(0, BREAKDOWN_LIMIT);
  let html = shown.map(([name, amt]) => `
    <tr class="donor-sub" style="--row:${rowIdx}">
      <td class="col-rank"></td>
      <td class="sub-cand" colspan="2"><span class="sub-arrow">&#8627;</span>${esc(name)}</td>
      <td class="num sub-amt">${fmt(amt)}</td>
      <td></td><td></td>
    </tr>`).join("");
  const extra = cands.length - shown.length;
  if (extra > 0) {
    html += `
    <tr class="donor-sub donor-sub--more" style="--row:${rowIdx}">
      <td class="col-rank"></td>
      <td class="sub-cand" colspan="2">+${extra} more candidate${extra === 1 ? "" : "s"}</td>
      <td></td><td></td><td></td>
    </tr>`;
  }
  return html;
}

function renderDonors(rows) {
  // `rows` is already donor-filtered by globalRows(); just aggregate and rank.
  let donors = donorAggregates(rows);
  donors.sort((a, b) => b.total - a.total);
  donors = donors.slice(0, 50);

  const body = document.querySelector("#donors-table tbody");
  if (!donors.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty" style="padding:1.2rem .85rem">No donors match this filter.</td></tr>`;
    return;
  }
  const breakdown = showBreakdown();
  const max = Math.max(...donors.map((d) => d.total), 1);
  body.innerHTML = donors.map((d, i) => {
    const pct = Math.max((d.total / max) * 100, 2);
    const row = `
    <tr style="--row:${i}">
      <td class="col-rank${i < 3 ? " is-top" : ""}">${i + 1}</td>
      <td class="donor-name">
        <span class="bar" style="width:${pct}%"></span>
        <span class="donor-name__text">${esc(d.name)}</span>
      </td>
      <td class="city">${esc(d.city || "—")}</td>
      <td class="num strong">${fmt(d.total)}</td>
      <td class="num">${d.gifts}</td>
      <td class="num">${d.cands.size}</td>
    </tr>`;
    return breakdown && d.cands.size > 1 ? row + breakdownRows(d, i) : row;
  }).join("");
}

// ---------------------------------------------------------------------------
// POLITICIAN COMBOBOX — a real searchable dropdown (cascades under Town+Office).
// A native <datalist> won't reliably show its options on click, so we render our
// own list: it opens on focus/click AND filters as you type.
// ---------------------------------------------------------------------------
let polOptions = [];     // [{name, town, office, total}] cascaded, sorted by total
let polActiveIdx = -1;   // keyboard-highlighted option index

function rebuildPolOptions() {
  const rows = ROWS.filter((r) =>
    (!state.town || r.town === state.town) &&
    (!state.office || r.office === state.office));
  const totals = new Map(), meta = new Map();
  for (const r of rows) {
    totals.set(r.recipient, (totals.get(r.recipient) || 0) + r.amount);
    if (!meta.has(r.recipient)) meta.set(r.recipient, { town: r.town, office: r.office });
  }
  polOptions = [...totals.keys()]
    .sort((a, b) => totals.get(b) - totals.get(a))
    .map((name) => ({ name, total: totals.get(name), ...meta.get(name) }));
}

function polVisibleOptions() {
  const q = document.getElementById("f-politician").value.trim().toLowerCase();
  // Empty box, or box still showing the current pick, → show the FULL list.
  if (!q || (state.politician && q === state.politician.toLowerCase())) return polOptions;
  return polOptions.filter((o) => o.name.toLowerCase().includes(q));
}

function renderPolList() {
  const list = document.getElementById("pol-list");
  const opts = polVisibleOptions();
  polActiveIdx = -1;
  list.innerHTML = opts.length
    ? opts.map((o) =>
        `<li class="combo__opt" role="option" data-name="${esc(o.name)}">
           <span class="combo__opt-name">${esc(o.name)}</span>
           <span class="combo__opt-meta">${esc(o.town)} · ${fmt(o.total)}</span>
         </li>`).join("")
    : `<li class="combo__empty" role="presentation">No matching candidates</li>`;
}

function openPolList() {
  renderPolList();
  document.getElementById("pol-list").hidden = false;
  document.getElementById("f-politician").setAttribute("aria-expanded", "true");
}
function closePolList() {
  document.getElementById("pol-list").hidden = true;
  document.getElementById("f-politician").setAttribute("aria-expanded", "false");
  polActiveIdx = -1;
}
function choosePolitician(name) {
  state.politician = name;                       // "" clears the focus
  document.getElementById("f-politician").value = name;
  closePolList();
  render();
}

function setupPoliticianCombo() {
  const input = document.getElementById("f-politician");
  const list = document.getElementById("pol-list");

  input.addEventListener("focus", openPolList);
  input.addEventListener("click", openPolList);
  input.addEventListener("input", () => {
    if (input.value.trim() === "" && state.politician) { state.politician = ""; render(); }
    openPolList();
  });
  // mousedown beats the input's blur, so the option click actually registers.
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest(".combo__opt");
    if (!li) return;
    e.preventDefault();
    choosePolitician(li.dataset.name);
  });
  input.addEventListener("keydown", (e) => {
    const opts = [...list.querySelectorAll(".combo__opt")];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (list.hidden) openPolList();
      polActiveIdx = Math.min(polActiveIdx + 1, opts.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      polActiveIdx = Math.max(polActiveIdx - 1, 0);
    } else if (e.key === "Enter") {
      if (opts[polActiveIdx]) { e.preventDefault(); choosePolitician(opts[polActiveIdx].dataset.name); }
      return;
    } else if (e.key === "Escape") {
      closePolList(); return;
    } else { return; }
    opts.forEach((o, i) => o.classList.toggle("is-active", i === polActiveIdx));
    if (opts[polActiveIdx]) opts[polActiveIdx].scrollIntoView({ block: "nearest" });
  });
  // On blur, close and discard any un-chosen typing (re-sync to the real selection).
  input.addEventListener("blur", () => setTimeout(() => {
    closePolList();
    if (input.value !== state.politician) input.value = state.politician;
  }, 130));
}

// ---------------------------------------------------------------------------
// RENDER — recompute every view from the current filter state.
// ---------------------------------------------------------------------------
function render() {
  const rows = globalRows();
  renderHeadline(rows);
  renderTimeline(rows);
  renderDonors(rows);
}

// ---------------------------------------------------------------------------
// WIRING
// ---------------------------------------------------------------------------
function wireControls() {
  const townSel = document.getElementById("f-town");
  const officeSel = document.getElementById("f-office");
  const polInput = document.getElementById("f-politician");
  const donorInput = document.getElementById("f-donor");
  const reset = document.getElementById("f-reset");

  // Drop the selected politician if it no longer fits the current Town+Office.
  function clearPoliticianIfUnfit() {
    if (!state.politician) return;
    const fits = ROWS.some((r) => r.recipient === state.politician &&
      (!state.town || r.town === state.town) &&
      (!state.office || r.office === state.office));
    if (!fits) { state.politician = ""; polInput.value = ""; }
  }

  function onScopeChange() {
    clearPoliticianIfUnfit();
    rebuildPolOptions();
    if (!document.getElementById("pol-list").hidden) renderPolList();
    render();
  }

  townSel.addEventListener("change", () => { state.town = townSel.value; onScopeChange(); });
  officeSel.addEventListener("change", () => { state.office = officeSel.value; onScopeChange(); });

  // Donor search is a global filter — every panel reflects it. Debounced so the
  // timeline chart isn't re-animated on every keystroke.
  let donorTimer = null;
  donorInput.addEventListener("input", () => {
    clearTimeout(donorTimer);
    donorTimer = setTimeout(() => {
      state.donor = donorInput.value;
      render();
    }, 120);
  });

  reset.addEventListener("click", () => {
    state.town = state.office = state.politician = state.donor = "";
    townSel.value = officeSel.value = "";
    polInput.value = donorInput.value = "";
    rebuildPolOptions();
    closePolList();
    render();
  });
}

(async function main() {
  try {
    const data = await load("contributions");
    const F = {};
    data.fields.forEach((name, i) => (F[name] = i));
    ROWS = data.rows.map((r) => ({
      recipient: r[F.recipient],
      town: r[F.town],
      office: r[F.office],
      donor: r[F.donor],
      donorKey: r[F.donor_key],
      city: r[F.city],
      amount: typeof r[F.amount] === "number" ? r[F.amount] : Number(r[F.amount]) || 0,
      year: r[F.year],
      type: r[F.type],
    }));

    rebuildPolOptions();
    wireControls();
    setupPoliticianCombo();
    render();
    document.body.classList.add("is-ready");
  } catch (e) {
    document.body.insertAdjacentHTML("afterbegin",
      `<p style="color:#e2553c;padding:1rem">Error loading data: ${esc(e.message)}</p>`);
  }
})();
