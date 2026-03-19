// ==UserScript==
// @name        Clean bilibili
// @version     1.0.0
// @description Clean bilibili homepage
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       https://www.bilibili.com/
// @grant       GM_addStyle
// @icon        https://www.google.com/s2/favicons?sz=64&domain=bilibili.com
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/clean-bilibili.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/clean-bilibili.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const el = document.querySelector(".recommended-swipe");
  el.remove();

  GM_addStyle(
    ".recommended-container_floor-aside .container>*:nth-of-type(n) { margin-top: 0 !important}"
  );
})();
