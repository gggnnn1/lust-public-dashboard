/* 트라이123 공개 페이지. Pages와 같은 공개 저장소의 sanitized snapshot만 읽는다. 모든 문자열은 textContent로만 넣는다.
   2026-10-18 라파엘 개정: 휴대폰 페이지 단위 화면(CSS 스냅), 최대 낙폭 표시, 변경 없으면 재렌더 없음,
   차트는 host 크기만 읽어 그리고 ResizeObserver로 다시 그린다(주소창 접힘 같은 높이 변화에 전체 재렌더 없음). */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  // 색은 전략을 따라간다. 다크 surface에서 검증 통과한 팔레트의 2·3·4번(인접 쌍 모두 통과).
  const HUE = {bts: "#d95926", msv4: "#199e70", lt4: "#c98500"};
  const FALLBACK = ["#d95926", "#199e70", "#c98500", "#3987e5"];
  const PERIODS = [["day", "오늘"], ["month", "이번 달"], ["cumulative", "설정 이후"]];
  const STATUS = {ok: "정상", partial: "일부 확인", stale: "갱신 지연", error: "오류", unknown: "상태 미확인"};
  const POLL_MS = 60 * 1000; // Pages 배포 대기 중에도 공개 저장소의 새 자료를 1분 내 재확인.
  const PUBLISH_MINUTE = 12;       // 게시(:10) + Pages 반영 여유
  const state = {data: null, hidden: false, mode: "total", loading: false, loadError: false, source: "pages"};

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
  const dayOf = stamp => { const p = kst(stamp); return p ? `${p.month}.${p.day}` : "—"; };
  const mddOf = (data, key) => (data.curve && data.curve.mdd && data.curve.mdd[key]) || null;
  function quoteLine(account) {
    const pieces = [];
    if (account.quote_time_first) {
      const first = when(account.quote_time_first), last = when(account.quote_time_last || account.quote_time_first);
      pieces.push(`시세 ${first}${first === last ? "" : ` ~ ${last}`}`);
    }
    if (Array.isArray(account.quote_flags)) pieces.push(...account.quote_flags);
    return pieces.join(" · ");
  }
  function sectionHead(id, title, sub, index) {
    const head = el("header", "section-head");
    const h2 = el("h2", "", title); h2.id = id;
    head.append(h2);
    if (sub) head.append(el("p", "section-sub", sub));
    if (index) head.append(el("span", "page-index", index));
    return head;
  }
  function tooltipIn(host) {
    let tip = host.querySelector(".tip");
    if (!tip) { tip = el("div", "tip"); tip.hidden = true; tip.setAttribute("role", "status"); host.append(tip); }
    return tip;
  }
  // 차트는 host의 현재 크기로 그린다. 크기가 바뀔 때만 다시 그린다(같은 크기면 건너뜀).
  const observers = new WeakMap();
  function bindChart(host, draw) {
    let last = "";
    const run = () => {
      if (!host.isConnected || !host.clientWidth) return;
      const key = `${host.clientWidth}x${host.clientHeight}`;
      if (key === last) return;
      last = key;
      draw();
    };
    run();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => requestAnimationFrame(run));
      observer.observe(host);
      observers.set(host, observer);
    }
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
    const eyebrow = el("p", "eyebrow");
    eyebrow.append(el("span", "eyebrow-text", `누적 수익률 · 설정 이후${cumulative.amount_complete ? "" : ` · 확인분 ${cumulative.included_count}/${cumulative.expected_count}전략`}`));
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
      box.append(el("span", "kpi-label", `${label}${scope}`), el("strong", `kpi-rate ${tone(rate)}`, pct(rate)),
                 el("span", `kpi-amount ${tone(amount)}`, money(amount, true)));
      kpis.append(box);
    }
    // 최대 낙폭: 관측 곡선의 고점 대비 최대 하락(원금 = 1 기준선). 백테스트 MDD가 아니라 공개 관측 이후 실측값.
    const mdd = mddOf(data, "total");
    const mddBox = el("div", "kpi kpi-mdd");
    const mddSub = el("span", "kpi-amount", mdd && mdd.t ? `${dayOf(mdd.t)} 저점` : "기록 필요");
    mddSub.append(el("span", "kpi-note", data.curve && data.curve.anchor ? " · 설정 이후" : " · 관측 이후"));   // 휴대폰에서는 CSS로 숨긴다(타일 폭).
    mddBox.append(el("span", "kpi-label", "최대 낙폭"),
                  el("strong", `kpi-rate ${tone(mdd ? mdd.pct : null)}`, pct(mdd ? mdd.pct : null)), mddSub);
    kpis.append(mddBox);
    top.append(lead, kpis);

    const chartHead = el("div", "chart-head");
    const anchorAt = data.curve && data.curve.anchor && data.curve.anchor.t;
    chartHead.append(el("h3", "", anchorAt ? `누적 수익률 추이 · ${dayOf(anchorAt)} 운용 시작` : "누적 수익률 추이"));
    const modes = el("div", "segmented");
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "추이 보기 방식");
    const curveHost = el("div", "curve-host");
    const drawCurve = () => curve(curveHost, data);
    for (const [mode, label] of [["total", "합산"], ["each", "전략별"]]) {
      const button = el("button", "", label);
      button.type = "button";
      button.dataset.mode = mode;
      button.setAttribute("aria-pressed", String(state.mode === mode));
      // 보기 전환은 곡선만 다시 그린다. 페이지 전체를 다시 만들지 않는다.
      button.addEventListener("click", () => {
        if (state.mode === mode) return;
        state.mode = mode;
        modes.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
        drawCurve();
      });
      modes.append(button);
    }
    chartHead.append(modes);

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
    // 곡선 높이 = 첫 페이지에서 남는 높이(CSS flex). 창 높이가 바뀌면 곡선만 다시 그린다.
    bindChart(curveHost, drawCurve);
  }

  // ---------- curve ----------
  function niceStep(span, target) {
    const raw = span / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
    return 10 * pow;
  }
  function curve(host, data) {
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
    // 시작점·재구성·관측 구간을 구분 없이 한 선으로 그린다(마스터 10-18 "별도로 표시할 필요 없어").
    const observed = points;
    const endName = key => key === "lt4" ? (names[key] || key) : (names[key] || key).split(" ")[0].split("-")[0];
    const W = Math.max(220, Math.floor(host.clientWidth || 900));
    const H = Math.max(140, Math.floor(host.clientHeight || (W < 520 ? 200 : 300)));
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

    const pathOf = (list, key) => list.map((p, i) => `${i ? "L" : "M"}${x(Date.parse(p.t)).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
    const path = key => pathOf(observed, key);
    const tObs0 = Date.parse(observed[0].t);
    if (!each) {
      // 원금선 위는 수익, 아래는 손실로 면을 나눠 칠한다(관측 구간만).
      const zeroY = y(0), area = `${path("total")}L${x(t1).toFixed(1)},${zeroY}L${x(tObs0).toFixed(1)},${zeroY}Z`;
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
    // 합산 보기에서는 최대 낙폭 저점을 점으로 표시한다(관측 구간 안에 있을 때만).
    const mdd = !each ? mddOf(data, "total") : null;
    if (mdd && finite(mdd.pct) && mdd.pct < 0 && mdd.t) {
      const index = points.findIndex(p => p.t === mdd.t);
      if (index >= 0) {
        const cx = x(times[index]), cy = y(points[index].total);
        svg.append(svgEl("circle", {cx, cy, r: 3.5, class: "trough-dot", style: "fill:var(--down)"}));
        const anchor = cx > PAD.left + plotW * .7 ? "end" : "start";
        const label = svgEl("text", {x: cx + (anchor === "end" ? -8 : 8), y: Math.min(H - PAD.bottom - 4, cy + 14), class: "trough-label", "text-anchor": anchor});
        label.textContent = `최대 낙폭 ${pct(mdd.pct, 1)}`;
        svg.append(label);
      }
    }
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
      const lines = p.anchor
        ? [`${when(p.t)} KST`, "운용 시작 · 원금 1.5억 · 손익 0"]
        : [`${when(p.t)} KST`, `합산 ${pct(p.total)}`].concat(source.ids.map(id => `${names[id] || id}  ${pct(p[id])}`));
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
  function figure(label, rate, amount, className) {
    const cell = el("div", `cell ${className || ""}`.trim());
    cell.append(el("span", "cell-label", label), el("strong", `cell-rate ${tone(rate)}`, pct(rate)),
                el("span", "cell-amount", money(amount, true)));
    return cell;
  }
  function detailBody(account) {
    const body = el("div", "detail-body");
    const notes = el("dl", "notes");
    const add = (label, text) => { if (text) notes.append(el("dt", "", label), el("dd", "", text)); };
    add("시세", quoteLine(account));
    add("평가", account.valuation_note);
    add("오늘", account.day_note);
    add("오늘 비교 기준", account.day_basis_label);
    add("이번 달", account.month_note);
    add("월간 계산 기준", account.month_basis_label);
    const usdMoney = value => state.hidden ? "••••" : (value > 0 ? "+$" : value < 0 ? "−$" : "$") + Math.abs(value).toFixed(2);
    const usdValue = finite(account.valuation_usd) ? account.valuation_usd : account.known_value_usd;
    if (finite(usdValue)) add("USD 평가 · 환율 제외", usdMoney(usdValue));
    for (const [period, label] of PERIODS) {
      const value = finite(account[`${period}_pnl_usd`]) ? account[`${period}_pnl_usd`] : account[`known_${period}_pnl_usd`];
      if (finite(value)) add(`${label} USD · 환율 제외`, usdMoney(value));
    }
    add("설정 이후", [account.basis_label, metric(account, "cumulative").partial ? account.cumulative_note : ""].filter(Boolean).join(" · "));
    add("최대 낙폭", "누적손익 ÷ 운용원금 곡선의 고점 대비 최대 하락. 2026-08-26~09-16은 기록·종가로 일별 재구성한 값이라 일중 저점은 포함하지 않습니다.");
    if (notes.children.length) body.append(notes);
    for (const warning of account.warnings || []) body.append(el("p", "micro", warning));
    body.append(el("p", "micro", "종목별 보유내역은 공개하지 않습니다."));
    return body;
  }
  function renderStrategies(data, open) {
    const host = $("strategies");
    const accounts = data.accounts;
    const total = accounts.map(valueOf).filter(finite).reduce((a, b) => a + b, 0);
    host.replaceChildren(sectionHead("strategies-title", "전략별 상세", `${accounts.length}개 전략 · 원화 환산`, "2 / 4"));
    const table = el("div", "panel stable");
    const head = el("div", "srow shead");
    for (const text of ["전략", "비중", "평가액", "오늘", "이번 달", "설정 이후", "최대 낙폭", "추이"]) head.append(el("span", "", text));
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
      const value = el("div", "cell cell-value");
      value.append(el("span", "cell-label", "평가액"), el("strong", "cell-plain", money(valueOf(account))));
      row.append(name, share, value);
      for (const [period, label] of PERIODS) {
        const m = metric(account, period), cell = figure(label, m.rate, m.amount, {day: "cell-day", month: "cell-month", cumulative: "cell-cum"}[period]);
        if (m.partial) cell.append(el("span", "micro", finite(m.amount) ? "확인분 · 일부 항목 제외" : "기준자료 필요"));
        row.append(cell);
      }
      // 최대 낙폭(관측 이후). 셀 순서는 이름·비중·평가액·오늘·이번 달·설정 이후 다음에 둔다.
      const mdd = mddOf(data, account.id);
      const mddCell = el("div", "cell cell-mdd");
      mddCell.append(el("span", "cell-label", "최대 낙폭"), el("strong", `cell-plain ${tone(mdd ? mdd.pct : null)}`, pct(mdd ? mdd.pct : null)));
      if (mdd && mdd.t && finite(mdd.pct) && mdd.pct < 0) mddCell.append(el("span", "cell-amount", `${dayOf(mdd.t)} 저점`));
      row.append(mddCell);
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
  function renderMonthly(data) {
    const host = $("monthly");
    const months = (Array.isArray(data.months) ? data.months : []).filter(month => month.accounts.length);
    host.replaceChildren(sectionHead("monthly-title", "월별 기록", "원금·누적손익", "3 / 4"));
    if (!months.length) { host.append(el("p", "empty", "월별 기록이 아직 없습니다.")); return; }
    const grid = el("div", "monthly-grid");

    const chartPanel = capitalPanel(data);

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
      th.append(dot, el("span", "name-full", account.name), el("span", "name-short", {bts: "BTS x1", msv4: "MSv4 x2", lt4: account.name}[account.id] || account.name)); row.append(th);
      for (const month of months) { const a = month.accounts.find(item => item.id === account.id); row.append(a ? cell(a.profit, a.principal) : el("td", "", "—")); }
      tbody.append(row);
    });
    const sumRow = el("tr", "sum"); sumRow.append(el("th", "", "합산"));
    for (const month of months) sumRow.append(cell(month.accounts.reduce((s, a) => s + (a.profit || 0), 0), month.accounts.reduce((s, a) => s + (a.principal || 0), 0)));
    tbody.append(sumRow);
    table.append(thead, tbody); scroller.append(table);
    tablePanel.append(scroller);
    grid.append(chartPanel, tablePanel);
    host.append(grid);
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
    const compact = window.matchMedia("(max-width: 560px)").matches;
    const W = Math.max(Math.floor(scroll.clientWidth || 320), months.length * 82 + 76);
    // Use the chart's flex-allocated height, not a short fixed phone thumbnail.
    const H = compact ? Math.max(176, Math.floor(scroll.clientHeight) - 4) : 300;
    const PAD = {left: 54, right: 22, top: 36, bottom: compact ? 44 : 60};
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
      const axis = svgEl("text", {x: center, y: H - (compact ? 26 : 34), class: "tick tick-strong", "text-anchor": "middle"});
      axis.textContent = month.month.replace("-", "."); svg.append(axis);
      // 막대 아래는 관측일·진행 중만 적는다(마스터 10-18). 평가 범위·관측시각 혼합 여부는 툴팁과 aria-label로만 밝힌다.
      const status = svgEl("text", {x: center, y: H - (compact ? 10 : 14), class: "tick capital-status", "text-anchor": "middle"});
      const observed = kst(month.observed);
      status.textContent = month.month === currentMonth ? "진행 중" : observed ? `${observed.month}.${observed.day} 관측` : "마지막 관측";
      svg.append(status);
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
      // 금액과 함께 원금 대비 비율을 적는다(막대 높이 차이가 작아도 읽히도록).
      pnl.textContent = capitalAmount(month.profit, true) + (month.principal > 0 ? ` · ${pct(month.profit / month.principal * 100, 1)}` : "");
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
  function capitalPanel(data) {
    const months = capitalMonths(data);
    const panel = el("div", "panel capital-panel"), scroll = el("div", "capital-scroll");
    panel.id = "monthly-capital";
    panel.append(el("h3", "panel-title", "원금·누적손익"));
    scroll.setAttribute("tabindex", "0"); scroll.setAttribute("aria-label", "월별 막대그래프 · 좌우 스크롤 가능");
    const legend = el("div", "legend");
    for (const [kind, label] of [["principal", "원금"], ["profit", "누적 이익"], ["loss", "누적 손실"]]) {
      const item = el("span", "legend-item"), swatch = el("i", `swatch capital-key-${kind}`);
      item.append(swatch, document.createTextNode(label)); legend.append(item);
    }
    panel.append(scroll, legend);
    const currentMonth = (data.generated_at || "").slice(0, 7);
    // 패널이 문서에 붙은 뒤(렌더 함수 끝) 크기를 읽어야 하므로 다음 프레임에 연결한다.
    requestAnimationFrame(() => bindChart(scroll, () => capitalBars(panel, scroll, months, currentMonth)));
    return panel;
  }

  // ---------- same-window benchmark reporting (separate from the hero) ----------
  const BENCHMARKS = [["tri", "트라이123", "#d6bb7e"], ["kospi200", "코스피200", "#58a6ff"], ["sp500", "S&P500", "#c59cff"]];
  function benchmarkDate(t) { const p = kst(t); return p ? `${p.month}.${p.day}` : "—"; }
  function benchmarkChart(host, source) {
    host.replaceChildren();
    const points = (Array.isArray(source.points) ? source.points : []).filter(p => Number.isFinite(Date.parse(p.t)));
    if (points.length < 2) { host.append(el("p", "empty", "동일기간 비교 자료를 확인 중입니다.")); return; }
    const W = Math.max(220, Math.floor(host.clientWidth)), H = Math.max(170, Math.floor(host.clientHeight));
    const pad = {left: 44, right: 12, top: 20, bottom: 28};
    const times = points.map(p => Date.parse(p.t)), t0 = times[0], t1 = times[times.length - 1];
    const values = points.flatMap(p => BENCHMARKS.map(([key]) => p[key]).filter(finite));
    if (!values.length) { host.append(el("p", "empty", "비교할 수익률 자료가 없습니다.")); return; }
    let lo = Math.min(0, ...values), hi = Math.max(0, ...values);
    const room = (hi - lo || 1) * .12; lo -= room; hi += room;
    const x = t => pad.left + (t - t0) / (t1 - t0 || 1) * (W - pad.left - pad.right);
    const y = v => pad.top + (hi - v) / (hi - lo) * (H - pad.top - pad.bottom);
    const svg = svgEl("svg", {width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "benchmark-svg",
      role: "img", "aria-label": "공통 관측기간 누적 수익률: 트라이123, 코스피200, S&P500 원화 환산"});
    const step = niceStep(hi - lo, 4);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      svg.append(svgEl("line", {x1: pad.left, x2: W - pad.right, y1: y(v), y2: y(v), class: Math.abs(v) < 1e-9 ? "zero" : "grid"}));
      const label = svgEl("text", {x: pad.left - 7, y: y(v) + 4, class: "tick", "text-anchor": "end"});
      label.textContent = pct(v, step < 1 ? 1 : 0).replace("+", ""); svg.append(label);
    }
    for (const tick of [t0, (t0 + t1) / 2, t1]) {
      const label = svgEl("text", {x: x(tick), y: H - 7, class: "tick benchmark-date", "text-anchor": tick === t0 ? "start" : tick === t1 ? "end" : "middle"});
      label.textContent = benchmarkDate(new Date(tick).toISOString()); svg.append(label);
    }
    for (const [key, name, color] of BENCHMARKS) {
      let active = false, path = "";
      for (let i = 0; i < points.length; i++) {
        if (!finite(points[i][key])) { active = false; continue; }
        path += `${active ? "L" : "M"}${x(times[i]).toFixed(2)},${y(points[i][key]).toFixed(2)}`; active = true;
      }
      const line = svgEl("path", {d: path, class: "line benchmark-line", "data-series": key, style: `stroke:${color}`});
      const title = svgEl("title", {}); title.textContent = name; line.append(title); svg.append(line);
      if (key === "tri") {
        // 포트폴리오 공백(시작점~첫 관측 등)은 값 없이 점선으로만 잇는다.
        let previous = null, gapped = false;
        for (let i = 0; i < points.length; i++) {
          if (!finite(points[i][key])) { gapped = previous !== null; continue; }
          if (gapped && previous !== null) {
            svg.append(svgEl("path", {d: `M${x(times[previous]).toFixed(2)},${y(points[previous][key]).toFixed(2)}L${x(times[i]).toFixed(2)},${y(points[i][key]).toFixed(2)}`,
              class: "gap-line", "data-gap-series": key, style: `stroke:${color}`}));
          }
          previous = i; gapped = false;
        }
      }
    }
    const cross = svgEl("line", {y1: pad.top, y2: H - pad.bottom, class: "cross", visibility: "hidden"});
    svg.append(cross);
    const overlay = svgEl("rect", {x: pad.left, y: pad.top, width: W - pad.left - pad.right, height: H - pad.top - pad.bottom,
      fill: "transparent", class: "benchmark-overlay", tabindex: 0, role: "slider", "aria-label": "벤치마크 관측일 탐색",
      "aria-valuemin": 0, "aria-valuemax": points.length - 1, "aria-valuenow": points.length - 1});
    svg.append(overlay); host.append(svg);
    const tip = tooltipIn(host); let selected = points.length - 1;
    const show = index => {
      selected = Math.max(0, Math.min(points.length - 1, index)); const point = points[selected];
      const text = [`${when(point.t)} KST`, ...BENCHMARKS.map(([key, name]) => `${name} ${pct(point[key])}`)].join("\n");
      tip.textContent = text; tip.hidden = false; tip.style.top = "4px";
      tip.style.left = Math.max(0, Math.min(W - 184, x(times[selected]) > W / 2 ? x(times[selected]) - 188 : x(times[selected]) + 8)) + "px";
      cross.setAttribute("x1", x(times[selected])); cross.setAttribute("x2", x(times[selected])); cross.setAttribute("visibility", "visible");
      overlay.setAttribute("aria-valuenow", selected); overlay.setAttribute("aria-valuetext", text.replaceAll("\n", ", "));
    };
    const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
    const move = event => {
      const box = svg.getBoundingClientRect(), px = (event.clientX - box.left) * W / box.width;
      const target = t0 + (px - pad.left) / (W - pad.left - pad.right) * (t1 - t0);
      let nearest = 0;
      for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - target) < Math.abs(times[nearest] - target)) nearest = i;
      show(nearest);
    };
    for (const type of ["pointermove", "pointerdown", "click"]) overlay.addEventListener(type, move);
    overlay.addEventListener("pointerleave", event => { if (event.pointerType !== "touch") hide(); });
    overlay.addEventListener("focus", () => show(selected)); overlay.addEventListener("blur", hide);
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") { hide(); return; }
      const actions = {ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: points.length - 1};
      if (event.key in actions) { event.preventDefault(); show(actions[event.key]); }
    });
  }
  // The monthly card is account-period performance, not a rebased observation curve.
  // Keep the cumulative chart untouched; monthly excess must use the hero's exact rate.
  function monthlyBenchmark(data) {
    const canonical = data.summary && data.summary.periods && data.summary.periods.month;
    const indices = data.benchmark && data.benchmark.calendar_month;
    const tri = canonical ? (finite(canonical.rate) ? canonical.rate : finite(canonical.known_rate) ? canonical.known_rate : null) : null;
    const kospi200 = indices && finite(indices.kospi200) ? indices.kospi200 : null;
    const sp500 = indices && finite(indices.sp500) ? indices.sp500 : null;
    return {tri, kospi200, sp500,
      excess_kospi200: finite(tri) && finite(kospi200) ? tri - kospi200 : null,
      excess_sp500: finite(tri) && finite(sp500) ? tri - sp500 : null};
  }
  function renderBenchmark(data) {
    const host = $("benchmark"), source = data.benchmark || {};
    const monthly = monthlyBenchmark(data);
    const monthPeriod = data.summary && data.summary.periods && data.summary.periods.month;
    const monthPartial = monthPeriod && (!monthPeriod.amount_complete || (!finite(monthPeriod.rate) && finite(monthPeriod.known_rate)));
    const monthScope = monthPartial ? ` · 확인분 ${monthPeriod.included_count}/${monthPeriod.expected_count}전략` : "";
    host.replaceChildren(sectionHead("benchmark-title", "벤치마크 비교", "원화 · 공통 관측기간", "4 / 4"));
    const panel = el("div", "panel benchmark-panel"), top = el("div", "benchmark-top");
    top.append(el("h3", "panel-title", "누적 수익률 비교"),
               el("span", "benchmark-range", source.start_at || source.end_at ? `${benchmarkDate(source.start_at)}–${benchmarkDate(source.end_at)}` : "기간 확인 중"));
    const legend = el("div", "legend benchmark-legend");
    for (const [, name, color] of BENCHMARKS) {
      const item = el("span", "legend-item"), swatch = el("i", "swatch"); swatch.style.background = color;
      item.append(swatch, document.createTextNode(name)); legend.append(item);
    }
    const chart = el("div", "benchmark-chart");
    const table = el("table", "benchmark-table"), head = el("thead"), header = el("tr");
    for (const title of ["수익률 / 초과수익", `이번 달${monthScope}`, "동일기간 누적"]) header.append(el("th", "", title));
    head.append(header); const body = el("tbody");
    const row = (key, name, relative) => {
      const tr = el("tr", relative ? "benchmark-excess" : ""); tr.dataset.series = key;
      tr.append(el("th", "", name));
      for (const period of ["month", "cumulative"]) {
        const value = period === "month" ? monthly[key] : source.periods && source.periods[period] ? source.periods[period][key] : null;
        const td = el("td", tone(value), relative && finite(value) ? pct(value).replace("%", "%p") : pct(value));
        td.dataset.period = period; if (finite(value)) td.dataset.value = value;
        tr.append(td);
      }
      body.append(tr);
    };
    for (const [key, name] of BENCHMARKS) row(key, name, false);
    row("excess_kospi200", "vs 코스피200", true); row("excess_sp500", "vs S&P500", true);
    table.append(head, body);
    // These labels live within the new comparison, never below monthly records.
    const basis = el("p", "benchmark-basis", "월간: 상단 손익 기준 · 지수 전월말 종가 대비 · 누적: 관측 재기준 · 배당 제외·환율 포함");
    if (source.status === "partial") basis.textContent += " · 관측 공백 포함";
    else if (source.status !== "ok") basis.textContent += " · 벤치마크 시세 확인 중 · 수익률을 임의 보충하지 않습니다";
    if (monthPartial) basis.textContent += ` · 월간 전략 수익률·초과수익은 확인분 ${monthPeriod.included_count}/${monthPeriod.expected_count}전략 기준`;
    // 공급처가 일시적으로 비어 직전 게시분 일봉을 승계한 경우 그 사실을 적는다.
    if (["ok", "partial"].includes(source.status) && Object.values(source.sources || {}).some(s => s && (s.carried_from_previous_publish || s.carried_from_cache))) basis.textContent += " · 일부 시세는 검증된 이전 수집분";
    panel.append(top, legend, chart, table, basis); host.append(panel);
    requestAnimationFrame(() => bindChart(chart, () => benchmarkChart(chart, source)));
  }

  // ---------- page ----------
  function renderFreshness() {
    const data = state.data;
    const health = window.PublicDashboardFreshness(data, Date.now());
    const status = state.loadError ? "error" : health.status;
    $("status").textContent = STATUS[status] || STATUS.unknown;
    $("status").className = `badge badge-${status}`;
    $("generated").textContent = data && data.generated_at ? `갱신 ${when(data.generated_at)} KST · ${state.source === "raw" ? "공개 저장소 최신본 · Pages 지연 보완" : "Pages"}` : "";
    const cycle = data && data.account_day;
    const captured = data && kst(data.generated_at);
    const capturedDate = captured ? `${captured.year}-${captured.month}-${captured.day}` : null;
    const future = cycle && capturedDate && /^\d{4}-\d{2}-\d{2}$/.test(cycle.date || "") && cycle.date > capturedDate;
    $("account-day").textContent = cycle ? `${future ? "다음 손익 집계 · " : "손익 집계 · "}${cycle.label} · ${future ? "시작 전" : {pending: "미국장 대기", active: "진행 중", closing: "마감 경계·최종 종가 확인 중"}[cycle.phase] || "잠정"}` : "";
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
    renderHero(data); renderStrategies(data, open); renderMonthly(data); renderBenchmark(data);
  }
  // Fixed, public-only origin: never send identity headers, cookies or a private snapshot.
  const PUBLIC_RAW = "https://raw.githubusercontent.com/gggnnn1/lust-public-dashboard/main/api/snapshot";
  const RAW_ALLOWED = window.location.origin === "https://gggnnn1.github.io" &&
    window.location.pathname.startsWith("/lust-public-dashboard/");
  function validSnapshot(data) {
    const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
    const stamp = data && data.generated_at;
    if (!object(data) || data.schema_version !== 1 || typeof stamp !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) ||
        !Number.isFinite(Date.parse(stamp)) || Number(stamp.slice(11, 13)) > 23 ||
        new Date(`${stamp.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== stamp.slice(0, 10) ||
        Date.parse(stamp) > Date.now() + 300000 ||
        !Array.isArray(data.accounts) || data.accounts.length !== 3) return false;
    const ids = data.accounts.map(a => a && a.id);
    if (new Set(ids).size !== 3 || !["bts", "msv4", "lt4"].every(id => ids.includes(id))) return false;
    if (!object(data.summary) || !object(data.summary.periods) ||
        !["day", "month", "cumulative"].every(key => object(data.summary.periods[key]))) return false;
    // Null means unavailable, never zero. Reject numeric strings and nonfinite nested values.
    const numeric = /(?:_(?:krw|usd|pct)|^(?:value|known_value|profit|known_profit|principal|amount|known_amount|rate|known_rate|total|bts|msv4|lt4|tri|kospi200|sp500|excess_kospi200|excess_sp500|pct)$)$/;
    function financial(row) {
      return object(row) && Object.entries(row).every(([key, value]) => !numeric.test(key) || value === null || finite(value));
    }
    function safe(value) {
      if (typeof value === "number") return finite(value);
      if (Array.isArray(value)) return value.every(safe);
      if (object(value)) return Object.values(value).every(safe);
      return true;
    }
    const curve = data.curve || {}, benchmark = data.benchmark || {};
    return data.accounts.every(a => financial(a) && (!a.holdings || (Array.isArray(a.holdings) && a.holdings.length === 0))) &&
      financial(data.summary) && Object.values(data.summary.periods).every(financial) &&
      (!data.months || (Array.isArray(data.months) && data.months.every(m => object(m) && Array.isArray(m.accounts) && m.accounts.every(financial)))) &&
      (!curve.principal || financial(curve.principal)) &&
      (!curve.points || (Array.isArray(curve.points) && curve.points.every(financial))) &&
      (!curve.mdd || (object(curve.mdd) && Object.values(curve.mdd).every(v => v === null || financial(v)))) &&
      (!benchmark.points || (Array.isArray(benchmark.points) && benchmark.points.every(financial))) &&
      (!benchmark.periods || (object(benchmark.periods) && Object.values(benchmark.periods).every(financial))) && safe(data);
  }
  async function fetchSnapshot(url, deadline) {
    const controller = new AbortController(); let timeout;
    try {
      // Race also bounds body/JSON reads even if a transport ignores abort.
      return await Promise.race([
        (async () => {
          const response = await fetch(url, {cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: controller.signal});
          if (!response.ok) throw new Error("snapshot HTTP error");
          const data = await response.json();
          const valid = url.startsWith(PUBLIC_RAW) ? validSnapshot(data) :
            data && data.schema_version === 1 && Array.isArray(data.accounts) &&
            typeof data.generated_at === "string" && Number.isFinite(Date.parse(data.generated_at)) &&
            Date.parse(data.generated_at) <= Date.now() + 300000;
          if (!valid) throw new Error("invalid public snapshot");
          return data;
        })(),
        new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error("snapshot deadline")); }, deadline); })
      ]);
    } finally { clearTimeout(timeout); }
  }
  function acceptSnapshot(data, source, force) {
    const current = state.data && Date.parse(state.data.generated_at);
    const next = Date.parse(data.generated_at);
    // Equal-time conflicts and rollbacks never replace the first validated last-good.
    if (state.data && next <= current) {
      if (next === current) state.loadError = false;
      if (force) render();
      renderFreshness(); return next === current;
    }
    state.data = data; state.source = source; state.loadError = false; render();
    return true;
  }
  async function load(force) {
    if (state.loading) return;
    state.loading = true;
    let available = false;
    try {
      // Render Pages first; the optional raw probe must never hold the initial screen hostage.
      try { available = acceptSnapshot(await fetchSnapshot("api/snapshot", 15000), "pages", force); } catch (_) {}
      if (RAW_ALLOWED) {
        try {
          // Short cache key avoids raw CDN's multi-minute cached object after a new publish.
          const data = await fetchSnapshot(`${PUBLIC_RAW}?v=${Math.floor(Date.now() / 30000)}`, 4000);
          available = acceptSnapshot(data, "raw", force) || available;
        } catch (_) { /* Optional source failure keeps local/last-good values unchanged. */ }
      }
      state.loadError = !available; renderFreshness();
    } finally { state.loading = false; }
  }
  $("hide-toggle").addEventListener("click", () => { state.hidden = !state.hidden; render(); });
  // 폭이 바뀔 때만 전체 재배치. 높이만 바뀌는 경우(휴대폰 주소창 접힘)는 차트가 ResizeObserver로 알아서 다시 그린다.
  let lastWidth = window.innerWidth, timer = 0;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(timer); timer = setTimeout(render, 160);
  });
  setInterval(() => load(), POLL_MS);
  setInterval(renderFreshness, 30000);
  // 매시 게시 직후(:12)에 한 번 더 확인해 새 자료를 5분 이내가 아니라 2분 안에 반영한다.
  (function scheduleHourly() {
    const now = new Date(), next = new Date(now);
    next.setMinutes(PUBLISH_MINUTE, 0, 0);
    if (next <= now) next.setHours(next.getHours() + 1);
    setTimeout(() => { load(); scheduleHourly(); }, next - now + 500);
  })();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { renderFreshness(); load(); }
  });
  load();
})();
