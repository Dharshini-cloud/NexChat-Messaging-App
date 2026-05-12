let firebaseConfig = {};

async function initializeAppConfig() {
    try {
        const response = await fetch('/api/config/firebase');
        firebaseConfig = await response.json();
        
        if (firebaseConfig && firebaseConfig.apiKey) {
            firebase.initializeApp(firebaseConfig);
        }
    } catch (err) {
        console.error('Failed to load Firebase config:', err);
    }
}


class NexChatApp {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.token = localStorage.getItem('token');
        this.currentConversation = null;
        this.currentTargetUser = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.selectedFile = null;
        this.notificationPermission = false;
        this.allContacts = [];
        this.chatMessages = [];
        this.onlineUsers = [];
        this.replyingTo = null;
        this.unreadCounts = {};     // username -> count
        this.lastMessageData = {};   // username -> { preview, time }
        this.starredMessages = [];
        this.contextMenuMsg = null;
        this.reactingToMsgId = null;
        this.lastSeenMap = {};
        this.pinnedMsgId = null;
        this.isLoggingIn = false;
        
        // Calling State
        this.pc = null;
        this.localStream = null;
        this.remoteStream = null;
        this.currentCall = null; // { partner, type, isIncoming }
        this.callStartTime = null;
        this.callInterval = null;
        this.iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

        // Restore saved theme before rendering
        const savedTheme = localStorage.getItem('nexchat-theme') || 'dark';
        document.body.setAttribute('data-theme', savedTheme);

