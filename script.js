// =============================================================================
// Cached DOM elements
// =============================================================================
const sideMenu = document.getElementById('sideMenu');
const contentArea = document.getElementById('contentArea');
const channelPickerEl = document.getElementById('channelPicker');
const videoContainerEl = document.getElementById('videoContainer');
const backButtonEl = document.getElementById('backButton');
const multiViewButtonEl = document.getElementById('multiViewButton');
const muteButtonEl = document.getElementById('muteButton');
const noResultsEl = document.getElementById('noResults');
const channelInputDisplay = document.getElementById('channel-input-display');
const channelInputSpans = channelInputDisplay
  ? channelInputDisplay.querySelectorAll('span')
  : [];
const globalSearchEl = document.getElementById('globalSearch');
const menuSearchEl = document.getElementById('menuSearch');
const multiViewContainerEl = document.getElementById('multiViewContainer');
const multiViewGridEl = document.getElementById('multiViewGrid');
const mvControlsEl = document.querySelector('.multi-view-controls');

// =============================================================================
// Application state
// =============================================================================
let isPickerVisible = true;
let isMenuVisible = true;
let isFilterApplied = true;
let currentVideoElement = null;
let currentAudioElement = null; // For dual-stream channels
let isMuted = true; // Start muted for autoplay compatibility
let searchTerm = '';

// Active HLS instances for cleanup
let activeHlsInstances = [];

// Multi-view state
let isMultiViewMode = false;
let multiViewSlots = [];
let activeAudioSlot = null;
let currentGridLayout = '2x2';
let fullscreenSlotIndex = null;

// AbortControllers for slot-specific listeners
let slotAbortControllers = [];

// Numeric channel input state
let channelInput = [];
let channelInputTimer = null;

// =============================================================================
// Utilities
// =============================================================================
function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function releaseVideoElement(video) {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function handleImageError() {
  this.style.display = 'none';
}

// =============================================================================
// Toast notifications
// =============================================================================
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove());
    setTimeout(() => toast.remove(), 500);
  }, duration);
}

// =============================================================================
// Safe localStorage helpers
// =============================================================================
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn('localStorage not available:', e);
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn('localStorage not available:', e);
  }
}

// Favorites
let favorites = JSON.parse(safeGetItem('favoriteChannels') || '[]');

// =============================================================================
// Channel exclusion logic
// =============================================================================
function isExcludedChannel(channelName) {
  const lowerName = channelName.toLowerCase();
  const normalizedName = lowerName.replace(/[\s\-_]/g, '');

  if (normalizedName === 'wep' || normalizedName === 'we2') return true;
  if (normalizedName.includes('bloomberg')) return true;
  if (normalizedName.includes('foxlive')) return true;
  if (normalizedName.includes('reuterstvus') || normalizedName === 'reuterstvus') return true;
  if (lowerName.includes('rick') && lowerName.includes('morty')) return true;

  return false;
}

// Clean up stored channels from excluded list
favorites = favorites.filter(ch => !isExcludedChannel(ch.name));
safeSetItem('favoriteChannels', JSON.stringify(favorites));

// Fast lookup set for favorite channel names (kept in sync with favorites array)
const favoriteNames = new Set(favorites.map(ch => ch.name));

// Remove legacy recentChannels data if present
safeSetItem('recentChannels', '');


// =============================================================================
// HLS.js configuration — tuned for live recording reliability
// =============================================================================
const HLS_CONFIG = {
  // Buffer: large buffer to survive network hiccups without stalling
  maxBufferLength: 120,          // Buffer up to 120s ahead (default: 30)
  maxMaxBufferLength: 300,       // Hard cap at 5 minutes (default: 600)
  maxBufferSize: 200 * 1000000,  // 200MB buffer size (default: 60MB)
  backBufferLength: 60,          // Keep 60s of played content for brief seek-back

  // Latency: prefer smooth playback over chasing the live edge
  lowLatencyMode: false,
  liveSyncDurationCount: 4,      // Stay 4 segments behind live edge (more buffer room)
  liveMaxLatencyDurationCount: 10, // Allow up to 10 segments behind before seeking forward

  // Loading: patient retries — never give up on a recording
  fragLoadingTimeOut: 30000,     // Wait 30s for a fragment (default: 20s)
  fragLoadingMaxRetry: 10,       // Retry a fragment 10 times (default: 6)
  fragLoadingRetryDelay: 2000,   // Wait 2s between retries (default: 1s)
  manifestLoadingTimeOut: 20000, // Wait 20s for manifest (default: 10s)
  manifestLoadingMaxRetry: 6,    // Retry manifest 6 times (default: 1)
  manifestLoadingRetryDelay: 2000,
  levelLoadingTimeOut: 20000,    // Wait 20s for level playlist (default: 10s)
  levelLoadingMaxRetry: 6,       // Retry level playlist 6 times (default: 4)
  levelLoadingRetryDelay: 2000,

  // Performance
  startFragPrefetch: true,       // Prefetch next fragment during manifest parse
  enableWorker: true,            // Demux in Web Worker (avoids main-thread jank)
};

// Multi-view: same resilient buffering, but drop the back-buffer since
// users aren't seeking back on individual multi-view tiles.
const HLS_MULTIVIEW_CONFIG = {
  ...HLS_CONFIG,
  backBufferLength: 0,
};

// =============================================================================
// Shared helpers & constants
// =============================================================================
// Supplemental English live news channels (free public streams)
const SUPPLEMENTAL_CHANNELS = [
  {
    name: 'Sky News',
    logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/7/74/Sky_News_logo.svg/512px-Sky_News_logo.svg.png',
    url: 'https://linear417-gb-hls1-prd-ak.cdn.skycdp.com/100e/Content/HLS_001_1080_30/Live/channel(skynews)/index_1080-30.m3u8',
    groupTitle: 'Live News',
  },
];

const MAKO_IFRAME_URL =
  'https://www.mako.co.il/AjaxPage?jspName=embedHTML5video.jsp' +
  '&galleryChannelId=7c5076a9b8757810VgnVCM100000700a10acRCRD' +
  '&videoChannelId=d1d6f5dfc8517810VgnVCM100000700a10acRCRD' +
  '&vcmid=1e2258089b67f510VgnVCM2000002a0c10acRCRD';

