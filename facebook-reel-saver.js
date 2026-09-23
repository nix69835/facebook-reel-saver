/* Facebook Reel Saver v1.0 — self-contained bookmarklet source.
 * Run on facebook.com while logged in, with the reel open and playing.
 * Uses the visible player and JSON delivered for the current video ID.
 * Makes no requests to third-party download services and reads no cookies.
 * Best effort: no DRM, DASH/HLS muxing, or access-control bypass.
 */
void (async function facebookReelSaver() {
  "use strict";
  if (!/(^|\.)facebook\.com$/i.test(location.hostname)) {
    alert("Open the reel on facebook.com in your browser first.");
    return;
  }
  const panelId = "fb-reel-saver-panel-v1";
  const existing = document.getElementById(panelId);
  if (existing) {
    existing.shadowRoot.querySelector("button").focus();
    return;
  }

  // Prefer a playing, visible player; ignore offscreen preloaded videos.
  const players = [...document.querySelectorAll("video")].map(video => {
    const r = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
      Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return {video, score: style.visibility === "hidden" || style.display === "none" ||
      Number(style.opacity) === 0 || !area ? 0 : area + (!video.paused && !video.ended ? 1e9 : 0)};
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  const player = players[0]?.video;
  const pageURL = new URL(location.href);
  const pathID = pageURL.pathname.match(/\/(?:reels?|videos)\/(?:[^/]+\/)?(\d+)(?:\/|$)/)?.[1];
  const possibleID = pathID || pageURL.searchParams.get("v") ||
    player?.closest("[data-video-id]")?.getAttribute("data-video-id");
  const videoID = /^\d+$/.test(possibleID || "") ? possibleID : "";
  const startedAtURL = location.href;

  const host = document.createElement("div");
  host.id = panelId;
  host.style.cssText = "all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;width:min(420px,calc(100vw - 24px));";
  const root = host.attachShadow({mode: "open"});
  const style = document.createElement("style");
  style.textContent = ":host{color-scheme:light}section{font:14px/1.5 system-ui,sans-serif;background:white;color:#142138;border:1px solid #ccd5e4;border-radius:14px;padding:18px;box-shadow:0 8px 40px #0005;max-height:80vh;overflow:auto}h2{font-size:19px;margin:0 40px 12px 0}p{margin:10px 0}button,a{font:inherit}button{cursor:pointer;background:#0866ff;color:white;border:0;border-radius:8px;padding:10px 14px;min-height:44px}button:disabled{opacity:.6;cursor:wait}a{color:#075bc9;display:inline-block;padding:10px 0;margin-left:14px}article{border-top:1px solid #dce2eb;padding:12px 0}strong{display:block;margin-bottom:8px}small{display:block;color:#526078;margin-top:8px}button:focus-visible,a:focus-visible{outline:3px solid #ffab00;outline-offset:2px}.close{float:right;background:#edf1f7;color:#142138;margin:-6px -6px 0 0}";
  root.append(style);
  function element(tag, text, parent) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    (parent || box).append(node);
    return node;
  }
  const box = element("section", "", root);
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Facebook Reel Saver");
  const closeButton = element("button", "Close");
  closeButton.className = "close";
  element("h2", "Facebook Reel Saver");
  const status = element("p", "Looking for a complete video file…");
  status.setAttribute("role", "status");
  const options = element("div");
  element("small", "Keep this reel open until the download finishes. Links can expire; rerun the bookmark for a fresh link.");
  (document.body || document.documentElement).append(host);
  const aborter = new AbortController();
  const localURLs = [];
  let closed = false;
  function close() {
    closed = true;
    aborter.abort();
    host.remove();
    document.removeEventListener("keydown", escape);
    // Allow a download already handed to the browser to finish starting.
    setTimeout(() => localURLs.forEach(url => URL.revokeObjectURL(url)), 60000);
  }
  function escape(event) { if (event.key === "Escape") close(); }
  closeButton.addEventListener("click", close);
  document.addEventListener("keydown", escape);
  closeButton.focus();

  const candidates = new Map();
  const fields = {
    browser_native_hd_url: "HD", playable_url_quality_hd: "HD",
    hd_src: "HD", hd_src_no_ratelimit: "HD",
    browser_native_sd_url: "SD", playable_url: "SD",
    sd_src: "SD", sd_src_no_ratelimit: "SD", progressive_url: "Progressive"
  };
  const fieldPattern = /browser_native_(?:hd|sd)_url|playable_url|\b(?:hd|sd)_src|progressive_url/;
  function add(raw, label, rank) {
    if (typeof raw !== "string") return;
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== "https:") return;
      if (!/(^|\.)(facebook\.com|fbcdn\.net|fbsbx\.com)$/i.test(url.hostname)) return;
      if (/\.(?:mpd|m3u8|m4s|ts|aac)(?:$|\/)/i.test(url.pathname)) return;
      if (["bytestart", "byteend", "range"].some(key => url.searchParams.has(key))) return;
      const previous = candidates.get(url.href);
      if (!previous || rank > previous.rank) candidates.set(url.href, {url: url.href, label, rank});
    } catch (_) { /* Ignore malformed/non-file URLs. */ }
  }

  // Only accept JSON URLs under the requested ID. A new ID resets the scope,
  // so preloaded/recommended reels cannot donate their download URLs.
  function scanJSON(text) {
    if (!videoID || !text || text.length > 12000000 || !fieldPattern.test(text)) return;
    let data;
    try { data = JSON.parse(text); } catch (_) { return; }
    const stack = [[data, false, 0]];
    let visited = 0;
    while (stack.length && ++visited < 150000) {
      const [node, inherited, depth] = stack.pop();
      if (depth > 80 || !node || typeof node !== "object") continue;
      const ownID = node.video_id ?? node.videoId ?? node.id;
      const scoped = ownID == null ? inherited : String(ownID) === videoID;
      for (const [key, value] of Object.entries(node)) {
        if (scoped && Object.hasOwn(fields, key)) {
          const quality = key === "progressive_url" ? String(node.metadata?.quality || "Progressive").toUpperCase() : fields[key];
          add(value, quality + " · page video", quality === "HD" ? 30 : quality === "SD" ? 20 : 25);
        }
        if (value && typeof value === "object") stack.push([value, scoped, depth + 1]);
        else if (typeof value === "string" && /^[\s]*[\[{]/.test(value) && fieldPattern.test(value)) {
          try { stack.push([JSON.parse(value), scoped, depth + 1]); } catch (_) { /* Not JSON. */ }
        }
      }
    }
  }

  async function get(url, kind) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    aborter.signal.addEventListener("abort", cancel, {once: true});
    const timer = setTimeout(cancel, kind === "page" ? 20000 : 180000);
    try {
      if (closed) throw new Error("Closed");
      const response = await fetch(url, {
        credentials: "same-origin", mode: "cors", signal: controller.signal,
        referrerPolicy: "strict-origin-when-cross-origin"
      });
      if (!response.ok || response.status === 206) throw new Error("Unavailable or incomplete response");
      if (kind === "page") {
        if (new URL(response.url || url).origin !== location.origin) throw new Error("Redirected off site");
        return await response.text();
      }
      // Verify file bytes instead of saving an HTML error page as an MP4.
      if (Number(response.headers.get("content-length")) > 256 * 1024 * 1024) throw new Error("File too large for in-page saving");
      const blob = await response.blob();
      if (!blob.size || blob.size > 256 * 1024 * 1024) throw new Error("File size unsupported");
      const header = new Uint8Array(await blob.slice(0, 40).arrayBuffer());
      const text = String.fromCharCode(...header);
      const extension = text.slice(4, 8) === "ftyp" ? "mp4" :
        header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3 ? "webm" : "";
      if (!extension) throw new Error("Not a supported complete video file");
      return {blob, extension};
    } finally {
      clearTimeout(timer);
      aborter.signal.removeEventListener("abort", cancel);
    }
  }

  try {
    for (const script of document.querySelectorAll('script[type="application/json"],script[data-sjs]')) scanJSON(script.textContent);

    // A loaded player URL is usable without a public post or a public group.
    if (player) {
      const sources = player.currentSrc ? [player.currentSrc] :
        [player.getAttribute("src"), ...[...player.querySelectorAll("source")].map(node => node.getAttribute("src"))];
      for (const source of sources) add(source, "Current player · check picture and sound", 10);
    }

    // Facebook navigation can leave the initial page JSON out of date. Fetch
    // this exact same-origin page with the existing session, never an API token.
    if (!candidates.size && videoID) {
      status.textContent = "Checking this reel's page data…";
      const html = await get(startedAtURL, "page");
      // Extract script text without injecting fetched HTML or executing scripts.
      for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) scanJSON(match[1]);
    }
    if (closed) return;
    if (location.href !== startedAtURL) {
      status.textContent = "The reel changed. Close this panel and run the bookmark again.";
      return;
    }
    if (!candidates.size) {
      status.textContent = videoID ?
        "No complete video file was exposed for this reel. It may use segmented streaming, or Facebook's page format may have changed. This bookmarklet cannot merge separate audio/video streams." :
        "Open the reel itself (a /reel/… or video link), play it, then run the bookmark again. A group/feed page may contain several unrelated videos.";
      return;
    }
    status.textContent = "Choose a file. If saving fails, use Open video, then your browser's Download or Save video command.";
    for (const item of [...candidates.values()].sort((a, b) => b.rank - a.rank).slice(0, 8)) {
      const row = element("article", "", options);
      element("strong", item.label, row);
      const save = element("button", "Download", row);
      const open = element("a", "Open video ↗", row);
      open.href = item.url;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      const note = element("small", "", row);
      save.addEventListener("click", async () => {
        if (location.href !== startedAtURL) {
          note.textContent = "The reel changed. Close and rerun the bookmark.";
          return;
        }
        save.disabled = true;
        note.textContent = "Downloading… keep this tab open.";
        try {
          const {blob, extension} = await get(item.url, "video");
          if (closed) return;
          const localURL = URL.createObjectURL(blob);
          localURLs.push(localURL);
          const link = element("a", "Save file again", row);
          link.href = localURL;
          link.download = "facebook-reel-" + (videoID || Date.now()) + "." + extension;
          link.click();
          note.textContent = "File handed to your browser (" + (blob.size / 1048576).toFixed(1) + " MB). If nothing saved, tap Save file again.";
          save.textContent = "Fetched";
        } catch (_) {
          if (!closed) {
            note.textContent = "Could not fetch a complete file. Tap Open video, then use the player's Download menu or Save video as. If that fails, rerun for a fresh link.";
            save.disabled = false;
          }
        }
      });
    }
  } catch (_) {
    if (!closed) status.textContent = "Could not read this reel's data. Refresh its own page, play it, and run the bookmark again. If it still fails, this Facebook layout is unsupported.";
  }
})()