        this.initDOM();
        this.attachEvents();
        this.initCallingUI();
        this.checkAuth();
        this.requestNotificationPermission();
        this.updateThemeIcon(); // Sync icon on load
    }

    initDOM() {
        // Screens
        this.authScreen = document.getElementById('authScreen');
        this.workspace = document.getElementById('mainWorkspace');
        this.welcomeScreen = document.getElementById('welcomeScreen');
        this.activeChat = document.getElementById('activeChat');
        
        // Forms
        this.loginForm = document.getElementById('loginForm');
        this.registerForm = document.getElementById('registerForm');
        this.authError = document.getElementById('authError');
        
        // Toggles
        document.getElementById('showRegister').addEventListener('click', () => this.toggleAuthForms());
        document.getElementById('showLogin').addEventListener('click', () => this.toggleAuthForms());
        // Theme toggle moved to attachEvents as themeToggleNav
        document.getElementById('mobileBackBtn').addEventListener('click', () => this.workspace.classList.remove('chat-opened'));
        
        // Elements
        this.messagesWrap = document.getElementById('messagesWrap');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.recordBtn = document.getElementById('recordBtn');
        this.cancelRecordBtn = document.getElementById('cancelRecordBtn');
        this.emojiBtn = document.getElementById('emojiBtn');
        this.emojiWrapper = document.getElementById('emojiPickerWrapper');
        this.attachBtn = document.getElementById('attachBtn');
        this.attachDropdown = document.getElementById('attachDropdown');
        this.fileUpload = document.getElementById('fileUpload');
        this.mediaPreview = document.getElementById('mediaPreview');
        this.cancelMediaBtn = document.getElementById('cancelMediaBtn');
        
        // Reply Preview
        this.replyPreviewContainer = document.getElementById('replyPreviewContainer');
        this.replyPreviewName = document.getElementById('replyPreviewName');
        this.replyPreviewText = document.getElementById('replyPreviewText');
        this.cancelReplyBtn = document.getElementById('cancelReplyBtn');
        
        // Header Status
        this.partnerStatus = document.getElementById('partnerStatus');
        this.partnerTyping = document.getElementById('partnerTyping');
        
        // Scroll to bottom
        this.scrollBottomBtn = document.getElementById('scrollBottomBtn');
        
        this.contactsList = document.getElementById('contactsList');
        this.searchInput = document.getElementById('searchInput');
        
        // Message Search
        this.msgSearchBtn = document.getElementById('msgSearchBtn');
        this.msgSearchContainer = document.getElementById('msgSearchContainer');
        this.msgSearchInput = document.getElementById('msgSearchInput');
        this.closeMsgSearch = document.getElementById('closeMsgSearch');

        // Setup Emoji Picker
        const emojiPicker = document.querySelector('emoji-picker');
        if (emojiPicker) {
            emojiPicker.addEventListener('emoji-click', event => {
                if (this.reactingToMsgId) {
                    this.addReaction(this.reactingToMsgId, event.detail.unicode);
                    this.reactingToMsgId = null;
                    this.emojiWrapper.classList.add('hidden');
                } else {
                    this.messageInput.value += event.detail.unicode;
                    this.handleInput();
                }
            });
        }

        // New feature elements
        this.contextMenu = document.getElementById('contextMenu');
        this.lightbox = document.getElementById('lightbox');
        this.lightboxImg = document.getElementById('lightboxImg');
        this.starredModal = document.getElementById('starredModal');
        this.starredList = document.getElementById('starredList');
        this.forwardModal = document.getElementById('forwardModal');
        this.forwardContactsList = document.getElementById('forwardContactsList');
        this.forwardSearch = document.getElementById('forwardSearch');
        this.pinnedMsgHeader = document.getElementById('pinnedMsgHeader');
        this.pinnedMsgText = document.getElementById('pinnedMsgText');
        this.unpinBtn = document.getElementById('unpinBtn');

        // Resizers
        this.sidebarResizer = document.getElementById('sidebarResizer');
        this.infoResizer = document.getElementById('infoResizer');
        this.initResizers();

        // Set initial theme icon
        this.updateThemeIcon();
    }

    attachEvents() {
        this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        this.registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        document.getElementById('googleLoginBtn').addEventListener('click', () => this.handleGoogleLogin());
        
        // Navigation Sidebar Events
        const starredBtn = document.getElementById('starredMsgsBtnNav');
        if (starredBtn) starredBtn.addEventListener('click', () => this.fetchStarredMessages());
        
        const themeBtn = document.getElementById('themeToggleNav');
        if (themeBtn) themeBtn.addEventListener('click', () => this.toggleTheme());
        
        const logoutBtn = document.getElementById('logoutBtnNav');
        if (logoutBtn) logoutBtn.addEventListener('click', () => this.logout());

        document.getElementById('forgotPasswordLink').addEventListener('click', () => {
            document.getElementById('forgotPasswordModal').classList.remove('hidden');
        });

        this.messageInput.addEventListener('input', () => this.handleInput());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        this.emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.attachDropdown) this.attachDropdown.classList.add('hidden');
            this.emojiWrapper.classList.toggle('hidden');
        });

        const advancedPicker = document.getElementById('advancedEmojiPicker');
        if (advancedPicker) {
            advancedPicker.addEventListener('emoji-click', (event) => {
                this.addEmoji(event.detail.unicode);
            });
        }

        // Attachment dropdown toggle
        this.attachBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.emojiWrapper) this.emojiWrapper.classList.add('hidden');
            this.attachDropdown.classList.toggle('hidden');
        });

        // Attachment options
        document.querySelectorAll('.attach-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                const action = opt.dataset.action;
                this.attachDropdown.classList.add('hidden');
                this.handleAttachAction(action);
            });
        });

        // Close dropdown when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (this.attachBtn && !this.attachBtn.contains(e.target)) {
                this.attachDropdown.classList.add('hidden');
            }
            if (this.emojiBtn && !this.emojiBtn.contains(e.target) && !this.emojiWrapper.contains(e.target)) {
                this.emojiWrapper.classList.add('hidden');
            }
        });

        // Settings avatar — live preview before saving
        const settingsUpload = document.getElementById('settingsAvatarUpload');
        if (settingsUpload) {
            settingsUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    document.getElementById('settingsAvatarPreview').src = ev.target.result;
                };
                reader.readAsDataURL(file);
            });
        }

        // Contact info panel — search button opens in-chat search
        const infoSearchBtn = document.getElementById('infoSearchBtn');
        if (infoSearchBtn) {
            infoSearchBtn.addEventListener('click', () => {
                document.getElementById('contactInfoPanel').classList.add('hidden');
                this.msgSearchContainer.classList.remove('hidden');
                this.msgSearchInput.focus();
            });
        }

        const infoStarredBtn = document.getElementById('infoStarredMsgs');
        if (infoStarredBtn) {
            infoStarredBtn.addEventListener('click', () => {
                if (this.currentTargetUser) {
                    this.fetchStarredMessages(this.currentTargetUser);
                }
            });
        }

        this.fileUpload.addEventListener('change', (e) => this.handleFileSelect(e));
        this.cancelMediaBtn.addEventListener('click', () => this.clearMediaPreview());
        this.cancelReplyBtn.addEventListener('click', () => this.cancelReply());

        // Voice Recording - click to start/stop toggle
        this.recordBtn.addEventListener('click', () => this.toggleRecording());
        if (this.cancelRecordBtn) {
            this.cancelRecordBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.cancelRecording();
            });
        }

        // Search Events
        this.searchInput.addEventListener('input', (e) => this.filterContacts(e.target.value));
        this.msgSearchBtn.addEventListener('click', () => {
            this.msgSearchContainer.classList.toggle('hidden');
            if (!this.msgSearchContainer.classList.contains('hidden')) this.msgSearchInput.focus();
        });
        this.closeMsgSearch.addEventListener('click', () => {
            this.msgSearchContainer.classList.add('hidden');
            this.msgSearchInput.value = '';
            this.filterMessages('');
        });
        this.msgSearchInput.addEventListener('input', (e) => this.filterMessages(e.target.value));

        // Scroll to bottom button
        this.scrollBottomBtn.addEventListener('click', () => this.scrollToBottom());
        this.messagesWrap.addEventListener('scroll', () => this.handleScrollPosition());

        // Contact Info Panel
        document.getElementById('closeInfoPanel').addEventListener('click', () => {
            document.getElementById('contactInfoPanel').classList.add('hidden');
        });

        // WhatsApp Features
        // document.getElementById('starredMsgsBtn').addEventListener('click', () => this.fetchStarredMessages()); // Moved to Nav
        this.forwardSearch.addEventListener('input', (e) => this.filterForwardContacts(e.target.value));
        
        document.querySelector('.lightbox-close').addEventListener('click', () => this.lightbox.classList.add('hidden'));
        this.lightbox.addEventListener('click', (e) => { if(e.target === this.lightbox) this.lightbox.classList.add('hidden'); });

        this.unpinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pinMessage(this.pinnedMsgId); // will toggle it off
        });
        this.pinnedMsgHeader.addEventListener('click', () => {
            const el = document.querySelector(`[data-id="${this.pinnedMsgId}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        // Global clicks
        document.addEventListener('click', (e) => {
            this.contextMenu.classList.add('hidden');
            
            // Close all reaction menus if click is outside
            if (!e.target.closest('.action-btn') && !e.target.closest('.reaction-menu')) {
                document.querySelectorAll('.reaction-menu.active').forEach(m => m.classList.remove('active'));
            }

            // Close emoji picker if click is outside
            if (!e.target.closest('.emoji-wrapper') && !e.target.closest('.action-btn') && !e.target.closest('.emoji-trigger')) {
                this.emojiWrapper.classList.add('hidden');
            }

            // Close mobile dropdown if click is outside
            const mobileDropdown = document.getElementById('mobileDropdown');
            const mobileMenuBtn = document.getElementById('mobileMenuBtn');
            if (mobileDropdown && !mobileDropdown.classList.contains('hidden')) {
                if (!e.target.closest('#mobileDropdown') && !e.target.closest('#mobileMenuBtn')) {
                    mobileDropdown.classList.add('hidden');
                }
            }
        });
        document.addEventListener('contextmenu', (e) => {
            if (!e.target.closest('.msg-bubble')) {
                this.contextMenu.classList.add('hidden');
            }
        });
    }

    // =========================================
    //  MOBILE UI HANDLERS
    // =========================================
    initMobileMenu() {
        const mobileStarred = document.getElementById('mobileStarredBtn');
        const mobileTheme   = document.getElementById('mobileThemeBtn');
        const mobileLogout  = document.getElementById('mobileLogoutBtn');

        if (mobileStarred) mobileStarred.addEventListener('click', () => {
            document.getElementById('mobileDropdown').classList.add('hidden');
            document.getElementById('starredMsgsBtnNav').click();
        });
        if (mobileTheme) mobileTheme.addEventListener('click', () => {
            this.toggleTheme();
            document.getElementById('mobileDropdown').classList.add('hidden');
        });
        if (mobileLogout) mobileLogout.addEventListener('click', () => {
            document.getElementById('mobileDropdown').classList.add('hidden');
            this.logout();
        });
    }

    toggleMobileMenu() {
        const dropdown = document.getElementById('mobileDropdown');
        if (dropdown) dropdown.classList.toggle('hidden');
    }

    switchMobileTab(tab, btn) {
        // Update bottom nav active state
        document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');

        // Delegate to the main switchNavTab logic
        this.switchNavTab(tab, null);
    }

    // =========================================
    //  THEME TOGGLE
    // =========================================
    toggleTheme() {
        const body = document.body;
        const currentTheme = body.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        body.setAttribute('data-theme', newTheme);
        localStorage.setItem('nexchat-theme', newTheme); // Persist across sessions
        const emojiPicker = document.querySelector('emoji-picker');
        if (emojiPicker) emojiPicker.className = newTheme;
        this.updateThemeIcon();
    }

    updateThemeIcon() {
        const theme = document.body.getAttribute('data-theme') || 'dark';
        // Desktop icon
        const icon = document.querySelector('#themeToggleNav i');
        if (icon) {
            icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
        // Mobile dropdown icon + label
        const mobileIcon  = document.getElementById('mobileThemeIcon');
        const mobileLabel = document.getElementById('mobileThemeLabel');
        if (mobileIcon)  mobileIcon.className  = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        if (mobileLabel) mobileLabel.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    }

    // =========================================
    //  AUTH
    // =========================================
    requestNotificationPermission() {
        if ("Notification" in window) {
            Notification.requestPermission().then(permission => {
                this.notificationPermission = permission === "granted";
            });
        }
    }


    addEmoji(emoji) {
        this.messageInput.value += emoji;
        this.messageInput.focus();
        this.emojiWrapper.classList.add('hidden');
    }

    showToast(title, body, msgId = null) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        
        let jumpBtn = '';
        if (msgId) {
            jumpBtn = `<button class="btn-toast" onclick="nexChat.jumpToMsg('${msgId}')">Jump to Game</button>`;
        }

        toast.innerHTML = `
            <i class="fas fa-bell" style="color: var(--accent)"></i>
            <div>
                <strong>${this.escapeHtml(title)}</strong>
                <p style="font-size:0.85rem; margin:0">${this.escapeHtml(body)}</p>
                ${jumpBtn}
            </div>
        `;

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 4500);

        if (this.notificationPermission) {
            if (document.hidden || title !== this.currentTargetUser) {
                new Notification(title, { body: body, icon: '/favicon.ico' });
            }
        }
    }

    toggleAuthForms() {
        this.loginForm.classList.toggle('hidden');
        this.loginForm.classList.toggle('active');
        this.registerForm.classList.toggle('hidden');
        this.registerForm.classList.toggle('active');
        this.authError.classList.add('hidden');
    }

    async handleRegister(e) {
        e.preventDefault();
        const username = document.getElementById('regUsername').value;
        const email = document.getElementById('regEmail').value;
        const password = document.getElementById('regPassword').value;

        if (password.length < 8) {
            return this.showError('Password must be at least 8 characters long');
        }

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            const data = await res.json();
            if(!res.ok) throw new Error(data.error);
            this.finalizeLogin(data);
        } catch (err) {
            this.showError(err.message);
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        console.log(`🔑 Attempting login for: ${email}`);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            
            if(!res.ok) {
                console.error('❌ Login failed:', data.error);
                throw new Error(data.error);
            }
            
            console.log('✅ Login successful!');
            this.finalizeLogin(data);
        } catch (err) {
            this.showError(err.message);
        }
    }

    async handleGoogleLogin() {
        console.log('🚀 handleGoogleLogin triggered');
        if (!firebase.apps.length) {
            console.error('❌ Firebase apps length is 0');
            return this.showError('Firebase not configured. Check your API keys.');
        }
        if (this.isLoggingIn) return;
        this.isLoggingIn = true;
        
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            console.log('🚀 Starting Firebase Google Login popup...');
            const result = await firebase.auth().signInWithPopup(provider);
            const user = result.user;
            console.log('✅ Firebase Auth Success:', user.email);
            this.showToast('Auth Success', 'Connecting to NexChat server...');
            
            console.log('🔗 Fetching NexChat Google Auth endpoint...');
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL
                })
            });
            const data = await res.json();
            this.isLoggingIn = false;
            
            if(!res.ok) throw new Error(data.error || 'Server rejected Google login');
            this.finalizeLogin(data);
        } catch (error) {
            this.isLoggingIn = false;
            this.showError('Login Failed: ' + error.message);
        }
    }

    finalizeLogin(data) {
        this.token = data.token;
        this.currentUser = data.username;
        this.favorites = data.favorites || [];
        localStorage.setItem('token', this.token);
        localStorage.setItem('username', this.currentUser);
        localStorage.setItem('avatarUrl', data.avatarUrl || '');
        localStorage.setItem('favorites', JSON.stringify(this.favorites));
        this.initAuthenticatedArea();
    }

    checkAuth() {
        if (this.token) {
            this.currentUser = localStorage.getItem('username');
            try { this.favorites = JSON.parse(localStorage.getItem('favorites')) || []; } catch(e){ this.favorites = []; }
            this.initAuthenticatedArea();
        }
    }

    logout() {
        if (this.currentCall) {
            const confirmed = confirm('You are currently in a call. Do you want to end the call and logout?');
            if (!confirmed) return;
            this.terminateCall('ended');
        }
        localStorage.clear();
        window.location.reload();
    }

    showError(msg) {
        this.authError.textContent = msg;
        this.authError.classList.remove('hidden');
    }

    initAuthenticatedArea() {
        // Add a smooth fade-out to the auth screen
        this.authScreen.style.transition = 'opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
        this.authScreen.style.opacity = '0';
        
        setTimeout(() => {
            this.authScreen.classList.remove('active');
            this.authScreen.classList.add('hidden');
            
            this.workspace.classList.remove('hidden');
            this.workspace.style.opacity = '0';
            this.workspace.style.transform = 'scale(0.98)';
            this.workspace.style.transition = 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
            
            requestAnimationFrame(() => {
                this.workspace.classList.add('active');
                this.workspace.style.opacity = '1';
                this.workspace.style.transform = 'scale(1)';
            });
        }, 400);
        
        document.getElementById('myUsername').textContent = this.currentUser;
        const myAvatar = localStorage.getItem('avatarUrl');
        if (myAvatar) {
            document.getElementById('myAvatar').src = myAvatar;
            const sidebarAvatar = document.getElementById('sidebarUserAvatar');
            if (sidebarAvatar) sidebarAvatar.src = myAvatar;
        }

        this.connectSocket();
        this.fetchContacts();
        this.initMobileMenu();
        this.updateThemeIcon(); // Sync mobile theme label on load
    }

    // =========================================
    //  SOCKET
    // =========================================
    connectSocket() {
        this.socket = io({ auth: { token: this.token } });
        this.initCallingSocketListeners();

        this.socket.on('connect_error', (err) => {
            console.error('Socket Auth Error:', err.message);
            this.logout();
        });

        this.socket.on('active_users', users => {
            // Support both old (string[]) and new (object[]) format
            if (users.length > 0 && typeof users[0] === 'string') {
                this.onlineUsers = users;
                this.lastSeenMap = {};
            } else {
                this.onlineUsers = users.filter(u => u.online).map(u => u.username);
                this.lastSeenMap = {};
                users.filter(u => !u.online && u.lastSeen).forEach(u => {
                    this.lastSeenMap[u.username] = new Date(u.lastSeen);
                });
            }
            this.updateHeaderStatus();
            this.renderContactsWrapper();
        });

        // Reconnection handling
        this.socket.on('disconnect', (reason) => {
            this.showConnectionStatus('Reconnecting...', 'warn');
        });
        this.socket.on('reconnect', () => {
            this.showConnectionStatus('Connected', 'ok');
            // Re-join conversation room after reconnect
            if (this.currentConversation && this.currentTargetUser) {
                this.socket.emit('start_conversation', { targetUser: this.currentTargetUser, limit: 0 });
            }
        });
        this.socket.on('reconnect_failed', () => {
            this.showConnectionStatus('Connection lost. Refresh the page.', 'error');
        });

        // Bulk delivery update (when someone comes online)
        this.socket.on('bulk_delivered', (data) => {
            // Update all sent message ticks if they were going to that user
            if (this.currentTargetUser === data.receiver) {
                document.querySelectorAll('.status-tick:not(.read)').forEach(tick => {
                    tick.innerHTML = '<i class="fas fa-check-double"></i>';
                    tick.title = 'Delivered';
                    tick.style.color = 'rgba(255,255,255,0.7)';
                });
            }
        });

        
        this.socket.on('ttt_updated', (data) => this.handleTTTUpdate(data));
        this.socket.on('rps_updated', (data) => this.handleRPSUpdate(data));
        this.socket.on('guess_updated', (data) => this.handleGuessUpdate(data));
        // ↑ No duplicate listener for guess_updated
        
        this.socket.on('conversation_started', data => this.setupChat(data));

        this.socket.on('profile_updated', data => {
            // Update contact in allContacts array
            const contact = this.allContacts.find(c => c.username === data.username || c.username === data.oldName);
            if (contact) {
                contact.username = data.username;
                contact.avatarUrl = data.avatarUrl;
                this.renderContactsWrapper();
            }
            // If current chat partner updated, update header
            if (this.currentTargetUser === data.username || this.currentTargetUser === data.oldName) {
                this.currentTargetUser = data.username;
                document.getElementById('partnerName').textContent = data.username;
                document.getElementById('partnerAvatar').src = data.avatarUrl;
            }
        });
        
        this.socket.on('more_messages_loaded', data => {
            if (data.conversationId !== this.currentConversation) return;
            this.isFetchingMessages = false;
            this.hasMoreMessages = data.hasMore;
            
            this.chatMessages = [...data.messages, ...this.chatMessages];
            
            data.messages.slice().reverse().forEach(msg => this.renderMessage(msg, true));
            
            // Restore scroll position
            this.messagesWrap.scrollTop = this.messagesWrap.scrollHeight - this.previousScrollHeight;
        });
        
        this.socket.on('new_message', msg => {
            const contactKey = msg.from === this.currentUser ? msg.to : msg.from;
            // Track last message data for sidebar timestamps
            const previewText = msg.type === 'text' ? (msg.message || '') : `📎 ${msg.type}`;
            this.lastMessageData[contactKey] = { preview: previewText, time: new Date(msg.date || Date.now()) };

            if (msg.from !== this.currentUser && this.currentTargetUser !== msg.from) {
                this.showToast(msg.from, msg.type === 'text' ? msg.message : `Sent a ${msg.type}`);
                this.unreadCounts[msg.from] = (this.unreadCounts[msg.from] || 0) + 1;
                this.playNotificationSound();
                this.updatePageTitle();
            }
            if (msg.conversationId === this.currentConversation) {
                // De-duplicate: remove the optimistic render if id matches a temp id
                const tempEl = document.querySelector('[data-temp="true"]');
                if (tempEl && msg.from === this.currentUser) tempEl.remove();

                this.chatMessages.push(msg);
                this.renderMessage(msg);
            }
            // Update contact preview in sidebar and RE-SORT
            this.updateContactPreview(msg.from === this.currentUser ? msg.to : msg.from, msg);
            this.renderContactsWrapper();
        });

        this.socket.on('message_starred', data => {
            const { messageId, starred } = data;
            const msg = this.chatMessages.find(m => m.id === messageId);
            if (msg) msg.starred = starred;
            const el = document.querySelector(`[data-id="${messageId}"]`);
            if (el) this.updateStarUI(el, starred.includes(this.currentUser));
        });

        this.socket.on('message_pinned', data => {
            const { messageId, pinned, text } = data;
            this.updatePinnedHeader(pinned ? { id: messageId, text } : null);
            // Refresh message UI if it's visible to show/hide pin icon
            const msg = this.chatMessages.find(m => m.id === messageId);
            if(msg) msg.pinned = pinned;
            const el = document.querySelector(`[data-id="${messageId}"]`);
            if (el) {
                const bubble = el.querySelector('.msg-bubble');
                let pinIcon = bubble.querySelector('.msg-pin-icon');
                if (pinned && !pinIcon) {
                    bubble.insertAdjacentHTML('beforeend', '<i class="fas fa-thumbtack msg-pin-icon" style="font-size:0.7rem; margin-left:5px; opacity:0.6;"></i>');
                } else if (!pinned && pinIcon) {
                    pinIcon.remove();
                }
            }
        });

        this.socket.on('forward_success', data => {
            this.showToast('Forwarded', `Message sent to ${data.toUser}`);
        });
        
        this.socket.on('user_typing', data => {
            if (data.username === this.currentTargetUser) {
                if (data.isTyping) {
                    this.partnerTyping.classList.remove('hidden');
                    this.partnerStatus.classList.add('hidden');
                } else {
                    this.partnerTyping.classList.add('hidden');
                    this.partnerStatus.classList.remove('hidden');
                }
            }
        });

        this.socket.on('messages_read', data => {
            if (data.conversationId === this.currentConversation) {
                document.querySelectorAll('.status-tick').forEach(tick => {
                    tick.classList.add('read');
                    tick.innerHTML = '<i class="fas fa-check-double"></i>';
                });
            }
        });

        this.socket.on('reaction_added', data => {
            const { messageId, reactions } = data;
            const msgEl = document.querySelector(`[data-id="${messageId}"]`);
            if (msgEl) this.updateReactions(msgEl, reactions);
        });

        this.socket.on('poll_updated', data => {
            const { messageId, pollData } = data;
            const msgEl = document.querySelector(`[data-id="${messageId}"]`);
            if (msgEl) this.updatePollUI(msgEl, pollData, messageId);
        });

        this.socket.on('message_deleted', data => {
            const { messageId } = data;
            const msgEl = document.querySelector(`[data-id="${messageId}"]`);
            if (msgEl) {
                msgEl.querySelector('.msg-bubble').innerHTML = '<i class="fas fa-ban" style="font-size:0.85rem; opacity:0.6;"></i> <span style="font-style:italic; opacity:0.6; font-size:0.85rem;">This message was deleted</span>';
                msgEl.querySelectorAll('.action-btn').forEach(btn => btn.style.display = 'none');
            }
        });
    }

    // =========================================
    //  HEADER STATUS
    // =========================================
    updateHeaderStatus() {
        if (!this.currentTargetUser) return;
        
        if (this.onlineUsers.includes(this.currentTargetUser)) {
            this.partnerStatus.innerHTML = '<span class="status-online">● Online</span>';
            this.partnerStatus.classList.add('online');
        } else {
            const ls = this.lastSeenMap && this.lastSeenMap[this.currentTargetUser];
            this.partnerStatus.textContent = ls ? `Last seen ${this.formatLastSeen(ls)}` : 'Offline';
            this.partnerStatus.classList.remove('online');
        }
    }

    formatLastSeen(date) {
        const now = new Date();
        const diff = Math.floor((now - date) / 1000); // seconds
        if (diff < 60) return 'just now';
        if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
        if (diff < 86400) return `today at ${date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
        return date.toLocaleDateString();
    }

    showConnectionStatus(msg, type) {
        let bar = document.getElementById('connectionStatusBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'connectionStatusBar';
            bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:6px 20px;font-size:0.85rem;text-align:center;font-weight:600;transition:all 0.3s';
            document.body.prepend(bar);
        }
        if (type === 'ok') {
            bar.style.background = '#10b981';
            bar.style.color = 'white';
            bar.textContent = '✓ ' + msg;
            setTimeout(() => bar.remove(), 2500);
        } else if (type === 'warn') {
            bar.style.background = '#f59e0b';
            bar.style.color = '#1a1a1a';
            bar.textContent = '⟳ ' + msg;
        } else {
            bar.style.background = '#ef4444';
            bar.style.color = 'white';
            bar.textContent = '✗ ' + msg;
        }
    }

    updateContactPreview(contactUser, msg) {
        // Store last message data for sidebar timestamps
        const previewText = msg.type === 'text' ? (msg.message || '') : `📎 ${msg.type}`;
        this.lastMessageData[contactUser] = { preview: previewText, time: new Date(msg.date || Date.now()) };

        // Update the contact preview line without full re-render
        const items = document.querySelectorAll('.contact-item');
        items.forEach(item => {
            if ((item.dataset.username || '').toLowerCase() === (contactUser || '').toLowerCase()) {
                const preview = item.querySelector('.contact-preview');
                const timeEl  = item.querySelector('.contact-time');
                if (preview) preview.textContent = previewText.substring(0, 40);
                if (timeEl)  timeEl.textContent   = this.formatContactTime(new Date(msg.date || Date.now()));
            }
        });
    }

    // =========================================
    //  CONTACTS
    // =========================================
    async fetchContacts() {
        try {
            const res = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            const data = await res.json();
            this.allContacts = data;

            // Seed lastMessageData with timestamps from server to ensure correct initial sort
            data.forEach(u => {
                if (u.lastMessageAt && u.lastMessageAt !== 0) {
                    if (!this.lastMessageData[u.username]) {
                        this.lastMessageData[u.username] = { preview: '', time: new Date(u.lastMessageAt) };
                    }
                }
            });

            this.renderContactsWrapper();
        } catch(e) {}
    }

    renderContacts(usersToRender) {
        const container = document.getElementById('contactsList');
        const sourceList = usersToRender || this.allContacts.filter(u => u.username !== this.currentUser);

        if (sourceList.length === 0) {
            container.innerHTML = '<p class="empty-state-msg">No contacts found.</p>';
            return;
        }
        container.innerHTML = '';

        sourceList.forEach(contactObj => {
            const user = contactObj.username;
            const avatarSrc = contactObj.avatarUrl && contactObj.avatarUrl.trim() !== ''
                ? contactObj.avatarUrl
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(user)}&background=random&color=fff&size=96`;

            const isOnline = this.onlineUsers.includes(user);
            const ls = this.lastSeenMap && this.lastSeenMap[user];
            const unread = this.unreadCounts[user] || 0;
            const lastData = this.lastMessageData[user] || null;

            // Preview line: last message if known, else online/offline status
            const previewLine = lastData
                ? this.escapeHtml(lastData.preview.substring(0, 40))
                : (isOnline
                    ? '<span class="status-online">● Online</span>'
                    : (ls ? `Last seen ${this.formatLastSeen(ls)}` : 'Offline'));

            // Time shown top-right (only if we have last message data)
            const timeStr = lastData ? this.formatContactTime(lastData.time) : '';

            const div = document.createElement('div');
            div.className = `contact-item ${this.currentTargetUser === user ? 'active' : ''}`;
            div.dataset.username = user.toLowerCase();
            div.innerHTML = `
                <div class="contact-avatar-wrap">
                    <img src="${avatarSrc}" alt="${this.escapeHtml(user)}" class="contact-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user)}&background=random&color=fff&size=96'">
                    ${isOnline ? '<span class="online-dot"></span>' : ''}
                </div>
                <div class="contact-details">
                    <div class="contact-name-row">
                        <span class="contact-name">${this.escapeHtml(user)}</span>
                        ${timeStr ? `<span class="contact-time">${timeStr}</span>` : ''}
                    </div>
                    <div class="contact-preview-row">
                        <span class="contact-preview">${previewLine}</span>
                        ${unread > 0 ? `<span class="unread-badge-pill">${unread}</span>` : ''}
                    </div>
                </div>
            `;

            div.addEventListener('click', () => {
                this.socket.emit('start_conversation', { targetUser: user, limit: 50 });
                document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                if (window.innerWidth <= 768) this.workspace.classList.add('chat-opened');
            });
            container.appendChild(div);
        });
    }


    renderContactsWrapper() {
        // Safe wrapper to refresh current view
        this.filterContacts(this.searchInput.value);
    }

    filterContacts(query) {
        const q = (query || '').toLowerCase().trim();
        const activePill = document.querySelector('.filter-pill.active');
        const activeType = activePill ? activePill.textContent.toLowerCase() : 'all';

        let filtered = this.allContacts.filter(u => u.username !== this.currentUser);

        // 1. Filter by type
        if (activeType === 'unread') {
            filtered = filtered.filter(u => (this.unreadCounts[u.username] || 0) > 0);
        } else if (activeType === 'favourites') {
            filtered = filtered.filter(u => this.favorites.some(f => f.toLowerCase() === u.username.toLowerCase()));
        }

        // 2. Filter by search query
        if (q) {
            filtered = filtered.filter(u => u.username.toLowerCase().includes(q));
        }

        // 3. Sort by most recent message
        filtered.sort((a, b) => {
            const timeA = this.lastMessageData[a.username]?.time 
                ? new Date(this.lastMessageData[a.username].time).getTime() 
                : 0;
            const timeB = this.lastMessageData[b.username]?.time 
                ? new Date(this.lastMessageData[b.username].time).getTime() 
                : 0;
            return timeB - timeA;
        });

        this.renderContacts(filtered);
    }

    async toggleFavoriteContact(contactUser, e) {
        e.stopPropagation();
        try {
            const res = await fetch('/api/users/toggle-favorite', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ contactUsername: contactUser })
            });
            const data = await res.json();
            if(!res.ok) throw new Error(data.error);
            this.favorites = data.favorites || [];
            localStorage.setItem('favorites', JSON.stringify(this.favorites));
            this.renderContactsWrapper(); // Re-render to update the icon
            
            // Also update header button if editing the current chat
            if (contactUser === this.currentTargetUser) {
                this.updateChatHeaderFavorite();
            }
        } catch(err) {
            this.showToast('Error', 'Failed to toggle favorite');
        }
    }
    
    updateChatHeaderFavorite() {
        if (!this.currentTargetUser) return;
        const isFav = this.favorites && this.favorites.includes(this.currentTargetUser);
        const favBtn = document.getElementById('msgFavoriteBtn');
        if (favBtn) {
            favBtn.innerHTML = `<i class="${isFav ? 'fas' : 'far'} fa-star" style="${isFav ? 'color: #eab308' : ''}"></i>`;
            favBtn.onclick = (e) => this.toggleFavoriteContact(this.currentTargetUser, e);
        }
    }

    filterChats(type, el) {
        // Update active pill
        document.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('active'));
        if (el) el.classList.add('active');

        // Trigger filter with current search query
        this.filterContacts(this.searchInput.value);
    }

    // switchNavTab — canonical definition is below (search switchNavTab 2nd def)

    filterCalls(type, el) {
        document.querySelectorAll('#callFilters .filter-pill').forEach(btn => btn.classList.remove('active'));
        if (el) el.classList.add('active');

        if (!this.allCalls) return;

        let filtered = this.allCalls;
        if (type === 'missed') {
            filtered = this.allCalls.filter(call => {
                const callData = call.callData || {};
                return callData.callStatus === 'missed';
            });
        }
        this.renderParsedCalls(filtered);
    }



    // =========================================
    //  CHAT SETUP
    // =========================================
    setupChat(data) {
        this.currentConversation = data.conversationId;
        this.currentTargetUser = data.targetUser;
        
        this.welcomeScreen.classList.remove('active');
        this.activeChat.classList.remove('hidden');
        if (window.innerWidth <= 768) {
            this.workspace.classList.add('chat-opened');
        }
        document.getElementById('partnerName').textContent = this.currentTargetUser;
        const partnerObj = this.allContacts.find(c => c.username === this.currentTargetUser);
        const partnerAvatarSrc = partnerObj?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(this.currentTargetUser)}&background=random&color=fff&size=96`;
        document.getElementById('partnerAvatar').src = partnerAvatarSrc;
        this.updateHeaderStatus();
        this.updateChatHeaderFavorite();

        // Clear unread counts
        if (this.unreadCounts[this.currentTargetUser]) {
            this.unreadCounts[this.currentTargetUser] = 0;
            this.renderContactsWrapper();
            this.updatePageTitle();
        }

        // Close info panel if open
        document.getElementById('contactInfoPanel').classList.add('hidden');

        this.messagesWrap.innerHTML = '';
        this.chatMessages = data.messages;
        this.hasMoreMessages = data.hasMore;
        this.isFetchingMessages = false;
        
        this.lastMsgDate = null; // Reset for date dividers
        this.updatePinnedHeader(null); // Clear old pin

        data.messages.forEach(msg => {
            this.renderMessage(msg);
            if (msg.pinned) this.updatePinnedHeader(msg);
        });
        this.scrollToBottom();
        
        // Seed lastMessageData from the most recent loaded message
        if (data.messages.length > 0) {
            const last = data.messages[data.messages.length - 1];
            const preview = last.type === 'text' ? (last.message || '') : `📎 ${last.type}`;
            this.lastMessageData[this.currentTargetUser] = {
                preview,
                time: new Date(last.date || Date.now())
            };
        }
        
        // Mark as read
        this.socket.emit('mark_read', { conversationId: this.currentConversation, targetUser: this.currentTargetUser });
    }

    filterMessages(query) {
        const q = query.toLowerCase();
        const wrappers = this.messagesWrap.querySelectorAll('.msg-wrapper');
        wrappers.forEach(wrap => {
            const text = wrap.textContent.toLowerCase();
            const fileName = (wrap.dataset.filename || '').toLowerCase();
            if (text.includes(q) || fileName.includes(q)) wrap.classList.remove('hidden');
            else wrap.classList.add('hidden');
        });
    }

    // =========================================
    //  INPUT HANDLING
    // =========================================
    handleInput() {
        const text = this.messageInput.value.trim();
        if (text || this.selectedFile) {
            this.recordBtn.classList.add('hidden');
            this.sendBtn.classList.remove('hidden');
            this.sendBtn.classList.add('active'); // Smart send glow
            
            if (text) {
                this.socket.emit('typing_start', { conversationId: this.currentConversation });
                if(this.typeTimeout) clearTimeout(this.typeTimeout);
                this.typeTimeout = setTimeout(() => {
                    this.socket.emit('typing_stop', { conversationId: this.currentConversation });
                }, 1000);
            }
        } else {
            this.recordBtn.classList.remove('hidden');
            this.sendBtn.classList.add('hidden');
            this.sendBtn.classList.remove('active');
        }

        // Auto-resize textarea correctly
        this.messageInput.style.height = 'auto';
        let newHeight = this.messageInput.scrollHeight;
        if (newHeight < 44) newHeight = 44;
        if (newHeight > 150) newHeight = 150;
        this.messageInput.style.height = newHeight + 'px';
    }

    // =========================================
    //  PASSWORD STRENGTH
    // =========================================
    checkPasswordStrength(pw) {
        const meter = document.getElementById('pwStrength');
        const text = document.getElementById('pwStrengthText');
        
        let strength = 0;
        if (pw.length >= 8) strength++;
        if (/[A-Z]/.test(pw)) strength++;
        if (/[0-9]/.test(pw)) strength++;
        if (/[^A-Za-z0-9]/.test(pw)) strength++;

        meter.className = 'pw-strength-meter';
        if (pw.length === 0) {
            text.textContent = 'Password Security';
        } else if (strength <= 1) {
            meter.classList.add('pw-weak');
            text.textContent = 'Weak Password';
        } else if (strength === 2 || strength === 3) {
            meter.classList.add('pw-medium');
            text.textContent = 'Medium Security';
        } else {
            meter.classList.add('pw-strong');
            text.textContent = 'Strong & Secure';
        }
    }

    async handleForgotPassword() {
        const email = document.getElementById('forgotEmail').value;
        if (!email) return this.showToast('Error', 'Please enter your email');

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            this.showToast('Success', data.message);
            document.getElementById('forgotPasswordModal').classList.add('hidden');
        } catch (err) {
            this.showToast('Error', err.message);
        }
    }

    // =========================================
    //  PROFILE SETTINGS
    // =========================================
    openProfileSettings() {
        document.getElementById('settingsUsername').value = this.currentUser;
        document.getElementById('settingsAbout').value = localStorage.getItem('about') || 'Hey there! I am using NexChat.';
        const avatar = localStorage.getItem('avatarUrl');
        if (avatar) {
            document.getElementById('settingsAvatarPreview').src = avatar;
            document.getElementById('settingsAvatarUrl').value = avatar.startsWith('http') ? avatar : '';
        }
        
        document.getElementById('settingsModal').classList.remove('hidden');
    }

    previewAvatar(input) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('settingsAvatarPreview').src = e.target.result;
                document.getElementById('settingsAvatarUrl').value = ''; // Clear URL if file selected
            };
            reader.readAsDataURL(input.files[0]);
        }
    }

    previewAvatarUrl(url) {
        if (url && (url.startsWith('http') || url.startsWith('data:image'))) {
            document.getElementById('settingsAvatarPreview').src = url;
        }
    }

    async saveSettings() {
        const username = document.getElementById('settingsUsername').value;
        const about = document.getElementById('settingsAbout').value;
        const avatarFile = document.getElementById('settingsAvatarUpload').files[0];
        const avatarUrlInput = document.getElementById('settingsAvatarUrl').value;
        
        let avatarUrl = avatarUrlInput || localStorage.getItem('avatarUrl');
        
        if (avatarFile) {
            this.showToast('Updating', 'Uploading new avatar...');
            const result = await this.uploadFile(avatarFile);
            if (result) avatarUrl = result.url;
        }

        try {
            const res = await fetch('/api/users/update', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ username, about, avatarUrl })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            this.currentUser = data.username;
            localStorage.setItem('username', data.username);
            localStorage.setItem('avatarUrl', data.avatarUrl);
            localStorage.setItem('about', data.about);

            // Update UI
            document.getElementById('myUsername').textContent = data.username;
            document.getElementById('myAvatar').src = data.avatarUrl;
            const sidebarAvatar = document.getElementById('sidebarUserAvatar');
            if (sidebarAvatar) sidebarAvatar.src = data.avatarUrl;
            
            this.showToast('Success', 'Profile updated successfully!');
            this.closeModal('settingsModal');
            
            // Notify others via socket
            this.socket.emit('update_profile', { username: data.username, avatarUrl: data.avatarUrl });
        } catch (err) {
            this.showToast('Error', err.message);
        }
    }

    handleFileSelect(e) {
        if (e.target.files.length > 0) {
            this.selectedFile = e.target.files[0];
            document.getElementById('previewName').textContent = this.selectedFile.name;
            this.mediaPreview.classList.remove('hidden');
            this.handleInput();
        }
    }

    clearMediaPreview() {
        this.selectedFile = null;
        this.fileUpload.value = '';
        this.mediaPreview.classList.add('hidden');
        this.handleInput();
    }

    // =========================================
    //  ATTACHMENT ACTIONS
    // =========================================
    handleAttachAction(action) {
        switch (action) {
            case 'file':
                this.fileUpload.click();
                break;
            case 'poll':
                document.getElementById('pollModal').classList.remove('hidden');
                break;
            case 'location':
                this.sendLocation();
                break;
            case 'games':
                document.getElementById('gamesModal').classList.remove('hidden');
                break;
            case 'splitbill':
                document.getElementById('splitPartnerName').textContent = this.currentTargetUser || 'partner';
                document.getElementById('splitBillModal').classList.remove('hidden');
                break;
            case 'schedule':
                document.getElementById('scheduleMsgModal').classList.remove('hidden');
                break;
        }
    }

    // =========================================
    //  VOICE RECORDING
    // =========================================
    toggleRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    async startRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return this.showToast('Error', 'Microphone not supported in this browser');
        }
        if (!this.currentConversation) {
            return this.showToast('Error', 'Open a conversation first');
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioChunks = [];

            // Detect best supported MIME type
            const mimeType = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/ogg',
                'audio/mp4'
            ].find(m => MediaRecorder.isTypeSupported(m)) || '';

            const recOptions = mimeType ? { mimeType } : {};
            this.mediaRecorder = new MediaRecorder(stream, recOptions);
            this._voiceMime = this.mediaRecorder.mimeType || 'audio/webm';

            // UI Feedback
            this.recordBtn.classList.add('recording');
            document.getElementById('recordingInfo').classList.add('active');
            this.startRecordingTimer();

            this.mediaRecorder.ondataavailable = e => {
                if (e.data && e.data.size > 0) this.audioChunks.push(e.data);
            };
            this.mediaRecorder.onstop = () => this.finishRecording();
            
            this.mediaRecorder.start(100);
            this.recordBtn.title = 'Click to stop recording';
            this.showToast('Recording', '🎙️ Recording... Click mic to send');
        } catch (err) {
            this.showToast('Error', 'Microphone access denied. Check browser permissions.');
        }
    }

    cancelRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.isRecordingCancelled = true;
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            this.recordBtn.classList.remove('recording');
            document.getElementById('recordingInfo').classList.remove('active');
            this.stopRecordingTimer();
            this.recordBtn.title = 'Voice Message';
            this.audioChunks = [];
            this.showToast('Recording Cancelled', 'Your voice message has been discarded.');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            this.recordBtn.classList.remove('recording');
            document.getElementById('recordingInfo').classList.remove('active');
            this.stopRecordingTimer();
            this.recordBtn.title = 'Voice Message';
        }
    }

    startRecordingTimer() {
        this.recordingSeconds = 0;
        const timerEl = document.getElementById('recordingTimer');
        timerEl.textContent = '0:00';
        this.recordingInterval = setInterval(() => {
            this.recordingSeconds++;
            const mins = Math.floor(this.recordingSeconds / 60);
            const secs = this.recordingSeconds % 60;
            timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }, 1000);
    }

    stopRecordingTimer() {
        if (this.recordingInterval) clearInterval(this.recordingInterval);
    }

    async finishRecording() {
        if (this.isRecordingCancelled) {
            this.isRecordingCancelled = false;
            this.audioChunks = [];
            return;
        }
        if (this.audioChunks.length === 0) {
            this.showToast('Info', 'No audio recorded');
            return;
        }
        
        const mime = this._voiceMime || 'audio/webm';
        const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'webm';
        const audioBlob = new Blob(this.audioChunks, { type: mime });
        this.audioChunks = [];
        this._voiceMime = null;
        
        if (!this.currentConversation) {
            this.showToast('Error', 'No active conversation');
            return;
        }
        
        this.showToast('Sending', 'Uploading voice message...');
        const voiceFile = new File([audioBlob], `voice_${Date.now()}.${ext}`, { type: mime });
        const result = await this.uploadFile(voiceFile);
        
        if (result) {
            this.socket.emit('send_message', {
                conversationId: this.currentConversation,
                targetUser: this.currentTargetUser,
                type: 'voice',
                message: '',
                url: result.url,
                fileName: result.fileName,
                replyTo: this.replyingTo
            });
            this.cancelReply();
        } else {
            this.showToast('Error', 'Failed to upload voice message');
        }
    }

    // =========================================
    //  SEND MESSAGE
    // =========================================
    async sendMessage() {
        if (this.isSending) return;
        const text = this.messageInput.value.trim();
        if ((!text && !this.selectedFile) || !this.currentConversation) return;

        this.isSending = true;
        this.sendBtn.disabled = true;

        let type = 'text';
        let url = '';
        let fileName = '';

        if (this.selectedFile) {
            this.showToast('Sending', 'Uploading...');
            const fileType = this.selectedFile.type;
            if (fileType.startsWith('image/')) type = 'image';
            else if (fileType.startsWith('video/')) type = 'video';
            else if (fileType.startsWith('audio/')) type = 'voice';
            else type = 'document';

            const result = await this.uploadFile(this.selectedFile);
            if (!result) {
                this.isSending = false;
                this.sendBtn.disabled = false;
                return;
            }
            url = result.url;
            fileName = result.fileName;
            this.clearMediaPreview();
        }

        // ── Optimistic render for text messages ──
        if (type === 'text' && text) {
            const optimisticMsg = {
                id: `temp_${Date.now()}`,
                from: this.currentUser,
                to: this.currentTargetUser,
                message: text,
                type: 'text',
                timestamp: new Date().toLocaleTimeString(),
                date: new Date(), // Fix for Invalid Date bug
                status: 'sent',
                reactions: [],
                replyTo: this.replyingTo
            };
            const wrapper = this.renderMessage(optimisticMsg);
            if (wrapper) wrapper.dataset.temp = 'true';
        }

        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            message: text,
            type,
            url,
            fileName,
            replyTo: this.replyingTo
        });

        this.messageInput.value = '';
        this.emojiWrapper.classList.add('hidden');
        this.cancelReply();
        this.handleInput();
        this.socket.emit('typing_stop', { conversationId: this.currentConversation });
        
        this.isSending = false;
        this.sendBtn.disabled = false;
    }

    async uploadFile(fileOrBlob) {
        try {
            const formData = new FormData();
            formData.append('file', fileOrBlob, fileOrBlob.name || `voice_${Date.now()}.webm`);

            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Upload failed');
            }

            const data = await res.json();
            return {
                url: data.url,
                fileName: data.fileName,
                mimeType: data.mimeType
            };
        } catch (e) {
            console.error('Local Upload Error:', e);
            this.showToast('Upload Error', e.message);
            return null;
        }
    }

    // =========================================
    //  RENDER MESSAGE
    // =========================================
    renderMessage(msg, prepend = false) {
        const isSent = msg.from === this.currentUser;

        // Sanitize URL for legacy messages (fix 3000 port and relative paths)
        const sanitizeUrl = (url) => {
            if (!url) return '';
            let newUrl = url.replace(/localhost:3000/g, window.location.host);
            if (!newUrl.startsWith('http') && !newUrl.startsWith('/') && !newUrl.startsWith('data:')) {
                newUrl = '/uploads/' + newUrl;
            }
            return newUrl;
        };
        const msgUrl = sanitizeUrl(msg.url);
        
        // Date Divider Logic
        const msgDate = new Date(msg.date).toLocaleDateString();
        if (!prepend && this.lastMsgDate !== msgDate) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'date-divider';
            const today = new Date().toLocaleDateString();
            const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();
            let label = msgDate;
            if (msgDate === today) label = 'Today';
            else if (msgDate === yesterday) label = 'Yesterday';
            dateDiv.innerHTML = `<span>${label}</span>`;
            this.messagesWrap.appendChild(dateDiv);
            this.lastMsgDate = msgDate;
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = `msg-wrapper ${isSent ? 'msg-sent' : 'msg-received'}`;
        msgDiv.dataset.id = msg.id;

        // Emoji-only detection (1-3 emojis)
        const emojiRegex = /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]){1,3}$/u;
        const isEmojiOnly = msg.type === 'text' && msg.message && emojiRegex.test(msg.message.trim());

        let replyObj = '';
        if (msg.replyTo && msg.replyTo.id) {
            replyObj = `<div class="msg-reply-block" onclick="document.querySelector('[data-id=\\'${msg.replyTo.id}\\']')?.scrollIntoView({behavior: 'smooth', block: 'center'})"><span class="msg-reply-sender">${this.escapeHtml(msg.replyTo.sender)}</span><span class="msg-reply-text">${this.escapeHtml(msg.replyTo.text)}</span></div>`;
        }

        let contentObj = '';
        switch (msg.type) {
            case 'image':
                contentObj = `<div class="msg-media-container" style="min-height: 151px;"><div class="image-loading-container" id="loader-${msg.id}"></div><img src="${msgUrl}" class="msg-img hidden" id="img-${msg.id}" onload="document.getElementById('loader-${msg.id}')?.remove(); this.classList.remove('hidden')" onerror="const loader=document.getElementById('loader-${msg.id}'); if(loader) loader.innerHTML='<i class=\\'fas fa-exclamation-circle\\'></i>'; nexChat.showToast('Error', 'Image failed to load')" onclick="nexChat.openLightbox('${msgUrl}')" title="Click to enlarge"></div>`;
                break;
            case 'video':
                contentObj = `<div class="msg-media-container"><video src="${msgUrl}" controls class="msg-video"></video></div>`;
                break;
            case 'voice': {
                const sender = this.allContacts.find(c => c.username === msg.from);
                const avatar = sender ? sender.avatarUrl : 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
                
                contentObj = `<div class="voice-msg-container" id="voice-player-${msg.id}"><div class="voice-avatar-wrap"><img src="${avatar}" alt="Avatar"><div class="mic-overlay"><i class="fas fa-microphone"></i></div></div><div class="voice-controls"><button class="play-pause-btn" onclick="nexChat.toggleVoicePlay('${msg.id}')"><i class="fas fa-play" id="play-icon-${msg.id}"></i></button></div><div class="voice-visualizer-wrap"><canvas id="canvas-${msg.id}" class="voice-visualizer-canvas"></canvas><audio id="audio-${msg.id}" src="${msgUrl}" onended="nexChat.onVoiceEnded('${msg.id}')" ontimeupdate="nexChat.onVoiceProgress('${msg.id}')"></audio></div><div class="voice-meta"><span id="duration-${msg.id}">0:00</span></div></div>`;
                break;
            }
            case 'document': {
                const displayName = msg.fileName || 'Document';
                const ext = (displayName.split('.').pop() || '').toUpperCase();
                contentObj = `<div class="msg-doc-container"><div class="msg-doc-icon"><i class="fas fa-file-alt"></i></div><div class="msg-doc-info"><span class="msg-doc-name">${this.escapeHtml(displayName)}</span><span class="msg-doc-ext">${ext}</span></div><a href="${msgUrl}" target="_blank" download class="msg-doc-dl"><i class="fas fa-download"></i></a></div>`;
                break;
            }
            case 'poll':
                contentObj = this.renderPollContent(msg);
                msg.isGame = true;
                break;
            case 'rock_paper_scissors':
                contentObj = this.renderRPSContent(msg);
                msg.isGame = true;
                break;
            case 'guess_number':
                contentObj = this.renderGuessContent(msg);
                msg.isGame = true;
                break;
            case 'location':
                contentObj = this.renderLocationContent(msg);
                break;
            case 'tictactoe':
                contentObj = this.renderTTTContent(msg);
                msg.isGame = true;
                break;
            case 'call_log':
            case 'call_log_scheduled':
                contentObj = this.renderCallLogContent(msg);
                break;
        }

        const textObj = (msg.message && msg.type === 'text') ? `<span class="msg-text">${this.escapeHtml(msg.message)}</span>` : '';
        const tickClass = msg.status === 'read' ? 'status-tick read' : 'status-tick';
        let tickIcon = '<i class="fas fa-check"></i>';
        if (msg.status === 'delivered' || msg.status === 'read') tickIcon = '<i class="fas fa-check-double"></i>';
        
        const statusObj = isSent ? `<span class="${tickClass}" title="${msg.status}">${tickIcon}</span>` : '';
        const starIcon = (msg.starred && msg.starred.includes(this.currentUser)) ? '<i class="fas fa-star msg-star-icon" style="color:#eab308"></i>' : '';
        const pinIcon = msg.pinned ? '<i class="fas fa-thumbtack msg-pin-icon" style="font-size:0.7rem; margin-left:5px; opacity:0.6;"></i>' : '';
        const forwardedLabel = msg.forwardedFrom ? `<div class="msg-forwarded-label"><i class="fas fa-share"></i> Forwarded</div>` : '';

        let previewText = msg.type === 'text' ? (msg.message || '') : (msg.fileName || `Sent a ${msg.type}`);
        previewText = previewText.replace(/'/g, "\\'").replace(/"/g, '&quot;');

        msgDiv.innerHTML = `
            <div class="msg-bubble-container">
                <div class="msg-actions-group">
                    <div class="action-btn" onclick="nexChat.toggleReactionMenu(event, '${msg.id}')" title="Reactions"><i class="far fa-smile"></i></div>
                    
                    <div id="reactionMenu-${msg.id}" class="reaction-menu">
                        <span class="reaction-option" onclick="nexChat.addReaction('${msg.id}', '👍')">👍</span>
                        <span class="reaction-option" onclick="nexChat.addReaction('${msg.id}', '❤️')">❤️</span>
                        <span class="reaction-option" onclick="nexChat.addReaction('${msg.id}', '😂')">😂</span>
                        <span class="reaction-option" onclick="nexChat.addReaction('${msg.id}', '😮')">😮</span>
                        <span class="reaction-option" onclick="nexChat.addReaction('${msg.id}', '😢')">😢</span>
                        <span class="reaction-option" onclick="nexChat.addReaction('${msg.id}', '🙏')">🙏</span>
                        <span class="reaction-option" title="Other" onclick="nexChat.openEmojiPickerForMsg(event, '${msg.id}')"><i class="fas fa-plus-circle" style="font-size: 1.1rem; opacity: 0.7;"></i></span>
                    </div>

                    <div class="action-btn" onclick="nexChat.initiateReply('${msg.id}', '${this.escapeHtml(msg.from)}', '${previewText}', '${msg.type}')" title="Reply"><i class="fas fa-reply"></i></div>
                    <div class="action-btn" onclick="nexChat.summarizeThisMsg('${msg.id}')" title="Summarize"><i class="fas fa-wand-magic-sparkles summarize-sparkle"></i></div>
                    <div class="action-btn" onclick="nexChat.openForwardModal('${msg.id}')" title="Forward"><i class="fas fa-share"></i></div>
                    <div class="action-btn" onclick="nexChat.showMessageInfo('${msg.id}')" title="Info"><i class="fas fa-info-circle"></i></div>
                </div>
                <div class="msg-bubble ${isEmojiOnly ? 'emoji-only' : ''} ${msg.isGame ? 'msg-bubble-game' : ''}">${forwardedLabel}${replyObj}${contentObj}${textObj}<span class="msg-time">${(() => { 
                            if (!msg.timestamp) return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                            // If it's already HH:MM format
                            const m = msg.timestamp.match(/(\d{1,2}:\d{2})\s*(AM|PM)?/i);
                            if (m) return (m[1] + (m[2] ? ' ' + m[2].toUpperCase() : ''));
                            // If it's an ISO string or Date object
                            try {
                                return new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                            } catch(e) {
                                return msg.timestamp;
                            }
                        })()}${starIcon}${pinIcon}${statusObj}</span></div>
            </div>
        `;

        // Context Menu
        msgDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e, msg, previewText);
        });
        
        if (msg.reactions && msg.reactions.length > 0) {
            this.updateReactions(msgDiv, msg.reactions);
        }
        
        if (prepend) {
            this.messagesWrap.insertBefore(msgDiv, this.messagesWrap.firstChild);
        } else {
            this.messagesWrap.appendChild(msgDiv);
        }

        // Initialize voice waveform static bars immediately after DOM insert
        if (msg.type === 'voice') {
            requestAnimationFrame(() => {
                const canvas = document.getElementById(`canvas-${msg.id}`);
                if (canvas && canvas.parentElement) {
                    canvas.width = canvas.parentElement.clientWidth || 120;
                    canvas.height = canvas.parentElement.clientHeight || 36;
                    const ctx = canvas.getContext('2d');
                    const isSent = msgDiv.classList.contains('msg-sent');
                    const barColor = isSent ? 'rgba(255,255,255,0.35)' : 'rgba(0,168,132,0.4)';
                    this.renderStaticBars(ctx, canvas.width, canvas.height, barColor);
                }
            });
        }
        
        // Triple-tap to reply
        msgDiv.addEventListener('click', (e) => {
            if (e.detail === 3) this.initiateReply(msg.id, msg.from, previewText, msg.type);
        });

        if (!prepend) this.scrollToBottom();

        if (!isSent && !document.hidden && this.currentTargetUser === msg.from) {
            this.socket.emit('mark_read', { conversationId: this.currentConversation, targetUser: this.currentTargetUser });
        }
        return msgDiv;
    }


    // =========================================
    //  POLL
    // =========================================
    renderPollContent(msg) {
        const pd = msg.pollData;
        if (!pd) return '';
        const totalVotes = pd.options.reduce((sum, o) => sum + (o.votes ? o.votes.length : 0), 0);
        let optionsHtml = '';
        pd.options.forEach((opt, i) => {
            const voteCount = opt.votes ? opt.votes.length : 0;
            const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            const hasVoted = opt.votes && opt.votes.includes(this.currentUser);
            optionsHtml += `<button class="poll-option-btn ${hasVoted ? 'voted' : ''}" onclick="nexChat.votePoll('${msg.id}', ${i})"><div class="poll-bar" style="width:${pct}%"></div><div class="poll-option-text"><span>${this.escapeHtml(opt.text)}</span><span class="poll-vote-count">${voteCount} vote${voteCount !== 1 ? 's' : ''} (${pct}%)</span></div></button>`;
        });
        return `<div class="poll-container"><div class="poll-question"><i class="fas fa-poll" style="color:var(--accent)"></i> ${this.escapeHtml(pd.question)}</div>${optionsHtml}<div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px; opacity:0.8;">${totalVotes} total vote${totalVotes !== 1 ? 's' : ''}</div></div>`;
    }

    renderCallLogContent(msg) {
        if (msg.type === 'call_log_scheduled') {
            return `
                <div class="call-log-msg scheduled" style="display:flex; align-items:center; gap:12px; padding:8px 0;">
                    <div style="width:40px; height:40px; background:var(--accent); border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-size:1.2rem;">
                        <i class="fas fa-calendar-alt"></i>
                    </div>
                    <div>
                        <strong style="display:block; font-size:0.95rem; color:var(--accent);">Scheduled Call</strong>
                        <span style="font-size:0.85rem; color:var(--text-main); white-space: pre-wrap;">${this.escapeHtml(msg.message)}</span>
                    </div>
                </div>`;
        }

        const data = msg.callData || { callType: 'audio', callStatus: 'missed', callDuration: 0 };
        let icon = '<i class="fas fa-phone"></i>';
        let statusText = 'Call';
        let color = 'var(--text-muted)';
        
        if (data.callType === 'video') icon = '<i class="fas fa-video"></i>';
        
        if (data.callStatus === 'missed') {
            color = 'var(--danger)';
            statusText = 'Missed call';
        } else if (data.callStatus === 'incoming') {
            color = 'var(--success)';
            statusText = `Incoming call (${this.formatDuration(data.callDuration)})`;
        } else {
            color = 'var(--success)';
            statusText = `Outgoing call (${this.formatDuration(data.callDuration)})`;
        }

        return `<div class="call-log-msg" style="display:flex; align-items:center; gap:10px; padding:2px 0;"><div style="width:36px; height:36px; background:rgba(0,0,0,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; color:${color}; font-size:1rem;">${icon}</div><div><strong style="display:block; font-size:0.85rem;">${statusText}</strong><span style="font-size:0.7rem; color:var(--text-muted); opacity:0.8;">${data.callType === 'video' ? 'Video' : 'Audio'} Call</span></div></div>`;
    }

    formatDuration(secs) {
        if (!secs) return '0s';
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    addPollOption() {
        const container = document.getElementById('pollOptionsContainer');
        const count = container.querySelectorAll('.input-group-modal').length + 1;
        const div = document.createElement('div');
        div.className = 'input-group-modal';
        div.innerHTML = `<label>Option ${count}</label><input type="text" class="poll-option-input" placeholder="Option ${count}">`;
        container.appendChild(div);
    }

    sendPoll() {
        if (!this.currentConversation) return;
        const question = document.getElementById('pollQuestion').value.trim();
        const optionInputs = document.querySelectorAll('.poll-option-input');
        const options = [];
        optionInputs.forEach(input => {
            if (input.value.trim()) options.push({ text: input.value.trim(), votes: [] });
        });
        if (!question || options.length < 2) {
            return this.showToast('Error', 'Need a question and at least 2 options');
        }
        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            type: 'poll',
            pollData: { question, options }
        });
        // Reset & close
        document.getElementById('pollQuestion').value = '';
        document.querySelectorAll('.poll-option-input').forEach(i => i.value = '');
        document.getElementById('pollModal').classList.add('hidden');
    }

    votePoll(messageId, optionIndex) {
        this.socket.emit('vote_poll', { messageId, optionIndex, conversationId: this.currentConversation });
    }

    updatePollUI(msgEl, pollData, messageId) {
        const bubble = msgEl.querySelector('.msg-bubble');
        const pollContainer = bubble.querySelector('.poll-container');
        if (pollContainer) {
            // Rebuild poll
            const totalVotes = pollData.options.reduce((sum, o) => sum + (o.votes ? o.votes.length : 0), 0);
            let optionsHtml = '';
            pollData.options.forEach((opt, i) => {
                const voteCount = opt.votes ? opt.votes.length : 0;
                const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
                const hasVoted = opt.votes && opt.votes.includes(this.currentUser);
                optionsHtml += `
                    <button class="poll-option-btn ${hasVoted ? 'voted' : ''}" onclick="nexChat.votePoll('${messageId}', ${i})">
                        <div class="poll-bar" style="width:${pct}%"></div>
                        <div class="poll-option-text">
                            <span>${this.escapeHtml(opt.text)}</span>
                            <span class="poll-vote-count">${voteCount} vote${voteCount !== 1 ? 's' : ''} (${pct}%)</span>
                        </div>
                    </button>`;
            });
            pollContainer.innerHTML = `
                <div class="poll-question"><i class="fas fa-poll" style="color:var(--accent)"></i> ${this.escapeHtml(pollData.question)}</div>
                ${optionsHtml}
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">${totalVotes} total vote${totalVotes !== 1 ? 's' : ''}</div>
            `;
        }
    }

    // =========================================
    //  TIC-TAC-TOE
    // =========================================
    renderTTTContent(msg) {
        const gd = msg.gameData;
        if (!gd) return '';
        let cellsHtml = '';
        for (let i = 0; i < 9; i++) {
            const val = gd.board[i];
            const taken = val !== '';
            let cellContent = '';
            if (val === 'X') cellContent = '<span class="x-mark">✕</span>';
            else if (val === 'O') cellContent = '<span class="o-mark">○</span>';
            cellsHtml += `<button class="ttt-cell ${taken ? 'taken' : ''}" onclick="nexChat.playTTT('${msg.id}', ${i})">${cellContent}</button>`;
        }
        let statusText = '';
        if (gd.winner === 'draw') statusText = '<span class="ttt-status">🤝 It\'s a Draw!</span>';
        else if (gd.winner) statusText = `<span class="ttt-status winner">🎉 ${gd.winner === 'X' ? (gd.playerX || 'X') : (gd.playerO || 'O')} Wins!</span>`;
        else {
            const isUserTurn = (gd.currentTurn === 'X' && gd.playerX === this.currentUser) || 
                               (gd.currentTurn === 'O' && gd.playerO === this.currentUser);
            const currentPlayerName = gd.currentTurn === 'X' ? (gd.playerX || 'Waiting...') : (gd.playerO || 'Waiting for opponent...');
            statusText = `<span class="ttt-status ${isUserTurn ? 'your-turn' : ''}">${isUserTurn ? '🔔 Your Turn!' : `${gd.currentTurn}'s turn: ${currentPlayerName}`}</span>`;
        }
        return `<div class="ttt-container"><div class="ttt-title"><i class="fas fa-gamepad" style="color:var(--accent)"></i> Tic-Tac-Toe</div><div class="game-content-padding"><div class="ttt-board">${cellsHtml}</div><div class="game-hint"><i class="fas fa-question-circle"></i> Tap empty squares to get 3 in a row.</div>${statusText}</div></div>`;
    }

    sendTicTacToe() {
        if (!this.currentConversation) return;
        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            type: 'tictactoe',
            gameData: {
                board: ['','','','','','','','',''],
                playerX: this.currentUser,
                playerO: '',
                currentTurn: 'X',
                winner: '',
                isActive: true
            }
        });
    }

    playTTT(messageId, cellIndex) {
        this.socket.emit('ttt_move', { messageId, cellIndex, conversationId: this.currentConversation });
    }

    updateTTTUI(msgEl, gameData, messageId) {
        const bubble = msgEl.querySelector('.msg-bubble');
        const tttContainer = bubble.querySelector('.ttt-container');
        if (!tttContainer) return;
        
        let cellsHtml = '';
        for (let i = 0; i < 9; i++) {
            const val = gameData.board[i];
            const taken = val !== '';
            let cellContent = '';
            if (val === 'X') cellContent = '<span class="x-mark">✕</span>';
            else if (val === 'O') cellContent = '<span class="o-mark">○</span>';
            cellsHtml += `<button class="ttt-cell ${taken ? 'taken' : ''}" onclick="nexChat.playTTT('${messageId}', ${i})">${cellContent}</button>`;
        }
        let statusText = '';
        if (gameData.winner === 'draw') statusText = '<span class="ttt-status">🤝 It\'s a Draw!</span>';
        else if (gameData.winner) statusText = `<span class="ttt-status winner">🎉 ${gameData.winner === 'X' ? (gameData.playerX || 'X') : (gameData.playerO || 'O')} Wins!</span>`;
        else {
            const isUserTurn = (gameData.currentTurn === 'X' && gameData.playerX === this.currentUser) || 
                               (gameData.currentTurn === 'O' && gameData.playerO === this.currentUser);
            const currentPlayerName = gameData.currentTurn === 'X' ? (gameData.playerX || 'Waiting...') : (gameData.playerO || 'Waiting...');
            statusText = `<span class="ttt-status ${isUserTurn ? 'your-turn' : ''}">${isUserTurn ? '🔔 Your Turn!' : `${gameData.currentTurn}'s turn: ${currentPlayerName}`}</span>`;
        }
        tttContainer.innerHTML = `
            <div class="ttt-title"><i class="fas fa-gamepad" style="color:var(--accent)"></i> Tic-Tac-Toe</div>
            <div class="ttt-board">${cellsHtml}</div>
            ${statusText}
        `;
    }
    startMiniGame(type) {
        document.getElementById('gamesModal').classList.add('hidden');
        if (type === 'tictactoe') this.sendTicTacToe();
        if (type === 'rock_paper_scissors') this.sendRockPaperScissors();
        if (type === 'guess_number') this.sendGuessNumber();
    }

    sendRockPaperScissors() {
        if (!this.currentConversation) return;
        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            type: 'rock_paper_scissors',
            message: '🎮 Shared Rock Paper Scissors game',
            rpsData: {
                player1: this.currentUser,
                player2: this.currentTargetUser,
                move1: '', move2: '',
                winner: '', isActive: true
            }
        });
    }

    sendGuessNumber() {
        if (!this.currentConversation) return;
        const target = Math.floor(Math.random() * 100) + 1;
        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            type: 'guess_number',
            message: '🎮 Shared Guess the Number game',
            guessData: {
                target,
                player1: this.currentUser,
                player2: this.currentTargetUser,
                attempts: [],
                winner: '', isActive: true
            }
        });
    }

    renderRPSContent(msg) {
        const gd = msg.rpsData;
        if (!gd) return '';
        const isPlayer = this.currentUser === gd.player1 || this.currentUser === gd.player2;
        const myMove = this.currentUser === gd.player1 ? gd.move1 : gd.move2;
        const oppMove = this.currentUser === gd.player1 ? gd.move2 : gd.move1;
        const hasMoved = !!myMove;
        const bothMoved = !!(gd.move1 && gd.move2);

        const moveEmoji = { rock: '✊', paper: '✋', scissors: '✌️' };

        let statusText = '';
        let statusClass = 'ttt-status';
        if (gd.winner === 'draw') {
            statusText = '🤝 It\'s a Draw! Both chose ' + moveEmoji[gd.move1];
            statusClass += ' status-draw';
        } else if (gd.winner) {
            const winName = gd.winner === 'player1' ? (gd.player1 || 'P1') : (gd.player2 || 'P2');
            const winMove = gd.winner === 'player1' ? gd.move1 : gd.move2;
            const loseMove = gd.winner === 'player1' ? gd.move2 : gd.move1;
            const isWinner = (gd.winner === 'player1' && this.currentUser === gd.player1) || (gd.winner === 'player2' && this.currentUser === gd.player2);
            statusText = isWinner
                ? `🎉 You won! ${moveEmoji[winMove]} beats ${moveEmoji[loseMove]}`
                : `😔 ${winName} wins! ${moveEmoji[winMove]} beats ${moveEmoji[loseMove]}`;
            statusClass += isWinner ? ' status-win' : ' status-lose';
        } else if (!gd.isActive) {
            statusText = '⏹️ Game over';
        } else if (hasMoved) {
            statusText = `✅ You chose ${moveEmoji[myMove]} — Waiting for opponent...`;
            statusClass += ' status-wait';
        } else if (!isPlayer) {
            statusText = '🎮 Game in progress...';
        } else {
            statusText = '👉 Pick your move!';
            statusClass += ' status-prompt';
        }

        const controlsHtml = `<div class="rps-options"><div class="rps-item"><button class="rps-btn" onclick="nexChat.playRPS('${msg.id}', 'rock')" ${!gd.isActive || hasMoved || !isPlayer ? 'disabled' : ''} title="Rock">✊</button><span class="rps-label">Rock</span></div><div class="rps-item"><button class="rps-btn" onclick="nexChat.playRPS('${msg.id}', 'paper')" ${!gd.isActive || hasMoved || !isPlayer ? 'disabled' : ''} title="Paper">✋</button><span class="rps-label">Paper</span></div><div class="rps-item"><button class="rps-btn" onclick="nexChat.playRPS('${msg.id}', 'scissors')" ${!gd.isActive || hasMoved || !isPlayer ? 'disabled' : ''} title="Scissors">✌️</button><span class="rps-label">Scissors</span></div></div>${bothMoved ? `<div class="rps-reveal"><span class="rps-reveal-item">${gd.player1}: ${moveEmoji[gd.move1] || '?'}</span><span class="rps-vs">vs</span><span class="rps-reveal-item">${gd.player2}: ${moveEmoji[gd.move2] || '?'}</span></div>` : ''}`;

        return `<div class="rps-container"><div class="ttt-title"><i class="fas fa-hand-scissors"></i> Rock Paper Scissors</div><div class="game-content-padding">${controlsHtml}<div class="${statusClass}" style="margin-top:8px;">${statusText}</div></div></div>`;
    }

    renderGuessContent(msg) {
        const gd = msg.guessData;
        if (!gd) return '';

        const historyHtml = gd.attempts.slice(-5).map(a => {
            const icon = a.result === 'correct' ? '🎯' : a.result === 'higher' ? '⬆️' : '⬇️';
            const cls = a.result === 'correct' ? 'guess-row correct' : a.result === 'higher' ? 'guess-row higher' : 'guess-row lower';
            const isMe = a.by === this.currentUser;
            return `<div class="${cls}">${isMe ? 'You' : a.by}: <strong>${a.val}</strong> ${icon}</div>`;
        }).join('');

        let statusText = '';
        let statusClass = 'ttt-status';
        if (gd.winner) {
            const isWinner = gd.winner === this.currentUser;
            statusText = isWinner ? '🎉 You guessed it!' : `😮 ${gd.winner} guessed correctly!`;
            statusClass += isWinner ? ' status-win' : ' status-lose';
        } else if (!gd.isActive) {
            statusText = '⏹️ Game over';
        } else {
            const lastAttempt = gd.attempts[gd.attempts.length - 1];
            if (lastAttempt && lastAttempt.by !== this.currentUser) {
                statusText = `${lastAttempt.by} guessed ${lastAttempt.val} → go ${lastAttempt.result === 'higher' ? '⬆️ higher' : '⬇️ lower'}. Your turn!`;
                statusClass += ' status-prompt';
            } else {
                statusText = `Guess a number between 1 and 100`;
            }
        }

        const attemptsLeft = gd.maxAttempts ? `<span class="guess-attempts">${gd.attempts.length}/${gd.maxAttempts} tries</span>` : '';

        return `<div class="guess-container"><div class="ttt-title"><i class="fas fa-hashtag"></i> Guess the Number ${attemptsLeft}</div><div class="game-content-padding"><div class="guess-input-wrap"><input type="number" min="1" max="100" id="guessInput-${msg.id}" placeholder="1 – 100" ${!gd.isActive ? 'disabled' : ''} onkeydown="if(event.key==='Enter') nexChat.makeGuess('${msg.id}')"><button class="rps-guess-btn" onclick="nexChat.makeGuess('${msg.id}')" ${!gd.isActive ? 'disabled' : ''}><i class="fas fa-paper-plane"></i></button></div><div class="guess-history">${historyHtml}</div><div class="${statusClass}">${statusText}</div></div></div>`;
    }

    playRPS(messageId, move) {
        this.socket.emit('rps_move', { messageId, move, conversationId: this.currentConversation });
    }

    makeGuess(messageId) {
        const input = document.getElementById(`guessInput-${messageId}`);
        const val = parseInt(input.value);
        if (isNaN(val)) return;
        this.socket.emit('guess_attempt', { messageId, val, conversationId: this.currentConversation });
        input.value = '';
    }

    handleRPSUpdate(data) {
        const msgEl = document.querySelector(`.msg-wrapper[data-id="${data.messageId}"]`);
        if (msgEl) {
            msgEl.querySelector('.msg-bubble').innerHTML = this.renderRPSContent({ id: data.messageId, rpsData: data.rpsData });
            const gd = data.rpsData;
            const myMove = this.currentUser === gd.player1 ? gd.move1 : gd.move2;
            const oppMove = this.currentUser === gd.player1 ? gd.move2 : gd.move1;
            if (gd.isActive && !myMove && oppMove) {
                this.showToast('RPS: Your Turn!', 'Opponent has made their move. Pick yours!');
            }
        }
    }

    handleGuessUpdate(data) {
        const msgEl = document.querySelector(`.msg-wrapper[data-id="${data.messageId}"]`);
        if (msgEl) {
            msgEl.querySelector('.msg-bubble').innerHTML = this.renderGuessContent({ id: data.messageId, guessData: data.guessData });
            const gd = data.guessData;
            const lastAttempt = gd.attempts[gd.attempts.length - 1];
            if (gd.isActive && lastAttempt && lastAttempt.by !== this.currentUser) {
                this.showToast('Guess the Number', `Opponent guessed ${lastAttempt.val} (${lastAttempt.result}). Your turn!`);
            }
        }
    }

    handleTTTUpdate(data) {
        const msgEl = document.querySelector(`.msg-wrapper[data-id="${data.messageId}"]`);
        if (msgEl) {
            this.updateTTTUI(msgEl, data.gameData, data.messageId);
            const isUserTurn = (data.gameData.currentTurn === 'X' && data.gameData.playerX === this.currentUser) || 
                               (data.gameData.currentTurn === 'O' && data.gameData.playerO === this.currentUser);
            if (isUserTurn && !data.gameData.winner) {
                this.showToast('Tic-Tac-Toe', 'It’s your turn to play!', data.messageId);
            }
        }
    }

    jumpToMsg(msgId) {
        const el = document.querySelector(`.msg-wrapper[data-id="${msgId}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-glow');
            setTimeout(() => el.classList.remove('highlight-glow'), 2000);
        }
    }



    // =========================================
    //  LOCATION
    // =========================================
    renderLocationContent(msg) {
        const ld = msg.locationData;
        if (!ld) return '';
        const mapUrl = `https://www.openstreetmap.org/?mlat=${ld.lat}&mlon=${ld.lng}#map=15/${ld.lat}/${ld.lng}`;
        const staticImg = `https://static-maps.yandex.ru/v1?ll=${ld.lng},${ld.lat}&size=300,150&z=14&l=map&lang=en_US`;
        return `<div class="location-container" onclick="window.open('${mapUrl}', '_blank')"><div class="location-map"><div class="map-placeholder"><i class="fas fa-map-marker-alt"></i><span>📍 ${ld.lat.toFixed(4)}, ${ld.lng.toFixed(4)}</span></div></div><div class="location-label">${ld.label || 'Shared Location'} — Tap for map</div></div>`;
    }

    sendLocation() {
        if (!this.currentConversation) return;
        if (!navigator.geolocation) {
            return this.showToast('Error', 'Geolocation not supported');
        }
        this.showToast('Location', '📍 Getting your location...');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                this.socket.emit('send_message', {
                    conversationId: this.currentConversation,
                    targetUser: this.currentTargetUser,
                    type: 'location',
                    locationData: {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        label: 'Current Location'
                    }
                });
                this.showToast('Success', 'Location shared!');
            },
            (err) => {
                let msg = 'Could not get location.';
                if (err.code === 1) msg = 'Location permission denied. Please enable it in browser settings.';
                else if (err.code === 2) msg = 'Location unavailable.';
                else if (err.code === 3) msg = 'Location request timed out.';
                this.showToast('Location Error', msg);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // =========================================
    //  SCHEDULED MESSAGING
    // =========================================

    sendScheduledMessage() {
        if (!this.currentConversation) return;
        const text = document.getElementById('scheduleMessageText').value.trim();
        const dateStr = document.getElementById('scheduleDateTime').value;
        if (!text) return this.showToast('Error', 'Enter a message');
        if (!dateStr) return this.showToast('Error', 'Pick a date & time');
        
        const scheduledFor = new Date(dateStr);
        if (scheduledFor <= new Date()) return this.showToast('Error', 'Date must be in the future');

        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            type: 'text',
            message: text,
            scheduledFor: scheduledFor.toISOString()
        });

        document.getElementById('scheduleMessageText').value = '';
        document.getElementById('scheduleDateTime').value = '';
        document.getElementById('scheduleModal').classList.add('hidden');
    }

    // =========================================
    //  MESSAGE INFO
    // =========================================
    async showMessageInfo(msgId) {
        const modal = document.getElementById('msgInfoModal');
        const body = document.getElementById('msgInfoBody');
        body.innerHTML = '<div class="summary-loading"><div class="spinner"></div><span>Loading...</span></div>';
        modal.classList.remove('hidden');

        try {
            const res = await fetch(`/api/message/${msgId}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            const sentTime = new Date(data.createdAt).toLocaleString();
            const readTime = data.readAt ? new Date(data.readAt).toLocaleString() : 'Not yet';

            body.innerHTML = `
                <div class="msg-info-item">
                    <div class="msg-info-icon sent"><i class="fas fa-check"></i></div>
                    <div class="msg-info-details">
                        <strong>Sent</strong>
                        <span>${sentTime}</span>
                    </div>
                </div>
                <div class="msg-info-item">
                    <div class="msg-info-icon read"><i class="fas fa-eye"></i></div>
                    <div class="msg-info-details">
                        <strong>Read</strong>
                        <span>${readTime}</span>
                    </div>
                </div>
            `;
        } catch (err) {
            body.innerHTML = `<p style="color:var(--danger)">Could not load info: ${err.message}</p>`;
        }
    }

    openForwardModal(msgId) {
        this.forwardingMsgId = msgId;
        const modal = document.getElementById('forwardModal');
        if (modal) {
            modal.classList.remove('hidden');
            this.renderForwardContacts();
        }
    }

    renderForwardContacts(users) {
        const container = document.getElementById('forwardContactsList');
        if (!container) return;
        const sourceList = users || this.allContacts.filter(u => u.username !== this.currentUser);
        container.innerHTML = '';
        sourceList.forEach(u => {
            const div = document.createElement('div');
            div.className = 'contact-item';
            div.style.padding = '10px';
            div.style.borderRadius = '12px';
            div.style.marginBottom = '5px';
            div.style.background = 'var(--hover-bg)';
            div.innerHTML = `
                <img src="https://ui-avatars.com/api/?name=${u.username}&background=random&color=fff" class="contact-avatar" style="width:32px; height:32px;">
                <div class="contact-details" style="flex:1;">
                    <div class="contact-name" style="font-size:0.9rem;">${u.username}</div>
                </div>
                <button class="btn-primary" style="padding:4px 10px; font-size:0.8rem;" onclick="nexChat.forwardMessage('${u.username}')">Forward</button>
            `;
            container.appendChild(div);
        });
    }

    forwardMessage(targetUser) {
        if (!this.forwardingMsgId) {
            console.warn('Forward: No message ID selected');
            return;
        }
        
        console.log(`Forwarding message ${this.forwardingMsgId} to ${targetUser}`);
        
        this.socket.emit('forward_message', {
            messageId: this.forwardingMsgId,
            to: targetUser
        });

        document.getElementById('forwardModal').classList.add('hidden');
        this.showToast('Forwarded', `Message forwarded to ${targetUser}`);
        this.forwardingMsgId = null;
    }

    // =========================================
    //  AI CHAT SUMMARY
    // =========================================
    async summarizeChat() {
        if (!this.chatMessages || this.chatMessages.length === 0) {
            return this.showToast('Summary', 'No messages to summarize');
        }
        const modal = document.getElementById('summaryModal');
        const body = document.getElementById('summaryBody');
        body.innerHTML = '<div class="summary-loading"><div class="spinner"></div><span>✨ Summarizing conversation...</span></div>';
        modal.classList.remove('hidden');

        try {
            const res = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: this.chatMessages })
            });
            const data = await res.json();

            let keyPointsHtml = '';
            if (data.keyPoints && data.keyPoints.length > 0) {
                keyPointsHtml = '<ul>' + data.keyPoints.map(kp => `<li>${this.escapeHtml(kp)}</li>`).join('') + '</ul>';
            }

            body.innerHTML = `
                <div class="summary-result">
                    <h4>📝 Summary</h4>
                    <p>${this.escapeHtml(data.summary)}</p>
                    <h4>🔍 Key Points</h4>
                    ${keyPointsHtml || '<p class="text-muted">No key points extracted.</p>'}
                </div>
            `;
        } catch (err) {
            body.innerHTML = `<p style="color:var(--danger)">Failed to summarize: ${err.message}</p>`;
        }
    }

    // =========================================
    //  CONTACT INFO PANEL
    // =========================================
    showContactInfo() {
        if (!this.currentTargetUser) return;
        const panel = document.getElementById('contactInfoPanel');
        const partnerObj = this.allContacts.find(c => c.username === this.currentTargetUser);
        
        // Populate standard details
        const avatarSrc = partnerObj?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(this.currentTargetUser)}&background=random&size=200`;
        const avatarEl = document.getElementById('infoAvatar');
        if (avatarEl) avatarEl.src = avatarSrc;
        
        const nameEl = document.getElementById('infoName');
        if (nameEl) nameEl.textContent = this.currentTargetUser;
        
        const aboutEl = document.getElementById('infoAbout');
        if (aboutEl) aboutEl.textContent = partnerObj?.about || `Hey there! I am using NexChat.`;
        
        const panelTitleEl = document.getElementById('panelTitle');
        if (panelTitleEl) panelTitleEl.textContent = this.currentTargetUser;

        const scheduleCallTitle = document.getElementById('scheduleCallTitle');
        if (scheduleCallTitle) scheduleCallTitle.textContent = `${this.currentTargetUser}'s call`;
        
        const isOnline = this.onlineUsers.includes(this.currentTargetUser);
        const statusEl = document.getElementById('infoStatus');
        if (statusEl) {
            statusEl.textContent = isOnline ? 'Online' : 'Offline';
            statusEl.className = `info-status ${isOnline ? 'online' : ''}`;
        }

        // Populate shared media count
        const mediaCountEl = document.getElementById('infoMediaCount');
        // Filter messages for images, videos, and documents
        const mediaMessages = this.chatMessages.filter(m => ['image', 'video', 'document'].includes(m.type));
        if (mediaCountEl) mediaCountEl.textContent = mediaMessages.length;
        
        const mediaGrid = document.getElementById('infoSharedMedia');
        if (mediaGrid) {
            const sanitizeUrl = (url) => {
                if (!url) return '';
                let newUrl = url.replace(/localhost:3000/g, window.location.host);
                if (!newUrl.startsWith('http') && !newUrl.startsWith('/') && !newUrl.startsWith('data:')) {
                    newUrl = '/uploads/' + newUrl;
                }
                return newUrl;
            };

            if (mediaMessages.length > 0) {
                // Show only first 4 by default
                const initialMedia = mediaMessages.slice(0, 4);
                mediaGrid.innerHTML = initialMedia.map(m => this.renderMediaItem(m, sanitizeUrl)).join('');
                
                // Add more media to a hidden container if there are more than 4
                if (mediaMessages.length > 4) {
                    const moreMedia = mediaMessages.slice(4);
                    mediaGrid.innerHTML += `
                        <div id="moreMediaContainer" class="more-media-container hidden">
                            ${moreMedia.map(m => this.renderMediaItem(m, sanitizeUrl)).join('')}
                        </div>
                        <button class="view-more-media-btn" onclick="nexChat.toggleMediaCollapse(this)">
                            <span>View ${mediaMessages.length - 4} more</span>
                            <i class="fas fa-chevron-down"></i>
                        </button>
                    `;
                }
            } else {
                mediaGrid.innerHTML = '<p class="text-muted" style="grid-column: 1/-1; font-size:0.8rem; text-align:center; padding: 20px 0;">No media shared yet.</p>';
            }
        }

        this.updateInfoPanelStatus();
        panel.classList.remove('hidden');
    }

    updateInfoPanelStatus() {
        if (!this.currentTargetUser) return;
        const partner = this.allContacts.find(c => c.username === this.currentTargetUser);
        if (!partner) return;

        // Update Favorite status
        const isFav = partner.favorites?.includes(this.currentUser) || false; // This check might be wrong, checking my own favs
        // Correct check: Am I favoriting them?
        const me = this.allContacts.find(c => c.username === this.currentUser);
        const amIFavoriting = me?.favorites?.includes(this.currentTargetUser) || false;
        
        const favIcon = document.getElementById('infoFavoriteIcon');
        const favText = document.getElementById('infoFavoriteText');
        if (favIcon && favText) {
            if (amIFavoriting) {
                favIcon.className = 'fas fa-heart list-icon';
                favIcon.style.color = 'var(--danger)';
                favText.textContent = 'Remove from Favourites';
            } else {
                favIcon.className = 'far fa-heart list-icon';
                favIcon.style.color = '';
                favText.textContent = 'Add to Favourites';
            }
        }

        // Update Block status
        const amIBlocking = me?.blockedUsers?.includes(this.currentTargetUser) || false;
        const blockText = document.getElementById('infoBlockText');
        if (blockText) {
            blockText.textContent = amIBlocking ? 'Unblock Contact' : 'Block Contact';
        }
    }

    async toggleFavoriteFromInfo() {
        if (!this.currentTargetUser) return;
        try {
            const res = await fetch('/api/users/toggle-favorite', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ contactUsername: this.currentTargetUser })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Update local state
            const me = this.allContacts.find(c => c.username === this.currentUser);
            if (me) me.favorites = data.favorites;
            
            this.updateInfoPanelStatus();
            this.renderContactsWrapper();
            this.showToast('Updated', 'Favourites updated');
        } catch (err) {
            this.showToast('Error', err.message);
        }
    }

    async toggleBlockUser() {
        if (!this.currentTargetUser) return;
        try {
            const res = await fetch('/api/users/toggle-block', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ contactUsername: this.currentTargetUser })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Update local state
            const me = this.allContacts.find(c => c.username === this.currentUser);
            if (me) me.blockedUsers = data.blockedUsers;
            
            this.updateInfoPanelStatus();
            this.showToast('Updated', 'Block status updated');
        } catch (err) {
            this.showToast('Error', err.message);
        }
    }

    confirmClearChat() {
        if (confirm(`Are you sure you want to clear all messages with ${this.currentTargetUser}? This cannot be undone.`)) {
            this.clearChat();
        }
    }

    async clearChat() {
        if (!this.currentConversation) return;
        this.showToast('Working', 'Clearing chat...');
        this.socket.emit('clear_chat', { conversationId: this.currentConversation });
        this.chatMessages = [];
        this.messagesWrap.innerHTML = '';
        this.showToast('Success', 'Chat cleared');
    }

    renderMediaItem(m, sanitizeUrl) {
        const msgUrl = sanitizeUrl(m.url);
        if (m.type === 'image') {
            return `<div class="shared-media-item">
                        <img src="${msgUrl}" onclick="nexChat.openLightbox(\`${msgUrl}\`)">
                    </div>`;
        } else if (m.type === 'video') {
            return `<div class="shared-media-item video">
                        <video src="${msgUrl}"></video>
                        <div class="video-overlay"><i class="fas fa-play"></i></div>
                    </div>`;
        } else if (m.type === 'document') {
            return `<div class="shared-media-item doc" onclick="window.open('${msgUrl}', '_blank')">
                        <i class="fas fa-file-alt"></i>
                        <span class="doc-name">${m.fileName || 'Document'}</span>
                    </div>`;
        }
        return '';
    }

    toggleMediaCollapse(btn) {
        const container = document.getElementById('moreMediaContainer');
        const icon = btn.querySelector('i');
        const span = btn.querySelector('span');
        
        if (container.classList.contains('hidden')) {
            container.classList.remove('hidden');
            icon.className = 'fas fa-chevron-up';
            span.textContent = 'Show less';
        } else {
            container.classList.add('hidden');
            icon.className = 'fas fa-chevron-down';
            span.textContent = `View ${this.chatMessages.filter(m => ['image', 'video', 'document'].includes(m.type)).length - 4} more`;
        }
    }

    toggleMediaCollapseFromHeader(header) {
        const body = document.getElementById('mediaCollapsibleBody');
        const arrow = header.querySelector('.toggle-arrow');
        if (body.classList.contains('collapsed')) {
            body.classList.remove('collapsed');
            arrow.style.transform = 'rotate(0deg)';
        } else {
            body.classList.add('collapsed');
            arrow.style.transform = 'rotate(-90deg)';
        }
    }

    confirmDeleteChat() {
        if (confirm(`Delete entire conversation with ${this.currentTargetUser}?`)) {
            this.deleteChat();
        }
    }

    async deleteChat() {
        this.showToast('Working', 'Deleting conversation...');
        this.closeChat();
        this.showToast('Success', 'Conversation deleted');
    }

    // =========================================
    //  REPLIES & REACTIONS
    // =========================================
    initiateReply(msgId, sender, previewText, type) {
        this.replyingTo = {
            id: msgId,
            sender: sender,
            text: previewText,
            msgType: type || 'text'
        };
        this.replyPreviewName.textContent = sender;
        this.replyPreviewText.textContent = previewText;
        this.replyPreviewContainer.classList.remove('hidden');
        this.activeChat.classList.add('reply-active');
        this.messageInput.focus();
    }

    cancelReply() {
        this.replyingTo = null;
        this.replyPreviewContainer.classList.add('hidden');
        this.activeChat.classList.remove('reply-active');
    }

    updateReactions(msgEl, reactions) {
        let container = msgEl.querySelector('.reactions-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'reactions-container';
            msgEl.appendChild(container);
        }
        container.innerHTML = '';
        
        const counts = {};
        reactions.forEach(r => counts[r.emoji] = (counts[r.emoji] || 0) + 1);
        
        for (const [emoji, count] of Object.entries(counts)) {
            const span = document.createElement('span');
            span.className = 'reaction-badge';
            span.innerHTML = `${emoji} ${count > 1 ? count : ''}`;
            span.title = 'Click to un-react';
            span.onclick = (e) => {
                e.stopPropagation();
                this.addReaction(msgEl.dataset.id, emoji);
            };
            container.appendChild(span);
        }
    }

    addReaction(messageId, emoji) {
        this.socket.emit('add_reaction', { messageId, emoji, conversationId: this.currentConversation });
    }

    openEmojiPickerForMsg(e, msgId) {
        if (e) e.stopPropagation();
        this.reactingToMsgId = msgId;
        this.emojiWrapper.classList.toggle('hidden');
        // Close the reaction menu
        document.getElementById(`reactionMenu-${msgId}`)?.classList.remove('active');
    }

    toggleReactionMenu(e, msgId) {
        if (e) e.stopPropagation();
        // Close other open menus first
        document.querySelectorAll('.reaction-menu.active').forEach(m => {
            if (m.id !== `reactionMenu-${msgId}`) m.classList.remove('active');
        });

        const menu = document.getElementById(`reactionMenu-${msgId}`);
        if (menu) {
            menu.classList.toggle('active');
        }
    }

    async summarizeThisMsg(msgId) {
        const msg = this.chatMessages.find(m => m.id === msgId);
        if (!msg || (msg.type !== 'text' && !msg.fileName)) {
            return this.showToast('Error', 'Nothing to summarize in this message type');
        }
        
        const modal = document.getElementById('summaryModal');
        const body = document.getElementById('summaryBody');
        body.innerHTML = '<div class="summary-loading"><div class="spinner"></div><span>✨ Summarizing message...</span></div>';
        modal.classList.remove('hidden');

        try {
            const res = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [msg] })
            });
            const data = await res.json();

            body.innerHTML = `
                <div class="summary-result">
                    <h4>📝 Message Summary</h4>
                    <p>${this.escapeHtml(data.summary)}</p>
                </div>
            `;
        } catch (err) {
            body.innerHTML = `<p style="color:var(--danger)">Failed to summarize: ${err.message}</p>`;
        }
    }

    toggleSidebarCollapsible(header) {
        const parent = header.parentElement;
        const arrow = header.querySelector('.toggle-arrow');
        const content = parent.querySelector('.collapsible-content');
        
        const isCurrentlyCollapsed = content.classList.contains('collapsed');

        if (isCurrentlyCollapsed) {
            // EXPAND: Remove collapsed, set max-height to scrollHeight
            content.classList.remove('collapsed');
            content.style.maxHeight = content.scrollHeight + 'px';
            content.style.padding = '8px 0';
            arrow.style.transform = 'rotate(0deg)';
        } else {
            // COLLAPSE: Set max-height to 0 then add collapsed class
            content.style.maxHeight = '0px';
            content.style.padding = '0px';
            arrow.style.transform = 'rotate(-90deg)';
            setTimeout(() => content.classList.add('collapsed'), 300);
        }
    }

    openStarredModal() {
        // Trigger the click on the existing nav item to avoid duplication of logic
        document.getElementById('starredMsgsBtnNav').click();
    }

    // =========================================
    //  NEW NAVIGATION & FILTERS
    // =========================================
    switchNavTab(tab, btn) {
        // Update nav items UI
        document.querySelectorAll('.app-nav-sidebar .nav-item').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');

        // Toggle sidebar sections
        document.getElementById('section-chats').classList.toggle('hidden', tab !== 'chats');
        document.getElementById('section-calls').classList.toggle('hidden', tab !== 'calls');

        // Toggle Filters vs Heading
        const filters = document.getElementById('chatFilters');
        const callsHeading = document.getElementById('sidebarCallsHeading');
        const quickLinks = document.getElementById('quickLinksCollapsible');
        if (filters) filters.classList.toggle('hidden', tab === 'calls');
        if (callsHeading) callsHeading.classList.toggle('hidden', tab !== 'calls');
        if (quickLinks) quickLinks.classList.toggle('hidden', tab === 'calls');

        // Hide search box when in calls tab
        const searchBox = document.querySelector('.search-box');
        if (searchBox) {
            searchBox.style.display = tab === 'calls' ? 'none' : 'flex';
        }

        if (tab === 'calls') {
            this.fetchCallHistory();
        }
    }

    fetchCallHistory() {
        if (!this.socket) return;
        this.socket.emit('get_call_history');
    }

    // =========================================
    //  CALL HISTORY RENDERING & FILTERING
    // =========================================
    renderParsedCalls(calls) {
        const container = document.getElementById('callsList');
        if (!container) return;
        
        this.allCalls = calls; // Store for filtering

        if (!calls || calls.length === 0) {
            container.innerHTML = `
                <div class="empty-calls-state">
                    <i class="fas fa-phone-slash"></i>
                    <p>No call history yet</p>
                    <span>Your recent audio and video calls will show up here.</span>
                </div>`;
            return;
        }

        container.innerHTML = '';
        calls.forEach(call => {
            const isOutgoing = call.from === this.currentUser;
            const partnerName = isOutgoing ? call.to : call.from;
            const data = call.callData || { callType: 'audio', callStatus: 'missed', callDuration: 0 };
            const isMissed = data.callStatus === 'missed';
            
            const item = document.createElement('div');
            item.className = 'call-history-item';
            
            const callDate = new Date(call.date || call.timestamp);
            const timeStr = callDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = callDate.toLocaleDateString([], { month: 'short', day: 'numeric' });

            let statusIcon = '';
            let statusColor = '';
            let statusLabel = '';
            
            if (isMissed) {
                statusIcon = '<i class="fas fa-arrow-down-left"></i>';
                statusColor = 'var(--danger)';
                statusLabel = 'Missed';
            } else if (isOutgoing) {
                statusIcon = '<i class="fas fa-arrow-up-right"></i>';
                statusColor = 'var(--accent)';
                statusLabel = 'Outgoing';
            } else {
                statusIcon = '<i class="fas fa-arrow-down-left"></i>';
                statusColor = 'var(--accent)';
                statusLabel = 'Incoming';
            }

            const callIcon = data.callType === 'video' ? 'fas fa-video' : 'fas fa-phone-alt';

            item.innerHTML = `
                <div class="call-avatar-wrap">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(partnerName)}&background=random&color=fff">
                </div>
                <div class="call-details">
                    <div class="call-partner-name">${partnerName}</div>
                    <div class="call-meta ${isMissed ? 'missed' : ''}">
                        <span style="color: ${statusColor}">${statusIcon}</span>
                        <span>${statusLabel}</span>
                        <span class="dot">•</span>
                        <span>${dateStr}, ${timeStr}</span>
                    </div>
                </div>
                <div class="call-time-ago">${data.callDuration ? this.formatDuration(data.callDuration) : ''}</div>
                <button class="call-back-btn" onclick="nexChat.initiateCall('${data.callType}', '${partnerName}')" title="Call back">
                    <i class="${callIcon}"></i>
                </button>
            `;
            container.appendChild(item);
        });
    }

    formatDuration(seconds) {
        if (!seconds) return '';
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    filterCallHistory(type) {
        // Update tabs UI
        document.querySelectorAll('.call-filters .btn-chip').forEach(btn => {
            btn.classList.toggle('active', (type === 'all' && btn.textContent === 'All') || (type === 'missed' && btn.textContent === 'Missed'));
        });

        if (!this.allCalls) return;

        let filtered = this.allCalls;
        if (type === 'missed') {
            filtered = this.allCalls.filter(c => c.callData && c.callData.callStatus === 'missed');
        }
        this.renderParsedCalls(filtered);
    }

    // =========================================
    //  SCHEDULED CALLS
    // =========================================
    sendScheduledCall() {
        const title = document.getElementById('scheduleCallTitle')?.value || 'New Call';
        const desc = document.getElementById('scheduleCallDesc')?.value || '';
        const startD = document.getElementById('scheduleStartDate')?.value;
        const startT = document.getElementById('scheduleStartTime')?.value;
        const type = document.getElementById('scheduleCallType')?.value || 'video';
        
        if (!startD || !startT) return this.showToast('Error', 'Pick start date and time');

        const scheduledTime = new Date(`${startD}T${startT}`);
        if (scheduledTime <= new Date()) return this.showToast('Error', 'Time must be in the future');
        
        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            type: 'call_log_scheduled',
            message: `📅 Scheduled ${type} Call: ${title}\n${desc ? `Note: ${desc}\n` : ''}Time: ${scheduledTime.toLocaleString()}`,
            scheduledFor: scheduledTime.toISOString()
        });

        this.showToast('Success', 'Call scheduled!');
        document.getElementById('scheduleCallModal').classList.add('hidden');
    }

    handleSchedule() {
        const type = document.getElementById('scheduleType').value;
        const timeInput = document.getElementById('scheduleTime').value;
        const text = document.getElementById('scheduleMessageText').value;

        if (!timeInput || !text) {
            return this.showToast('Error', 'Please fill in all fields');
        }

        const scheduledAt = new Date(timeInput);
        if (scheduledAt <= new Date()) return this.showToast('Error', 'Time must be in the future');
        
        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            type: type === 'call' ? 'call_log_scheduled' : 'text',
            message: text,
            scheduledFor: scheduledAt.toISOString()
        });

        this.showToast('Success', `${type.charAt(0).toUpperCase() + type.slice(1)} scheduled for ${scheduledAt.toLocaleString()}`);
        document.getElementById('scheduleMsgModal').classList.add('hidden');
    }

    // =========================================
    //  SCROLL
    // =========================================
    scrollToBottom() {
        this.messagesWrap.scrollTop = this.messagesWrap.scrollHeight;
    }

    handleScrollPosition() {
        const wrap = this.messagesWrap;
        const isNearBottom = (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight) < 150;
        if (isNearBottom) {
            this.scrollBottomBtn.classList.add('hidden');
        } else {
            this.scrollBottomBtn.classList.remove('hidden');
        }

        // Pagination fetching logic
        if (wrap.scrollTop <= 5 && this.hasMoreMessages && !this.isFetchingMessages) {
            this.isFetchingMessages = true;
            const oldestMsg = this.chatMessages[0];
            if (oldestMsg) {
                // Save current scroll height to restore position after prepend
                this.previousScrollHeight = wrap.scrollHeight;
                
                // Show a small loading indicator? (Optional, kept simple for now)
                
                this.socket.emit('fetch_more_messages', {
                    targetUser: this.currentTargetUser,
                    beforeDate: oldestMsg.date,
                    limit: 50
                });
            }
        }
    }

    // =========================================
    //  WHATSAPP FEATURES: PROFILE & WALLPAPER
    // =========================================
    setWallpaper(color) {
        const wrap = document.getElementById('messagesWrap');
        if (!wrap) return;

        if (color === 'default') {
            wrap.style.background = '';
        } else if (color === 'custom') {
            const hex = prompt('Enter a color hex code (e.g. #0f172a):');
            if (hex) wrap.style.background = hex;
        } else {
            wrap.style.background = color;
        }
        
        const modal = document.getElementById('wallpaperModal');
        if (modal) modal.classList.add('hidden');
    }

    deleteMessage(messageId, mode) {
        if (mode === 'forEveryone') {
            this.pendingDeleteId = messageId;
            document.getElementById('deleteConfirmModal').classList.remove('hidden');
        } else {
            this.socket.emit('delete_message', { messageId, conversationId: this.currentConversation, mode });
        }
    }

    confirmDelete() {
        if (this.pendingDeleteId) {
            this.socket.emit('delete_message', { messageId: this.pendingDeleteId, conversationId: this.currentConversation, mode: 'forEveryone' });
            this.closeDeleteModal();
        }
    }

    closeDeleteModal() {
        document.getElementById('deleteConfirmModal').classList.add('hidden');
        this.pendingDeleteId = null;
    }

    togglePasswordVisibility(inputId, icon) {
        const input = document.getElementById(inputId);
        if (!input || !icon) return;
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }

    // =========================================
    //  WHATSAPP FEATURES: CORE LOGIC
    // =========================================
    showContextMenu(e, msg, previewText) {
        this.contextMenuMsg = msg;
        const x = e.clientX;
        const y = e.clientY;
        
        const isSent = msg.from === this.currentUser;
        const isStarred = msg.starred && msg.starred.includes(this.currentUser);
        
        this.contextMenu.innerHTML = `
            <div class="menu-item" onclick="nexChat.initiateReply('${msg.id}', '${this.escapeHtml(msg.from)}', '${previewText}', '${msg.type}')">
                <i class="fas fa-reply"></i> Reply
            </div>
            <div class="menu-item" onclick="nexChat.copyToClipboard('${this.escapeHtml(msg.message)}')">
                <i class="fas fa-copy"></i> Copy Text
            </div>
            <div class="menu-item" onclick="nexChat.openForwardModal('${msg.id}')">
                <i class="fas fa-share"></i> Forward
            </div>
            <div class="menu-item" onclick="nexChat.starMessage('${msg.id}')">
                <i class="fas fa-star" style="color:${isStarred ? '#eab308' : 'inherit'}"></i> ${isStarred ? 'Unstar' : 'Star'}
            </div>
            <div class="menu-item" onclick="nexChat.pinMessage('${msg.id}')">
                <i class="fas fa-thumbtack"></i> ${msg.pinned ? 'Unpin' : 'Pin'}
            </div>
            <hr style="border:0; border-top:1px solid var(--border-glass); margin:4px 0;">
            ${isSent ? `<div class="menu-item danger" onclick="nexChat.deleteMessage('${msg.id}', 'forEveryone')">
                <i class="fas fa-trash"></i> Delete for everyone
            </div>` : ''}
            <div class="menu-item danger" onclick="nexChat.deleteMessage('${msg.id}', 'forMe')">
                <i class="fas fa-trash-alt"></i> Delete for me
            </div>
        `;

        this.contextMenu.style.left = `${x}px`;
        this.contextMenu.style.top = `${y}px`;
        this.contextMenu.classList.remove('hidden');

        // Adjust position if it goes off screen
        const menuRect = this.contextMenu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) this.contextMenu.style.left = `${x - menuRect.width}px`;
        if (menuRect.bottom > window.innerHeight) this.contextMenu.style.top = `${y - menuRect.height}px`;
    }

    starMessage(messageId) {
        this.socket.emit('star_message', { messageId });
        this.contextMenu.classList.add('hidden');
    }

    updateStarUI(el, isStarred) {
        const timeDiv = el.querySelector('.msg-time');
        let starIcon = timeDiv.querySelector('.msg-star-icon');
        if (isStarred && !starIcon) {
            timeDiv.insertAdjacentHTML('afterbegin', '<i class="fas fa-star msg-star-icon" style="color:#eab308"></i>');
        } else if (!isStarred && starIcon) {
            starIcon.remove();
        }
    }

    openForwardModal(messageId) {
        this.forwardingMsgId = messageId;
        this.forwardSearch.value = '';
        this.renderForwardContacts();
        this.forwardModal.classList.remove('hidden');
    }

    renderForwardContacts() {
        this.forwardContactsList.innerHTML = '';
        this.allContacts.forEach(user => {
            const div = document.createElement('div');
            div.className = 'info-action-row';
            const avatar = user.avatarUrl || `https://ui-avatars.com/api/?name=${user.username}&background=random`;
            div.innerHTML = `
                <img src="${avatar}" style="width:35px;height:35px;border-radius:50%">
                <span>${this.escapeHtml(user.username)}</span>
            `;
            div.onclick = () => {
                this.socket.emit('forward_message', { messageId: this.forwardingMsgId, to: user.username });
                this.forwardModal.classList.add('hidden');
            };
            this.forwardContactsList.appendChild(div);
        });
    }

    filterForwardContacts(query) {
        const q = query.toLowerCase();
        const items = this.forwardContactsList.querySelectorAll('.info-action-row');
        items.forEach(item => {
            const name = item.querySelector('span').textContent.toLowerCase();
            if (name.includes(q)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }

    pinMessage(messageId) {
        this.socket.emit('pin_message', { messageId, conversationId: this.currentConversation });
        this.contextMenu.classList.add('hidden');
    }

    updatePinnedHeader(msg) {
        if (!msg) {
            this.pinnedMsgHeader.classList.add('hidden');
            this.pinnedMsgId = null;
        } else {
            this.pinnedMsgId = msg.id;
            this.pinnedMsgText.textContent = msg.text || 'Pinned message';
            this.pinnedMsgHeader.classList.remove('hidden');
        }
    }

    openLightbox(url) {
        this.lightboxImg.src = url;
        this.lightbox.classList.remove('hidden');
    }

    async fetchStarredMessages(targetUser = null) {
        try {
            const res = await fetch('/api/starred', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            let msgs = await res.json();
            
            // Filter by specific contact if requested from profile page
            if (targetUser) {
                msgs = msgs.filter(m => m.from === targetUser || m.to === targetUser);
            }
            
            this.renderStarredMessages(msgs);
            this.starredModal.classList.remove('hidden');
        } catch (err) {
            this.showToast('Error', 'Failed to fetch starred messages');
        }
    }

    renderStarredMessages(msgs) {
        this.starredList.innerHTML = '';
        if (msgs.length === 0) {
            this.starredList.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;">No starred messages yet.</div>';
            return;
        }
        msgs.forEach(m => {
            const div = document.createElement('div');
            div.className = 'msg-wrapper msg-received'; // show in reception style
            div.style.marginBottom = '15px';
            div.style.cursor = 'pointer';
            div.innerHTML = `
                <div style="font-size:0.75rem; color:var(--accent); margin-bottom:4px;">${m.from} → ${m.to} (${m.timestamp})</div>
                <div class="msg-bubble">${this.escapeHtml(m.message || `Sent a ${m.type}`)}</div>
            `;
            div.onclick = () => {
                this.starredModal.classList.add('hidden');
                // Could jump to msg here if we wanted
            };
            this.starredList.appendChild(div);
        });
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showToast('Copied', 'Message text copied to clipboard');
        });
        this.contextMenu.classList.add('hidden');
    }

    escapeHtml(unsafe) {
        if (!unsafe) return '';
        return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // =========================================
    //  SCHEDULING LOGIC
    // =========================================
    setSchedulePreset(preset) {
        const dtInput = document.getElementById('scheduleDateTime');
        const now = new Date();
        let target;
        
        switch(preset) {
            case '1h': target = new Date(now.getTime() + 3600000); break;
            case '1d': target = new Date(now.getTime() + 86400000); break;
            case '1w': target = new Date(now.getTime() + 604800000); break;
            case '1m': target = new Date(now.getTime() + 2592000000); break;
            case '1y': target = new Date(now.getTime() + 31536000000); break;
        }
        
        if (target) {
            // Format to local ISO string without seconds
            const tzOffset = target.getTimezoneOffset() * 60000;
            const localISOTime = new Date(target - tzOffset).toISOString().slice(0, 16);
            dtInput.value = localISOTime;
        }

        // Add active class to chip
        document.querySelectorAll('.btn-chip').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
    }

    handleSchedule() {
        const type = document.getElementById('scheduleType').value;
        const timeInput = document.getElementById('scheduleTime');
        const text = document.getElementById('scheduleMessageText').value;
        const scheduledTime = new Date(timeInput.value);

        if (isNaN(scheduledTime.getTime())) return this.showToast('Error', 'Invalid time');
        if (scheduledTime < new Date()) return this.showToast('Error', 'Pick a future time');

        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            message: `📅 ${type === 'call' ? 'Call' : 'Message'} scheduled for ${scheduledTime.toLocaleString()}${text ? `: ${text}` : ''}`,
            type: type === 'call' ? 'call_log_scheduled' : 'text',
        });
        
        // Also emit the silent backend scheduled message
        this.socket.emit('send_message', {
            conversationId: this.currentConversation,
            targetUser: this.currentTargetUser,
            message: text,
            type: type === 'call' ? 'call_log_scheduled' : 'text',
            scheduledFor: scheduledTime.toISOString()
        });

        this.showToast('Scheduled', `${type.charAt(0).toUpperCase() + type.slice(1)} has been scheduled!`);
        this.closeModal('scheduleModal');
        document.getElementById('scheduleMessageText').value = '';
    }


    // =========================================
    //  DYNAMIC VOICE PLAYER LOGIC
    // =========================================
    toggleVoicePlay(msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const icon = document.getElementById(`play-icon-${msgId}`);
        const canvas = document.getElementById(`canvas-${msgId}`);

        if (!audio) {
            console.error(`Audio element not found for msgId: ${msgId}`);
            return;
        }

        // Resuming AudioContext is required by modern browsers
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        if (!audio.analyser) {
            this.setupVoiceVisualizer(msgId, audio, canvas);
        }

        if (audio.paused) {
            // Stop other playing audio
            document.querySelectorAll('audio').forEach(a => {
                if (a.id !== audio.id && !a.paused) {
                    a.pause();
                    const otherId = a.id.replace('audio-', '');
                    const otherIcon = document.getElementById(`play-icon-${otherId}`);
                    if (otherIcon) otherIcon.className = 'fas fa-play';
                }
            });

            // Ensure source is loaded
            if (audio.readyState === 0) {
                console.log("Audio not loaded, calling load()...");
                audio.load();
            }

            audio.play().then(() => {
                icon.className = 'fas fa-pause';
            }).catch(err => {
                console.error("Play error for URL:", audio.src, err);
                if (err.name === 'NotAllowedError') {
                    this.showToast('Error', 'Interaction required or Audio Context suspended.');
                } else if (err.name === 'NotSupportedError') {
                    this.showToast('Error', 'Format not supported or source missing.');
                } else {
                    this.showToast('Error', 'Playback failed. Check console.');
                }
            });
        } else {
            audio.pause();
            icon.className = 'fas fa-play';
        }
    }

    setupVoiceVisualizer(msgId, audio, canvas) {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const ctx = canvas.getContext('2d', { alpha: true });
        const analyser = this.audioCtx.createAnalyser();
        analyser.fftSize = 64; 
        
        try {
            const source = this.audioCtx.createMediaElementSource(audio);
            source.connect(analyser);
            analyser.connect(this.audioCtx.destination);
            audio.analyser = analyser;
        } catch (e) {
            console.warn("Visualizer setup warning (likely already connected):", e);
        }
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const isSent = canvas.closest('.msg-sent') !== null;
        const barColor = isSent ? '#ffffff' : '#1ed760';
        const inactiveColor = isSent ? 'rgba(255,255,255,0.3)' : 'rgba(30,215,96,0.3)';

        // Responsive canvas
        const resizeCanvas = () => {
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        const draw = () => {
            if (audio.paused && audio.currentTime === 0) {
                // Initial empty state or ended state
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                this.renderStaticBars(ctx, canvas.width, canvas.height, inactiveColor);
                return;
            }
            
            if (!audio.paused || audio.currentTime > 0) {
                requestAnimationFrame(draw);
            }
            
            analyser.getByteFrequencyData(dataArray);
            
            const width = canvas.width;
            const height = canvas.height;
            ctx.clearRect(0, 0, width, height);
            
            const barWidth = (width / bufferLength) * 2;
            let x = 0;
            const progress = audio.currentTime / (audio.duration || 1);

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * height * 0.8 + 2;
                ctx.fillStyle = (x / width) < progress ? barColor : inactiveColor;
                this.drawRoundedRect(ctx, x, (height - barHeight) / 2, barWidth - 2, barHeight, 2);
                x += barWidth;
            }
        };
        
        audio.onplay = () => {
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
            draw();
        };

        // Initial draw
        this.renderStaticBars(ctx, canvas.width, canvas.height, inactiveColor);
    }

    renderStaticBars(ctx, width, height, color) {
        const barCount = 32;
        const barWidth = (width / barCount) * 2;
        ctx.fillStyle = color;
        for (let i = 0; i < barCount; i++) {
            const h = 4 + Math.random() * 10;
            this.drawRoundedRect(ctx, i * barWidth, (height - h) / 2, barWidth - 2, h, 2);
        }
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
    }

    onVoiceEnded(msgId) {
        const icon = document.getElementById(`play-icon-${msgId}`);
        if (icon) icon.className = 'fas fa-play';
        const audio = document.getElementById(`audio-${msgId}`);
        if (audio) {
            audio.currentTime = 0;
            const canvas = document.getElementById(`canvas-${msgId}`);
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const isSent = canvas.closest('.msg-sent') !== null;
                const inactiveColor = isSent ? 'rgba(255,255,255,0.3)' : 'rgba(30,215,96,0.3)';
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                this.renderStaticBars(ctx, canvas.width, canvas.height, inactiveColor);
            }
        }
    }

    onVoiceProgress(msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const durationSpan = document.getElementById(`duration-${msgId}`);
        if (audio && durationSpan) {
            const current = this.formatTime(audio.currentTime);
            const total = this.formatTime(audio.duration || 0);
            durationSpan.textContent = `${current} / ${total}`;
        }
    }

    formatTime(seconds) {
        if (isNaN(seconds) || seconds === Infinity) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }


    // =========================================
    //  UNIFIED CALLING & RTC LOGIC
    // =========================================
    initCallingUI() {
        const acceptBtn = document.getElementById('acceptCallBtn');
        const rejectBtn = document.getElementById('rejectCallBtn');
        const endBtn = document.getElementById('endCallBtn');
        const muteBtn = document.getElementById('toggleMuteBtn');
        const vidBtn = document.getElementById('toggleVideoBtn');

        if (acceptBtn) acceptBtn.onclick = () => this.acceptCall();
        if (rejectBtn) rejectBtn.onclick = () => this.terminateCall('rejected');
        if (endBtn) endBtn.onclick = () => this.terminateCall('ended');
        if (muteBtn) muteBtn.onclick = () => this.toggleCallAudio();
        if (vidBtn) vidBtn.onclick = () => this.toggleCallVideo();

        // Header and Panel Buttons
        const voiceBtn = document.getElementById('msgVoiceCall');
        const videoBtn = document.getElementById('msgVideoCall');
        if (voiceBtn) voiceBtn.onclick = () => this.initiateCall('voice');
        if (videoBtn) videoBtn.onclick = () => this.initiateCall('video');
    }

    initCallingSocketListeners() {
        if (!this.socket) return;
        this.socket.on('incoming_call', (data) => this.handleIncomingCall(data));
        this.socket.on('call_answered', (data) => this.handleCallAnswered(data));
        this.socket.on('ice_candidate', (data) => this.handleRemoteCandidate(data));
        this.socket.on('call_rejected', (data) => this.handleCallTermination(data, 'rejected'));
        this.socket.on('call_ended', (data) => this.handleCallTermination(data, 'ended'));
        this.socket.on('call_history', (data) => this.renderParsedCalls(data));
    }

    handleNewMessage(msg) {
        // Track unread if not current conversation
        const fromMe = msg.from === this.currentUser;
        const fromPartner = msg.from;
        
        if (!fromMe && this.currentTargetUser !== fromPartner) {
            this.unreadCounts[fromPartner] = (this.unreadCounts[fromPartner] || 0) + 1;
            // Optionally refresh the contact list to show the new badge
            this.renderContacts(this.allContacts.filter(u => u.username !== this.currentUser));
        }

        // If it's a call log, fetch new history
        if (msg.type === 'call_log') {
            this.fetchCallHistory();
        }

        // If for current conversation, render it
        if (this.currentConversation && 
            (msg.from === this.currentTargetUser || msg.to === this.currentTargetUser)) {
            
            // Check if it was already rendered optimistically (matching text or ID)
            const exists = this.chatMessages.some(m => m.id === msg.id);
            
            if (!exists) {
                this.chatMessages.push(msg);
                this.renderMessage(msg);
                this.scrollToBottom();
            }
        }
    }

    async initiateCall(type, targetUser = null) {
        const target = targetUser || this.currentTargetUser;
        if (!target) return this.showToast('Error', 'Select a contact to call');
        if (this.currentCall) return this.showToast('Call in progress', 'Finish current call first');
        
        // If target was passed explicitly (like from call history), ensure we are ready
        if (targetUser) {
            this.currentTargetUser = targetUser;
            // Optionally update UI for the new target user
            document.getElementById('partnerName').textContent = targetUser;
            const partnerObj = this.allContacts.find(c => c.username === targetUser);
            document.getElementById('partnerAvatar').src = partnerObj?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(targetUser)}&background=random`;
        }

        console.log(`📞 Starting ${type} call to: ${target}`);
        this.currentCall = { partner: target, type, isIncoming: false };
        this.showActiveCallUI();
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: true, 
                video: type === 'video' 
            });
            document.getElementById('localVideo').srcObject = this.localStream;

            this.setupPeerConnection(true);
            
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            
            this.socket.emit('call_user', { to: target, offer, type });
            document.getElementById('callDuration').textContent = 'Dialing...';
            this.showToast('Calling...', `Calling ${target}`);
        } catch (err) {
            console.error('Call initialization error:', err);
            this.terminateCall('failed');
            this.showToast('Media Error', 'Could not access camera/microphone');
        }
    }

    async acceptCall() {
        if (!this.currentCall || !this.currentCall.offer) return;
        
        document.getElementById('incomingCallOverlay').classList.add('hidden');
        this.showActiveCallUI();

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: true, 
                video: this.currentCall.type === 'video' 
            });
            document.getElementById('localVideo').srcObject = this.localStream;

            this.setupPeerConnection(false);
            
            await this.pc.setRemoteDescription(new RTCSessionDescription(this.currentCall.offer));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            
            this.socket.emit('answer_call', { to: this.currentCall.partner, answer });
            this.startCallTimer();
        } catch (err) {
            console.error('Call answer error:', err);
            this.terminateCall('failed');
        }
    }

    async handleCallAnswered(data) {
        if (!this.pc) return;
        try {
            await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            this.startCallTimer();
        } catch (err) {
            console.error('Error handling answer:', err);
        }
    }

    setupPeerConnection(isCaller) {
        this.pc = new RTCPeerConnection(this.iceServers);
        this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice_candidate', { to: this.currentCall.partner, candidate: event.candidate });
            }
        };

        this.pc.ontrack = (event) => {
            if (!this.remoteStream) {
                this.remoteStream = new MediaStream();
                document.getElementById('remoteVideo').srcObject = this.remoteStream;
            }
            this.remoteStream.addTrack(event.track);
        };

        this.pc.onconnectionstatechange = () => {
            if (['disconnected', 'failed', 'closed'].includes(this.pc.connectionState)) {
                this.terminateCall('disconnected');
            }
        };
    }

    handleIncomingCall(data) {
        if (this.currentCall) {
            this.socket.emit('reject_call', { to: data.from });
            return;
        }
        this.currentCall = { partner: data.from, type: data.type, isIncoming: true, offer: data.offer };
        
        document.getElementById('incomingCallerName').textContent = data.from;
        document.getElementById('incomingCallType').textContent = `${data.type.charAt(0).toUpperCase() + data.type.slice(1)} Call`;
        document.getElementById('incomingCallerAvatar').src = `https://ui-avatars.com/api/?name=${data.from}&background=random`;
        document.getElementById('incomingCallOverlay').classList.remove('hidden');
    }

    handleRemoteCandidate(data) {
        if (this.pc && data.candidate) {
            this.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => {});
        }
    }

    handleCallTermination(data, reason) {
        if (this.currentCall && this.currentCall.partner === data.from) {
            this.terminateCall(reason);
        }
    }

    terminateCall(reason) {
        const callType = this.currentCall ? this.currentCall.type : 'voice';
        const durationDisplay = document.getElementById('callDuration').textContent;

        if (reason === 'rejected') {
            if (this.currentCall) this.socket.emit('reject_call', { to: this.currentCall.partner });
            this.showToast('Call Rejected', 'Declined');
            if (this.currentCall && this.currentConversation) {
                this.socket.emit('send_message', {
                    conversationId: this.currentConversation,
                    targetUser: this.currentCall.partner,
                    type: 'call_log',
                    callData: { callType, callStatus: 'missed', callDuration: 0 },
                    message: 'Missed call'
                });
            }
        } else if (['ended', 'disconnected', 'failed'].includes(reason)) {
            if (this.currentCall) {
                this.socket.emit('end_call', { to: this.currentCall.partner });
                
                // Only log if it was actually connected or dialled
                if (this.currentConversation) {
                    let dur = 0;
                    if (durationDisplay.includes(':')) {
                        const parts = durationDisplay.split(':');
                        dur = (parseInt(parts[0]) * 60) + parseInt(parts[1]);
                    }
                    
                    this.socket.emit('send_message', {
                        conversationId: this.currentConversation,
                        targetUser: this.currentCall.partner,
                        type: 'call_log',
                        callData: { 
                            callType, 
                            callStatus: (dur > 0) ? 'completed' : 'missed', 
                            callDuration: dur 
                        },
                        message: (dur > 0) ? `Call ended - ${durationDisplay}` : 'Call ended'
                    });
                }
            }
        }

        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if (this.pc) this.pc.close();
        
        this.pc = null;
        this.localStream = null;
        this.remoteStream = null;
        this.currentCall = null;
        this.stopCallTimer();

        document.getElementById('incomingCallOverlay').classList.add('hidden');
        document.getElementById('activeCallOverlay').classList.add('hidden');
        document.getElementById('remoteVideo').srcObject = null;
        document.getElementById('localVideo').srcObject = null;
    }

    showActiveCallUI() {
        if (!this.currentCall) return;
        const partnerName = this.currentCall.partner;
        const partnerObj = this.allContacts.find(c => c.username === partnerName);
        const avatarSrc = partnerObj?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(partnerName)}&background=random`;

        document.getElementById('activeCallName').textContent = partnerName;
        document.getElementById('callDuration').textContent = 'Connecting...';
        document.getElementById('remoteCallAvatar').src = avatarSrc;
        
        const overlay = document.getElementById('activeCallOverlay');
        overlay.classList.remove('hidden');
        overlay.classList.remove('minimized');
        overlay.classList.add('full');

        const isVideo = this.currentCall.type === 'video';
        document.getElementById('localVideo').style.display = isVideo ? 'block' : 'none';
        document.getElementById('remoteVideo').style.display = isVideo ? 'block' : 'none';
        document.getElementById('callAvatarsGrid').style.display = isVideo ? 'none' : 'flex';
    }

    minimizeCall() {
        const overlay = document.getElementById('activeCallOverlay');
        overlay.classList.toggle('minimized');
        overlay.classList.toggle('full');
    }

    // fetchCallHistory consolidated to earlier definition


    quickCall(user, type = 'voice') {
        this.currentTargetUser = user;
        this.initiateCall(type);
    }

    closeModal(id) {
        document.getElementById(id).classList.add('hidden');
    }

    generateCallLink() {
        const callId = Math.random().toString(36).substring(2, 11);
        const link = `${window.location.origin}/call/${callId}`;
        
        const modal = document.getElementById('callLinkModal');
        const input = document.getElementById('generatedCallLink');
        if (modal && input) {
            input.value = link;
            modal.classList.remove('hidden');
        }

        // Keep existing logic for sharing in current chat
        if (this.currentConversation) {
            this.socket.emit('send_message', {
                conversationId: this.currentConversation,
                targetUser: this.currentTargetUser,
                type: 'text',
                message: `Hey, join my call room: ${link}`
            });
        }
    }

    copyCallLink() {
        const input = document.getElementById('generatedCallLink');
        input.select();
        document.execCommand('copy');
        this.showToast('Copied', 'Call link copied to clipboard!');
    }

    showNewCallModal() {
        document.getElementById('newCallModal').classList.remove('hidden');
        this.renderCallContacts();
    }

    renderCallContacts(users) {
        const container = document.getElementById('callContactsList');
        if (!container) return;
        const sourceList = users || this.allContacts.filter(u => u.username !== this.currentUser);
        container.innerHTML = '';
        sourceList.forEach(u => {
            const div = document.createElement('div');
            div.className = 'contact-item';
            div.innerHTML = `
                <div class="contact-avatar-wrap">
                    <img src="https://ui-avatars.com/api/?name=${u.username}&background=random&color=fff" class="contact-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.username)}&background=random&color=fff'">
                </div>
                <div class="contact-details">
                    <div class="contact-name">${u.username}</div>
                </div>
                <div class="call-options">
                    <button class="icon-btn" onclick="nexChat.closeModal('newCallModal'); nexChat.quickCall('${u.username}', 'voice')" title="Voice Call"><i class="fas fa-phone"></i></button>
                    <button class="icon-btn" onclick="nexChat.closeModal('newCallModal'); nexChat.quickCall('${u.username}', 'video')" title="Video Call"><i class="fas fa-video"></i></button>
                    <button class="icon-btn" onclick="nexChat.closeModal('newCallModal'); nexChat.currentTargetUser = '${u.username}'; nexChat.openScheduleCallModal()" title="Schedule Call"><i class="fas fa-calendar-alt"></i></button>
                </div>
            `;
            container.appendChild(div);
        });
    }

    filterCallContacts(q) {
        const filtered = this.allContacts.filter(u => 
            u.username !== this.currentUser && u.username.toLowerCase().includes(q.toLowerCase())
        );
        this.renderCallContacts(filtered);
    }

    openScheduleCallModal() {
        if (!this.currentTargetUser) return this.showToast('Error', 'Select a contact to schedule a call');
        
        // Populate current time as default
        const now = new Date();
        const startD = document.getElementById('scheduleStartDate');
        const startT = document.getElementById('scheduleStartTime');
        if (startD) startD.value = now.toISOString().split('T')[0];
        if (startT) startT.value = now.toTimeString().slice(0, 5);

        const title = document.getElementById('scheduleCallTitle');
        if (title) title.textContent = `Call with ${this.currentTargetUser}`;

        document.getElementById('scheduleCallModal').classList.remove('hidden');
    }


    startCallTimer() {
        this.callStartTime = Date.now();
        this.callInterval = setInterval(() => {
            const elapsed = Date.now() - this.callStartTime;
            const seconds = Math.floor(elapsed / 1000);
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            document.getElementById('callDuration').textContent = 
                `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }, 1000);
    }

    stopCallTimer() {
        if (this.callInterval) clearInterval(this.callInterval);
        this.callInterval = null;
    }

    toggleCallAudio() {
        if (!this.localStream) return;
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const btn = document.getElementById('toggleMuteBtn');
            btn.innerHTML = audioTrack.enabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
            btn.classList.toggle('active', !audioTrack.enabled);
        }
    }

    formatContactTime(date) {
        if (!date) return '';
        const now = new Date();
        const d = new Date(date);
        
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const yesterday = new Date();
        yesterday.setDate(now.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
        
        const diff = now - d;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
        
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    playNotificationSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.exponentialRampToValueAtTime(880.00, ctx.currentTime + 0.1); // A5
            
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        } catch (e) {
            console.warn('Audio feedback failed', e);
        }
    }

    updatePageTitle() {
        const totalUnread = Object.values(this.unreadCounts).reduce((sum, count) => sum + count, 0);
        document.title = totalUnread > 0 ? `(${totalUnread}) NexChat` : 'NexChat';
    }

    toggleCallVideo() {
        if (!this.localStream) return;
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.getElementById('toggleVideoBtn');
            btn.innerHTML = videoTrack.enabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
            btn.classList.toggle('active', !videoTrack.enabled);
        }
    }

    initResizers() {
        let isResizingSidebar = false;
        let isResizingInfo = false;

        if (this.sidebarResizer) {
            this.sidebarResizer.addEventListener('mousedown', (e) => {
                isResizingSidebar = true;
                document.body.style.cursor = 'col-resize';
                this.sidebarResizer.classList.add('resizing');
                e.preventDefault();
            });
        }

        if (this.infoResizer) {
            this.infoResizer.addEventListener('mousedown', (e) => {
                isResizingInfo = true;
                document.body.style.cursor = 'col-resize';
                this.infoResizer.classList.add('resizing');
                e.preventDefault();
            });
        }

        document.addEventListener('mousemove', (e) => {
            if (isResizingSidebar) {
                let newWidth = e.clientX;
                // Account for app-nav-sidebar width (72px)
                newWidth -= 72; 
                if (newWidth > 200 && newWidth < 500) {
                    document.documentElement.style.setProperty('--sidebar-w', `${newWidth}px`);
                }
            }
            if (isResizingInfo) {
                let newWidth = window.innerWidth - e.clientX;
                if (newWidth > 200 && newWidth < 500) {
                    document.documentElement.style.setProperty('--info-w', `${newWidth}px`);
                }
            }
        });

        document.addEventListener('mouseup', () => {
            isResizingSidebar = false;
            isResizingInfo = false;
            document.body.style.cursor = 'default';
            if (this.sidebarResizer) this.sidebarResizer.classList.remove('resizing');
            if (this.infoResizer) this.infoResizer.classList.remove('resizing');
        });
    }
}

// Initialize Application
let nexChat;
document.addEventListener('DOMContentLoaded', async () => {
    await initializeAppConfig();
    nexChat = new NexChatApp();
});