const KANAL_13_VIDEO_URL =
  'https://d1zqtf09wb8nt5.cloudfront.net/livehls/oil/freetv/live/reshet_13_hevc/live.livx/playlist.m3u8' +
  '?bitrate=5500000&videoId=0&renditions&fmp4&dvr=28800000';

const KANAL_13_AUDIO_URL =
  'https://d1zqtf09wb8nt5.cloudfront.net/livehls/oil/freetv/live/reshet_13_hevc/live.livx/playlist.m3u8' +
  '?bitrate=128000&audioId=1&lang=pol&renditions&fmp4&dvr=28800000';

function createMakoIframe() {
  const iframe = document.createElement('iframe');
  iframe.src = MAKO_IFRAME_URL;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.allowFullscreen = true;
  return iframe;
}

function updateMuteButtonState(muted) {
  muteButtonEl.textContent = muted ? '🔇' : '🔊';
  if (muted) {
    muteButtonEl.classList.add('muted');
    muteButtonEl.title = 'Unmute';
  } else {
    muteButtonEl.classList.remove('muted');
    muteButtonEl.title = 'Mute';
  }
}

function updateMuteButtonVisibility(visible) {
  muteButtonEl.style.display = visible ? 'flex' : 'none';
}

function destroyActiveHls() {
  activeHlsInstances.forEach(hls => {
    try {
      hls.destroy();
    } catch (e) {
      console.warn('Error destroying HLS instance:', e);
    }
  });
  activeHlsInstances = [];
}

function showVideoView() {
  videoContainerEl.style.display = 'block';
  channelPickerEl.style.display = 'none';
  backButtonEl.style.display = 'block';
  multiViewButtonEl.style.display = 'none';
  isPickerVisible = false;
  enableHeaderAutoHide();
  requestWakeLock();
}

// =============================================================================
// Autoplay with muted fallback
// =============================================================================
function attemptAutoplay(element) {
  return element.play().catch(err => {
    if (err.name === 'NotAllowedError') {
      console.warn('Autoplay with sound blocked, retrying muted...');
      element.muted = true;
      return element.play();
    }
    throw err;
  });
}

// =============================================================================
// HLS error recovery — aggressive retry for live recording
// =============================================================================
function setupHlsErrorRecovery(hls) {
  let networkRetries = 0;
  let mediaRetries = 0;
  const MAX_NETWORK_RETRIES = 20; // Keep trying for a long time
  const MAX_MEDIA_RETRIES = 5;
  const NETWORK_RETRY_DELAY = 3000; // 3s between network retries

  hls.on(Hls.Events.ERROR, function (event, data) {
    if (!data.fatal) return;

    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        networkRetries++;
        if (networkRetries <= MAX_NETWORK_RETRIES) {
          console.warn(
            `Fatal network error (attempt ${networkRetries}/${MAX_NETWORK_RETRIES}), ` +
            `retrying in ${NETWORK_RETRY_DELAY / 1000}s...`
          );
          setTimeout(() => hls.startLoad(), NETWORK_RETRY_DELAY);
        } else {
          console.error('Network recovery exhausted after', MAX_NETWORK_RETRIES, 'attempts');
          showToast('Stream connection lost — check your network', 'error', 5000);
        }
        break;

      case Hls.ErrorTypes.MEDIA_ERROR:
        mediaRetries++;
        if (mediaRetries <= MAX_MEDIA_RETRIES) {
          console.warn(
            `Fatal media error (attempt ${mediaRetries}/${MAX_MEDIA_RETRIES}), recovering...`
          );
          if (mediaRetries === 1) {
            hls.recoverMediaError();
          } else {
            // Escalate: swap codec on subsequent attempts
            hls.swapAudioCodec();
            hls.recoverMediaError();
          }
        } else {
          console.error('Media recovery exhausted after', MAX_MEDIA_RETRIES, 'attempts');
          showToast('Stream playback error — try switching channels', 'error', 5000);
        }
        break;

      default:
        console.error('Unrecoverable HLS error:', data);
        showToast('Stream error — try switching channels', 'error', 5000);
        break;
    }
  });

  // Reset retry counters when stream recovers successfully
  hls.on(Hls.Events.FRAG_LOADED, function () {
    if (networkRetries > 0) {
      console.log('Stream recovered after', networkRetries, 'network retries');
      networkRetries = 0;
    }
  });

  hls.on(Hls.Events.FRAG_BUFFERED, function () {
    if (mediaRetries > 0) {
      console.log('Media recovered after', mediaRetries, 'retries');
      mediaRetries = 0;
    }
  });
}

// =============================================================================
// Auto-hiding overlays during video/multi-view playback
// =============================================================================
const headerEl = document.querySelector('.header');
let overlayHideTimer = null;
let isAutoHideActive = false;

function enableHeaderAutoHide() {
  isAutoHideActive = true;
  headerEl.classList.add('auto-hide');
  showOverlaysTemporarily();
}

function disableHeaderAutoHide() {
  isAutoHideActive = false;
  headerEl.classList.remove('auto-hide', 'visible');
  // Also hide multi-view controls bar
  if (mvControlsEl) mvControlsEl.classList.remove('visible');
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
}

function showOverlaysTemporarily() {
  if (!isAutoHideActive) return;
  headerEl.classList.add('visible');
  // Also show multi-view controls if in multi-view mode
  if (isMultiViewMode && mvControlsEl) {
    mvControlsEl.classList.add('visible');
  }
  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  overlayHideTimer = setTimeout(() => {
    headerEl.classList.remove('visible');
    if (isMultiViewMode && mvControlsEl) {
      mvControlsEl.classList.remove('visible');
    }
  }, 3000);
}

// Show overlays when mouse moves (during playback), throttled via rAF
let mouseMoveScheduled = false;
document.addEventListener('mousemove', () => {
  if (!isAutoHideActive || mouseMoveScheduled) return;
  mouseMoveScheduled = true;
  requestAnimationFrame(() => {
    showOverlaysTemporarily();
    mouseMoveScheduled = false;
  });
});

