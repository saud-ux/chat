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
    if (IS_CONFIGURED) {
      firebase.initializeApp(firebaseConfig);
      db = firebase.database();
    }

    /* ==========================================================
       CONSTANTS
    ========================================================== */
    const CONTACTS = {
      w: { name: 'W', color: '#5B8FB9' },
      aseel: { name: 'أسيل', color: '#E8A87C' }
    };

    const VAPID_PUBLIC_KEY = 'BOIMSoH3ZuHz_eL09w-2cOw7FSGyTTew3q3XlJsuwe4yBvnEbi1ee3mnwz3hOvS4rA_SigRsest_GbV_KgLZPV8';
    const PIN_CODE = 'SAUD_51152';

    const AVATARS = {
      w: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="24" fill="#5B8FB9"/><text x="24" y="31" text-anchor="middle" fill="#fff" font-size="22" font-weight="700" font-family="Arial, sans-serif">W</text></svg>',
      aseel: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="24" fill="#E8A87C"/><text x="24" y="31" text-anchor="middle" fill="#fff" font-size="22" font-weight="700" font-family="Arial, sans-serif">A</text></svg>'
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
    let recTimer = null;
    let recSeconds = 0;
    let recShouldSend = false;
    let recFinalDuration = 0;
    let currentAudioEl = null;
    let currentAudioBtn = null;
    let activeListeners = [];
    let totalUnread = { w: 0, aseel: 0 };
    let isFirstLoad = {};
    let audioCtx = null;
    let myMessages = [];
    let otherSeenTimestamp = 0;
    let editingKey = null;
    let typingTimer = null;
    let typingCheckInterval = null;
    let replyToKey = null;
    let replyToMsg = null;
    let searchOpen = false;
    let allMsgElements = [];
    let knownReactions = {};
    let currentWallpaper = null;

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
    function route() {
      cleanup();
      const path = window.location.pathname.replace(/\/+$/, '') || '/';

      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

      // Dynamic manifest for PWA home screen
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (path === '/w') {
        manifestLink.href = '/manifest-w.json';
        appleTitleMeta.content = 'W';
      } else if (path === '/aseel') {
        manifestLink.href = '/manifest-aseel.json';
        appleTitleMeta.content = 'أسيل';
      } else {
        manifestLink.href = '/manifest.json';
        appleTitleMeta.content = 'رسائل';
      }

      // PIN protection for Saud's routes
      const saudRoutes = ['/', '/index.html', '/chat/w', '/chat/aseel'];
      if (saudRoutes.includes(path) && !isPinVerified()) {
        showPinOverlay();
        return;
      }
      $('pin-overlay').style.display = 'none';

      if (path === '/' || path === '/index.html') {
        currentView = 'home';
        $('page-home').classList.add('active');
        showHome();
      } else if (path === '/chat/w') {
        currentView = 'chat';
        $('page-chat').classList.add('active');
        showChat('w', 'saud');
      } else if (path === '/chat/aseel') {
        currentView = 'chat';
        $('page-chat').classList.add('active');
        showChat('aseel', 'saud');
      } else if (path === '/w') {
        currentView = 'person';
        $('page-chat').classList.add('active');
        showChat('w', 'w');
      } else if (path === '/aseel') {
        currentView = 'person';
        $('page-chat').classList.add('active');
        showChat('aseel', 'aseel');
      } else {
        currentView = 'home';
        $('page-home').classList.add('active');
        showHome();
      }
    }

    function navigate(path, e) {
      if (e) e.preventDefault();
      history.pushState(null, '', path);
      route();
    }

    /* ==========================================================
       CLEANUP LISTENERS
    ========================================================== */
    function cleanup() {
      if (currentChatId && currentUser && db) {
        db.ref(`chats/${currentChatId}/typing/${currentUser}`).remove();
      }
      clearTimeout(typingTimer);
      clearInterval(typingCheckInterval);
      activeListeners.forEach(({ ref, event, cb }) => ref.off(event, cb));
      activeListeners = [];
      clearPendingMedia();
      if (mediaRecorder) stopRecording(false);
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
    function showHome() {
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

      ['w', 'aseel'].forEach(chatId => {
        const card = document.createElement('div');
        card.className = 'chat-card';
        card.id = `card-${chatId}`;
        card.onclick = (e) => navigate(`/chat/${chatId}`, e);
        card.innerHTML = `
          <div class="chat-avatar" style="background:${CONTACTS[chatId].color}">
            ${AVATARS[chatId]}
          </div>
          <div class="chat-info">
            <div class="chat-name">
              <span>${CONTACTS[chatId].name}</span>
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
            $(`preview-${chatId}`).textContent = msgPreview(lastMsg);
            $(`time-${chatId}`).textContent = formatRelative(lastMsg.timestamp);
          }
        });

        updateUnreadForChat(chatId);
      });

      requestNotifPermission();
      listenForHomeNotifications();
    }

    function updateUnreadForChat(chatId) {
      if (!IS_CONFIGURED) return;
      const lastRead = parseInt(localStorage.getItem(`lastRead_saud_${chatId}`) || '0');
      const ref = db.ref(`chats/${chatId}/messages`).orderByChild('timestamp');
      const startRef = lastRead ? ref.startAt(lastRead + 1) : ref;

      addListener(startRef, 'value', snap => {
        let count = 0;
        snap.forEach(child => {
          if (child.val().sender !== 'saud') count++;
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

    function listenForHomeNotifications() {
      ['w', 'aseel'].forEach(chatId => {
        const ref = db.ref(`chats/${chatId}/messages`).orderByChild('timestamp').limitToLast(1);
        let initial = true;
        addListener(ref, 'child_added', snap => {
          if (initial) { initial = false; return; }
          const msg = snap.val();
          if (msg.sender !== 'saud') {
            notify(chatId, CONTACTS[chatId].name, msgPreview(msg));
          }
        });
      });
    }

    function msgPreview(msg) {
      if (msg.type === 'image') return '📷 صورة';
      if (msg.type === 'gif') return '🎞️ GIF';
      if (msg.type === 'video') return '🎥 فيديو';
      if (msg.type === 'audio') return '🎤 رسالة صوتية';
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
      const partnerName = isSaud ? CONTACTS[chatId].name : 'سعود';
      const partnerColor = isSaud ? CONTACTS[chatId].color : '#5B8FB9';
      const partnerAvatar = isSaud ? AVATARS[chatId] :
        '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="24" fill="#5B8FB9"/><text x="24" y="31" text-anchor="middle" fill="#fff" font-size="20" font-weight="700" font-family="Arial, sans-serif">س</text></svg>';

      const themeIcon = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
      $('chat-header').innerHTML = `
        ${isSaud ? '<button class="btn-back" onclick="navigate(\'/\')">→</button>' : ''}
        <div class="chat-header-avatar" style="background:${partnerColor}">
          ${partnerAvatar}
        </div>
        <span class="chat-header-name">${partnerName}</span>
        <div style="display:flex;gap:2px;margin-right:auto;align-items:center">
          <button class="btn-theme" onclick="toggleSearch()" aria-label="بحث">🔍</button>
          <button class="btn-theme" id="btn-theme" onclick="toggleTheme()" aria-label="الوضع">${themeIcon}</button>
          <button class="btn-theme" onclick="openSettings()" aria-label="إعدادات">⚙️</button>
          <button class="btn-refresh" onclick="forceUpdate(this)" aria-label="تحديث">🔄</button>
          ${isSaud ? `<button class="btn-theme" onclick="clearChat('${chatId}')" aria-label="حذف الكل">🗑️</button>` : ''}
        </div>`;

      const area = $('messages-area');
      area.innerHTML = '';

      area.addEventListener('scroll', () => {
        const btn = $('btn-scroll-bottom');
        if (!btn) return;
        const distFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
        btn.classList.toggle('visible', distFromBottom > 150);
      });

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

      const ref = db.ref(`chats/${chatId}/messages`).orderByChild('timestamp');
      let lastDateStr = '';

      addListener(ref, 'child_added', snap => {
        const msg = snap.val();
        const isMine = msg.sender === user;

        const msgDate = new Date(msg.timestamp);
        const dateStr = msgDate.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
        if (dateStr !== lastDateStr) {
          lastDateStr = dateStr;
          const sep = document.createElement('div');
          sep.className = 'date-separator';
          sep.innerHTML = `<span>${dateStr}</span>`;
          area.appendChild(sep);
        }

        const el = document.createElement('div');
        el.className = `message ${isMine ? 'message-mine' : 'message-theirs'}`;
        el.dataset.key = snap.key;
        el.dataset.type = msg.type;

        renderMsgContent(el, msg, isMine);
        area.appendChild(el);
        allMsgElements.push({ el, key: snap.key, msg });
        knownReactions[snap.key] = msg.reactions ? JSON.parse(JSON.stringify(msg.reactions)) : {};

        if (isMine && !msg.deleted) {
          myMessages.push({ el, timestamp: msg.timestamp });
          updateSeenIndicator();
          addTapGestures(el, () => { burstHearts(el); addReaction(snap.key, '❤️'); }, () => showMsgActions(snap.key, msg.type, true));
          addLongPress(el, () => showMsgActions(snap.key, msg.type, true));
          addSwipeReply(el, snap.key);
        } else if (!isMine) {
          if (!isFirstLoad[chatId]) {
            db.ref(`chats/${chatId}/seen/${user}`).set(firebase.database.ServerValue.TIMESTAMP);
          }
          if (!msg.deleted) {
            addTapGestures(el, () => { burstHearts(el); addReaction(snap.key, '❤️'); }, () => showMsgActions(snap.key, msg.type, false));
            addLongPress(el, () => showMsgActions(snap.key, msg.type, false));
            addSwipeReply(el, snap.key);
          }
        }

        if (isFirstLoad[chatId]) {
          scrollToBottom(false);
        } else {
          scrollToBottom(true);
          if (!isMine) {
            const name = user === 'saud' ? CONTACTS[chatId].name : 'سعود';
            notify(chatId, name, msgPreview(msg));
          }
        }
      });

      addListener(ref, 'child_changed', snap => {
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
        if (msg.deleted && isMine) {
          myMessages = myMessages.filter(m => m.el !== el);
          updateSeenIndicator();
        }
      });

      addListener(ref, 'child_removed', snap => {
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
        delete knownReactions[snap.key];
        updateSeenIndicator();
      });

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
      });

      if (isSaud) {
        const markRef = db.ref(`chats/${chatId}/messages`).orderByChild('timestamp');
        addListener(markRef, 'child_added', () => {
          localStorage.setItem(`lastRead_saud_${chatId}`, Date.now().toString());
        });
      }

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
          if (file.size > 50 * 1024 * 1024) {
            overlay.style.display = 'none';
            alert('الملف كبير جداً. الحد الأقصى ٥٠ ميغابايت.');
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
      let stream;
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
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (e) {
        // Fall back to plain audio if the device rejects the constraints
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e2) {
          alert('تعذّر الوصول للميكروفون. تأكد من السماح بالإذن.');
          return;
        }
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

    function stopStream() {
      if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
    }

    function stopRecording(send) {
      if (!mediaRecorder) return;
      recShouldSend = send;
      recFinalDuration = recSeconds;
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
      try { mediaRecorder.stop(); } catch (e) {}
      stopStream();
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

    function resetAudioBtn(btn) {
      if (!btn) return;
      btn.textContent = '▶';
      const wrap = btn.closest('.msg-audio');
      if (wrap) {
        const p = wrap.querySelector('.audio-progress');
        if (p) p.style.width = '0%';
      }
    }

    function toggleAudioPlay(btn) {
      const wrap = btn.closest('.msg-audio');
      if (!wrap) return;
      const progress = wrap.querySelector('.audio-progress');
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
      currentAudioEl = audio;
      currentAudioBtn = btn;

      audio.onplay = () => { btn.textContent = '⏸'; };
      audio.onpause = () => { if (currentAudioBtn === btn) btn.textContent = '▶'; };
      audio.onended = () => { btn.textContent = '▶'; if (progress) progress.style.width = '0%'; };
      audio.ontimeupdate = () => {
        const d = (audio.duration && isFinite(audio.duration)) ? audio.duration : storedDur;
        if (d && progress) progress.style.width = Math.min(100, (audio.currentTime / d) * 100) + '%';
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
          const maxDim = 640;
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

          const stream = canvas.captureStream(24);
          try {
            const audioCtx2 = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx2.createMediaElementSource(video);
            const dest = audioCtx2.createMediaStreamDestination();
            source.connect(dest);
            dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
          } catch(e) {}

          const recorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: 600000
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
    function openViewer(src) {
      const viewer = $('image-viewer');
      $('viewer-img').src = src;
      viewer.style.display = 'flex';
    }

    $('btn-viewer-close').onclick = () => $('image-viewer').style.display = 'none';
    $('image-viewer').onclick = (e) => {
      if (e.target === $('image-viewer')) $('image-viewer').style.display = 'none';
    };

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
        navigate(`/chat/${toastChatId}`);
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
        const rText = msg.replyTo.type === 'image' ? '📷 صورة' : msg.replyTo.type === 'gif' ? '🎞️ GIF' : msg.replyTo.type === 'video' ? '🎥 فيديو' : msg.replyTo.type === 'audio' ? '🎤 رسالة صوتية' : escapeHtml(msg.replyTo.text || '');
        replyHtml = `<div class="msg-reply-quote" onclick="scrollToMessage('${escapeAttr(msg.replyTo.key)}')"><div class="msg-reply-name">${rName}</div><span class="msg-reply-text">${rText}</span></div>`;
      }
      let content = '';
      if (msg.type === 'image') {
        content = `<img class="msg-image" src="${escapeAttr(msg.content)}" alt="صورة" loading="lazy" onclick="openViewer('${escapeAttr(msg.content)}')">`;
      } else if (msg.type === 'gif') {
        content = `<div class="msg-gif-wrap"><img class="msg-gif" src="${escapeAttr(msg.content)}" alt="GIF" loading="lazy" onclick="openViewer('${escapeAttr(msg.content)}')"><span class="msg-gif-tag">GIF</span></div>`;
      } else if (msg.type === 'video') {
        content = `<video class="msg-video" src="${escapeAttr(msg.content)}" controls playsinline preload="metadata"></video>`;
      } else if (msg.type === 'audio') {
        content = `<div class="msg-audio" data-audio="${escapeAttr(msg.content)}" data-dur="${msg.duration || 0}"><button class="audio-play" onclick="toggleAudioPlay(this)">▶</button><div class="audio-body"><div class="audio-wave" onclick="seekAudio(event, this)"><div class="audio-progress"></div></div><span class="audio-dur">${formatDur(msg.duration || 0)}</span></div></div>`;
      } else {
        content = `<div class="msg-text">${escapeHtml(msg.content)}</div>`;
      }
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
      el.innerHTML = replyHtml + content + reactionsHtml + `<div class="msg-time">${editedTag}${formatTime(msg.timestamp)}${statusHtml}</div>`;
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

    function showMsgActions(key, msgType, canEdit) {
      let html = '';
      html += `<button class="msg-action-btn" onclick="setReply('${key}')">↩️ رد</button>`;
      html += `<button class="msg-action-btn" onclick="hideMsgActions();openReactionPicker('${key}')">😀 تفاعل</button>`;
      if (msgType === 'text') {
        html += `<button class="msg-action-btn" onclick="copyMessage('${key}')">📋 نسخ</button>`;
      }
      if (canEdit && msgType === 'text') {
        html += `<button class="msg-action-btn" onclick="editMessage('${key}')">✏️ تعديل</button>`;
      }
      html += `<button class="msg-action-btn danger" onclick="deleteMessage('${key}')">🗑️ حذف</button>`;
      html += `<button class="msg-action-btn msg-action-cancel" onclick="hideMsgActions()">إلغاء</button>`;
      $('msg-actions-content').innerHTML = html;
      $('msg-actions-overlay').style.display = 'flex';
    }

    function hideMsgActions() {
      $('msg-actions-overlay').style.display = 'none';
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
      const userId = currentUser || inferUserId();
      if (!userId) return;
      const subData = sub.toJSON();
      const subKey = btoa(subData.endpoint).replace(/[.#$\[\]\/]/g, '_').substring(0, 100);
      db.ref(`push-subscriptions/${userId}/${subKey}`).set(subData);
    }

    function inferUserId() {
      const path = window.location.pathname.replace(/\/+$/, '') || '/';
      if (path === '/w') return 'w';
      if (path === '/aseel') return 'aseel';
      if (path === '/' || path.startsWith('/chat/')) return 'saud';
      return null;
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
      if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
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
      if (!el) return;
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
      if (!document.hidden) markSeen();
    });
    window.addEventListener('focus', markSeen);
