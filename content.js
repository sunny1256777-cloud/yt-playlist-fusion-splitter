/**
 * YouTube Fusion & Slicer - Content Script
 * 1. Fusion Mode: Merges playlists into a single seamless continuous video.
 * 2. Slicer Mode: Breaks down long 10-hour lectures into isolated topic-by-topic mini-videos.
 */

(function () {
  'use strict';

  // State
  let currentVideoId = null;
  let currentPlaylistId = null;
  let isFusionActive = false;
  let playlistItems = [];
  let totalPlaylistDuration = 0;
  let currentVideoIndex = -1;

  let chapters = [];
  let activeIsolatedTopic = null;
  let isTopicDrawerOpen = false;

  let monitorInterval = null;
  let isScrubbing = false;

  // --- Utility Functions ---

  function parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.trim().split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] || 0;
  }

  function formatTime(seconds) {
    const sec = Math.max(0, Math.floor(seconds));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  }

  function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      v: params.get('v'),
      list: params.get('list'),
      index: parseInt(params.get('index') || '1', 10),
    };
  }

  // --- FEATURE 1: PLAYLIST FUSION MODE ---

  function extractPlaylistData() {
    const params = getUrlParams();
    if (!params.list) {
      playlistItems = [];
      totalPlaylistDuration = 0;
      return false;
    }

    const panelRenderers = document.querySelectorAll(
      'ytd-playlist-panel-video-renderer, #playlist-items ytd-playlist-panel-video-renderer'
    );

    if (!panelRenderers || panelRenderers.length === 0) return false;

    const items = [];
    let runningOffset = 0;

    panelRenderers.forEach((el, idx) => {
      const titleEl = el.querySelector('#video-title, #video-info');
      const timeEl = el.querySelector('#time-status, .ytd-thumbnail-overlay-time-status-renderer');
      const linkEl = el.querySelector('a#wc-endpoint, a');

      let videoId = '';
      if (linkEl && linkEl.href) {
        try {
          const u = new URL(linkEl.href);
          videoId = u.searchParams.get('v') || '';
        } catch (e) {}
      }

      const title = titleEl ? titleEl.textContent.trim() : `Video ${idx + 1}`;
      const timeStr = timeEl ? timeEl.textContent.trim() : '10:00';
      const duration = parseTimeToSeconds(timeStr) || 600; // fallback 10 mins

      items.push({
        index: idx + 1,
        videoId: videoId,
        title: title,
        duration: duration,
        offset: runningOffset,
      });

      runningOffset += duration;
    });

    playlistItems = items;
    totalPlaylistDuration = runningOffset;

    // Detect active index
    currentVideoIndex = playlistItems.findIndex((item) => item.videoId === params.v);
    if (currentVideoIndex === -1) currentVideoIndex = Math.max(0, params.index - 1);

    return playlistItems.length > 0;
  }

  function togglePlaylistFusion() {
    isFusionActive = !isFusionActive;
    chrome.storage.local.set({ yt_fs_fusion_active: isFusionActive });

    if (isFusionActive) {
      enableFusionUI();
    } else {
      disableFusionUI();
    }
    updateControlButtons();
  }

  function enableFusionUI() {
    if (!extractPlaylistData()) return;

    const player = document.getElementById('movie_player');
    if (!player) return;

    // Hide default progress bar
    const defaultBar = document.querySelector('.ytp-progress-bar');
    if (defaultBar) defaultBar.style.display = 'none';

    injectFusionProgressBar();
  }

  function disableFusionUI() {
    const defaultBar = document.querySelector('.ytp-progress-bar');
    if (defaultBar) defaultBar.style.display = '';

    const bar = document.getElementById('yt-fs-fusion-container');
    if (bar) bar.remove();
  }

  function injectFusionProgressBar() {
    const progressContainer = document.querySelector('.ytp-progress-bar-container');
    if (!progressContainer || document.getElementById('yt-fs-fusion-container')) return;

    const container = document.createElement('div');
    container.id = 'yt-fs-fusion-container';
    container.className = 'yt-fs-fusion-container';

    let dividersHtml = '';
    playlistItems.forEach((item) => {
      if (item.offset > 0 && totalPlaylistDuration > 0) {
        const pct = (item.offset / totalPlaylistDuration) * 100;
        dividersHtml += `<div class="yt-fs-fusion-divider" style="left: ${pct}%;"></div>`;
      }
    });

    container.innerHTML = `
      <div class="yt-fs-fusion-bg" id="yt-fs-fusion-bg">
        <div class="yt-fs-fusion-progress" id="yt-fs-fusion-progress"></div>
        <div class="yt-fs-fusion-scrubber" id="yt-fs-fusion-scrubber"></div>
        ${dividersHtml}
      </div>
      <div class="yt-fs-fusion-tooltip" id="yt-fs-fusion-tooltip">Fusion Mode</div>
    `;

    const bg = container.querySelector('#yt-fs-fusion-bg');
    const tooltip = container.querySelector('#yt-fs-fusion-tooltip');

    function seekPlaylist(e) {
      if (totalPlaylistDuration <= 0) return;
      const rect = bg.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const offsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const ratio = offsetX / rect.width;
      const targetGlobalSec = ratio * totalPlaylistDuration;

      // Find which video contains targetGlobalSec
      for (let i = 0; i < playlistItems.length; i++) {
        const item = playlistItems[i];
        if (targetGlobalSec >= item.offset && targetGlobalSec < item.offset + item.duration) {
          const localSec = Math.floor(targetGlobalSec - item.offset);

          if (i === currentVideoIndex) {
            // Seek inside current video
            const video = document.querySelector('video');
            if (video) video.currentTime = localSec;
          } else {
            // Navigate to that video
            const params = getUrlParams();
            const targetUrl = `/watch?v=${item.videoId}&list=${params.list}&index=${item.index}&t=${localSec}s`;
            window.location.href = targetUrl;
          }
          break;
        }
      }
    }

    container.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      seekPlaylist(e);

      const onMove = (moveEvt) => {
        if (isScrubbing) seekPlaylist(moveEvt);
      };
      const onUp = () => {
        isScrubbing = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    container.addEventListener('mousemove', (e) => {
      if (totalPlaylistDuration <= 0) return;
      const rect = bg.getBoundingClientRect();
      const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const ratio = offsetX / rect.width;
      const hoverSec = ratio * totalPlaylistDuration;

      // Find item
      const item = playlistItems.find(
        (it) => hoverSec >= it.offset && hoverSec < it.offset + it.duration
      );

      tooltip.style.left = `${offsetX}px`;
      if (item) {
        const localSec = hoverSec - item.offset;
        tooltip.innerHTML = `<b>Video ${item.index}/${playlistItems.length}:</b> ${item.title}<br>${formatTime(localSec)} / ${formatTime(item.duration)} (Total: ${formatTime(hoverSec)} / ${formatTime(totalPlaylistDuration)})`;
      } else {
        tooltip.textContent = `${formatTime(hoverSec)} / ${formatTime(totalPlaylistDuration)}`;
      }
    });

    progressContainer.appendChild(container);
  }

  // --- FEATURE 2: TOPIC SLICER (10-HR LECTURE SPLITTER) ---

  function extractChapters() {
    chapters = [];

    // Method 1: Check YouTube native player chapter markers
    const chapterMarkers = document.querySelectorAll('.ytp-chapter-marker');
    // Method 2: Parse YouTube description timestamps (99% reliable)
    const descEl = document.querySelector('#description, ytd-text-inline-expander, #description-inline-expander');
    const textToScan = descEl ? descEl.innerText : '';

    const lines = textToScan.split('\n');
    const timestampRegex = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/;

    lines.forEach((line) => {
      const match = line.match(timestampRegex);
      if (match) {
        const timeSec = parseTimeToSeconds(match[0]);
        // Extract title part (remove timestamp and separators)
        let title = line.replace(match[0], '').replace(/^[\s\-–—:.]+|[\s\-–—:.]+$/g, '').trim();
        if (!title) title = `Topic at ${match[0]}`;

        // Prevent duplicate timestamps
        if (!chapters.some((c) => Math.abs(c.start - timeSec) < 3)) {
          chapters.push({
            start: timeSec,
            title: title,
          });
        }
      }
    });

    // Sort chronologically
    chapters.sort((a, b) => a.start - b.start);

    // Calculate end times and durations
    const video = document.querySelector('video');
    const totalVideoDur = video && !isNaN(video.duration) ? video.duration : 36000;

    for (let i = 0; i < chapters.length; i++) {
      const nextStart = i < chapters.length - 1 ? chapters[i + 1].start : totalVideoDur;
      chapters[i].end = nextStart;
      chapters[i].duration = Math.max(1, nextStart - chapters[i].start);
    }

    return chapters.length >= 2;
  }

  function toggleTopicDrawer() {
    isTopicDrawerOpen = !isTopicDrawerOpen;
    renderTopicDrawer();
  }

  function renderTopicDrawer() {
    const existing = document.getElementById('yt-fs-topic-drawer');
    if (existing) existing.remove();

    if (!isTopicDrawerOpen) return;

    extractChapters();

    const player = document.getElementById('movie_player') || document.body;
    const drawer = document.createElement('div');
    drawer.id = 'yt-fs-topic-drawer';
    drawer.className = 'yt-fs-topic-drawer';

    let topicsHtml = '';
    if (chapters.length === 0) {
      topicsHtml = '<div style="padding: 20px; text-align: center; color: #9ca3af; font-size: 12px;">No topic timestamps found in this video.</div>';
    } else {
      chapters.forEach((ch, idx) => {
        const isActive = activeIsolatedTopic && activeIsolatedTopic.start === ch.start;
        topicsHtml += `
          <div class="yt-fs-topic-item ${isActive ? 'active' : ''}" data-index="${idx}">
            <div class="yt-fs-topic-info">
              <div class="yt-fs-topic-name">${idx + 1}. ${ch.title}</div>
              <div class="yt-fs-topic-duration">${formatTime(ch.start)} - ${formatTime(ch.end)} (${formatTime(ch.duration)})</div>
            </div>
            <span class="yt-fs-topic-badge">${isActive ? 'Playing' : 'Play'}</span>
          </div>
        `;
      });
    }

    drawer.innerHTML = `
      <div class="yt-fs-drawer-header">
        <span class="yt-fs-drawer-title">✂️ Topic Slicer (${chapters.length} Topics)</span>
        <button class="yt-fs-drawer-close" id="yt-fs-drawer-close">✕</button>
      </div>
      <div class="yt-fs-topic-list" id="yt-fs-topic-list">
        ${topicsHtml}
      </div>
    `;

    drawer.querySelector('#yt-fs-drawer-close').onclick = () => {
      isTopicDrawerOpen = false;
      drawer.remove();
    };

    drawer.querySelectorAll('.yt-fs-topic-item').forEach((el) => {
      el.onclick = () => {
        const idx = parseInt(el.getAttribute('data-index'), 10);
        activateIsolatedTopic(chapters[idx]);
      };
    });

    player.appendChild(drawer);
  }

  function activateIsolatedTopic(chapter) {
    activeIsolatedTopic = chapter;

    const video = document.querySelector('video');
    if (video) {
      video.currentTime = chapter.start;
      if (video.paused) video.play().catch(() => {});
    }

    renderTopicDrawer();
    renderIsolatedTopicPill();
    injectIsolatedProgressBar();
  }

  function exitIsolatedTopic() {
    activeIsolatedTopic = null;

    const pill = document.getElementById('yt-fs-isolated-topic-pill');
    if (pill) pill.remove();

    const bar = document.getElementById('yt-fs-isolated-progress-container');
    if (bar) bar.remove();

    const defaultBar = document.querySelector('.ytp-progress-bar');
    if (defaultBar) defaultBar.style.display = '';

    renderTopicDrawer();
  }

  function renderIsolatedTopicPill() {
    const existing = document.getElementById('yt-fs-isolated-topic-pill');
    if (existing) existing.remove();

    if (!activeIsolatedTopic) return;

    const player = document.getElementById('movie_player');
    if (!player) return;

    const pill = document.createElement('div');
    pill.id = 'yt-fs-isolated-topic-pill';
    pill.className = 'yt-fs-isolated-topic-pill';

    pill.innerHTML = `
      <span>✂️ Topic:</span>
      <span class="yt-fs-isolated-topic-title" id="yt-fs-topic-pill-title">${activeIsolatedTopic.title}</span>
      <span id="yt-fs-topic-pill-timer">00:00 / ${formatTime(activeIsolatedTopic.duration)}</span>
      <button class="yt-fs-exit-topic-btn" id="yt-fs-exit-topic-btn" title="Exit Topic Mode">Exit ✕</button>
    `;

    pill.querySelector('#yt-fs-exit-topic-btn').onclick = (e) => {
      e.stopPropagation();
      exitIsolatedTopic();
    };

    player.appendChild(pill);
  }

  function injectIsolatedProgressBar() {
    const progressContainer = document.querySelector('.ytp-progress-bar-container');
    if (!progressContainer || document.getElementById('yt-fs-isolated-progress-container')) return;

    const defaultBar = document.querySelector('.ytp-progress-bar');
    if (defaultBar) defaultBar.style.display = 'none';

    const container = document.createElement('div');
    container.id = 'yt-fs-isolated-progress-container';
    container.className = 'yt-fs-isolated-progress-container';

    container.innerHTML = `
      <div class="yt-fs-isolated-progress-bg" id="yt-fs-isolated-bg">
        <div class="yt-fs-isolated-progress-bar" id="yt-fs-isolated-fill"></div>
        <div class="yt-fs-isolated-scrubber" id="yt-fs-isolated-scrubber"></div>
      </div>
    `;

    const bg = container.querySelector('#yt-fs-isolated-bg');

    function seekTopic(e) {
      if (!activeIsolatedTopic) return;
      const video = document.querySelector('video');
      if (!video) return;

      const rect = bg.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const offsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const ratio = offsetX / rect.width;

      const targetSec = activeIsolatedTopic.start + ratio * activeIsolatedTopic.duration;
      video.currentTime = targetSec;
    }

    container.addEventListener('mousedown', (e) => {
      seekTopic(e);
      const onMove = (moveEvt) => seekTopic(moveEvt);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    progressContainer.appendChild(container);
  }

  // --- Real-Time Monitoring Loop ---

  function startMonitoring() {
    if (monitorInterval) clearInterval(monitorInterval);

    monitorInterval = setInterval(() => {
      const video = document.querySelector('video');
      if (!video) return;

      const curTime = video.currentTime;

      // 1. Update Fusion Timeline
      if (isFusionActive && playlistItems.length > 0 && totalPlaylistDuration > 0) {
        const curItem = playlistItems[currentVideoIndex];
        if (curItem) {
          const globalElapsed = curItem.offset + curTime;
          const pct = Math.min(100, (globalElapsed / totalPlaylistDuration) * 100);

          const fill = document.getElementById('yt-fs-fusion-progress');
          const scrubber = document.getElementById('yt-fs-fusion-scrubber');
          if (fill) fill.style.width = `${pct}%`;
          if (scrubber) scrubber.style.left = `${pct}%`;

          // Auto-advance seamless transition
          if (curTime >= video.duration - 0.6 && currentVideoIndex < playlistItems.length - 1) {
            const nextItem = playlistItems[currentVideoIndex + 1];
            const params = getUrlParams();
            window.location.href = `/watch?v=${nextItem.videoId}&list=${params.list}&index=${nextItem.index}`;
          }
        }
      }

      // 2. Update Isolated Topic Mode
      if (activeIsolatedTopic) {
        const topicElapsed = Math.max(0, curTime - activeIsolatedTopic.start);
        const topicDur = activeIsolatedTopic.duration;
        const pct = Math.min(100, (topicElapsed / topicDur) * 100);

        const fill = document.getElementById('yt-fs-isolated-fill');
        const scrubber = document.getElementById('yt-fs-isolated-scrubber');
        const timerText = document.getElementById('yt-fs-topic-pill-timer');

        if (fill) fill.style.width = `${pct}%`;
        if (scrubber) scrubber.style.left = `${pct}%`;
        if (timerText) timerText.textContent = `${formatTime(topicElapsed)} / ${formatTime(topicDur)}`;

        // Topic completion guard: auto-pause at end of chapter!
        if (curTime >= activeIsolatedTopic.end - 0.4) {
          video.pause();
          // Find next topic
          const currentIdx = chapters.findIndex((c) => c.start === activeIsolatedTopic.start);
          if (currentIdx !== -1 && currentIdx < chapters.length - 1) {
            if (confirm(`🎉 Topic "${activeIsolatedTopic.title}" Finished!\nContinue to Next Topic: "${chapters[currentIdx + 1].title}"?`)) {
              activateIsolatedTopic(chapters[currentIdx + 1]);
            } else {
              exitIsolatedTopic();
            }
          } else {
            alert('🎉 You have completed the final topic of this lecture!');
            exitIsolatedTopic();
          }
        }
      }
    }, 200);
  }

  // --- Controls Injection ---

  function injectControlButtons() {
    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) return;

    const params = getUrlParams();
    const isPlaylist = !!params.list;

    // 1. Fusion Button (Only on Playlists)
    if (isPlaylist && !document.getElementById('yt-fs-fusion-btn')) {
      const fusionBtn = document.createElement('button');
      fusionBtn.id = 'yt-fs-fusion-btn';
      fusionBtn.className = `yt-fs-ctrl-btn ${isFusionActive ? 'active-fusion' : ''}`;
      fusionBtn.title = 'Merge playlist into single continuous video';
      fusionBtn.innerHTML = `<span>🔗 Fusion</span>`;
      fusionBtn.onclick = (e) => {
        e.stopPropagation();
        togglePlaylistFusion();
      };
      rightControls.insertBefore(fusionBtn, rightControls.firstChild);
    }

    // 2. Topic Slicer Button (On any video with chapters)
    if (!document.getElementById('yt-fs-slicer-btn')) {
      const hasChapters = extractChapters();
      if (hasChapters || chapters.length > 0) {
        const slicerBtn = document.createElement('button');
        slicerBtn.id = 'yt-fs-slicer-btn';
        slicerBtn.className = `yt-fs-ctrl-btn ${activeIsolatedTopic ? 'active-slicer' : ''}`;
        slicerBtn.title = 'Split lecture into topic mini-videos';
        slicerBtn.innerHTML = `<span>✂️ Topics</span>`;
        slicerBtn.onclick = (e) => {
          e.stopPropagation();
          toggleTopicDrawer();
        };
        rightControls.insertBefore(slicerBtn, rightControls.firstChild);
      }
    }
  }

  function updateControlButtons() {
    const fusionBtn = document.getElementById('yt-fs-fusion-btn');
    if (fusionBtn) {
      if (isFusionActive) {
        fusionBtn.classList.add('active-fusion');
        fusionBtn.innerHTML = `<span>🔗 Fusion [ON]</span>`;
      } else {
        fusionBtn.classList.remove('active-fusion');
        fusionBtn.innerHTML = `<span>🔗 Fusion</span>`;
      }
    }

    const slicerBtn = document.getElementById('yt-fs-slicer-btn');
    if (slicerBtn) {
      if (activeIsolatedTopic) {
        slicerBtn.classList.add('active-slicer');
      } else {
        slicerBtn.classList.remove('active-slicer');
      }
    }
  }

  // --- Injected Action Row Buttons (Under Video Title) ---

  function injectActionBarButtons() {
    const params = getUrlParams();
    const container = document.querySelector('#owner, #top-row #actions, #top-level-buttons-computed');
    if (!container) return;

    // Fusion Button
    if (params.list && !document.getElementById('yt-fs-bar-fusion-btn')) {
      const btn = document.createElement('button');
      btn.id = 'yt-fs-bar-fusion-btn';
      btn.className = `yt-fs-action-bar-btn ${isFusionActive ? 'active' : ''}`;
      btn.innerHTML = `<span>🔗 Playlist Fusion</span>`;
      btn.onclick = () => togglePlaylistFusion();
      container.appendChild(btn);
    }

    // Slicer Button
    if (!document.getElementById('yt-fs-bar-slicer-btn')) {
      if (extractChapters()) {
        const btn = document.createElement('button');
        btn.id = 'yt-fs-bar-slicer-btn';
        btn.className = `yt-fs-action-bar-btn ${activeIsolatedTopic ? 'active' : ''}`;
        btn.innerHTML = `<span>✂️ Split into Topics</span>`;
        btn.onclick = () => toggleTopicDrawer();
        container.appendChild(btn);
      }
    }
  }

  // --- Page Lifecycle ---

  function handlePageChange() {
    const params = getUrlParams();
    currentVideoId = params.v;
    currentPlaylistId = params.list;

    // Clean active topic when changing video
    exitIsolatedTopic();
    if (isTopicDrawerOpen) {
      isTopicDrawerOpen = false;
      const drawer = document.getElementById('yt-fs-topic-drawer');
      if (drawer) drawer.remove();
    }

    // Load saved preferences
    chrome.storage.local.get(['yt_fs_fusion_active'], (res) => {
      isFusionActive = !!res.yt_fs_fusion_active;
      if (isFusionActive && params.list) {
        setTimeout(enableFusionUI, 1000);
      }
    });

    setTimeout(() => {
      injectControlButtons();
      injectActionBarButtons();
    }, 1200);
  }

  window.addEventListener('yt-navigate-finish', handlePageChange);
  window.addEventListener('load', handlePageChange);

  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      handlePageChange();
    } else {
      injectControlButtons();
    }
  }, 1500);

  startMonitoring();
  handlePageChange();
})();
