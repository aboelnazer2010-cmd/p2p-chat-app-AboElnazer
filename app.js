const CHUNK_SIZE = 16384;
let peer = null;

// Star Topology State
let isHost = true;
let hostConnection = null;
let clientConnections = {};

let myId = '';
let myName = 'Brandon Franci';
const myAvatar = `https://i.pravatar.cc/150?img=11`;

// UI State
let currentChannel = 'General';
const channelHistories = {
    'General': [],
    'Social Media Thread': [],
    'Meme': [],
    'Awokwokwk': [],
    '3D General': []
};

// DOM Elements
const myIdEls = document.getElementById('my-id');
const magicLinkInput = document.getElementById('magic-link');
const copyLinkBtn = document.getElementById('copy-link-btn');
const targetIdInput = document.getElementById('target-id');
const connectBtn = document.getElementById('connect-btn');
const statusEl = document.getElementById('connection-status');
const chatBox = document.getElementById('chat-box');
const msgInput = document.getElementById('message-input');
const sendMsgBtn = document.getElementById('send-msg-btn');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const transferContainer = document.getElementById('transfer-container');
const transferFilename = document.getElementById('transfer-filename');
const transferPercentage = document.getElementById('transfer-percentage');
const transferProgress = document.getElementById('transfer-progress');
const downloadsList = document.getElementById('downloads');
const membersList = document.getElementById('members-list');

// Interactive UI Elements
const toaster = document.getElementById('toaster');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const channelTitle = document.getElementById('current-channel-title');
const breadcrumbActive = document.getElementById('breadcrumb-active'); // تمت إضافة هذا المتغير لتجنب الخطأ
const channelBtns = document.querySelectorAll('.chat-channel');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const membersBtn = document.getElementById('members-btn');
const mobileOverlay = document.getElementById('mobile-overlay');
const sidebarLeft = document.querySelector('.sidebar-left');
const sidebarRight = document.querySelector('.sidebar-right');
const myNameDisplay = document.getElementById('my-name-display'); // 💡 إصلاح هام: هذا المتغير كان مفقوداً وسيسبب عطلاً عند تغيير الاسم

let incomingFiles = {};

function generateId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 3; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function init() {
    myId = generateId();
    if(myIdEls) myIdEls.innerText = myId;

    const magicLink = `${window.location.origin}${window.location.pathname}#${myId}`;
    if(magicLinkInput) magicLinkInput.value = magicLink;

    // 💡 التحديث الأهم: إضافة خوادم STUN لاختراق جدار الحماية للراوتر والعمل عبر الإنترنت
    peer = new Peer(myId, { 
        debug: 1,
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        }
    });

    peer.on('open', (id) => {
        if(statusEl) statusEl.innerText = 'Ready.';
        updateMembersList([{ id: myId, name: myName + ' (Me)', avatar: myAvatar }]);
        checkHashForAutoConnect();
    });

    peer.on('connection', (connection) => {
        isHost = true;
        handleHostConnection(connection);
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        if(statusEl) {
            statusEl.innerText = `Error: ${err.type}`;
            statusEl.style.color = '#ef4444';
        }
        showToast(`Connection Error: ${err.type}`); // إظهار الخطأ للمستخدم
    });

    renderChatHistory();
    setupUIInteractions();
}

function checkHashForAutoConnect() {
    if (window.location.hash) {
        let targetId = window.location.hash.substring(1).toUpperCase();
        if (targetId.length === 3 && targetId !== myId) {
            connectToHost(targetId);
        }
    }
}

function connectToHost(targetId) {
    if (!targetId || targetId === myId) return;
    if(statusEl) statusEl.innerText = `Joining...`;

    isHost = false;

    const connection = peer.connect(targetId, { reliable: true });

    connection.on('open', () => {
        hostConnection = connection;
        if(statusEl) {
            statusEl.innerText = 'Connected!';
            statusEl.style.color = 'var(--green)';
        }

        connection.send({
            type: 'join',
            senderId: myId,
            senderName: myName,
            senderAvatar: myAvatar
        });

        systemNotice(`Joined room <strong>${targetId}</strong>`, 'General');
    });

    connection.on('data', (data) => handleData(data, connection.peer));

    connection.on('close', () => {
        systemNotice('Host disconnected. Room closed.', currentChannel);
        if(statusEl) statusEl.innerText = 'Disconnected.';
        hostConnection = null;
    });
}