// Also show on touch start (mobile)
document.addEventListener('touchstart', () => {
  if (isAutoHideActive) {
    showOverlaysTemporarily();
  }
}, { passive: true });

// =============================================================================
// Stream protection — keep playback alive during recording
// =============================================================================

// Wake Lock: prevent screen sleep while a stream is playing
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      console.log('Wake Lock released');
      wakeLock = null;
    });
    console.log('Wake Lock acquired');
  } catch (e) {
    console.warn('Wake Lock request failed:', e);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Re-acquire wake lock and resume playback when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  if (currentVideoElement) {
    requestWakeLock();
    if (currentVideoElement.paused) {
      currentVideoElement.play().catch(() => {});
    }
  }
  if (currentAudioElement && currentAudioElement.paused) {
    currentAudioElement.play().catch(() => {});
  }

  multiViewSlots.forEach(slot => {
    if (slot && slot.video && slot.video.paused) {
      slot.video.play().catch(() => {});
    }
  });
});

// Prevent accidental tab close / navigation while a stream is playing
window.addEventListener('beforeunload', (e) => {
  if (currentVideoElement || (multiViewSlots && multiViewSlots.some(s => s && s.video))) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Network reconnection: when connection comes back, restart HLS loading
window.addEventListener('online', () => {
  console.log('Network reconnected, restarting stream loading...');
  showToast('Network reconnected, resuming streams...', 'success', 3000);

  // Restart loading on all active HLS instances
  activeHlsInstances.forEach(hls => {
    try {
      hls.startLoad();
    } catch (e) {
      console.warn('Error restarting HLS load:', e);
    }
  });

  // Also restart any multi-view HLS instances
  multiViewSlots.forEach(slot => {
    if (slot && slot.hls) {
      try {
        slot.hls.startLoad();
      } catch (e) {
        console.warn('Error restarting multi-view HLS:', e);
      }
    }
  });
});

window.addEventListener('offline', () => {
  console.warn('Network connection lost');
  showToast('Network connection lost — buffered content will keep playing', 'error', 5000);
});

// =============================================================================
// UI toggle functions
// =============================================================================
function toggleSideMenu() {
  if (isMenuVisible) {
    sideMenu.classList.add('hidden');
    contentArea.classList.add('expanded');
    isMenuVisible = false;
  } else {
    sideMenu.classList.remove('hidden');
    contentArea.classList.remove('expanded');
    isMenuVisible = true;
  }
}

// Mute toggle also handles the separate audio element for dual-stream channels
function toggleMute() {
  if (currentVideoElement) {
    isMuted = !isMuted;
    currentVideoElement.muted = isMuted;
    if (currentAudioElement) {
      currentAudioElement.muted = isMuted;
    }
    updateMuteButtonState(isMuted);
  }
}

muteButtonEl.addEventListener('click', toggleMute);

// =============================================================================
// Playback functions
// =============================================================================
function playStream(url) {
  return new Promise((resolve, reject) => {
    destroyActiveHls();
    releaseVideoElement(currentVideoElement);
    releaseVideoElement(currentAudioElement);
    currentAudioElement = null;

    const videoElement = document.createElement('video');
    videoElement.className = 'video-element';
    videoElement.controls = true;
    videoElement.autoplay = true;
    videoElement.muted = false;
    isMuted = false;

    currentVideoElement = videoElement;

    if (Hls.isSupported()) {
      const hls = new Hls(HLS_CONFIG);
      activeHlsInstances.push(hls);
      hls.loadSource(url);
      hls.attachMedia(videoElement);
      setupHlsErrorRecovery(hls);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        attemptAutoplay(videoElement).then(() => {
          isMuted = videoElement.muted;
          updateMuteButtonState(isMuted);
          resolve();
        }).catch(reject);
      });
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = url;
      videoElement.addEventListener('loadedmetadata', function () {
        attemptAutoplay(videoElement).then(() => {
          isMuted = videoElement.muted;
          updateMuteButtonState(isMuted);
          resolve();
        }).catch(reject);
      });
    } else {
      reject(new Error('HLS is not supported'));
    }

    videoContainerEl.innerHTML = '';
    videoContainerEl.appendChild(videoElement);
    showVideoView();
    updateMuteButtonVisibility(false);
  });
}

function playVideoAndAudio(videoUrl, audioUrl) {
  return new Promise((resolve, reject) => {
    destroyActiveHls();
    releaseVideoElement(currentVideoElement);
    releaseVideoElement(currentAudioElement);

    const videoElement = document.createElement('video');
    videoElement.className = 'video-element';
    videoElement.controls = true;
    videoElement.autoplay = true;
    videoElement.muted = false;
    isMuted = false;

    const audioElement = document.createElement('video');
    audioElement.style.display = 'none';
    audioElement.autoplay = true;
    audioElement.muted = false;

    currentVideoElement = videoElement;
    currentAudioElement = audioElement;

    function onReady() {
      videoContainerEl.innerHTML = '';
      videoContainerEl.appendChild(videoElement);
      videoContainerEl.appendChild(audioElement);
      showVideoView();
      updateMuteButtonVisibility(false);

      attemptAutoplay(videoElement)
        .then(() => attemptAutoplay(audioElement))
        .then(() => {
          // Sync muted state: if either was muted by autoplay fallback, mute both
          const wasMuted = videoElement.muted || audioElement.muted;
          if (wasMuted) {
            videoElement.muted = true;
            audioElement.muted = true;
          }
          isMuted = wasMuted;
          updateMuteButtonState(isMuted);
          resolve();
        })
        .catch(reject);
    }

    if (Hls.isSupported()) {
      const hlsVideo = new Hls(HLS_CONFIG);
      const hlsAudio = new Hls(HLS_CONFIG);
      activeHlsInstances.push(hlsVideo, hlsAudio);

      hlsVideo.loadSource(videoUrl);
      hlsVideo.attachMedia(videoElement);
      setupHlsErrorRecovery(hlsVideo);

      hlsAudio.loadSource(audioUrl);
      hlsAudio.attachMedia(audioElement);
      setupHlsErrorRecovery(hlsAudio);

      let videoReady = false;
      let audioReady = false;
      function checkBothReady() {
        if (videoReady && audioReady) onReady();
      }
      hlsVideo.on(Hls.Events.MANIFEST_PARSED, () => { videoReady = true; checkBothReady(); });
      hlsAudio.on(Hls.Events.MANIFEST_PARSED, () => { audioReady = true; checkBothReady(); });
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = videoUrl;
      audioElement.src = audioUrl;
      videoElement.addEventListener('loadedmetadata', onReady);
    } else {
      reject(new Error('HLS is not supported'));
    }
  });
}

