// ==UserScript==
// @name        Goodreads for Douban Book
// @version     1.0.0
// @description Show Goodreads book info on douban book page
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       *://book.douban.com/subject/*
// @grant       GM.xmlHttpRequest
// @icon        https://www.goodreads.com/favicon.ico
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/master/douban-gr.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/master/douban-gr.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

"use strict";

function addGoodreadsLink(book) {
  const sidebar = document.getElementsByClassName("aside")[0];
  const div = document.createElement("div");
  div.innerHTML = `<div class="gray_ad" id="goodreads_book">
  <h2>Goodreads</h2>
  <a href="https://www.goodreads.com${book.bookUrl}"><span>${book.title}</span></a><br>
  <span class="pl">作者:</span> <a href="${book.author.profileUrl}">${book.author.name}</a><br>
  <span class="pl">评分:</span> ${book.avgRating} / ${book.ratingsCount} 人评价<br>
  </div>`;
  sidebar.insertBefore(div, sidebar.firstChild);
}

function showGoodreadsBookInfo() {
  const ISBNLabel = Array.from(
    document.querySelectorAll("#info > span")
  ).filter((el) => el.innerText.startsWith("ISBN:"))[0];

  if (!ISBNLabel) {
    return;
  }

  const ISBN = ISBNLabel.nextSibling.textContent.trim();
  const url = `https://www.goodreads.com/book/auto_complete?format=json&q=${ISBN}`;

  GM.xmlHttpRequest({
    url: url,
    method: "GET",
    onload: function (response) {
      const data = JSON.parse(response.responseText);
      if (data.length <= 0) {
        return;
      }
      const book = data[0];
      addGoodreadsLink(book);
    },
  });
}

showGoodreadsBookInfo();