function handleHostConnection(connection) {
    connection.on('open', () => {
        clientConnections[connection.peer] = { conn: connection, name: 'Unknown', avatar: '' };
        if(statusEl) statusEl.innerText = `Hosting (${Object.keys(clientConnections).length} peers)`;
    });

    connection.on('data', (data) => {
        if (data.type === 'join') {
            clientConnections[connection.peer].name = data.senderName;
            clientConnections[connection.peer].avatar = data.senderAvatar;

            systemNotice(`<strong>${data.senderName}</strong> joined the room.`, 'General');

            broadcast({
                type: 'system',
                text: `<strong>${data.senderName}</strong> joined.`,
                channel: 'General'
            }, connection.peer);

            syncPeerList();
        } else {
            handleData(data, connection.peer);
            broadcast(data, connection.peer);
        }
    });

    connection.on('close', () => {
        const peerName = clientConnections[connection.peer]?.name || connection.peer;
        delete clientConnections[connection.peer];
        if(statusEl) statusEl.innerText = `Hosting (${Object.keys(clientConnections).length} peers)`;

        systemNotice(`<strong>${peerName}</strong> left.`, currentChannel);
        broadcast({ type: 'system', text: `<strong>${peerName}</strong> left.`, channel: currentChannel }, connection.peer);
        syncPeerList();
    });
}

function broadcast(data, excludePeerId = null) {
    Object.keys(clientConnections).forEach(peerId => {
        if (peerId !== excludePeerId) {
            const c = clientConnections[peerId].conn;
            if (c && c.open) {
                c.send(data);
            }
        }
    });
}

function syncPeerList() {
    const list = [{ id: myId, name: myName + ' (Host)', avatar: myAvatar }];
    Object.keys(clientConnections).forEach(pid => {
        list.push({
            id: pid,
            name: clientConnections[pid].name,
            avatar: clientConnections[pid].avatar
        });
    });

    updateMembersList(list);
    broadcast({ type: 'peer-list', list: list });
}

function handleData(data, senderPeerId) {
    if (data.type === 'chat') {
        saveMessageToHistory(data.channel, data.text, data.senderName, data.senderAvatar, new Date(data.timestamp));
        if (currentChannel === data.channel) renderChatHistory();
        else showToast(`New message in #${data.channel}`);
    } else if (data.type === 'system') {
        systemNotice(data.text, data.channel || 'General');
    } else if (data.type === 'peer-list' && !isHost) {
        updateMembersList(data.list);
    } else if (data.type === 'file-meta') {
        incomingFiles[data.senderId] = {
            meta: data.meta,
            chunks: [],
            receivedBytes: 0,
            senderName: data.senderName,
            channel: data.channel
        };
        showTransferProgress(data.meta.name, 0);
    } else if (data.type === 'file-chunk') {
        const fileState = incomingFiles[data.senderId];
        if (!fileState) return;

        fileState.chunks.push(data.chunk);
        fileState.receivedBytes += data.chunk.byteLength;
        const progress = Math.round((fileState.receivedBytes / fileState.meta.size) * 100);

        updateTransferProgress(progress);

        if (fileState.receivedBytes === fileState.meta.size) {
            hideTransferProgress();
            assembleFile(data.senderId);
        }
    } else if (data.type === 'name-change') {
        if (isHost) {
            if (clientConnections[data.senderId]) {
                const oldName = clientConnections[data.senderId].name;
                clientConnections[data.senderId].name = data.newName;
                systemNotice(`<strong>${oldName}</strong> changed their name to <strong>${data.newName}</strong>`, currentChannel);
                syncPeerList();
                broadcast(data, senderPeerId);
            }
        } else {
            if (data.senderId === hostConnection?.peer) {
                systemNotice(`<strong>Host</strong> changed their name to <strong>${data.newName}</strong>`, currentChannel);
            }
        }
    }
}

