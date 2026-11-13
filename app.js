/* Thẻ Yu-Gi-Oh — PWA (standalone)
   - Lưu cục bộ (localStorage) + đồng bộ tùy chọn qua Supabase.
   - Tra cứu: theo tên (Anh/Nhật) hoặc mã bộ (TCG & Nhật -JP).
   - Quét thẻ: chụp/chọn ảnh -> OCR trên máy (Tesseract, eng+jpn) -> tra cứu.
   Nguồn dữ liệu:
     YGOPRODeck  : set/rarity/giá/ảnh (bản TCG).
     ygoresources: index tên tiếng Nhật -> tên tiếng Anh (OCG).
     Yugipedia   : mã bộ Nhật (-JP) -> tên thẻ (qua trang redirect). */
(function () {
  "use strict";
  var API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
  var SETINFO = "https://db.ygoprodeck.com/api/v7/cardsetsinfo.php";
  var IMG = "https://images.ygoprodeck.com/images/cards_small/";
  var YGORES = "https://db.ygoresources.com/data";
  var JA_IDX = YGORES + "/idx/card/name/ja";
  var YUGI = "https://yugipedia.com/api.php";
  var TCGREP_SEARCH = "https://tcgrepublic.com/product/text_search.html";
  var TCGREP_PROXY = "https://ygo-proxy.tranducdung286.workers.dev/?url=";
  var TESS_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  var SB_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.74.0/dist/umd/supabase.min.js";

  var LS_LOCAL = "ygo_collection_v2", LS_V1 = "ygo_collection_v1", LS_PENDING = "ygo_pending_v1", LS_THEME = "ygo_theme";
  var CFG = window.YGO_CONFIG || {};
  function sbConf() { var u = "", k = ""; try { u = localStorage.getItem("ygo_sb_url") || ""; k = localStorage.getItem("ygo_sb_key") || ""; } catch (e) {} return { url: u || CFG.supabaseUrl || "", key: k || CFG.supabaseAnonKey || "" }; }
  function cloudConfigured() { var c = sbConf(); return !!(c.url && c.key); }

  var CONDS = [
    { c: "NM", name: "Near Mint", f: 1.00 }, { c: "LP", name: "Lightly Pl.", f: 0.85 },
    { c: "MP", name: "Moderate", f: 0.70 }, { c: "HP", name: "Heavy Pl.", f: 0.55 }, { c: "DMG", name: "Damaged", f: 0.40 }
  ];
  var LANGS = [
    { c: "EN", name: "Tiếng Anh (EN)" }, { c: "JP", name: "Tiếng Nhật – OCG (JP)" }, { c: "AE", name: "Asian-English (AE)" },
    { c: "KR", name: "Tiếng Hàn (KR)" }, { c: "DE", name: "Tiếng Đức (DE)" }, { c: "FR", name: "Tiếng Pháp (FR)" },
    { c: "IT", name: "Tiếng Ý (IT)" }, { c: "PT", name: "Bồ Đào Nha (PT)" }, { c: "SP", name: "Tây Ban Nha (SP)" }
  ];
  function condFactor(c) { for (var i = 0; i < CONDS.length; i++) if (CONDS[i].c === c) return CONDS[i].f; return 1; }
  // vùng mã TCG mà YGOPRODeck có dữ liệu (region trong XXX-<REGION>###)
  var TCG_REGIONS = { EN: 1, FR: 1, DE: 1, IT: 1, PT: 1, SP: 1, "": 1 };

  function $(id) { return document.getElementById(id); }
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function money(n) { n = Number(n) || 0; return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function slug(s) { return String(s == null ? "" : s).replace(/[^A-Za-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "x"; }
  function makeKey(it) { return it.cardId + "~" + slug(it.setCode || "nocode") + "~" + slug(it.rarity || "na") + "~" + (it.condition || "NM") + "~" + (it.lang || "EN"); }
  function hasJapanese(s) { return /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/.test(s || ""); }
  var toastTimer;
  function toast(m) { var t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1900); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("load " + src)); }; document.head.appendChild(s); }); }

  function rarityClass(r) {
    r = (r || "").toLowerCase();
    if (r.indexOf("secret") >= 0) return "r-secret";
    if (r.indexOf("ghost") >= 0) return "r-ghost";
    if (r.indexOf("ultra") >= 0) return "r-ultra";
    if (r.indexOf("super") >= 0) return "r-super";
    if (r.indexOf("rare") >= 0 && r.indexOf("common") < 0) return "r-rare";
    if (r.indexOf("common") >= 0) return "";
    return "r-special";
  }
  function rarChip(r) { return el("span", "rar " + rarityClass(r), r || "—"); }
  function condChip(c) { return el("span", "tag c-" + (c || "nm").toLowerCase(), c || "NM"); }
  function langChip(l) { return el("span", "tag lang", l || "EN"); }
  var RARITY_RANK = {};
  ["Common", "Short Print", "Rare", "Super Rare", "Ultra Rare", "Ultimate Rare", "Secret Rare", "Prismatic Secret Rare", "Ultra Secret Rare", "Platinum Secret Rare", "Ghost Rare", "Starlight Rare", "Collector's Rare", "Platinum Rare", "Gold Rare", "Quarter Century Secret Rare"].forEach(function (r, i) { RARITY_RANK[r] = i; });
  function byRarityRank(a, b) { var ra = RARITY_RANK[a.set_rarity], rb = RARITY_RANK[b.set_rarity]; if (ra == null) ra = 90; if (rb == null) rb = 90; return ra - rb || (a.set_rarity || "").localeCompare(b.set_rarity || ""); }
  function withMono(code) { return el("span", "mono", code || "—"); }
  function hintCenter(m) { return el("p", "hint center", m); }

  // ============ HỌC HỎI THEO CÁCH DÙNG (lưu cục bộ) ============
  var Learn = (function () {
    function get(k, def) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : def; } catch (e) { return def; } }
    function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
    function nrm(s) { return (s || "").toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9぀-ヿ㐀-䶿一-鿿]/g, ""); }
    return {
      bump: function (kind, val) { if (!val) return; var m = get("ygo_use_" + kind, {}); m[val] = (m[val] || 0) + 1; set("ygo_use_" + kind, m); },
      top: function (kind, fb) { var m = get("ygo_use_" + kind, {}), best = fb, bc = 0; for (var k in m) { if (m[k] > bc) { bc = m[k]; best = k; } } return best; },
      ocrFixGet: function (raw) { var m = get("ygo_ocr_fix", {}); return m[nrm(raw)]; },
      ocrFixSet: function (raw, fixed) { if (!raw || !fixed || nrm(raw) === nrm(fixed)) return; var m = get("ygo_ocr_fix", {}); m[nrm(raw)] = fixed; set("ygo_ocr_fix", m); },
      logPrice: function (id, price) { if (!id || !(price > 0)) return; var key = "ygo_ph_" + id, a = get(key, []); var d = new Date().toISOString().slice(0, 10); if (a.length && a[a.length - 1].d === d) a[a.length - 1].p = price; else a.push({ d: d, p: price }); if (a.length > 60) a = a.slice(-60); set(key, a); },
      priceHistory: function (id) { return get("ygo_ph_" + id, []); }
    };
  })();
  function sparkline(pts) {
    var w = 240, h = 44, pad = 4, ns = "http://www.w3.org/2000/svg";
    var vals = pts.map(function (p) { return p.p; }); var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals); var rng = Math.max(1e-6, max - min);
    var step = (w - 2 * pad) / Math.max(1, pts.length - 1);
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + (pad + i * step).toFixed(1) + "," + (pad + (h - 2 * pad) * (1 - (p.p - min) / rng)).toFixed(1); }).join(" ");
    var svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 " + w + " " + h); svg.setAttribute("width", "100%"); svg.style.maxWidth = w + "px"; svg.style.height = h + "px"; svg.style.display = "block";
    var path = document.createElementNS(ns, "path"); path.setAttribute("d", d); path.setAttribute("fill", "none"); path.setAttribute("stroke", "var(--gold)"); path.setAttribute("stroke-width", "2"); path.setAttribute("stroke-linejoin", "round"); svg.appendChild(path);
    var last = pts[pts.length - 1]; var cx = pad + (pts.length - 1) * step, cy = pad + (h - 2 * pad) * (1 - (last.p - min) / rng);
    var dot = document.createElementNS(ns, "circle"); dot.setAttribute("cx", cx.toFixed(1)); dot.setAttribute("cy", cy.toFixed(1)); dot.setAttribute("r", "3"); dot.setAttribute("fill", "var(--gold)"); svg.appendChild(dot);
    return svg;
  }

  function normalize(raw) {
    var it = {
      cardId: Number(raw.cardId || raw.card_id) || 0, name: String(raw.name || ""),
      setCode: String(raw.setCode || raw.set_code || ""), setName: String(raw.setName || raw.set_name || ""),
      rarity: String(raw.rarity || ""), price: Number(raw.price) || 0,
      condition: raw.condition || "NM", lang: raw.lang || "EN", qty: Math.max(1, Number(raw.qty) || 1)
    };
    it.key = makeKey(it); return it;
  }

  // ============ STORE ============ (giữ nguyên: local + Supabase tùy chọn)
  var Store = (function () {
    var items = new Map(), listeners = [];
    var mode = "local", loaded = false, sb = null, user = null, rt = null;
    function notify() { for (var i = 0; i < listeners.length; i++) try { listeners[i](); } catch (e) {} }
    function readLocalArray() {
      var out = [];
      [LS_LOCAL, LS_V1].forEach(function (k) { try { var a = JSON.parse(localStorage.getItem(k) || "[]"); if (Array.isArray(a)) a.forEach(function (x) { out.push(normalize(x)); }); } catch (e) {} });
      var m = new Map(); out.forEach(function (it) { var e = m.get(it.key); if (e) e.qty += it.qty; else m.set(it.key, it); });
      return Array.from(m.values());
    }
    function persistLocal() { try { localStorage.setItem(LS_LOCAL, JSON.stringify(Array.from(items.values()))); } catch (e) {} }
    function readPending() { try { return JSON.parse(localStorage.getItem(LS_PENDING) || "[]"); } catch (e) { return []; } }
    function writePending(a) { try { localStorage.setItem(LS_PENDING, JSON.stringify(a)); } catch (e) {} }
    function enqueue(op) { var p = readPending(); p.push(op); writePending(p); }
    function okThrow(r) { if (r && r.error) throw r.error; return r; }
    function toRow(it) { return { user_id: user.id, key: it.key, card_id: it.cardId, name: it.name, set_code: it.setCode, set_name: it.setName, rarity: it.rarity, price: it.price, condition: it.condition, lang: it.lang, qty: it.qty, updated_at: new Date().toISOString() }; }
    function fromRow(r) { return normalize({ cardId: r.card_id, name: r.name, setCode: r.set_code, setName: r.set_name, rarity: r.rarity, price: r.price, condition: r.condition, lang: r.lang, qty: r.qty }); }
    function flushPending() {
      if (mode !== "cloud" || !sb || !user) return Promise.resolve();
      var p = readPending(); if (!p.length) return Promise.resolve(); writePending([]);
      var chain = Promise.resolve();
      p.forEach(function (op) { chain = chain.then(function () { if (op.t === "upsert") return sb.from("cards").upsert(toRow(op.it)).then(okThrow); if (op.t === "delete") return sb.from("cards").delete().eq("user_id", user.id).eq("key", op.key).then(okThrow); }).catch(function () { enqueue(op); }); });
      return chain;
    }
    function setItemsFromLocal() { items = new Map(); readLocalArray().forEach(function (it) { items.set(it.key, it); }); persistLocal(); }
    function initLocal() { mode = "local"; setItemsFromLocal(); loaded = true; notify(); }
    function cloudPull() {
      return sb.from("cards").select("*").eq("user_id", user.id).then(function (r) {
        if (r.error) throw r.error;
        var m = new Map(); (r.data || []).forEach(function (row) { var it = fromRow(row); m.set(it.key, it); });
        var extras = []; readLocalArray().forEach(function (it) { if (!m.has(it.key)) { m.set(it.key, it); extras.push(it); } });
        items = m; loaded = true; notify();
        if (extras.length) sb.from("cards").upsert(extras.map(toRow)).then(function (rr) { if (!rr.error) toast("Đã đưa " + extras.length + " lá lên tài khoản"); });
      });
    }
    function subscribeRealtime() {
      try { if (rt) sb.removeChannel(rt);
        rt = sb.channel("cards-" + user.id).on("postgres_changes", { event: "*", schema: "public", table: "cards", filter: "user_id=eq." + user.id }, function (p) {
          if (p.eventType === "DELETE") { if (p.old && p.old.key) items.delete(p.old.key); } else { var it = fromRow(p.new); items.set(it.key, it); } notify();
        }).subscribe();
      } catch (e) {}
    }
    function enterCloud(u) { mode = "cloud"; user = u; loaded = false; notify(); flushPending().then(cloudPull).then(subscribeRealtime).catch(function () { setItemsFromLocal(); loaded = true; notify(); toast("Chưa kết nối được máy chủ, dùng dữ liệu máy"); }); }
    function leaveCloud() { if (rt && sb) try { sb.removeChannel(rt); } catch (e) {} rt = null; user = null; initLocal(); }
    function writeItem(it) { items.set(it.key, it); persistLocal(); notify(); if (mode === "cloud" && sb && user) return sb.from("cards").upsert(toRow(it)).then(okThrow).catch(function () { enqueue({ t: "upsert", it: it }); }); return Promise.resolve(); }
    function deleteKey(key) { items.delete(key); persistLocal(); notify(); if (mode === "cloud" && sb && user) return sb.from("cards").delete().eq("user_id", user.id).eq("key", key).then(okThrow).catch(function () { enqueue({ t: "delete", key: key }); }); return Promise.resolve(); }
    window.addEventListener("online", function () { if (mode === "cloud") flushPending(); });
    return {
      get mode() { return mode; }, get loaded() { return loaded; }, get user() { return user; }, get cloudReady() { return !!sb; },
      list: function () { return Array.from(items.values()); }, get: function (k) { return items.get(k); }, onChange: function (cb) { listeners.push(cb); },
      init: function () {
        initLocal(); var cf = sbConf(); if (!cf.url || !cf.key) return;
        loadScript(SB_CDN).then(function () {
          sb = window.supabase.createClient(cf.url, cf.key);
          sb.auth.getSession().then(function (r) { var u = r && r.data && r.data.session && r.data.session.user; if (u) enterCloud(u); notify(); });
          sb.auth.onAuthStateChange(function (_e, s) { var u = s && s.user; if (u && (!user || user.id !== u.id)) enterCloud(u); else if (!u && user) leaveCloud(); notify(); });
        }).catch(function () { toast("Không tải được thư viện đồng bộ"); });
      },
      // Đăng nhập bằng email + mật khẩu; chưa có tài khoản thì tự tạo. Không cần link mail.
      signInPassword: function (email, pw) {
        if (!sb) return Promise.reject(new Error("no sb"));
        return sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
          if (!r.error) return { ok: true };
          if (/not confirmed|confirm/i.test(r.error.message || "")) throw { msg: "Email này chưa xác nhận. Vào Supabase tắt “Confirm email”, xóa user này ở Authentication → Users, rồi tạo lại." };
          return sb.auth.signUp({ email: email, password: pw }).then(function (s) {
            if (s.error) { if (/already registered|already exists/i.test(s.error.message)) throw { msg: "Email này đã có tài khoản nhưng mật khẩu không khớp. Nhập đúng mật khẩu, hoặc xóa user ở Supabase → Authentication → Users rồi tạo lại." }; throw { msg: s.error.message }; }
            if (s.data && s.data.session) return { ok: true };            // xác nhận email đã tắt -> vào luôn
            throw { msg: "Tài khoản mới cần tắt xác nhận email: Supabase → Authentication → Sign In / Providers → Email, tắt “Confirm email”, rồi bấm lại.", needConfirm: true };
          });
        });
      },
      signOut: function () { if (sb) sb.auth.signOut(); },
      add: function (item, addQty) {
        addQty = Math.max(1, addQty || 1); var key = makeKey(item); var cur = items.get(key);
        var it = cur ? { cardId: cur.cardId, name: cur.name, setCode: cur.setCode, setName: cur.setName, rarity: cur.rarity, price: cur.price, condition: cur.condition, lang: cur.lang, qty: cur.qty + addQty, key: key }
          : { cardId: item.cardId, name: item.name, setCode: item.setCode, setName: item.setName, rarity: item.rarity, price: item.price, condition: item.condition, lang: item.lang, qty: addQty, key: key };
        return writeItem(it);
      },
      setQty: function (key, qty) { var cur = items.get(key); if (!cur) return Promise.resolve(); if (qty <= 0) return deleteKey(key); return writeItem({ cardId: cur.cardId, name: cur.name, setCode: cur.setCode, setName: cur.setName, rarity: cur.rarity, price: cur.price, condition: cur.condition, lang: cur.lang, qty: qty, key: key }); },
      remove: function (key) { return deleteKey(key); },
      edit: function (oldKey, cond, lang, qty) {
        var cur = items.get(oldKey); if (!cur) return Promise.resolve();
        var target = { cardId: cur.cardId, name: cur.name, setCode: cur.setCode, setName: cur.setName, rarity: cur.rarity, price: cur.price, condition: cond, lang: lang, qty: qty };
        var newKey = makeKey(target);
        if (newKey !== oldKey) { var ex = items.get(newKey); target.qty = qty + (ex ? ex.qty : 0); target.key = newKey; return Promise.all([deleteKey(oldKey), writeItem(target)]); }
        target.key = newKey; return writeItem(target);
      }
    };
  })();

  // ============ TABS / THEME ============
  var tabs = [{ btn: "t-search", panel: "p-search" }, { btn: "t-collection", panel: "p-collection" }, { btn: "t-scan", panel: "p-scan" }];
  function showTab(id) { tabs.forEach(function (t) { var s = t.panel === id; $(t.btn).setAttribute("aria-selected", s ? "true" : "false"); $(t.panel).hidden = !s; }); try { localStorage.setItem("ygo_tab", id); } catch (e) {} if (id === "p-collection") renderCollection(); }
  function saveLast(m, qq) { try { localStorage.setItem("ygo_lastq", JSON.stringify({ mode: m, q: qq })); } catch (e) {} }
  tabs.forEach(function (t) { $(t.btn).addEventListener("click", function () { showTab(t.panel); }); });
  (function () { try { var s = localStorage.getItem(LS_THEME); if (s) document.documentElement.setAttribute("data-theme", s); } catch (e) {} })();
  $("themeBtn").addEventListener("click", function () { var cur = document.documentElement.getAttribute("data-theme"); var isDark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches; var next = isDark ? "light" : "dark"; document.documentElement.setAttribute("data-theme", next); try { localStorage.setItem(LS_THEME, next); } catch (e) {} });

  // ============ API ============
  function searchByName(q) { return fetch(API + "?fname=" + encodeURIComponent(q) + "&num=24&offset=0").then(function (r) { if (r.status === 400) return { data: [] }; if (!r.ok) throw 0; return r.json(); }).then(function (j) { return (j && j.data) || []; }); }
  function cardByFuzzy(name) {
    return fetch(API + "?fname=" + encodeURIComponent(name)).then(function (r) { if (r.status === 400) return { data: [] }; if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { var a = (j && j.data) || []; if (!a.length) return null; var ex = a.filter(function (c) { return (c.name || "").toLowerCase() === name.toLowerCase(); }); return ex[0] || a[0]; });
  }
  function cardById(id) { return fetch(API + "?id=" + encodeURIComponent(id)).then(function (r) { if (r.status === 400) return null; if (!r.ok) throw 0; return r.json(); }).then(function (j) { return (j && j.data && j.data[0]) || null; }).catch(function () { return null; }); }
  function lookupSetCode(c) { return fetch(SETINFO + "?setcode=" + encodeURIComponent(c)).then(function (r) { if (r.status === 400) return null; if (!r.ok) throw 0; return r.json(); }).then(function (j) { return (j && j.id) ? j : null; }); }
  // Yugipedia: mã bộ (mọi vùng, kể cả -JP) -> tên thẻ tiếng Anh (trang redirect)
  function yugiResolveCode(code) {
    var u = YUGI + "?action=query&titles=" + encodeURIComponent(code) + "&redirects=1&format=json&origin=*";
    return fetch(u).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
      var q = (j && j.query) || {}; var rd = q.redirects || [];
      if (rd.length && rd[0].to) return rd[0].to;
      var pages = q.pages || {};
      for (var k in pages) { var p = pages[k]; if (p && !("missing" in p) && p.title && p.title.toUpperCase() !== code.toUpperCase()) return p.title; }
      return null;
    });
  }
  // Lấy rarity (foil) của một mã in cụ thể từ bảng in trên Yugipedia (dùng cho mã Nhật/ngôn ngữ khác)
  function yugiPrintInfo(cardName, code) {
    var u = YUGI + "?action=parse&page=" + encodeURIComponent(cardName) + "&prop=text&format=json&origin=*";
    return fetch(u).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
      var htmlStr = j && j.parse && j.parse.text && j.parse.text["*"]; if (!htmlStr) return null;
      var doc = new DOMParser().parseFromString(htmlStr, "text/html");
      var rows = doc.querySelectorAll("tr"); var up = code.toUpperCase();
      var rarities = [], setName = "";
      for (var i = 0; i < rows.length; i++) {
        var tds = rows[i].querySelectorAll("td,th"); var texts = [];
        for (var k = 0; k < tds.length; k++) { var tx = (tds[k].textContent || "").trim(); if (tx) texts.push(tx); }
        var ci = -1; for (var m = 0; m < texts.length; m++) { if (texts[m].toUpperCase() === up) { ci = m; break; } }
        if (ci >= 0) {
          if (!setName) setName = texts[ci + 1] || "";
          var last = (texts[texts.length - 1] || "").replace(/([a-z.\)])([A-Z])/g, "$1|$2"); // tách nhiều rarity dính nhau
          last.split("|").forEach(function (x) { x = x.trim(); if (x && rarities.indexOf(x) < 0) rarities.push(x); });
        }
      }
      return rarities.length ? { rarities: rarities, setName: setName } : null;
    }).catch(function () { return null; });
  }
  // Tra mã bất kỳ: TCG (YGOPRODeck) trước, không có thì Nhật/khác qua Yugipedia
  function resolveSetCodeAny(code) {
    return lookupSetCode(code).then(function (hit) {
      if (hit) return { type: "ygopro", hit: hit };
      return yugiResolveCode(code).then(function (name) {
        if (!name) return null;
        return cardByFuzzy(name).then(function (card) { return { type: "yugi", card: card, name: name }; });
      }).catch(function () { return null; });
    });
  }

  // ============ JAPANESE INDEX (ygoresources) ============
  var JP = (function () {
    var idx = null, keys = null, loading = null;
    function load() { if (idx) return Promise.resolve(idx); if (loading) return loading; loading = fetch(JA_IDX).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) { idx = j; keys = Object.keys(j); try { localStorage.setItem("ygo_ja_at", String(Date.now())); } catch (e) {} return idx; }); return loading; }
    function norm(s) { return (s || "").replace(/\s+/g, "").replace(/[・.,。、｜|:：;；]/g, ""); }
    function bigrams(s) { var a = []; if (s.length < 2) return [s]; for (var i = 0; i < s.length - 1; i++) a.push(s.substr(i, 2)); return a; }
    function dice(a, b) { var A = bigrams(a), B = bigrams(b); if (!A.length || !B.length) return a === b ? 1 : 0; var m = {}; A.forEach(function (g) { m[g] = (m[g] || 0) + 1; }); var hit = 0; B.forEach(function (g) { if (m[g] > 0) { hit++; m[g]--; } }); return 2 * hit / (A.length + B.length); }
    function match(q) {
      if (!keys) return []; q = norm(q); if (!q) return [];
      var out = [], seen = {};
      // 1) khớp chính xác (sau chuẩn hóa)
      for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (norm(k) === q && !seen[k]) { out.push({ name: k, ids: idx[k], score: 1 }); seen[k] = 1; } }
      // 2) chứa nhau + tương đồng bigram
      var scored = [];
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j]; if (seen[key]) continue; var nk = norm(key); if (!nk) continue; var s;
        if (nk.indexOf(q) >= 0 || q.indexOf(nk) >= 0) s = 0.6 + 0.4 * Math.min(nk.length, q.length) / Math.max(nk.length, q.length);
        else s = dice(nk, q);
        if (s >= 0.34) scored.push({ name: key, ids: idx[key], score: s });
      }
      scored.sort(function (a, b) { return b.score - a.score; });
      for (var n = 0; n < scored.length && out.length < 24; n++) { if (!seen[scored[n].name]) { out.push(scored[n]); seen[scored[n].name] = 1; } }
      return out.slice(0, 24);
    }
    function card(konamiId) { return fetch(YGORES + "/card/" + konamiId).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) { return (j && j.cardData) || {}; }); }
    return { load: load, match: match, card: card };
  })();

  // ============ DỊCH TIẾNG VIỆT ============
  var VI = (function () {
    function ls(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
    function akey() { return ls("ygo_key_anthropic") || CFG.anthropicApiKey || ""; }
    function amodel() { return ls("ygo_model_anthropic") || CFG.anthropicModel || "claude-3-5-haiku-latest"; }
    function gkey() { return ls("ygo_key_gemini") || CFG.geminiApiKey || ""; }
    function gmodel() { return CFG.geminiModel || "gemini-2.0-flash"; }
    function ver() { return akey() ? "cl1" : gkey() ? "ai1" : "mt1"; }   // khóa cache theo nguồn dịch
    var GLOSS = [
      ["Special Summon", "Triệu hồi Đặc biệt"], ["Normal Summon", "Triệu hồi Thường"], ["Flip Summon", "Triệu hồi Lật"],
      ["Tribute", "Hiến tế"], ["banish", "loại khỏi trò chơi"], ["Graveyard", "Mộ bài"], ["GY", "Mộ bài"],
      ["Extra Deck", "Bộ bài Phụ"], ["Main Deck", "Bộ bài chính"], ["Deck", "Bộ bài"], ["hand", "trên tay"],
      ["Level", "Cấp"], ["Rank", "Hạng"], ["once per turn", "một lần mỗi lượt"], ["End Phase", "Pha Kết thúc"],
      ["Attack Position", "Thế Công"], ["Defense Position", "Thế Thủ"], ["face-down", "úp"], ["face-up", "ngửa"],
      ["Spell Card", "lá Phép"], ["Trap Card", "lá Bẫy"], ["Monster Card", "lá Quái thú"], ["Fusion", "Dung hợp"],
      ["Continuous", "Duy trì"], ["Equip", "Trang bị"], ["Field Spell", "Phép Sân"], ["draw", "rút"], ["destroy", "phá hủy"]
    ];
    function applyGloss(t) { GLOSS.forEach(function (g) { t = t.replace(new RegExp("\\b" + g[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), g[1]); }); return t; }
    function cacheGet(id) { try { var r = localStorage.getItem("ygo_vi_" + ver() + "_" + id); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
    function cacheSet(id, o) { try { localStorage.setItem("ygo_vi_" + ver() + "_" + id, JSON.stringify(o)); } catch (e) {} }
    function splitChunks(t, max) { var out = [], s = (t || "").replace(/\s+/g, " ").trim(); while (s.length > max) { var cut = s.lastIndexOf(". ", max); if (cut < 80) cut = s.lastIndexOf(" ", max); if (cut < 0) cut = max; out.push(s.slice(0, cut + 1)); s = s.slice(cut + 1); } if (s) out.push(s); return out; }
    var VI_PROMPT = "Dịch văn bản hiệu ứng lá bài Yu-Gi-Oh sau sang tiếng Việt tự nhiên, ĐÚNG CHỨC NĂNG (không dịch word-by-word), đúng thuật ngữ game: Special Summon=Triệu hồi Đặc biệt, Normal Summon=Triệu hồi Thường, Tribute=Hiến tế, banish=loại khỏi trò chơi, Graveyard=Mộ bài, Deck=Bộ bài, hand=trên tay, draw=rút, destroy=phá hủy, Level=Cấp, once per turn=một lần mỗi lượt. Chỉ trả về bản dịch, không thêm giải thích.\n\n";
    function claude(text) {
      return fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": akey(), "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: amodel(), max_tokens: 1024, messages: [{ role: "user", content: VI_PROMPT + text }] }) })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (j) { var t = j && j.content && j.content[0] && j.content[0].text; if (!t) throw 0; return { vi: t.trim(), src: "Claude" }; });
    }
    function gemini(text) {
      var url = "https://generativelanguage.googleapis.com/v1beta/models/" + gmodel() + ":generateContent?key=" + encodeURIComponent(gkey());
      return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: VI_PROMPT + text }] }], generationConfig: { temperature: 0.2 } }) })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (j) { var t = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0].text; if (!t) throw 0; return { vi: t.trim(), src: "AI" }; });
    }
    function mymemory(text) {
      return Promise.all(splitChunks(text, 450).map(function (ch) {
        return fetch("https://api.mymemory.translated.net/get?langpair=en|vi&q=" + encodeURIComponent(ch)).then(function (r) { return r.json(); }).then(function (j) { return (j && j.responseData && j.responseData.translatedText) || ""; });
      })).then(function (parts) { var v = applyGloss(parts.join(" ")); if (!v.trim()) throw 0; return { vi: v, src: "máy dịch" }; });
    }
    function translate(id, text) {
      if (!text) return Promise.resolve(null);
      var c = cacheGet(id); if (c && c.vi) return Promise.resolve(c);
      var p;
      if (akey()) p = claude(text).catch(function () { return gkey() ? gemini(text).catch(function () { return mymemory(text); }) : mymemory(text); });
      else if (gkey()) p = gemini(text).catch(function () { return mymemory(text); });
      else p = mymemory(text);
      return p.then(function (res) { if (res && res.vi) cacheSet(id, res); return res; });
    }
    return {
      translate: translate,
      activeName: function () { return akey() ? "Claude" : gkey() ? "Gemini" : "Dịch máy"; },
      getSettings: function () { return { anthropic: ls("ygo_key_anthropic"), anthropicModel: ls("ygo_model_anthropic") || CFG.anthropicModel || "claude-3-5-haiku-latest", gemini: ls("ygo_key_gemini") }; },
      saveSettings: function (o) {
        try {
          if (o.anthropic != null) { o.anthropic ? localStorage.setItem("ygo_key_anthropic", o.anthropic) : localStorage.removeItem("ygo_key_anthropic"); }
          if (o.anthropicModel != null) { o.anthropicModel ? localStorage.setItem("ygo_model_anthropic", o.anthropicModel) : localStorage.removeItem("ygo_model_anthropic"); }
          if (o.gemini != null) { o.gemini ? localStorage.setItem("ygo_key_gemini", o.gemini) : localStorage.removeItem("ygo_key_gemini"); }
        } catch (e) {}
      }
    };
  })();

  // Chú thích phân loại foil / rarity (tiếng Việt) — popup tham khảo
  var FOIL_GUIDE = [
    { r: "Common (C)", d: "Không foil. Chữ tên màu đen, tranh in thường — loại phổ biến nhất." },
    { r: "Rare (R)", d: "Chữ tên màu bạc ánh kim; tranh in thường (không lấp lánh)." },
    { r: "Super Rare (SR)", d: "Phần TRANH có foil holo lấp lánh; chữ tên vẫn màu đen." },
    { r: "Ultra Rare (UR)", d: "Tranh holo + chữ tên màu VÀNG ánh kim." },
    { r: "Ultimate Rare (UtR)", d: "Nổi 3D (dập nổi) ở tranh, viền và chữ — sờ thấy gồ ghề." },
    { r: "Secret Rare (ScR)", d: "Foil kẻ chéo ánh cầu vồng phủ cả tranh lẫn tên; lấp lánh mạnh." },
    { r: "Prismatic / Platinum Secret", d: "Biến thể Secret: Prismatic foil đường thẳng lăng trụ; Platinum nền ánh bạch kim." },
    { r: "Ghost Rare", d: "Hiệu ứng 3D mờ ảo, hình như nổi khối; rất hiếm." },
    { r: "Starlight / Alternate Rare", d: "Foil kim cương lấp lánh phủ TOÀN THẺ kể cả viền; cực hiếm." },
    { r: "Collector's Rare (CR)", d: "Foil đen ánh kim, nổi nhẹ; chỉ có ở một số bộ sưu tầm." },
    { r: "Quarter Century Secret (QCSR)", d: "Foil kỷ niệm 25 năm, có logo '25', ánh bạc cầu vồng." },
    { r: "Gold / Premium Gold Rare", d: "Chữ tên và viền mạ vàng; bộ Gold Series." },
    { r: "Parallel Rare (Duel Terminal)", d: "Foil song song phủ toàn thẻ, hay thấy ở thẻ Duel Terminal." }
  ];
  function openFoilGuide() {
    var sheet = buildSheet();
    sheet.appendChild(el("h2", null, "Phân loại foil / rarity"));
    sheet.appendChild(el("p", "note", "Nghiêng thẻ dưới ánh sáng, xem vùng nào phản quang và màu chữ tên để đoán loại:"));
    var list = el("div"); list.style.cssText = "display:flex;flex-direction:column;gap:11px";
    FOIL_GUIDE.forEach(function (g) { var row = el("div"); var t = el("div"); t.style.cssText = "font-weight:700;font-size:14px"; t.appendChild(rarChip(g.r.replace(/\s*\(.*/, ""))); t.appendChild(document.createTextNode(" " + g.r)); row.appendChild(t); row.appendChild(el("div", "note", g.d)); list.appendChild(row); });
    sheet.appendChild(list);
    sheet.appendChild(el("p", "note", "Lưu ý: cách gọi rarity thay đổi theo bộ/khu vực (TCG, OCG, Asian). Muốn chắc chắn, tra bằng mã bộ ở góc phải dưới lá."));
    var close = el("button", "btn", "Đóng"); close.addEventListener("click", closeSheet); sheet.appendChild(close);
  }

  // Màn Cài đặt: dán key dịch (lưu trên máy, không cần sửa file)
  function settingsField(labelText, val, type) {
    var w = el("div"); w.appendChild(label(labelText));
    var f = el("label", "field"); var i = el("input"); i.type = type || "text"; i.value = val || ""; i.autocapitalize = "off"; i.autocomplete = "off"; i.spellcheck = false; f.appendChild(i); w.appendChild(f); w._input = i; return w;
  }
  function openSettings() {
    var s = VI.getSettings();
    var sheet = buildSheet();

    // --- Đồng bộ điện thoại ↔ máy tính ---
    // --- Dữ liệu & cập nhật ---
    sheet.appendChild(el("h2", null, "Dữ liệu & cập nhật"));
    var jaAt = ""; try { var t0 = Number(localStorage.getItem("ygo_ja_at") || 0); if (t0) jaAt = new Date(t0).toLocaleDateString("vi-VN"); } catch (e) {}
    sheet.appendChild(el("p", "note", "Thông tin thẻ & giá lấy trực tiếp từ web mỗi lần tra nên tự cập nhật; thẻ mới tự xuất hiện." + (jaAt ? " Kho tên Nhật cập nhật: " + jaAt + "." : "")));
    var refBtn = el("button", "btn ghost", "↻ Làm mới dữ liệu & bản app"); refBtn.style.width = "100%";
    refBtn.addEventListener("click", function () { refBtn.disabled = true; refBtn.textContent = "Đang làm mới…"; var p = (window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : Promise.resolve()); p.catch(function () {}).then(function () { try { localStorage.removeItem("ygo_ja_at"); } catch (e) {} setTimeout(function () { location.reload(); }, 400); }); });
    sheet.appendChild(refBtn);
    var hr0 = el("div"); hr0.style.cssText = "height:1px;background:var(--line);margin:4px 0"; sheet.appendChild(hr0);

    sheet.appendChild(el("h2", null, "Đồng bộ nhiều máy"));
    var syncState = Store.mode === "cloud" ? ("Đang đồng bộ" + (Store.user ? " · " + (Store.user.email || "") : "")) : (cloudConfigured() ? "Đã cấu hình — vào tab Bộ sưu tập để đăng nhập" : "Chưa bật (chỉ lưu trên máy này)");
    sheet.appendChild(el("p", "note", "Trạng thái: " + syncState + ". Dán 2 thông tin Supabase dưới đây rồi Lưu; sau đó vào tab Bộ sưu tập đăng nhập bằng email trên cả 2 máy."));
    var cf = sbConf();
    var sbUrlF = settingsField("Supabase Project URL", (function () { try { return localStorage.getItem("ygo_sb_url") || CFG.supabaseUrl || ""; } catch (e) { return CFG.supabaseUrl || ""; } })(), "text");
    var sbKeyF = settingsField("Supabase key (anon eyJ… hoặc publishable sb_publishable_…)", (function () { try { return localStorage.getItem("ygo_sb_key") || CFG.supabaseAnonKey || ""; } catch (e) { return CFG.supabaseAnonKey || ""; } })(), "password");
    sheet.appendChild(sbUrlF); sheet.appendChild(sbKeyF);
    sheet.appendChild(el("p", "note", "Supabase → Settings → API Keys: dùng “Publishable key” (sb_publishable_…) hoặc legacy “anon public” (eyJ…). TUYỆT ĐỐI không dùng Secret/service_role."));
    var sbSave = el("button", "btn", "Lưu & bật đồng bộ"); sbSave.style.width = "100%";
    sbSave.addEventListener("click", function () {
      var u = sbUrlF._input.value.trim(), k = sbKeyF._input.value.trim();
      try { u ? localStorage.setItem("ygo_sb_url", u) : localStorage.removeItem("ygo_sb_url"); k ? localStorage.setItem("ygo_sb_key", k) : localStorage.removeItem("ygo_sb_key"); } catch (e) {}
      toast("Đã lưu — đang tải lại…"); setTimeout(function () { location.reload(); }, 700);
    });
    sheet.appendChild(sbSave);

    // --- Dịch tiếng Việt ---
    var hr = el("div"); hr.style.cssText = "height:1px;background:var(--line);margin:4px 0"; sheet.appendChild(hr);
    sheet.appendChild(el("h2", null, "Dịch tiếng Việt"));
    sheet.appendChild(el("p", "note", "Đang dùng: " + VI.activeName() + ". Ưu tiên Claude → Gemini → dịch máy. Để trống cả hai key = dịch máy miễn phí."));
    var aKeyF = settingsField("Claude API key (Anthropic)", s.anthropic, "password");
    var aModelF = settingsField("Model Claude", s.anthropicModel, "text");
    var gKeyF = settingsField("Gemini API key (tùy chọn)", s.gemini, "password");
    sheet.appendChild(aKeyF); sheet.appendChild(aModelF); sheet.appendChild(gKeyF);
    var links = el("p", "note"); links.textContent = "Lấy key: Claude — console.anthropic.com · Gemini (free) — aistudio.google.com/apikey"; sheet.appendChild(links);
    var foot = el("div", "sheet-foot");
    var clear = el("button", "btn ghost", "Xóa key dịch"); clear.addEventListener("click", function () { VI.saveSettings({ anthropic: "", anthropicModel: "", gemini: "" }); toast("Đã xóa key — dùng dịch máy"); closeSheet(); });
    var save = el("button", "btn", "Lưu key dịch"); save.style.flex = "1";
    save.addEventListener("click", function () { VI.saveSettings({ anthropic: aKeyF._input.value.trim(), anthropicModel: aModelF._input.value.trim(), gemini: gKeyF._input.value.trim() }); toast("Đã lưu — đang dùng " + VI.activeName()); closeSheet(); });
    foot.appendChild(clear); foot.appendChild(save); sheet.appendChild(foot);
  }

  // ============ SEARCH ============
  var mode = "name", currentResults = [];
  function setMode(m) { mode = m; Array.prototype.forEach.call($("modeSeg").querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-mode") === m ? "true" : "false"); }); $("q").placeholder = m === "code" ? "Mã bộ (vd: RA01-EN001 / YAS3-JP003)" : "Tên thẻ — Anh hoặc Nhật (青眼の白龍)"; }
  $("modeSeg").addEventListener("click", function (e) { var b = e.target.closest("button[data-mode]"); if (!b) return; setMode(b.getAttribute("data-mode")); $("q").value = ""; $("searchBody").innerHTML = '<p class="hint center">' + (mode === "code" ? "Gõ mã bộ in ở góc phải dưới lá thẻ (cả mã Nhật -JP) để tra đúng bản phát hành." : "Gõ tên thẻ bằng tiếng Anh hoặc tiếng Nhật để tra rarity, bộ phát hành và giá.") + "</p>"; });

  function renderResults(list) {
    currentResults = list; var body = $("searchBody"); body.innerHTML = "";
    if (!list.length) { body.appendChild(hintCenter("Không tìm thấy thẻ khớp. Thử tên khác hoặc kiểm tra chính tả.")); return; }
    var wrap = el("div", "results");
    list.forEach(function (c) {
      var row = el("button", "card-row");
      var img = el("img"); img.loading = "lazy"; img.alt = c.name; img.src = IMG + c.id + ".jpg"; img.onerror = function () { this.style.visibility = "hidden"; };
      var meta = el("div", "meta"); meta.appendChild(el("div", "nm", c.name)); meta.appendChild(el("div", "ty", c.humanReadableCardType || c.type || ""));
      var chev = el("span", "chev"); chev.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>';
      row.appendChild(img); row.appendChild(meta); row.appendChild(chev);
      row.addEventListener("click", function () { renderDetail(c, null, null); });
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
  }

  function doSearch(q) {
    q = (q || "").trim(); var body = $("searchBody");
    if (mode === "code") {
      var code = q.toUpperCase();                 // mã bộ: hoa/thường đều được
      if (code.length < 3) { toast("Nhập mã bộ (vd: LOB-005)"); return; }
      saveLast("code", q);
      body.innerHTML = '<p class="hint center"><span class="spin"></span> Đang tra mã ' + escapeHtml(code) + '…</p>';
      resolveSetCodeAny(code).then(function (res) {
        if (!res) { body.innerHTML = ""; body.appendChild(hintCenter("Không tìm thấy mã “" + code + "”. Kiểm tra lại dấu gạch/chữ, hoặc thử tra theo tên.")); return; }
        if (res.type === "ygopro") { (res.hit.id ? cardById(res.hit.id) : cardByFuzzy(res.hit.name)).then(function (card) { if (card) renderDetail(card, null, { codeView: res.hit.set_code }); else renderMiniDetail(res.hit); }).catch(function () { renderMiniDetail(res.hit); }); }
        else if (res.type === "yugi") { if (res.card) renderDetail(res.card, null, { codeNote: code + " → " + res.card.name, codeView: code }); else { body.innerHTML = ""; body.appendChild(hintCenter("Mã “" + code + "” là thẻ: " + res.name + " (chưa có dữ liệu giá/ảnh TCG).")); } }
      }).catch(function () { body.innerHTML = ""; body.appendChild(hintCenter("Lỗi kết nối. Thử lại.")); });
      return;
    }
    // mode name
    if (hasJapanese(q)) { saveLast("name", q); runJapaneseSearch(q); return; }
    if (q.length < 2) { toast("Nhập ít nhất 2 ký tự"); return; }
    saveLast("name", q);
    body.innerHTML = '<p class="hint center"><span class="spin"></span> Đang tìm…</p>';
    searchByName(q).then(renderResults).catch(function () { body.innerHTML = ""; body.appendChild(hintCenter("Lỗi kết nối. Kiểm tra mạng rồi thử lại.")); });
  }
  $("goBtn").addEventListener("click", function () { doSearch($("q").value); });
  $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(this.value); });

  // ---- Japanese name search ----
  function runJapaneseSearch(q) {
    var body = $("searchBody");
    body.innerHTML = '<p class="hint center"><span class="spin"></span> Đang tải dữ liệu thẻ Nhật (lần đầu ~1MB)…</p>';
    JP.load().then(function () { renderJPCandidates(q, JP.match(q)); })
      .catch(function () { body.innerHTML = ""; body.appendChild(hintCenter("Không tải được dữ liệu thẻ Nhật. Kiểm tra mạng rồi thử lại.")); });
  }
  function renderJPCandidates(q, list) {
    var body = $("searchBody"); body.innerHTML = "";
    if (!list.length) { body.appendChild(hintCenter("Không khớp tên Nhật nào với “" + escapeHtml(q) + "”. Chụp rõ hơn, hoặc gõ lại tên/mã bộ.")); return; }
    if (list.length === 1) { showJP(list[0].ids[0]); return; }
    body.appendChild(el("div", "sec-title", "Có thể là (" + list.length + ") — chọn đúng thẻ của bạn"));
    var wrap = el("div", "results");
    list.forEach(function (c) {
      var row = el("button", "card-row");
      var meta = el("div", "meta"); var nm = el("div", "nm", c.name); meta.appendChild(nm); meta.appendChild(el("div", "ty", "Thẻ Yu-Gi-Oh (OCG)"));
      var chev = el("span", "chev"); chev.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>';
      row.appendChild(meta); row.appendChild(chev);
      row.addEventListener("click", function () { showJP(c.ids[0]); });
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
  }
  function showJP(konamiId) {
    var body = $("searchBody"); body.innerHTML = '<p class="hint center"><span class="spin"></span> Đang lấy thông tin thẻ…</p>';
    JP.card(konamiId).then(function (cd) {
      var en = cd.en && cd.en.name; var jpName = (cd.ja && cd.ja.name) || "";
      if (en) { cardByFuzzy(en).then(function (card) { if (card) renderDetail(card, null, { jpName: jpName }); else renderJPOnly(cd); }).catch(function () { renderJPOnly(cd); }); }
      else renderJPOnly(cd);
    }).catch(function () { body.innerHTML = ""; body.appendChild(hintCenter("Không lấy được thông tin thẻ. Thử lại.")); });
  }
  function renderJPOnly(cd) {
    var body = $("searchBody"); body.innerHTML = "";
    var back = el("button", "btn ghost sm", "‹ Quay lại"); back.style.alignSelf = "flex-start"; back.addEventListener("click", function () { body.innerHTML = ""; body.appendChild(hintCenter("Tra cứu thẻ mới ở trên.")); }); body.appendChild(back);
    var loc = cd.ja || cd.ae || cd.en || {};
    body.appendChild(el("h2", null, loc.name || "Thẻ OCG"));
    var sl = el("div", "stat-line");
    if (cd.ja && cd.ja.name) addStat(sl, "Tên Nhật", cd.ja.name);
    if (loc.atk != null) addStat(sl, "ATK", loc.atk); if (loc.def != null) addStat(sl, "DEF", loc.def); if (loc.level != null) addStat(sl, "Level", loc.level);
    if (loc.attribute) addStat(sl, "Hệ", loc.attribute); body.appendChild(sl);
    if (loc.effectText) body.appendChild(el("div", "desc", loc.effectText));
    body.appendChild(el("p", "note", "Thẻ này chưa có bản TCG trong dữ liệu giá — có thể thêm vào bộ sưu tập thủ công (giá 0)."));
    var prints = (cd.ja && cd.ja.prints) || [];
    if (prints.length) {
      body.appendChild(el("div", "sec-title", "Bản in tiếng Nhật (" + prints.length + ")"));
      var list = el("div", "sets");
      prints.slice(0, 30).forEach(function (p) {
        var row = el("div", "set-row"); var left = el("div"); var sc = el("div", "sc"); sc.appendChild(withMono(p.code)); left.appendChild(sc); if (p.date) left.appendChild(el("div", "sn", p.date));
        var price = el("div", "price tnum", "—");
        var add = el("button", "add-btn", "+"); add.title = "Thêm vào bộ sưu tập";
        add.addEventListener("click", function () { openAddSheet({ id: 0, name: loc.name || "OCG", card_images: [] }, { set_code: p.code, set_name: "", set_rarity: "", set_price: 0 }, 0); });
        row.appendChild(left); row.appendChild(price); row.appendChild(add); list.appendChild(row);
      });
      body.appendChild(list);
    }
    window.scrollTo(0, 0);
  }

  function addStat(c, k, v) { if (v == null || v === "") return; var s = el("span"); s.innerHTML = escapeHtml(k) + ": <b>" + escapeHtml(String(v)) + "</b>"; c.appendChild(s); }
  function priceText(p) { var n = Number(p); return n > 0 ? money(n) : "—"; }
  // Giá trung bình từ nhiều nguồn (chỉ USD), hiển thị 1 dòng duy nhất
  function avgPrice(c) {
    var cp = c.card_prices && c.card_prices[0]; if (!cp) return null;
    var vals = [cp.tcgplayer_price, cp.ebay_price, cp.amazon_price, cp.coolstuffinc_price].map(Number).filter(function (n) { return n > 0; });
    if (!vals.length) return null;
    var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    return { avg: avg, count: vals.length };
  }
  function priceBlock(c) {
    var info = avgPrice(c); if (!info) return null;
    var wrap = el("div");
    var chip = el("span", "tag"); chip.style.cssText = "font-size:14px;padding:6px 14px;font-weight:600";
    chip.textContent = "Giá tham khảo: " + money(info.avg);
    wrap.appendChild(chip);
    wrap.appendChild(el("p", "note", "Trung bình " + info.count + " nguồn (TCGplayer, eBay, Amazon, CoolStuffInc)."));
    return wrap;
  }
  // TCG Republic: tìm giá bản Nhật theo mã, trả về {rarity: {price, url, label}}
  function tcgRepublicParse(html, code) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, "text/html");
    var links = doc.querySelectorAll('a.thumbnail_card[href*="product_page_"]');
    var map = {};
    links.forEach(function (a) {
      var alt = (a.querySelector("img") || {}).alt || "";
      var codeUpper = code.toUpperCase();
      var idx = alt.toUpperCase().indexOf(codeUpper);
      if (idx < 0) return;
      var rarity = alt.substring(idx + code.length).trim();
      if (!rarity) rarity = "Normal";
      var priceEl = a.querySelector(".price_with_unit_offscreen");
      var p = priceEl ? parseFloat(priceEl.textContent) : 0;
      var href = a.getAttribute("href") || "";
      var fullUrl = href.startsWith("http") ? href : "https://tcgrepublic.com" + href;
      if (!map[rarity] || (p > 0 && (map[rarity].price <= 0 || p < map[rarity].price))) {
        map[rarity] = { price: p, url: fullUrl, label: rarity };
      }
    });
    return map;
  }
  function fetchWithTimeout(url, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(timer); });
  }
  function tcgRepublicSearch(code) {
    var target = TCGREP_SEARCH + "?q=" + encodeURIComponent(code) + "&Category=34";
    return fetchWithTimeout(TCGREP_PROXY + encodeURIComponent(target), 10000)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var html = data && data.contents ? data.contents : "";
        if (!html || html.length < 500) throw new Error("empty");
        var map = tcgRepublicParse(html, code);
        if (!Object.keys(map).length) throw new Error("no results");
        return map;
      })
      .catch(function () { return {}; });
  }

  function jpPriceLinks(code) {
    var wrap = el("div"); wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:6px";
    [["TCG Republic", "https://tcgrepublic.com/product/text_search.html?q=" + encodeURIComponent(code) + "&Category=34"],
     ["Yuyu-tei (遊々亭)", "https://yuyu-tei.jp/sell/ygo/s/search?search_word=" + encodeURIComponent(code)],
     ["Yahoo! Auctions JP", "https://auctions.yahoo.co.jp/search/search?p=" + encodeURIComponent(code)]].forEach(function (s) {
      var a = el("a", "btn ghost sm", "↗ Giá Nhật: " + s[0]); a.href = s[1]; a.target = "_blank"; a.rel = "noopener noreferrer"; wrap.appendChild(a);
    });
    return wrap;
  }

  function renderDetail(c, matchCode, extra) {
    var body = $("searchBody"); body.innerHTML = "";
    var back = el("button", "btn ghost sm", "‹ Quay lại"); back.style.alignSelf = "flex-start";
    back.addEventListener("click", function () { if (currentResults.length) renderResults(currentResults); else { body.innerHTML = ""; body.appendChild(hintCenter("Tra cứu thẻ mới ở trên.")); } });
    body.appendChild(back);
    if (extra && extra.codeNote) { var cn = el("div", "note"); cn.style.alignSelf = "flex-start"; cn.innerHTML = "🔎 " + escapeHtml(extra.codeNote); body.appendChild(cn); }
    var imgId = (c.card_images && c.card_images[0] && c.card_images[0].id) || c.id;
    var top = el("div", "detail-top");
    var img = el("img"); img.src = IMG + imgId + ".jpg"; img.alt = c.name; img.onerror = function () { this.style.visibility = "hidden"; };
    var info = el("div", "detail-info"); info.appendChild(el("h2", null, c.name));
    var sl = el("div", "stat-line");
    if (extra && extra.jpName) addStat(sl, "Tên Nhật", extra.jpName);
    addStat(sl, "Loại", c.humanReadableCardType || c.type);
    if (c.attribute) addStat(sl, "Hệ", c.attribute); if (c.race) addStat(sl, "Tộc", c.race);
    if (c.level != null) addStat(sl, "Level", c.level); if (c.atk != null) addStat(sl, "ATK", c.atk); if (c.def != null) addStat(sl, "DEF", c.def);
    info.appendChild(sl);
    if (c.archetype) { var ar = el("div", "stat-line"); addStat(ar, "Archetype", c.archetype); info.appendChild(ar); }
    if (c.desc) {
      info.appendChild(el("div", "desc", c.desc));
      var viToggle = el("button", "btn ghost sm"); viToggle.style.alignSelf = "flex-start"; viToggle.style.marginTop = "2px";
      var VI_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:5px"><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1m14 20-5-10-5 10m2-4h6"/></svg>';
      function setBtn(open) { viToggle.innerHTML = VI_ICON + (open ? "Ẩn bản dịch" : "Dịch tiếng Việt"); }
      setBtn(false);
      var viBox = el("div", "desc"); viBox.style.marginTop = "4px"; viBox.hidden = true;
      var loaded = false, translating = false;
      viToggle.addEventListener("click", function () {
        if (!viBox.hidden) { viBox.hidden = true; setBtn(false); return; }   // đang mở -> đóng
        viBox.hidden = false; setBtn(true);                                   // mở
        if (loaded || translating) return;
        translating = true; viBox.innerHTML = '<span class="spin"></span> Đang dịch…';
        VI.translate(c.id, c.desc).then(function (res) {
          translating = false; viBox.innerHTML = "";
          if (res && res.vi) { loaded = true; var tag = el("span", "tag lang", "VI · " + res.src); tag.style.marginRight = "6px"; viBox.appendChild(tag); viBox.appendChild(document.createTextNode(res.vi)); }
          else { var b = el("button", "btn ghost sm", "Thử lại"); b.onclick = function () { viBox.hidden = true; viToggle.click(); }; viBox.appendChild(b); }
        }).catch(function () { translating = false; viBox.innerHTML = ""; var b = el("button", "btn ghost sm", "Thử lại"); b.onclick = function () { viBox.hidden = true; viToggle.click(); }; viBox.appendChild(b); });
      });
      info.appendChild(viToggle); info.appendChild(viBox);
    }
    top.appendChild(img); top.appendChild(info); body.appendChild(top);
    var psBlock = priceBlock(c); if (psBlock) body.appendChild(psBlock);
    // Lịch sử giá: ghi giá đại diện theo ngày, vẽ biểu đồ xu hướng khi có >=2 mốc
    (function () {
      var priceInfo = avgPrice(c);
      var rep = priceInfo ? priceInfo.avg : 0;
      Learn.logPrice(c.id, rep);
      var hist = Learn.priceHistory(c.id);
      if (hist.length >= 2) {
        var box = el("div");
        var first = hist[0].p, last = hist[hist.length - 1].p; var pct = first > 0 ? ((last - first) / first * 100) : 0;
        var head = el("div", "sec-title", "Xu hướng giá (tự ghi, " + hist.length + " mốc)");
        box.appendChild(head); box.appendChild(sparkline(hist));
        var sign = pct > 0 ? "▲ +" : (pct < 0 ? "▼ " : "• ");
        box.appendChild(el("p", "note", sign + pct.toFixed(1) + "% từ " + hist[0].d + " (" + money(first) + ") → " + hist[hist.length - 1].d + " (" + money(last) + "). Trung bình nhiều nguồn; app tự tích luỹ theo ngày khi bạn mở thẻ."));
        body.appendChild(box);
      }
    })();
    // Tra theo mã bộ: CHỈ hiện đúng mã đã tra (các mức foil của chính mã đó), không liệt kê bộ khác
    if (extra && extra.codeView) {
      var qcode = extra.codeView;
      var exact = (c.card_sets || []).filter(function (s) { return s.set_code === qcode; }).sort(byRarityRank);
      function foilRow(s) {
        var row = el("div", "set-row match");
        var left = el("div"); var sc = el("div", "sc"); sc.appendChild(withMono(s.set_code)); if (s.set_rarity) sc.appendChild(rarChip(s.set_rarity));
        left.appendChild(sc); if (s.set_name) left.appendChild(el("div", "sn", s.set_name));
        var price = el("div", "price tnum", priceText(s.set_price));
        var add = el("button", "add-btn", "+"); add.title = "Thêm vào bộ sưu tập";
        add.addEventListener("click", (function (ss) { return function () { openAddSheet(c, { set_code: qcode, set_name: ss.set_name, set_rarity: ss.set_rarity, set_price: ss.set_price }, imgId); }; })(s));
        row.appendChild(left); row.appendChild(price); row.appendChild(add); return row;
      }
      if (exact.length) {
        // mã TCG có trong dữ liệu: nếu mã đó phát hành nhiều foil thì liệt kê đúng các foil của mã đó
        body.appendChild(el("div", "sec-title", exact.length > 1 ? ("Mã " + qcode + " — " + exact.length + " loại foil của mã này, chọn loại bạn có") : ("Mã " + qcode + " — bấm + để thêm")));
        var elist = el("div", "sets"); exact.forEach(function (s) { elist.appendChild(foilRow(s)); }); body.appendChild(elist);
      } else {
        // mã Nhật/ngôn ngữ khác: mỗi loại foil của mã đó là 1 dòng riêng để thêm đúng loại bạn có
        var titleEl = el("div", "sec-title", "Mã " + qcode + " — bấm + để thêm"); body.appendChild(titleEl);
        var listWrap = el("div", "sets"); listWrap.appendChild(foilRow({ set_code: qcode, set_name: "", set_rarity: "", set_price: 0 })); body.appendChild(listWrap);
        var jnote = el("p", "note"); jnote.innerHTML = '<span class="spin"></span> Đang tra các loại foil của bản ' + escapeHtml(qcode) + '…'; body.appendChild(jnote);
        // Chạy song song: lấy rarity từ Yugipedia + giá từ TCG Republic
        var pYugi = yugiPrintInfo(c.name, qcode);
        var pTcgRep = tcgRepublicSearch(qcode);
        Promise.all([pYugi, pTcgRep]).then(function (results) {
          var info = results[0], repMap = results[1] || {};
          listWrap.innerHTML = "";
          // Hàm khớp rarity từ Yugipedia với key TCG Republic
          function matchRepPrice(rarity) {
            if (!rarity) return null;
            var rup = rarity.toUpperCase();
            for (var k in repMap) { if (k.toUpperCase() === rup) return repMap[k]; }
            // thử khớp mờ: "Secret Rare" vs "Secret", "Ultra Rare" vs "Ultra"
            for (var k2 in repMap) {
              var kup = k2.toUpperCase();
              if (kup.indexOf(rup) >= 0 || rup.indexOf(kup) >= 0) return repMap[k2];
            }
            return null;
          }
          function foilRowWithPrice(s, repInfo) {
            var row = el("div", "set-row match");
            var left = el("div"); var sc = el("div", "sc"); sc.appendChild(withMono(s.set_code)); if (s.set_rarity) sc.appendChild(rarChip(s.set_rarity));
            left.appendChild(sc); if (s.set_name) left.appendChild(el("div", "sn", s.set_name));
            // Giá từ TCG Republic
            var priceDiv;
            if (repInfo && repInfo.price > 0) {
              priceDiv = el("div", "price tnum");
              var pa = el("a"); pa.href = repInfo.url; pa.target = "_blank"; pa.rel = "noopener noreferrer";
              pa.textContent = "$" + repInfo.price.toFixed(2);
              pa.style.cssText = "color:inherit;text-decoration:underline;text-decoration-style:dotted";
              pa.title = "Xem trên TCG Republic";
              priceDiv.appendChild(pa);
            } else if (repInfo && repInfo.url) {
              priceDiv = el("div", "price tnum");
              var pa2 = el("a"); pa2.href = repInfo.url; pa2.target = "_blank"; pa2.rel = "noopener noreferrer";
              pa2.textContent = "Xem giá"; pa2.style.cssText = "color:var(--accent);font-size:12px";
              priceDiv.appendChild(pa2);
            } else {
              priceDiv = el("div", "price tnum", "—");
            }
            var add = el("button", "add-btn", "+"); add.title = "Thêm vào bộ sưu tập";
            add.addEventListener("click", (function (ss, rp) { return function () { openAddSheet(c, { set_code: qcode, set_name: ss.set_name, set_rarity: ss.set_rarity, set_price: rp && rp.price > 0 ? rp.price : 0 }, imgId); }; })(s, repInfo));
            row.appendChild(left); row.appendChild(priceDiv); row.appendChild(add); return row;
          }
          if (info && info.rarities.length) {
            info.rarities.forEach(function (rr) {
              var rep = matchRepPrice(rr);
              listWrap.appendChild(foilRowWithPrice({ set_code: qcode, set_name: info.setName || "", set_rarity: rr, set_price: 0 }, rep));
            });
            titleEl.textContent = info.rarities.length > 1 ? ("Mã " + qcode + " — " + info.rarities.length + " loại foil, chọn đúng loại bạn có") : ("Mã " + qcode + " — bấm + để thêm");
            var hasPrice = Object.keys(repMap).some(function (k) { return repMap[k].price > 0; });
            jnote.innerHTML = (info.setName ? escapeHtml(info.setName) + ". " : "") + (hasPrice ? "Giá tham khảo từ <b>TCG Republic</b> (USD). Bấm giá để xem chi tiết." : "Chưa có giá trên TCG Republic cho bản này.");
          } else {
            // Không tìm rarity từ Yugipedia — thử dùng trực tiếp kết quả TCG Republic
            var repKeys = Object.keys(repMap);
            if (repKeys.length) {
              repKeys.forEach(function (rk) {
                listWrap.appendChild(foilRowWithPrice({ set_code: qcode, set_name: "", set_rarity: repMap[rk].label, set_price: 0 }, repMap[rk]));
              });
              titleEl.textContent = repKeys.length > 1 ? ("Mã " + qcode + " — " + repKeys.length + " loại foil, chọn đúng loại bạn có") : ("Mã " + qcode + " — bấm + để thêm");
              jnote.innerHTML = "Giá tham khảo từ <b>TCG Republic</b> (USD). Bấm giá để xem chi tiết.";
            } else {
              listWrap.appendChild(foilRow({ set_code: qcode, set_name: "", set_rarity: "", set_price: 0 }));
              jnote.textContent = "Chưa tra được rarity bản " + qcode + ". Dùng nút ⓘ Cách phân loại foil để tự xác định.";
            }
          }
        });
        body.appendChild(el("p", "note", "Giá bản Nhật — xem thêm ở nguồn Nhật uy tín (mở trang ngoài):"));
        body.appendChild(jpPriceLinks(qcode));
      }
      window.scrollTo(0, 0); return;
    }
    var sets = c.card_sets || [];
    body.appendChild(el("div", "sec-title", sets.length ? ("Rarity theo bộ (" + sets.length + ") — bấm + để thêm") : "Chưa có dữ liệu bộ phát hành"));
    if (sets.length) {
      var list = el("div", "sets"), matchRow = null;
      sets.forEach(function (s) {
        var row = el("div", "set-row"); if (matchCode && s.set_code === matchCode) { row.classList.add("match"); matchRow = row; }
        var left = el("div"); var sc = el("div", "sc"); sc.appendChild(withMono(s.set_code)); sc.appendChild(rarChip(s.set_rarity));
        left.appendChild(sc); left.appendChild(el("div", "sn", s.set_name || ""));
        var price = el("div", "price tnum", priceText(s.set_price));
        var add = el("button", "add-btn", "+"); add.title = "Thêm vào bộ sưu tập"; add.addEventListener("click", function () { openAddSheet(c, s, imgId); });
        row.appendChild(left); row.appendChild(price); row.appendChild(add); list.appendChild(row);
      });
      body.appendChild(list);
      if (matchRow) setTimeout(function () { matchRow.scrollIntoView({ block: "center", behavior: "smooth" }); }, 60);
    }
    window.scrollTo(0, 0);
  }
  function renderMiniDetail(hit) {
    var body = $("searchBody"); body.innerHTML = "";
    var back = el("button", "btn ghost sm", "‹ Quay lại"); back.style.alignSelf = "flex-start"; back.addEventListener("click", function () { body.innerHTML = ""; body.appendChild(hintCenter("Tra cứu thẻ mới ở trên.")); });
    body.appendChild(back); body.appendChild(el("h2", null, hit.name));
    var sl = el("div", "stat-line"); addStat(sl, "Bộ", hit.set_name); body.appendChild(sl);
    var list = el("div", "sets"); var row = el("div", "set-row match");
    var left = el("div"); var sc = el("div", "sc"); sc.appendChild(withMono(hit.set_code)); sc.appendChild(rarChip(hit.set_rarity)); left.appendChild(sc);
    var price = el("div", "price tnum", priceText(hit.set_price));
    var add = el("button", "add-btn", "+"); add.addEventListener("click", function () { openAddSheet({ id: hit.id, name: hit.name, card_images: [{ id: hit.id }] }, { set_code: hit.set_code, set_name: hit.set_name, set_rarity: hit.set_rarity, set_price: hit.set_price }, hit.id); });
    row.appendChild(left); row.appendChild(price); row.appendChild(add); list.appendChild(row); body.appendChild(list); window.scrollTo(0, 0);
  }

  // ============ SHEET (add/edit) ============
  var overlay = null;
  function closeSheet() { if (overlay) { overlay.classList.remove("show"); var o = overlay; overlay = null; setTimeout(function () { if (o && o.parentNode) o.parentNode.removeChild(o); }, 180); } }
  function buildSheet() { var ov = el("div", "overlay"); ov.addEventListener("click", function (e) { if (e.target === ov) closeSheet(); }); var sheet = el("div", "sheet"); ov.appendChild(sheet); document.body.appendChild(ov); requestAnimationFrame(function () { ov.classList.add("show"); }); overlay = ov; return sheet; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && overlay) closeSheet(); });
  function label(t) { return el("div", "fld-label", t); }
  function condSeg(sel) { var wrap = el("div", "cond-seg"), st = { c: sel || "NM" }; CONDS.forEach(function (cd) { var b = el("button"); b.setAttribute("aria-pressed", cd.c === st.c ? "true" : "false"); b.innerHTML = cd.c + "<small>×" + cd.f.toFixed(2) + "</small>"; b.addEventListener("click", function () { st.c = cd.c; Array.prototype.forEach.call(wrap.children, function (x) { x.setAttribute("aria-pressed", "false"); }); b.setAttribute("aria-pressed", "true"); wrap._onchange && wrap._onchange(); }); wrap.appendChild(b); }); wrap.get = function () { return st.c; }; return wrap; }
  function langSelect(sel) { var s = el("select", "lang-sel"); LANGS.forEach(function (l) { var o = el("option", null, l.name); o.value = l.c; if (l.c === (sel || "EN")) o.selected = true; s.appendChild(o); }); return s; }
  function qtyStepper(init) { var wrap = el("div", "qty-stepper"), st = { q: Math.max(1, init || 1) }; var mi = el("button", "qb", "−"), val = el("span", "qv tnum", String(st.q)), pl = el("button", "qb", "+"); mi.addEventListener("click", function () { if (st.q > 1) { st.q--; val.textContent = st.q; wrap._onchange && wrap._onchange(); } }); pl.addEventListener("click", function () { st.q++; val.textContent = st.q; wrap._onchange && wrap._onchange(); }); wrap.appendChild(mi); wrap.appendChild(val); wrap.appendChild(pl); wrap.get = function () { return st.q; }; return wrap; }
  function openAddSheet(card, set, imgId) {
    var sheet = buildSheet(); var base = Number(set.set_price) || 0;
    var head = el("div", "sheet-head"); var img = el("img"); img.src = IMG + (imgId || card.id) + ".jpg"; img.alt = card.name; img.onerror = function () { this.style.visibility = "hidden"; };
    var hinfo = el("div"); hinfo.appendChild(el("div", "sh-nm", card.name)); var hs = el("div", "sh-sub"); hs.appendChild(withMono(set.set_code)); if (set.set_rarity) hs.appendChild(rarChip(set.set_rarity)); if (base > 0) hs.appendChild(el("span", "ci-code tnum", money(base) + " (NM)")); hinfo.appendChild(hs);
    head.appendChild(img); head.appendChild(hinfo); sheet.appendChild(head);
    var cb = el("div"); cb.appendChild(label("Tình trạng")); var cs = condSeg(Learn.top("cond", "NM")); cb.appendChild(cs); sheet.appendChild(cb);
    var lb = el("div"); lb.appendChild(label("Ngôn ngữ / phiên bản")); var ls = langSelect(/-JP/i.test(set.set_code) ? "JP" : Learn.top("lang", "EN")); lb.appendChild(ls); sheet.appendChild(lb);
    var qb = el("div"); qb.appendChild(label("Số lượng")); var qs = qtyStepper(1); qb.appendChild(qs); sheet.appendChild(qb);
    var preview = el("div", "price-preview"); sheet.appendChild(preview);
    function refresh() { var f = condFactor(cs.get()), q = qs.get(), u = base * f; preview.innerHTML = base > 0 ? "Giá ước tính: <b>" + money(u) + "</b>/lá × " + q + " = <b>" + money(u * q) + "</b>" : "Giá: chưa có dữ liệu"; }
    cs._onchange = refresh; qs._onchange = refresh; refresh();
    var foot = el("div", "sheet-foot"); var cancel = el("button", "btn ghost", "Hủy"); cancel.addEventListener("click", closeSheet);
    var ok = el("button", "btn", "Thêm vào BST"); ok.style.flex = "1";
    ok.addEventListener("click", function () { Learn.bump("cond", cs.get()); Learn.bump("lang", ls.value); Store.add({ cardId: (card.card_images && card.card_images[0] && card.card_images[0].id) || card.id || 0, name: card.name, setCode: set.set_code || "", setName: set.set_name || "", rarity: set.set_rarity || "", price: base, condition: cs.get(), lang: ls.value }, qs.get()); closeSheet(); toast("Đã thêm " + qs.get() + "× " + card.name); });
    foot.appendChild(cancel); foot.appendChild(ok); sheet.appendChild(foot);
  }
  function openEditSheet(it) {
    var sheet = buildSheet();
    var head = el("div", "sheet-head"); var img = el("img"); img.src = IMG + it.cardId + ".jpg"; img.alt = it.name; img.onerror = function () { this.style.visibility = "hidden"; };
    var hinfo = el("div"); hinfo.appendChild(el("div", "sh-nm", it.name)); var hs = el("div", "sh-sub"); hs.appendChild(withMono(it.setCode)); if (it.rarity) hs.appendChild(rarChip(it.rarity)); hinfo.appendChild(hs);
    head.appendChild(img); head.appendChild(hinfo); sheet.appendChild(head);
    var cb = el("div"); cb.appendChild(label("Tình trạng")); var cs = condSeg(it.condition); cb.appendChild(cs); sheet.appendChild(cb);
    var lb = el("div"); lb.appendChild(label("Ngôn ngữ / phiên bản")); var ls = langSelect(it.lang); lb.appendChild(ls); sheet.appendChild(lb);
    var qb = el("div"); qb.appendChild(label("Số lượng")); var qs = qtyStepper(it.qty); qb.appendChild(qs); sheet.appendChild(qb);
    var foot = el("div", "sheet-foot"); var del = el("button", "btn ghost", "Xóa"); del.style.color = "var(--danger)"; del.addEventListener("click", function () { Store.remove(it.key); closeSheet(); toast("Đã xóa"); });
    var ok = el("button", "btn", "Lưu"); ok.style.flex = "1"; ok.addEventListener("click", function () { Store.edit(it.key, cs.get(), ls.value, qs.get()); closeSheet(); toast("Đã cập nhật"); });
    foot.appendChild(del); foot.appendChild(ok); sheet.appendChild(foot);
  }

  // ============ COLLECTION ============
  function renderAuthRow() {
    var row = $("authRow"); if (!cloudConfigured() || !Store.cloudReady) { row.hidden = true; return; } row.hidden = false; row.innerHTML = ""; row.style.flexDirection = ""; row.style.alignItems = ""; row.style.gap = "";
    if (Store.user) { var who = el("div"); who.style.flex = "1"; who.style.minWidth = "0"; who.innerHTML = '<div style="font-size:12px;color:var(--muted)">Đã đăng nhập</div><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(Store.user.email || "") + "</div>"; var out = el("button", "btn ghost sm", "Đăng xuất"); out.addEventListener("click", function () { Store.signOut(); }); row.appendChild(who); row.appendChild(out); }
    else {
      row.style.flexDirection = "column"; row.style.alignItems = "stretch"; row.style.gap = "8px";
      var ef = el("label", "field"); ef.style.flex = "0 0 auto"; var em = el("input"); em.type = "email"; em.placeholder = "Email"; em.autocomplete = "email"; ef.appendChild(em);
      var pf = el("label", "field"); pf.style.flex = "0 0 auto"; var pw = el("input"); pw.type = "password"; pw.placeholder = "Mật khẩu (≥ 6 ký tự)"; pw.autocomplete = "current-password"; pf.appendChild(pw);
      var go = el("button", "btn", "Đăng nhập / Tạo tài khoản"); go.style.width = "100%";
      function doLogin() {
        var e = (em.value || "").trim(), p = pw.value || "";
        if (!/.+@.+\..+/.test(e)) { toast("Nhập email hợp lệ"); return; }
        if (p.length < 6) { toast("Mật khẩu ít nhất 6 ký tự"); return; }
        go.disabled = true; go.textContent = "Đang đăng nhập…";
        Store.signInPassword(e, p).then(function () { toast("Đăng nhập thành công"); }).catch(function (err) { go.disabled = false; go.textContent = "Đăng nhập / Tạo tài khoản"; toast(err && err.msg ? err.msg : "Không đăng nhập được, thử lại"); });
      }
      go.addEventListener("click", doLogin);
      pw.addEventListener("keydown", function (ev) { if (ev.key === "Enter") doLogin(); });
      row.appendChild(ef); row.appendChild(pf); row.appendChild(go);
      row.appendChild(el("p", "note", "Lần đầu: nhập email + mật khẩu tự chọn để tạo tài khoản. Lần sau mở app tự đăng nhập. Dùng cùng email+mật khẩu trên máy khác để đồng bộ."));
    }
  }
  function updateSyncBadge() { var b = $("syncBadge"); b.className = "sync-badge"; var txt = b.querySelector(".txt"); if (!Store.loaded) { txt.textContent = "Đang tải…"; return; } if (Store.mode === "cloud") { b.classList.add("on"); txt.textContent = "Đồng bộ theo tài khoản — tự cập nhật giữa các máy"; } else if (cloudConfigured()) { b.classList.add("local"); txt.textContent = "Lưu trên máy này — đăng nhập để đồng bộ"; } else { b.classList.add("local"); txt.textContent = "Lưu trên máy này"; } }
  function stats() { var total = 0, value = 0; Store.list().forEach(function (it) { total += it.qty; value += it.qty * (Number(it.price) || 0) * condFactor(it.condition); }); return { unique: Store.list().length, total: total, value: value }; }
  function renderCollection() {
    updateSyncBadge(); renderAuthRow();
    var st = stats(); $("s-unique").textContent = st.unique; $("s-total").textContent = st.total; $("s-value").textContent = money(st.value);
    $("valueNote").textContent = "Giá ước tính = giá thị trường (bản NM) × hệ số tình trạng (NM 1.00 · LP 0.85 · MP 0.70 · HP 0.55 · DMG 0.40). Chỉ để tham khảo.";
    var filter = ($("colFilter").value || "").trim().toLowerCase(); var body = $("collectionBody"); body.innerHTML = "";
    var all = Store.list().sort(function (a, b) { return a.name.localeCompare(b.name) || a.setCode.localeCompare(b.setCode); });
    if (!Store.loaded) { body.appendChild(el("p", "hint center", "Đang tải bộ sưu tập…")); return; }
    if (!all.length) { body.appendChild(hintCenter("Bộ sưu tập trống. Vào tab Tra cứu, mở một thẻ và bấm + ở bản bạn sở hữu.")); return; }
    var items = all.filter(function (it) { return !filter || (it.name + " " + it.setCode + " " + it.rarity + " " + it.condition + " " + it.lang).toLowerCase().indexOf(filter) >= 0; });
    if (!items.length) { body.appendChild(hintCenter("Không có lá nào khớp bộ lọc.")); return; }
    var wrap = el("div", "results");
    items.forEach(function (it) {
      var row = el("div", "col-item"); var img = el("img"); img.loading = "lazy"; img.alt = it.name; img.src = IMG + it.cardId + ".jpg"; img.onerror = function () { this.style.visibility = "hidden"; };
      var main = el("button", "ci-main"); main.title = "Sửa"; main.appendChild(el("div", "ci-nm", it.name));
      var sub = el("div", "ci-sub"); if (it.setCode) sub.appendChild(el("span", "ci-code mono", it.setCode)); if (it.rarity) sub.appendChild(rarChip(it.rarity)); sub.appendChild(condChip(it.condition)); sub.appendChild(langChip(it.lang));
      var unit = (Number(it.price) || 0) * condFactor(it.condition); if (unit > 0) sub.appendChild(el("span", "ci-code tnum", money(unit)));
      main.appendChild(sub); main.addEventListener("click", function () { openEditSheet(it); });
      var right = el("div", "ci-right");
      var minus = el("button", "qty-btn", "−"); minus.setAttribute("aria-label", "Giảm"); var qty = el("span", "qty tnum", String(it.qty)); var plus = el("button", "qty-btn", "+"); plus.setAttribute("aria-label", "Tăng");
      minus.addEventListener("click", function () { Store.setQty(it.key, it.qty - 1); }); plus.addEventListener("click", function () { Store.setQty(it.key, it.qty + 1); });
      var del = el("button", "del-btn"); del.setAttribute("aria-label", "Xóa"); del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>'; del.addEventListener("click", function () { Store.remove(it.key); });
      right.appendChild(minus); right.appendChild(qty); right.appendChild(plus); right.appendChild(del);
      row.appendChild(img); row.appendChild(main); row.appendChild(right); wrap.appendChild(row);
    });
    body.appendChild(wrap);
  }
  $("colFilter").addEventListener("input", renderCollection);
  $("exportBtn").addEventListener("click", function () {
    var list = Store.list(); if (!list.length) { toast("Chưa có gì để xuất"); return; }
    var rows = [["Ten the", "Ma bo", "Bo", "Rarity", "Tinh trang", "Ngon ngu", "So luong", "Gia NM (USD)", "He so", "Gia uoc tinh/la", "Thanh tien"]];
    list.forEach(function (it) { var f = condFactor(it.condition), u = (it.price || 0) * f; rows.push([it.name, it.setCode, it.setName, it.rarity, it.condition, it.lang, it.qty, (it.price || 0).toFixed(2), f.toFixed(2), u.toFixed(2), (u * it.qty).toFixed(2)]); });
    showCsv(rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n"));
  });
  function csvCell(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function showCsv(csv) {
    var body = $("collectionBody"); var box = el("div"); box.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-bottom:14px";
    var ta = el("textarea", "csv"); ta.value = csv; ta.readOnly = true; var btns = el("div"); btns.style.cssText = "display:flex;gap:8px";
    var copy = el("button", "btn sm", "Sao chép"); var close = el("button", "btn ghost sm", "Đóng");
    copy.addEventListener("click", function () { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(csv).then(function () { toast("Đã sao chép CSV"); }).catch(function () { ta.select(); }); else { ta.select(); } });
    close.addEventListener("click", renderCollection); btns.appendChild(copy); btns.appendChild(close);
    box.appendChild(el("div", "sec-title", "CSV bộ sưu tập — dán vào Excel / Google Sheets")); box.appendChild(ta); box.appendChild(btns);
    body.insertBefore(box, body.firstChild); ta.focus();
  }

  // ============ SCAN (OCR eng + jpn) ============
  var tessPromise = null;
  function ensureTesseract() { if (!tessPromise) tessPromise = loadScript(TESS_CDN).then(function () { return window.Tesseract; }); return tessPromise; }
  function recognize(dataUrl, lang) { return ensureTesseract().then(function (T) { if (!T) throw 0; return T.recognize(dataUrl, lang); }); }
  $("shotBtn").addEventListener("click", function () { $("camInput").click(); });
  $("pickBtn").addEventListener("click", function () { $("fileInput").click(); });
  $("camInput").addEventListener("change", function () { handleImage(this.files && this.files[0]); this.value = ""; });
  $("fileInput").addEventListener("change", function () { handleImage(this.files && this.files[0]); this.value = ""; });
  function setScanStatus(m, err) { var s = $("scanStatus"); s.textContent = m || ""; s.className = "scan-status" + (err ? " err" : ""); }
  // Cắt + tiền xử lý (xám hóa + kéo giãn tương phản) để OCR rõ hơn, nhất là số nhỏ
  function prep(imgEl, box, scale) {
    var W = imgEl.naturalWidth, H = imgEl.naturalHeight;
    var sx = W * box[0], sy = H * box[1], sw = W * (box[2] - box[0]), sh = H * (box[3] - box[1]);
    scale = scale || Math.min(3, 1400 / Math.max(1, sw));
    var cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(sw * scale)); cv.height = Math.max(1, Math.round(sh * scale));
    var ctx = cv.getContext("2d"); ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    try {
      var im = ctx.getImageData(0, 0, cv.width, cv.height), d = im.data, min = 255, max = 0, i, g;
      for (i = 0; i < d.length; i += 4) { g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; d[i] = d[i + 1] = d[i + 2] = g; if (g < min) min = g; if (g > max) max = g; }
      var rng = Math.max(1, max - min);
      for (i = 0; i < d.length; i += 4) { var v = (d[i] - min) / rng * 255; d[i] = d[i + 1] = d[i + 2] = v; }
      ctx.putImageData(im, 0, 0);
    } catch (e) {}
    return cv.toDataURL("image/png");
  }
  function parsePass(txt) { var s = (txt || "").replace(/[^0-9]/g, ""); var m = s.match(/\d{8}/); return m ? m[0] : ""; }
  function handleImage(file) {
    if (!file) return; var url = URL.createObjectURL(file); var pv = $("scanPreview"); pv.src = url; pv.hidden = false; $("ocrBox").hidden = true;
    setScanStatus("⏳ Đang đọc mã bộ / tên từ ảnh…");
    var probe = new Image(); probe.onload = function () { runOCR(probe); }; probe.onerror = function () { manualFallback("Không mở được ảnh. Gõ tên/mã bạn thấy:"); }; probe.src = url;
  }
  function parseCode(txt) {
    var t = (txt || "").toUpperCase().replace(/[^A-Z0-9\- ]/g, " ").replace(/\s+/g, " ").trim();
    // tiền tố (2-5) + gạch HOẶC khoảng trắng + hậu tố (vùng + số); chuẩn hóa về dạng có gạch
    var m = t.match(/([A-Z0-9]{2,5})[-\s]([A-Z]{1,3}\d{1,3})/) || t.match(/([A-Z0-9]{2,5})[-\s](\d{1,4})/);
    return m ? (m[1] + "-" + m[2]) : "";
  }
  function clean(t) { return (t || "").replace(/[^A-Za-z0-9 '\-.,:!?&/]/g, " ").replace(/\s+/g, " ").trim(); }
  function cleanJP(t) { return (t || "").replace(/[\s]/g, "").replace(/[^぀-ヿ㐀-䶿一-鿿ｦ-ﾟA-Za-z0-9]/g, ""); }
  // Quy trình nhận diện ảnh:
  //  1) Số nhận dạng 8 chữ số (góc trái dưới) -> id (giống nhau mọi ngôn ngữ) — ƯU TIÊN.
  //  2) Mã bộ (góc phải dưới) -> đúng bản in.
  //  3) Tên thẻ (trên cùng, Anh/Nhật) -> tra mờ.
  function runOCR(imgEl) {
    setScanStatus("⏳ Đang đọc số nhận dạng trên thẻ…");
    var passCrop = prep(imgEl, [0.02, 0.895, 0.46, 0.998], 3);   // 8 số góc trái dưới
    var codeCrop = prep(imgEl, [0.50, 0.885, 1.0, 0.995], 2.6);  // mã bộ góc phải dưới
    Promise.all([
      recognize(passCrop, "eng").then(function (r) { return parsePass(r && r.data && r.data.text); }).catch(function () { return ""; }),
      recognize(codeCrop, "eng").then(function (r) { return parseCode(r && r.data && r.data.text); }).catch(function () { return ""; })
    ]).then(function (res) {
      var pass = res[0], code = res[1];
      if (pass) {
        setScanStatus("⏳ Đã đọc số " + pass + ", đang tra…");
        cardById(pass).then(function (card) {
          if (card) {
            setScanStatus("✓ Nhận diện: " + card.name + (code ? " · " + code : ""));
            $("ocrText").value = card.name; $("ocrBox").hidden = false;
            currentResults = []; setMode("name"); showTab("p-search");
            renderDetail(card, null, code ? { codeView: code } : null);   // có mã -> hiện các foil của mã đó; không có -> danh sách đầy đủ
            return;
          }
          if (code) { fallbackCode(code); return; }
          nameOCR(imgEl);
        });
        return;
      }
      if (code) { fallbackCode(code); return; }
      nameOCR(imgEl);
    }).catch(function () { manualFallback("Không tải được bộ nhận dạng (cần mạng lần đầu). Gõ tên/mã bạn thấy:"); });
  }
  function fallbackCode(code) { setScanStatus("✓ Đọc được mã: " + code); $("ocrText").value = code; $("ocrBox").hidden = false; runScan("code", code); }
  var lastScanRaw = "";   // tên thô OCR vừa đọc, để học khi bạn sửa lại
  function applyOcrName(x) { lastScanRaw = x; var f = Learn.ocrFixGet(x); return f || x; }  // áp dụng sửa lỗi đã học
  function nameOCR(imgEl) {
    setScanStatus("⏳ Không rõ số/mã — đang đọc tên (tải bộ tiếng Nhật lần đầu)…");
    var nameCrop = prep(imgEl, [0.04, 0.03, 0.82, 0.135], 2.2);
    recognize(nameCrop, "jpn+eng").then(function (r2) {
      var raw = r2 && r2.data && r2.data.text || "";
      if (hasJapanese(raw)) { var jp = cleanJP(raw); if (jp.length >= 2) { var fx = applyOcrName(jp); setScanStatus("✓ Đọc được (Nhật): " + fx); $("ocrText").value = fx; $("ocrBox").hidden = false; runScan("name", fx); return; } }
      var en = clean(raw); if (en.length >= 3) { var fe = applyOcrName(en); setScanStatus("✓ Đọc được: " + fe); $("ocrText").value = fe; $("ocrBox").hidden = false; runScan("name", fe); return; }
      manualFallback("Đọc chưa rõ. Gõ tên (Anh/Nhật) hoặc mã bộ rồi bấm Tra cứu:");
    }).catch(function () { manualFallback("Không đọc được. Gõ tên hoặc mã bạn thấy:"); });
  }
  function manualFallback(msg) { setScanStatus(msg, true); $("ocrText").value = ""; $("ocrBox").hidden = false; $("ocrText").focus(); }
  function runScan(m, value) { setMode(m); $("q").value = value; showTab("p-search"); doSearch(value); }
  $("ocrSearch").addEventListener("click", function () { var v = $("ocrText").value.trim(); if (v.length < 2) { toast("Nhập tên/mã thẻ"); return; } var isCode = /^[A-Za-z0-9]{2,5}-[A-Za-z]{0,3}\d{1,3}$/.test(v); if (!isCode && lastScanRaw && v !== lastScanRaw) { Learn.ocrFixSet(lastScanRaw, v); lastScanRaw = v; toast("Đã ghi nhớ sửa tên này cho lần sau"); } runScan(isCode ? "code" : "name", v); });
  $("ocrText").addEventListener("keydown", function (e) { if (e.key === "Enter") $("ocrSearch").click(); });

  // ============ INIT ============
  $("foilGuideBtn").addEventListener("click", openFoilGuide);
  $("settingsBtn").addEventListener("click", openSettings);
  Store.onChange(function () { if (!$("p-collection").hidden) renderCollection(); updateSyncBadge(); });
  Store.init();
  // Khôi phục đúng tab + nội dung tra cứu khi refresh (không nhảy về trang đầu)
  (function restoreView() {
    var tab = "p-search";
    try { var t = localStorage.getItem("ygo_tab"); if (["p-search", "p-collection", "p-scan"].indexOf(t) >= 0) tab = t; } catch (e) {}
    var lq = null; try { lq = JSON.parse(localStorage.getItem("ygo_lastq") || "null"); } catch (e) {}
    if (lq && lq.q) { setMode(lq.mode === "code" ? "code" : "name"); $("q").value = lq.q; }
    showTab(tab);
    if (tab === "p-search" && lq && lq.q) doSearch(lq.q);
  })();
  if ("serviceWorker" in navigator) { window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); }); }
})();
