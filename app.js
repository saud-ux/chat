/* ==========================================================
       FIREBASE CONFIG — REPLACE THESE WITH YOUR PROJECT VALUES

       1. Go to https://console.firebase.google.com
       2. Create a new project (or use existing)
       3. Enable Realtime Database (in test mode)
       4. Enable Storage
       5. Go to Project Settings > General > Your Apps > Add Web App
       6. Copy the config values below

       Firebase Database Rules (set in console):
       {
         "rules": {
           ".read": true,
           ".write": true,
           "chats": {
             "$chatId": {
               "messages": {
                 ".indexOn": ["timestamp"]
               }
             }
           }
         }
       }

       Media is stored as base64 data URLs directly in the database.
       No Firebase Storage needed.
    ========================================================== */
    const firebaseConfig = {
      apiKey: "AIzaSyDX4pYBF1gD5TnRizdsF4-iOxBP8Ia-OxM",
      authDomain: "chat-app-75b2a.firebaseapp.com",
      databaseURL: "https://chat-app-75b2a-default-rtdb.firebaseio.com",
      projectId: "chat-app-75b2a",
      storageBucket: "chat-app-75b2a.firebasestorage.app",
      messagingSenderId: "200426498638",
      appId: "1:200426498638:web:95bc45abec222a0439311f"
    };

    const IS_CONFIGURED = firebaseConfig.apiKey !== "YOUR_API_KEY";

    let db;
    let serverTimeOffset = 0;
    if (IS_CONFIGURED) {
      firebase.initializeApp(firebaseConfig);
      db = firebase.database();
      // Track clock skew so presence "online" checks use server-relative time.
      db.ref('.info/serverTimeOffset').on('value', s => { serverTimeOffset = s.val() || 0; });
    }

    /* ==========================================================
       CONSTANTS
    ========================================================== */
    const CONTACTS = {
      w: { name: 'W', color: '#5B8FB9' },
      aseel: { name: 'أسيل', color: '#E8A87C' },
      saud: { name: 'سعود', color: '#6C5CE7' }
    };

    const VAPID_PUBLIC_KEY = 'BOIMSoH3ZuHz_eL09w-2cOw7FSGyTTew3q3XlJsuwe4yBvnEbi1ee3mnwz3hOvS4rA_SigRsest_GbV_KgLZPV8';
    const PIN_CODE = 'SAUD_51152';

    const AVATARS = {
      w: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="24" fill="#5B8FB9"/><text x="24" y="31" text-anchor="middle" fill="#fff" font-size="22" font-weight="700" font-family="Arial, sans-serif">W</text></svg>',
      aseel: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="24" fill="#E8A87C"/><text x="24" y="31" text-anchor="middle" fill="#fff" font-size="22" font-weight="700" font-family="Arial, sans-serif">A</text></svg>',
      saud: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="24" fill="#6C5CE7"/><text x="24" y="31" text-anchor="middle" fill="#fff" font-size="22" font-weight="700" font-family="Arial, sans-serif">S</text></svg>'
    };

    /* ==========================================================
       STATE
    ========================================================== */
    let currentView = null;
    let currentChatId = null;
    let currentUser = null;
    let pendingFile = null;
    let pendingPreviewUrl = null;
    let mediaRecorder = null;
    let recChunks = [];
    let recStream = null;
    let micStream = null;
    let micReleaseTimer = null;
    let recTimer = null;
    let recSeconds = 0;
    let recShouldSend = false;
    let recFinalDuration = 0;
    let currentAudioEl = null;
    let currentAudioBtn = null;
    let activeListeners = [];
    let totalUnread = { w: 0, aseel: 0 };
    let isFirstLoad = {};
    let pinnedToBottom = false;
    let audioCtx = null;
    let myMessages = [];
    let otherSeenTimestamp = 0;
    let editingKey = null;
    let typingTimer = null;
    let typingCheckInterval = null;
    let presenceTimer = null;
    let replyToKey = null;
    let replyToMsg = null;
    let searchOpen = false;
    let allMsgElements = [];
    let knownReactions = {};
    let currentWallpaper = null;
    let ensureAllLoaded = null; // loads the full history for the open chat (used by search)
    let requestLoadOlder = null; // fetches the previous page of older messages for the open chat
    let activeGameRef = null;
    let activeGameCb = null;

    /* ==========================================================
       DOM REFERENCES
    ========================================================== */
    const $ = id => document.getElementById(id);

    // Theme init
    (function() {
      const saved = localStorage.getItem('chat_theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    })();


    /* ==========================================================
       ROUTER
    ========================================================== */
    const APP_USER = (function() {
      const p = window.location.pathname;
      if (p.startsWith('/w')) return 'w';
      if (p.startsWith('/aseel')) return 'aseel';
      return 'saud';
    })();

    function route() {
      cleanup();
      const path = window.location.pathname.replace(/\/+$/, '') || '/';

      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

      // Dynamic manifest for PWA home screen
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (APP_USER === 'w') {
        manifestLink.href = '/manifest-w.json';
        appleTitleMeta.content = 'W';
      } else if (APP_USER === 'aseel') {
        manifestLink.href = '/manifest-aseel.json';
        appleTitleMeta.content = 'أسيل';
      } else {
        manifestLink.href = '/manifest.json';
        appleTitleMeta.content = 'رسائل';
      }

      // PIN protection for Saud's routes
      if (APP_USER === 'saud' && !isPinVerified()) {
        showPinOverlay();
        return;
      }
      $('pin-overlay').style.display = 'none';

      if (APP_USER === 'saud') {
        if (path === '/chat/w') {
          currentView = 'chat';
          $('page-chat').classList.add('active');
          showChat('w', 'saud');
        } else if (path === '/chat/aseel') {
          currentView = 'chat';
          $('page-chat').classList.add('active');
          showChat('aseel', 'saud');
        } else {
          currentView = 'home';
          $('page-home').classList.add('active');
          showHome('saud');
        }
      } else if (APP_USER === 'w') {
        if (path === '/w/chat') {
          currentView = 'chat';
          $('page-chat').classList.add('active');
          showChat('w', 'w');
        } else {
          currentView = 'home';
          $('page-home').classList.add('active');
          showHome('w');
        }
      } else {
        if (path === '/aseel/chat') {
          currentView = 'chat';
          $('page-chat').classList.add('active');
          showChat('aseel', 'aseel');
        } else {
          currentView = 'home';
          $('page-home').classList.add('active');
          showHome('aseel');
        }
      }
    }

    function navigate(path, e) {
      if (e) e.preventDefault();
      history.pushState(null, '', path);
      route();
    }

    // Leave the chat with a smooth slide-out: the real chat page slides off
    // to the left on top while the home page is revealed beneath it. State is
    // torn down first (same order as route: cleanup, then render home).
    function exitChatSmoothly(path) {
      path = path || '/';
      const chat = $('page-chat');
      const home = $('page-home');
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!chat || !home || !chat.classList.contains('active') || reduce) {
        navigate(path);
        return;
      }
      history.pushState(null, '', path);
      cleanup();
      currentView = 'home';
      home.classList.add('active');
      showHome(homeUser);
      // Slide the (still-visible) chat page off to the left over the home page.
      chat.classList.add('page-exiting');
      chat.style.zIndex = '50';
      requestAnimationFrame(() => chat.classList.add('page-exit-go'));
      const done = () => {
        chat.removeEventListener('transitionend', done);
        chat.classList.remove('active', 'page-exiting', 'page-exit-go');
        chat.style.zIndex = '';
      };
      chat.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 420);
    }

    function goToGamesPage() {
      const homePath = APP_USER === 'saud' ? '/' : '/' + APP_USER;
      exitChatSmoothly(homePath);
      setTimeout(() => swipeTo('games'), 350);
    }

    /* ==========================================================
       CLEANUP LISTENERS
    ========================================================== */
    function cleanup() {
      if (currentChatId && currentUser && db) {
        db.ref(`chats/${currentChatId}/typing/${currentUser}`).remove();
      }
      stopPresence();
      clearTimeout(typingTimer);
      clearInterval(typingCheckInterval);
      activeListeners.forEach(({ ref, event, cb }) => ref.off(event, cb));
      activeListeners = [];
      clearPendingMedia();
      if (mediaRecorder) stopRecording(false);
      releaseMic();
      if (currentAudioEl) { currentAudioEl.pause(); resetAudioBtn(currentAudioBtn); currentAudioEl = null; currentAudioBtn = null; }
      currentChatId = null;
      currentUser = null;
      myMessages = [];
      otherSeenTimestamp = 0;
      editingKey = null;
      replyToKey = null;
      replyToMsg = null;
      searchOpen = false;
      allMsgElements = [];
      knownReactions = {};
      currentWallpaper = null;
      ensureAllLoaded = null;
      requestLoadOlder = null;
      const ei = $('edit-indicator');
      if (ei) ei.style.display = 'none';
      const sb = $('btn-send');
      if (sb) sb.style.background = '';
      const rp = document.getElementById('reply-preview');
      if (rp) rp.remove();
      const srch = document.getElementById('search-bar');
      if (srch) srch.remove();
      const rpicker = document.getElementById('reaction-picker');
      if (rpicker) rpicker.remove();
    }

    function addListener(ref, event, cb) {
      ref.on(event, cb);
      activeListeners.push({ ref, event, cb });
    }

    /* ==========================================================
       HOME PAGE
    ========================================================== */
    let homeUser = 'saud';

    function showHome(user) {
      homeUser = user || 'saud';
      currentHomePage = 'chats';
      stopActiveGame();
      const cp = $('swipe-page-chats');
      const gp = $('swipe-page-games');
      if (cp) cp.style.transform = '';
      if (gp) gp.style.transform = '';
      const dc = $('dot-chats');
      const dg = $('dot-games');
      if (dc) dc.classList.add('active');
      if (dg) dg.classList.remove('active');
      const ht = $('home-title');
      if (ht) ht.textContent = 'رسائل';

      if (!IS_CONFIGURED) {
        $('chat-list').innerHTML = `
          <div class="setup-msg">
            <h2>⚙️ Setup Required</h2>
            <p>Open <code>index.html</code> and replace the <code>firebaseConfig</code> values with your Firebase project credentials.<br><br>
            Then set your Firebase Database rules to allow read/write, and enable Storage.</p>
          </div>`;
        return;
      }

      const list = $('chat-list');
      list.innerHTML = '';

      let chatPartners, chatPath;
      if (homeUser === 'saud') {
        chatPartners = ['w', 'aseel'];
        chatPath = (id) => `/chat/${id}`;
      } else if (homeUser === 'w') {
        chatPartners = ['saud'];
        chatPath = () => '/w/chat';
      } else {
        chatPartners = ['saud'];
        chatPath = () => '/aseel/chat';
      }

      chatPartners.forEach(partnerId => {
        const chatId = homeUser === 'saud' ? partnerId : homeUser;
        const card = document.createElement('div');
        card.className = 'chat-card';
        card.id = `card-${partnerId}`;
        card.onclick = (e) => navigate(chatPath(partnerId), e);
        card.innerHTML = `
          <div class="chat-avatar" style="background:${CONTACTS[partnerId].color}">
            ${AVATARS[partnerId]}
          </div>
          <div class="chat-info">
            <div class="chat-name">
              <span>${CONTACTS[partnerId].name}</span>
              <span class="chat-time" id="time-${chatId}"></span>
            </div>
            <div class="chat-preview-row">
              <span class="chat-preview" id="preview-${chatId}">لا توجد رسائل</span>
              <span class="unread-badge hidden" id="badge-${chatId}">0</span>
            </div>
          </div>`;
        list.appendChild(card);

        const msgRef = db.ref(`chats/${chatId}/messages`).orderByChild('timestamp').limitToLast(1);
        addListener(msgRef, 'value', snap => {
          let lastMsg = null;
          snap.forEach(child => { lastMsg = child.val(); });
          if (lastMsg) {
            const previewEl = $(`preview-${chatId}`);
            const timeEl = $(`time-${chatId}`);
            if (previewEl) previewEl.textContent = msgPreview(lastMsg);
            if (timeEl) timeEl.textContent = formatRelative(lastMsg.timestamp);
          }
        });

        updateUnreadForChat(chatId, homeUser);
      });

      requestNotifPermission();
      listenForHomeNotifications(homeUser, chatPartners);
    }

    function updateUnreadForChat(chatId, user) {
      if (!IS_CONFIGURED) return;
      user = user || 'saud';
      const lastRead = parseInt(localStorage.getItem(`lastRead_${user}_${chatId}`) || '0');
      const ref = db.ref(`chats/${chatId}/messages`).orderByChild('timestamp');
      const startRef = lastRead ? ref.startAt(lastRead + 1) : ref;

      addListener(startRef, 'value', snap => {
        let count = 0;
        snap.forEach(child => {
          if (child.val().sender !== user) count++;
        });
        totalUnread[chatId] = count;
        const badge = $(`badge-${chatId}`);
        if (badge) {
          badge.textContent = count;
          badge.classList.toggle('hidden', count === 0);
        }
        updateTitleBadge();
      });
    }

    function listenForHomeNotifications(user, partners) {
      user = user || 'saud';
      const chatIds = user === 'saud' ? ['w', 'aseel'] : [user];
      chatIds.forEach(chatId => {
        const ref = db.ref(`chats/${chatId}/messages`).orderByChild('timestamp').limitToLast(1);
        let initial = true;
        addListener(ref, 'child_added', snap => {
          if (initial) { initial = false; return; }
          const msg = snap.val();
          if (msg.sender !== user) {
            const partnerName = user === 'saud' ? CONTACTS[chatId].name : CONTACTS.saud.name;
            notify(chatId, partnerName, msgPreview(msg));
          }
        });
      });
    }

    function msgPreview(msg) {
      if (msg.type === 'image') return '📷 صورة';
      if (msg.type === 'gif') return '🎞️ GIF';
      if (msg.type === 'video') return '🎥 فيديو';
      if (msg.type === 'audio') return '🎤 رسالة صوتية';
      if (msg.type === 'game') return msg.game === 'rps' ? '🎮 حجرة ورقة مقص' : msg.game === 'c4' ? '🎮 أربعة في خط' : msg.game === 'guess' ? '🎮 خمّن الرقم' : '🎮 لعبة إكس أو';
      return msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content;
    }

    /* ==========================================================
       CHAT PAGE
    ========================================================== */
    function showChat(chatId, user) {
      if (!IS_CONFIGURED) return;

      currentChatId = chatId;
      currentUser = user;
      isFirstLoad[chatId] = true;

      const isSaud = user === 'saud';
      const partnerId = isSaud ? chatId : 'saud';
      const partnerName = CONTACTS[partnerId].name;
      const partnerColor = CONTACTS[partnerId].color;
      const partnerAvatar = AVATARS[partnerId];

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const sunSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
      const moonSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
      $('chat-header').innerHTML = `
        <button class="btn-back" onclick="exitChatSmoothly('${isSaud ? '/' : '/' + user}')">→</button>
        <div class="chat-header-avatar" style="background:${partnerColor}">
          ${partnerAvatar}
          <span class="presence-dot" id="presence-dot"></span>
        </div>
        <div class="chat-header-info">
          <span class="chat-header-name">${partnerName}</span>
          <span class="chat-header-status" id="chat-header-status"></span>
        </div>
        <div class="header-actions">
          <button class="header-action-btn" onclick="goToGamesPage()" aria-label="لعبة"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><path d="M17.32 5H6.68a4 4 0 00-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 003 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 019.828 16h4.344a2 2 0 011.414.586L17 18c.5.5 1 1 2 1a3 3 0 003-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0017.32 5z"/></svg></button>
          <button class="header-action-btn" onclick="toggleSearch()" aria-label="بحث"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
          <button class="header-action-btn" id="btn-theme" onclick="toggleTheme()" aria-label="الوضع">${isDark ? sunSvg : moonSvg}</button>
          <button class="header-action-btn" onclick="openSettings()" aria-label="إعدادات"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></button>
          <button class="header-action-btn" onclick="forceUpdate(this)" aria-label="تحديث"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button>
        </div>`;

      const area = $('messages-area');
      area.innerHTML = '';
      area.style.display = 'flex';
      const inputAreaEl = $('input-area');
      if (inputAreaEl) inputAreaEl.style.display = 'flex';

      area.addEventListener('scroll', () => {
        const distFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
        // Stay pinned to the newest message while the reader is at the bottom;
        // release the pin the moment they scroll up to read history.
        pinnedToBottom = distFromBottom < 120;
        const btn = $('btn-scroll-bottom');
        if (!btn) return;
        btn.classList.toggle('visible', distFromBottom > 150);
        if (distFromBottom <= 150) btn.classList.remove('has-new');
      });

      // Media (images/GIFs/videos) load after layout and grow the page; while
      // pinned to the bottom, snap back down so you always land on the last
      // message when opening a chat.
      if (!area._loadPinBound) {
        area._loadPinBound = true;
        area.addEventListener('load', (e) => {
          const tag = e.target && e.target.tagName;
          if (pinnedToBottom && (tag === 'IMG' || tag === 'VIDEO')) {
            area.scrollTop = area.scrollHeight;
          }
        }, true); // capture: load doesn't bubble
      }
      pinnedToBottom = true; // start pinned on open

      setupChatExitSwipe();

      currentWallpaper = null;
      area.style.backgroundImage = '';
      area.classList.remove('has-wallpaper-img');
      const wpRef = db.ref(`chats/${chatId}/wallpaper`);
      addListener(wpRef, 'value', snap => {
        const wpImg = snap.val();
        currentWallpaper = wpImg;
        const a = $('messages-area');
        if (a) {
          if (wpImg) {
            a.style.backgroundImage = `url(${wpImg})`;
            a.classList.add('has-wallpaper-img');
          } else {
            a.style.backgroundImage = '';
            a.classList.remove('has-wallpaper-img');
          }
        }
      });

      if (isSaud) {
        localStorage.setItem(`lastRead_saud_${chatId}`, Date.now().toString());
      } else {
        localStorage.setItem(`lastRead_${chatId}_${user}`, Date.now().toString());
      }

      // Windowed loading: long conversations used to sync and render EVERY
      // message on open, which made chats slow to load. Instead we render only
      // the most recent PAGE_SIZE messages, then lazily fetch older history
      // when the reader scrolls to the top.
      const baseRef = db.ref(`chats/${chatId}/messages`).orderByChild('timestamp');
      const PAGE_SIZE = 50;
      let lastDateStr = '';
      let loaded = [];               // chronological [{ key, msg }] of what's rendered
      let renderedKeys = new Set();
      let oldestLoadedTs = null;
      let newestLoadedTs = 0;
      let reachedStart = false;      // no older messages remain to load
      let loadingOlder = false;
      let changeListeners = [];      // child_changed / child_removed handles (re-bound as window grows)

      const dateStrOf = (ts) => new Date(ts).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

      // Build the DOM element for a single message (content, gestures, tracking).
      function buildMsgEl(key, msg) {
        const isMine = msg.sender === user;
        const el = document.createElement('div');
        el.className = `message ${isMine ? 'message-mine' : 'message-theirs'}`;
        el.dataset.key = key;
        el.dataset.type = msg.type;
        renderMsgContent(el, msg, isMine);
        allMsgElements.push({ el, key, msg });
        knownReactions[key] = msg.reactions ? JSON.parse(JSON.stringify(msg.reactions)) : {};
        if (isMine && !msg.deleted) {
          myMessages.push({ el, timestamp: msg.timestamp });
          if (msg.type !== 'game') {
            addTapGestures(el, () => { burstHearts(el); addReaction(key, '❤️'); }, () => showMsgActions(key, msg.type, true));
            addSwipeReply(el, key);
          }
          addLongPress(el, () => showMsgActions(key, msg.type, true));
        } else if (!isMine && !msg.deleted) {
          if (msg.type !== 'game') {
            addTapGestures(el, () => { burstHearts(el); addReaction(key, '❤️'); }, () => showMsgActions(key, msg.type, false));
            addSwipeReply(el, key);
          }
          addLongPress(el, () => showMsgActions(key, msg.type, false));
        }
        return el;
      }

      // Rebuild the whole message list from `loaded` (used on initial load and
      // when older history is prepended). Keeps date separators correct.
      function renderAll() {
        area.innerHTML = '';
        allMsgElements = [];
        myMessages = [];
        knownReactions = {};
        lastDateStr = '';
        loaded.forEach(({ key, msg }) => {
          const dateStr = dateStrOf(msg.timestamp);
          if (dateStr !== lastDateStr) {
            lastDateStr = dateStr;
            const sep = document.createElement('div');
            sep.className = 'date-separator';
            sep.innerHTML = `<span>${dateStr}</span>`;
            area.appendChild(sep);
          }
          area.appendChild(buildMsgEl(key, msg));
        });
        updateSeenIndicator();
      }

      // Bind child_changed / child_removed to the currently-loaded range so
      // edits, reactions and deletes stay live without syncing the whole history.
      function attachChangeListeners() {
        changeListeners.forEach(({ ref, event, cb }) => {
          ref.off(event, cb);
          const i = activeListeners.findIndex(l => l.ref === ref && l.event === event && l.cb === cb);
          if (i !== -1) activeListeners.splice(i, 1);
        });
        changeListeners = [];
        const q = baseRef.startAt(oldestLoadedTs != null ? oldestLoadedTs : 0);

        const changedCb = snap => {
          const msg = snap.val();
          const el = document.querySelector(`[data-key="${snap.key}"]`);
          if (!el) return;
          const isMine = msg.sender === user;
          if (isMine && !isFirstLoad[chatId] && msg.reactions) {
            const oldReactions = knownReactions[snap.key] || {};
            Object.entries(msg.reactions).forEach(([reactor, emoji]) => {
              if (reactor !== user && oldReactions[reactor] !== emoji) {
                const reactorName = reactor === 'saud' ? 'سعود' : (CONTACTS[reactor] ? CONTACTS[reactor].name : reactor);
                notify(chatId, reactorName, `تفاعل على رسالتك ${emoji}`);
              }
            });
          }
          knownReactions[snap.key] = msg.reactions ? JSON.parse(JSON.stringify(msg.reactions)) : {};
          renderMsgContent(el, msg, isMine);
          const entry = loaded.find(m => m.key === snap.key);
          if (entry) entry.msg = msg;
          if (msg.deleted && isMine) {
            myMessages = myMessages.filter(m => m.el !== el);
            updateSeenIndicator();
          }
        };

        const removedCb = snap => {
          const el = document.querySelector(`[data-key="${snap.key}"]`);
          if (el) {
            const prev = el.previousElementSibling;
            const next = el.nextElementSibling;
            if (prev && prev.classList.contains('date-separator') && (!next || next.classList.contains('date-separator'))) {
              prev.remove();
            }
            el.remove();
          }
          myMessages = myMessages.filter(m => m.el !== el);
          allMsgElements = allMsgElements.filter(m => m.key !== snap.key);
          loaded = loaded.filter(m => m.key !== snap.key);
          renderedKeys.delete(snap.key);
          delete knownReactions[snap.key];
          updateSeenIndicator();
        };

        q.on('child_changed', changedCb);
        q.on('child_removed', removedCb);
        changeListeners.push({ ref: q, event: 'child_changed', cb: changedCb });
        changeListeners.push({ ref: q, event: 'child_removed', cb: removedCb });
        activeListeners.push({ ref: q, event: 'child_changed', cb: changedCb });
        activeListeners.push({ ref: q, event: 'child_removed', cb: removedCb });
      }

      // Fetch the previous page of older messages and prepend them.
      function loadOlder(onDone) {
        if (loadingOlder || reachedStart || oldestLoadedTs == null) { if (onDone) onDone(false); return; }
        loadingOlder = true;
        const prevHeight = area.scrollHeight;
        const prevTop = area.scrollTop;
        baseRef.endAt(oldestLoadedTs).limitToLast(PAGE_SIZE + 1).once('value', snap => {
          if (currentChatId !== chatId) { loadingOlder = false; return; }
          const older = [];
          snap.forEach(c => { if (!renderedKeys.has(c.key)) older.push({ key: c.key, msg: c.val() }); });
          if (older.length === 0) { reachedStart = true; loadingOlder = false; if (onDone) onDone(false); return; }
          if (older.length < PAGE_SIZE) reachedStart = true;
          older.forEach(it => renderedKeys.add(it.key));
          loaded = older.concat(loaded);
          oldestLoadedTs = loaded[0].msg.timestamp;
          renderAll();
          // Keep the reader anchored to the message they were viewing.
          area.scrollTop = prevTop + (area.scrollHeight - prevHeight);
          attachChangeListeners();
          loadingOlder = false;
          if (onDone) onDone(true);
        });
      }

      // Pull the rest of the history in (used by search so it can span the
      // whole conversation, not just the loaded window).
      function loadAllOlder(onDone) {
        if (reachedStart) { if (onDone) onDone(); return; }
        loadOlder(gotMore => {
          if (currentChatId !== chatId) return;
          if (gotMore && !reachedStart) loadAllOlder(onDone);
          else if (onDone) onDone();
        });
      }
      ensureAllLoaded = loadAllOlder;

      // Load newer messages that arrive after the initial window.
      function handleNewMessage(key, msg) {
        if (renderedKeys.has(key)) return;
        renderedKeys.add(key);
        const isMine = msg.sender === user;
        const wasNearBottom = area
          ? (area.scrollHeight - area.scrollTop - area.clientHeight) < 150
          : true;
        loaded.push({ key, msg });
        newestLoadedTs = msg.timestamp;
        if (oldestLoadedTs == null) oldestLoadedTs = msg.timestamp;

        // If the list was emptied (e.g. by clearChat), force a fresh separator.
        if (!area.querySelector('.message')) lastDateStr = '';
        const dateStr = dateStrOf(msg.timestamp);
        if (dateStr !== lastDateStr) {
          lastDateStr = dateStr;
          const sep = document.createElement('div');
          sep.className = 'date-separator';
          sep.innerHTML = `<span>${dateStr}</span>`;
          area.appendChild(sep);
        }
        area.appendChild(buildMsgEl(key, msg));
        updateSeenIndicator();

        if (!isMine && !isFirstLoad[chatId]) {
          db.ref(`chats/${chatId}/seen/${user}`).set(firebase.database.ServerValue.TIMESTAMP);
        }
        // Keep saud's read marker current while the chat is open so the home
        // screen unread count stays accurate.
        if (user === 'saud') {
          localStorage.setItem(`lastRead_saud_${chatId}`, Date.now().toString());
        }

        if (isFirstLoad[chatId]) {
          scrollToBottom(false);
        } else {
          if (isMine || wasNearBottom) {
            scrollToBottom(true);
          } else {
            showNewMsgPill();
          }
          if (!isMine) {
            const name = user === 'saud' ? CONTACTS[chatId].name : 'سعود';
            notify(chatId, name, msgPreview(msg));
          }
        }
      }

      // Initial window: only the most recent PAGE_SIZE messages.
      baseRef.limitToLast(PAGE_SIZE).once('value', snap => {
        if (currentChatId !== chatId) return;
        const items = [];
        snap.forEach(c => { items.push({ key: c.key, msg: c.val() }); });
        items.forEach(it => renderedKeys.add(it.key));
        loaded = items;
        reachedStart = items.length < PAGE_SIZE;
        oldestLoadedTs = items.length ? items[0].msg.timestamp : null;
        newestLoadedTs = items.length ? items[items.length - 1].msg.timestamp : 0;
        renderAll();
        scrollToBottom(false);

        // Live listener for messages newer than the initial window. startAt on
        // the newest loaded timestamp re-delivers the boundary message, which the
        // renderedKeys guard dedupes, so no message is ever missed or duplicated.
        addListener(baseRef.startAt(newestLoadedTs), 'child_added', s => {
          handleNewMessage(s.key, s.val());
        });

        attachChangeListeners();
      });

      // Lazily load older history when scrolled near the top. Bind the scroll
      // handler once for the persistent messages-area element (it outlives
      // individual chats) and route through the current chat's loader.
      requestLoadOlder = loadOlder;
      if (!area._olderBound) {
        area._olderBound = true;
        area.addEventListener('scroll', () => {
          if (area.scrollTop < 80 && requestLoadOlder) requestLoadOlder();
        });
      }

      // Mark seen immediately on open so the double-tick reaches the sender fast
      db.ref(`chats/${chatId}/seen/${user}`).set(firebase.database.ServerValue.TIMESTAMP);

      setTimeout(() => {
        isFirstLoad[chatId] = false;
        scrollToBottom(false);
        db.ref(`chats/${chatId}/seen/${user}`).set(firebase.database.ServerValue.TIMESTAMP);
      }, 800);

      const otherUser = (user === 'saud') ? chatId : 'saud';
      const otherSeenRef = db.ref(`chats/${chatId}/seen/${otherUser}`);
      addListener(otherSeenRef, 'value', snap => {
        otherSeenTimestamp = snap.val() || 0;
        updateSeenIndicator();
        refreshPresenceView(); // "online" is derived from a fresh seen heartbeat
      });

      // Typing indicator listener
      const otherTypingRef = db.ref(`chats/${chatId}/typing/${otherUser}`);
      addListener(otherTypingRef, 'value', snap => {
        const isTyping = snap.val();
        const indicator = $('typing-indicator');
        if (isTyping) {
          indicator.style.display = 'flex';
          scrollToBottom(true);
        } else {
          indicator.style.display = 'none';
        }
      });

      db.ref(`chats/${chatId}/typing/${user}`).onDisconnect().remove();

      // Presence: while this chat is open and foregrounded, heartbeat my "seen"
      // timestamp; the other side reads it and lights up the header when it's
      // fresh. We ride on the existing seen path (proven to sync both ways via
      // read receipts) so no new database rule is needed.
      startPresence();

      // Show notification prompt if permission not granted
      if ('Notification' in window && Notification.permission === 'default' && !localStorage.getItem('notif_dismissed_' + user)) {
        const oldPrompt = document.getElementById('notif-prompt');
        if (oldPrompt) oldPrompt.remove();
        const prompt = document.createElement('div');
        prompt.id = 'notif-prompt';
        prompt.style.cssText = 'background:var(--accent);color:#fff;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;flex-shrink:0;';
        prompt.innerHTML = '<span style="flex:1">فعّل الإشعارات لتصلك الرسائل</span>' +
          '<button onclick="enableNotif()" style="background:rgba(255,255,255,0.25);border:none;color:#fff;padding:6px 14px;border-radius:20px;font-size:13px;cursor:pointer;font-family:inherit;white-space:nowrap;font-weight:600">تفعيل</button>' +
          '<button onclick="dismissNotifPrompt()" style="background:none;border:none;color:rgba(255,255,255,0.7);font-size:18px;cursor:pointer;padding:2px 4px">✕</button>';
        const header = $('chat-header');
        header.parentNode.insertBefore(prompt, header.nextSibling);
      }

      requestNotifPermission();
      setupInput();
    }

    /* ==========================================================
       MESSAGE INPUT
    ========================================================== */
    function setupInput() {
      const input = $('msg-input');
      const sendBtn = $('btn-send');
      const attachBtn = $('btn-attach');
      const fileInput = $('file-input');

      ensureMsgInputShim();

      const autoGrow = () => {
        if (!input.innerText.trim() && input.innerHTML !== '') input.innerHTML = '';
        input.classList.toggle('is-empty', !input.innerText.trim());
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      };

      input.value = '';
      input.style.height = 'auto';

      input.oninput = () => {
        autoGrow();
        setTyping();
        updateInputButtons();
      };

      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
        if (e.key === 'Escape' && editingKey) {
          cancelEdit();
        }
      };

      sendBtn.onclick = handleSend;
      attachBtn.onclick = () => fileInput.click();
      fileInput.onchange = handleFileSelect;

      const micBtn = $('btn-mic');
      if (micBtn) micBtn.onclick = startRecording;
      const recSend = $('rec-send');
      if (recSend) recSend.onclick = () => stopRecording(true);
      const recCancel = $('rec-cancel');
      if (recCancel) recCancel.onclick = () => stopRecording(false);

      const gifBtn = $('btn-gif');
      if (gifBtn) gifBtn.onclick = openGifPicker;

      updateInputButtons();
    }

    // The message box is a contenteditable div (so iOS doesn't treat it as a
    // form field and show the keyboard navigation bar). This exposes a .value
    // getter/setter so the rest of the code keeps working like a textarea.
    // Must be applied before anything reads input.value — route()/cleanup()
    // touch it at startup, before setupInput() ever runs.
    function ensureMsgInputShim() {
      const input = $('msg-input');
      if (!input || input._valShim) return;
      Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return (this.innerText || '').split(String.fromCharCode(160)).join(' '); },
        set(v) {
          this.textContent = (v == null) ? '' : v;
          this.classList.toggle('is-empty', !this.textContent);
        }
      });
      input._valShim = true;
      input.classList.toggle('is-empty', !input.textContent);
    }

    function updateInputButtons() {
      ensureMsgInputShim();
      const input = $('msg-input');
      const sendBtn = $('btn-send');
      const micBtn = $('btn-mic');
      if (!input || !sendBtn || !micBtn) return;
      const showSend = input.value.trim().length > 0 || !!pendingFile || !!editingKey;
      sendBtn.style.display = showSend ? 'flex' : 'none';
      micBtn.style.display = showSend ? 'none' : 'flex';
    }

    function handleSend() {
      if (pendingFile) {
        uploadAndSend();
        return;
      }

      const input = $('msg-input');
      const text = input.value.trim();
      if (!text) return;

      if (editingKey) {
        db.ref(`chats/${currentChatId}/messages/${editingKey}`).update({
          content: text,
          edited: true
        });
        editingKey = null;
        $('edit-indicator').style.display = 'none';
        $('btn-send').style.background = '';
      } else {
        const msgData = {
          sender: currentUser,
          type: 'text',
          content: text,
          timestamp: firebase.database.ServerValue.TIMESTAMP
        };
        if (replyToKey && replyToMsg) {
          msgData.replyTo = {
            key: replyToKey,
            sender: replyToMsg.sender,
            type: replyToMsg.type,
            text: replyToMsg.type === 'text' ? (replyToMsg.content.length > 60 ? replyToMsg.content.substring(0, 60) + '...' : replyToMsg.content) : ''
          };
        }
        db.ref(`chats/${currentChatId}/messages`).push(msgData);
        sendPush(currentChatId, text.length > 50 ? text.substring(0, 50) + '...' : text);
        cancelReply();
        haptic(10);
      }

      clearTyping();
      input.value = '';
      input.style.height = 'auto';
      updateInputButtons();
    }

    function handleFileSelect(e) {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = '';

      pendingFile = file;
      const isVideo = file.type.startsWith('video/');
      const preview = $('media-preview');

      if (isVideo) {
        pendingPreviewUrl = null;
        preview.innerHTML = `
          <div class="media-thumb-video">▶</div>
          <span class="media-name">${escapeHtml(file.name)}</span>
          <button class="btn-remove-media" onclick="clearPendingMedia()">✕</button>`;
      } else {
        pendingPreviewUrl = URL.createObjectURL(file);
        preview.innerHTML = `
          <img class="media-thumb" src="${pendingPreviewUrl}" alt="">
          <span class="media-name">${escapeHtml(file.name)}</span>
          <button class="btn-remove-media" onclick="clearPendingMedia()">✕</button>`;
      }

      preview.style.display = 'flex';
      updateInputButtons();
    }

    function clearPendingMedia() {
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      pendingFile = null;
      pendingPreviewUrl = null;
      const preview = $('media-preview');
      if (preview) {
        preview.style.display = 'none';
        preview.innerHTML = '';
      }
      updateInputButtons();
    }

    /* ==========================================================
       MEDIA UPLOAD  (Cloudinary — media stored as URL, not base64)
    ========================================================== */
    const CLOUDINARY_CLOUD = 'dbazaqizq';
    const CLOUDINARY_PRESET = 'Chattttt';

    async function uploadToCloudinary(input, onProgress) {
      let blob;
      if (typeof input === 'string') {
        const res = await fetch(input);
        blob = await res.blob();
      } else {
        blob = input;
      }
      const form = new FormData();
      form.append('file', blob);
      form.append('upload_preset', CLOUDINARY_PRESET);
      const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`;
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', endpoint);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const r = JSON.parse(xhr.responseText);
              if (r.secure_url) resolve(r.secure_url);
              else reject(new Error('no url in response'));
            } catch (err) { reject(err); }
          } else {
            reject(new Error('Cloudinary upload failed: ' + xhr.status));
          }
        };
        xhr.onerror = () => reject(new Error('network error'));
        xhr.send(form);
      });
    }

    async function uploadAndSend() {
      if (!pendingFile) return;

      const file = pendingFile;
      const isImage = file.type.startsWith('image/');
      const type = isImage ? 'image' : 'video';

      const overlay = $('upload-overlay');
      const fill = $('upload-fill');
      const text = $('upload-text');
      overlay.style.display = 'flex';
      fill.style.width = '30%';
      text.textContent = 'جاري التحضير...';

      clearPendingMedia();

      try {
        let source;
        if (isImage && !file.type.includes('gif')) {
          fill.style.width = '30%';
          text.textContent = 'جاري الضغط...';
          source = await compressImageToDataUrl(file);
        } else if (!isImage) {
          if (file.size > 500 * 1024 * 1024) {
            overlay.style.display = 'none';
            alert('الملف كبير جداً. الحد الأقصى ٥٠٠ ميغابايت.');
            return;
          }
          fill.style.width = '15%';
          text.textContent = 'جاري ضغط الفيديو...';
          source = await compressVideoToDataUrl(file, (p) => {
            fill.style.width = (15 + p * 35) + '%';
          });
        } else {
          source = file;
        }

        text.textContent = 'جاري الرفع...';
        const url = await uploadToCloudinary(source, (p) => {
          fill.style.width = (55 + p * 43) + '%';
        });

        const mediaMsg = {
          sender: currentUser,
          type: type,
          content: url,
          timestamp: firebase.database.ServerValue.TIMESTAMP
        };
        if (replyToKey && replyToMsg) {
          mediaMsg.replyTo = {
            key: replyToKey,
            sender: replyToMsg.sender,
            type: replyToMsg.type,
            text: replyToMsg.type === 'text' ? (replyToMsg.content.length > 60 ? replyToMsg.content.substring(0, 60) + '...' : replyToMsg.content) : ''
          };
          cancelReply();
        }
        await db.ref(`chats/${currentChatId}/messages`).push(mediaMsg);
        sendPush(currentChatId, type === 'image' ? '📷 صورة' : '🎥 فيديو');

        fill.style.width = '100%';
      } catch(e) {
        alert('فشل الإرسال. حاول مرة أخرى.');
      }
      overlay.style.display = 'none';
    }

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    /* ==========================================================
       VOICE MESSAGES
    ========================================================== */
    function formatDur(s) {
      s = Math.max(0, Math.round(s || 0));
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    async function startRecording() {
      if (mediaRecorder) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        alert('التسجيل الصوتي غير مدعوم على هذا المتصفح.');
        return;
      }
      clearTimeout(micReleaseTimer);
      let stream;
      try {
        stream = await getMicStream();
      } catch (e2) {
        alert('تعذّر الوصول للميكروفون. تأكد من السماح بالإذن.');
        return;
      }
      recStream = stream;
      recChunks = [];
      recSeconds = 0;
      recShouldSend = false;
      recFinalDuration = 0;

      let mime = '';
      const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
      for (const c of candidates) {
        try { if (MediaRecorder.isTypeSupported(c)) { mime = c; break; } } catch (e) {}
      }
      // High-quality voice. Opus is efficient so 96kbps is already beyond
      // transparent for speech; lossy AAC/mp4 (iOS Safari) is given 192kbps.
      // Even at 192kbps a full 5-min note is ~7MB, well under the 15MB cap.
      const isOpus = /opus/i.test(mime);
      const audioBitrate = isOpus ? 96000 : 192000;
      try {
        mediaRecorder = mime
          ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: audioBitrate })
          : new MediaRecorder(stream);
      } catch (e) {
        try { mediaRecorder = new MediaRecorder(stream); }
        catch (e2) { alert('التسجيل الصوتي غير مدعوم على هذا الجهاز.'); stopStream(); return; }
      }

      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recChunks.push(e.data); };
      mediaRecorder.onstop = handleRecordingStop;
      mediaRecorder.start();

      const inputArea = $('input-area');
      if (inputArea) inputArea.style.display = 'none';
      const rb = $('record-bar');
      if (rb) rb.style.display = 'flex';
      $('rec-timer').textContent = '0:00';
      recTimer = setInterval(() => {
        recSeconds++;
        $('rec-timer').textContent = formatDur(recSeconds);
        if (recSeconds >= 300) stopRecording(true);
      }, 1000);
      if (navigator.vibrate) navigator.vibrate(15);
    }

    // Keep one granted microphone stream alive for the session and reuse it,
    // so the browser doesn't re-prompt for permission on every voice note.
    // It's released when leaving the chat, backgrounding, or after idle.
    async function getMicStream() {
      if (micStream && micStream.getAudioTracks().some(t => t.readyState === 'live')) {
        return micStream;
      }
      micStream = null;
      // Capture raw, full-band audio. The browser's voice pipeline (echo
      // cancellation / noise suppression / auto gain) band-limits the signal
      // and makes voice notes sound muffled, so all of it is turned off.
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48000
      };
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (e) {
        // Fall back to plain audio if the device rejects the constraints
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      return micStream;
    }

    function scheduleMicRelease(delay) {
      clearTimeout(micReleaseTimer);
      micReleaseTimer = setTimeout(releaseMic, delay || 90000);
    }

    function releaseMic() {
      clearTimeout(micReleaseTimer);
      if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
      recStream = null;
    }

    // On a hard error we drop the mic entirely.
    function stopStream() {
      releaseMic();
    }

    function stopRecording(send) {
      if (!mediaRecorder) return;
      recShouldSend = send;
      recFinalDuration = recSeconds;
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
      try { mediaRecorder.stop(); } catch (e) {}
      // Keep the mic stream alive briefly so back-to-back voice notes don't
      // trigger a fresh permission prompt; release it after a short idle.
      scheduleMicRelease();
      const rb = $('record-bar');
      if (rb) rb.style.display = 'none';
      const inputArea = $('input-area');
      if (inputArea) inputArea.style.display = 'flex';
      updateInputButtons();
    }

    function handleRecordingStop() {
      const chunks = recChunks;
      recChunks = [];
      const mime = (mediaRecorder && mediaRecorder.mimeType) ? mediaRecorder.mimeType : 'audio/webm';
      mediaRecorder = null;
      const duration = recFinalDuration;
      if (!recShouldSend || chunks.length === 0 || duration < 1) return;
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      sendAudioMessage(blob, duration);
    }

    async function sendAudioMessage(blob, duration) {
      try {
        if (blob.size > 15 * 1024 * 1024) {
          alert('التسجيل كبير جداً. حاول تسجيلاً أقصر.');
          return;
        }
        const url = await uploadToCloudinary(blob);
        const msg = {
          sender: currentUser,
          type: 'audio',
          content: url,
          duration: duration,
          timestamp: firebase.database.ServerValue.TIMESTAMP
        };
        if (replyToKey && replyToMsg) {
          msg.replyTo = {
            key: replyToKey,
            sender: replyToMsg.sender,
            type: replyToMsg.type,
            text: replyToMsg.type === 'text' ? (replyToMsg.content.length > 60 ? replyToMsg.content.substring(0, 60) + '...' : replyToMsg.content) : ''
          };
          cancelReply();
        }
        await db.ref(`chats/${currentChatId}/messages`).push(msg);
        sendPush(currentChatId, '🎤 رسالة صوتية');
      } catch (e) {
        alert('فشل إرسال التسجيل. حاول مرة أخرى.');
      }
    }

    // Playback speed, shared across all voice notes and remembered.
    let audioSpeed = parseFloat(localStorage.getItem('audioSpeed')) || 1;

    // Build a stable "waveform" of bars from the clip's URL so every note has
    // its own varied shape instead of a flat line.
    function waveBarsHtml(seed, n) {
      let h = 2166136261;
      for (let i = 0; i < seed.length; i++) { h = (h ^ seed.charCodeAt(i)) >>> 0; h = (h * 16777619) >>> 0; }
      let bars = '';
      for (let i = 0; i < n; i++) {
        h = (h * 1103515245 + 12345) >>> 0;
        const height = 22 + (h % 78); // 22%..100%
        bars += `<span class="audio-bar" style="height:${height}%"></span>`;
      }
      return bars;
    }

    function paintWavePlayed(wrap, ratio) {
      const bars = wrap.querySelectorAll('.audio-bar');
      const played = Math.round(ratio * bars.length);
      bars.forEach((b, i) => b.classList.toggle('played', i < played));
    }

    function cycleAudioSpeed(btn) {
      const steps = [1, 1.5, 2];
      audioSpeed = steps[(steps.indexOf(audioSpeed) + 1) % steps.length];
      localStorage.setItem('audioSpeed', audioSpeed);
      document.querySelectorAll('.audio-speed').forEach(b => { b.textContent = audioSpeed + 'x'; });
      if (currentAudioEl) currentAudioEl.playbackRate = audioSpeed;
      if (navigator.vibrate) navigator.vibrate(8);
    }

    function resetAudioBtn(btn) {
      if (!btn) return;
      btn.textContent = '▶';
      const wrap = btn.closest('.msg-audio');
      if (wrap) wrap.querySelectorAll('.audio-bar.played').forEach(b => b.classList.remove('played'));
    }

    function toggleAudioPlay(btn) {
      const wrap = btn.closest('.msg-audio');
      if (!wrap) return;
      const storedDur = parseFloat(wrap.getAttribute('data-dur')) || 0;

      if (currentAudioBtn === btn && currentAudioEl) {
        if (currentAudioEl.paused) { currentAudioEl.play().catch(() => {}); }
        else { currentAudioEl.pause(); }
        return;
      }

      if (currentAudioEl) {
        currentAudioEl.pause();
        resetAudioBtn(currentAudioBtn);
        currentAudioEl = null;
        currentAudioBtn = null;
      }

      const audio = new Audio(wrap.getAttribute('data-audio'));
      audio.playbackRate = audioSpeed;
      currentAudioEl = audio;
      currentAudioBtn = btn;

      audio.onplay = () => { btn.textContent = '⏸'; audio.playbackRate = audioSpeed; };
      audio.onpause = () => { if (currentAudioBtn === btn) btn.textContent = '▶'; };
      audio.onended = () => { btn.textContent = '▶'; paintWavePlayed(wrap, 0); };
      audio.ontimeupdate = () => {
        const d = (audio.duration && isFinite(audio.duration)) ? audio.duration : storedDur;
        if (d) paintWavePlayed(wrap, Math.min(1, audio.currentTime / d));
      };
      audio.play().catch(() => {});
    }

    function seekAudio(e, wave) {
      const wrap = wave.closest('.msg-audio');
      if (!wrap || !currentAudioEl || !currentAudioBtn || currentAudioBtn.closest('.msg-audio') !== wrap) return;
      const storedDur = parseFloat(wrap.getAttribute('data-dur')) || 0;
      const d = (currentAudioEl.duration && isFinite(currentAudioEl.duration)) ? currentAudioEl.duration : storedDur;
      if (!d) return;
      const rect = wave.getBoundingClientRect();
      let ratio = (rect.right - e.clientX) / rect.width;
      ratio = Math.max(0, Math.min(1, ratio));
      currentAudioEl.currentTime = ratio * d;
    }

    function compressImageToDataUrl(file, maxWidth = 1280) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxWidth) {
            h = Math.round((maxWidth / w) * h);
            w = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
          URL.revokeObjectURL(img.src);
        };
        img.onerror = () => {
          URL.revokeObjectURL(img.src);
          fileToDataUrl(file).then(resolve).catch(reject);
        };
        img.src = URL.createObjectURL(file);
      });
    }

    function compressVideoToDataUrl(file, onProgress) {
      if (typeof MediaRecorder === 'undefined') {
        return fileToDataUrl(file);
      }
      var formats = ['video/mp4', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp8', 'video/webm'];
      var mimeType = '';
      for (var i = 0; i < formats.length; i++) {
        if (MediaRecorder.isTypeSupported(formats[i])) { mimeType = formats[i]; break; }
      }
      if (!mimeType) {
        return fileToDataUrl(file);
      }
      return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';

        var timeout = setTimeout(() => {
          fileToDataUrl(file).then(resolve).catch(reject);
        }, 120000);

        video.onloadedmetadata = () => {
          let w = video.videoWidth, h = video.videoHeight;
          const maxDim = 1280;
          if (w > maxDim || h > maxDim) {
            if (w >= h) { h = Math.round((maxDim / w) * h); w = maxDim; }
            else { w = Math.round((maxDim / h) * w); h = maxDim; }
          }
          w = w % 2 === 0 ? w : w - 1;
          h = h % 2 === 0 ? h : h - 1;

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');

          const stream = canvas.captureStream(30);
          try {
            const audioCtx2 = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx2.createMediaElementSource(video);
            const dest = audioCtx2.createMediaStreamDestination();
            source.connect(dest);
            dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
          } catch(e) {}

          const recorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: 2500000
          });
          const chunks = [];
          recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = () => {
            clearTimeout(timeout);
            const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          };
          recorder.onerror = () => {
            clearTimeout(timeout);
            fileToDataUrl(file).then(resolve).catch(reject);
          };

          recorder.start(100);
          video.play();

          const duration = video.duration || 60;
          const drawFrame = () => {
            if (video.ended || video.paused) {
              try { recorder.stop(); } catch(e) {}
              return;
            }
            ctx.drawImage(video, 0, 0, w, h);
            if (onProgress) onProgress(Math.min(video.currentTime / duration, 1));
            requestAnimationFrame(drawFrame);
          };
          drawFrame();
          video.onended = () => { try { recorder.stop(); } catch(e) {} };
        };

        video.onerror = () => {
          clearTimeout(timeout);
          fileToDataUrl(file).then(resolve).catch(reject);
        };
        video.src = URL.createObjectURL(file);
      });
    }

    /* ==========================================================
       IMAGE VIEWER
    ========================================================== */
    let viewerScale = 1, viewerX = 0, viewerY = 0;
    let vPinchDist = 0, vPinchScale = 1;
    let vPanStartX = 0, vPanStartY = 0, vStartX = 0, vStartY = 0;
    let vLastTap = 0;

    function viewerApply(img, animate) {
      if (animate) img.classList.add('zoom-animating');
      else img.classList.remove('zoom-animating');
      img.style.transform = `translate(${viewerX}px, ${viewerY}px) scale(${viewerScale})`;
    }

    function viewerReset() {
      viewerScale = 1; viewerX = 0; viewerY = 0;
      const img = $('viewer-img');
      img.style.transform = '';
      img.classList.remove('zoom-animating');
    }

    function openViewer(src) {
      viewerReset();
      const viewer = $('image-viewer');
      $('viewer-img').src = src;
      viewer.style.display = 'flex';
    }

    $('btn-viewer-close').onclick = () => { viewerReset(); $('image-viewer').style.display = 'none'; };
    $('image-viewer').onclick = (e) => {
      if (e.target === $('image-viewer')) { viewerReset(); $('image-viewer').style.display = 'none'; }
    };

    (function setupViewerZoom() {
      const img = $('viewer-img');
      if (!img) return;

      function dist(t) {
        const dx = t[0].clientX - t[1].clientX;
        const dy = t[0].clientY - t[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }

      img.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          vPinchDist = dist(e.touches);
          vPinchScale = viewerScale;
        } else if (e.touches.length === 1) {
          const now = Date.now();
          if (now - vLastTap < 300) {
            e.preventDefault();
            const rect = img.getBoundingClientRect();
            if (viewerScale > 1.05) {
              viewerScale = 1; viewerX = 0; viewerY = 0;
            } else {
              viewerScale = 2.5;
              const cx = e.touches[0].clientX - rect.left;
              const cy = e.touches[0].clientY - rect.top;
              viewerX = -(cx * viewerScale - cx);
              viewerY = -(cy * viewerScale - cy);
            }
            viewerApply(img, true);
            vLastTap = 0;
            return;
          }
          vLastTap = now;
          if (viewerScale > 1.05) {
            vPanStartX = e.touches[0].clientX - viewerX;
            vPanStartY = e.touches[0].clientY - viewerY;
          }
        }
      }, { passive: false });

      img.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const d = dist(e.touches);
          viewerScale = Math.max(1, Math.min(vPinchScale * (d / vPinchDist), 5));
          viewerApply(img, false);
        } else if (e.touches.length === 1 && viewerScale > 1.05) {
          e.preventDefault();
          viewerX = e.touches[0].clientX - vPanStartX;
          viewerY = e.touches[0].clientY - vPanStartY;
          viewerApply(img, false);
        }
      }, { passive: false });

      img.addEventListener('touchend', (e) => {
        if (viewerScale <= 1.05) {
          viewerScale = 1; viewerX = 0; viewerY = 0;
          viewerApply(img, true);
        }
      });
    })();

    /* ==========================================================
       NOTIFICATIONS
    ========================================================== */
    function requestNotifPermission() {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(perm => {
          if (perm === 'granted') subscribePush();
        });
      } else if (Notification.permission === 'granted') {
        subscribePush();
      }
    }

    function notify(chatId, title, body) {
      showToast(chatId, title, body);
      playSound();
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try { new Notification(title, { body, icon: '/icon-192.svg' }); } catch(e) {}
      }
    }

    let toastTimer = null;
    let toastChatId = null;

    function showToast(chatId, name, text) {
      toastChatId = chatId;
      const toast = $('toast');
      const color = CONTACTS[chatId] ? CONTACTS[chatId].color : '#5B8FB9';
      const avatar = AVATARS[chatId] || '';
      toast.innerHTML = `
        <div class="toast-avatar" style="background:${color}">${avatar}</div>
        <div class="toast-body">
          <div class="toast-name">${escapeHtml(name)}</div>
          <div class="toast-text">${escapeHtml(text)}</div>
        </div>`;
      toast.className = 'toast';
      toast.style.display = 'flex';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => { toast.style.display = 'none'; }, 300);
      }, 3000);
    }

    function toastTap() {
      clearTimeout(toastTimer);
      $('toast').style.display = 'none';
      if (toastChatId && currentView === 'home') {
        if (APP_USER === 'saud') {
          navigate(`/chat/${toastChatId}`);
        } else {
          navigate(`/${APP_USER}/chat`);
        }
      }
    }

    // Fix AudioContext for iOS — must resume after user gesture
    document.addEventListener('touchstart', function initAudio() {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      document.removeEventListener('touchstart', initAudio);
    });

    function playSound() {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const now = audioCtx.currentTime;

        const osc1 = audioCtx.createOscillator();
        const g1 = audioCtx.createGain();
        osc1.connect(g1); g1.connect(audioCtx.destination);
        osc1.frequency.value = 830;
        osc1.type = 'sine';
        g1.gain.setValueAtTime(0.15, now);
        g1.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc1.start(now); osc1.stop(now + 0.12);

        const osc2 = audioCtx.createOscillator();
        const g2 = audioCtx.createGain();
        osc2.connect(g2); g2.connect(audioCtx.destination);
        osc2.frequency.value = 1046;
        osc2.type = 'sine';
        g2.gain.setValueAtTime(0.15, now + 0.1);
        g2.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc2.start(now + 0.1); osc2.stop(now + 0.25);
      } catch(e) {}
    }

    function sendPush(chatId, preview) {
      const recipient = (currentUser === 'saud') ? chatId : 'saud';
      const senderName = currentUser === 'saud' ? 'سعود' : CONTACTS[chatId].name;
      const recipientUrl = recipient === 'saud' ? `/chat/${chatId}` : `/${recipient}`;

      db.ref(`push-subscriptions/${recipient}`).once('value', snap => {
        const subs = snap.val();
        if (!subs) return;
        Object.values(subs).forEach(sub => {
          fetch('/.netlify/functions/send-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify({
              subscription: sub,
              title: senderName,
              body: preview,
              url: recipientUrl
            })
          }).catch(() => {});
        });
      });
    }

    function updateTitleBadge() {
      const total = (totalUnread.w || 0) + (totalUnread.aseel || 0);
      document.title = total > 0 ? `(${total}) رسائل` : 'رسائل';
    }

    /* ==========================================================
       SCROLL
    ========================================================== */
    // Interactive swipe-to-exit — Saud only. Drag the chat right-to-left and
    // the page follows your finger, revealing home beneath; release past a
    // third of the width (or a quick flick) to leave, otherwise it snaps back.
    // Starts from the right edge or empty chat space so it never clashes with
    // per-message swipe-to-reply. Binds once.
    function setupChatExitSwipe() {
      const area = $('messages-area');
      if (!area || area._exitSwipeBound) return;
      area._exitSwipeBound = true;
      const chat = $('page-chat');
      const home = $('page-home');
      let sx = 0, sy = 0, t0 = 0, width = 1;
      let active = false, decided = false, dragging = false;

      area.addEventListener('touchstart', (e) => {
        active = false; decided = false; dragging = false;
        if (currentUser !== 'saud' || e.touches.length !== 1) return;
        const t = e.touches[0];
        sx = t.clientX; sy = t.clientY; t0 = Date.now();
        width = window.innerWidth || 1;
        const fromEdge = (width - sx) <= 44;
        const onMessage = e.target.closest && e.target.closest('.message');
        active = fromEdge || !onMessage;
      }, { passive: true });

      area.addEventListener('touchmove', (e) => {
        if (!active) return;
        const t = e.touches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (!decided) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          decided = true;
          // Only a leftward, mostly-horizontal drag starts the exit.
          if (!(dx < 0 && Math.abs(dx) > Math.abs(dy) + 2)) { active = false; return; }
          dragging = true;
          if ($('chat-list') && !$('chat-list').children.length) showHome();
          home.classList.add('active');
          chat.style.transition = 'none';
          chat.style.zIndex = '50';
          chat.style.boxShadow = '-8px 0 24px rgba(0,0,0,0.18)';
        }
        if (!dragging) return;
        e.preventDefault();
        chat.style.transform = `translateX(${Math.min(0, dx)}px)`;
      }, { passive: false });

      const end = (e) => {
        if (!dragging) { active = false; return; }
        dragging = false; active = false;
        const t = (e.changedTouches && e.changedTouches[0]) || {};
        const dx = (t.clientX || sx) - sx;
        const fast = (Date.now() - t0) < 300 && dx < -60;
        const past = Math.abs(dx) > width * 0.33 || fast;
        chat.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
        if (past) {
          if (navigator.vibrate) navigator.vibrate(8);
          chat.style.transform = 'translateX(-100%)';
          const done = () => {
            chat.removeEventListener('transitionend', done);
            history.pushState(null, '', '/');
            cleanup();
            currentView = 'home';
            showHome();
            chat.classList.remove('active');
            chat.style.transition = ''; chat.style.transform = '';
            chat.style.zIndex = ''; chat.style.boxShadow = '';
          };
          chat.addEventListener('transitionend', done, { once: true });
          setTimeout(done, 340);
        } else {
          chat.style.transform = 'translateX(0)';
          const back = () => {
            chat.removeEventListener('transitionend', back);
            chat.style.transition = ''; chat.style.transform = '';
            chat.style.zIndex = ''; chat.style.boxShadow = '';
            home.classList.remove('active');
          };
          chat.addEventListener('transitionend', back, { once: true });
          setTimeout(back, 300);
        }
      };
      area.addEventListener('touchend', end);
      area.addEventListener('touchcancel', end);
    }

    // Flag the scroll-to-bottom button when a new message arrives while the
    // reader is scrolled up, so they can jump down without being yanked there.
    function showNewMsgPill() {
      const btn = $('btn-scroll-bottom');
      if (btn) btn.classList.add('visible', 'has-new');
    }

    function scrollToBottom(smooth) {
      const area = $('messages-area');
      if (!area) return;
      if (smooth) {
        area.scrollTo({ top: area.scrollHeight, behavior: 'smooth' });
      } else {
        area.scrollTop = area.scrollHeight;
      }
    }

    /* ==========================================================
       MESSAGE RENDERING
    ========================================================== */
    function renderMsgContent(el, msg, isMine) {
      if (msg.deleted) {
        el.innerHTML = `<div class="msg-deleted">🚫 تم حذف هذه الرسالة</div><div class="msg-time">${formatTime(msg.timestamp)}</div>`;
        return;
      }
      let replyHtml = '';
      if (msg.replyTo) {
        const rName = msg.replyTo.sender === currentUser ? 'أنت' : (msg.replyTo.sender === 'saud' ? 'سعود' : (CONTACTS[msg.replyTo.sender] ? CONTACTS[msg.replyTo.sender].name : msg.replyTo.sender));
        const rText = msg.replyTo.type === 'image' ? '📷 صورة' : msg.replyTo.type === 'gif' ? '🎞️ GIF' : msg.replyTo.type === 'video' ? '🎥 فيديو' : msg.replyTo.type === 'audio' ? '🎤 رسالة صوتية' : msg.replyTo.type === 'game' ? '🎮 لعبة' : escapeHtml(msg.replyTo.text || '');
        replyHtml = `<div class="msg-reply-quote" onclick="scrollToMessage('${escapeAttr(msg.replyTo.key)}')"><div class="msg-reply-name">${rName}</div><span class="msg-reply-text">${rText}</span></div>`;
      }
      let content = '';
      let bigEmoji = false;
      if (msg.type === 'image') {
        content = `<img class="msg-image" src="${escapeAttr(msg.content)}" alt="صورة" loading="lazy" onclick="openViewer('${escapeAttr(msg.content)}')">`;
      } else if (msg.type === 'gif') {
        content = `<div class="msg-gif-wrap"><img class="msg-gif" src="${escapeAttr(msg.content)}" alt="GIF" loading="lazy" onclick="openViewer('${escapeAttr(msg.content)}')"><span class="msg-gif-tag">GIF</span></div>`;
      } else if (msg.type === 'video') {
        content = `<video class="msg-video" src="${escapeAttr(msg.content)}" controls playsinline preload="metadata"></video>`;
      } else if (msg.type === 'audio') {
        content = `<div class="msg-audio" data-audio="${escapeAttr(msg.content)}" data-dur="${msg.duration || 0}"><button class="audio-play" onclick="toggleAudioPlay(this)">▶</button><div class="audio-body"><div class="audio-wave" onclick="seekAudio(event, this)">${waveBarsHtml(msg.content, 34)}</div><span class="audio-dur">${formatDur(msg.duration || 0)}</span></div><button class="audio-speed" onclick="cycleAudioSpeed(this)">${audioSpeed}x</button></div>`;
      } else if (msg.type === 'game') {
        content = msg.game === 'rps' ? renderRPS(msg, el.dataset.key)
          : msg.game === 'c4' ? renderC4(msg, el.dataset.key)
          : msg.game === 'guess' ? renderGuess(msg, el.dataset.key)
          : renderXO(msg, el.dataset.key);
      } else {
        const ec = emojiOnlyCount(msg.content);
        bigEmoji = ec > 0;
        content = `<div class="msg-text${ec ? ' emoji-only emoji-' + ec : ''}">${formatText(msg.content)}</div>`;
      }
      el.classList.toggle('big-emoji', bigEmoji);
      let reactionsHtml = '';
      if (msg.reactions) {
        const counts = {};
        Object.values(msg.reactions).forEach(emoji => { counts[emoji] = (counts[emoji] || 0) + 1; });
        reactionsHtml = '<div class="msg-reactions">';
        Object.entries(counts).forEach(([emoji, count]) => {
          reactionsHtml += `<span class="msg-reaction" onclick="toggleReaction('${el.dataset.key}','${emoji}')">${emoji}${count > 1 ? count : ''}</span>`;
        });
        reactionsHtml += '</div>';
      }
      const editedTag = msg.edited ? '<span class="msg-edited">(معدّلة)</span>' : '';
      const statusHtml = isMine ? `<span class="msg-status">${TICK_SINGLE}</span>` : '';
      const savedTag = (el.dataset.key && isSaved(el.dataset.key)) ? '<span class="msg-saved-star">⭐</span>' : '';
      el.innerHTML = replyHtml + content + reactionsHtml + `<div class="msg-time">${savedTag}${editedTag}${formatTime(msg.timestamp)}${statusHtml}</div>`;
    }

    /* ==========================================================
       MESSAGE ACTIONS (EDIT / DELETE)
    ========================================================== */
    function addLongPress(el, callback) {
      let timer = null;
      el.addEventListener('touchstart', () => { timer = setTimeout(callback, 500); });
      el.addEventListener('touchend', () => clearTimeout(timer));
      el.addEventListener('touchmove', () => clearTimeout(timer));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); callback(); });
    }

    function addSwipeReply(el, key) {
      let startX = 0, startY = 0, dx = 0, active = false, decided = false, horizontal = false;
      const THRESHOLD = 56, MAX = 88;
      el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { active = false; return; }
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        dx = 0; active = true; decided = false; horizontal = false;
        el.style.transition = '';
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        if (!active) return;
        const ddx = e.touches[0].clientX - startX;
        const ddy = e.touches[0].clientY - startY;
        if (!decided) {
          if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
          decided = true;
          horizontal = Math.abs(ddx) > Math.abs(ddy) + 2;
        }
        if (!horizontal) { active = false; el.style.transform = ''; return; }
        e.preventDefault();
        dx = Math.max(-MAX, Math.min(MAX, ddx));
        el.style.transform = `translateX(${dx}px)`;
        el.classList.toggle('swipe-ready', Math.abs(dx) >= THRESHOLD);
      }, { passive: false });
      const finish = () => {
        if (!active) return;
        active = false;
        const trigger = Math.abs(dx) >= THRESHOLD;
        el.style.transition = 'transform 0.22s cubic-bezier(0.22,1,0.36,1)';
        el.style.transform = '';
        el.classList.remove('swipe-ready');
        if (trigger) {
          if (navigator.vibrate) navigator.vibrate(12);
          setReply(key);
        }
        dx = 0;
      };
      el.addEventListener('touchend', finish);
      el.addEventListener('touchcancel', finish);
    }

    function actionBtn(icon, iconClass, label, onclick) {
      return `<button class="msg-action-btn" onclick="${onclick}">
        <span class="action-icon ${iconClass}">${icon}</span>
        <span class="action-label">${label}</span>
      </button>`;
    }

    function showMsgActions(key, msgType, canEdit) {
      let html = '';
      html += actionBtn('↩️', 'reply-icon', 'رد', `setReply('${key}')`);
      html += actionBtn('😀', 'react-icon', 'تفاعل', `hideMsgActions();openReactionPicker('${key}')`);
      if (msgType === 'text') {
        html += actionBtn('📋', 'copy-icon', 'نسخ', `copyMessage('${key}')`);
      }
      if (canEdit && msgType === 'text') {
        html += actionBtn('✏️', 'edit-icon', 'تعديل', `editMessage('${key}')`);
      }
      if (msgType === 'gif' || msgType === 'image') {
        html += actionBtn('⭐', 'sticker-icon', 'ستيكر', `saveAsSticker('${key}')`);
      }
      if (msgType !== 'game') {
        const saved = isSaved(key);
        html += actionBtn(saved ? '★' : '⭐', 'save-icon', saved ? 'محفوظ' : 'حفظ', `toggleSaveMessage('${key}')`);
      }
      html += actionBtn('🗑️', 'delete-icon', 'حذف', `deleteMessage('${key}')`);
      $('msg-actions-content').innerHTML = html;

      const msgEl = document.querySelector(`.message[data-key="${key}"]`);
      if (msgEl) msgEl.classList.add('msg-highlighted');
      const panel = $('msg-actions-content');
      const overlay = $('msg-actions-overlay');
      overlay.style.display = 'block';

      requestAnimationFrame(() => {
        const msgRect = msgEl ? msgEl.getBoundingClientRect() : null;
        const panelW = panel.offsetWidth;
        const panelH = panel.offsetHeight;

        if (msgRect) {
          let top = msgRect.top - panelH - 8;
          if (top < 8) top = msgRect.bottom + 8;

          const isMine = msgEl.classList.contains('message-mine');
          let left;
          if (isMine) {
            left = msgRect.left;
          } else {
            left = msgRect.right - panelW;
          }
          left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));

          panel.style.left = left + 'px';
          panel.style.top = top + 'px';
        } else {
          panel.style.left = '50%';
          panel.style.top = '50%';
          panel.style.transform = 'translate(-50%, -50%) scale(0.8)';
        }

        requestAnimationFrame(() => overlay.classList.add('visible'));
      });
      haptic(12);
    }

    function hideMsgActions() {
      const overlay = $('msg-actions-overlay');
      overlay.classList.remove('visible');
      const panel = $('msg-actions-content');
      const hl = document.querySelector('.msg-highlighted');
      if (hl) hl.classList.remove('msg-highlighted');
      setTimeout(() => {
        overlay.style.display = 'none';
        panel.style.left = '';
        panel.style.top = '';
        panel.style.transform = '';
      }, 250);
    }

    function deleteMessage(key) {
      hideMsgActions();
      db.ref(`chats/${currentChatId}/messages/${key}`).update({
        deleted: true,
        content: ''
      });
    }

    function copyMessage(key) {
      hideMsgActions();
      const entry = allMsgElements.find(m => m.key === key);
      if (!entry || entry.msg.type !== 'text') return;
      navigator.clipboard.writeText(entry.msg.content).catch(() => {});
    }

    // Save a received (or sent) sticker/GIF straight into the shared pack,
    // reusing its hosted URL — no download-then-reupload needed.
    function saveAsSticker(key) {
      hideMsgActions();
      const entry = allMsgElements.find(m => m.key === key);
      if (!entry || !db) return;
      const msg = entry.msg;
      if (!msg || !msg.content || (msg.type !== 'gif' && msg.type !== 'image')) return;
      if (navigator.vibrate) navigator.vibrate(12);
      db.ref('stickers').once('value', snap => {
        let exists = false;
        snap.forEach(ch => { const v = ch.val(); if (v && v.url === msg.content) exists = true; });
        if (exists) { miniToast('موجود في ستيكراتك ✓'); return; }
        db.ref('stickers').push({
          url: msg.content,
          type: msg.type,
          timestamp: firebase.database.ServerValue.TIMESTAMP
        }).then(() => miniToast('تم الحفظ في ستيكراتك ⭐'))
          .catch(() => miniToast('تعذّر الحفظ'));
      });
    }

    function miniToast(text) {
      const t = document.createElement('div');
      t.className = 'mini-toast';
      t.textContent = text;
      document.body.appendChild(t);
      setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 260); }, 1300);
    }

    // Light haptic tap (no-op on devices/browsers without the Vibration API).
    function haptic(ms) {
      if (navigator.vibrate) { try { navigator.vibrate(ms || 10); } catch (e) {} }
    }

    /* ==========================================================
       SAVED / STARRED MESSAGES (personal, stored per user)
    ========================================================== */
    function savedKey() { return 'saved_' + (currentUser || 'x'); }
    function getSaved() {
      try { return JSON.parse(localStorage.getItem(savedKey()) || '[]'); }
      catch (e) { return []; }
    }
    function setSaved(arr) {
      try { localStorage.setItem(savedKey(), JSON.stringify(arr)); } catch (e) {}
    }
    function isSaved(key) {
      return getSaved().some(s => s.chatId === currentChatId && s.key === key);
    }

    function toggleSaveMessage(key) {
      hideMsgActions();
      const arr = getSaved();
      const idx = arr.findIndex(s => s.chatId === currentChatId && s.key === key);
      if (idx !== -1) {
        arr.splice(idx, 1);
        setSaved(arr);
        miniToast('أُزيلت من المحفوظة');
      } else {
        const entry = allMsgElements.find(m => m.key === key);
        if (!entry) return;
        const msg = entry.msg;
        arr.push({
          chatId: currentChatId, key,
          sender: msg.sender, type: msg.type,
          content: msg.content || '', duration: msg.duration || 0,
          timestamp: msg.timestamp || Date.now(), savedAt: Date.now()
        });
        setSaved(arr);
        haptic(12);
        miniToast('حُفظت ⭐');
      }
      // Re-render just this message so the ⭐ badge appears/disappears live.
      const entry = allMsgElements.find(m => m.key === key);
      const el = document.querySelector(`[data-key="${key}"]`);
      if (entry && el) renderMsgContent(el, entry.msg, entry.msg.sender === currentUser);
    }

    function savedPreview(s) {
      if (s.type === 'image') return '📷 صورة';
      if (s.type === 'gif') return '🎞️ GIF';
      if (s.type === 'video') return '🎥 فيديو';
      if (s.type === 'audio') return '🎤 رسالة صوتية';
      if (s.type === 'game') return '🎮 لعبة';
      const c = s.content || '';
      return c.length > 80 ? c.substring(0, 80) + '…' : c;
    }

    function openSavedMessages() {
      const old = document.getElementById('saved-overlay');
      if (old) old.remove();
      const settings = document.getElementById('settings-overlay');
      if (settings) settings.remove();

      // Newest-saved first.
      const arr = getSaved().slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      const nameOf = (id) => id === 'saud' ? 'سعود' : (CONTACTS[id] ? CONTACTS[id].name : id);

      let items;
      if (!arr.length) {
        items = '<div class="saved-empty">لا توجد رسائل محفوظة بعد.<br>اضغط مطوّلاً على أي رسالة ثم «⭐ حفظ».</div>';
      } else {
        items = arr.map(s => {
          const who = s.sender === currentUser ? 'أنت' : nameOf(s.sender);
          return `<div class="saved-item" onclick="jumpToSaved('${escapeAttr(s.chatId)}','${escapeAttr(s.key)}')">
            <div class="saved-item-body">
              <div class="saved-item-meta">${escapeHtml(who)} · ${formatTime(s.timestamp)}</div>
              <div class="saved-item-text">${escapeHtml(savedPreview(s))}</div>
            </div>
            <button class="saved-item-remove" onclick="event.stopPropagation();removeSaved('${escapeAttr(s.chatId)}','${escapeAttr(s.key)}',this)" aria-label="إزالة">✕</button>
          </div>`;
        }).join('');
      }

      const overlay = document.createElement('div');
      overlay.id = 'saved-overlay';
      overlay.className = 'settings-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.innerHTML = `<div class="settings-panel" onclick="event.stopPropagation()">
        <div class="settings-title">الرسائل المحفوظة ⭐</div>
        <div class="saved-list">${items}</div>
        <button class="btn-settings-close" onclick="this.closest('.settings-overlay').remove()">إغلاق</button>
      </div>`;
      document.body.appendChild(overlay);
    }

    function removeSaved(chatId, key, btn) {
      const arr = getSaved().filter(s => !(s.chatId === chatId && s.key === key));
      setSaved(arr);
      const row = btn && btn.closest('.saved-item');
      if (row) row.remove();
      // Refresh the ⭐ badge if that message is on screen in the current chat.
      if (chatId === currentChatId) {
        const entry = allMsgElements.find(m => m.key === key);
        const el = document.querySelector(`[data-key="${key}"]`);
        if (entry && el) renderMsgContent(el, entry.msg, entry.msg.sender === currentUser);
      }
      const list = document.querySelector('#saved-overlay .saved-list');
      if (list && !arr.length) list.innerHTML = '<div class="saved-empty">لا توجد رسائل محفوظة بعد.</div>';
    }

    function jumpToSaved(chatId, key) {
      const ov = document.getElementById('saved-overlay');
      if (ov) ov.remove();
      if (chatId === currentChatId) {
        scrollToMessage(key);
      } else {
        const path = currentUser === 'saud' ? '/chat/' + chatId : '/' + chatId;
        navigate(path);
        setTimeout(() => scrollToMessage(key), 900);
      }
    }

    /* ==========================================================
       IN-CHAT GAME: TIC-TAC-TOE (إكس أو)
       Stored as a 'game' message so both players share live state.
    ========================================================== */
    /* ==========================================================
       SWIPE PAGES: HOME (CHATS / GAMES)
    ========================================================== */
    let currentHomePage = 'chats';

    function swipeTo(page) {
      if (page === currentHomePage) return;
      currentHomePage = page;

      const chatsPage = $('swipe-page-chats');
      const gamesPageEl = $('swipe-page-games');
      const dotChats = $('dot-chats');
      const dotGames = $('dot-games');
      const title = $('home-title');
      if (!chatsPage || !gamesPageEl) return;

      const dir = document.documentElement.dir === 'rtl' ? 1 : -1;
      const offset = page === 'games' ? (dir * 100) : 0;

      chatsPage.style.transform = `translateX(${offset}%)`;
      gamesPageEl.style.transform = `translateX(${offset}%)`;

      if (dotChats) dotChats.classList.toggle('active', page === 'chats');
      if (dotGames) dotGames.classList.toggle('active', page === 'games');
      if (title) title.textContent = page === 'games' ? 'ألعاب' : 'رسائل';

      if (page === 'games') renderGamesPage();
    }

    function switchTab(tab) { swipeTo(tab); }

    (function setupSwipeGestures() {
      document.addEventListener('DOMContentLoaded', () => {
        const container = $('swipe-container');
        if (!container) return;

        let startX = 0, startY = 0, deltaX = 0, locked = false, isHorizontal = null;
        const isRTL = document.documentElement.dir === 'rtl';

        container.addEventListener('touchstart', (e) => {
          if (e.touches.length !== 1) return;
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          deltaX = 0;
          locked = false;
          isHorizontal = null;
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
          if (e.touches.length !== 1 || locked) return;
          const chatsPage = $('swipe-page-chats');
          const gamesPageEl = $('swipe-page-games');
          if (!chatsPage || !gamesPageEl) return;

          const dx = e.touches[0].clientX - startX;
          const dy = e.touches[0].clientY - startY;

          if (isHorizontal === null) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            isHorizontal = Math.abs(dx) > Math.abs(dy);
            if (!isHorizontal) { locked = true; return; }
            chatsPage.classList.add('swiping');
            gamesPageEl.classList.add('swiping');
          }

          deltaX = dx;
          const dir = isRTL ? 1 : -1;
          const baseOffset = currentHomePage === 'games' ? (dir * 100) : 0;
          const pxToPercent = (deltaX / container.offsetWidth) * 100;
          const raw = baseOffset + pxToPercent;

          const minVal = isRTL ? 0 : -100;
          const maxVal = isRTL ? 100 : 0;
          const clamped = Math.max(minVal, Math.min(maxVal, raw));

          chatsPage.style.transform = `translateX(${clamped}%)`;
          gamesPageEl.style.transform = `translateX(${clamped}%)`;
        }, { passive: true });

        container.addEventListener('touchend', () => {
          const chatsPage = $('swipe-page-chats');
          const gamesPageEl = $('swipe-page-games');
          if (chatsPage) chatsPage.classList.remove('swiping');
          if (gamesPageEl) gamesPageEl.classList.remove('swiping');

          if (!isHorizontal) return;

          const threshold = container.offsetWidth * 0.25;
          const swipeDir = isRTL ? deltaX : -deltaX;

          if (swipeDir > threshold && currentHomePage === 'chats') {
            swipeTo('games');
          } else if (swipeDir < -threshold && currentHomePage === 'games') {
            swipeTo('chats');
          } else {
            const cp = $('swipe-page-chats');
            const gp = $('swipe-page-games');
            const dir = isRTL ? 1 : -1;
            const offset = currentHomePage === 'games' ? (dir * 100) : 0;
            if (cp) cp.style.transform = `translateX(${offset}%)`;
            if (gp) gp.style.transform = `translateX(${offset}%)`;
          }
        }, { passive: true });
      });
    })();

    function startGameByType(gameType) {
      if (gameType === 'xo') startXO();
      else if (gameType === 'rps') startRPS();
      else if (gameType === 'c4') startC4();
      else if (gameType === 'guess') startGuess();
    }

    function stopActiveGame() {
      if (activeGameRef && activeGameCb) {
        activeGameRef.off('value', activeGameCb);
      }
      activeGameRef = null;
      activeGameCb = null;
    }

    function startGameInline(gameType, chatId, user) {
      currentChatId = chatId;
      currentUser = user;
      startGameByType(gameType);
      const msgRef = db.ref(`chats/${chatId}/messages`).orderByChild('timestamp').limitToLast(1);
      msgRef.once('value', snap => {
        let gameKey = null;
        snap.forEach(child => { gameKey = child.key; });
        if (gameKey) listenToActiveGame(chatId, gameKey);
      });
    }

    function listenToActiveGame(chatId, gameKey) {
      stopActiveGame();
      const activeArea = $('games-active');
      if (!activeArea) return;
      activeGameRef = db.ref(`chats/${chatId}/messages/${gameKey}`);
      activeGameCb = (snap) => {
        const msg = snap.val();
        if (!msg || msg.type !== 'game') return;
        let html = '';
        if (msg.game === 'rps') html = renderRPS(msg, gameKey);
        else if (msg.game === 'c4') html = renderC4(msg, gameKey);
        else if (msg.game === 'guess') html = renderGuess(msg, gameKey);
        else html = renderXO(msg, gameKey);
        const partnerName = CONTACTS[msg.px === currentUser ? msg.po : msg.px]?.name || '';
        activeArea.innerHTML = `<div class="game-active-card">
          <div class="game-active-header">
            <span>مع ${partnerName}</span>
            <button class="game-close-btn" onclick="closeActiveGame()">✕</button>
          </div>
          <div class="game-active-body">${html}</div>
        </div>`;
        activeArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
      activeGameRef.on('value', activeGameCb);
    }

    function closeActiveGame() {
      stopActiveGame();
      const activeArea = $('games-active');
      if (activeArea) activeArea.innerHTML = '';
    }

    function pickPartnerForGame(gameType) {
      if (homeUser === 'w') {
        startGameInline(gameType, 'w', 'w');
        return;
      }
      if (homeUser === 'aseel') {
        startGameInline(gameType, 'aseel', 'aseel');
        return;
      }

      const partners = ['w', 'aseel'];
      let html = '';
      partners.forEach(id => {
        html += `<div class="game-partner-card" onclick="hideMsgActions();startGameInline('${gameType}','${id}','saud')">
          <div class="chat-avatar" style="background:${CONTACTS[id].color}">${AVATARS[id]}</div>
          <span>${CONTACTS[id].name}</span>
        </div>`;
      });
      const overlay = $('msg-actions-overlay');
      const panel = $('msg-actions-content');
      panel.innerHTML = `<div class="game-partner-picker"><div class="games-section-title">العب مع</div>${html}</div>`;
      overlay.style.display = 'flex';
      requestAnimationFrame(() => overlay.classList.add('visible'));
    }

    function renderGamesPage() {
      const grid = $('games-grid');
      const activeArea = $('games-active');

      grid.innerHTML = `
        <div class="game-card" onclick="pickPartnerForGame('xo')">
          <span class="game-card-icon">⭕</span>
          <span class="game-card-name">إكس أو</span>
          <span class="game-card-desc">X vs O كلاسيكية</span>
        </div>
        <div class="game-card" onclick="pickPartnerForGame('rps')">
          <span class="game-card-icon">✊</span>
          <span class="game-card-name">حجرة ورقة مقص</span>
          <span class="game-card-desc">اختر سلاحك!</span>
        </div>
        <div class="game-card" onclick="pickPartnerForGame('c4')">
          <span class="game-card-icon">🔴</span>
          <span class="game-card-name">أربعة في خط</span>
          <span class="game-card-desc">صف 4 واربح</span>
        </div>
        <div class="game-card" onclick="pickPartnerForGame('guess')">
          <span class="game-card-icon">🔢</span>
          <span class="game-card-name">خمّن الرقم</span>
          <span class="game-card-desc">1 إلى 100</span>
        </div>`;

      if (!activeGameRef) activeArea.innerHTML = '';
    }

    function openGamePicker() {
      let html = '';
      html += actionBtn('⭕', 'react-icon', 'XO', `hideMsgActions();startXO()`);
      html += actionBtn('✊', 'react-icon', 'حجرة', `hideMsgActions();startRPS()`);
      html += actionBtn('🔴', 'react-icon', 'أربعة', `hideMsgActions();startC4()`);
      html += actionBtn('🔢', 'react-icon', 'خمّن', `hideMsgActions();startGuess()`);
      const panel = $('msg-actions-content');
      panel.innerHTML = html;
      const overlay = $('msg-actions-overlay');
      overlay.style.display = 'block';
      requestAnimationFrame(() => {
        const pw = panel.offsetWidth;
        panel.style.left = ((window.innerWidth - pw) / 2) + 'px';
        panel.style.top = '40%';
        requestAnimationFrame(() => overlay.classList.add('visible'));
      });
    }

    function gameOther() {
      return currentUser === 'saud' ? currentChatId : 'saud';
    }

    function startXO() {
      if (!currentChatId || !currentUser || !db) return;
      db.ref(`chats/${currentChatId}/messages`).push({
        sender: currentUser,
        type: 'game',
        game: 'xo',
        board: '_________',
        turn: 'X',
        px: currentUser,   // starter is X
        po: gameOther(),
        winner: '',
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      sendPush(currentChatId, '🎮 بدأ لعبة إكس أو');
    }

    /* ---- Rock–Paper–Scissors (حجرة ورقة مقص) ---- */
    function startRPS() {
      if (!currentChatId || !currentUser || !db) return;
      db.ref(`chats/${currentChatId}/messages`).push({
        sender: currentUser,
        type: 'game',
        game: 'rps',
        px: currentUser,
        po: gameOther(),
        cx: '',   // X's choice (r/p/s), hidden until both pick
        co: '',   // O's choice
        winner: '',
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      sendPush(currentChatId, '🎮 بدأ لعبة حجرة ورقة مقص');
    }

    function rpsBeats(a, b) {
      return (a === 'r' && b === 's') || (a === 's' && b === 'p') || (a === 'p' && b === 'r');
    }

    function rpsPick(key, choice) {
      if (!currentChatId || !db) return;
      const ref = db.ref(`chats/${currentChatId}/messages/${key}`);
      ref.once('value', snap => {
        const g = snap.val();
        if (!g || g.type !== 'game' || g.game !== 'rps' || g.winner) return;
        const meMark = g.px === currentUser ? 'X' : (g.po === currentUser ? 'O' : null);
        if (!meMark) return;
        const field = meMark === 'X' ? 'cx' : 'co';
        if (g[field]) return; // choice locked once made
        const cx = meMark === 'X' ? choice : g.cx;
        const co = meMark === 'O' ? choice : g.co;
        const update = {};
        update[field] = choice;
        if (cx && co) update.winner = cx === co ? 'draw' : (rpsBeats(cx, co) ? 'X' : 'O');
        ref.update(update);
        if (navigator.vibrate) navigator.vibrate(10);
        if (update.winner) sendPush(currentChatId, update.winner === 'draw' ? '🎮 تعادل (حجرة ورقة مقص)' : '🎮 انتهت جولة حجرة ورقة مقص');
      });
    }

    function renderRPS(msg, key) {
      const meMark = msg.px === currentUser ? 'X' : (msg.po === currentUser ? 'O' : '');
      const myChoice = meMark === 'X' ? msg.cx : (meMark === 'O' ? msg.co : '');
      const theirChoice = meMark === 'X' ? msg.co : (meMark === 'O' ? msg.cx : '');
      const emo = { r: '✊', p: '✋', s: '✌️' };
      const done = !!msg.winner;
      let body = '', status;
      const k = escapeAttr(key);
      if (done) {
        if (msg.winner === 'draw') status = 'تعادل 🤝';
        else status = meMark ? (msg.winner === meMark ? 'فزت! 🎉' : 'خسرت 😅') : `فاز ${msg.winner}`;
        body = `<div class="rps-reveal"><div class="rps-side"><span class="rps-emo">${emo[myChoice] || '❔'}</span><span class="rps-lbl">أنت</span></div><span class="rps-vs">×</span><div class="rps-side"><span class="rps-emo">${emo[theirChoice] || '❔'}</span><span class="rps-lbl">الطرف الثاني</span></div></div>`;
      } else if (!meMark) {
        status = 'لعبة جارية…';
      } else if (!myChoice) {
        status = 'اختر:';
        body = `<div class="rps-choices"><button class="rps-btn" onclick="rpsPick('${k}','r')">✊</button><button class="rps-btn" onclick="rpsPick('${k}','p')">✋</button><button class="rps-btn" onclick="rpsPick('${k}','s')">✌️</button></div>`;
      } else {
        status = `اخترت ${emo[myChoice]} — بانتظار الطرف الثاني…`;
      }
      return `<div class="rps-game${done ? ' xo-done' : ''}"><div class="xo-title">✊✋✌️ حجرة ورقة مقص</div>${body}<div class="xo-status">${escapeHtml(status)}</div></div>`;
    }

    /* ---- Connect Four (أربعة في خط): 7 cols × 6 rows ---- */
    function startC4() {
      if (!currentChatId || !currentUser || !db) return;
      db.ref(`chats/${currentChatId}/messages`).push({
        sender: currentUser, type: 'game', game: 'c4',
        board: '_'.repeat(42), turn: 'X',
        px: currentUser, po: gameOther(), winner: '',
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      sendPush(currentChatId, '🎮 بدأ لعبة أربعة في خط');
    }

    function c4WinnerOf(b) {
      const R = 6, C = 7;
      const at = (r, c) => (r >= 0 && r < R && c >= 0 && c < C) ? b[r * C + c] : '_';
      const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const p = at(r, c);
        if (p === '_') continue;
        for (const [dr, dc] of dirs) {
          if (at(r + dr, c + dc) === p && at(r + 2 * dr, c + 2 * dc) === p && at(r + 3 * dr, c + 3 * dc) === p) return p;
        }
      }
      return b.indexOf('_') === -1 ? 'draw' : '';
    }

    function c4Drop(key, col) {
      if (!currentChatId || !db) return;
      const ref = db.ref(`chats/${currentChatId}/messages/${key}`);
      ref.once('value', snap => {
        const g = snap.val();
        if (!g || g.type !== 'game' || g.game !== 'c4' || g.winner) return;
        const myMark = g.px === currentUser ? 'X' : (g.po === currentUser ? 'O' : null);
        if (!myMark || myMark !== g.turn) return;
        const board = (g.board || '_'.repeat(42)).split('');
        let placed = -1;
        for (let r = 5; r >= 0; r--) { if (board[r * 7 + col] === '_') { board[r * 7 + col] = myMark; placed = r; break; } }
        if (placed === -1) return; // column full
        const nb = board.join('');
        const w = c4WinnerOf(nb);
        ref.update({ board: nb, turn: g.turn === 'X' ? 'O' : 'X', winner: w });
        if (navigator.vibrate) navigator.vibrate(10);
        if (w) sendPush(currentChatId, w === 'draw' ? '🎮 تعادل (أربعة في خط)' : '🎮 انتهت لعبة أربعة في خط');
      });
    }

    function renderC4(msg, key) {
      const b = (msg.board || '_'.repeat(42)).split('');
      const meMark = msg.px === currentUser ? 'X' : (msg.po === currentUser ? 'O' : '');
      let status;
      if (msg.winner === 'draw') status = 'تعادل 🤝';
      else if (msg.winner) status = meMark ? (msg.winner === meMark ? 'فزت! 🎉' : 'خسرت 😅') : `فاز ${msg.winner}`;
      else { const tu = msg.turn === 'X' ? msg.px : msg.po; status = tu === currentUser ? 'دورك ✋' : 'دور الطرف الثاني…'; }
      const k = escapeAttr(key);
      const myTurn = !msg.winner && ((msg.turn === 'X' ? msg.px : msg.po) === currentUser);
      let drops = '<div class="c4-drops">';
      for (let c = 0; c < 7; c++) drops += `<button class="c4-drop" ${myTurn ? '' : 'disabled'} onclick="c4Drop('${k}',${c})">⬇</button>`;
      drops += '</div>';
      let cells = '<div class="c4-board">';
      for (let i = 0; i < 42; i++) { const v = b[i]; cells += `<span class="c4-cell ${v === 'X' ? 'c4-x' : v === 'O' ? 'c4-o' : ''}"></span>`; }
      cells += '</div>';
      return `<div class="c4-game${msg.winner ? ' xo-done' : ''}"><div class="xo-title">🔴🟡 أربعة في خط</div>${drops}${cells}<div class="xo-status">${escapeHtml(status)}</div></div>`;
    }

    /* ---- Guess the number (خمّن الرقم): setter picks 1–100, guesser guesses ---- */
    function startGuess() {
      if (!currentChatId || !currentUser || !db) return;
      db.ref(`chats/${currentChatId}/messages`).push({
        sender: currentUser, type: 'game', game: 'guess',
        px: currentUser, po: gameOther(),
        setter: '', secret: 0, guesses: '', winner: '',
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      sendPush(currentChatId, '🎮 بدأ لعبة خمّن الرقم');
    }

    function setSecret(key, val) {
      const n = parseInt(val, 10);
      if (!(n >= 1 && n <= 100)) { miniToast('اكتب رقم من 1 إلى 100'); return; }
      const ref = db.ref(`chats/${currentChatId}/messages/${key}`);
      ref.once('value', snap => {
        const g = snap.val();
        // Either participant may set the number — first to submit becomes the setter.
        if (!g || g.game !== 'guess' || g.secret) return;
        if (currentUser !== g.px && currentUser !== g.po) return;
        ref.update({ secret: n, setter: currentUser });
        sendPush(currentChatId, '🔢 اختار الرقم — خمّن!');
      });
    }

    function guessNum(key, val) {
      const n = parseInt(val, 10);
      if (!(n >= 1 && n <= 100)) { miniToast('اكتب رقم من 1 إلى 100'); return; }
      const ref = db.ref(`chats/${currentChatId}/messages/${key}`);
      ref.once('value', snap => {
        const g = snap.val();
        if (!g || g.game !== 'guess' || !g.secret || g.winner) return;
        if (currentUser === g.setter) return; // the setter can't guess
        if (currentUser !== g.px && currentUser !== g.po) return;
        const dir = n === g.secret ? 'c' : (n < g.secret ? 'u' : 'd');
        const guesses = (g.guesses ? g.guesses + ',' : '') + n + '|' + dir;
        const update = { guesses };
        if (dir === 'c') update.winner = 'done';
        ref.update(update);
        if (navigator.vibrate) navigator.vibrate(dir === 'c' ? 20 : 8);
        if (dir === 'c') sendPush(currentChatId, '🎮 خمّن الرقم صح! 🎉');
      });
    }

    function renderGuess(msg, key) {
      const isParticipant = (msg.px === currentUser || msg.po === currentUser);
      const secretSet = msg.secret && msg.secret > 0;
      const meIsSetter = msg.setter && msg.setter === currentUser;
      const done = msg.winner === 'done';
      const guesses = (msg.guesses || '').split(',').filter(Boolean);
      const k = escapeAttr(key);
      let hist = '';
      if (guesses.length) {
        hist = '<div class="guess-hist">' + guesses.map(gg => {
          const parts = gg.split('|'); const icon = parts[1] === 'u' ? '⬆️' : parts[1] === 'd' ? '⬇️' : '✅';
          return `<span class="guess-chip">${escapeHtml(parts[0])} ${icon}</span>`;
        }).join('') + '</div>';
      }
      let status, body = '';
      if (done) {
        status = `تم! خمّنها في ${guesses.length} محاولة 🎉`; body = hist;
      } else if (!secretSet) {
        // Before a number is picked, either player may set it.
        if (isParticipant) {
          status = 'اختر رقم سري (1-100) والثاني يخمّن:';
          body = `<div class="guess-input"><input type="number" min="1" max="100" inputmode="numeric" class="guess-field" id="gs-${k}"><button class="guess-btn" onclick="setSecret('${k}',document.getElementById('gs-${k}').value)">تعيين</button></div>`;
        } else { status = 'لعبة جارية…'; }
      } else if (meIsSetter) {
        status = 'بانتظار تخمين الطرف الثاني…'; body = hist;
      } else if (isParticipant) {
        status = 'خمّن الرقم (1-100):';
        body = hist + `<div class="guess-input"><input type="number" min="1" max="100" inputmode="numeric" class="guess-field" id="gg-${k}"><button class="guess-btn" onclick="guessNum('${k}',document.getElementById('gg-${k}').value)">خمّن</button></div>`;
      } else { status = 'لعبة جارية…'; body = hist; }
      return `<div class="guess-game${done ? ' xo-done' : ''}"><div class="xo-title">🔢 خمّن الرقم</div><div class="xo-status">${escapeHtml(status)}</div>${body}</div>`;
    }

    function xoWinnerOf(b) {
      const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      for (const [a, c, d] of lines) {
        if (b[a] !== '_' && b[a] === b[c] && b[c] === b[d]) return b[a];
      }
      return b.indexOf('_') === -1 ? 'draw' : '';
    }

    function xoMove(key, i) {
      if (!currentChatId || !db) return;
      const ref = db.ref(`chats/${currentChatId}/messages/${key}`);
      ref.once('value', snap => {
        const g = snap.val();
        if (!g || g.type !== 'game' || g.winner) return;
        const board = (g.board || '_________').split('');
        if (board[i] !== '_') return;
        const myMark = g.px === currentUser ? 'X' : (g.po === currentUser ? 'O' : null);
        if (!myMark || myMark !== g.turn) return; // not your turn / not a player
        board[i] = myMark;
        const nb = board.join('');
        const w = xoWinnerOf(nb);
        ref.update({ board: nb, turn: g.turn === 'X' ? 'O' : 'X', winner: w });
        if (navigator.vibrate) navigator.vibrate(10);
        if (w) sendPush(currentChatId, w === 'draw' ? '🎮 تعادل في إكس أو' : '🎮 انتهت لعبة إكس أو');
      });
    }

    function renderXO(msg, key) {
      const b = (msg.board || '_________').split('');
      const meMark = msg.px === currentUser ? 'X' : (msg.po === currentUser ? 'O' : '');
      let status, done = !!msg.winner;
      if (msg.winner === 'draw') {
        status = 'تعادل 🤝';
      } else if (msg.winner) {
        status = meMark ? (msg.winner === meMark ? 'فزت! 🎉' : 'خسرت 😅') : `فاز ${msg.winner}`;
      } else {
        const turnUser = msg.turn === 'X' ? msg.px : msg.po;
        status = turnUser === currentUser ? 'دورك ✋' : 'دور الطرف الثاني…';
      }
      const cells = b.map((c, i) => {
        const cls = c === 'X' ? 'xo-x' : c === 'O' ? 'xo-o' : '';
        return `<button class="xo-cell ${cls}" onclick="xoMove('${escapeAttr(key)}',${i})">${c === '_' ? '' : c}</button>`;
      }).join('');
      return `<div class="xo-game${done ? ' xo-done' : ''}"><div class="xo-title">🎮 إكس أو</div><div class="xo-board">${cells}</div><div class="xo-status">${escapeHtml(status)}</div></div>`;
    }

    function editMessage(key) {
      hideMsgActions();
      const el = document.querySelector(`[data-key="${key}"]`);
      if (!el) return;
      const textEl = el.querySelector('.msg-text');
      if (!textEl) return;

      editingKey = key;
      const input = $('msg-input');
      input.value = textEl.textContent;
      input.focus();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      $('edit-indicator').style.display = 'flex';
      $('btn-send').style.background = '#f59e0b';
      updateInputButtons();
    }

    function clearChat(chatId) {
      if (!confirm('حذف جميع الرسائل؟')) return;
      db.ref(`chats/${chatId}/messages`).remove();
      $('messages-area').innerHTML = '';
      myMessages = [];
      allMsgElements = [];
      knownReactions = {};
    }

    function cancelEdit() {
      editingKey = null;
      $('msg-input').value = '';
      $('msg-input').style.height = 'auto';
      $('edit-indicator').style.display = 'none';
      $('btn-send').style.background = '';
      updateInputButtons();
    }

    /* ==========================================================
       SEEN INDICATOR
    ========================================================== */
    const TICK_SINGLE = '<svg viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5L6 10.5L13 2.5"/></svg>';
    const TICK_DOUBLE = '<svg viewBox="0 0 22 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6.5L5 10.5L12 2.5"/><path d="M8 6.5L12 10.5L19 2.5"/></svg>';

    function updateSeenIndicator() {
      myMessages.forEach(m => {
        const s = m.el.querySelector('.msg-status');
        if (!s) return;
        const seen = otherSeenTimestamp && m.timestamp <= otherSeenTimestamp;
        if (seen) {
          if (!s.classList.contains('seen')) { s.classList.add('seen'); s.innerHTML = TICK_DOUBLE; }
        } else if (s.classList.contains('seen')) {
          s.classList.remove('seen'); s.innerHTML = TICK_SINGLE;
        }
      });
    }

    /* ==========================================================
       UTILITIES
    ========================================================== */
    function escapeHtml(text) {
      const d = document.createElement('div');
      d.textContent = text;
      return d.innerHTML;
    }

    function escapeAttr(text) {
      return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const URL_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

    // Rich text for messages: WhatsApp-style *bold* _italic_ ~strike~ `mono`,
    // plus clickable links (Twitter/WhatsApp). Everything is escaped first.
    function formatText(raw) {
      const links = [];
      // Pull links out (as @@Ln@@ tokens) so formatting markers inside a URL
      // are left alone; the tokens carry no markdown chars and survive escaping.
      let text = raw.replace(URL_RE, (m) => { links.push(m); return '@@L' + (links.length - 1) + '@@'; });
      text = escapeHtml(text);
      text = text
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*(\S(?:[^*\n]*?\S)?)\*/g, '<strong>$1</strong>')
        .replace(/~(\S(?:[^~\n]*?\S)?)~/g, '<del>$1</del>')
        .replace(/_(\S(?:[^_\n]*?\S)?)_/g, '<em>$1</em>');
      text = text.replace(/@@L(\d+)@@/g, (m, i) => {
        const url = links[+i];
        const href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
        return `<a class="msg-link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      });
      return text;
    }

    // Returns the emoji count (1..3) for an emoji-only message, else 0 — used
    // to render tiny emoji-only messages large (Instagram/iMessage style).
    function emojiOnlyCount(raw) {
      const t = (raw || '').trim();
      if (!t) return 0;
      if (/[0-9A-Za-z؀-ۿ]/.test(t)) return 0;
      let pictographic;
      try { pictographic = /\p{Extended_Pictographic}/u.test(t); } catch (e) { return 0; }
      if (!pictographic) return 0;
      const noSpace = t.replace(/\s+/g, '');
      let count;
      try { count = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(noSpace)].length; }
      catch (e) { count = Array.from(noSpace).length; }
      if (count <= 3) return count;
      return 4;
    }

    function formatTime(ts) {
      if (!ts) return '';
      return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
    }

    function formatRelative(ts) {
      if (!ts) return '';
      const diff = Date.now() - ts;
      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(mins / 60);
      const days = Math.floor(hrs / 24);

      if (mins < 1) return 'الآن';
      if (mins < 60) return `منذ ${mins} د`;
      if (hrs < 24) return `منذ ${hrs} س`;
      if (days === 1) return 'أمس';
      if (days < 7) return `منذ ${days} أيام`;
      return new Date(ts).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
    }

    /* ==========================================================
       NOTIFICATION PROMPT
    ========================================================== */
    function enableNotif() {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') subscribePush();
        const p = document.getElementById('notif-prompt');
        if (p) p.remove();
      });
    }

    function dismissNotifPrompt() {
      const userId = currentUser || inferUserId();
      if (userId) localStorage.setItem('notif_dismissed_' + userId, 'true');
      const p = document.getElementById('notif-prompt');
      if (p) p.remove();
    }

    /* ==========================================================
       TYPING INDICATOR
    ========================================================== */
    function markSeen() {
      if (!currentChatId || !currentUser || !db) return;
      if (currentView !== 'chat' && currentView !== 'person') return;
      if (document.hidden) return;
      db.ref(`chats/${currentChatId}/seen/${currentUser}`).set(firebase.database.ServerValue.TIMESTAMP);
    }

    function setTyping() {
      if (!currentChatId || !currentUser || !db) return;
      markSeen();
      db.ref(`chats/${currentChatId}/typing/${currentUser}`).set(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        if (currentChatId && currentUser) {
          db.ref(`chats/${currentChatId}/typing/${currentUser}`).remove();
        }
      }, 2000);
    }

    function clearTyping() {
      clearTimeout(typingTimer);
      if (currentChatId && currentUser && db) {
        db.ref(`chats/${currentChatId}/typing/${currentUser}`).remove();
      }
    }

    /* ==========================================================
       PRESENCE ("in the conversation" indicator)
    ========================================================== */
    // How recent the other side's heartbeat must be to count as "online".
    const PRESENCE_WINDOW = 45000;

    // Heartbeat: while the chat is open and foregrounded, keep refreshing my own
    // "seen" timestamp (every 15s) and re-evaluate whether the other side is
    // still fresh. markSeen() already guards document.hidden and no-op cases.
    function startPresence() {
      clearInterval(presenceTimer);
      markSeen();
      refreshPresenceView();
      presenceTimer = setInterval(() => {
        markSeen();
        refreshPresenceView();
      }, 15000);
    }

    function stopPresence() {
      clearInterval(presenceTimer);
      presenceTimer = null;
      updatePresenceIndicator(false);
    }

    // Decide online/offline from the other side's most recent seen heartbeat.
    function refreshPresenceView() {
      const fresh = otherSeenTimestamp &&
        (Date.now() + serverTimeOffset - otherSeenTimestamp) < PRESENCE_WINDOW;
      updatePresenceIndicator(!!fresh);
    }

    function updatePresenceIndicator(online) {
      const dot = $('presence-dot');
      const status = $('chat-header-status');
      if (dot) dot.classList.toggle('online', !!online);
      if (status) {
        status.textContent = online ? 'متصل الآن' : '';
        status.classList.toggle('online', !!online);
      }
    }

    /* ==========================================================
       PIN PROTECTION
    ========================================================== */
    function isPinVerified() {
      return localStorage.getItem('pin_verified') === 'true';
    }

    function showPinOverlay() {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      $('pin-overlay').style.display = 'flex';
      $('pin-error').style.display = 'none';
      $('pin-input').value = '';
      setTimeout(() => $('pin-input').focus(), 100);
    }

    function checkPin() {
      const input = $('pin-input');
      if (input.value === PIN_CODE) {
        localStorage.setItem('pin_verified', 'true');
        $('pin-overlay').style.display = 'none';
        route();
      } else {
        $('pin-error').style.display = 'block';
        input.value = '';
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 500);
      }
    }

    /* ==========================================================
       WEB PUSH NOTIFICATIONS
    ========================================================== */
    function subscribePush() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

      navigator.serviceWorker.ready.then(reg => {
        reg.pushManager.getSubscription().then(sub => {
          if (sub) {
            savePushSubscription(sub);
            return;
          }
          const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: convertedKey
          }).then(newSub => {
            savePushSubscription(newSub);
          }).catch(() => {});
        });
      });
    }

    function savePushSubscription(sub) {
      if (!db) return;
      const userId = APP_USER;
      const subData = sub.toJSON();
      const subKey = btoa(subData.endpoint).replace(/[.#$\[\]\/]/g, '_').substring(0, 100);
      db.ref(`push-subscriptions/${userId}/${subKey}`).set(subData);
      const others = ['saud', 'w', 'aseel'].filter(u => u !== userId);
      others.forEach(u => db.ref(`push-subscriptions/${u}/${subKey}`).remove());
    }

    function urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - base64String.length % 4) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = atob(base64);
      return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
    }

    /* ==========================================================
       DARK MODE
    ========================================================== */
    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('chat_theme', next);
      const btn = $('btn-theme');
      if (btn) btn.innerHTML = next === 'dark'
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
    }

    /* ==========================================================
       REPLY TO MESSAGE
    ========================================================== */
    function setReply(key) {
      hideMsgActions();
      const entry = allMsgElements.find(m => m.key === key);
      if (!entry) return;
      replyToKey = key;
      replyToMsg = entry.msg;

      let old = document.getElementById('reply-preview');
      if (old) old.remove();

      const senderName = replyToMsg.sender === currentUser ? 'أنت' : (replyToMsg.sender === 'saud' ? 'سعود' : (CONTACTS[replyToMsg.sender] ? CONTACTS[replyToMsg.sender].name : replyToMsg.sender));
      const previewText = replyToMsg.type === 'image' ? '📷 صورة' : replyToMsg.type === 'video' ? '🎥 فيديو' : replyToMsg.type === 'audio' ? '🎤 رسالة صوتية' : (replyToMsg.content.length > 60 ? replyToMsg.content.substring(0, 60) + '...' : replyToMsg.content);

      const bar = document.createElement('div');
      bar.id = 'reply-preview';
      bar.className = 'reply-preview';
      bar.innerHTML = `<div class="reply-preview-content"><div class="reply-preview-name">${escapeHtml(senderName)}</div><div class="reply-preview-text">${escapeHtml(previewText)}</div></div><button class="btn-cancel-reply" onclick="cancelReply()">✕</button>`;

      const inputArea = document.querySelector('.input-area');
      inputArea.parentNode.insertBefore(bar, inputArea);
      $('msg-input').focus();
    }

    function cancelReply() {
      replyToKey = null;
      replyToMsg = null;
      const rp = document.getElementById('reply-preview');
      if (rp) rp.remove();
    }

    function scrollToMessage(key) {
      const el = document.querySelector(`[data-key="${key}"]`);
      if (!el) {
        // The quoted message may be older than the loaded window — pull in the
        // rest of the history, then try again.
        if (ensureAllLoaded) {
          const pending = ensureAllLoaded;
          ensureAllLoaded = null;
          pending(() => scrollToMessage(key));
        }
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid var(--accent)';
      el.style.outlineOffset = '2px';
      setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 1500);
    }

    /* ==========================================================
       EMOJI REACTIONS
    ========================================================== */
    const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];

    // Double-tap = quick ❤️ reaction, triple-tap = actions menu.
    // We wait a short window after the last tap to tell double from triple.
    function addTapGestures(el, onDouble, onTriple) {
      let taps = 0;
      let timer = null;
      let lastTouch = 0;

      function register() {
        taps++;
        clearTimeout(timer);
        timer = setTimeout(() => {
          const count = taps;
          taps = 0;
          if (count === 2) onDouble();
          else if (count >= 3) onTriple();
        }, 320);
      }

      el.addEventListener('touchend', (e) => {
        lastTouch = Date.now();
        if (taps >= 1) e.preventDefault(); // avoid double-tap zoom on repeats
        register();
      });

      el.addEventListener('click', () => {
        if (Date.now() - lastTouch < 600) return; // ignore ghost click after a touch
        register();
      });
    }

    // TikTok-style burst of floating hearts when a message is double-tapped.
    function burstHearts(el) {
      if (!el) return;
      if (navigator.vibrate) navigator.vibrate(14);
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let i = 0; i < 6; i++) {
        const h = document.createElement('div');
        h.className = 'heart-float';
        h.textContent = '❤️';
        h.style.left = cx + 'px';
        h.style.top = cy + 'px';
        h.style.setProperty('--dx', ((Math.random() - 0.5) * 90).toFixed(0) + 'px');
        h.style.setProperty('--rot', ((Math.random() - 0.5) * 50).toFixed(0) + 'deg');
        h.style.setProperty('--sc', (0.7 + Math.random() * 0.7).toFixed(2));
        h.style.animationDelay = Math.round(Math.random() * 130) + 'ms';
        document.body.appendChild(h);
        setTimeout(() => h.remove(), 1300);
      }
    }

    let currentReactionKey = null;

    function openReactionPicker(key) {
      let old = document.getElementById('reaction-picker');
      if (old) old.remove();

      const msgEl = document.querySelector(`[data-key="${key}"]`);
      if (!msgEl) return;
      currentReactionKey = key;

      const picker = document.createElement('div');
      picker.id = 'reaction-picker';
      picker.className = 'reaction-picker';
      picker.innerHTML = REACTION_EMOJIS.map(e => `<button class="reaction-btn">${e}</button>`).join('') +
        `<button class="reaction-btn-more">+</button>`;

      picker.querySelectorAll('.reaction-btn').forEach((btn, i) => {
        btn.onclick = () => addReaction(key, REACTION_EMOJIS[i]);
      });
      picker.querySelector('.reaction-btn-more').onclick = () => {
        picker.remove();
        openEmojiInputBar(key);
      };

      document.body.appendChild(picker);
      const rect = msgEl.getBoundingClientRect();
      picker.style.top = Math.max(10, rect.top - 50) + 'px';
      picker.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - picker.offsetWidth - 10)) + 'px';

      const dismiss = (e) => {
        if (!picker.contains(e.target)) {
          picker.remove();
          document.removeEventListener('click', dismiss);
          document.removeEventListener('touchstart', dismiss);
        }
      };
      setTimeout(() => {
        document.addEventListener('click', dismiss);
        document.addEventListener('touchstart', dismiss);
      }, 10);
    }

    function openEmojiInputBar(key) {
      closeEmojiInputBar();
      const backdrop = document.createElement('div');
      backdrop.id = 'emoji-input-backdrop';
      backdrop.className = 'emoji-input-backdrop';
      backdrop.onclick = closeEmojiInputBar;

      const bar = document.createElement('div');
      bar.id = 'emoji-input-bar';
      bar.className = 'emoji-input-bar';
      bar.innerHTML = `<button class="emoji-bar-close" onclick="closeEmojiInputBar()">✕</button><input type="text" placeholder="اختر إيموجي 😀" dir="ltr" autocomplete="off">`;

      document.body.appendChild(backdrop);
      document.body.appendChild(bar);

      const input = bar.querySelector('input');
      input.addEventListener('input', () => {
        const val = input.value.trim();
        if (val) {
          addReaction(key, val);
          closeEmojiInputBar();
        }
      });
      setTimeout(() => input.focus(), 50);
    }

    function closeEmojiInputBar() {
      const bar = document.getElementById('emoji-input-bar');
      const backdrop = document.getElementById('emoji-input-backdrop');
      if (bar) bar.remove();
      if (backdrop) backdrop.remove();
    }

    function addReaction(key, emoji) {
      const picker = document.getElementById('reaction-picker');
      if (picker) picker.remove();
      if (!currentChatId || !currentUser || !db) return;
      db.ref(`chats/${currentChatId}/messages/${key}/reactions/${currentUser}`).once('value', snap => {
        if (snap.val() === emoji) {
          db.ref(`chats/${currentChatId}/messages/${key}/reactions/${currentUser}`).remove();
        } else {
          db.ref(`chats/${currentChatId}/messages/${key}/reactions/${currentUser}`).set(emoji);
          haptic(15);
          const entry = allMsgElements.find(m => m.key === key);
          if (entry && entry.msg.sender !== currentUser) {
            sendPush(currentChatId, `تفاعل على رسالتك ${emoji}`);
          }
        }
      });
    }

    function toggleReaction(key, emoji) {
      if (!currentChatId || !currentUser || !db) return;
      db.ref(`chats/${currentChatId}/messages/${key}/reactions/${currentUser}`).once('value', snap => {
        if (snap.val() === emoji) {
          db.ref(`chats/${currentChatId}/messages/${key}/reactions/${currentUser}`).remove();
        } else {
          db.ref(`chats/${currentChatId}/messages/${key}/reactions/${currentUser}`).set(emoji);
          haptic(15);
          const entry = allMsgElements.find(m => m.key === key);
          if (entry && entry.msg.sender !== currentUser) {
            sendPush(currentChatId, `تفاعل على رسالتك ${emoji}`);
          }
        }
      });
    }

    /* ==========================================================
       STICKER & GIF PICKER
       - "ستيكراتي": custom shared sticker pack (Cloudinary + Firebase),
         for Arabic content (حسن البارقي، طاش ما طاش، …)
       - "GIF": Tenor search (better Arabic coverage) with GIPHY fallback
    ========================================================== */
    const GIPHY_KEY = 'YKbmWpQqVRfRU3vt8j0IVzONuKKNyKSj'; // GIPHY API key
    const TENOR_KEY = 'YOUR_TENOR_KEY'; // Google Cloud key with Tenor API enabled
    let gifSearchTimer = null;
    let gifTab = 'stickers';

    function openGifPicker() {
      if (document.getElementById('gif-overlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'gif-overlay';
      overlay.className = 'gif-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) closeGifPicker(); };
      overlay.innerHTML = `
        <div class="gif-panel" onclick="event.stopPropagation()">
          <div class="gif-tabs">
            <button class="gif-tab" data-tab="stickers" onclick="switchGifTab('stickers')">ستيكراتي</button>
            <button class="gif-tab" data-tab="gif" onclick="switchGifTab('gif')">GIF</button>
            <button class="gif-close" onclick="closeGifPicker()" aria-label="إغلاق">✕</button>
          </div>
          <div class="gif-search-row" id="gif-search-row" style="display:none">
            <input type="text" id="gif-search-input" class="gif-search-input" placeholder="ابحث عن GIF…" dir="auto" autocomplete="off">
          </div>
          <div class="gif-grid" id="gif-grid"></div>
          <div class="gif-attribution" id="gif-attribution"></div>
        </div>`;
      document.body.appendChild(overlay);
      const inp = document.getElementById('gif-search-input');
      inp.addEventListener('input', () => {
        clearTimeout(gifSearchTimer);
        const q = inp.value.trim();
        gifSearchTimer = setTimeout(() => loadGifs(q), 350);
      });
      switchGifTab(gifTab);
    }

    function switchGifTab(tab) {
      gifTab = tab;
      clearTimeout(gifSearchTimer);
      document.querySelectorAll('.gif-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      const searchRow = document.getElementById('gif-search-row');
      const attr = document.getElementById('gif-attribution');
      const useTenor = TENOR_KEY && TENOR_KEY !== 'YOUR_TENOR_KEY';
      if (tab === 'stickers') {
        if (searchRow) searchRow.style.display = 'none';
        if (attr) attr.textContent = '';
        loadStickers();
      } else {
        if (searchRow) searchRow.style.display = 'flex';
        if (attr) attr.textContent = useTenor ? 'مدعوم من Tenor' : 'مدعوم من GIPHY';
        const inp = document.getElementById('gif-search-input');
        if (inp) { loadGifs(inp.value.trim()); setTimeout(() => inp.focus(), 80); }
        else loadGifs('');
      }
    }

    function closeGifPicker() {
      clearTimeout(gifSearchTimer);
      const o = document.getElementById('gif-overlay');
      if (o) o.remove();
    }

    /* ---- Custom stickers: a shared pack stored in Firebase ---- */
    function loadStickers() {
      const grid = document.getElementById('gif-grid');
      if (!grid || !db) return;
      grid.innerHTML = '<div class="gif-status">جاري التحميل…</div>';
      db.ref('stickers').once('value', snap => {
        if (gifTab !== 'stickers') return;
        grid.innerHTML = '';
        const add = document.createElement('button');
        add.className = 'gif-cell sticker-add';
        add.innerHTML = '<span>➕<br>إضافة</span>';
        add.onclick = pickStickerFile;
        grid.appendChild(add);
        const items = [];
        snap.forEach(ch => {
          const v = ch.val() || {};
          if (v.url) items.push({ key: ch.key, url: v.url, type: v.type || 'gif', timestamp: v.timestamp || 0 });
        });
        items.sort((a, b) => b.timestamp - a.timestamp);
        items.forEach(s => {
          const cell = document.createElement('div');
          cell.className = 'gif-cell sticker-cell';
          cell.innerHTML = `<img src="${escapeAttr(s.url)}" alt="ستيكر" loading="lazy"><button class="sticker-del" aria-label="حذف">✕</button>`;
          cell.querySelector('img').onclick = () => sendGif(s.url, s.type);
          cell.querySelector('.sticker-del').onclick = (e) => { e.stopPropagation(); deleteSticker(s.key); };
          grid.appendChild(cell);
        });
        if (!items.length) {
          const hint = document.createElement('div');
          hint.className = 'gif-status';
          hint.textContent = 'ما فيه ستيكرات بعد — اضغط ➕ وأضف صور أو GIF (حسن البارقي، طاش…)';
          grid.appendChild(hint);
        }
      });
    }

    function pickStickerFile() {
      let input = document.getElementById('sticker-file-input');
      if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'sticker-file-input';
        input.accept = 'image/*';
        input.multiple = true;
        input.style.display = 'none';
        document.body.appendChild(input);
      }
      input.value = '';
      input.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length) uploadStickers(files);
      };
      input.click();
    }

    async function uploadStickers(files) {
      const grid = document.getElementById('gif-grid');
      let done = 0, failed = 0;
      const setStatus = (txt) => {
        let el = document.getElementById('sticker-uploading');
        if (!el && grid) { grid.insertAdjacentHTML('afterbegin', `<div class="gif-status" id="sticker-uploading">${txt}</div>`); }
        else if (el) el.textContent = txt;
      };
      setStatus(`جاري رفع الستيكرات… (0/${files.length})`);
      for (const file of files) {
        try {
          const url = await uploadToCloudinary(file);
          await db.ref('stickers').push({
            url,
            type: file.type === 'image/gif' ? 'gif' : 'image',
            timestamp: firebase.database.ServerValue.TIMESTAMP
          });
          done++;
        } catch (err) {
          failed++;
        }
        setStatus(`جاري رفع الستيكرات… (${done + failed}/${files.length})`);
      }
      if (gifTab === 'stickers') loadStickers();
      if (failed) setTimeout(() => setStatus(`تم رفع ${done}، وفشل ${failed}`), 50);
    }

    function deleteSticker(key) {
      if (!db || !key) return;
      db.ref('stickers/' + key).remove().then(() => { if (gifTab === 'stickers') loadStickers(); });
    }

    /* ---- GIF search: Tenor (Arabic) with GIPHY fallback ---- */
    async function loadGifs(query) {
      const grid = document.getElementById('gif-grid');
      if (!grid) return;
      grid.innerHTML = '<div class="gif-status">جاري التحميل…</div>';
      const useTenor = TENOR_KEY && TENOR_KEY !== 'YOUR_TENOR_KEY';
      try {
        const results = useTenor ? await fetchTenor(query) : await fetchGiphy(query);
        if (gifTab !== 'gif') return;
        // Guard against a late response from a previous query.
        if (document.getElementById('gif-search-input')?.value.trim() !== query) return;
        if (results === null) {
          grid.innerHTML = '<div class="gif-status">مفتاح غير صالح أو تجاوز الحد</div>';
          return;
        }
        if (!results.length) {
          grid.innerHTML = '<div class="gif-status">لا توجد نتائج</div>';
          return;
        }
        grid.innerHTML = '';
        results.forEach(r => {
          const cell = document.createElement('button');
          cell.className = 'gif-cell';
          cell.innerHTML = `<img src="${escapeAttr(r.thumb)}" alt="GIF" loading="lazy">`;
          cell.onclick = () => sendGif(r.full, 'gif');
          grid.appendChild(cell);
        });
      } catch (e) {
        grid.innerHTML = '<div class="gif-status">تعذّر التحميل، تحقق من الاتصال</div>';
      }
    }

    async function fetchGiphy(query) {
      const url = query
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(query)}&limit=24&rating=pg-13&lang=ar`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=24&rating=pg-13`;
      const res = await fetch(url);
      const data = await res.json();
      const status = data && data.meta && data.meta.status;
      if (status && status >= 400) return null;
      return ((data && data.data) || []).map(g => {
        const img = g.images || {};
        const thumb = (img.fixed_width_downsampled || img.fixed_width || img.downsized || {}).url;
        const full = (img.downsized_medium || img.original || img.fixed_width || {}).url;
        return (thumb && full) ? { thumb, full } : null;
      }).filter(Boolean);
    }

    async function fetchTenor(query) {
      const base = query
        ? `https://tenor.googleapis.com/v2/search?key=${TENOR_KEY}&q=${encodeURIComponent(query)}&limit=24&locale=ar_SA&media_filter=tinygif,gif&contentfilter=medium`
        : `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&limit=24&locale=ar_SA&media_filter=tinygif,gif&contentfilter=medium`;
      const res = await fetch(base);
      if (res.status === 401 || res.status === 403) return null;
      const data = await res.json();
      return ((data && data.results) || []).map(r => {
        const mf = r.media_formats || {};
        const thumb = (mf.tinygif || mf.nanogif || mf.gif || {}).url;
        const full = (mf.gif || mf.mediumgif || mf.tinygif || {}).url;
        return (thumb && full) ? { thumb, full } : null;
      }).filter(Boolean);
    }

    function sendGif(url, type) {
      if (!currentChatId || !currentUser || !db) return;
      type = type || 'gif';
      const msgData = {
        sender: currentUser,
        type: type,
        content: url,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      };
      if (replyToKey && replyToMsg) {
        msgData.replyTo = {
          key: replyToKey,
          sender: replyToMsg.sender,
          type: replyToMsg.type,
          text: replyToMsg.type === 'text' ? (replyToMsg.content.length > 60 ? replyToMsg.content.substring(0, 60) + '...' : replyToMsg.content) : ''
        };
      }
      db.ref(`chats/${currentChatId}/messages`).push(msgData);
      sendPush(currentChatId, type === 'image' ? '😄 ستيكر' : '🎞️ GIF');
      cancelReply();
      closeGifPicker();
    }

    /* ==========================================================
       SEARCH MESSAGES
    ========================================================== */
    function toggleSearch() {
      if (searchOpen) {
        closeSearch();
        return;
      }
      searchOpen = true;
      const bar = document.createElement('div');
      bar.id = 'search-bar';
      bar.className = 'search-bar';
      bar.innerHTML = `<input class="search-input" id="search-input" type="text" placeholder="بحث في الرسائل..." dir="auto" oninput="performSearch()"><span class="search-count" id="search-count"></span><button class="btn-search-close" onclick="closeSearch()">✕</button>`;
      const header = $('chat-header');
      header.parentNode.insertBefore(bar, header.nextSibling);
      document.getElementById('search-input').focus();
    }

    function closeSearch() {
      searchOpen = false;
      const bar = document.getElementById('search-bar');
      if (bar) bar.remove();
      document.querySelectorAll('.message').forEach(el => {
        el.classList.remove('search-highlight', 'search-dim');
      });
    }

    function performSearch() {
      const query = document.getElementById('search-input').value.trim().toLowerCase();
      const countEl = document.getElementById('search-count');
      if (!query) {
        document.querySelectorAll('.message').forEach(el => el.classList.remove('search-highlight', 'search-dim'));
        if (countEl) countEl.textContent = '';
        return;
      }
      // Only the recent window is loaded up front; pull in older history so
      // search covers the whole conversation, then re-run against everything.
      if (ensureAllLoaded) {
        const pending = ensureAllLoaded;
        ensureAllLoaded = null;
        if (countEl) countEl.textContent = '...';
        pending(() => { if (searchOpen) performSearch(); });
        return;
      }
      let found = 0;
      allMsgElements.forEach(({ el, msg }) => {
        if (msg.deleted) { el.classList.remove('search-highlight', 'search-dim'); return; }
        const text = (msg.type === 'text' ? msg.content : '').toLowerCase();
        if (text.includes(query)) {
          el.classList.add('search-highlight');
          el.classList.remove('search-dim');
          found++;
        } else {
          el.classList.remove('search-highlight');
          el.classList.add('search-dim');
        }
      });
      if (countEl) countEl.textContent = found > 0 ? `${found} نتيجة` : 'لا نتائج';
      const first = document.querySelector('.message.search-highlight');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /* ==========================================================
       SETTINGS & WALLPAPER
    ========================================================== */
    function openSettings() {
      let old = document.getElementById('settings-overlay');
      if (old) { old.remove(); return; }

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const hasWpImg = !!currentWallpaper;

      const overlay = document.createElement('div');
      overlay.id = 'settings-overlay';
      overlay.className = 'settings-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

      overlay.innerHTML = `<div class="settings-panel" onclick="event.stopPropagation()">
        <div class="settings-title">الإعدادات</div>
        <button class="btn-saved-open" onclick="openSavedMessages()">⭐ الرسائل المحفوظة</button>
        <div class="settings-row"><span>الوضع الداكن</span><button class="toggle-switch ${isDark ? 'active' : ''}" id="toggle-dark" onclick="toggleTheme();this.classList.toggle('active')"></button></div>
        <div class="settings-row" style="flex-direction:column;align-items:flex-start"><span>خلفية المحادثة</span>
          <div class="wallpaper-presets">
            <button class="btn-wallpaper-img" onclick="document.getElementById('wp-file-input').click()">📷 ${hasWpImg ? 'تغيير الصورة' : 'اختر صورة من الجهاز'}</button>
          </div>
          ${hasWpImg ? '<button class="btn-wallpaper-reset" onclick="resetWallpaperImg()">إزالة صورة الخلفية</button>' : ''}
          <input type="file" id="wp-file-input" accept="image/*" style="display:none" onchange="setWallpaperImage(this)">
        </div>
        <button class="btn-settings-close" onclick="this.closest('.settings-overlay').remove()">إغلاق</button>
      </div>`;

      document.body.appendChild(overlay);
    }

    function setWallpaperImage(input) {
      const file = input.files[0];
      if (!file) return;
      input.value = '';
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxW = 1080;
          let w = img.width, h = img.height;
          if (w > maxW) { h = Math.round((maxW / w) * h); w = maxW; }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
          try {
            db.ref(`chats/${currentChatId}/wallpaper`).set(dataUrl);
          } catch(e) {
            alert('الصورة كبيرة جداً، اختر صورة أصغر');
            return;
          }
          const settingsOverlay = document.getElementById('settings-overlay');
          if (settingsOverlay) settingsOverlay.remove();
          openSettings();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }

    function resetWallpaperImg() {
      db.ref(`chats/${currentChatId}/wallpaper`).remove();
      const settingsOverlay = document.getElementById('settings-overlay');
      if (settingsOverlay) settingsOverlay.remove();
      openSettings();
    }

    /* ==========================================================
       FORCE UPDATE (PWA)
    ========================================================== */
    function forceUpdate(btn) {
      if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
      caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))).then(() => {
        if ('serviceWorker' in navigator) {
          return navigator.serviceWorker.getRegistration().then(reg => {
            if (reg) return reg.update();
          });
        }
      }).then(() => {
        window.location.reload();
      }).catch(() => {
        window.location.reload();
      });
    }

    /* ==========================================================
       INIT
    ========================================================== */
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(function(reg) {
        reg.addEventListener('updatefound', function() {
          var newWorker = reg.installing;
          newWorker.addEventListener('statechange', function() {
            if (newWorker.state === 'activated') {
              window.location.reload();
            }
          });
        });
        setInterval(function() { reg.update(); }, 60000);
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'SW_UPDATED') {
          window.location.reload();
        }
      });
    }

    ensureMsgInputShim();
    route();
    window.addEventListener('popstate', route);

    // Re-confirm "seen" the moment the user returns to an open chat, so the
    // sender's tick flips to double without waiting for a new message.
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        markSeen();
        // Resume the presence heartbeat when returning to an open chat.
        if (currentChatId && currentUser && db) startPresence();
      } else {
        releaseMic(); // free the mic (and its indicator) when backgrounded
        stopPresence(); // drop "online" while backgrounded
      }
    });
    window.addEventListener('focus', markSeen);
    window.addEventListener('pagehide', function() {
      releaseMic();
      stopPresence();
    });