function assembleFile(senderId) {
    const fileState = incomingFiles[senderId];
    const blob = new Blob(fileState.chunks, { type: fileState.meta.type });
    const url = URL.createObjectURL(blob);

    const downloadItem = document.createElement('div');
    downloadItem.className = 'download-item';
    downloadItem.innerHTML = `
        <div>📄 <strong>${fileState.meta.name}</strong> <br><small class="text-secondary">From ${fileState.senderName} • ${formatSize(fileState.meta.size)}</small></div>
        <a href="${url}" download="${fileState.meta.name}"><i class="fa-solid fa-download"></i> Download</a>
    `;
    if(downloadsList) downloadsList.prepend(downloadItem);

    saveMessageToHistory(fileState.channel, `Shared a file: <strong>${fileState.meta.name}</strong>`, fileState.senderName, '', new Date());
    if (currentChannel === fileState.channel) renderChatHistory();
    else showToast(`Received file in #${fileState.channel}`);

    delete incomingFiles[senderId];
}

function sendMessage() {
    if(!msgInput) return;
    const text = msgInput.value.trim();
    if (!text) return;

    const msgData = {
        type: 'chat',
        channel: currentChannel,
        senderId: myId,
        senderName: myName,
        senderAvatar: myAvatar,
        text: text,
        timestamp: Date.now()
    };

    saveMessageToHistory(currentChannel, text, myName, myAvatar, new Date());
    renderChatHistory();

    if (isHost) broadcast(msgData);
    else if (hostConnection && hostConnection.open) hostConnection.send(msgData);

    msgInput.value = '';
}

async function sendFile() {
    if(!fileInput) return;
    const file = fileInput.files[0];
    if (!file) return;

    const metaData = {
        type: 'file-meta',
        channel: currentChannel,
        senderId: myId,
        senderName: myName,
        meta: { name: file.name, size: file.size, type: file.type }
    };

    if (isHost) broadcast(metaData);
    else if (hostConnection && hostConnection.open) hostConnection.send(metaData);

    saveMessageToHistory(currentChannel, `Sending file: <strong>${file.name}</strong>`, myName, myAvatar, new Date());
    renderChatHistory();

    const arrayBuffer = await file.arrayBuffer();
    let offset = 0;

    showTransferProgress(file.name, 0);

    while (offset < arrayBuffer.byteLength) {
        const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
        const chunkData = { type: 'file-chunk', senderId: myId, chunk: chunk };

        if (isHost) broadcast(chunkData);
        else if (hostConnection && hostConnection.open) hostConnection.send(chunkData);

        offset += CHUNK_SIZE;
        const progress = Math.round((offset / arrayBuffer.byteLength) * 100);

        updateTransferProgress(Math.min(progress, 100));

        await new Promise(r => setTimeout(r, 5));
    }

    setTimeout(() => hideTransferProgress(), 500);
    fileInput.value = '';
}