// =============================================================================
// Unified channel playback
// =============================================================================
function playChannel(channel) {
  if (isMenuVisible) {
    toggleSideMenu();
  }

  if (channel.url.includes('php?m3u8')) {
    destroyActiveHls();
    releaseVideoElement(currentVideoElement);
    releaseVideoElement(currentAudioElement);
    currentVideoElement = null;
    currentAudioElement = null;
    const iframe = createMakoIframe();
    videoContainerEl.innerHTML = '';
    videoContainerEl.appendChild(iframe);
    showVideoView();
  } else if (channel.name === '13-kanal-il') {
    playVideoAndAudio(KANAL_13_VIDEO_URL, KANAL_13_AUDIO_URL).catch(err => {
      console.error('Playback failed:', err);
      showToast('Channel unavailable, please try another', 'error');
      showPicker();
    });
  } else {
    playStream(channel.url).catch(err => {
      console.error('Playback failed:', err);
      showToast('Channel unavailable, please try another', 'error');
      showPicker();
    });
  }
}

// =============================================================================
// Favorites
// =============================================================================
function toggleFavorite(channel) {
  const index = favorites.findIndex(ch => ch.name === channel.name);
  if (index >= 0) {
    favorites.splice(index, 1);
    favoriteNames.delete(channel.name);
  } else {
    favorites.push(channel);
    favoriteNames.add(channel.name);
  }
  safeSetItem('favoriteChannels', JSON.stringify(favorites));
  updateFavoriteChannels();
  updateChannelButtons();
}

// =============================================================================
// XSS-safe menu item builder
// =============================================================================
function createMenuItemElement(channel, index, dataAttr) {
  const div = document.createElement('div');
  div.className = 'channel-menu-item';

  if (dataAttr === 'index') {
    div.setAttribute('data-index', index);
  } else if (dataAttr === 'favorite') {
    div.setAttribute('data-favorite', channel.name);
  }

  const img = document.createElement('img');
  img.src = channel.logo;
  img.alt = channel.name;
  img.loading = 'lazy';
  img.onerror = handleImageError;

  const span = document.createElement('span');
  span.textContent = channel.name;

  div.appendChild(img);
  div.appendChild(span);

  div.addEventListener('click', () => {
    playChannelFromMenu(channel, index);
  });

  return div;
}

function updateFavoriteChannels() {
  const favoritesSection = document.getElementById('favoritesSection');
  const favoriteChannelsDiv = document.getElementById('favoriteChannels');

  if (favorites.length > 0) {
    favoritesSection.style.display = 'block';
    favoriteChannelsDiv.innerHTML = '';
    const fragment = document.createDocumentFragment();
    favorites.forEach(channel => {
      fragment.appendChild(
        createMenuItemElement(channel, -1, 'favorite')
      );
    });
    favoriteChannelsDiv.appendChild(fragment);
  } else {
    favoritesSection.style.display = 'none';
  }
}


function updateChannelButtons() {
  document.querySelectorAll('.channel-button').forEach(button => {
    const channelName = button.getAttribute('data-channel-name');
    if (channelName) {
      const favoriteBtn = button.querySelector('.favorite-btn');
      if (favoriteBtn) {
        if (favoriteNames.has(channelName)) {
          favoriteBtn.classList.add('active');
          favoriteBtn.textContent = '⭐';
        } else {
          favoriteBtn.classList.remove('active');
          favoriteBtn.textContent = '☆';
        }
      }
    }
  });
}

// =============================================================================
// Channel playback from menu
// =============================================================================
function playChannelFromMenu(channel, index) {
  document.querySelectorAll('.channel-menu-item').forEach(item => {
    item.classList.remove('active');
  });
  const menuItem =
    document.querySelector(`[data-index="${index}"]`) ||
    document.querySelector(`[data-favorite="${channel.name}"]`);
  if (menuItem) menuItem.classList.add('active');

  playChannel(channel);
}

// =============================================================================
// Channel button creation
// =============================================================================
function createButton(name, logo, url, groupTitle) {
  const button = document.createElement('button');
  button.className = 'channel-button';
  button.setAttribute('data-channel-name', name);

  const img = document.createElement('img');
  img.src = logo;
  img.alt = name;
  img.loading = 'lazy';
  img.onerror = function () {
    this.style.display = 'none';
    const fallback = document.createElement('div');
    fallback.className = 'channel-button-fallback';
    fallback.textContent = '📺';
    button.insertBefore(fallback, button.firstChild);
  };
  button.appendChild(img);

  const favoriteBtn = document.createElement('button');
  favoriteBtn.className = 'favorite-btn';
  const isFav = favoriteNames.has(name);
  favoriteBtn.textContent = isFav ? '⭐' : '☆';
  if (isFav) {
    favoriteBtn.classList.add('active');
  }
  favoriteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite({ name, logo, url, groupTitle });
  });
  button.appendChild(favoriteBtn);

  // Channel name
  const nameDiv = document.createElement('div');
  nameDiv.className = 'channel-button-name';
  nameDiv.textContent = name;
  button.appendChild(nameDiv);

  // Category badge
  if (groupTitle && groupTitle !== 'Other') {
    const badge = document.createElement('div');
    badge.className = 'category-badge';
    badge.textContent = groupTitle;
    button.appendChild(badge);
  }

  button.addEventListener('click', function () {
    playChannel({ name, logo, url, groupTitle });
  });

  return button;
}

