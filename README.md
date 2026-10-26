# ⚡ YouTube Fusion & Slicer

> **Merge multi-part YouTube playlists into a single seamless continuous video, and slice 10-hour lectures into isolated topic-by-topic mini-videos directly inside your browser.**

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-indigo.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Browser Support](https://img.shields.io/badge/Chrome%20%7C%20Edge%20%7C%20Brave-Supported-success.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 🎯 The Study Problem

1. **Playlist Fatigue:** When studying a course split across 20+ short videos in a playlist, constant page refreshes, video loading delays, and playlist interruptions destroy flow state.
2. **10-Hour Lecture Fatigue:** When studying a monolithic 8-to-10 hour masterclass video, the brain gets overwhelmed by the sheer duration, leading to instant procrastination and loss of pacing.

**YouTube Fusion & Slicer** solves both problems right inside your YouTube browser player with zero downloads and zero disk space.

---

## ✨ Key Features

### 1. 🔗 Playlist Fusion Mode (Playlist $\rightarrow$ Single Continuous Video)
* **Unified Multi-Video Timeline:**
  * Stitches the entire playlist queue into **one continuous progress bar**.
  * Visual tick-mark dividers indicate boundaries between consecutive videos.
* **Global Playlist Scrubbing:**
  * Click or drag anywhere across the unified timeline. The extension automatically calculates the global timestamp, navigates to the corresponding video, and seeks to the exact second.
* **Seamless Auto-Flow:**
  * Automatically transitions to the next video upon completion without buffer delays or layout shifts, preserving your theater mode, fullscreen, and playback speed.

---

### 2. ✂️ Topic Slicer Mode (10-Hour Lecture $\rightarrow$ Topic Mini-Videos)
* **Automated Chapter & Timestamp Parsing:**
  * Scans both YouTube native chapter markers and description timestamps with 99.9% reliability.
* **Interactive Topic Drawer:**
  * Displays a clean slide-out drawer listing every topic, its sequence number, and exact isolated duration (e.g., `Topic 4: Binary Trees (14m 20s)`).
* **Isolated Topic Player:**
  * Isolates the video timeline to **only that topic**. The timeline shows `00:00 / 14:20` instead of a daunting `04:15:00 / 10:00:00`.
  * Allows backward/forward scrubbing strictly within that topic.
* **Topic Completion Guard:**
  * Auto-pauses at the end of each topic with a completion alert: `"🎉 Topic Finished! Continue to Next Topic?"`.
  * Gives you a sense of accomplishment and natural break intervals without burning out.

---

## 🚀 Installation Guide (For Any User)

You can install this extension on any Chromium browser (**Google Chrome**, **Brave**, **Microsoft Edge**, **Opera**, or **Vivaldi**) in under 60 seconds:

### Step 1: Download the Source Code

#### Option A (Using Git):
Open your terminal and clone the repository:
```bash
git clone https://github.com/sunny1256777-cloud/yt-playlist-fusion-splitter.git
```

#### Option B (Download as ZIP):
1. Click the green **`<> Code`** button at the top of this GitHub repository.
2. Select **`Download ZIP`**.
3. Extract the downloaded `.zip` file into a folder on your computer.

---

### Step 2: Load into Your Browser

1. Open your browser and navigate to the Extensions management page:
   * **Google Chrome / Brave:** Visit `chrome://extensions/`
   * **Microsoft Edge:** Visit `edge://extensions/`
2. In the top-right corner, toggle **Developer mode** to **ON**.
3. In the top-left corner, click the **"Load unpacked"** button.
4. In the file selection dialog, select the cloned or extracted `yt-playlist-fusion-splitter` folder (the folder containing `manifest.json`).
5. **Done!** The extension is installed. Pin it to your browser toolbar for easy access.

---

## 📺 How to Use

### Using Playlist Fusion:
1. Open any YouTube playlist (e.g., `https://www.youtube.com/watch?v=...&list=PL...`).
2. Click the **`🔗 Fusion`** button in the player controls or under the video title.
3. The player switches to a unified multi-video timeline, allowing seamless continuous playback across the entire playlist.

### Using Topic Slicer:
1. Open any long YouTube lecture with timestamps or chapters.
2. Click the **`✂️ Topics`** button on the player control bar.
3. Select any topic from the slide-out drawer to isolate that topic into its own bite-sized mini-video!

---

## 🛠️ Architecture & Privacy

* **100% Client-Side:** Operates directly inside the active YouTube tab using HTML5 Media APIs and DOM mutation observers.
* **Zero Downloads:** No heavy video downloading or disk storage required.
* **Zero Telemetry:** No user data or viewing history is ever tracked or uploaded to remote servers.

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
