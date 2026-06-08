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
      d = { name: r.donor, city: r.city, total: 0, gifts: 0, cands: new Set() };
      map.set(r.donorKey, d);
    }
    d.total += r.amount;
    d.gifts += 1;
    d.cands.add(r.recipient);
  }
  return [...map.values()];
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
  const max = Math.max(...donors.map((d) => d.total), 1);
  body.innerHTML = donors.map((d, i) => {
    const pct = Math.max((d.total / max) * 100, 2);
    return `
    <tr style="--row:${i}">
      <td class="col-rank">${i + 1}</td>
      <td class="donor-name">
        <span class="bar" style="width:${pct}%"></span>
        <span class="donor-name__text">${esc(d.name)}</span>
      </td>
      <td class="city">${esc(d.city || "—")}</td>
      <td class="num strong">${fmt(d.total)}</td>
      <td class="num">${d.gifts}</td>
      <td class="num">${d.cands.size}</td>
    </tr>`;
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
// CANDIDATE DETAIL
// ---------------------------------------------------------------------------
function renderCandidate() {
  const detail = document.getElementById("candidate-detail");
  // Politician picked → who funds them. Otherwise a donor search → which
  // candidates that donor funds. Otherwise a prompt.
  if (state.politician) { renderCandidateCard(detail); return; }
  const q = state.donor.trim();
  if (q) { renderDonorCard(detail, q); return; }
  detail.innerHTML = `<p class="cand-empty">Select a politician — or search a donor above — to follow the money.</p>`;
}

// Candidate view: the backers behind one politician (within all active filters).
function renderCandidateCard(detail) {
  const rows = globalRows();   // already scoped to this politician (+ town/office/donor)
  if (!rows.length) {
    detail.innerHTML = `<p class="cand-empty">No contributions found for “${esc(state.politician)}”.</p>`;
    return;
  }

  let total = 0;
  const donorKeys = new Set();
  const byYear = new Map();
  for (const r of rows) {
    total += r.amount;
    donorKeys.add(r.donorKey);
    if (r.year != null) byYear.set(r.year, (byYear.get(r.year) || 0) + r.amount);
  }
  const gifts = rows.length;
  const avg = total / gifts;
  const town = rows[0].town, office = rows[0].office;

  const topDonors = donorAggregates(rows)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const dmax = Math.max(...topDonors.map((d) => d.total), 1);
  const donorRows = topDonors.map((d, n) => {
    const pct = Math.max((d.total / dmax) * 100, 4);
    return `
    <li class="cd-donor">
      <span class="cd-donor__rank">${n + 1}</span>
      <span class="cd-donor__name">${esc(d.name)}</span>
      <span class="cd-donor__track"><span class="cd-donor__fill" style="width:${pct}%"></span></span>
      <span class="cd-donor__amt num">${fmt(d.total)}</span>
    </li>`;
  }).join("");

  // Small per-year trend (sparkline-style bars).
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const ymax = Math.max(...years.map((y) => byYear.get(y)), 1);
  const trend = years.length > 1 ? `
    <p class="cand-card__lead">Raised by year</p>
    <ul class="cd-trend">
      ${years.map((y) => {
        const h = Math.max((byYear.get(y) / ymax) * 100, 4);
        return `<li class="cd-trend__bar" title="${y}: ${fmt(byYear.get(y))}">
                  <span class="cd-trend__fill" style="height:${h}%"></span>
                  <span class="cd-trend__yr">${esc(String(y))}</span>
                </li>`;
      }).join("")}
    </ul>` : "";

  detail.innerHTML = `
    <article class="cand-card">
      <header class="cand-card__head">
        <div>
          <h3 class="cand-card__name">${esc(state.politician)}</h3>
          <p class="cand-card__meta">${esc(town)} · ${esc(office)}</p>
        </div>
        <div class="cand-card__total">
          <span class="num">${fmt(total)}</span>
          <span class="cand-card__total-label">raised</span>
        </div>
      </header>
      <ul class="cand-card__stats">
        <li><span class="num">${donorKeys.size.toLocaleString()}</span><span>donors</span></li>
        <li><span class="num">${gifts.toLocaleString()}</span><span>gifts</span></li>
        <li><span class="num">${fmt(avg)}</span><span>avg gift</span></li>
      </ul>
      <p class="cand-card__lead">Largest backers</p>
      <ol class="cd-donors">${donorRows}</ol>
      ${trend}
    </article>`;
}

// Donor view: which candidates a searched donor funds. Scoped to Town+Office
// (but not Politician — when a politician is picked we show the candidate card
// instead). The donor search is a substring, so it may match several donors;
// when it resolves to exactly one we title the card with that donor's name.
function renderDonorCard(detail, q) {
  const scope = globalRows();  // town/office/donor filtered (no politician in this branch)
  if (!scope.length) {
    detail.innerHTML = `<p class="cand-empty">No donors match “${esc(q)}” in this view.</p>`;
    return;
  }

  let total = 0;
  const donorKeys = new Set();
  const byCand = new Map();   // recipient -> {town, office, total, gifts}
  for (const r of scope) {
    total += r.amount;
    donorKeys.add(r.donorKey);
    let c = byCand.get(r.recipient);
    if (!c) { c = { town: r.town, office: r.office, total: 0, gifts: 0 }; byCand.set(r.recipient, c); }
    c.total += r.amount;
    c.gifts += 1;
  }
  const gifts = scope.length;
  const avg = total / gifts;
  const cands = [...byCand.entries()].sort((a, b) => b[1].total - a[1].total);

  // One matched donor → its real name + city; several → summarize the search.
  const single = donorKeys.size === 1;
  const name = single ? scope[0].donor : `Donors matching “${q}”`;
  const meta = single
    ? (scope[0].city || "Donor")
    : `${donorKeys.size.toLocaleString()} donors · ${cands.length} candidate${cands.length === 1 ? "" : "s"}`;

  const cmax = Math.max(...cands.map(([, c]) => c.total), 1);
  const candRows = cands.map(([cn, c], n) => {
    const pct = Math.max((c.total / cmax) * 100, 4);
    return `
    <li class="cd-donor">
      <span class="cd-donor__rank">${n + 1}</span>
      <span class="cd-donor__name">${esc(cn)}</span>
      <span class="cd-donor__track"><span class="cd-donor__fill" style="width:${pct}%"></span></span>
      <span class="cd-donor__amt num">${fmt(c.total)}</span>
    </li>`;
  }).join("");

  detail.innerHTML = `
    <article class="cand-card">
      <header class="cand-card__head">
        <div>
          <h3 class="cand-card__name">${esc(name)}</h3>
          <p class="cand-card__meta">${esc(meta)}</p>
        </div>
        <div class="cand-card__total">
          <span class="num">${fmt(total)}</span>
          <span class="cand-card__total-label">given</span>
        </div>
      </header>
      <ul class="cand-card__stats">
        <li><span class="num">${cands.length.toLocaleString()}</span><span>candidates</span></li>
        <li><span class="num">${gifts.toLocaleString()}</span><span>gifts</span></li>
        <li><span class="num">${fmt(avg)}</span><span>avg gift</span></li>
      </ul>
      <p class="cand-card__lead">Candidates funded</p>
      <ol class="cd-donors">${candRows}</ol>
    </article>`;
}

// ---------------------------------------------------------------------------
// RENDER — recompute every view from the current filter state.
// ---------------------------------------------------------------------------
function render() {
  const rows = globalRows();
  renderHeadline(rows);
  renderTimeline(rows);
  renderDonors(rows);
  renderCandidate();
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
