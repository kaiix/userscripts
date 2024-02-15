// ==UserScript==
// @name        NeoDB for Douban
// @version     1.5.0
// @description Search missing movie/tv/book/music for douban
// @author      kaiix
// @namespace   https://github.com/kaiix
// @license     MIT
// @match       *://search.douban.com/movie/*
// @match       *://search.douban.com/book/*
// @match       *://search.douban.com/music/*
// @match       *://*.douban.com/search*
// @grant       GM.xmlHttpRequest
// @grant       GM.addStyle
// @icon        https://www.google.com/s2/favicons?sz=64&domain=neodb.social
// @updateURL   https://raw.githubusercontent.com/kaiix/userscripts/main/douban-neodb.user.js
// @downloadURL https://raw.githubusercontent.com/kaiix/userscripts/main/douban-neodb.user.js
// @supportURL  https://github.com/kaiix/userscripts/issues
// ==/UserScript==

const userStyle = `
.user-aside {
    margin-bottom: 25px;
    background: #F4F4EC;
    padding: 10px;
    word-wrap: break-word;
}

.user-aside .user-loading {
    color: #999;
    display: flex;
    justify-content: center;
}

.user-aside .user-loading.hidden {
    display: none;
}

.user-item-wrapper {
    margin-bottom: 30px;
}

.user-item-wrapper:last-child {
    margin-bottom: 0;
}

.user-item-wrapper .item-root {
    display: flex;
    flex-wrap: wrap;
    position: relative;
    justify-content: space-between;
}

.user-item-wrapper .cover-link {
    background: none;
    width: 65px;
    max-height: 97px;
    margin-right: 15px;
}

.user-item-wrapper .cover {
    width: 65px;
    max-height: 97px;
}

.user-item-wrapper .detail {
    flex: 1;
    min-width: 0;
}

.user-item-wrapper .detail .title {
    font-size: 14px;
    font-weight: 500;
    overflow: visible;
    position: relative;
    top: -1px;
    color: #007722;
}

.user-item-wrapper .detail .label {
    height: 12px;
    font-size: 12px;
    margin-left: 5px;
}

.user-item-wrapper .detail .meta {
    margin-top: 7px;
    color: #999;
    font-size: 12px;
    line-height: 1.5;
    overflow: visible;
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    word-wrap: normal;
    display: block;
}
`;

function searchNeoDB({ query, categories, callback }) {
  GM.xmlHttpRequest({
    method: "GET",
    url: `https://neodb.social/api/catalog/search?query=${query}`,
    onload: function (response) {
      const data = JSON.parse(response.responseText);
      let items = data.data;
      if (categories.length > 0) {
        items = items.filter((item) => categories.includes(item.category));
      }
      callback(items);
    },
  });
}

function createItem(item) {
  if (item.category === "movie" || item.category === "tv") {
    return createMovieItem(item);
  } else if (item.category === "book") {
    return createBookItem(item);
  } else if (item.category === "music") {
    return createMusicItem(item);
  }
}

function createMovieItem(item) {
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
  const star_grade =
    parseInt((parseInt(rating) * 10) / 2) +
    parseInt((parseInt(rating * 10) % 10) / 5) * 5;

  const el = document.createElement("div");
  el.classList.add("user-item-wrapper");
  el.innerHTML = formatItemHtml({
    url: fullUrl,
    cover_image_url,
    title,
    year,
    category,
    star_grade,
    rating,
    rating_count,
    abstract,
    abstract2,
  });
  return el;
}

function createBookItem(item) {
  const {
    url,
    title,
    category,
    cover_image_url,
    rating,
    rating_count,
    author,
    pub_house,
    pub_year,
    pub_month,
  } = item;

  const fullUrl = `https://neodb.social${url}`;
  const abstract = [author, pub_house, `${pub_year}-${pub_month}`]
    .flat()
    .filter(Boolean)
    .join(" / ");
  const abstract2 = "";
  const star_grade =
    parseInt((parseInt(rating) * 10) / 2) +
    parseInt((parseInt(rating * 10) % 10) / 5) * 5;
  const year = pub_year;

  const el = document.createElement("div");
  el.classList.add("user-item-wrapper");
  el.innerHTML = formatItemHtml({
    url: fullUrl,
    cover_image_url,
    title,
    year,
    category,
    star_grade,
    rating,
    rating_count,
    abstract,
    abstract2,
  });
  return el;
}

