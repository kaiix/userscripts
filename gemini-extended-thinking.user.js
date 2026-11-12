// ==UserScript==
// @name        Gemini Extended Thinking
// @version     2.0.0
// @description Keep the last selected Gemini model and thinking level in new chats
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       https://gemini.google.com/*
// @icon        https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant       none
// @run-at      document-start
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/gemini-extended-thinking.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/gemini-extended-thinking.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

// Gemini already saves the last selected mode (user setting
// `last_selected_mode_id_on_web`) and thinking level (user setting
// `last_selected_thinking_level_on_web`) to the account, and restores the mode
// in new chats. Restoring the thinking level is gated behind a client feature
// flag that is off by default, so new chats fall back to the first level (Low).
// This script turns that flag on before Gemini boots, so Gemini's own code
// restores the saved thinking level. No menus are opened or clicked.

(function () {
  "use strict";

  const LOG_PREFIX = "[Gemini Extended Thinking]";
  const FLAGS_KEY = "TSDtV";
  const FORCED_FLAGS = {
    // Restore `last_selected_thinking_level_on_web` when a mode is selected.
    45805877: true,
  };

  function patchConfig(data) {
    if (!data || typeof data[FLAGS_KEY] !== "string") return false;

    try {
      const config = JSON.parse(data[FLAGS_KEY]);
      if (!config?.flags) return false;

      Object.assign(config.flags, FORCED_FLAGS);
      data[FLAGS_KEY] = JSON.stringify(config);
      return true;
    } catch {
      return false;
    }
  }

  function warnUnpatched() {
    console.warn(`${LOG_PREFIX} Could not patch Gemini feature flags.`);
  }

  if ("WIZ_global_data" in window) {
    // Injected after Gemini's config script ran; the flags may already be read.
    if (!patchConfig(window.WIZ_global_data)) warnUnpatched();
    return;
  }

  Object.defineProperty(window, "WIZ_global_data", {
    configurable: true,
    enumerable: true,
    get() {
      return undefined;
    },
    set(value) {
      if (!patchConfig(value)) warnUnpatched();
      Object.defineProperty(window, "WIZ_global_data", {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    },
  });
})();