// =============================================================================
// Picker functions
// =============================================================================
function showPicker() {
  channelPickerEl.style.display = 'grid';
  videoContainerEl.style.display = 'none';
  backButtonEl.style.display = 'none';
  multiViewButtonEl.style.display = 'flex';
  disableHeaderAutoHide();

  if (!isMenuVisible) {
    sideMenu.classList.remove('hidden');
    contentArea.classList.remove('expanded');
    isMenuVisible = true;
  }

  isPickerVisible = true;
}

function hidePicker() {
  channelPickerEl.style.display = 'none';
  isPickerVisible = false;
}

function togglePicker() {
  if (isPickerVisible) {
    hidePicker();
  } else {
    showPicker();
  }
}

// =============================================================================
// Back button
// =============================================================================
backButtonEl.addEventListener('click', function () {
  if (!isPickerVisible) {
    showPicker();
    destroyActiveHls();
    releaseVideoElement(currentVideoElement);
    releaseVideoElement(currentAudioElement);
    currentVideoElement = null;
    currentAudioElement = null;
    videoContainerEl.innerHTML = '';
    updateMuteButtonVisibility(false);
    releaseWakeLock();
  } else {
    toggleSideMenu();
  }
});

// =============================================================================
// Main start / channel loading
// =============================================================================
function start() {
  channelPickerEl.innerHTML = '<div class="loading">Loading channels...</div>';

  fetch(
    'https://raw.githubusercontent.com/renanbazinin/myM3U/main/directLiveNamesDiffandEPG1.m3u'
  )
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.text();
    })
    .then(data => {
      channelPickerEl.innerHTML = '';

      const lines = data.split(/\r?\n/);
      const channels = [];
      let currentChannel = {};

      lines.forEach(line => {
        if (line.startsWith('#EXTINF:-1')) {
          if (
            currentChannel.name &&
            currentChannel.logo &&
            currentChannel.url
          ) {
            channels.push(currentChannel);
            currentChannel = {};
          }
          const attrs = {};
          for (const [, k, v] of line.matchAll(/(tvg-id|tvg-logo|group-title)="([^"]+)"/g)) {
            attrs[k] = v;
          }
          if (attrs['tvg-id'] && attrs['tvg-logo']) {
            currentChannel.name = attrs['tvg-id'];
            currentChannel.logo = attrs['tvg-logo'];
            currentChannel.groupTitle = attrs['group-title'] || 'Other';
          }
        } else if (line.trim() !== '' && !line.startsWith('#')) {
          currentChannel.url = line;
        }
      });

      // Add remaining channel if exists
      if (
        currentChannel.name &&
        currentChannel.logo &&
        currentChannel.url
      ) {
        channels.push(currentChannel);
      }

      const filteredChannels = channels.filter(ch => !isExcludedChannel(ch.name));
      const removedCount = channels.length - filteredChannels.length;
      if (removedCount > 0) {
        console.log(`Filtered out ${removedCount} non-working channel(s)`);
      }

      // Append supplemental live news channels (skip duplicates by name)
      const existingNames = new Set(filteredChannels.map(ch => ch.name));
      SUPPLEMENTAL_CHANNELS.forEach(ch => {
        if (!existingNames.has(ch.name)) {
          filteredChannels.push(ch);
        }
      });

      // Populate UI
      updateMenuChannels(filteredChannels);
      updateFavoriteChannels();

      window.allChannels = filteredChannels;
      displayChannels(filteredChannels);

      // Auto-play first channel
      if (filteredChannels.length > 0) {
        const firstChannel = filteredChannels[0];
        if (!firstChannel.url.includes('php?m3u8')) {
          if (isMenuVisible) toggleSideMenu();
          playStream(firstChannel.url)
            .then(() => {
              const firstMenuItem = document.querySelector(
                '[data-index="0"]'
              );
              if (firstMenuItem) firstMenuItem.classList.add('active');
            })
            .catch(err => {
              console.error('Auto-play failed:', err);
              showPicker();
            });
        } else {
          showPicker();
        }
      }
    })
    .catch(error => {
      console.error('Error loading channels:', error);
      channelPickerEl.innerHTML = '';

      const errorDiv = document.createElement('div');
      errorDiv.style.cssText =
        'text-align: center; color: var(--text-secondary); padding: 2rem;';

      const msg = document.createElement('div');
      msg.textContent = 'Failed to load channels.';
      errorDiv.appendChild(msg);

      const retryBtn = document.createElement('button');
      retryBtn.className = 'retry-btn';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', start);
      errorDiv.appendChild(retryBtn);

      channelPickerEl.appendChild(errorDiv);
    });
}

// =============================================================================
// Menu channels
// =============================================================================
function updateMenuChannels(channels) {
  const menuChannelsDiv = document.getElementById('menuChannels');
  const lowerSearch = searchTerm ? searchTerm.toLowerCase() : '';
  const filtered = lowerSearch
    ? channels.filter(ch => ch.name.toLowerCase().includes(lowerSearch))
    : channels;

  menuChannelsDiv.innerHTML = '';

  if (filtered.length === 0) {
    const msg = document.createElement('div');
    msg.style.cssText =
      'text-align: center; color: var(--text-secondary); padding: 2rem;';
    msg.textContent = 'No channels found';
    menuChannelsDiv.appendChild(msg);
  } else {
    const fragment = document.createDocumentFragment();
    filtered.forEach((channel, index) => {
      fragment.appendChild(
        createMenuItemElement(channel, index, 'index')
      );
    });
    menuChannelsDiv.appendChild(fragment);
  }
}

