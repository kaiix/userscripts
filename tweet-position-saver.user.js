// ==UserScript==
// @name         X/Twitter Timeline Position Saver
// @namespace    http://tampermonkey.net/
// @version      4.8
// @description  Fast jump and anti-slip position tracking
// @author       You
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const PREFIX = "x_pos_tab_";
  const SLIP_DELAY = 10000;
  const COLD_START_WAIT = 30 * 60 * 1000;
  const JUMP_BATCH_SIZE = 2000;
  const JUMP_STALL_WAIT = 15000;

  let jumping = false;
  let jumpStatus = "↓ Jump";
  let jumpSearch = null;
  let autoSavePaused = false;
  let dismissed = false;
  let bar = null;
  let scrollTimer = null;
  let antiSlipTimer = null;
  let coldStartTimer = null;
  let session = { path: null, key: null, tabText: null };

  let isReadingActive = false;
  let lastCommittedId = null;
  let pendingId = null;

  const idToIndex = new Map();
  let maxIdx = 0;

  function getActiveTabKey() {
    const path = window.location.pathname;
    const directMatch = path.match(/^\/i\/lists\/(\d+)/);
    let key = null;
    let tabText = null;
    if (directMatch) {
      key = "list_" + directMatch[1];
    } else if (path === "/home" || path === "/") {
      const t = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
      // X can unmount the tab strip while scrolling. Missing DOM is not a tab switch.
      if (!t && path === session.path) return session.key;
      if (t) {
        tabText = t.innerText.trim();
        if (!tabText && path === session.path) return session.key;
        if (tabText && tabText !== "For you" && tabText !== "Following") {
          const href = t.getAttribute("href") || t.closest("a")?.getAttribute("href") || "";
          const listMatch = href.match(/\/i\/lists\/(\d+)/);
          key = listMatch ? "list_" + listMatch[1] : "text_" + tabText.replace(/\s+/g, "_");
          // Keep the same storage key if a re-render adds or removes the tab's href.
          if (path === session.path && tabText === session.tabText &&
              (!listMatch || session.key?.startsWith("text_"))) {
            key = session.key;
          }
        }
      }
    }

    if (path !== session.path || key !== session.key) {
      session = { path, key, tabText };
      clearTrackingTimers();
      jumping = false;
      jumpStatus = "↓ Jump";
      jumpSearch = null;
      autoSavePaused = false;
      dismissed = false;
      isReadingActive = false;
      lastCommittedId = key ? localStorage.getItem(PREFIX + key) : null;
      idToIndex.clear();
      maxIdx = 0;
      if (bar) { bar.remove(); bar = null; }
    } else {
      session.tabText = tabText;
    }
    return key;
  }

  function isCurrentSession(expected) {
    return getActiveTabKey() !== null && session === expected;
  }

  function clearTrackingTimers() {
    clearTimeout(scrollTimer);
    clearTimeout(coldStartTimer);
    clearTimeout(antiSlipTimer);
    pendingId = null;
    updateReturnButton(false);
  }

  function idOf(article) {
    const links = Array.from(article.querySelectorAll('a[href*="/status/"]'));
    for (const link of links) {
      if (link.closest('div[role="link"][tabindex="0"]')) continue;
      const match = link.href.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  function topId() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const a of articles) {
      if (a.offsetHeight === 0) continue;
      const r = a.getBoundingClientRect();
      if (r.top >= 80 || r.bottom > 130) return idOf(a);
    }
    return null;
  }

  function saved() { 
    const k = getActiveTabKey();
    return k ? localStorage.getItem(PREFIX + k) : null; 
  }
  
  function persist(id, expected = session) {
    if (id && isCurrentSession(expected)) {
      localStorage.setItem(PREFIX + expected.key, id);
      lastCommittedId = id;
      updateReturnButton(false);
    }
  }

  function scanTimeline() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const a of articles) {
      if (a.offsetHeight === 0) continue;
      const id = idOf(a);
      if (id && !idToIndex.has(id)) {
        idToIndex.set(id, ++maxIdx);
      }
    }
  }

  function refreshLabel() {
    const lbl = document.getElementById("x-pos-lbl");
    if (!lbl) return;
    if (autoSavePaused && !jumping) {
      lbl.textContent = "Auto-save paused";
      return;
    }
    scanTimeline();
    const tid = topId();
    if (!tid) return;
    const idx = idToIndex.get(tid);
    lbl.textContent = idx ? `#${idx}` : "";
  }

  function onScroll() {
    if (!getActiveTabKey() || jumping || autoSavePaused) return;
    const expected = session;

    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!isCurrentSession(expected) || jumping || autoSavePaused) return;
      const tid = topId();
      if (!tid) return;

      if (!isReadingActive) {
        clearTimeout(coldStartTimer);
        coldStartTimer = setTimeout(() => {
          if (!isCurrentSession(expected) || jumping) return;
          isReadingActive = true;
          persist(tid, expected);
          flash("Session Active", "#1d9bf0");
        }, COLD_START_WAIT);
      } else {
        if (tid === lastCommittedId) {
          clearTimeout(antiSlipTimer);
          pendingId = null;
          updateReturnButton(false);
        } else if (tid !== pendingId) {
          pendingId = tid;
          updateReturnButton(true);
          
          clearTimeout(antiSlipTimer);
          antiSlipTimer = setTimeout(() => {
            if (!isCurrentSession(expected) || jumping) return;
            if (topId() === tid) persist(tid, expected);
            pendingId = null;
            updateReturnButton(false);
          }, SLIP_DELAY);
        }
      }
      refreshLabel();
    }, 400);
  }

  function updateReturnButton(show) {
    const btn = document.getElementById("x-pos-return");
    if (!btn) return;
    if (show && lastCommittedId) {
      btn.style.display = "inline-flex";
    } else {
      btn.style.display = "none";
    }
  }

  function findArticle(targetId) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    return Array.from(articles).find(a => a.offsetHeight !== 0 && idOf(a) === targetId);
  }

  function updateJumpButton(text) {
    jumpStatus = text;
    const btn = document.getElementById("x-pos-jump");
    if (btn) btn.textContent = text;
  }

  async function returnToLast() {
    if (!getActiveTabKey() || jumping || !lastCommittedId) return;
    clearTrackingTimers();

    const article = findArticle(lastCommittedId);
    if (article) {
      article.scrollIntoView({ behavior: "auto", block: "center" });
      highlight(article);
      updateReturnButton(false);
    } else {
      // Fast jump logic: determine direction and jump aggressively
      await performJump(lastCommittedId, true);
    }
  }

  function highlight(article) {
    if (!article) return;
    article.style.transition = "background-color 0.4s ease";
    article.style.backgroundColor = "rgba(224, 36, 94, 0.25)";
    setTimeout(() => (article.style.backgroundColor = ""), 2500);
  }

  async function performJump(target, isFast = false) {
    if (!getActiveTabKey() || jumping) return false;
    const expected = session;
    clearTrackingTimers();
    jumping = true;
    autoSavePaused = true;

    let search = jumpSearch;
    if (!search || search.target !== target) {
      const currentTid = topId();
      const direction = currentTid && BigInt(target) > BigInt(currentTid) ? -1 : 1;
      search = { target, direction, isFast, inspected: new Set(), limit: JUMP_BATCH_SIZE };
      jumpSearch = search;
    } else if (search.inspected.size >= search.limit) {
      // Continue adds one batch; retrying stalled loading keeps the existing budget.
      search.limit += JUMP_BATCH_SIZE;
    }

    let found = false;
    const { direction, inspected } = search;
    isFast = search.isFast;
    const step = isFast ? window.innerHeight * 4 : window.innerHeight * 2;
    const delay = isFast ? 100 : 600;
    let lastProgressAt = performance.now();
    let lastScrollY = window.scrollY;

    while (true) {
      if (!isCurrentSession(expected) || jumpSearch !== search) return false;
      const previousCount = inspected.size;
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (const article of articles) {
        if (article.offsetHeight === 0) continue;
        const id = idOf(article);
        if (!id) continue;
        inspected.add(id);
        // A target at the batch boundary still counts as a successful match.
        if (id === target) {
          article.scrollIntoView({ behavior: isFast ? "auto" : "smooth", block: "center" });
          highlight(article);
          found = true;
          break;
        }
        if (inspected.size >= search.limit) break;
      }

      updateJumpButton(`Searching… ${inspected.size}/${search.limit}`);
      if (found || inspected.size >= search.limit) break;

      const now = performance.now();
      const scrollY = window.scrollY;
      if (inspected.size > previousCount || Math.abs(scrollY - lastScrollY) > 1) {
        lastProgressAt = now;
      }
      lastScrollY = scrollY;
      // Slow loading does not consume the tweet budget, but a stuck page can stop.
      if (now - lastProgressAt >= JUMP_STALL_WAIT) break;

      window.scrollBy({ top: step * direction, behavior: isFast ? "auto" : "smooth" });
      await new Promise(r => setTimeout(r, delay));
    }

    if (!isCurrentSession(expected) || jumpSearch !== search) return false;
    if (found) autoSavePaused = false;
    updateJumpButton(found ? "✓ Found" : inspected.size >= search.limit
      ? `Not found (${inspected.size}) · Continue`
      : `Loading stalled (${inspected.size}) · Retry`);
    setTimeout(() => {
      if (!isCurrentSession(expected) || jumpSearch !== search) return;
      if (found) {
        jumpSearch = null;
        updateJumpButton("↓ Jump");
      }
      jumping = false;
      refreshLabel();
      // Capture reading movement that happened during the smooth-scroll cooldown.
      // Failed searches leave auto-save paused until a successful Jump or Save.
      onScroll();
    }, 1500);
    return found;
  }

  async function jump() {
    if (!getActiveTabKey() || jumping) return;
    const target = jumpSearch?.target || saved();
    if (!target) return;
    const expected = session;
    const success = await performJump(target, false); // Normal jump uses smooth sweep
    if (success && isCurrentSession(expected)) {
      isReadingActive = true;
      lastCommittedId = target;
      flash("Reading Active", "#1d9bf0");
    }
  }

  function manualSave() {
    if (!getActiveTabKey()) return;
    const id = topId();
    if (!id) return;
    clearTrackingTimers();
    persist(id);
    jumpSearch = null;
    jumping = false;
    autoSavePaused = false;
    updateJumpButton("↓ Jump");
    isReadingActive = true;
    flash("✓ Saved");
  }

  function flash(msg, color) {
    const lbl = document.getElementById("x-pos-lbl");
    if (!lbl) return;
    const old = lbl.textContent;
    lbl.textContent = msg;
    lbl.style.color = color || "#17bf63";
    setTimeout(() => {
      lbl.textContent = old;
      lbl.style.color = "";
      refreshLabel();
    }, 2000);
  }

  function build() {
    if (bar?.isConnected) return;
    bar = document.createElement("div");
    bar.id = "x-pos-bar";
    Object.assign(bar.style, {
      position: "fixed", bottom: "20px", right: "20px", display: "flex", alignItems: "center",
      gap: "8px", background: "rgba(0,0,0,0.85)", color: "#fff", padding: "8px 12px",
      borderRadius: "14px", fontFamily: 'sans-serif', fontSize: "13px", zIndex: "9999",
      boxShadow: "0 4px 12px rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)"
    });
    const lbl = document.createElement("span"); lbl.id = "x-pos-lbl";
    const jumpBtn = makePill(jumpStatus, "rgba(29,155,240,0.9)", jump);
    jumpBtn.id = "x-pos-jump";
    const saveBtn = makePill("📌 Save", "rgba(255,255,255,0.13)", manualSave);
    const returnBtn = makePill("↩ Back", "#e0245e", returnToLast);
    returnBtn.id = "x-pos-return";
    returnBtn.style.display = "none";
    const closeBtn = document.createElement("span"); 
    closeBtn.textContent = "✕";
    closeBtn.style.cursor = "pointer";
    closeBtn.onclick = () => { dismissed = true; bar.remove(); bar = null; };
    
    bar.append(lbl, jumpBtn, saveBtn, returnBtn, closeBtn);
    document.body.appendChild(bar);
    updateReturnButton(pendingId !== null);
  }

  function makePill(text, bg, fn) {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, { background: bg, color: "#fff", border: "none", padding: "5px 12px", borderRadius: "9999px", cursor: "pointer", fontWeight: "bold", display: "inline-flex", alignItems: "center" });
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  }

  function check() {
    const k = getActiveTabKey();
    if (!k) {
      if (bar) { bar.remove(); bar = null; }
      return;
    }

    if (!dismissed) {
      build();
      refreshLabel();
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  setInterval(check, 1000);
  document.addEventListener("click", (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab) return;
    if (tab.getAttribute("aria-selected") !== "true") {
      // A deliberate tab switch must not reuse the old key while the new tab loads.
      session = { path: null, key: null, tabText: null };
      clearTrackingTimers();
    }
    setTimeout(check, 100);
  });
  setTimeout(check, 500);
})();