// ----------------- UI / CHANNEL LOGIC -----------------
function switchChannel(channelName) {
    currentChannel = channelName;
    if(channelTitle) channelTitle.innerText = channelName === 'General' ? '💬 General' : `# ${channelName}`;
    if(breadcrumbActive) breadcrumbActive.innerText = channelName === 'General' ? '💬 General' : `# ${channelName}`;

    channelBtns.forEach(btn => {
        if (btn.dataset.channel === channelName) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    renderChatHistory();
    showToast(`Switched to ${channelName}`);
}

function saveMessageToHistory(channel, text, sender, avatarUrl, date) {
    if (!channelHistories[channel]) channelHistories[channel] = [];
    channelHistories[channel].push({ text, sender, avatarUrl, date, type: 'chat' });
}

function systemNotice(text, channel) {
    if (!channelHistories[channel]) channelHistories[channel] = [];
    channelHistories[channel].push({ text, type: 'system' });
    if (channel === currentChannel) renderChatHistory();
}

function renderChatHistory() {
    if(!chatBox) return;
    chatBox.innerHTML = '<div class="date-divider"><span>Today</span></div>';

    const history = channelHistories[currentChannel] || [];

    if (history.length === 0) {
        chatBox.innerHTML += `<div class="system-message"><div class="sys-text">This is the beginning of the <strong>${currentChannel}</strong> channel history.</div></div>`;
    }

    history.forEach(msg => {
        if (msg.type === 'system') {
            chatBox.innerHTML += `
            <div class="system-message">
                <img src="https://ui-avatars.com/api/?name=System&background=e2e8f0&color=6b7280" class="sys-avatar">
                <div class="sys-text">${msg.text}</div>
            </div>`;
        } else {
            const timeStr = msg.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const safeAvatar = msg.avatarUrl || `https://ui-avatars.com/api/?name=${msg.sender}&background=random`;
            chatBox.innerHTML += `
            <div class="message-group">
                <img src="${safeAvatar}" class="msg-avatar">
                <div class="msg-content">
                    <div class="msg-header">
                        <span class="sender-name">${msg.sender}</span>
                        <span class="msg-time">${timeStr}</span>
                    </div>
                    <div class="msg-text">${msg.text}</div>
                </div>
            </div>`;
        }
    });

    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTransferProgress(filename, percentage) {
    if(transferFilename) transferFilename.innerText = filename;
    if(transferPercentage) transferPercentage.innerText = `${percentage}%`;
    if(transferProgress) transferProgress.style.width = `${percentage}%`;
    if(transferContainer) transferContainer.classList.remove('hidden');
}

function updateTransferProgress(percentage) {
    if(transferPercentage) transferPercentage.innerText = `${percentage}%`;
    if(transferProgress) transferProgress.style.width = `${percentage}%`;
}

function hideTransferProgress() {
    if(transferContainer) transferContainer.classList.add('hidden');
    if(transferProgress) transferProgress.style.width = '0%';
}

function showToast(message) {
    if(!toaster) return;
    toaster.innerText = message;
    toaster.classList.add('show');
    setTimeout(() => { toaster.classList.remove('show'); }, 2500);
}

function updateMembersList(list) {
    if(!membersList) return;
    membersList.innerHTML = '';
    list.forEach(member => {
        const safeAvatar = member.avatar || `https://ui-avatars.com/api/?name=${member.name}&background=random`;
        membersList.innerHTML += `
            <div class="member-item" title="${member.name}">
                <div class="avatar-wrapper">
                    <img src="${safeAvatar}" class="member-avatar">
                    <span class="status-dot green"></span>
                </div>
            </div>`;
    });
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ----------------- UI BUTTON WIRING -----------------
function setupUIInteractions() {
    channelBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            switchChannel(btn.dataset.channel);
        });
    });

    document.querySelectorAll('.toggle-team').forEach(header => {
        header.addEventListener('click', () => {
            const channelList = header.nextElementSibling;
            if(channelList) channelList.classList.toggle('hidden-collapse');
        });
    });

    document.querySelectorAll('.left-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.left-nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
        });
    });

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            if(sidebarLeft) sidebarLeft.classList.toggle('show');
            if(mobileOverlay) mobileOverlay.classList.toggle('show');
            if(sidebarRight) sidebarRight.classList.remove('show');
        });
    }

    if (membersBtn) {
        membersBtn.addEventListener('click', () => {
            if(sidebarRight) sidebarRight.classList.toggle('show');
            if(sidebarLeft) sidebarLeft.classList.remove('show');
            if (window.innerWidth <= 1024 && mobileOverlay) {
                mobileOverlay.classList.add('show');
            }
        });
    }

    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', () => {
            if(sidebarLeft) sidebarLeft.classList.remove('show');
            if(sidebarRight) sidebarRight.classList.remove('show');
            mobileOverlay.classList.remove('show');
        });
    }

    channelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                if(sidebarLeft) sidebarLeft.classList.remove('show');
                if(mobileOverlay) mobileOverlay.classList.remove('show');
            }
        });
    });

    // إضافة حماية للبحث عن الأزرار قبل إضافة أحداث لها لتجنب أخطاء الواجهة
    const safeAddListener = (id, event, callback) => {
        const el = document.getElementById(id);
        if(el) el.addEventListener(event, callback);
    };

    safeAddListener('workspace-dropdown', 'click', () => showToast('Workspace Menu Opened'));
    safeAddListener('quick-add-room-btn', 'click', () => showToast('Create Chatroom Dialog...'));
    safeAddListener('add-channel-1', 'click', (e) => { e.preventDefault(); showToast('Add Channel to UX & UI Team'); });
    safeAddListener('add-channel-2', 'click', (e) => { e.preventDefault(); showToast('Add Channel to 3D Team'); });
    safeAddListener('settings-btn', 'click', (e) => { e.preventDefault(); showToast('Opening Settings...'); });
    safeAddListener('user-profile-btn', 'click', () => showToast('Opening Profile Details...'));
    safeAddListener('record-btn', 'click', () => showToast('Starting Screen Recorder component...'));
    safeAddListener('bc-back', 'click', () => showToast('Navigate Back'));
    safeAddListener('bc-fwd', 'click', () => showToast('Navigate Forward'));
    safeAddListener('bc-close', 'click', () => showToast('Closing Workspace...'));
    safeAddListener('pin-btn', 'click', () => showToast('Pinned Messages Dialog'));
    safeAddListener('thread-btn', 'click', () => showToast('Threads Sidebar Opened'));
    safeAddListener('search-input', 'keypress', (e) => { if (e.key === 'Enter') showToast(`Searching for: ${e.target.value}`) });
    safeAddListener('mic-btn', 'click', () => showToast('Voice memo recording started...'));
    
    safeAddListener('at-btn', 'click', () => { 
        if(msgInput) { msgInput.value += '@'; msgInput.focus(); } 
    });

    if (emojiBtn && emojiPicker) {
        emojiBtn.addEventListener('click', () => emojiPicker.classList.toggle('hidden'));
        emojiPicker.querySelectorAll('span').forEach(emoji => {
            emoji.addEventListener('click', () => {
                if(msgInput) {
                    msgInput.value += emoji.innerText;
                    msgInput.focus();
                }
                emojiPicker.classList.add('hidden');
            });
        });
    }

    safeAddListener('copy-link-btn', 'click', () => {
        if(magicLinkInput) {
            magicLinkInput.select();
            document.execCommand('copy');
            showToast('Magic Link Copied!');
        }
    });

    safeAddListener('connect-btn', 'click', () => {
        if(targetIdInput) connectToHost(targetIdInput.value.trim().toUpperCase());
    });
    
    safeAddListener('send-msg-btn', 'click', sendMessage);
    safeAddListener('message-input', 'keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    safeAddListener('attach-btn', 'click', () => { if(fileInput) fileInput.click(); });
    safeAddListener('file-input', 'change', sendFile);

    // Profile Name Editing Logic
    if (myNameDisplay) {
        myNameDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                myNameDisplay.blur();
            }
        });

        myNameDisplay.addEventListener('blur', () => {
            const newName = myNameDisplay.innerText.trim() || 'Anonymous';
            myNameDisplay.innerText = newName;

            if (newName !== myName) {
                myName = newName;
                showToast(`Name updated to ${myName}`);

                if (isHost) syncPeerList();
                else {
                    const myMemberItem = membersList?.querySelector(`.member-item[title*="(Me)"]`);
                    if(myMemberItem) myMemberItem.title = myName + ' (Me)';
                }

                const nameChangeData = {
                    type: 'name-change',
                    senderId: myId,
                    newName: myName
                };

                if (isHost) broadcast(nameChangeData);
                else if (hostConnection && hostConnection.open) hostConnection.send(nameChangeData);

                systemNotice(`You changed your name to <strong>${myName}</strong>`, currentChannel);
            }
        });
    }
}

// Run
init();
