// ==UserScript==
// @name        Clean bilibili
// @version     1.1.0
// @description Remove the carousel from the bilibili homepage
// @run-at      document-start
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

  GM_addStyle(`
    /* The structural fallback survives changes to the carousel's outer class. */
    .recommended-swipe,
    main [class~="container"] > :first-child:has([class*="carousel" i]) {
      display: none !important;
    }

    /* Bilibili offsets cards that originally followed the two-row carousel. */
    .recommended-container_floor-aside > .container > *,
    main [class~="container"]:has(> :first-child [class*="carousel" i]) > * {
      margin-top: 0 !important;
    }
  `);
})();
