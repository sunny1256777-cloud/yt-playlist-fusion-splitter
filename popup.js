/**
 * YouTube Fusion & Slicer - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  const pageTitle = document.getElementById('page-type-title');
  const pageDesc = document.getElementById('page-type-desc');
  const cardActions = document.getElementById('card-actions');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('youtube.com/watch')) {
    pageTitle.textContent = 'No Active YouTube Video';
    pageDesc.textContent = 'Open any YouTube playlist or lecture video to activate Fusion or Slicer.';
    return;
  }

  let listId = null;
  let videoId = null;
  try {
    const u = new URL(tab.url);
    listId = u.searchParams.get('list');
    videoId = u.searchParams.get('v');
  } catch (e) {}

  chrome.storage.local.get(['yt_fs_fusion_active'], (res) => {
    const isFusionActive = !!res.yt_fs_fusion_active;

    cardActions.innerHTML = '';

    if (listId) {
      pageTitle.textContent = '📋 YouTube Playlist Detected';
      pageDesc.textContent = isFusionActive
        ? 'Playlist Fusion is currently ON. All videos are merged into one continuous stream.'
        : 'Merge all playlist videos into a single continuous video with a unified timeline:';

      const fusionBtn = document.createElement('button');
      fusionBtn.className = 'btn btn-fusion';
      fusionBtn.textContent = isFusionActive ? '🔗 Turn Fusion OFF' : '🔗 Turn Playlist Fusion ON';
      fusionBtn.onclick = () => {
        chrome.storage.local.set({ yt_fs_fusion_active: !isFusionActive }, () => {
          chrome.tabs.reload(tab.id);
          window.close();
        });
      };
      cardActions.appendChild(fusionBtn);
    } else {
      pageTitle.textContent = '🎬 YouTube Video Detected';
      pageDesc.textContent = 'Split long lectures into isolated topic-by-topic mini-videos directly on the player:';
    }

    const slicerBtn = document.createElement('button');
    slicerBtn.className = 'btn btn-slicer';
    slicerBtn.textContent = '✂️ Open Topic Slicer on Player';
    slicerBtn.onclick = () => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn = document.getElementById('yt-fs-slicer-btn');
          if (btn) btn.click();
        },
      });
      window.close();
    };
    cardActions.appendChild(slicerBtn);
  });
});