// =============================================================================
// Display channels
// =============================================================================
function displayChannels(channelsToShow) {
  channelPickerEl.innerHTML = '';

  // Apply Israel filter if active
  let channelsForDisplay = channelsToShow;
  const showUSButton = isFilterApplied && !searchTerm;

  if (isFilterApplied) {
    channelsForDisplay = channelsToShow.filter(
      ch => ch.groupTitle === 'Israel'
    );
  }

  let visibleChannels = channelsForDisplay;
  if (searchTerm) {
    const lowerSearch = searchTerm.toLowerCase();
    visibleChannels = channelsForDisplay.filter(
      ch =>
        ch.name.toLowerCase().includes(lowerSearch) ||
        (ch.groupTitle &&
          ch.groupTitle.toLowerCase().includes(lowerSearch))
    );
  }

  if (visibleChannels.length === 0) {
    noResultsEl.style.display = 'block';
    channelPickerEl.style.display = 'none';
    return;
  }

  noResultsEl.style.display = 'none';
  channelPickerEl.style.display = 'grid';

  // "Show US Channels" button when Israel filter is active
  if (showUSButton) {
    const showUSChannelsButton = document.createElement('button');
    showUSChannelsButton.id = 'showUSChannels';
    showUSChannelsButton.className = 'channel-button';

    const flagImg = document.createElement('img');
    flagImg.src = 'https://i.imgur.com/lUKWqOA.png';
    flagImg.style.height = '40px';
    flagImg.style.marginBottom = '0.5rem';

    const textDiv = document.createElement('div');
    textDiv.textContent = 'Show US Channels';
    textDiv.style.fontSize = '0.85rem';
    textDiv.style.fontWeight = '600';

    showUSChannelsButton.appendChild(flagImg);
    showUSChannelsButton.appendChild(textDiv);
    channelPickerEl.appendChild(showUSChannelsButton);

    showUSChannelsButton.addEventListener('click', function () {
      isFilterApplied = false;
      displayChannels(window.allChannels);
    });
  }

  const fragment = document.createDocumentFragment();
  visibleChannels.forEach(channel => {
    const button = createButton(
      channel.name,
      channel.logo,
      channel.url,
      channel.groupTitle
    );
    if (button) {
      fragment.appendChild(button);
    }
  });
  channelPickerEl.appendChild(fragment);
}

// =============================================================================
// Search (debounced)
// =============================================================================
function setupSearch() {
  function handleSearch(value) {
    searchTerm = value;
    if (window.allChannels) {
      displayChannels(window.allChannels);
      updateMenuChannels(window.allChannels);
    }
  }

  const debouncedSearch = debounce(handleSearch, 200);

  globalSearchEl.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
    menuSearchEl.value = e.target.value;
  });

  menuSearchEl.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
    globalSearchEl.value = e.target.value;
  });
}

// =============================================================================
// Multi-view
// =============================================================================
function initMultiView() {
  multiViewButtonEl.addEventListener('click', toggleMultiView);
  document
    .getElementById('exitMultiView')
    .addEventListener('click', exitMultiView);

  document.querySelectorAll('.grid-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const layout = e.target.getAttribute('data-grid');
      changeGridLayout(layout);
    });
  });
}

function toggleMultiView() {
  if (isMultiViewMode) {
    exitMultiView();
  } else {
    enterMultiView();
  }
}

// Default channels for multi-view 2x2 grid
const MULTIVIEW_DEFAULT_CHANNELS = [
  '11-kanal-il',
  '12-kanal-il',
  '13-kanal-il',
  '14-kanal-il',
];

function enterMultiView() {
  isMultiViewMode = true;

  multiViewButtonEl.classList.add('active');
  multiViewContainerEl.style.display = 'flex';
  enableHeaderAutoHide();
  requestWakeLock();
  videoContainerEl.style.display = 'none';
  channelPickerEl.style.display = 'none';
  backButtonEl.style.display = 'none';

  createVideoGrid(currentGridLayout);

  // Auto-load default channels into empty slots
  if (window.allChannels && multiViewSlots.every(s => !s)) {
    MULTIVIEW_DEFAULT_CHANNELS.forEach((name, i) => {
      const channel = window.allChannels.find(ch => ch.name === name);
      if (channel && i < document.querySelectorAll('.video-slot').length) {
        loadChannelInSlot(i, channel);
      }
    });
  }
}

function exitMultiView() {
  isMultiViewMode = false;

  multiViewButtonEl.classList.remove('active');
  multiViewContainerEl.style.display = 'none';

  if (fullscreenSlotIndex !== null) {
    exitSlotFullscreen();
  }

  multiViewSlots.forEach(slot => {
    if (slot) {
      if (slot.hls) slot.hls.destroy();
      releaseVideoElement(slot.video);
    }
  });
  multiViewSlots = [];
  activeAudioSlot = null;
  fullscreenSlotIndex = null;

  // Abort all slot-specific listeners
  slotAbortControllers.forEach(c => { if (c) c.abort(); });
  slotAbortControllers = [];

  releaseWakeLock();
  showPicker();
}

function changeGridLayout(layout) {
  currentGridLayout = layout;

  if (fullscreenSlotIndex !== null) {
    exitSlotFullscreen();
  }

  document.querySelectorAll('.grid-btn').forEach(btn => {
    btn.classList.toggle(
      'active',
      btn.getAttribute('data-grid') === layout
    );
  });

  multiViewGridEl.className = `multi-view-grid grid-${layout}`;
  createVideoGrid(layout);
}

function createVideoGrid(layout) {
  multiViewGridEl.innerHTML = '';

  let slots = 4;
  if (layout === '1x1') slots = 1;
  else if (layout === '3x3') slots = 9;
  else if (layout === '2x3') slots = 6;

  const oldSlots = [...multiViewSlots];
  multiViewSlots = [];

  // Abort previous slot controllers
  slotAbortControllers.forEach(c => { if (c) c.abort(); });
  slotAbortControllers = [];

  for (let i = 0; i < slots; i++) {
    const slot = document.createElement('div');
    slot.className = 'video-slot empty';
    slot.setAttribute('data-slot-index', i);

    // This permanent handler checks for empty state
    slot.addEventListener('click', () => {
      if (slot.classList.contains('empty')) {
        openChannelSelector(i);
      }
    });

    const span = document.createElement('span');
    span.textContent = 'Click to add channel';
    slot.appendChild(span);

    multiViewGridEl.appendChild(slot);

    // Restore previous stream if it exists
    if (oldSlots[i] && oldSlots[i].channel) {
      loadChannelInSlot(i, oldSlots[i].channel);
    }
  }

  for (let i = slots; i < oldSlots.length; i++) {
    if (oldSlots[i]) {
      if (oldSlots[i].hls) oldSlots[i].hls.destroy();
      releaseVideoElement(oldSlots[i].video);
    }
  }
}

