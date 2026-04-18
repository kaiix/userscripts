// ==UserScript==
// @name         X/Twitter Timeline Position Saver
// @namespace    http://tampermonkey.net/
// @version      4.5
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

  let jumping = false;
  let dismissed = false;
  let bar = null;
  let scrollTimer = null;
  let antiSlipTimer = null;
  let coldStartTimer = null;
  let prevKey = null;

  let isReadingActive = false;
  let lastCommittedId = null;
  let pendingId = null;

  const idToIndex = new Map();
  let maxIdx = 0;

  function getActiveTabKey() {
    const path = window.location.pathname;
    const directMatch = path.match(/^\/i\/lists\/(\d+)/);
    if (directMatch) return "list_" + directMatch[1];
    if (path === "/home" || path === "/") {
      const t = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
      if (t) {
        const text = t.innerText.trim();
        if (text === "For you" || text === "Following") return null;
        const href = t.getAttribute("href") || t.closest("a")?.getAttribute("href") || "";
        const listMatch = href.match(/\/i\/lists\/(\d+)/);
        return listMatch ? "list_" + listMatch[1] : "text_" + text.replace(/\s+/g, "_");
      }
    }
    return null;
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
  
  function persist(id) { 
    const k = getActiveTabKey();
    if (k) {
      localStorage.setItem(PREFIX + k, id);
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
    scanTimeline();
    const tid = topId();
    if (!tid) return;
    const idx = idToIndex.get(tid);
    lbl.textContent = idx ? `#${idx}` : "";
  }

  function onScroll() {
    if (jumping || !getActiveTabKey()) return;
    
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const tid = topId();
      if (!tid) return;

      if (!isReadingActive) {
        clearTimeout(coldStartTimer);
        coldStartTimer = setTimeout(() => {
          isReadingActive = true;
          persist(tid);
          flash("Session Active", "#1d9bf0");
        }, COLD_START_WAIT);
      } else {
        if (tid !== lastCommittedId && tid !== pendingId) {
          pendingId = tid;
          updateReturnButton(true);
          
          clearTimeout(antiSlipTimer);
          antiSlipTimer = setTimeout(() => {
            persist(pendingId);
            pendingId = null;
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
    const allLinks = document.querySelectorAll(`a[href*="/status/${targetId}"]`);
    const targetLink = Array.from(allLinks).find(l => !l.closest('div[role="link"][tabindex="0"]'));
    return targetLink?.closest("article");
  }

  async function returnToLast() {
    if (!lastCommittedId) return;
    clearTimeout(antiSlipTimer);
    pendingId = null;

    const article = findArticle(lastCommittedId);
    if (article) {
      article.scrollIntoView({ behavior: "auto", block: "center" });
      highlight(article);
      updateReturnButton(false);
    } else {
      // Fast jump logic: determine direction and jump aggressively
      await performJump(lastCommittedId, true); 
      updateReturnButton(false);
    }
  }

  function highlight(article) {
    if (!article) return;
    article.style.transition = "background-color 0.4s ease";
    article.style.backgroundColor = "rgba(224, 36, 94, 0.25)";
    setTimeout(() => (article.style.backgroundColor = ""), 2500);
  }

  async function performJump(target, isFast = false) {
    jumping = true;
    const k = getActiveTabKey();
    const jumpBtn = document.getElementById("x-pos-jump");
    const originalText = jumpBtn?.textContent;
    if (jumpBtn) jumpBtn.textContent = "Searching...";

    let found = false;
    const currentTid = topId();
    // Determine direction if possible
    let direction = 1; // Default down
    if (currentTid && BigInt(target) > BigInt(currentTid)) {
      direction = -1; // Target is newer, go up
    }

    const step = isFast ? window.innerHeight * 4 : window.innerHeight * 2;
    const delay = isFast ? 100 : 600;
    const maxTries = isFast ? 40 : 60;

    for (let i = 0; i < maxTries; i++) {
      if (getActiveTabKey() !== k) break;
      const article = findArticle(target);

      if (article) {
        article.scrollIntoView({ behavior: isFast ? "auto" : "smooth", block: "center" });
        highlight(article);
        found = true;
        break;
      }
      window.scrollBy({ top: step * direction, behavior: isFast ? "auto" : "smooth" });
      await new Promise(r => setTimeout(r, delay));
    }

    if (jumpBtn) jumpBtn.textContent = found ? "✓ Found" : "↓ Jump";
    setTimeout(() => {
      if (jumpBtn) jumpBtn.textContent = originalText;
      jumping = false;
      refreshLabel();
    }, 1500);
    return found;
  }

  async function jump() {
    const target = saved();
    if (!target) return;
    const success = await performJump(target, false); // Normal jump uses smooth sweep
    if (success) {
      isReadingActive = true;
      lastCommittedId = target;
      flash("Reading Active", "#1d9bf0");
    }
  }

  function manualSave() {
    const id = topId();
    if (!id) return;
    persist(id);
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
    if (bar) return;
    bar = document.createElement("div");
    bar.id = "x-pos-bar";
    Object.assign(bar.style, {
      position: "fixed", bottom: "20px", right: "20px", display: "flex", alignItems: "center",
      gap: "8px", background: "rgba(0,0,0,0.85)", color: "#fff", padding: "8px 12px",
      borderRadius: "14px", fontFamily: 'sans-serif', fontSize: "13px", zIndex: "9999",
      boxShadow: "0 4px 12px rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)"
    });
    const lbl = document.createElement("span"); lbl.id = "x-pos-lbl";
    const jumpBtn = makePill("↓ Jump", "rgba(29,155,240,0.9)", jump);
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

    if (k !== prevKey) { 
      dismissed = false; 
      lastCommittedId = saved(); 
      prevKey = k;
      idToIndex.clear();
      maxIdx = 0;
      isReadingActive = false; 
      clearTimeout(coldStartTimer);
      clearTimeout(antiSlipTimer);
    }
    
    if (!dismissed) {
      build();
      refreshLabel();
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  setInterval(check, 1000);
  document.addEventListener("click", (e) => {
    if (e.target.closest('[role="tab"]')) setTimeout(check, 100);
  });
  setTimeout(check, 500);
})();
