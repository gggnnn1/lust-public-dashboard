/* 트라이123 공개 페이지. api/snapshot 하나만 읽는다. 모든 문자열은 textContent로만 넣는다. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  // 색은 전략을 따라간다. 다크 surface에서 검증 통과한 팔레트의 2·3·4번(인접 쌍 모두 통과).
  const HUE = {bts: "#d95926", msv4: "#199e70", lt4: "#c98500"};
  const FALLBACK = ["#d95926", "#199e70", "#c98500", "#3987e5"];
  const PERIODS = [["day", "오늘"], ["month", "이번 달"], ["cumulative", "설정 이후"]];
  const STATUS = {ok: "정상", partial: "일부 확인", stale: "갱신 지연", error: "오류", unknown: "상태 미확인"};
  const state = {data: null, hidden: false, mode: "total"};

  // ---------- helpers ----------
  const finite = value => typeof value === "number" && Number.isFinite(value);
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }
  function money(value, signed) {
    if (!finite(value)) return "—";
    if (state.hidden) return "••••";
    const body = Math.round(Math.abs(value)).toLocaleString("ko-KR") + "원";
    if (!signed) return (value < 0 ? "−" : "") + body;
    return (value > 0 ? "+" : value < 0 ? "−" : "") + body;
  }
  function pct(value, digits) {
    if (!finite(value)) return "—";
    return (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value).toFixed(digits === undefined ? 2 : digits) + "%";
  }
  function shortWon(value) {
    if (state.hidden) return "••••";
    if (!value) return "0";
    if (value >= 1e8) return (value / 1e8).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "억";
    return Math.round(value / 1e4).toLocaleString("ko-KR") + "만";
  }
  const tone = value => (finite(value) && value > 0 ? "up" : finite(value) && value < 0 ? "down" : "");
  const hueOf = (id, index) => HUE[id] || FALLBACK[index % FALLBACK.length];
  const valueOf = account => (finite(account.valuation_krw) ? account.valuation_krw : account.known_value_krw);
  function metric(account, period) {
    const key = `${period}_pnl_krw`;
    const partial = !finite(account[key]);
    return {amount: partial ? account[`known_${key}`] : account[key],
            rate: account[`${partial ? "known_" : ""}${period}_return_pct`], partial};
  }
  function kst(stamp) {
    const date = new Date(stamp);
    if (!stamp || Number.isNaN(date.getTime())) return null;
    const parts = {};
    new Intl.DateTimeFormat("ko-KR", {timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false}).formatToParts(date)
      .forEach(part => { parts[part.type] = part.value; });
    if (parts.hour === "24") parts.hour = "00";
    return parts;
  }
  const when = stamp => { const p = kst(stamp); return p ? `${p.month}.${p.day} ${p.hour}:${p.minute}` : ""; };
  function quoteLine(account) {
    const pieces = [];
    if (account.quote_time_first) {
      const first = when(account.quote_time_first), last = when(account.quote_time_last || account.quote_time_first);
      pieces.push(`시세 ${first}${first === last ? "" : ` ~ ${last}`}`);
    }
    if (Array.isArray(account.quote_flags)) pieces.push(...account.quote_flags);
    return pieces.join(" · ");
  }
  function sectionHead(id, title, sub) {
    const head = el("header", "section-head");
    const h2 = el("h2", "", title); h2.id = id;
    head.append(h2);
    if (sub) head.append(el("p", "section-sub", sub));
    return head;
  }
  function tooltipIn(host) {
    let tip = host.querySelector(".tip");
    if (!tip) { tip = el("div", "tip"); tip.hidden = true; tip.setAttribute("role", "status"); host.append(tip); }
    return tip;
  }

  // ---------- hero ----------
  function renderHero(data) {
    const host = $("hero");
    const summary = data.summary;
    host.replaceChildren();
    if (!summary) { host.append(el("p", "empty", "합산 자료를 계산할 수 없습니다.")); return; }
    const cumulative = summary.periods.cumulative;

    const top = el("div", "hero-top");
    const lead = el("div", "hero-lead");
    // 캡처 한 장만 돌아다녀도 언제 기준인지 알 수 있게 카드 안에 시각을 남긴다.
    const eyebrow = el("p", "eyebrow", "누적 수익률 · 설정 이후");
    const asOf = kst(data.generated_at);
    if (asOf) eyebrow.append(el("span", "as-of", `${asOf.year}.${asOf.month}.${asOf.day} ${asOf.hour}:${asOf.minute} 기준`));
    lead.append(eyebrow);
    const big = el("p", `hero-rate ${tone(cumulative.rate)}`);
    // 부호와 숫자는 한 칸 띄운다: "− 4.09%"
    const text = pct(cumulative.rate);
    const sign = /^[+−]/.test(text) ? text[0] : "";
    if (sign) big.append(el("span", "sign", sign));
    big.append(el("strong", "", text.slice(sign.length).replace("%", "")), el("span", "unit", "%"));
    big.setAttribute("aria-label", `누적 수익률 ${text}`);
    lead.append(big);
    const facts = el("dl", "hero-facts");
    for (const [label, value, toneName] of [["평가액", money(summary.value)], ["원금", money(summary.principal)],
                                           ["누적 손익", money(summary.profit, true), tone(summary.profit)]]) {
      const item = el("div", "");
      item.append(el("dt", "", label), el("dd", toneName || "", value));
      facts.append(item);
    }
    lead.append(facts);

    const kpis = el("div", "kpis");
    for (const [period, label] of PERIODS.slice(0, 2)) {
      const p = summary.periods[period];
      const box = el("div", "kpi");
      box.append(el("span", "kpi-label", label), el("strong", `kpi-rate ${tone(p.rate)}`, pct(p.rate)),
                 el("span", `kpi-amount ${tone(p.amount)}`, money(p.amount, true)));
      kpis.append(box);
    }
    top.append(lead, kpis);

    const chartHead = el("div", "chart-head");
    chartHead.append(el("h3", "", "누적 수익률 추이"));
    const modes = el("div", "segmented");
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "추이 보기 방식");
    for (const [mode, label] of [["total", "합산"], ["each", "전략별"]]) {
      const button = el("button", "", label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(state.mode === mode));
      button.addEventListener("click", () => { state.mode = mode; render(); });
      modes.append(button);
    }
    chartHead.append(modes);
    const curveHost = el("div", "curve-host");

    // 전략 요약 띠 — 캡처 한 장에 전략별 결과까지 담기도록.
    const total = data.accounts.map(valueOf).filter(finite).reduce((a, b) => a + b, 0);
    const strip = el("div", "strip");
    data.accounts.forEach((account, index) => {
      const item = el("div", "strip-item");
      const name = el("span", "strip-name");
      const dot = el("i", "dot"); dot.style.background = hueOf(account.id, index);
      name.append(dot, document.createTextNode(account.name));
      const m = metric(account, "cumulative"), day = metric(account, "day");
      const share = total > 0 && finite(valueOf(account)) ? (valueOf(account) / total * 100).toFixed(0) + "%" : "—";
      const sub = el("span", "strip-sub");
      const today = el("span", "");
      today.append(document.createTextNode("오늘 "), el("b", tone(day.rate), pct(day.rate)));
      sub.append(today, el("span", "strip-share", `비중 ${share}`));
      item.append(name, el("strong", `strip-rate ${tone(m.rate)}`, pct(m.rate)), sub);
      strip.append(item);
    });
    host.append(top, chartHead, curveHost, strip);

    // 곡선 높이는 남는 화면에 맞춘다: 상단 요약 전체가 스크롤 없이 한 화면(캡처 한 장)에 들어오게.
    requestAnimationFrame(() => {
      const fixed = host.offsetHeight - curveHost.offsetHeight;
      const top0 = host.getBoundingClientRect().top + window.scrollY;
      const room = window.innerHeight - top0 - fixed - 14;
      curve(curveHost, data, Math.max(130, Math.min(460, Math.floor(room))));
    });
  }

  // ---------- curve ----------
  function niceStep(span, target) {
    const raw = span / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
    return 10 * pow;
  }
  function curve(host, data, height) {
    host.replaceChildren();
    const source = data.curve;
    const points = source && Array.isArray(source.points) ? source.points : [];
    if (points.length < 2) { host.append(el("p", "empty", "추이 기록이 아직 부족합니다.")); return; }
    const names = {};
    data.accounts.forEach(account => { names[account.id] = account.name; });
    const each = state.mode === "each";
    const keys = each ? source.ids : ["total"];

    const W = Math.max(300, Math.floor(host.clientWidth || 900)), H = height || (W < 520 ? 200 : 300);
    const PAD = {top: 18, right: each ? 86 : 64, bottom: 28, left: 46};
    const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
    const times = points.map(p => Date.parse(p.t));
    const t0 = times[0], t1 = times[times.length - 1];
    let lo = 0, hi = 0;
    for (const p of points) for (const key of keys) { lo = Math.min(lo, p[key]); hi = Math.max(hi, p[key]); }
    const pad = (hi - lo || 1) * 0.12; lo -= pad; hi += pad;
    const x = t => PAD.left + ((t - t0) / (t1 - t0 || 1)) * plotW;
    const y = v => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

    const svg = svgEl("svg", {width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "curve", role: "img",
      "aria-label": `누적 수익률 추이. ${when(points[0].t)}부터 ${when(points[points.length - 1].t)}까지, 현재 ${pct(points[points.length - 1].total)}`});

    const step = niceStep(hi - lo, 4);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const gy = Math.round(y(v)) + .5, zero = Math.abs(v) < 1e-9;
      svg.append(svgEl("line", {x1: PAD.left, y1: gy, x2: W - PAD.right, y2: gy, class: zero ? "zero" : "grid"}));
      const label = svgEl("text", {x: PAD.left - 8, y: gy + 4, class: "tick", "text-anchor": "end"});
      label.textContent = zero ? "0%" : pct(v, Number.isInteger(step) ? 0 : 1).replace("+", "");
      svg.append(label);
    }
    // 날짜 눈금: KST 자정
    const days = [];
    for (const p of points) { const d = kst(p.t); const key = `${d.month}.${d.day}`; if (!days.length || days[days.length - 1].key !== key) days.push({key, t: Date.parse(p.t)}); }
    const every = Math.ceil(days.length / Math.max(2, Math.floor(plotW / 70)));
    days.forEach((day, index) => {
      if (index % every) return;
      const label = svgEl("text", {x: Math.max(PAD.left, x(day.t)), y: H - 8, class: "tick", "text-anchor": index ? "middle" : "start"});
      label.textContent = day.key;
      svg.append(label);
    });

    const path = key => points.map((p, i) => `${i ? "L" : "M"}${x(times[i]).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
    if (!each) {
      // 원금선 위는 수익, 아래는 손실로 면을 나눠 칠한다.
      const zeroY = y(0), area = `${path("total")}L${x(t1).toFixed(1)},${zeroY}L${x(t0).toFixed(1)},${zeroY}Z`;
      const defs = svgEl("defs", {});
      const clipUp = svgEl("clipPath", {id: "clip-up"}); clipUp.append(svgEl("rect", {x: 0, y: 0, width: W, height: Math.max(0, zeroY)}));
      const clipDown = svgEl("clipPath", {id: "clip-down"}); clipDown.append(svgEl("rect", {x: 0, y: zeroY, width: W, height: Math.max(0, H - zeroY)}));
      // 면은 선 가까이에서만 진하고 원금선 쪽으로 옅어진다(넓은 면이 화면을 짓누르지 않게).
      const gradient = (id, color, from, to) => {
        const g = svgEl("linearGradient", {id, gradientUnits: "userSpaceOnUse", x1: 0, x2: 0, y1: from, y2: to});
        g.append(svgEl("stop", {offset: "0", "stop-color": color, "stop-opacity": .02}),
                 svgEl("stop", {offset: "1", "stop-color": color, "stop-opacity": .26}));
        return g;
      };
      defs.append(clipUp, clipDown, gradient("fill-up", "#6ad9d0", zeroY, PAD.top),
                  gradient("fill-down", "#f07f78", zeroY, PAD.top + plotH));
      svg.append(defs, svgEl("path", {d: area, class: "area up-fill", "clip-path": "url(#clip-up)"}),
                 svgEl("path", {d: area, class: "area down-fill", "clip-path": "url(#clip-down)"}));
    }
    const last = points[points.length - 1];
    const ends = keys.map((key, index) => ({key, index, value: last[key], ly: y(last[key])})).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 15) ends[i].ly = ends[i - 1].ly + 15;
    keys.forEach((key, index) => {
      const color = each ? hueOf(key, index) : "var(--ink)";
      svg.append(svgEl("path", {d: path(key), class: "line", style: `stroke:${color}`}));
      svg.append(svgEl("circle", {cx: x(t1), cy: y(last[key]), r: 4, class: "end-dot", style: `fill:${color}`}));
    });
    for (const end of ends) {
      const label = svgEl("text", {x: x(t1) + 10, y: end.ly + 4, class: "end-label"});
      label.textContent = each ? `${(names[end.key] || end.key).split(" ")[0].split("-")[0]} ${pct(end.value, 1)}` : pct(end.value);
      svg.append(label);
    }

    // 십자선 + 툴팁
    const cross = svgEl("line", {y1: PAD.top, y2: PAD.top + plotH, class: "cross", visibility: "hidden"});
    const dots = keys.map((key, index) => svgEl("circle", {r: 4.5, class: "hover-dot", visibility: "hidden",
      style: `fill:${each ? hueOf(key, index) : "var(--ink)"}`}));
    svg.append(cross, ...dots);
    const overlay = svgEl("rect", {x: PAD.left, y: PAD.top, width: plotW, height: plotH, fill: "transparent", class: "overlay"});
    svg.append(overlay);
    host.append(svg);
    const tip = tooltipIn(host);
    const move = event => {
      const box = svg.getBoundingClientRect();
      const px = (event.clientX - box.left) * (W / box.width);
      const target = t0 + ((px - PAD.left) / plotW) * (t1 - t0);
      let nearest = 0;
      for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - target) < Math.abs(times[nearest] - target)) nearest = i;
      const p = points[nearest], cx = x(times[nearest]);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      keys.forEach((key, index) => { dots[index].setAttribute("cx", cx); dots[index].setAttribute("cy", y(p[key])); dots[index].setAttribute("visibility", "visible"); });
      const lines = [`${when(p.t)} KST`, `합산 ${pct(p.total)}`].concat(source.ids.map(id => `${names[id] || id}  ${pct(p[id])}`));
      tip.textContent = lines.join("\n"); tip.hidden = false;
      const left = cx / W * box.width;
      tip.style.left = Math.max(4, Math.min(box.width - 190, left > box.width / 2 ? left - 196 : left + 14)) + "px";
      tip.style.top = "8px";
    };
    const leave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dots.forEach(d => d.setAttribute("visibility", "hidden")); };
    overlay.addEventListener("pointermove", move);
    overlay.addEventListener("pointerdown", move);
    overlay.addEventListener("pointerleave", leave);
  }

  // ---------- strategies ----------
  function sparkline(points, key, color) {
    const W = 104, H = 30, values = points.map(p => p[key]);
    const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
    const px = i => 2 + (i / (values.length - 1)) * (W - 8), py = v => 3 + (1 - (v - lo) / span) * (H - 6);
    const svg = svgEl("svg", {width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "spark", "aria-hidden": "true"});
    svg.append(svgEl("path", {d: values.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(""),
      class: "spark-line", style: `stroke:${color}`}));
    svg.append(svgEl("circle", {cx: px(values.length - 1), cy: py(values[values.length - 1]), r: 2.6, style: `fill:${color}`}));
    return svg;
  }
  function figure(label, rate, amount) {
    const cell = el("div", "cell");
    cell.append(el("span", "cell-label", label), el("strong", `cell-rate ${tone(rate)}`, pct(rate)),
                el("span", "cell-amount", money(amount, true)));
    return cell;
  }
  function detailBody(account) {
    const body = el("div", "detail-body");
    const notes = el("dl", "notes");
    const add = (label, text) => { if (text) notes.append(el("dt", "", label), el("dd", "", text)); };
    add("평가", account.valuation_note);
    add("오늘", account.day_note);
    add("이번 달", account.month_note);
    add("설정 이후", [account.basis_label, metric(account, "cumulative").partial ? account.cumulative_note : ""].filter(Boolean).join(" · "));
    if (notes.children.length) body.append(notes);
    for (const warning of account.warnings || []) body.append(el("p", "micro", warning));
    body.append(el("p", "micro", "종목별 보유내역은 공개하지 않습니다."));
    return body;
  }
  function renderStrategies(data, open) {
    const host = $("strategies");
    const accounts = data.accounts;
    const total = accounts.map(valueOf).filter(finite).reduce((a, b) => a + b, 0);
    host.replaceChildren(sectionHead("strategies-title", "전략별 상세", `${accounts.length}개 전략 · 원화 환산`));
    const table = el("div", "panel stable");
    const head = el("div", "srow shead");
    for (const text of ["전략", "비중", "평가액", "오늘", "이번 달", "설정 이후", "추이"]) head.append(el("span", "", text));
    table.append(head);
    const curvePoints = data.curve && Array.isArray(data.curve.points) ? data.curve.points : [];
    accounts.forEach((account, index) => {
      const color = hueOf(account.id, index);
      const wrap = el("article", "account sitem");
      wrap.dataset.key = account.id;
      const row = el("div", "srow");
      const name = el("div", "cell cell-name");
      const title = el("strong", "sname");
      const dot = el("i", "dot"); dot.style.background = color;
      title.append(dot, document.createTextNode(account.name));
      name.append(title);
      const quote = quoteLine(account);
      if (quote) name.append(el("span", "micro", quote));
      const share = el("div", "cell cell-share");
      const ratio = total > 0 && finite(valueOf(account)) ? valueOf(account) / total * 100 : null;
      const meter = el("span", "meter"); const fill = el("i"); fill.style.width = (ratio || 0) + "%"; fill.style.background = color; meter.append(fill);
      share.append(el("span", "cell-label", "비중"), el("strong", "cell-plain", finite(ratio) ? ratio.toFixed(0) + "%" : "—"), meter);
      const value = el("div", "cell");
      value.append(el("span", "cell-label", "평가액"), el("strong", "cell-plain", money(valueOf(account))));
      row.append(name, share, value);
      for (const [period, label] of PERIODS) { const m = metric(account, period); row.append(figure(label, m.rate, m.amount)); }
      const spark = el("div", "cell cell-spark");
      if (curvePoints.length > 1 && finite(curvePoints[0][account.id])) spark.append(sparkline(curvePoints, account.id, color));
      row.append(spark);
      const details = el("details", "account-details");
      details.dataset.key = account.id;
      details.open = open.has(account.id);
      details.append(el("summary", "", "계산 기준"), detailBody(account));
      wrap.append(row, details);
      table.append(wrap);
    });
    host.append(table);
  }

  // ---------- monthly ----------
  function niceMax(raw) {
    if (!(raw > 0)) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const step of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) if (step * pow >= raw) return step * pow;
    return 10 * pow;
  }
  function bars(host, months) {
    host.replaceChildren();
    const W = Math.max(280, Math.floor(host.clientWidth || 480)), H = 260;
    const PAD = {top: 28, right: 8, bottom: 30, left: 54};
    const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
    const ids = [];
    for (const month of months) for (const a of month.accounts) if (!ids.includes(a.id)) ids.push(a.id);
    let peak = 0;
    for (const month of months) peak = Math.max(peak, month.accounts.reduce((s, a) => s + (a.value || 0) + Math.max(0, -(a.profit || 0)), 0));
    const yMax = niceMax(peak), y = v => PAD.top + plotH - (v / yMax) * plotH;
    const svg = svgEl("svg", {width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "bars", role: "img",
      "aria-label": `월말 평가액 누적 막대, ${months.length}개월`});
    const defs = svgEl("defs", {});
    ids.forEach((id, index) => {
      const pattern = svgEl("pattern", {id: `hatch-${index}`, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)"});
      pattern.append(svgEl("rect", {width: 6, height: 6, fill: hueOf(id, index), "fill-opacity": .12}),
                     svgEl("line", {x1: 0, y1: 0, x2: 0, y2: 6, stroke: hueOf(id, index), "stroke-width": 2, "stroke-opacity": .8}));
      defs.append(pattern);
    });
    svg.append(defs);
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i, gy = Math.round(y(v)) + .5;
      svg.append(svgEl("line", {x1: PAD.left, y1: gy, x2: W - PAD.right, y2: gy, class: i ? "grid" : "zero"}));
      const label = svgEl("text", {x: PAD.left - 8, y: gy + 4, class: "tick", "text-anchor": "end"});
      label.textContent = shortWon(v); svg.append(label);
    }
    const slot = Math.min(96, plotW / months.length), barW = Math.max(4, Math.min(52, slot * 0.6));
    host.append(svg);
    const tip = tooltipIn(host);
    months.forEach((month, mi) => {
      const x = PAD.left + slot * mi + (slot - barW) / 2;
      const total = month.accounts.reduce((s, a) => s + (a.value || 0), 0);
      let cursor = 0;
      const piece = (account, from, to, attrs) => {
        const top = y(to) + 1, bottom = y(from) - 1;
        const group = svgEl("g", {class: "piece", tabindex: "0"});
        group.append(svgEl("rect", Object.assign({x, y: Math.min(top, bottom - 2), width: barW, height: Math.max(2, bottom - top), rx: 2}, attrs)));
        const lines = () => [`${month.month} · ${account.name}`, `평가액 ${money(account.value)}`, `원금 ${money(account.principal)}`,
          `${account.profit < 0 ? "손실" : "수익"} ${money(account.profit, true)}`, `합계 ${money(total)}`];
        group.setAttribute("aria-label", lines().join(", "));
        const show = event => {
          tip.textContent = lines().join("\n"); tip.hidden = false;
          const box = host.getBoundingClientRect();
          const px = (event.clientX ?? box.left + x) - box.left, py = (event.clientY ?? box.top + 60) - box.top;
          tip.style.left = Math.max(4, Math.min(box.width - 190, px + 14)) + "px"; tip.style.top = Math.max(4, py - 40) + "px";
        };
        const hide = () => { tip.hidden = true; };
        group.addEventListener("mouseenter", show); group.addEventListener("mousemove", show); group.addEventListener("focus", show);
        group.addEventListener("mouseleave", hide); group.addEventListener("blur", hide);
        svg.append(group);
      };
      for (const a of month.accounts) {
        const hue = hueOf(a.id, ids.indexOf(a.id)), value = a.value || 0, profit = a.profit || 0;
        if (profit > 0) { piece(a, cursor, cursor + value - profit, {fill: hue, "fill-opacity": .38}); piece(a, cursor + value - profit, cursor + value, {fill: hue}); }
        else piece(a, cursor, cursor + value, {fill: hue, "fill-opacity": .38});
        cursor += value;
      }
      for (const a of month.accounts) {
        const loss = Math.max(0, -(a.profit || 0));
        if (!loss) continue;
        const index = ids.indexOf(a.id);
        piece(a, cursor, cursor + loss, {fill: `url(#hatch-${index})`, stroke: hueOf(a.id, index), "stroke-width": 1, "stroke-dasharray": "3 3", "stroke-opacity": .75});
        cursor += loss;
      }
      if (slot >= 50) { const label = svgEl("text", {x: x + barW / 2, y: y(cursor) - 7, class: "bar-total", "text-anchor": "middle"}); label.textContent = shortWon(total); svg.append(label); }
      const [yy, mm] = month.month.split("-");
      const axis = svgEl("text", {x: x + barW / 2, y: H - 9, class: "tick tick-strong", "text-anchor": "middle"});
      axis.textContent = `${yy.slice(2)}.${mm}`; svg.append(axis);
    });
  }
  function renderMonthly(data) {
    const host = $("monthly");
    const months = (Array.isArray(data.months) ? data.months : []).filter(month => month.accounts.length);
    host.replaceChildren(sectionHead("monthly-title", "월별 기록", "월말 기준 · 달이 지날수록 오른쪽으로 쌓입니다"));
    if (!months.length) { host.append(el("p", "empty", "월별 기록이 아직 없습니다.")); return; }
    const grid = el("div", "monthly-grid");

    const chartPanel = el("div", "panel");
    chartPanel.append(el("h3", "panel-title", "평가액 · 전략 누적"));
    const barHost = el("div", "bar-host");
    const legend = el("div", "legend");
    data.accounts.forEach((account, index) => {
      const item = el("span", "legend-item"); const sw = el("i", "swatch"); sw.style.background = hueOf(account.id, index);
      item.append(sw, document.createTextNode(account.name)); legend.append(item);
    });
    for (const [kind, text] of [["soft", "원금"], ["solid", "수익"], ["hatch", "원금 대비 부족분"]]) {
      const item = el("span", "legend-item legend-key"); item.append(el("i", `swatch swatch-${kind}`), document.createTextNode(text)); legend.append(item);
    }
    chartPanel.append(barHost, legend);

    const tablePanel = el("div", "panel");
    tablePanel.append(el("h3", "panel-title", "월말 누적 수익률"));
    const scroller = el("div", "table-scroll");
    const table = el("table", "mtable");
    const headRow = el("tr"); headRow.append(el("th", "", "전략"));
    for (const month of months) { const [yy, mm] = month.month.split("-"); headRow.append(el("th", "", `${yy.slice(2)}.${mm}`)); }
    const thead = el("thead"); thead.append(headRow);
    const tbody = el("tbody");
    const cell = (profit, principal) => {
      const td = el("td");
      const rate = finite(profit) && principal > 0 ? profit / principal * 100 : null;
      td.append(el("strong", tone(rate), pct(rate)), el("span", "", money(profit, true)));
      return td;
    };
    data.accounts.forEach((account, index) => {
      const row = el("tr"); const th = el("th");
      const dot = el("i", "dot"); dot.style.background = hueOf(account.id, index);
      th.append(dot, document.createTextNode(account.name)); row.append(th);
      for (const month of months) { const a = month.accounts.find(item => item.id === account.id); row.append(a ? cell(a.profit, a.principal) : el("td", "", "—")); }
      tbody.append(row);
    });
    const sumRow = el("tr", "sum"); sumRow.append(el("th", "", "합산"));
    for (const month of months) sumRow.append(cell(month.accounts.reduce((s, a) => s + (a.profit || 0), 0), month.accounts.reduce((s, a) => s + (a.principal || 0), 0)));
    tbody.append(sumRow);
    table.append(thead, tbody); scroller.append(table);
    tablePanel.append(scroller, el("p", "micro", "수익률 = 누적 손익 ÷ 원금. 금액은 그 달 말의 누적 손익입니다."));
    grid.append(chartPanel, tablePanel);
    host.append(grid);
    requestAnimationFrame(() => bars(barHost, months));
  }

  // ---------- page ----------
  function render() {
    const data = state.data;
    const toggle = $("hide-toggle");
    toggle.setAttribute("aria-pressed", String(state.hidden));
    toggle.setAttribute("aria-label", state.hidden ? "금액 보이기" : "금액 숨기기");
    toggle.querySelector("span").textContent = state.hidden ? "금액 보이기" : "금액 숨기기";
    if (!data) return;
    const open = new Set(Array.from(document.querySelectorAll("details.account-details[open]")).map(d => d.dataset.key));
    const status = (data.health && data.health.status) || "unknown";
    $("status").textContent = STATUS[status] || STATUS.unknown;
    $("status").className = `badge badge-${status}`;
    $("generated").textContent = data.generated_at ? `갱신 ${when(data.generated_at)} KST` : "";
    renderHero(data); renderStrategies(data, open); renderMonthly(data);
  }
  async function load() {
    try {
      const response = await fetch("api/snapshot", {cache: "no-store"});
      const data = await response.json();
      if (data.schema_version !== 1 || !Array.isArray(data.accounts)) throw new Error("unavailable");
      state.data = data; $("notice").hidden = true; render();
    } catch (error) {
      $("notice").hidden = false;
      $("notice").textContent = "자료를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.";
    }
  }
  $("hide-toggle").addEventListener("click", () => { state.hidden = !state.hidden; render(); });
  let timer = 0;
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(render, 160); });
  load();
})();
