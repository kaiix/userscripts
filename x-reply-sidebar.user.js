// ==UserScript==
// @name         X Reply Sidebar
// @version      2.0.3
// @description  Opens tweet replies in a side panel to the right of the timeline
// @author       kaiix
// @namespace    https://github.com/kaiix
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=x.com
// @grant        none
// @updateURL    https://raw.githubusercontent.com/kaiix/userscripts/main/x-reply-sidebar.user.js
// @downloadURL  https://raw.githubusercontent.com/kaiix/userscripts/main/x-reply-sidebar.user.js
// @supportURL   https://github.com/kaiix/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  // --- Configuration ---
  const PANEL_WIDTH = 600;
  const PANEL_MIN_WIDTH = 400;

  // --- State ---
  let panel = null;
  let currentTweetUrl = null;
  let currentTweetId = null;
  let currentCursor = null;
  let loadingMore = false;
  let scrollObserver = null;
  let resizing = false;
  let currentMainTweet = null;
  let showOriginalTweet = true;

  // --- Grab X's auth tokens from cookies/meta for API calls ---
  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getCSRFToken() {
    return getCookie("ct0");
  }

  function getBearerToken() {
    // Try to extract from X's React internals (the token lives in the main JS bundle
    // and gets set on the internal API client). It's an app-level constant, not per-user.
    try {
      // X's main.js sets this on the internal fetch wrapper
      const reactRoot = document.getElementById("react-root");
      const internalStore =
        reactRoot?._reactRootContainer?._internalRoot?.current?.memoizedState?.element?.props?.store;
      const state = internalStore?.getState?.();
      const token =
        state?.featureSwitch?.config?.["auth_token"]?.value ||
        state?.authorization?.bearerToken;
      if (token) return token;
    } catch {}

    // Fallback: this is X's long-lived public app bearer token (same for all users)
    return "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  }

  // --- Styles ---
  function injectStyles() {
    if (document.getElementById("xrs-styles")) return;
    const style = document.createElement("style");
    style.id = "xrs-styles";
    style.textContent = `
      body.xrs-panel-open [data-testid="sidebarColumn"] {
        display: none !important;
      }

      #xrs-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: ${PANEL_WIDTH}px;
        height: 100vh;
        background: rgb(0, 0, 0);
        border-left: 1px solid rgb(47, 51, 54);
        z-index: 10;
        display: flex;
        flex-direction: column;
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
        color: rgb(231, 233, 234);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        animation: xrs-slide-in 0.22s ease-out;
      }
      #xrs-panel.xrs-closing {
        animation: xrs-slide-out 0.18s ease-in forwards;
      }
      @keyframes xrs-slide-in {
        from { transform: translateX(100%); opacity: 0.6; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes xrs-slide-out {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0.6; }
      }

      #xrs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        border-bottom: 1px solid rgb(47, 51, 54);
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        min-height: 48px;
        flex-shrink: 0;
      }

      #xrs-header-title {
        font-size: 17px;
        font-weight: 700;
      }

      #xrs-header-actions {
        display: flex;
        gap: 4px;
        align-items: center;
      }

      #xrs-header-actions button,
      .xrs-btn {
        background: transparent;
        border: none;
        color: rgb(231, 233, 234);
        cursor: pointer;
        padding: 6px 8px;
        border-radius: 9999px;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
        font-family: inherit;
      }

      #xrs-header-actions button:hover,
      .xrs-btn:hover {
        background: rgba(231, 233, 234, 0.1);
      }

      .xrs-hint {
        display: none;
      }
      #xrs-resize {
        position: absolute;
        top: 0;
        left: -4px;
        width: 8px;
        height: 100%;
        cursor: col-resize;
        z-index: 11;
      }
      #xrs-resize:hover, #xrs-resize.active {
        background: rgba(29, 155, 240, 0.3);
      }

      #xrs-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
      }

      #xrs-content::-webkit-scrollbar {
        width: 4px;
      }
      #xrs-content::-webkit-scrollbar-thumb {
        background: rgb(47, 51, 54);
        border-radius: 2px;
      }

      /* Loading */
      .xrs-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 0;
        gap: 12px;
        color: rgb(29, 155, 240);
      }
      .xrs-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid rgba(29, 155, 240, 0.2);
        border-top-color: rgb(29, 155, 240);
        border-radius: 50%;
        animation: xrs-spin 0.8s linear infinite;
      }
      @keyframes xrs-spin { to { transform: rotate(360deg); } }

      /* Error */
      .xrs-error {
        padding: 24px;
        text-align: center;
        color: rgb(244, 33, 46);
        font-size: 15px;
      }

      /* Tweet card in panel */
      .xrs-tweet {
        padding: 12px 16px;
        border-bottom: 1px solid rgb(47, 51, 54);
        transition: background-color 0.15s;
      }
      .xrs-tweet:hover {
        background: rgba(231, 233, 234, 0.03);
      }
      .xrs-tweet-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }
      .xrs-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
        cursor: pointer;
      }
      .xrs-reply-avatar {
        width: 32px;
        height: 32px;
      }
      .xrs-name-group {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .xrs-name {
        font-weight: 700;
        font-size: 15px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .xrs-name a {
        color: inherit;
        text-decoration: none;
      }
      .xrs-name a:hover {
        text-decoration: underline;
      }
      .xrs-handle {
        font-size: 13px;
        color: rgb(113, 118, 123);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .xrs-handle a {
        color: inherit;
        text-decoration: none;
      }
      .xrs-tweet-text {
        font-size: 15px;
        line-height: 1.4;
        margin: 4px 0 8px;
        word-wrap: break-word;
        white-space: pre-wrap;
      }
      .xrs-tweet-text a {
        color: rgb(29, 155, 240);
        text-decoration: none;
      }
      .xrs-tweet-text a:hover {
        text-decoration: underline;
      }
      .xrs-tweet-media {
        margin: 8px 0;
        border-radius: 12px;
        overflow: hidden;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 2px;
        max-width: 90%;
      }
      .xrs-tweet-media img {
        width: 100%;
        height: 150px;
        object-fit: cover;
        display: block;
      }
      .xrs-tweet-meta {
        display: flex;
        gap: 16px;
        font-size: 13px;
        color: rgb(113, 118, 123);
        margin-top: 4px;
      }
      .xrs-tweet-time {
        font-size: 13px;
        color: rgb(113, 118, 123);
      }
      .xrs-tweet-time a {
        color: inherit;
        text-decoration: none;
      }
      .xrs-tweet-time a:hover {
        text-decoration: underline;
      }

      /* Main tweet vs replies separator */
      .xrs-section-label {
        padding: 12px 16px;
        font-size: 15px;
        font-weight: 700;
        border-bottom: 1px solid rgb(47, 51, 54);
        color: rgb(231, 233, 234);
      }

      /* Original tweet container (toggle) */
      .xrs-original-tweet {
        border-bottom: 1px solid rgb(47, 51, 54);
      }

      /* Toggle button style */
      .xrs-toggle-btn {
        background: transparent;
        border: none;
        color: rgb(113, 118, 123);
        cursor: pointer;
        padding: 6px 8px;
        border-radius: 9999px;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s, color 0.2s;
        font-family: inherit;
      }
      .xrs-toggle-btn:hover {
        background: rgba(231, 233, 234, 0.1);
        color: rgb(231, 233, 234);
      }
      .xrs-toggle-btn.active {
        color: rgb(29, 155, 240);
      }

      /* Reply tweet slightly indented */
      .xrs-reply {
        padding-left: 16px;
      }

      /* Active tweet highlight in main timeline */
      article[data-testid="tweet"].xrs-active {
        background-color: rgba(29, 155, 240, 0.08) !important;
      }

      /* Clickable tweets in panel */
      .xrs-tweet-clickable {
        cursor: pointer;
      }

      /* Thread line */
      .xrs-thread-line {
        width: 2px;
        background: rgb(47, 51, 54);
        margin: 0 auto;
        min-height: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  // --- Panel ---

  function createPanel() {
    if (panel) return;

    panel = document.createElement("div");
    panel.id = "xrs-panel";

    // Resize handle
    const resize = document.createElement("div");
    resize.id = "xrs-resize";
    resize.addEventListener("mousedown", startResize);
    panel.appendChild(resize);

    // Header
    const header = document.createElement("div");
    header.id = "xrs-header";

    const title = document.createElement("span");
    title.id = "xrs-header-title";
    title.textContent = "Replies";

    const actions = document.createElement("div");
    actions.id = "xrs-header-actions";

    const toggleOrigBtn = document.createElement("button");
    toggleOrigBtn.className = "xrs-toggle-btn active";
    toggleOrigBtn.innerHTML = "👁";
    toggleOrigBtn.title = "Hide original tweet";
    toggleOrigBtn.addEventListener("click", toggleOriginalTweet);

    const openBtn = document.createElement("button");
    openBtn.innerHTML = "↗";
    openBtn.title = "Open in new window";
    openBtn.addEventListener("click", openInMainView);

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "✕";
    closeBtn.title = "Close panel (Esc)";
    closeBtn.addEventListener("click", closePanel);

    actions.append(toggleOrigBtn, openBtn, closeBtn);
    header.append(title, actions);
    panel.appendChild(header);

    // Content area
    const content = document.createElement("div");
    content.id = "xrs-content";
    panel.appendChild(content);

    document.body.appendChild(panel);
    document.body.classList.add("xrs-panel-open");

    // Close panel when the main timeline (window) scrolls
    lastScrollY = window.scrollY;
    window.addEventListener("scroll", handleMainScroll, { passive: true });
  }

  let lastScrollY = 0;
  function handleMainScroll() {
    if (!panel) return;
    const y = window.scrollY;
    // Ignore tiny/incidental deltas (e.g. layout shifts)
    if (Math.abs(y - lastScrollY) < 10) return;
    lastScrollY = y;
    closePanel();
  }

  function closePanel() {
    if (!panel) return;
    window.removeEventListener("scroll", handleMainScroll);
    document.querySelector("article.xrs-active")?.classList.remove("xrs-active");

    const panelEl = panel;
    // Detach state immediately so a new loadTweet can create a fresh panel
    panel = null;
    currentTweetUrl = null;

    const cleanup = () => {
      panelEl.remove();
      // Only drop body class if no new panel has appeared meanwhile
      if (!document.getElementById("xrs-panel")) {
        document.body.classList.remove("xrs-panel-open");
      }
    };

    panelEl.classList.add("xrs-closing");
    let done = false;
    const onEnd = () => {
      if (done) return;
      done = true;
      cleanup();
    };
    panelEl.addEventListener("animationend", onEnd, { once: true });
    // Fallback in case animationend doesn't fire (e.g., reduced-motion)
    setTimeout(onEnd, 260);
  }

  function openInMainView() {
    if (currentTweetUrl) {
      window.open(currentTweetUrl, "_blank");
    }
  }

  function toggleOriginalTweet() {
    showOriginalTweet = !showOriginalTweet;
    const btn = panel?.querySelector(".xrs-toggle-btn");
    if (btn) {
      btn.classList.toggle("active", showOriginalTweet);
      btn.title = showOriginalTweet ? "Hide original tweet" : "Show original tweet";
    }
    const container = panel?.querySelector(".xrs-original-tweet");
    if (container) {
      container.style.display = showOriginalTweet ? "" : "none";
    }
  }

  function showLoading() {
    const content = panel?.querySelector("#xrs-content");
    if (!content) return;
    content.innerHTML = `<div class="xrs-loading"><div class="xrs-spinner"></div><span>Loading replies…</span></div>`;
  }

  function showError(msg) {
    const content = panel?.querySelector("#xrs-content");
    if (!content) return;
    content.innerHTML = `<div class="xrs-error">${msg}</div>`;
  }

  // --- Resize ---

  function startResize(e) {
    e.preventDefault();
    resizing = true;
    document.getElementById("xrs-resize")?.classList.add("active");
    document.addEventListener("mousemove", onResize);
    document.addEventListener("mouseup", stopResize);
  }

  function onResize(e) {
    if (!resizing || !panel) return;
    const w = window.innerWidth - e.clientX;
    if (w >= PANEL_MIN_WIDTH && w <= window.innerWidth * 0.7) {
      panel.style.width = w + "px";
    }
  }

  function stopResize() {
    resizing = false;
    document.getElementById("xrs-resize")?.classList.remove("active");
    document.removeEventListener("mousemove", onResize);
    document.removeEventListener("mouseup", stopResize);
  }

  // --- API: Fetch tweet detail via X's GraphQL API ---

  async function fetchTweetDetail(tweetId, cursor) {
    const csrf = getCSRFToken();
    const bearer = getBearerToken();

    if (!csrf) throw new Error("Not logged in or CSRF token missing");

    const variables = {
      focalTweetId: tweetId,
      with_rux_injections: false,
      rankingMode: "Relevance",
      includePromotedContent: true,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true,
      withV2Timeline: true,
    };

    if (cursor) {
      variables.cursor = cursor;
      variables.referrer = "tweet";
    }

    const features = {
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      rweb_video_timestamps_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    };

    const fieldToggles = {
      withArticleRichContentState: true,
      withArticlePlainText: false,
      withGrokAnalyze: false,
      withDisallowedReplyControls: false,
    };

    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(features),
      fieldToggles: JSON.stringify(fieldToggles),
    });

    const resp = await fetch(
      `https://x.com/i/api/graphql/nBS-WpgA6ZG0CyNHD517JQ/TweetDetail?${params}`,
      {
        headers: {
          authorization: `Bearer ${bearer}`,
          "x-csrf-token": csrf,
          "x-twitter-active-user": "yes",
          "x-twitter-auth-type": "OAuth2Session",
          "content-type": "application/json",
        },
        credentials: "include",
      }
    );

    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  }

  // --- Parse tweet data from API response ---

  function parseTweetResult(result) {
    if (!result) return null;

    // Handle different wrapper types
    if (result.__typename === "TweetWithVisibilityResults") {
      result = result.tweet;
    }
    if (!result?.core?.user_results?.result) return null;

    const user = result.core.user_results.result.legacy;
    const tweet = result.legacy;
    if (!tweet || !user) return null;

    // Handle NoteTweets (long form)
    let text = tweet.full_text || "";
    if (result.note_tweet?.note_tweet_results?.result?.text) {
      text = result.note_tweet.note_tweet_results.result.text;
    }

    // Expand URLs in text
    const urls = tweet.entities?.urls || [];
    for (const u of urls) {
      text = text.replace(u.url, u.expanded_url || u.display_url || u.url);
    }
    // Remove t.co media links at end
    const mediaUrls = tweet.entities?.media || [];
    for (const m of mediaUrls) {
      text = text.replace(m.url, "").trim();
    }

    // Extract media
    const media = (tweet.extended_entities?.media || tweet.entities?.media || []).map((m) => ({
      type: m.type,
      url: m.media_url_https,
      expandedUrl: m.expanded_url,
    }));

    return {
      id: tweet.id_str,
      text,
      name: user.name,
      screenName: user.screen_name,
      avatar: user.profile_image_url_https?.replace("_normal", "_bigger"),
      createdAt: tweet.created_at,
      metrics: {
        replies: tweet.reply_count,
        retweets: tweet.retweet_count,
        likes: tweet.favorite_count,
        bookmarks: tweet.bookmark_count,
        views: result.views?.count,
      },
      media,
      inReplyTo: tweet.in_reply_to_status_id_str,
    };
  }

  function extractTweetsFromTimeline(data, focalTweetId) {
    const instructions =
      data?.data?.tweetResult?.result?.timeline_v2?.timeline?.instructions ||
      data?.data?.threaded_conversation_with_injections_v2?.instructions ||
      [];

    const entries = instructions.flatMap((i) => i.entries || []);

    let mainTweet = null;
    const replies = [];
    let cursor = null;

    for (const entry of entries) {
      const entryId = entry.entryId || "";

      // Extract bottom cursor for "load more"
      if (entryId.startsWith("cursor-bottom")) {
        cursor = entry.content?.value || entry.content?.itemContent?.value || null;
        continue;
      }

      // Filter: only focal tweet and conversation threads are replies.
      // Recommendations usually start with "who-to-follow-", "suggest-", etc.
      if (!entryId.startsWith("tweet-") && !entryId.startsWith("conversationthread-")) {
        continue;
      }

      const content = entry.content;
      if (!content) continue;

      if (content.entryType === "TimelineTimelineItem" || content.__typename === "TimelineTimelineItem") {
        const tweetResult = content.itemContent?.tweet_results?.result;
        const parsed = parseTweetResult(tweetResult);
        if (!parsed) continue;

        if (parsed.id === focalTweetId) {
          mainTweet = parsed;
        } else {
          replies.push(parsed);
        }
      } else if (content.entryType === "TimelineTimelineModule" || content.__typename === "TimelineTimelineModule") {
        const items = content.items || [];
        for (const item of items) {
          // Check for cursor inside modules too
          if (item.item?.itemContent?.cursorType === "Bottom") {
            cursor = item.item.itemContent.value || null;
            continue;
          }
          const tweetResult = item.item?.itemContent?.tweet_results?.result;
          const parsed = parseTweetResult(tweetResult);
          if (parsed) {
            if (parsed.id === focalTweetId) {
              mainTweet = parsed;
            } else {
              replies.push(parsed);
            }
          }
        }
      }
    }

    return { main: mainTweet, replies, cursor };
  }

  // --- Render ---

  function formatDate(dateStr) {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now - d;
      const diffSec = diffMs / 1000;

      if (diffSec < 60) return `${Math.floor(diffSec)}s`;
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;

      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }

  function formatNumber(n) {
    if (n == null) return "";
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function linkifyText(text) {
    // Single-pass tokenizer to avoid @mention links getting re-wrapped by URL regex
    const regex = /(https?:\/\/[^\s]+)|(@\w+)|(#\w+)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      if (match[1]) {
        // URL
        parts.push(`<a href="${match[1]}" target="_blank">${match[1]}</a>`);
      } else if (match[2]) {
        // @mention
        const user = match[2].slice(1);
        parts.push(`<a href="https://x.com/${user}" target="_blank">${match[2]}</a>`);
      } else if (match[3]) {
        // #hashtag
        const tag = match[3].slice(1);
        parts.push(`<a href="https://x.com/hashtag/${tag}" target="_blank">${match[3]}</a>`);
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.join("");
  }

  function renderTweet(tweet, isMain) {
    const div = document.createElement("div");
    div.className = `xrs-tweet ${isMain ? "" : "xrs-reply xrs-tweet-clickable"}`;

    if (!isMain) {
      div.addEventListener("click", (e) => {
        if (e.target.closest("a, button")) return;
        if (window.getSelection().toString()) return;
        const url = `https://x.com/${tweet.screenName}/status/${tweet.id}`;
        loadTweet(url, tweet.id);
      });
    }

    const header = document.createElement("div");
    header.className = "xrs-tweet-header";

    const avatar = document.createElement("img");
    avatar.className = `xrs-avatar ${isMain ? "" : "xrs-reply-avatar"}`;
    avatar.src = tweet.avatar || "";
    avatar.alt = tweet.name;
    avatar.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(`https://x.com/${tweet.screenName}`, "_blank");
    });

    const nameGroup = document.createElement("div");
    nameGroup.className = "xrs-name-group";

    const name = document.createElement("span");
    name.className = "xrs-name";
    name.innerHTML = `<a href="https://x.com/${tweet.screenName}" target="_blank">${escHtml(tweet.name)}</a>`;

    const handle = document.createElement("span");
    handle.className = "xrs-handle";
    handle.innerHTML = `<a href="https://x.com/${tweet.screenName}" target="_blank">@${escHtml(tweet.screenName)}</a> · <a href="https://x.com/${tweet.screenName}/status/${tweet.id}" target="_blank" class="xrs-tweet-time">${formatDate(tweet.createdAt)}</a>`;

    nameGroup.append(name, handle);
    header.append(avatar, nameGroup);
    div.appendChild(header);

    // Text
    if (tweet.text) {
      const textEl = document.createElement("div");
      textEl.className = "xrs-tweet-text";
      textEl.innerHTML = linkifyText(escHtml(tweet.text));
      div.appendChild(textEl);
    }

    // Media
    if (tweet.media?.length) {
      const mediaContainer = document.createElement("div");
      mediaContainer.className = "xrs-tweet-media";
      for (const m of tweet.media) {
        if (m.type === "photo") {
          const img = document.createElement("img");
          img.src = m.url;
          img.loading = "lazy";
          mediaContainer.appendChild(img);
        }
      }
      div.appendChild(mediaContainer);
    }

    // Metrics (only for main tweet)
    if (isMain && tweet.metrics) {
      const meta = document.createElement("div");
      meta.className = "xrs-tweet-meta";
      const items = [
        { label: "💬", value: tweet.metrics.replies },
        { label: "🔁", value: tweet.metrics.retweets },
        { label: "❤️", value: tweet.metrics.likes },
        { label: "👁", value: tweet.metrics.views },
      ];
      for (const item of items) {
        if (item.value != null) {
          const span = document.createElement("span");
          span.textContent = `${item.label} ${formatNumber(item.value)}`;
          meta.appendChild(span);
        }
      }
      div.appendChild(meta);
    }

    return div;
  }

  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderContent(main, replies, cursor, append) {
    const content = panel?.querySelector("#xrs-content");
    if (!content) return;

    // Clean up old observer and sentinel
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }

    if (append) {
      content.querySelector(".xrs-sentinel")?.remove();
    } else {
      content.innerHTML = "";

      // Render original tweet (hidden by default)
      if (main) {
        currentMainTweet = main;
        const origContainer = document.createElement("div");
        origContainer.className = "xrs-original-tweet";
        origContainer.style.display = showOriginalTweet ? "" : "none";
        origContainer.appendChild(renderTweet(main, true));
        content.appendChild(origContainer);
      }
    }

    if (replies.length > 0) {
      for (const reply of replies) {
        content.appendChild(renderTweet(reply, false));
      }
    } else if (!append) {
      const empty = document.createElement("div");
      empty.className = "xrs-error";
      empty.style.color = "rgb(113, 118, 123)";
      empty.textContent = "No replies yet";
      content.appendChild(empty);
    }

    // Add scroll sentinel for infinite scroll
    // Stop pagination if append returned no new replies (all loaded)
    if (append && replies.length === 0) {
      currentCursor = null;
      loadingMore = false;
      return;
    }

    currentCursor = cursor || null;
    loadingMore = false;

    if (cursor) {
      const sentinel = document.createElement("div");
      sentinel.className = "xrs-sentinel";
      sentinel.innerHTML = '<div class="xrs-loading"><div class="xrs-spinner"></div></div>';
      sentinel.style.minHeight = "60px";
      content.appendChild(sentinel);

      scrollObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !loadingMore) {
            loadMoreReplies();
          }
        },
        { root: content, threshold: 0.1 }
      );
      scrollObserver.observe(sentinel);
    }
  }

  async function loadMoreReplies() {
    if (!currentTweetId || !currentCursor || !panel || loadingMore) return;
    loadingMore = true;

    try {
      const data = await fetchTweetDetail(currentTweetId, currentCursor);
      const { replies, cursor } = extractTweetsFromTimeline(data, currentTweetId);
      renderContent(null, replies, cursor, true);
    } catch (err) {
      console.error("[X Reply Sidebar]", err);
      loadingMore = false;
      // Replace sentinel with error message
      const sentinel = panel?.querySelector(".xrs-sentinel");
      if (sentinel) {
        sentinel.innerHTML = '<div style="padding:16px;text-align:center;color:rgb(244,33,46);font-size:14px;cursor:pointer">Failed to load — tap to retry</div>';
        sentinel.addEventListener("click", () => {
          sentinel.innerHTML = '<div class="xrs-loading"><div class="xrs-spinner"></div></div>';
          loadMoreReplies();
        }, { once: true });
      }
    }
  }

  function loadQuotedFromData(data) {
    const instructions =
      data?.data?.tweetResult?.result?.timeline_v2?.timeline?.instructions ||
      data?.data?.threaded_conversation_with_injections_v2?.instructions ||
      [];

    const entries = instructions.flatMap((i) => i.entries || []);
    for (const entry of entries) {
      const tweetResult = entry.content?.itemContent?.tweet_results?.result || 
                          entry.content?.items?.[0]?.item?.itemContent?.tweet_results?.result;
      
      const tweet = tweetResult?.legacy || (tweetResult?.__typename === "TweetWithVisibilityResults" ? tweetResult.tweet?.legacy : null);
      if (tweet?.quoted_status_id_str) {
        return {
          id: tweet.quoted_status_id_str,
          result: tweetResult.quoted_status_result?.result
        };
      }
    }
    return null;
  }

  // --- Load tweet ---

  async function loadTweet(url, tweetId, isQuoteClick = false) {
    if (!panel) createPanel();
    currentTweetId = tweetId;
    currentTweetUrl = url;
    currentCursor = null;
    currentMainTweet = null;

    // Sync toggle button state
    const toggleBtn = panel.querySelector(".xrs-toggle-btn");
    if (toggleBtn) {
      toggleBtn.classList.toggle("active", showOriginalTweet);
      toggleBtn.title = showOriginalTweet ? "Hide original tweet" : "Show original tweet";
    }

    // Update header title
    const titleEl = panel.querySelector("#xrs-header-title");
    if (titleEl) titleEl.textContent = "Replies";

    showLoading();

    // Scroll content to top
    const content = panel.querySelector("#xrs-content");
    if (content) content.scrollTop = 0;

    try {
      let data = await fetchTweetDetail(tweetId);
      
      if (isQuoteClick) {
        const quoted = loadQuotedFromData(data);
        if (quoted) {
          tweetId = quoted.id;
          // We could potentially use quoted.result here to avoid another fetch,
          // but for simplicity and getting full threading, we fetch the quoted tweet detail.
          data = await fetchTweetDetail(tweetId);
        }
      }

      const { main, replies, cursor } = extractTweetsFromTimeline(data, tweetId);

      // Build correct URL from API data
      if (main) {
        currentTweetUrl = `https://x.com/${main.screenName}/status/${main.id}`;
        currentTweetId = main.id;
      }

      renderContent(main, replies, cursor, false);
    } catch (err) {
      console.error("[X Reply Sidebar]", err);
      showError(`Failed to load replies: ${escHtml(err.message)}`);
    }
  }

  // --- Tweet click interception ---

  function extractTweetInfo(el) {
    const tweet = el.closest('article[data-testid="tweet"]');
    if (!tweet) return null;

    function getStatusInfo(root) {
      const links = root.querySelectorAll('a[href*="/status/"]');
      for (const link of links) {
        const href = link.getAttribute("href");
        const match = href?.match(/^\/([^/]+)\/status\/(\d+)$/);
        if (match) {
          return {
            url: "https://x.com" + href,
            tweetId: match[2]
          };
        }
      }
      return null;
    }

    const quoteContainer = el.closest('div[role="link"][tabindex="0"]');
    const isQuoteClick = !!(quoteContainer && tweet.contains(quoteContainer));
    
    // For quote clicks, we first get the main tweet ID, then loadTweet will resolve the quote
    const info = getStatusInfo(tweet);
    return info ? { ...info, article: tweet, isQuoteClick } : null;
  }

  function isInteractive(el) {
    return !!el.closest(
      'button, [role="button"], [data-testid="like"], [data-testid="unlike"], ' +
      '[data-testid="retweet"], [data-testid="unretweet"], [data-testid="reply"], ' +
      '[data-testid="bookmark"], [data-testid="removeBookmark"], [data-testid="caret"], ' +
      'a[href*="/photo/"], a[href*="/video/"], [data-testid="tweetPhoto"], ' +
      '[data-testid="videoPlayer"], [data-testid="UserAvatar-Container"], ' +
      '[data-testid="UserAvatar-Container-unknown"]'
    );
  }

  function handleClick(e) {
    // Only on timeline-like pages
    const path = window.location.pathname;
    const isTimeline =
      path === "/home" ||
      path === "/" ||
      path.startsWith("/home") ||
      /^\/i\/lists\/\d+/.test(path) ||
      /^\/search/.test(path);

    if (!isTimeline) return;

    // Skip interactive elements
    if (isInteractive(e.target)) return;

    // Skip if text is selected
    if (window.getSelection().toString()) return;

    // Skip modifier clicks
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;

    // Must be inside a tweet
    const tweet = e.target.closest('article[data-testid="tweet"]');
    if (!tweet) return;

    // Allow non-status links to work normally
    const clickedLink = e.target.closest("a");
    if (clickedLink) {
      const href = clickedLink.getAttribute("href");
      if (href && !/\/status\/\d+/.test(href)) return;
    }

    const info = extractTweetInfo(e.target);
    if (!info) return;

    e.preventDefault();
    e.stopPropagation();

    // Highlight
    document.querySelector("article.xrs-active")?.classList.remove("xrs-active");
    info.article.classList.add("xrs-active");

    loadTweet(info.url, info.tweetId, info.isQuoteClick);
  }

  // --- Keyboard ---

  function handleKeyDown(e) {
    if (e.key === "Escape" && panel) {
      e.preventDefault();
      closePanel();
    }
  }

  // --- Init ---

  function init() {
    injectStyles();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown);
    console.log("[X Reply Sidebar] v2.0 initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