function createMusicItem(item) {
  const {
    url,
    title,
    category,
    cover_image_url,
    rating,
    rating_count,
    artist,
    genre,
    release_date,
  } = item;

  const fullUrl = `https://neodb.social${url}`;
  const abstract = [artist, release_date, genre]
    .flat()
    .filter(Boolean)
    .join(" / ");
  const abstract2 = "";
  const star_grade =
    parseInt((parseInt(rating) * 10) / 2) +
    parseInt((parseInt(rating * 10) % 10) / 5) * 5;

  const el = document.createElement("div");
  el.classList.add("user-item-wrapper");
  el.innerHTML = formatItemHtml({
    url: fullUrl,
    cover_image_url,
    title,
    year: undefined,
    category,
    star_grade,
    rating,
    rating_count,
    abstract,
    abstract2,
  });
  return el;
}

function formatItemHtml({
  url,
  cover_image_url,
  title,
  year,
  category,
  star_grade,
  rating,
  rating_count,
  abstract,
  abstract2,
}) {
  return `
  <div class="item-root">
    <a href="${url}" target="_blank" class="cover-link">
      <img src="${cover_image_url}" class="cover">
      </a>
      <div class="detail">
        <div class="title">
          <a href="${url}" target="_blank" data-moreurl="" class="title-text">${title} ${year ? `(${year})` : ""}</a>
          <span class="label" style="color: rgb(0, 173, 63);">[${category}]</span>
        </div>
        <div class="rating">
          <span class="allstar${star_grade} rating-stars"></span>
          <span class="rating_nums">${rating || ""}</span>
          <span class="pl">(${rating_count}人评价)</span>
        </div>
        <div class="meta abstract">${abstract}</div>
        <div class="meta abstract_2">${abstract2}</div>
      </div>
    </div>
	`;
}

(function () {
  "use strict";
  let sidebar, query;
  const searchParams = new URLSearchParams(location.search);

  const subdomain = location.host.split(".")[0];
  if (subdomain === "search") {
    query = searchParams.get("search_text");
    sidebar = document.querySelector(
      'a[href=" https://www.douban.com/opensearch?description"]',
    ).parentNode.parentNode;
  }

  // 403 forbidden
  // 根据相关法律法规和政策，搜索结果未予显示。请尝试其他查询词。
  let isCensored = false;
  if (subdomain === "www") {
    query = searchParams.get("q");
    sidebar = document.querySelector("#content .aside");
    if (!sidebar) {
      const isError = document.querySelector("title").text == "error";
      const errMsg = document.querySelector(
        '#wrapper img[src="/pics/douban_error.gif"]',
      )?.nextElementSibling?.textContent;
      if (isError && errMsg.includes("搜索结果未予显示")) {
        sidebar = document.querySelector("#wrapper");
        isCensored = true;
      }
    }
  }

  if (!query) {
    return;
  }

  GM.addStyle(userStyle);

  let categories = [];
  if (subdomain === "search") {
    const subject_category = location.pathname.split("/").filter(Boolean)[0];
    if (subject_category === "movie") {
      categories = ["tv", "movie"];
    } else if (subject_category === "book") {
      categories = ["book"];
    } else if (subject_category === "music") {
      categories = ["music"];
    }
  } else {
    categories = ["movie", "tv", "book", "music"];
  }

  if (categories.length === 0) {
    return;
  }

  const userSidebar = document.createElement("div");
  userSidebar.classList.add("user-aside");
  const loading = document.createElement("div");
  loading.innerHTML = "加载中...";
  loading.classList.add("user-loading");
  userSidebar.appendChild(loading);
  sidebar.insertBefore(userSidebar, sidebar.firstChild);

  let hasSearchResult = false;
  if (subdomain === "search") {
    const searchResult = document.querySelector("#root > div :nth-child(2)");
    const originItems = searchResult.querySelectorAll(".item-root");
    hasSearchResult = originItems.length > 0;
  } else if (subdomain === "www") {
    hasSearchResult = !isCensored;
  }

  const showItems = (items) => {
    loading.classList.add("hidden");

    if (hasSearchResult) {
      // filter out items exists in the douban
      items = items.filter((item) => {
        const exists = item.external_resources.filter((resource) => {
          return resource.url.includes("douban.com");
        });
        return exists.length === 0;
      });
    }

    if (items.length > 0) {
      items.forEach((item) => {
        userSidebar.appendChild(createItem(item));
      });
    } else {
      const showMore = document.createElement("div");
      showMore.classList.add("user-loading");
      showMore.innerHTML = `未检索到其他资源&nbsp;<a href="https://neodb.social/search?q=${query}" target="_blank">查看更多</a>`;
      userSidebar.appendChild(showMore);
    }
  };

  searchNeoDB({
    query,
    categories,
    callback: showItems,
  });
})();