// =============================================================================
// Channel selector modal
// =============================================================================
function openChannelSelector(slotIndex) {

  const modal = document.createElement('div');
  modal.className = 'channel-selector-modal';

  const content = document.createElement('div');
  content.className = 'channel-selector-content';

  const header = document.createElement('div');
  header.className = 'channel-selector-header';

  const title = document.createElement('h3');
  title.textContent = `Select Channel for Slot ${slotIndex + 1}`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'channel-selector-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => closeModal());

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Search input for the modal
  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'channel-selector-search-wrapper';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search channels...';
  searchInput.className = 'channel-selector-search';
  searchWrapper.appendChild(searchInput);

  const body = document.createElement('div');
  body.className = 'channel-selector-body';

  function renderModalChannels(filter) {
    body.innerHTML = '';
    const channels = filter
      ? window.allChannels.filter(ch =>
          ch.name.toLowerCase().includes(filter.toLowerCase())
        )
      : window.allChannels;

    channels.forEach(channel => {
      const item = document.createElement('div');
      item.className = 'channel-selector-item';

      const img = document.createElement('img');
      img.src = channel.logo;
      img.alt = channel.name;
      img.loading = 'lazy';
      img.onerror = handleImageError;

      const span = document.createElement('span');
      span.textContent = channel.name;

      item.appendChild(img);
      item.appendChild(span);

      item.addEventListener('click', () => {
        loadChannelInSlot(slotIndex, channel);
        closeModal();
      });

      body.appendChild(item);
    });

    if (channels.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText =
        'grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 2rem;';
      msg.textContent = 'No channels found';
      body.appendChild(msg);
    }
  }

  const debouncedModalSearch = debounce((val) => renderModalChannels(val), 150);
  searchInput.addEventListener('input', (e) => {
    debouncedModalSearch(e.target.value);
  });

  content.appendChild(header);
  content.appendChild(searchWrapper);
  content.appendChild(body);
  modal.appendChild(content);

  // Render initial channel list
  renderModalChannels('');

  // Shared cleanup: remove modal and its Escape listener
  const modalAbort = new AbortController();
  function closeModal() {
    modal.remove();
    modalAbort.abort();
  }

  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close on Escape (cleaned up via AbortController when modal is removed)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  }, { signal: modalAbort.signal });

  document.body.appendChild(modal);

  // Auto-focus search
  setTimeout(() => searchInput.focus(), 100);
}

// =============================================================================
// Load channel into multi-view slot
// =============================================================================
function loadChannelInSlot(slotIndex, channel) {
  const slots = document.querySelectorAll('.video-slot');
  const slot = slots[slotIndex];

  if (!slot) return;

  if (multiViewSlots[slotIndex]) {
    const existing = multiViewSlots[slotIndex];
    if (existing.hls) existing.hls.destroy();
    releaseVideoElement(existing.video);
  }

  // Abort previous channel-specific listeners for this slot
  if (slotAbortControllers[slotIndex]) {
    slotAbortControllers[slotIndex].abort();
  }
  const controller = new AbortController();
  slotAbortControllers[slotIndex] = controller;
  const signal = controller.signal;

  slot.innerHTML = '';
  slot.classList.remove('empty');

  const video = document.createElement('video');
  video.className = 'video-element';
  video.controls = false;
  video.autoplay = true;
  video.muted = activeAudioSlot !== slotIndex;

  // Controls
  const controls = document.createElement('div');
  controls.className = 'video-slot-controls';

  const muteBtn = document.createElement('button');
  muteBtn.className = `slot-control-btn mute-btn ${video.muted ? 'muted' : ''}`;
  muteBtn.title = video.muted ? 'Unmute' : 'Mute';
  muteBtn.textContent = video.muted ? '🔇' : '🔊';

  const swapBtn = document.createElement('button');
  swapBtn.className = 'slot-control-btn swap-btn';
  swapBtn.title = 'Swap channel';
  swapBtn.textContent = '🔄';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'slot-control-btn remove-btn';
  removeBtn.title = 'Remove channel';
  removeBtn.textContent = '✕';

  controls.appendChild(muteBtn);
  controls.appendChild(swapBtn);
  controls.appendChild(removeBtn);

  const info = document.createElement('div');
  info.className = 'video-slot-info';
  info.textContent = channel.name;

  slot.appendChild(video);
  slot.appendChild(controls);
  slot.appendChild(info);

  // Button event handlers (these are on child elements, cleaned up via innerHTML)
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSlotAudio(slotIndex);
  });

  swapBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openChannelSelector(slotIndex);
  });

  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeChannelFromSlot(slotIndex);
  });

  // Slot-level handlers use AbortController signal for proper cleanup
  slot.addEventListener('click', () => {
    if (!slot.classList.contains('empty')) {
      setActiveAudioSlot(slotIndex);
    }
  }, { signal });

  slot.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (!slot.classList.contains('empty')) {
      toggleSlotFullscreen(slotIndex);
    }
  }, { signal });

  // Load stream
  if (channel.url.includes('php?m3u8')) {
    video.remove();
    const iframe = createMakoIframe();
    slot.insertBefore(iframe, controls);
  } else if (Hls.isSupported()) {
    const hls = new Hls(HLS_MULTIVIEW_CONFIG);
    hls.loadSource(channel.url);
    hls.attachMedia(video);
    setupHlsErrorRecovery(hls);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(err => console.error('Playback failed:', err));
    });

    multiViewSlots[slotIndex] = {
      video: video,
      hls: hls,
      channel: channel,
      muted: video.muted,
    };
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = channel.url;
    video.addEventListener('loadedmetadata', () => {
      video.play().catch(err => console.error('Playback failed:', err));
    });

    multiViewSlots[slotIndex] = {
      video: video,
      channel: channel,
      muted: video.muted,
    };
  }
}

// =============================================================================
// Multi-view audio management
// =============================================================================
function toggleSlotAudio(slotIndex) {
  const slot = multiViewSlots[slotIndex];
  if (!slot || !slot.video) return;

  if (activeAudioSlot === slotIndex) {
    slot.video.muted = true;
    slot.muted = true;
    activeAudioSlot = null;
    updateSlotAudioButton(slotIndex, true);
  } else {
    setActiveAudioSlot(slotIndex);
  }
}

