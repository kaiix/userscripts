// ==UserScript==
// @name        Gemini Extended Thinking
// @version     1.0.0
// @description Enable Extended thinking by default in new Gemini chats
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       https://gemini.google.com/app*
// @icon        https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant       none
// @run-at      document-idle
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/gemini-extended-thinking.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/gemini-extended-thinking.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const MODE_BUTTON_SELECTOR = '[data-test-id="bard-mode-menu-button"]';
  const MODE_ITEM_SELECTOR =
    'gem-menu-item, [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
  const EXTENDED_THINKING = "extended thinking";
  const MENU_TIMEOUT_MS = 3000;

  let configuredButton = null;
  let configuring = false;
  let lastPathname = location.pathname;
  let scheduled = false;

  function normalizeText(value) {
    return value?.replace(/\s+/g, " ").trim().toLowerCase() || "";
  }

  function findModeButton() {
    return (
      document.querySelector(MODE_BUTTON_SELECTOR) ||
      Array.from(document.querySelectorAll("button")).find((button) =>
        /open (mode|model) picker|switch model/i.test(
          button.getAttribute("aria-label") || ""
        )
      )
    );
  }

  function findExtendedThinkingItem() {
    return Array.from(document.querySelectorAll(MODE_ITEM_SELECTOR)).find(
      (item) =>
        item.getClientRects().length > 0 &&
        normalizeText(item.textContent).startsWith(EXTENDED_THINKING)
    );
  }

  function waitForExtendedThinkingItem() {
    return new Promise((resolve) => {
      const existingItem = findExtendedThinkingItem();
      if (existingItem) {
        resolve(existingItem);
        return;
      }

      const observer = new MutationObserver(() => {
        const item = findExtendedThinkingItem();
        if (!item) return;

        observer.disconnect();
        clearTimeout(timeout);
        resolve(item);
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, MENU_TIMEOUT_MS);

      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  function isSelected(item) {
    return (
      item.classList.contains("selected") ||
      item.getAttribute("aria-checked") === "true" ||
      item.getAttribute("aria-selected") === "true"
    );
  }

  function isExtendedThinkingActive(button) {
    return normalizeText(
      `${button.textContent} ${button.getAttribute("aria-label") || ""}`
    ).includes("extended");
  }

  async function enableExtendedThinking() {
    if (configuring || configuredButton?.isConnected) return;

    const button = findModeButton();
    if (
      !button ||
      button === configuredButton ||
      button.disabled ||
      button.getAttribute("aria-disabled") === "true"
    ) {
      return;
    }

    configuredButton = button;
    if (isExtendedThinkingActive(button)) return;

    configuring = true;
    try {
      let item = findExtendedThinkingItem();
      const openedMenu = !item;

      if (openedMenu) {
        button.click();
        item = await waitForExtendedThinkingItem();
      }

      if (!item) {
        if (openedMenu) button.click();
        console.warn(
          "[Gemini Extended Thinking] Extended thinking is not available."
        );
        return;
      }

      if (isSelected(item)) {
        if (openedMenu) button.click();
        return;
      }

      item.click();
    } finally {
      configuring = false;
    }
  }

  function schedule() {
    if (scheduled || configuredButton?.isConnected) return;

    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      enableExtendedThinking();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    if (location.pathname === lastPathname) return;

    const enteredNewChat = location.pathname === "/app";
    lastPathname = location.pathname;
    if (!enteredNewChat) return;

    configuredButton = null;
    schedule();
  }, 500);

  schedule();
})();
