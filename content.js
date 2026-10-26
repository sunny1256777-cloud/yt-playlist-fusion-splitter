/**
 * YouTube Fusion & Slicer - Content Script
 * 1. Fusion Mode: Merges playlists into a single seamless continuous video WITHOUT page refreshes.
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
  let isTransitioning = false;

  // --- Main World Bridge (Zero-Reload Player Navigation) ---

  function injectMainWorldBridge() {
    if (document.getElementById('yt-fs-main-bridge')) return;

    const script = document.createElement('script');
    script.id = 'yt-fs-main-bridge';
    script.textContent = `
      (function() {
        window.addEventListener('message', function(evt) {
          if (!evt.data || evt.data.type !== 'YT_FS_SEAMLESS_ACTION') return;
          var player = document.getElementById('movie_player');

          if (evt.data.action === 'NEXT_VIDEO') {
            if (player && typeof player.nextVideo === 'function') {
              player.nextVideo();
              return;
            }
            var nextBtn = document.querySelector('.ytp-next-button');
            if (nextBtn) {
              nextBtn.click();
              return;
            }
          }

          if (evt.data.action === 'LOAD_VIDEO') {
            var videoId = evt.data.videoId;
            var startSeconds = evt.data.startSeconds || 0;
            if (player && typeof player.loadVideoById === 'function') {
              try {
                player.loadVideoById({
                  videoId: videoId,
                  startSeconds: startSeconds
                });
              } catch (e) {
                player.loadVideoById(videoId, startSeconds);
              }
              if (typeof player.playVideo === 'function') {
                player.playVideo();
              }
              return;
            }
          } else if (evt.data.action === 'SEEK') {
            if (player && typeof player.seekTo === 'function') {
              player.seekTo(evt.data.seconds, true);
            }
          }
        });
      })();
    `;
    (document.head || document.documentElement).appendChild(script);
  }

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
    let selectedIdx = -1;

    panelRenderers.forEach((el, idx) => {
      if (el.hasAttribute('selected')) {
        selectedIdx = idx;
      }

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
      const duration = parseTimeToSeconds(timeStr) || 600;

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

    if (selectedIdx !== -1) {
      currentVideoIndex = selectedIdx;
    } else {
      currentVideoIndex = playlistItems.findIndex((item) => item.videoId === params.v);
      if (currentVideoIndex === -1) currentVideoIndex = Math.max(0, params.index - 1);
    }

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

      for (let i = 0; i < playlistItems.length; i++) {
        const item = playlistItems[i];
        if (targetGlobalSec >= item.offset && targetGlobalSec < item.offset + item.duration) {
          const localSec = Math.floor(targetGlobalSec - item.offset);

          if (i === currentVideoIndex) {
            const video = document.querySelector('video');
            if (video) video.currentTime = localSec;
          } else {
            // Seamless switch WITHOUT page reload!
            switchVideoSeamlessly(item, localSec);
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

  // --- Seamless Video Switching (Zero Page Reload) ---

  function updatePlaylistHighlight(activeIndex) {
    const renderers = document.querySelectorAll(
      'ytd-playlist-panel-video-renderer, #playlist-items ytd-playlist-panel-video-renderer'
    );
    renderers.forEach((el, idx) => {
      if (idx === activeIndex) {
        el.setAttribute('selected', '');
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {}
      } else {
        el.removeAttribute('selected');
      }
    });
  }

  function switchVideoSeamlessly(targetItem, startSeconds = 0) {
    if (isTransitioning) return;
    isTransitioning = true;

    currentVideoId = targetItem.videoId;
    currentVideoIndex = targetItem.index - 1;

    // 1. Send instruction to main-world player API (instant stream swap, zero reload)
    window.postMessage({
      type: 'YT_FS_SEAMLESS_ACTION',
      action: 'LOAD_VIDEO',
      videoId: targetItem.videoId,
      startSeconds: startSeconds || 0,
    }, '*');

    // 2. Update browser address bar without reloading
    const params = getUrlParams();
    const newUrl = `/watch?v=${targetItem.videoId}&list=${params.list || currentPlaylistId}&index=${targetItem.index}${startSeconds > 0 ? `&t=${startSeconds}s` : ''}`;
    window.history.pushState(null, '', newUrl);

    // 3. Update playlist drawer highlight & title
    updatePlaylistHighlight(currentVideoIndex);
    if (targetItem.title) {
      const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string');
      if (titleEl) titleEl.textContent = targetItem.title;
      document.title = `${targetItem.title} - YouTube`;
    }

    // 4. Fallback seek verification
    if (startSeconds > 0) {
      setTimeout(() => {
        const v = document.querySelector('video');
        if (v && Math.abs(v.currentTime - startSeconds) > 2) {
          v.currentTime = startSeconds;
        }
      }, 500);
    }

    updateControlButtons();

    setTimeout(() => {
      isTransitioning = false;
    }, 1500);
  }

  function advanceToNextVideoSeamlessly() {
    if (isTransitioning || !isFusionActive) return;
    if (currentVideoIndex >= playlistItems.length - 1) return;

    isTransitioning = true;
    const nextIndex = currentVideoIndex + 1;
    const nextItem = playlistItems[nextIndex];

    currentVideoIndex = nextIndex;
    currentVideoId = nextItem.videoId;

    // 1. Send instruction to main-world player API (zero reload in-memory transition)
    window.postMessage({
      type: 'YT_FS_SEAMLESS_ACTION',
      action: 'NEXT_VIDEO',
      videoId: nextItem.videoId,
    }, '*');

    // 2. Update browser address bar without reloading
    const params = getUrlParams();
    const newUrl = `/watch?v=${nextItem.videoId}&list=${params.list || currentPlaylistId}&index=${nextItem.index}`;
    window.history.pushState(null, '', newUrl);

    // 3. Update playlist drawer highlight & title
    updatePlaylistHighlight(nextIndex);
    if (nextItem.title) {
      const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string');
      if (titleEl) titleEl.textContent = nextItem.title;
      document.title = `${nextItem.title} - YouTube`;
    }

    updateControlButtons();

    setTimeout(() => {
      isTransitioning = false;
    }, 1500);
  }

  // --- FEATURE 2: TOPIC SLICER (10-HR LECTURE SPLITTER) ---

  function extractChapters() {
    chapters = [];

    const descEl = document.querySelector('#description, ytd-text-inline-expander, #description-inline-expander');
    const textToScan = descEl ? descEl.innerText : '';

    const lines = textToScan.split('\n');
    const timestampRegex = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/;

    lines.forEach((line) => {
      const match = line.match(timestampRegex);
      if (match) {
        const timeSec = parseTimeToSeconds(match[0]);
        let title = line.replace(match[0], '').replace(/^[\s\-–—:.]+|[\s\-–—:.]+$/g, '').trim();
        if (!title) title = `Topic at ${match[0]}`;

        if (!chapters.some((c) => Math.abs(c.start - timeSec) < 3)) {
          chapters.push({
            start: timeSec,
            title: title,
          });
        }
      }
    });

    chapters.sort((a, b) => a.start - b.start);

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

      // Dynamically attach 'ended' event listener to the active video tag
      if (!video._ytFsEndedBound) {
        video._ytFsEndedBound = true;
        video.addEventListener('ended', () => {
          if (isFusionActive && !isTransitioning) {
            advanceToNextVideoSeamlessly();
          }
        });
      }

      const curTime = video.currentTime;

      // 1. Update Fusion Timeline
      if (isFusionActive && playlistItems.length > 0 && totalPlaylistDuration > 0) {
        // Sync index if playlist panel selection moved
        const activeRenderer = document.querySelector('ytd-playlist-panel-video-renderer[selected]');
        if (activeRenderer) {
          const renderers = Array.from(document.querySelectorAll('ytd-playlist-panel-video-renderer'));
          const foundIdx = renderers.indexOf(activeRenderer);
          if (foundIdx !== -1 && foundIdx !== currentVideoIndex) {
            currentVideoIndex = foundIdx;
            if (playlistItems[currentVideoIndex]) {
              currentVideoId = playlistItems[currentVideoIndex].videoId;
            }
          }
        }

        const curItem = playlistItems[currentVideoIndex];
        if (curItem) {
          const globalElapsed = curItem.offset + curTime;
          const pct = Math.min(100, (globalElapsed / totalPlaylistDuration) * 100);

          const fill = document.getElementById('yt-fs-fusion-progress');
          const scrubber = document.getElementById('yt-fs-fusion-scrubber');
          if (fill) fill.style.width = `${pct}%`;
          if (scrubber) scrubber.style.left = `${pct}%`;

          // Seamless auto-advance within 0.5s of ending (NO PAGE RELOAD)
          if (curTime >= video.duration - 0.5 && !isTransitioning) {
            advanceToNextVideoSeamlessly();
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

        // Topic completion guard
        if (curTime >= activeIsolatedTopic.end - 0.4) {
          video.pause();
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

    if (params.list && !document.getElementById('yt-fs-bar-fusion-btn')) {
      const btn = document.createElement('button');
      btn.id = 'yt-fs-bar-fusion-btn';
      btn.className = `yt-fs-action-bar-btn ${isFusionActive ? 'active' : ''}`;
      btn.innerHTML = `<span>🔗 Playlist Fusion</span>`;
      btn.onclick = () => togglePlaylistFusion();
      container.appendChild(btn);
    }

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

    injectMainWorldBridge();
    exitIsolatedTopic();

    if (isTopicDrawerOpen) {
      isTopicDrawerOpen = false;
      const drawer = document.getElementById('yt-fs-topic-drawer');
      if (drawer) drawer.remove();
    }

    chrome.storage.local.get(['yt_fs_fusion_active'], (res) => {
      isFusionActive = !!res.yt_fs_fusion_active;
      if (isFusionActive && params.list) {
        setTimeout(enableFusionUI, 800);
      }
    });

    setTimeout(() => {
      injectControlButtons();
      injectActionBarButtons();
    }, 1000);
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
  }, 1200);

  injectMainWorldBridge();
  startMonitoring();
  handlePageChange();
})();
