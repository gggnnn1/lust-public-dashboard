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
  const state = {data: null, hidden: false, mode: "total", loading: false, loadError: false};

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
    const cumulativeRate = finite(cumulative.rate) ? cumulative.rate : cumulative.known_rate;

    const top = el("div", "hero-top");
    const lead = el("div", "hero-lead");
    // 캡처 한 장만 돌아다녀도 언제 기준인지 알 수 있게 카드 안에 시각을 남긴다.
    const eyebrow = el("p", "eyebrow", `누적 수익률 · 설정 이후${cumulative.amount_complete ? "" : ` · 확인분 ${cumulative.included_count}/${cumulative.expected_count}전략`}`);
    const asOf = kst(data.generated_at);
    if (asOf) eyebrow.append(el("span", "as-of", `${asOf.year}.${asOf.month}.${asOf.day} ${asOf.hour}:${asOf.minute} 기준`));
    lead.append(eyebrow);
    const big = el("p", `hero-rate ${tone(cumulativeRate)}`);
    // 부호와 숫자는 한 칸 띄운다: "− 4.09%"
    const text = pct(cumulativeRate);
    const sign = /^[+−]/.test(text) ? text[0] : "";
    if (sign) big.append(el("span", "sign", sign));
    big.append(el("strong", "", text.slice(sign.length).replace("%", "")), el("span", "unit", "%"));
    big.setAttribute("aria-label", `누적 수익률 ${text}`);
    lead.append(big);
    const facts = el("dl", "hero-facts");
    const valueLabel = summary.valuation_complete ? "평가액" : `평가액 · 확인분 ${summary.included_value_count}/${summary.expected_value_count}전략`;
    const shownValue = finite(summary.value) ? summary.value : summary.known_value;
    for (const [label, value, toneName] of [[valueLabel, money(shownValue)], ["누적 비교기준", money(summary.principal)],
                                           [cumulative.amount_complete ? "누적 손익" : "누적 손익 · 확인분", money(finite(summary.profit) ? summary.profit : summary.known_profit, true), tone(summary.known_profit)]]) {
      const item = el("div", "");
      item.append(el("dt", "", label), el("dd", toneName || "", value));
      facts.append(item);
    }
    lead.append(facts);

    const kpis = el("div", "kpis");
    for (const [period, label] of PERIODS.slice(0, 2)) {
      const p = summary.periods[period];
      const amount = finite(p.amount) ? p.amount : p.known_amount;
      const rate = finite(p.rate) ? p.rate : p.known_rate;
      const scope = p.amount_complete ? "" : ` · 확인분 ${p.included_count}/${p.expected_count}전략`;
      const box = el("div", "kpi");
      box.append(el("span", "kpi-label", `${label}${scope}${p.basis_label ? " · " + p.basis_label : ""}`), el("strong", `kpi-rate ${tone(rate)}`, pct(rate)),
                 el("span", `kpi-amount ${tone(amount)}`, money(amount, true)));
      if (period === "month" && finite(amount) && !finite(rate))
        box.append(el("span", "micro", "수익금 확인 · 수익률 보류"));
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
      today.append(document.createTextNode(`오늘${day.partial ? " · 확인분" : ""} `), el("b", tone(day.rate), pct(day.rate)));
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
    // Preserve the original single-panel UI; incomplete observations are gaps, never zero-valued returns.
    const points = source && Array.isArray(source.points) ? source.points.filter(p => ["total", ...(source.ids || [])].every(key => finite(p[key]))) : [];
    if (points.length < 2) { host.append(el("p", "empty", "추이 기록이 아직 부족합니다.")); return; }
    const names = {};
    data.accounts.forEach(account => { names[account.id] = account.name; });
    const each = state.mode === "each";
    const keys = each ? source.ids : ["total"];

    const last = points[points.length - 1];
    const endName = key => key === "lt4" ? (names[key] || key) : (names[key] || key).split(" ")[0].split("-")[0];
    const W = Math.max(220, Math.floor(host.clientWidth || 900)), H = height || (W < 520 ? 200 : 300);
    // Stack strategy name and return, reserving measured text width rather than
    // a fixed 130px blank column that truncates the plotting area on phones.
    const measure = document.createElement("canvas").getContext("2d");
    const family = getComputedStyle(host).fontFamily;
    const textWidth = (text, size, weight) => {
      measure.font = `${weight} ${size}px ${family}`;
      return measure.measureText(text).width;
    };
    const labelWidth = Math.max(...keys.map(key => each
      ? Math.max(textWidth(endName(key), 11, 600), textWidth(pct(last[key], 1), 12, 700))
      : textWidth(pct(last[key]), 12, 700)));
    const PAD = {top: 18, right: Math.max(56, Math.ceil(labelWidth) + 20), bottom: 28, left: 46};
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
    const ends = keys.map((key, index) => ({key, index, value: last[key], ly: y(last[key])})).sort((a, b) => a.ly - b.ly);
    const gap = each ? 30 : 15;
    const minY = PAD.top + (each ? 10 : 0), maxY = H - PAD.bottom - (each ? 12 : 0);
    for (let i = 0; i < ends.length; i++) {
      ends[i].ly = Math.max(minY, Math.min(maxY, ends[i].ly));
      if (i) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + gap);
    }
    if (ends.length) {
      ends[ends.length - 1].ly = Math.min(maxY, ends[ends.length - 1].ly);
      for (let i = ends.length - 2; i >= 0; i--) ends[i].ly = Math.min(ends[i].ly, ends[i + 1].ly - gap);
    }
    keys.forEach((key, index) => {
      const color = each ? hueOf(key, index) : "var(--ink)";
      svg.append(svgEl("path", {d: path(key), class: "line", style: `stroke:${color}`}));
      svg.append(svgEl("circle", {cx: x(t1), cy: y(last[key]), r: 4, class: "end-dot", style: `fill:${color}`}));
    });
    for (const end of ends) {
      const labelX = x(t1) + 10;
      const label = svgEl("text", {x: labelX, y: end.ly + (each ? -3 : 4), class: "end-label"});
      if (each) {
        const name = svgEl("tspan", {x: labelX, class: "end-name"});
        name.textContent = endName(end.key);
        const value = svgEl("tspan", {x: labelX, dy: 14, class: "end-value"});
        value.textContent = pct(end.value, 1);
        label.append(name, value);
      } else {
        label.textContent = pct(end.value);
      }
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
    add("오늘 비교 기준", account.day_basis_label);
    add("이번 달", account.month_note);
    const usdMoney = value => state.hidden ? "••••" : (value > 0 ? "+$" : value < 0 ? "−$" : "$") + Math.abs(value).toFixed(2);
    const usdValue = finite(account.valuation_usd) ? account.valuation_usd : account.known_value_usd;
    if (finite(usdValue)) add("USD 평가 · 환율 제외", usdMoney(usdValue));
    for (const [period, label] of PERIODS) {
      const value = finite(account[`${period}_pnl_usd`]) ? account[`${period}_pnl_usd`] : account[`known_${period}_pnl_usd`];
      if (finite(value)) add(`${label} USD · 환율 제외`, usdMoney(value));
    }
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
      if (account.id === "lt4" && finite(account.strategy_comparison_pnl_krw)) {
        const comparison = el("div", "comparison-result");
        const session = String(account.strategy_comparison_session || "").slice(5).replace("-", "/");
        comparison.append(el("strong", tone(account.strategy_comparison_pnl_krw),
          `${session} 운용 비교손익 ${money(account.strategy_comparison_pnl_krw, true)}`));
        comparison.append(el("span", "micro", account.strategy_comparison_note || "전략 비교·실제 계좌손익 아님·합산 제외"));
        wrap.append(comparison);
      }
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
      for (const [period, label] of PERIODS) {
        const m = metric(account, period), cell = figure(label, m.rate, m.amount);
        if (account[`${period}_basis_label`]) cell.append(el("span", "micro", account[`${period}_basis_label`]));
        if (period === "month" && finite(m.amount) && !finite(m.rate))
          cell.append(el("span", "micro", "수익률 기준잔고 미확인"));
        if (m.partial) cell.append(el("span", "micro", finite(m.amount) ? "확인분 · 일부 항목 제외" : "기준자료 필요"));
        row.append(cell);
      }
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
    for (const month of months) peak = Math.max(peak, month.accounts.reduce((s, a) => s + (a.value || 0), 0));
    const yMax = niceMax(peak), y = v => PAD.top + plotH - (v / yMax) * plotH;
    const svg = svgEl("svg", {width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "bars", role: "img",
      "aria-label": `월별 마지막 관측 평가액 누적 막대, ${months.length}개월`});
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
        const lines = () => [`${month.month} · ${account.name}`, `평가액 ${money(account.value)}`, `누적 비교기준 ${money(account.principal)}`,
          `누적 손익(별도) ${money(account.profit, true)}`, `합계 ${money(total)}`];
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
        const hue = hueOf(a.id, ids.indexOf(a.id)), value = a.value || 0;
        piece(a, cursor, cursor + value, {fill: hue, "fill-opacity": .75});
        cursor += value;
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
    host.replaceChildren(sectionHead("monthly-title", "월별 기록", "월중 최신 관측 / 월별 마지막 관측 · 월말 대사값 아님"));
    for (const month of months) if (month.observed_at) host.append(el("p", "micro", `${month.month} ${month.observation_label || "마지막 관측"} · ${when(month.observed_at)} KST`));
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
    for (const [kind, text] of [["solid", "평가액 · 누적 손익은 별도 표기"]]) {
      const item = el("span", "legend-item legend-key"); item.append(el("i", `swatch swatch-${kind}`), document.createTextNode(text)); legend.append(item);
    }
    chartPanel.append(barHost, legend);

    const tablePanel = el("div", "panel");
    tablePanel.append(el("h3", "panel-title", "월별 관측 누적 수익률"));
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
    tablePanel.append(scroller, el("p", "micro", "수익률 = 누적 손익 ÷ 누적 비교기준. 당월은 월중 최신 관측, 과거는 월별 마지막 관측입니다."));
    grid.append(chartPanel, tablePanel);
    host.append(grid);
    requestAnimationFrame(() => bars(barHost, months));
  }

  // ---------- monthly capital + cumulative valuation PnL ----------
  function capitalMonths(data) {
    const ids = data.accounts.map(account => account.id);
    const months = Array.isArray(data.months) ? data.months : [];
    const monthIndex = key => Number(key.slice(0, 4)) * 12 + Number(key.slice(5)) - 1;
    const current = (data.generated_at || "").slice(0, 7);
    const valid = key => /^\d{4}-(0[1-9]|1[0-2])$/.test(key || "");
    const byMonth = new Map();
    for (const month of months) if (month && valid(month.month) && (!valid(current) || month.month <= current)) {
      // Duplicate months are ambiguous, not a reason to silently choose a row.
      byMonth.set(month.month, byMonth.has(month.month) ? null : month);
    }
    const keys = Array.from(byMonth.keys()).sort();
    if (!keys.length) return [];
    const result = [], first = monthIndex(keys[0]), last = monthIndex(valid(current) ? current : keys[keys.length - 1]);
    for (let index = first; index <= last; index++) {
      const key = `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
      const month = byMonth.get(key) || {accounts: []};
      const rows = Array.isArray(month.accounts) ? month.accounts : [];
      const selected = ids.map(id => rows.filter(row => row && row.id === id));
      const complete = ids.length > 0 && selected.every(matches => matches.length === 1 &&
        finite(matches[0].principal) && matches[0].principal >= 0 && finite(matches[0].value) && matches[0].value >= 0 &&
        matches[0].valuation_complete !== false);
      if (!complete) { result.push({month: key, observed: month.observed_at, complete: false}); continue; }
      const picked = selected.map(matches => matches[0]);
      const principal = picked.reduce((sum, row) => sum + row.principal, 0);
      const value = picked.reduce((sum, row) => sum + row.value, 0);
      if (!finite(principal) || !finite(value)) { result.push({month: key, complete: false}); continue; }
      const stamps = picked.map(row => row.observed_at || month.observed_at);
      const timestamps = stamps.map(stamp => Date.parse(stamp));
      const timed = timestamps.every(finite);
      const oldest = timed ? stamps[timestamps.indexOf(Math.min(...timestamps))] : month.observed_at;
      // Legacy rows keep their original values; missing completeness is not upgraded to true.
      const quality = picked.every(row => row.valuation_complete === true) ? "complete" : "unknown";
      result.push({month: key, observed: oldest, complete: true, quality,
        mixedTimes: timed && new Set(timestamps).size > 1,
        observations: picked.map((row, i) => `${row.name || row.id}: ${when(stamps[i]) || "시각 미확인"}`),
        principal, value, profit: value - principal});
    }
    return result;
  }
  function capitalAmount(value, signed) {
    if (state.hidden) return "••••";
    if (Math.abs(value) < 10000) return money(value, signed);
    const sign = value < 0 ? "−" : signed && value > 0 ? "+" : "";
    return sign + shortWon(Math.abs(value));
  }
  function capitalBars(panel, scroll, months, currentMonth) {
    scroll.replaceChildren();
    const complete = months.filter(month => month.complete);
    if (!complete.length) { scroll.append(el("p", "empty", "원금과 평가액이 모두 확인된 월별 기록이 아직 없습니다.")); return; }
    const W = Math.max(Math.floor(scroll.clientWidth || 320), months.length * 82 + 76), H = 338;
    const PAD = {left: 54, right: 22, top: 44, bottom: 76};
    const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
    const ceiling = niceMax(Math.max(...complete.map(month => Math.max(month.principal, month.value))));
    const y = value => PAD.top + plotH * (1 - value / ceiling);
    const svg = svgEl("svg", {width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "capital-bars",
      role: "img", "aria-label": "월별 원금과 누적 평가손익. 수익은 원금 위에 누적, 손실은 원금 차감 구간"});
    const defs = svgEl("defs", {});
    const lossPattern = svgEl("pattern", {id: "capital-loss-hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)"});
    lossPattern.append(svgEl("rect", {width: 6, height: 6, fill: "var(--down)", "fill-opacity": .12}),
      svgEl("line", {x1: 0, x2: 0, y1: 0, y2: 6, stroke: "var(--down)", "stroke-width": 2}));
    defs.append(lossPattern); svg.append(defs);
    for (let i = 0; i <= 4; i++) {
      const value = ceiling * i / 4, gy = y(value);
      svg.append(svgEl("line", {x1: PAD.left, x2: W - PAD.right, y1: gy, y2: gy, class: i ? "grid" : "zero"}));
      const label = svgEl("text", {x: PAD.left - 8, y: gy + 4, class: "tick", "text-anchor": "end"});
      label.textContent = capitalAmount(value); svg.append(label);
    }
    const slot = plotW / months.length, barW = Math.min(58, slot * .55);
    const tip = tooltipIn(panel);
    months.forEach((month, index) => {
      const center = PAD.left + slot * (index + .5), x = center - barW / 2;
      const axis = svgEl("text", {x: center, y: H - 48, class: "tick tick-strong", "text-anchor": "middle"});
      axis.textContent = month.month.replace("-", "."); svg.append(axis);
      const status = svgEl("text", {x: center, y: H - 30, class: "tick capital-status", "text-anchor": "middle"});
      const observed = kst(month.observed);
      status.textContent = month.month === currentMonth ? "진행 중" : observed ? `${observed.month}.${observed.day} 관측` : "마지막 관측";
      const quality = svgEl("text", {x: center, y: H - 12, class: "tick capital-quality", "text-anchor": "middle"});
      quality.textContent = !month.complete ? "합산 보류" : month.quality !== "complete" ? "범위 미확인" : month.mixedTimes ? "시점 혼합" : "전체 평가액";
      svg.append(status, quality);
      if (!month.complete) {
        const missing = svgEl("text", {x: center, y: PAD.top + plotH / 2, class: "tick", "text-anchor": "middle"});
        missing.textContent = "자료 부족"; svg.append(missing); return;
      }
      const group = svgEl("g", {class: "capital-month piece", tabindex: "0", "data-month": month.month,
        "data-principal": month.principal, "data-value": month.value, "data-profit": month.profit});
      const segment = (kind, from, to, fill) => svgEl("rect", {x, y: y(to), width: barW,
        height: Math.max(0, y(from) - y(to)), class: `capital-segment capital-${kind}`, fill});
      group.append(segment("principal", 0, month.principal, "var(--capital)"));
      if (month.profit > 0) group.append(segment("profit", month.principal, month.value, "var(--up)"));
      if (month.profit < 0) {
        // Hatched deduction from original capital, never an extra positive asset.
        group.append(segment("loss", month.value, month.principal, "url(#capital-loss-hatch)"));
      }
      group.append(svgEl("line", {x1: x - 4, x2: x + barW + 4, y1: y(month.principal), y2: y(month.principal), class: "capital-principal-line"}),
        svgEl("line", {x1: x - 3, x2: x + barW + 3, y1: y(month.value), y2: y(month.value), class: "capital-nav-line"}));
      const top = svgEl("text", {x: center, y: y(Math.max(month.principal, month.value)) - 20, class: "bar-total", "text-anchor": "middle"});
      top.textContent = `평가 ${capitalAmount(month.value)}`;
      const pnl = svgEl("text", {x: center, y: y(Math.max(month.principal, month.value)) - 5, class: `capital-pnl ${tone(month.profit)}`, "text-anchor": "middle"});
      pnl.textContent = capitalAmount(month.profit, true);
      group.append(top, pnl);
      const lines = () => [`${month.month}${month.month === currentMonth ? " · 진행 중" : " · 마지막 관측"}`,
        `누적 원금(비교기준) ${money(month.principal)}`, `누적 평가손익 ${money(month.profit, true)}`,
        `평가액 ${money(month.value)}`, month.observed ? `관측 ${when(month.observed)} KST` : "관측 시각 미확인",
        ...(month.quality !== "complete" ? ["이전 기록의 전체 평가 여부는 미확인"] : []),
        ...(month.mixedTimes ? ["계좌별 관측시각이 다릅니다", ...month.observations] : [])];
      group.setAttribute("aria-label", lines().join(", "));
      const show = event => {
        tip.textContent = lines().join("\n"); tip.hidden = false;
        const rect = panel.getBoundingClientRect(), target = group.getBoundingClientRect();
        const px = event.clientX || (target.left + target.width / 2);
        tip.style.left = Math.max(4, Math.min(rect.width - 220, px - rect.left + 8)) + "px";
        tip.style.top = Math.max(4, target.top - rect.top - 20) + "px";
      };
      const hide = () => { tip.hidden = true; };
      for (const event of ["mouseenter", "mousemove", "focus", "click"]) group.addEventListener(event, show);
      for (const event of ["mouseleave", "blur"]) group.addEventListener(event, hide);
      group.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
      svg.append(group);
    });
    scroll.append(svg);
  }
  function renderCapital(data) {
    const host = $("monthly-capital");
    host.replaceChildren(sectionHead("monthly-capital-title", "월별 원금·누적손익", "트라이123 합산 · 기록이 있는 달부터"));
    const months = capitalMonths(data);
    if (!months.length) { host.append(el("p", "empty", "월별 기록이 아직 없습니다.")); return; }
    const panel = el("div", "panel capital-panel"), scroll = el("div", "capital-scroll");
    scroll.setAttribute("tabindex", "0"); scroll.setAttribute("aria-label", "월별 막대그래프 · 좌우 스크롤 가능");
    const legend = el("div", "legend");
    for (const [kind, label] of [["principal", "원금(비교기준)"], ["profit", "누적 수익"], ["loss", "누적 손실 · 원금 차감"]]) {
      const item = el("span", "legend-item"), swatch = el("i", `swatch capital-key-${kind}`);
      item.append(swatch, document.createTextNode(label)); legend.append(item);
    }
    panel.append(scroll, legend, el("p", "micro", "평가손익 = 평가액 − 원금(비교기준). 비용·잔고 기준 차이로 별도 매매손익과 다를 수 있습니다."),
      el("p", "micro", "수익은 원금 위에 누적하고, 손실은 원금선 아래 차감 구간으로 표시합니다. 당월은 진행 중이며 과거도 월별 마지막 관측값입니다."));
    host.append(panel);
    const currentMonth = (data.generated_at || "").slice(0, 7);
    requestAnimationFrame(() => capitalBars(panel, scroll, months, currentMonth));
  }

  // ---------- page ----------
  function renderFreshness() {
    const data = state.data;
    const health = window.PublicDashboardFreshness(data, Date.now());
    const status = state.loadError ? "error" : health.status;
    $("status").textContent = STATUS[status] || STATUS.unknown;
    $("status").className = `badge badge-${status}`;
    $("generated").textContent = data && data.generated_at ? `갱신 ${when(data.generated_at)} KST` : "";
    const cycle = data && data.account_day;
    $("account-day").textContent = cycle ? `${cycle.label} · ${{pending: "진행 중·미국장 대기", active: "진행 중", closing: "마감 경계·최종 종가 확인 중"}[cycle.phase] || "잠정"}` : "";
    const notice = $("notice");
    notice.hidden = !state.loadError && !health.stale;
    if (state.loadError) notice.textContent = "새 자료 조회에 실패했습니다. 표시 금액은 마지막 자료이며 현재값이 아닐 수 있습니다. 자동으로 재시도합니다.";
    else if (health.stale) notice.textContent = "갱신 지연 또는 수집 오류입니다. 표시 금액은 마지막 자료이며 현재값으로 사용하지 마세요.";
  }
  function render() {
    const data = state.data;
    const toggle = $("hide-toggle");
    toggle.setAttribute("aria-pressed", String(state.hidden));
    toggle.setAttribute("aria-label", state.hidden ? "금액 보이기" : "금액 숨기기");
    toggle.querySelector("span").textContent = state.hidden ? "금액 보이기" : "금액 숨기기";
    if (!data) return;
    const open = new Set(Array.from(document.querySelectorAll("details.account-details[open]")).map(d => d.dataset.key));
    renderFreshness();
    renderHero(data); renderStrategies(data, open); renderMonthly(data); renderCapital(data);
  }
  async function load() {
    if (state.loading) return;
    state.loading = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("api/snapshot", {cache: "no-store", signal: controller.signal});
      if (!response.ok) throw new Error("snapshot HTTP error");
      const data = await response.json();
      if (data.schema_version !== 1 || !Array.isArray(data.accounts)) throw new Error("unavailable");
      state.data = data; state.loadError = false; render();
    } catch (error) {
      state.loadError = true; renderFreshness();
    } finally {
      clearTimeout(timeout);
      state.loading = false;
    }
  }
  $("hide-toggle").addEventListener("click", () => { state.hidden = !state.hidden; render(); });
  let timer = 0;
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(render, 160); });
  setInterval(load, 60000);
  setInterval(renderFreshness, 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { renderFreshness(); load(); }
  });
  load();
})();