function setActiveAudioSlot(slotIndex) {
  // Mute all slots
  multiViewSlots.forEach((slot, idx) => {
    if (slot && slot.video) {
      slot.video.muted = true;
      slot.muted = true;
      updateSlotAudioButton(idx, true);
    }
  });

  // Remove focused class from all slots
  document.querySelectorAll('.video-slot').forEach(el => {
    el.classList.remove('focused');
  });

  // Unmute selected slot
  const slot = multiViewSlots[slotIndex];
  if (slot && slot.video) {
    slot.video.muted = false;
    slot.muted = false;
    activeAudioSlot = slotIndex;
    updateSlotAudioButton(slotIndex, false);

    const slotElement = document.querySelector(
      `[data-slot-index="${slotIndex}"]`
    );
    if (slotElement) {
      slotElement.classList.add('focused');
    }
  }
}

function updateSlotAudioButton(slotIndex, muted) {
  const slotElement = document.querySelector(
    `[data-slot-index="${slotIndex}"]`
  );
  if (!slotElement) return;

  const btn = slotElement.querySelector('.mute-btn');
  if (btn) {
    btn.classList.toggle('muted', muted);
    btn.textContent = muted ? '🔇' : '🔊';
    btn.title = muted ? 'Unmute' : 'Mute';
  }
}

function removeChannelFromSlot(slotIndex) {
  const slot = multiViewSlots[slotIndex];
  if (slot) {
    if (slot.hls) slot.hls.destroy();
    releaseVideoElement(slot.video);
  }

  multiViewSlots[slotIndex] = null;

  if (activeAudioSlot === slotIndex) {
    activeAudioSlot = null;
  }

  // Abort channel-specific listeners
  if (slotAbortControllers[slotIndex]) {
    slotAbortControllers[slotIndex].abort();
    slotAbortControllers[slotIndex] = null;
  }

  const slotElement = document.querySelector(
    `[data-slot-index="${slotIndex}"]`
  );
  if (slotElement) {
    slotElement.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = 'Click to add channel';
    slotElement.appendChild(span);
    slotElement.className = 'video-slot empty';
    // No new listener added -- the permanent handler from createVideoGrid handles it
  }
}

// =============================================================================
// Fullscreen for multi-view slots
// =============================================================================
function toggleSlotFullscreen(slotIndex) {
  const slots = document.querySelectorAll('.video-slot');
  const targetSlot = slots[slotIndex];

  if (!targetSlot || targetSlot.classList.contains('empty')) return;

  if (fullscreenSlotIndex === slotIndex) {
    exitSlotFullscreen();
  } else {
    enterSlotFullscreen(slotIndex);
  }
}

function enterSlotFullscreen(slotIndex) {
  const slots = document.querySelectorAll('.video-slot');

  slots.forEach((slot, idx) => {
    if (idx !== slotIndex) {
      slot.style.display = 'none';
    } else {
      slot.classList.add('fullscreen');
    }
  });

  multiViewGridEl.classList.add('fullscreen-mode');
  fullscreenSlotIndex = slotIndex;
  setActiveAudioSlot(slotIndex);
}

function exitSlotFullscreen() {
  const slots = document.querySelectorAll('.video-slot');

  slots.forEach(slot => {
    slot.style.display = '';
    slot.classList.remove('fullscreen');
  });

  multiViewGridEl.classList.remove('fullscreen-mode');
  fullscreenSlotIndex = null;
}

// =============================================================================
// Init
// =============================================================================
window.addEventListener('load', function () {
  start();
  setupSearch();
  initMultiView();
});

// =============================================================================
// Keyboard shortcuts (skip when typing in input fields)
// =============================================================================
document.addEventListener('keydown', function (e) {
  if (
    document.activeElement &&
    document.activeElement.tagName === 'INPUT'
  ) {
    return;
  }

  if (e.key === 'Escape') {
    if (isMultiViewMode && fullscreenSlotIndex !== null) {
      exitSlotFullscreen();
    } else if (!isPickerVisible) {
      showPicker();
    }
  } else if (e.key === 'h' || e.key === 'H') {
    // Only toggle picker/video when a stream is actively playing
    if (currentVideoElement) {
      togglePicker();
    }
  } else if (e.key >= '0' && e.key <= '9') {
    handleNumericInput(e.key);
  }
});

// =============================================================================
// Numeric channel input
// =============================================================================
function handleNumericInput(digit) {
  if (!channelInputDisplay) return;

  if (channelInputTimer) {
    clearTimeout(channelInputTimer);
  }

  channelInput.push(digit);
  updateChannelInputDisplay();

  if (channelInput.length === 1) {
    channelInputTimer = setTimeout(() => {
      const channelNumber = parseInt(channelInput[0]);
      if (channelNumber > 0 && window.allChannels) {
        const channelIndex = channelNumber - 1;
        if (window.allChannels[channelIndex]) {
          const channel = window.allChannels[channelIndex];
          playChannelFromMenu(channel, channelIndex);
        }
      }
      resetChannelInput();
    }, 1500);
  } else if (channelInput.length === 2) {
    const channelNumber = parseInt(channelInput.join(''));
    const channelIndex = channelNumber - 1;

    if (window.allChannels && window.allChannels[channelIndex]) {
      const channel = window.allChannels[channelIndex];
      playChannelFromMenu(channel, channelIndex);
    }
    setTimeout(resetChannelInput, 500);
  }
}

function updateChannelInputDisplay() {
  if (!channelInputDisplay) return;
  channelInputDisplay.classList.remove('hidden');
  channelInputSpans[0].textContent = channelInput[0] || '_';
  channelInputSpans[1].textContent = channelInput[1] || '_';
}

function resetChannelInput() {
  if (!channelInputDisplay) return;
  channelInput = [];
  channelInputDisplay.classList.add('hidden');
  if (channelInputSpans.length > 1) {
    channelInputSpans[0].textContent = '_';
    channelInputSpans[1].textContent = '_';
  }
  if (channelInputTimer) {
    clearTimeout(channelInputTimer);
    channelInputTimer = null;
  }
}
