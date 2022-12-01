// ==UserScript==
// @name        Contract Source Viewer
// @version     1.0.0
// @description View contract source code on deth
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       *://etherscan.io/address/*
// @match       *://*.etherscan.io/address/*
// @icon        https://www.deth.net/img/logo.png
// @supportURL  https://github.com/kaiix/userscripts/issues
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/master/etherscan-deth.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/master/etherscan-deth.user.js
// ==/UserScript==

"use strict";

const showViewSourceButton = function () {
  const dethUrl = window.location.href.replace(".io", ".deth.net");
  const nav = document.querySelector("#content .container div div.d-flex");
  const div = document.createElement("div");
  div.className = "position-relative mb-2 mb-sm-0 mr-2";
  div.innerHTML = `<a href="${dethUrl}" class="btn btn-xs btn-dark">View Source</a>`;
  nav.insertBefore(div, nav.firstChild);
};

showViewSourceButton();
