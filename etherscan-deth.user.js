// ==UserScript==
// @name        Contract Source Viewer
// @version     1.0.1
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
  console.log("dest url", dethUrl);
  const nodes = document
    .querySelector("#content .container-xxl .flex-wrap")
    .querySelectorAll("div.d-flex");
  const nav = nodes[nodes.length - 1];
  const div = document.createElement("div");
  div.innerHTML = `<a href="${dethUrl}" class="btn btn-sm btn-dark">View Source</a>`;
  nav.insertBefore(div, null);
};

showViewSourceButton();
