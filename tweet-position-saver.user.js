// ==UserScript==
// @name         X/Twitter Timeline Position Saver
// @namespace    http://tampermonkey.net/
// @version      4.3
// @description  Durable position tracking for X Lists & Pinned Tabs
// @author       You
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const PREFIX = "x_pos_tab_";
  let jumping = false;
  let dismissed = false;
  let anchorId = null;
  let bar = null;
  let scrollTimer = null;
  let scanTimer = null;
  let prevKey = null;

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
    if (k) localStorage.setItem(PREFIX + k, id); 
  }

  function scanVisible() {
    if (jumping) return;
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
    scanVisible();
    const tid = topId();
    if (!tid) return;
    const idx = idToIndex.get(tid);
    if (idx) lbl.textContent = `#${idx}`;
  }

  function onScroll() {
    if (jumping || !getActiveTabKey()) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (window.scrollY < 10) {
        idToIndex.clear();
        maxIdx = 0;
      }
      const id = topId();
      if (id) {
        const last = saved();
        if (!last || BigInt(id) <= BigInt(last)) {
          persist(id);
        }
      }
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
    }, 1500);
  }

  async function performJump(target) {
    jumping = true;
    const k = getActiveTabKey();
    const jumpBtn = document.getElementById("x-pos-jump");
    if (jumpBtn) jumpBtn.textContent = "Scanning...";

    let found = false;
    for (let i = 0; i < 60; i++) {
      if (getActiveTabKey() !== k) break;
      const allLinks = document.querySelectorAll(`a[href*="/status/${target}"]`);
      let targetLink = Array.from(allLinks).find(l => !l.closest('div[role="link"][tabindex="0"]'));

      if (targetLink) {
        const article = targetLink.closest("article");
        article?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (article) {
          article.style.transition = "background-color 0.4s ease";
          article.style.backgroundColor = "rgba(29, 155, 240, 0.25)";
          setTimeout(() => (article.style.backgroundColor = ""), 2500);
        }
        found = true;
        break;
      }
      window.scrollBy({ top: window.innerHeight * 2, behavior: "smooth" });
      await new Promise(r => setTimeout(r, 600));
    }

    if (jumpBtn) jumpBtn.textContent = found ? "✓ Found" : "↓ Jump";
    setTimeout(() => {
      if (jumpBtn) jumpBtn.textContent = "↓ Jump";
      jumping = false;
      refreshLabel();
    }, 1500);
  }

  async function jump() {
    const target = saved();
    if (target) await performJump(target);
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
    const closeBtn = document.createElement("span"); 
    closeBtn.textContent = "✕";
    closeBtn.style.cursor = "pointer";
    closeBtn.onclick = () => { dismissed = true; bar.remove(); bar = null; };
    bar.append(lbl, jumpBtn, saveBtn, closeBtn);
    document.body.appendChild(bar);
  }

  function makePill(text, bg, fn) {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, { background: bg, color: "#fff", border: "none", padding: "5px 12px", borderRadius: "9999px", cursor: "pointer", fontWeight: "bold" });
    b.onclick = fn;
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
      anchorId = null; 
      prevKey = k;
      idToIndex.clear();
      maxIdx = 0;
    }
    
    if (!dismissed) {
      build();
      refreshLabel();
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  setInterval(() => { if (getActiveTabKey()) scanVisible(); }, 800);
  setInterval(check, 1000);
  document.addEventListener("click", (e) => {
    if (e.target.closest('[role="tab"]')) setTimeout(check, 100);
  });
  setTimeout(check, 500);
})();
