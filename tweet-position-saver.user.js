// ==UserScript==
// @name         X/Twitter Timeline Position Saver
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Remember where you stopped reading. Shows new tweet count with one-click jump back.
// @author       You
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // --- Config ---
  const SWEEP_SCREENS = 3.0;
  const SWEEP_DELAY = 500;
  const PREFIX = "x_pos_";
  const MAX_SCAN = 2000;
  const SCAN_MS = 800;

  // --- State ---
  let jumping = false;
  let dismissed = false;
  let anchorId = null; // snapshot of saved position for jump & auto-save boundary
  let bar = null;
  let scanTimer = null;
  let scrollTimer = null;
  let prevKey = null;
  const allSeen = new Set(); // all tweet IDs observed this session

  // =========================
  //  Helpers
  // =========================

  function key() {
    let k = location.pathname;
    if (k === "/home") {
      const t = document.querySelector(
        '[role="tablist"] [role="tab"][aria-selected="true"]',
      );
      if (t) {
        // Pinned lists have href like /i/lists/{id} — use list ID for
        // a stable key that survives list renames and locale changes.
        const href =
          t.getAttribute("href") || t.closest("a")?.getAttribute("href") || "";
        const listMatch = href.match(/\/i\/lists\/(\d+)/);
        if (listMatch) {
          k += "_list_" + listMatch[1];
        } else {
          k += "_" + t.textContent.trim().replace(/\s+/g, "_");
        }
      }
    }
    return k;
  }

  function idOf(article) {
    return article
      .querySelector('a[href*="/status/"]')
      ?.href.match(/\/status\/(\d+)/)?.[1];
  }

  function topId() {
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const r = a.getBoundingClientRect();
      if (r.top >= 80 || r.bottom > 130) {
        const id = idOf(a);
        if (id) return id;
      }
    }
    return null;
  }

  function saved() {
    return localStorage.getItem(PREFIX + key());
  }

  function persist(id) {
    localStorage.setItem(PREFIX + key(), id);
  }

  // =========================
  //  Position tracking
  // =========================

  function scanVisible() {
    for (const el of document.querySelectorAll(
      'article[data-testid="tweet"]',
    )) {
      const id = idOf(el);
      if (id) allSeen.add(id);
    }
  }

  function startScan() {
    stopScan();
    scanTimer = setInterval(() => {
      if (!jumping) {
        scanVisible();
        refreshLabel();
      }
    }, SCAN_MS);
  }

  function stopScan() {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
  }

  // =========================
  //  Save logic
  // =========================

  function onScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (jumping) return;
      const id = topId();
      if (id) {
        // Auto-save only when scrolling past/below the anchor
        // (reading older content), or on a fresh timeline (no
        // anchor yet). This preserves the unread boundary —
        // reading new tweets above the anchor won't overwrite it.
        try {
          if (!anchorId || BigInt(id) <= BigInt(anchorId)) {
            persist(id);
          }
        } catch {
          persist(id);
        }
      }
      scanVisible();
      refreshLabel();
    }, 400);
  }

  function manualSave() {
    const id = topId();
    if (!id) return;
    persist(id);
    anchorId = id;
    refreshLabel();
    flash("✓ Saved");
  }

  // =========================
  //  Jump
  // =========================

  async function jump() {
    const k = key();
    const target = anchorId; // use stable anchor, not live saved()
    if (!target || jumping) return;

    jumping = true;
    const visited = new Set();
    let found = false;

    setLabel("Searching…", "#f5a623");
    setJumpEnabled(false);

    while (visited.size < MAX_SCAN) {
      if (key() !== k) break;

      const link = document.querySelector(`a[href*="/status/${target}"]`);
      if (link) {
        const article = link.closest("article");
        if (article) {
          article.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
          article.style.transition = "background-color 0.4s ease";
          article.style.backgroundColor = "rgba(29, 155, 240, 0.25)";
          setTimeout(() => (article.style.backgroundColor = ""), 2500);
          found = true;
          break;
        }
      }

      for (const el of document.querySelectorAll(
        'article[data-testid="tweet"]',
      )) {
        const id = idOf(el);
        if (id) {
          visited.add(id);
          allSeen.add(id);
        }
      }

      setLabel(`Scanning… ${visited.size}`, "#f5a623");
      if (visited.size >= MAX_SCAN) break;

      window.scrollBy({
        top: innerHeight * SWEEP_SCREENS,
        behavior: "smooth",
      });
      await new Promise((r) => setTimeout(r, SWEEP_DELAY));
    }

    setJumpEnabled(true);

    if (found) {
      flash("✓ Found!");
      anchorId = target; // reset anchor to where we jumped
      // allSeen keeps accumulating for position tracking
      setTimeout(() => {
        jumping = false;
        refreshLabel();
      }, 1500);
    } else {
      setLabel("✗ Not found", "#e0245e");
      localStorage.removeItem(PREFIX + k);
      setTimeout(() => {
        jumping = false;
        check();
      }, 2500);
    }
  }

  // =========================
  //  UI
  // =========================

  function build() {
    if (bar) return;

    bar = document.createElement("div");
    bar.id = "x-pos-bar";
    Object.assign(bar.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      background: "rgba(0,0,0,0.85)",
      color: "#fff",
      padding: "8px 12px",
      borderRadius: "14px",
      fontFamily:
        '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
      fontSize: "13px",
      fontWeight: "500",
      boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
      backdropFilter: "blur(16px)",
      border: "1px solid rgba(255,255,255,0.08)",
      zIndex: "9999",
      transition: "opacity 0.3s",
    });

    const lbl = document.createElement("span");
    lbl.id = "x-pos-lbl";
    lbl.style.marginRight = "2px";

    const jumpBtn = makePill("↓ Jump", "rgba(29,155,240,0.9)", jump);
    jumpBtn.id = "x-pos-jump";

    const saveBtn = makePill("📌 Save", "rgba(255,255,255,0.13)", manualSave);

    const closeBtn = document.createElement("span");
    closeBtn.textContent = "✕";
    Object.assign(closeBtn.style, {
      cursor: "pointer",
      color: "rgba(255,255,255,0.45)",
      fontSize: "13px",
      padding: "2px 4px",
      marginLeft: "2px",
      transition: "color 0.15s",
    });
    closeBtn.onmouseenter = () => (closeBtn.style.color = "#fff");
    closeBtn.onmouseleave = () =>
      (closeBtn.style.color = "rgba(255,255,255,0.45)");
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      dismissed = true;
      teardown();
    };

    bar.append(lbl, jumpBtn, saveBtn, closeBtn);
    document.body.appendChild(bar);
    startScan();
  }

  function makePill(text, bg, fn) {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, {
      background: bg,
      color: "#fff",
      border: "none",
      padding: "5px 12px",
      borderRadius: "9999px",
      fontSize: "12px",
      fontWeight: "600",
      cursor: "pointer",
      transition: "filter 0.15s, transform 0.15s",
      whiteSpace: "nowrap",
    });
    b.onmouseenter = () => {
      b.style.filter = "brightness(1.25)";
      b.style.transform = "scale(1.06)";
    };
    b.onmouseleave = () => {
      b.style.filter = "";
      b.style.transform = "";
    };
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    return b;
  }

  function refreshLabel() {
    const lbl = document.getElementById("x-pos-lbl");
    if (!lbl) return;
    if (!saved()) {
      teardown();
      return;
    }
    const n = allSeen.size;
    lbl.textContent = n > 0 ? `#${n}` : "";
    lbl.style.color = "";
  }

  function setLabel(text, color) {
    const lbl = document.getElementById("x-pos-lbl");
    if (lbl) {
      lbl.textContent = text;
      lbl.style.color = color || "";
    }
  }

  function flash(msg, color) {
    setLabel(msg, color || "#17bf63");
    setTimeout(refreshLabel, 1800);
  }

  function setJumpEnabled(yes) {
    const btn = document.getElementById("x-pos-jump");
    if (btn) {
      btn.disabled = !yes;
      btn.style.opacity = yes ? "1" : "0.5";
      btn.style.cursor = yes ? "pointer" : "wait";
    }
  }

  function teardown() {
    stopScan();
    bar?.remove();
    bar = null;
  }

  function check() {
    const k = key();
    if (k !== prevKey) {
      dismissed = false;
      allSeen.clear();
      anchorId = saved(); // snapshot for jump & auto-save boundary
      prevKey = k;
    }
    if (saved() && !dismissed) {
      build();
      scanVisible();
      refreshLabel();
    } else {
      teardown();
    }
  }

  // =========================
  //  Events
  // =========================

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("popstate", () => setTimeout(check, 400));
  addEventListener("load", () => setTimeout(check, 800));

  document.addEventListener("click", (e) => {
    if (e.target.closest('[role="tab"], a[href^="/"]')) {
      setTimeout(check, 500);
    }
  });
})();
