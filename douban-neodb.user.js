// ==UserScript==
// @name        NeoDB for Douban
// @version     1.1.0
// @description Search missing movie/tv for douban
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       *://search.douban.com/movie/*
// @match       *://*.douban.com/search*
// @grant       GM.xmlHttpRequest
// @icon        https://www.google.com/s2/favicons?sz=64&domain=neodb.social
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/douban-neodb.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/douban-neodb.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

function searchNeoDB(query, categories, callback) {
  GM.xmlHttpRequest({
    method: "GET",
    url: `https://neodb.social/api/catalog/search?query=${query}`,
    onload: function (response) {
      const data = JSON.parse(response.responseText);
      let items = data.data;
      if (categories.length > 0) {
        items = items.filter((item) => categories.includes(item.category));
      }
      items = items.filter((item) => {
        const resources = item.external_resources;
        const exists = resources.filter((resource) =>
          resource.url.includes("douban.com")
        );
        return exists.length === 0;
      });
      callback(items);
    },
  });
}

function createItem(item) {
  const {
    url,
    title,
    category,
    cover_image_url,
    year,
    rating,
    rating_count,
    area,
    genre,
    other_title,
    duration,
    director,
    playwright,
    actor,
  } = item;

  const fullUrl = `https://neodb.social${url}`;
  const abstract = [area, genre, other_title, duration]
    .flat()
    .filter(Boolean)
    .join(" / ");
  const abstract2 = [director, playwright, actor.slice(5)]
    .flat()
    .filter(Boolean)
    .join(" / ");
  const starGrade =
    parseInt((parseInt(rating) * 10) / 2) +
    parseInt((parseInt(rating * 10) % 10) / 5) * 5;

  const el = document.createElement("div");
  // TODO: clone node or rewrite style
  el.innerHTML = `
  <div class="sc-bZQynM sc-bxivhb eJWSlY">
  <div class="item-root">
    <a href="${fullUrl}" target="_blank" data-moreurl="" class="cover-link">
      <img src="${cover_image_url}" alt="" class="cover" style="width: 65px; max-height: 97px;">
      </a>
      <div class="detail">
        <div class="title">
          <a href="${fullUrl}" target="_blank" data-moreurl="" class="title-text">${title} (${year})</a>
          <span class="label" style="color: rgb(0, 173, 63);">[${category}]</span>
        </div>
        <div class="rating sc-bwzfXH hxNRHc">
          <span class="allstar${starGrade} rating-stars"></span>
          <span class="rating_nums">${rating || ""}</span>
          <span class="pl">(${rating_count}人评价)</span>
        </div>
        <div class="meta abstract">${abstract}</div>
        <div class="meta abstract_2" style="white-space: nowrap;max-width: 100%;text-overflow:ellipsis;overflow:hidden;word-wrap: normal;display: inline-block;">${abstract2}</div>
      </div>
    </div>
    </div>
	`;
  return el;
}

(function () {
  "use strict";
  let sidebar, query;
  const searchParams = new URLSearchParams(location.search);
  console.log("location.pathname", location.pathname);
  if (location.pathname === "/search") {
    sidebar = document.querySelector("#content .aside");
    query = searchParams.get("q");
  } else {
    sidebar = document.querySelector(
      'a[href=" https://www.douban.com/opensearch?description"]'
    ).parentNode.parentNode;
    query = searchParams.get("search_text");
  }

  if (!query) {
    return;
  }

  // const searchResult = document.querySelector("#root > div :nth-child(2)");
  // https://search.douban.com/movie/subject_search?search_text=%E8%AF%B7%E5%9B%9E%E7%AD%94&cat=1002
  const section = sidebar.firstElementChild.cloneNode(false);
  section.classList.add("gray_ad");
  sidebar.insertBefore(section, sidebar.firstChild);
  searchNeoDB(query, ["tv", "movie"], function (items) {
    items.forEach((item) => {
      section.appendChild(createItem(item));
    });
  });
})();
