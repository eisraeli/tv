let isPickerVisible = true;
    let isMenuVisible = true;
    const sideMenu = document.getElementById('sideMenu');
    const contentArea = document.getElementById('contentArea');    let isFilterApplied = true;    let currentVideoElement = null;
    let isMuted = true; // Start muted for autoplay compatibility
    
    // Multi-view state
    let isMultiViewMode = false;
    let multiViewSlots = [];
    let activeAudioSlot = null;
    let currentGridLayout = '2x2';
    let selectedSlotIndex = null;
    let fullscreenSlotIndex = null;
    
    // Storage for favorites and recent channels
    let favorites = JSON.parse(localStorage.getItem('favoriteChannels') || '[]');
    let recentlyWatched = JSON.parse(localStorage.getItem('recentChannels') || '[]');
    let searchTerm = ''
    
    // Function to check if a channel should be excluded
    function isExcludedChannel(channelName) {
      const lowerName = channelName.toLowerCase();
      // Remove spaces, hyphens, underscores for better matching
      const normalizedName = lowerName.replace(/[\s\-_]/g, '');
      
      // List of exact channel names to exclude (case-insensitive, normalized)
      const excludedChannelNames = [
        'bloombergv',
        'bloombergvplus', 
        'bloombergtv',
        'bloombergtvplus',
        'wep',
        'we2',
        'foxlivenewchannel',
        'foxlivenewschannel', // Also check with 's' in news
        'foxlivenews' // Shorter variation
      ];
      
      // Check if normalized channel name matches any excluded name
      for (const excluded of excludedChannelNames) {
        if (normalizedName === excluded || normalizedName.includes(excluded)) {
          return true;
        }
      }
      
      // List of non-working channel patterns
      const excludedPatterns = [
        // Rick and Morty channels
        (name) => name.includes('rick') && name.includes('morty'),
        // Bloomberg channels pattern
        (name) => name.includes('bloomberg'),
        // Fox Live News pattern  
        (name) => name.includes('foxlive') && (name.includes('news') || name.includes('new')),
        // WE channels pattern (using normalized name)
        (name) => {
          const norm = name.replace(/[\s\-_]/g, '');
          return norm === 'wep' || norm === 'we2';
        }
      ];
      return excludedPatterns.some(pattern => pattern(lowerName));
    }
    
    // Clean up existing favorites and recent channels from non-working channels
    favorites = favorites.filter(ch => !isExcludedChannel(ch.name));
    localStorage.setItem('favoriteChannels', JSON.stringify(favorites));
    
    recentlyWatched = recentlyWatched.filter(ch => !isExcludedChannel(ch.name));
    localStorage.setItem('recentChannels', JSON.stringify(recentlyWatched))

    // For two-digit channel input
    let channelInput = [];
    let channelInputTimer = null;
    const channelInputDisplay = document.getElementById('channel-input-display');
    const channelInputSpans = channelInputDisplay ? channelInputDisplay.querySelectorAll('span') : [];

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

    function toggleMute() {
      const muteButton = document.getElementById('muteButton');
      
      if (currentVideoElement) {
        isMuted = !isMuted;
        currentVideoElement.muted = isMuted;
        
        if (isMuted) {
          muteButton.textContent = '🔇';
          muteButton.classList.add('muted');
          muteButton.title = 'Unmute';
        } else {
          muteButton.textContent = '🔊';
          muteButton.classList.remove('muted');
          muteButton.title = 'Mute';
        }
      }
    }

    // Add event listener for mute button
    document.getElementById('muteButton').addEventListener('click', toggleMute);

    function updateMuteButtonVisibility(visible) {
      const muteButton = document.getElementById('muteButton');
      muteButton.style.display = visible ? 'flex' : 'none';
    }
    
    function playStream(url) {
      return new Promise((resolve, reject) => {
       const videoElement = document.createElement('video');
       videoElement.className = 'video-element';
       videoElement.controls = true;
       videoElement.autoplay = true;
       videoElement.muted = false; // Start unmuted so clicking a channel auto-plays with sound
       isMuted = false;

       // Store reference to current video element
       currentVideoElement = videoElement;

       // Check if HLS.js is supported
       if (Hls.isSupported()) {
         const hls = new Hls();
         hls.loadSource(url);
         hls.attachMedia(videoElement);
         hls.on(Hls.Events.MANIFEST_PARSED, function () {
          videoElement.play().then(resolve).catch(reject);
        });
       } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
         // If native HLS is supported
         videoElement.src = url;
        videoElement.addEventListener('loadedmetadata', function() {
          videoElement.play().then(resolve).catch(reject);
        });
       } else {
        reject(new Error('HLS is not supported'));
       }

       document.getElementById('videoContainer').innerHTML = '';
       document.getElementById('videoContainer').appendChild(videoElement);
       document.getElementById('videoContainer').style.display = 'block';
       document.getElementById('channelPicker').style.display = 'none';
       document.getElementById('backButton').style.display = 'block';
       document.getElementById('multiViewButton').style.display = 'none';

       // Show mute button and update its state to unmuted
       updateMuteButtonVisibility(false);
       const muteButton = document.getElementById('muteButton');
       muteButton.textContent = '🔊';
       muteButton.classList.remove('muted');
       muteButton.title = 'Mute';

       isPickerVisible = false;
     });
 }

 // Function to add channel to recently watched
    function addToRecentlyWatched(channel) {
      // Remove if already exists
      recentlyWatched = recentlyWatched.filter(ch => ch.name !== channel.name);
      // Add to beginning
      recentlyWatched.unshift(channel);
      // Keep only last 10
      recentlyWatched = recentlyWatched.slice(0, 10);
      // Save to localStorage
      localStorage.setItem('recentChannels', JSON.stringify(recentlyWatched));
      // Update UI
      updateRecentChannels();
    }
    
    // Function to toggle favorite
    function toggleFavorite(channel) {
      const index = favorites.findIndex(ch => ch.name === channel.name);
      if (index >= 0) {
        favorites.splice(index, 1);
      } else {
        favorites.push(channel);
      }
      localStorage.setItem('favoriteChannels', JSON.stringify(favorites));
      updateFavoriteChannels();
      updateChannelButtons();
    }
    
    // Function to update favorite channels in side menu
    function updateFavoriteChannels() {
      const favoritesSection = document.getElementById('favoritesSection');
      const favoriteChannelsDiv = document.getElementById('favoriteChannels');
      
      if (favorites.length > 0) {
        favoritesSection.style.display = 'block';
        favoriteChannelsDiv.innerHTML = favorites.map((channel, index) => 
          `<div class="channel-menu-item" onclick="playChannelFromMenu('${channel.url}', '${channel.name}', -1)" data-favorite="${channel.name}">
            <img src="${channel.logo}" alt="${channel.name}" onerror="this.style.display='none'" style="width: 30px; height: 30px; border-radius: 6px; margin-right: 10px; object-fit: cover;">
            <span>${channel.name}</span>
          </div>`
        ).join('');
      } else {
        favoritesSection.style.display = 'none';
      }
    }
    
    // Function to update recent channels in side menu
    function updateRecentChannels() {
      const recentSection = document.getElementById('recentSection');
      const recentChannelsDiv = document.getElementById('recentChannels');
      
      if (recentlyWatched.length > 0) {
        recentSection.style.display = 'block';
        recentChannelsDiv.innerHTML = recentlyWatched.map((channel, index) => 
          `<div class="channel-menu-item" onclick="playChannelFromMenu('${channel.url}', '${channel.name}', -1)" data-recent="${channel.name}">
            <img src="${channel.logo}" alt="${channel.name}" onerror="this.style.display='none'" style="width: 30px; height: 30px; border-radius: 6px; margin-right: 10px; object-fit: cover;">
            <span>${channel.name}</span>
          </div>`
        ).join('');
      } else {
        recentSection.style.display = 'none';
      }
    }
    
    // Function to update channel buttons with favorite status
    function updateChannelButtons() {
      document.querySelectorAll('.channel-button').forEach(button => {
        const channelName = button.getAttribute('data-channel-name');
        if (channelName) {
          const favoriteBtn = button.querySelector('.favorite-btn');
          if (favoriteBtn) {
            if (favorites.some(ch => ch.name === channelName)) {
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

// Function to play channel from side menu
    function playChannelFromMenu(url, name, index) {
      // Find the channel object
      const channel = window.allChannels.find(ch => ch.name === name);
      if (channel) {
        addToRecentlyWatched(channel);
      }
      // Hide side menu when channel is selected
      if (isMenuVisible) {
        toggleSideMenu();
      }
      
      // Update active channel in menu
      document.querySelectorAll('.channel-menu-item').forEach(item => item.classList.remove('active'));
      const menuItem = document.querySelector(`[data-index="${index}"]`) || 
                      document.querySelector(`[data-favorite="${name}"]`) || 
                      document.querySelector(`[data-recent="${name}"]`);
      if (menuItem) menuItem.classList.add('active');
      
      if (url.includes('php?m3u8')) {
        const iframe = document.createElement('iframe');
        iframe.src = 'https://www.mako.co.il/AjaxPage?jspName=embedHTML5video.jsp&galleryChannelId=7c5076a9b8757810VgnVCM100000700a10acRCRD&videoChannelId=d1d6f5dfc8517810VgnVCM100000700a10acRCRD&vcmid=1e2258089b67f510VgnVCM2000002a0c10acRCRD';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.allowfullscreen = true;
        
        document.getElementById('videoContainer').innerHTML = '';
        document.getElementById('videoContainer').appendChild(iframe);
        document.getElementById('videoContainer').style.display = 'block';
        
        // Hide channel picker and show back button
        document.getElementById('channelPicker').style.display = 'none';
        document.getElementById('backButton').style.display = 'block';
        document.getElementById('multiViewButton').style.display = 'none';
        isPickerVisible = false;
      } else {
        if (name === '13-kanal-il1') {
          playVideoAndAudio(
            'https://d1zqtf09wb8nt5.cloudfront.net/livehls/oil/freetv/live/reshet_13_hevc/live.livx/playlist.m3u8?bitrate=5500000&videoId=0&renditions&fmp4&dvr=28800000',
            'https://d1zqtf09wb8nt5.cloudfront.net/livehls/oil/freetv/live/reshet_13_hevc/live.livx/playlist.m3u8?bitrate=128000&audioId=1&lang=pol&renditions&fmp4&dvr=28800000'
          );
        } else {
          playStream(url);
        }
      }
    }function createButton(name, logo, url, groupTitle) {
      console.log("groupTitle=" + groupTitle);
      console.log("isFilterApplied=" + isFilterApplied);
      
      // Remove the filtering logic from createButton since it's now handled in displayChannels
      var button = document.createElement('button');
      button.className = 'channel-button';
      button.setAttribute('data-channel-name', name);
      
      // Create image element
      const img = document.createElement('img');
      img.src = logo;
      img.alt = name;
      img.onerror = function() {
        // Fallback if image fails to load
        this.style.display = 'none';
        button.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 80px; background: var(--glass-bg); border-radius: 12px; margin-bottom: 0.5rem; font-size: 2rem;">📺</div>' + name;
      };
      
      button.appendChild(img);
      
      // Add favorite button
      const favoriteBtn = document.createElement('button');
      favoriteBtn.className = 'favorite-btn';
      favoriteBtn.textContent = favorites.some(ch => ch.name === name) ? '⭐' : '☆';
      if (favorites.some(ch => ch.name === name)) {
        favoriteBtn.classList.add('active');
      }
      favoriteBtn.onclick = (e) => {
        e.stopPropagation();
        toggleFavorite({ name, logo, url, groupTitle });
      };
      button.appendChild(favoriteBtn);
      
      // Add channel name
      const nameDiv = document.createElement('div');
      nameDiv.textContent = name;
      nameDiv.style.marginTop = '0.5rem';
      nameDiv.style.fontSize = '0.85rem';
      nameDiv.style.fontWeight = '500';
      nameDiv.style.textAlign = 'center';
      nameDiv.style.lineHeight = '1.2';
      button.appendChild(nameDiv);
      
      // Add category badge if it exists
      if (groupTitle && groupTitle !== 'Other') {
        const badge = document.createElement('div');
        badge.className = 'category-badge';
        badge.textContent = groupTitle;
        button.appendChild(badge);
      }
        button.addEventListener('click', function() { 
        // Add to recently watched
        addToRecentlyWatched({ name, logo, url, groupTitle });
        
        // Hide side menu when channel is selected
        if (isMenuVisible) {
          toggleSideMenu();
        }
        
        if (url.includes('php?m3u8') ) {
          const iframe = document.createElement('iframe');
          iframe.src = 'https://www.mako.co.il/AjaxPage?jspName=embedHTML5video.jsp&galleryChannelId=7c5076a9b8757810VgnVCM100000700a10acRCRD&videoChannelId=d1d6f5dfc8517810VgnVCM100000700a10acRCRD&vcmid=1e2258089b67f510VgnVCM2000002a0c10acRCRD';
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          iframe.allowfullscreen = true;          document.getElementById('videoContainer').innerHTML = '';
          document.getElementById('videoContainer').appendChild(iframe);
          document.getElementById('videoContainer').style.display = 'block';
          
          // Hide channel picker and show back button
          document.getElementById('channelPicker').style.display = 'none';
          document.getElementById('backButton').style.display = 'block';
          document.getElementById('multiViewButton').style.display = 'none';
          isPickerVisible = false;
        } else {
          if (name === '13-kanal-il') {
            playVideoAndAudio(
              'https://d1zqtf09wb8nt5.cloudfront.net/livehls/oil/freetv/live/reshet_13_hevc/live.livx/playlist.m3u8?bitrate=5500000&videoId=0&renditions&fmp4&dvr=28800000',
              'https://d1zqtf09wb8nt5.cloudfront.net/livehls/oil/freetv/live/reshet_13_hevc/live.livx/playlist.m3u8?bitrate=128000&audioId=1&lang=pol&renditions&fmp4&dvr=28800000'
            );
          } else {
            playStream(url);
          }
        }
      });
      
      return button;
    }    function showPicker() {
      document.getElementById('channelPicker').style.display = 'grid';
      document.getElementById('videoContainer').style.display = 'none';
      document.getElementById('backButton').style.display = 'none';
      document.getElementById('multiViewButton').style.display = 'flex';
      
      // Show side menu when going back to channels
      if (!isMenuVisible) {
        sideMenu.classList.remove('hidden');
        contentArea.classList.remove('expanded');
        isMenuVisible = true;
      }
      
      isPickerVisible = true;
    }    function hidePicker() {
      document.getElementById('channelPicker').style.display = 'none';
      isPickerVisible = false;
    }

    function togglePicker() {
      if (isPickerVisible) {
        hidePicker();
      } else {
        showPicker();
      }
    }    // Event listeners
    document.getElementById('backButton').addEventListener('click', function() {
      // If video is playing, go back to channel picker
      if (!isPickerVisible) {
        showPicker();
        // Stop video playback
        if (currentVideoElement) {
          currentVideoElement.pause();
          currentVideoElement = null;
        }
        // Clear video container
        document.getElementById('videoContainer').innerHTML = '';
        updateMuteButtonVisibility(false);
      } else {
        // Otherwise toggle the side menu
        toggleSideMenu();
      }
    });function start() {
      const channelPicker = document.getElementById('channelPicker');
      const sideMenu = document.getElementById('sideMenu');
      channelPicker.innerHTML = '<div class="loading">Loading channels...</div>';
      
      fetch('https://raw.githubusercontent.com/renanbazinin/myM3U/main/directLiveNamesDiffandEPG1.m3u')
        .then(response => response.text())
        .then(data => {
          channelPicker.innerHTML = '';

          // Parse channels and collect categories
          const lines = data.split(/\r?\n/);
          const channels = [];
          const categories = new Set();
          let currentChannel = {};

          lines.forEach(line => {
            if (line.startsWith('#EXTINF:-1')) {
              if (currentChannel.name && currentChannel.logo && currentChannel.url) {
                channels.push(currentChannel);
                currentChannel = {};
              }
              const nameMatch = line.match(/tvg-id="([^"]+)"/);
              const logoMatch = line.match(/tvg-logo="([^"]+)"/);
              const groupTitleMatch = line.match(/group-title="([^"]+)"/);
              if (nameMatch && logoMatch) {
                currentChannel.name = nameMatch[1];
                currentChannel.logo = logoMatch[1];
                currentChannel.groupTitle = groupTitleMatch ? groupTitleMatch[1] : 'Other';
                categories.add(currentChannel.groupTitle);
              }
            } else if (line.trim() !== '' && !line.startsWith('#')) {
              currentChannel.url = line;
            }
          });
          
          // Add remaining channel if exists
          if (currentChannel.name && currentChannel.logo && currentChannel.url) {
            channels.push(currentChannel);
            categories.add(currentChannel.groupTitle);
          }
          
          // Filter out non-working channels using the same exclusion logic
          const removedChannels = [];
          const filteredChannels = channels.filter(channel => {
            if (isExcludedChannel(channel.name)) {
              removedChannels.push(channel.name);
              return false;
            }
            return true;
          });
          
          // Log filtering results
          const removedCount = channels.length - filteredChannels.length;
          if (removedCount > 0) {
            console.log(`Filtered out ${removedCount} non-working channel(s):`, removedChannels);
          }
          
          // Populate side menu with channels directly
          updateMenuChannels(filteredChannels);
          
          // Update favorites and recent
          updateFavoriteChannels();
          updateRecentChannels();
          
          // Store filtered channels globally for filtering
          window.allChannels = filteredChannels;
          
          // Display channels based on filter
          displayChannels(filteredChannels);
          
          // Auto-play first channel if supported, otherwise show menu
          if (filteredChannels.length > 0) {
            const firstChannel = filteredChannels[0];
            // Skip iframe-based channels for auto-play
            if (!firstChannel.url.includes('php?m3u8')) {
              // Hide side menu automatically
              if (isMenuVisible) toggleSideMenu();
              // Attempt to play via playStream, fallback to picker on failure
              playStream(firstChannel.url)
                .then(() => {
                  // Mark first channel as active
                  const firstMenuItem = document.querySelector('[data-index="0"]');
                  if (firstMenuItem) firstMenuItem.classList.add('active');
                })
                .catch(err => {
                  console.error('Auto-play failed:', err);
                  showPicker();
                });
            } else {
              // Cannot auto-play iframe streams; show picker
              showPicker();
            }
          }
        })
        .catch(error => {
          console.error('Error loading channels:', error);
          channelPicker.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem;">Failed to load channels. Please try again.</div>';
        });
    }

    function updateMenuChannels(channels) {
      const menuChannelsDiv = document.getElementById('menuChannels');
      const filteredChannels = searchTerm ? 
        channels.filter(ch => ch.name.toLowerCase().includes(searchTerm.toLowerCase())) : 
        channels;
      
      if (filteredChannels.length === 0) {
        menuChannelsDiv.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 2rem;">No channels found</div>';
      } else {
        menuChannelsDiv.innerHTML = filteredChannels.map((channel, index) => 
          `<div class="channel-menu-item" onclick="playChannelFromMenu('${channel.url}', '${channel.name}', ${index})" data-index="${index}">
            <img src="${channel.logo}" alt="${channel.name}" onerror="this.style.display='none'" style="width: 30px; height: 30px; border-radius: 6px; margin-right: 10px; object-fit: cover;">
            <span>${channel.name}</span>
          </div>`
        ).join('');
      }
    }
    
    function displayChannels(channelsToShow) {
      const channelPicker = document.getElementById('channelPicker');
      const noResults = document.getElementById('noResults');
      channelPicker.innerHTML = '';
      
      // Apply search filter
      let displayChannels = channelsToShow;
      if (searchTerm) {
        displayChannels = channelsToShow.filter(ch => 
          ch.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (ch.groupTitle && ch.groupTitle.toLowerCase().includes(searchTerm.toLowerCase()))
        );
      }
      
      if (displayChannels.length === 0) {
        noResults.style.display = 'block';
        channelPicker.style.display = 'none';
        return;
      } else {
        noResults.style.display = 'none';
        channelPicker.style.display = 'grid';
      }

      if (isFilterApplied && channelsToShow === window.allChannels) {
        // Show only Israel channels initially
        channelsToShow = window.allChannels.filter(channel => channel.groupTitle === 'Israel');
        
        // Add "Show US Channels" button
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
        channelPicker.appendChild(showUSChannelsButton);
        
        showUSChannelsButton.addEventListener('click', function() {
          isFilterApplied = false;
          displayChannels(window.allChannels);
        });
      }

      displayChannels.forEach(channel => {
        const button = createButton(channel.name, channel.logo, channel.url, channel.groupTitle);
        if (button) {
          channelPicker.appendChild(button);
        }
      });
    }    // Search functionality
    function setupSearch() {
      const globalSearch = document.getElementById('globalSearch');
      const menuSearch = document.getElementById('menuSearch');
      
      function handleSearch(value) {
        searchTerm = value;
        if (window.allChannels) {
          displayChannels(isFilterApplied ? 
            window.allChannels.filter(ch => ch.groupTitle === 'Israel') : 
            window.allChannels
          );
          updateMenuChannels(window.allChannels);
        }
      }
      
      globalSearch.addEventListener('input', (e) => {
        handleSearch(e.target.value);
        menuSearch.value = e.target.value;
      });
      
      menuSearch.addEventListener('input', (e) => {
        handleSearch(e.target.value);
        globalSearch.value = e.target.value;
      });
    }
    
    // Multi-view functionality
    function initMultiView() {
      const multiViewButton = document.getElementById('multiViewButton');
      const exitButton = document.getElementById('exitMultiView');
      const gridButtons = document.querySelectorAll('.grid-btn');
      
      multiViewButton.addEventListener('click', toggleMultiView);
      exitButton.addEventListener('click', exitMultiView);
      
      gridButtons.forEach(btn => {
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
    
    function enterMultiView() {
      isMultiViewMode = true;
      const multiViewButton = document.getElementById('multiViewButton');
      const multiViewContainer = document.getElementById('multiViewContainer');
      const videoContainer = document.getElementById('videoContainer');
      const channelPicker = document.getElementById('channelPicker');
      
      multiViewButton.classList.add('active');
      multiViewContainer.style.display = 'flex';
      videoContainer.style.display = 'none';
      channelPicker.style.display = 'none';
      
      // Hide single view elements
      document.getElementById('backButton').style.display = 'none';
      
      // Initialize grid
      createVideoGrid(currentGridLayout);
    }
    
    function exitMultiView() {
      isMultiViewMode = false;
      const multiViewButton = document.getElementById('multiViewButton');
      const multiViewContainer = document.getElementById('multiViewContainer');
      
      multiViewButton.classList.remove('active');
      multiViewContainer.style.display = 'none';
      
      // Exit fullscreen if active
      if (fullscreenSlotIndex !== null) {
        exitSlotFullscreen();
      }
      
      // Clean up all video streams
      multiViewSlots.forEach(slot => {
        if (slot && slot.video) {
          slot.video.pause();
          if (slot.hls) {
            slot.hls.destroy();
          }
        }
      });
      multiViewSlots = [];
      activeAudioSlot = null;
      fullscreenSlotIndex = null;
      
      // Show channel picker
      showPicker();
    }
    
    function changeGridLayout(layout) {
      currentGridLayout = layout;
      const grid = document.getElementById('multiViewGrid');
      
      // Exit fullscreen if active
      if (fullscreenSlotIndex !== null) {
        exitSlotFullscreen();
      }
      
      // Update active button
      document.querySelectorAll('.grid-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-grid') === layout);
      });
      
      // Update grid class
      grid.className = `multi-view-grid grid-${layout}`;
      
      // Recreate grid
      createVideoGrid(layout);
    }
    
    function createVideoGrid(layout) {
      const grid = document.getElementById('multiViewGrid');
      grid.innerHTML = '';
      
      // Calculate number of slots
      let slots = 4; // Default 2x2
      if (layout === '1x1') slots = 1;
      else if (layout === '3x3') slots = 9;
      else if (layout === '2x3') slots = 6;
      
      // Preserve existing streams where possible
      const oldSlots = [...multiViewSlots];
      multiViewSlots = [];
      
      for (let i = 0; i < slots; i++) {
        const slot = document.createElement('div');
        slot.className = 'video-slot empty';
        slot.setAttribute('data-slot-index', i);
        
        // Add click handler for empty slots
        slot.addEventListener('click', () => {
          if (slot.classList.contains('empty')) {
            openChannelSelector(i);
          }
        });
        
        // Add placeholder content
        const span = document.createElement('span');
        span.textContent = 'Click to add channel';
        slot.appendChild(span);
        
        grid.appendChild(slot);
        
        // Try to restore previous stream if it exists
        if (oldSlots[i] && oldSlots[i].channel) {
          loadChannelInSlot(i, oldSlots[i].channel);
        }
      }
      
      // Clean up any extra old slots
      for (let i = slots; i < oldSlots.length; i++) {
        if (oldSlots[i] && oldSlots[i].video) {
          oldSlots[i].video.pause();
          if (oldSlots[i].hls) {
            oldSlots[i].hls.destroy();
          }
        }
      }
    }
    
    function openChannelSelector(slotIndex) {
      selectedSlotIndex = slotIndex;
      
      // Create modal
      const modal = document.createElement('div');
      modal.className = 'channel-selector-modal';
      
      const content = document.createElement('div');
      content.className = 'channel-selector-content';
      
      const header = document.createElement('div');
      header.className = 'channel-selector-header';
      header.innerHTML = `
        <h3>Select Channel for Slot ${slotIndex + 1}</h3>
        <button class="channel-selector-close">&times;</button>
      `;
      
      const body = document.createElement('div');
      body.className = 'channel-selector-body';
      
      // Add channels
      window.allChannels.forEach(channel => {
        const item = document.createElement('div');
        item.className = 'channel-selector-item';
        item.innerHTML = `
          <img src="${channel.logo}" alt="${channel.name}" onerror="this.style.display='none'">
          <span>${channel.name}</span>
        `;
        item.addEventListener('click', () => {
          loadChannelInSlot(slotIndex, channel);
          modal.remove();
        });
        body.appendChild(item);
      });
      
      content.appendChild(header);
      content.appendChild(body);
      modal.appendChild(content);
      
      // Close button handler
      header.querySelector('.channel-selector-close').addEventListener('click', () => {
        modal.remove();
      });
      
      // Close on background click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });
      
      document.body.appendChild(modal);
    }
    
    function loadChannelInSlot(slotIndex, channel) {
      const slots = document.querySelectorAll('.video-slot');
      const slot = slots[slotIndex];
      
      if (!slot) return;
      
      // Clear existing content
      slot.innerHTML = '';
      slot.classList.remove('empty');
      
      // Create video element
      const video = document.createElement('video');
      video.className = 'video-element';
      video.controls = false; // We'll use custom controls
      video.autoplay = true;
      video.muted = activeAudioSlot !== slotIndex; // Only unmute if this is the active audio slot
      
      // Create controls
      const controls = document.createElement('div');
      controls.className = 'video-slot-controls';
      controls.innerHTML = `
        <button class="slot-control-btn mute-btn ${video.muted ? 'muted' : ''}" title="${video.muted ? 'Unmute' : 'Mute'}">
          ${video.muted ? '🔇' : '🔊'}
        </button>
        <button class="slot-control-btn swap-btn" title="Swap channels">🔄</button>
        <button class="slot-control-btn remove-btn" title="Remove channel">✕</button>
      `;
      
      // Create info overlay
      const info = document.createElement('div');
      info.className = 'video-slot-info';
      info.textContent = channel.name;
      
      // Add elements to slot
      slot.appendChild(video);
      slot.appendChild(controls);
      slot.appendChild(info);
      
      // Set up event handlers
      const muteBtn = controls.querySelector('.mute-btn');
      const swapBtn = controls.querySelector('.swap-btn');
      const removeBtn = controls.querySelector('.remove-btn');
      
      muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSlotAudio(slotIndex);
      });
      
      swapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // TODO: Implement channel swapping
      });
      
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeChannelFromSlot(slotIndex);
      });
      
      // Make slot clickable to focus audio
      slot.addEventListener('click', () => {
        if (!slot.classList.contains('empty')) {
          setActiveAudioSlot(slotIndex);
        }
      });
      
      // Add double-click for fullscreen toggle
      slot.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (!slot.classList.contains('empty')) {
          toggleSlotFullscreen(slotIndex);
        }
      });
      
      // Load stream
      if (channel.url.includes('php?m3u8')) {
        // Handle iframe channels
        video.remove();
        const iframe = document.createElement('iframe');
        iframe.src = 'https://www.mako.co.il/AjaxPage?jspName=embedHTML5video.jsp&galleryChannelId=7c5076a9b8757810VgnVCM100000700a10acRCRD&videoChannelId=d1d6f5dfc8517810VgnVCM100000700a10acRCRD&vcmid=1e2258089b67f510VgnVCM2000002a0c10acRCRD';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.allowfullscreen = true;
        slot.insertBefore(iframe, controls);
      } else if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(channel.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(err => console.error('Playback failed:', err));
        });
        
        // Store in slots array
        multiViewSlots[slotIndex] = {
          video: video,
          hls: hls,
          channel: channel,
          muted: video.muted
        };
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = channel.url;
        video.addEventListener('loadedmetadata', () => {
          video.play().catch(err => console.error('Playback failed:', err));
        });
        
        multiViewSlots[slotIndex] = {
          video: video,
          channel: channel,
          muted: video.muted
        };
      }
      
      // Add to recently watched
      addToRecentlyWatched(channel);
    }
    
    function toggleSlotAudio(slotIndex) {
      const slot = multiViewSlots[slotIndex];
      if (!slot || !slot.video) return;
      
      if (activeAudioSlot === slotIndex) {
        // Mute current active slot
        slot.video.muted = true;
        slot.muted = true;
        activeAudioSlot = null;
        updateSlotAudioButton(slotIndex, true);
      } else {
        // Unmute this slot and mute others
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
        
        // Add focused class
        const slotElement = document.querySelector(`[data-slot-index="${slotIndex}"]`);
        if (slotElement) {
          slotElement.classList.add('focused');
        }
      }
    }
    
    function updateSlotAudioButton(slotIndex, muted) {
      const slotElement = document.querySelector(`[data-slot-index="${slotIndex}"]`);
      if (!slotElement) return;
      
      const muteBtn = slotElement.querySelector('.mute-btn');
      if (muteBtn) {
        muteBtn.classList.toggle('muted', muted);
        muteBtn.textContent = muted ? '🔇' : '🔊';
        muteBtn.title = muted ? 'Unmute' : 'Mute';
      }
    }
    
    function removeChannelFromSlot(slotIndex) {
      const slot = multiViewSlots[slotIndex];
      if (slot) {
        if (slot.video) {
          slot.video.pause();
        }
        if (slot.hls) {
          slot.hls.destroy();
        }
      }
      
      multiViewSlots[slotIndex] = null;
      
      if (activeAudioSlot === slotIndex) {
        activeAudioSlot = null;
      }
      
      // Reset slot to empty state
      const slotElement = document.querySelector(`[data-slot-index="${slotIndex}"]`);
      if (slotElement) {
        slotElement.innerHTML = '<span>Click to add channel</span>';
        slotElement.className = 'video-slot empty';
        // Re-add click listener for empty slot
        const clickHandler = () => {
          if (slotElement.classList.contains('empty')) {
            openChannelSelector(slotIndex);
          }
        };
        slotElement.removeEventListener('click', clickHandler); // Remove any existing
        slotElement.addEventListener('click', clickHandler);
      }
    }
    
    // Toggle fullscreen for a specific slot
    function toggleSlotFullscreen(slotIndex) {
      const grid = document.getElementById('multiViewGrid');
      const slots = document.querySelectorAll('.video-slot');
      const targetSlot = slots[slotIndex];
      
      if (!targetSlot || targetSlot.classList.contains('empty')) return;
      
      if (fullscreenSlotIndex === slotIndex) {
        // Exit fullscreen
        exitSlotFullscreen();
      } else {
        // Enter fullscreen
        enterSlotFullscreen(slotIndex);
      }
    }
    
    function enterSlotFullscreen(slotIndex) {
      const grid = document.getElementById('multiViewGrid');
      const slots = document.querySelectorAll('.video-slot');
      const controls = document.querySelector('.multi-view-controls');
      
      // Hide grid controls in fullscreen
      if (controls) {
        controls.style.display = 'none';
      }
      
      // Hide all other slots
      slots.forEach((slot, idx) => {
        if (idx !== slotIndex) {
          slot.style.display = 'none';
        } else {
          slot.classList.add('fullscreen');
        }
      });
      
      // Make grid fullscreen layout
      grid.classList.add('fullscreen-mode');
      fullscreenSlotIndex = slotIndex;
      
      // Ensure audio is on for fullscreen slot
      setActiveAudioSlot(slotIndex);
    }
    
    function exitSlotFullscreen() {
      const grid = document.getElementById('multiViewGrid');
      const slots = document.querySelectorAll('.video-slot');
      const controls = document.querySelector('.multi-view-controls');
      
      // Show grid controls again
      if (controls) {
        controls.style.display = 'flex';
      }
      
      // Show all slots
      slots.forEach(slot => {
        slot.style.display = '';
        slot.classList.remove('fullscreen');
      });
      
      // Remove fullscreen layout
      grid.classList.remove('fullscreen-mode');
      fullscreenSlotIndex = null;
    }
    
    window.onload = function() {
      start();
      setupSearch();
      initMultiView();
    };

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        // If in multi-view fullscreen, exit fullscreen first
        if (isMultiViewMode && fullscreenSlotIndex !== null) {
          exitSlotFullscreen();
        } else if (!isPickerVisible) {
          showPicker();
        }
      } else if (e.key === 'h' || e.key === 'H') {
        togglePicker();
      } else if (e.key >= '0' && e.key <= '9') {
        handleNumericInput(e.key);
      }
    });

    // New functions for two-digit channel input
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
            if (channelNumber > 0) {
                const channelIndex = channelNumber - 1;
                if (window.allChannels && window.allChannels[channelIndex]) {
                    const channel = window.allChannels[channelIndex];
                    playChannelFromMenu(channel.url, channel.name, channelIndex);
                }
            }
            resetChannelInput();
        }, 1500); // 1.5-second wait
    } else if (channelInput.length === 2) {
        const channelNumber = parseInt(channelInput.join(''));
        const channelIndex = channelNumber - 1;

        if (window.allChannels && window.allChannels[channelIndex]) {
            const channel = window.allChannels[channelIndex];
            playChannelFromMenu(channel.url, channel.name, channelIndex);
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

// New function to play separate video and audio streams for specific channel
function playVideoAndAudio(videoUrl, audioUrl) {
  return new Promise((resolve, reject) => {
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
    // Store video element reference
    currentVideoElement = videoElement;
    const container = document.getElementById('videoContainer');
    // Use HLS.js for both streams
    if (Hls.isSupported()) {
      const hlsVideo = new Hls();
      hlsVideo.loadSource(videoUrl);
      hlsVideo.attachMedia(videoElement);
      const hlsAudio = new Hls();
      hlsAudio.loadSource(audioUrl);
      hlsAudio.attachMedia(audioElement);
      hlsVideo.on(Hls.Events.MANIFEST_PARSED, () => {
        container.innerHTML = '';
        container.appendChild(videoElement);
        container.appendChild(audioElement);
        container.style.display = 'block';
        document.getElementById('channelPicker').style.display = 'none';
        document.getElementById('backButton').style.display = 'block';
        document.getElementById('multiViewButton').style.display = 'none';
        updateMuteButtonVisibility(false);
        const muteButton = document.getElementById('muteButton');
        muteButton.textContent = '🔊';
        muteButton.classList.remove('muted');
        muteButton.title = 'Mute';
        videoElement.play()
          .then(() => audioElement.play().then(resolve).catch(reject))
          .catch(reject);
      });
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = videoUrl;
      audioElement.src = audioUrl;
      videoElement.addEventListener('loadedmetadata', () => {
        container.innerHTML = '';
        container.appendChild(videoElement);
        container.appendChild(audioElement);
        container.style.display = 'block';
        document.getElementById('channelPicker').style.display = 'none';
        document.getElementById('backButton').style.display = 'block';
        document.getElementById('multiViewButton').style.display = 'none';
        updateMuteButtonVisibility(false);
        const muteButton = document.getElementById('muteButton');
        muteButton.textContent = '🔊';
        muteButton.classList.remove('muted');
        muteButton.title = 'Mute';
        Promise.all([videoElement.play(), audioElement.play()]).then(resolve).catch(reject);
      });
    } else {
      reject(new Error('HLS is not supported'));
    }
  });
}