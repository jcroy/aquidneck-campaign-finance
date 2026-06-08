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

function renderHeadline(s) {
  document.getElementById("date-range").textContent = `· ${s.year_min}–${s.year_max}`;
  document.getElementById("headline-stats").innerHTML = `
    <div class="stat"><span class="num">${fmt(s.total_raised)}</span><span class="stat__label">raised</span></div>
    <div class="stat"><span class="num">${s.num_candidates}</span><span class="stat__label">candidates</span></div>
    <div class="stat"><span class="num">${s.num_donors.toLocaleString()}</span><span class="stat__label">donors</span></div>`;
  document.getElementById("town-chips").innerHTML = s.by_town
    .map((t) => `<span class="chip"><span class="chip__town">${esc(t.town)}</span><span class="chip__amt">${fmt(t.total)}</span></span>`)
    .join("");
}

function renderTimeline(timeline) {
  const ctx = document.getElementById("timeline-chart");
  // Vertical accent gradient for the bars.
  const g = ctx.getContext("2d").createLinearGradient(0, 0, 0, 320);
  g.addColorStop(0, ACCENT);
  g.addColorStop(1, "rgba(226,85,60,.55)");

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: timeline.map((d) => d.year),
      datasets: [{
        label: "Raised",
        data: timeline.map((d) => d.amount),
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

function renderDonors(donors) {
  const max = Math.max(...donors.map((d) => d.total), 1);
  document.querySelector("#donors-table tbody").innerHTML = donors.map((d, i) => {
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
      <td class="num">${d.candidates.length}</td>
    </tr>`;
  }).join("");
}

function renderCandidates(cands) {
  const townSel = document.getElementById("town-filter");
  const sel = document.getElementById("candidate-select");
  const detail = document.getElementById("candidate-detail");

  function show(i) {
    const c = cands[i];
    const max = Math.max(...c.top_donors.map((d) => d.total), 1);
    const donorRows = c.top_donors.map((d, n) => {
      const pct = Math.max((d.total / max) * 100, 4);
      return `
      <li class="cd-donor">
        <span class="cd-donor__rank">${n + 1}</span>
        <span class="cd-donor__name">${esc(d.name)}</span>
        <span class="cd-donor__track"><span class="cd-donor__fill" style="width:${pct}%"></span></span>
        <span class="cd-donor__amt num">${fmt(d.total)}</span>
      </li>`;
    }).join("");

    detail.innerHTML = `
      <article class="cand-card">
        <header class="cand-card__head">
          <div>
            <h3 class="cand-card__name">${esc(c.name)}</h3>
            <p class="cand-card__meta">${esc(c.town)} · ${esc(c.office)}</p>
          </div>
          <div class="cand-card__total">
            <span class="num">${fmt(c.total_raised)}</span>
            <span class="cand-card__total-label">raised</span>
          </div>
        </header>
        <ul class="cand-card__stats">
          <li><span class="num">${c.num_donors}</span><span>donors</span></li>
          <li><span class="num">${c.num_contributions}</span><span>gifts</span></li>
          <li><span class="num">${fmt(c.avg_gift)}</span><span>avg gift</span></li>
        </ul>
        <p class="cand-card__lead">Largest backers</p>
        <ol class="cd-donors">${donorRows}</ol>
      </article>`;
  }

  function populate(town) {
    const items = cands.map((c, i) => ({ c, i }))
      .filter((x) => town === "All" || x.c.town === town);
    sel.innerHTML = items
      .map((x) => `<option value="${x.i}">${esc(x.c.name)} — ${esc(x.c.town)} ${esc(x.c.office)}</option>`)
      .join("");
    if (items.length) show(items[0].i);
    else detail.innerHTML = `<p class="empty">No candidates for this town.</p>`;
  }

  townSel.addEventListener("change", (e) => populate(e.target.value));
  sel.addEventListener("change", (e) => show(Number(e.target.value)));
  populate("All");
}

(async function main() {
  try {
    const [summary, timeline, donors, candidates] = await Promise.all([
      load("summary"), load("timeline"), load("donors"), load("candidates"),
    ]);
    renderHeadline(summary);
    renderTimeline(timeline);
    renderDonors(donors);
    renderCandidates(candidates);
    document.body.classList.add("is-ready");
  } catch (e) {
    document.body.insertAdjacentHTML("afterbegin",
      `<p style="color:#e2553c;padding:1rem">Error loading data: ${esc(e.message)}</p>`);
  }
})();
