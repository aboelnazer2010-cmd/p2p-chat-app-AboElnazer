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
const channelBtns = document.querySelectorAll('.chat-channel');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const membersBtn = document.getElementById('members-btn');
const mobileOverlay = document.getElementById('mobile-overlay');
const sidebarLeft = document.querySelector('.sidebar-left');
const sidebarRight = document.querySelector('.sidebar-right');

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
    myIdEls.innerText = myId;

    const magicLink = `${window.location.origin}${window.location.pathname}#${myId}`;
    magicLinkInput.value = magicLink;

    // LAN-First approach: Forcing local connection by removing external STUN servers.
    // This tells WebRTC not to query external servers for public IPs.
    peer = new Peer(myId, {
        debug: 1,
        config: {
            'iceServers': [] // Empty array forces local host candidates (LAN only)
        }
    });

    peer.on('open', (id) => {
        statusEl.innerText = 'Ready.';
        updateMembersList([{ id: myId, name: myName + ' (Me)', avatar: myAvatar }]);
        checkHashForAutoConnect();
    });

    peer.on('connection', (connection) => {
        isHost = true;
        handleHostConnection(connection);
    });

    peer.on('error', (err) => {
        console.error(err);
        statusEl.innerText = `Error: ${err.type}`;
        statusEl.style.color = '#ef4444';
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
    statusEl.innerText = `Joining...`;

    isHost = false;

    const connection = peer.connect(targetId, { reliable: true });

    connection.on('open', () => {
        hostConnection = connection;
        statusEl.innerText = 'Connected!';
        statusEl.style.color = 'var(--green)';

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
        statusEl.innerText = 'Disconnected.';
        hostConnection = null;
    });
}

function handleHostConnection(connection) {
    connection.on('open', () => {
        clientConnections[connection.peer] = { conn: connection, name: 'Unknown', avatar: '' };
        statusEl.innerText = `Hosting (${Object.keys(clientConnections).length} peers)`;
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
        statusEl.innerText = `Hosting (${Object.keys(clientConnections).length} peers)`;

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
                broadcast(data, senderPeerId); // Relay to other clients
            }
        } else {
            // As a client, we just receive the system message from host when someone changes name, 
            // but the host will send down a new 'peer-list' to update the right sidebar anyway.
            // If the host changed their *own* name, we'll see it in the next peer-list.
            if (data.senderId === hostConnection.peer) {
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
    downloadsList.prepend(downloadItem);

    saveMessageToHistory(fileState.channel, `Shared a file: <strong>${fileState.meta.name}</strong>`, fileState.senderName, '', new Date());
    if (currentChannel === fileState.channel) renderChatHistory();
    else showToast(`Received file in #${fileState.channel}`);

    delete incomingFiles[senderId];
}

function sendMessage() {
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
    channelTitle.innerText = channelName === 'General' ? '🌍 General' : `# ${channelName}`;
    breadcrumbActive.innerText = channelName === 'General' ? '🌍 General' : `# ${channelName}`;

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
    transferFilename.innerText = filename;
    transferPercentage.innerText = `${percentage}%`;
    transferProgress.style.width = `${percentage}%`;
    transferContainer.classList.remove('hidden');
}

function updateTransferProgress(percentage) {
    transferPercentage.innerText = `${percentage}%`;
    transferProgress.style.width = `${percentage}%`;
}

function hideTransferProgress() {
    transferContainer.classList.add('hidden');
    transferProgress.style.width = '0%';
}

function showToast(message) {
    toaster.innerText = message;
    toaster.classList.add('show');
    setTimeout(() => { toaster.classList.remove('show'); }, 2500);
}

function updateMembersList(list) {
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
            channelList.classList.toggle('hidden-collapse');
            showToast('Toggled team folder.');
        });
    });

    document.querySelectorAll('.left-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.left-nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            showToast(`Navigated to: ${item.innerText}`);
        });
    });

    // Mobile Sidebar Toggles
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebarLeft.classList.toggle('show');
            mobileOverlay.classList.toggle('show');
            sidebarRight.classList.remove('show');
        });
    }

    if (membersBtn) {
        membersBtn.addEventListener('click', () => {
            sidebarRight.classList.toggle('show');
            sidebarLeft.classList.remove('show');
            // Show overlay on mobile, but maybe not strictly necessary on tablet, 
            // but let's toggle it anyway for consistency on small screens
            if (window.innerWidth <= 1024) {
                mobileOverlay.classList.add('show');
            }
        });
    }

    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', () => {
            sidebarLeft.classList.remove('show');
            sidebarRight.classList.remove('show');
            mobileOverlay.classList.remove('show');
        });
    }

    // Mobile specific: click a channel -> hide left sidebar automatically
    channelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebarLeft.classList.remove('show');
                mobileOverlay.classList.remove('show');
            }
        });
    });

    // Mockup action buttons
    document.getElementById('workspace-dropdown').addEventListener('click', () => showToast('Workspace Menu Opened'));
    document.getElementById('quick-add-room-btn').addEventListener('click', () => showToast('Create Chatroom Dialog...'));
    document.getElementById('add-channel-1').addEventListener('click', (e) => { e.preventDefault(); showToast('Add Channel to UX & UI Team'); });
    document.getElementById('add-channel-2').addEventListener('click', (e) => { e.preventDefault(); showToast('Add Channel to 3D Team'); });
    document.getElementById('settings-btn').addEventListener('click', (e) => { e.preventDefault(); showToast('Opening Settings...'); });
    document.getElementById('user-profile-btn').addEventListener('click', () => showToast('Opening Profile Details...'));
    document.getElementById('record-btn').addEventListener('click', () => showToast('Starting Screen Recorder component...'));

    document.getElementById('bc-back').addEventListener('click', () => showToast('Navigate Back'));
    document.getElementById('bc-fwd').addEventListener('click', () => showToast('Navigate Forward'));
    document.getElementById('bc-close').addEventListener('click', () => showToast('Closing Workspace...'));
    document.getElementById('pin-btn').addEventListener('click', () => showToast('Pinned Messages Dialog'));
    document.getElementById('thread-btn').addEventListener('click', () => showToast('Threads Sidebar Opened'));
    document.getElementById('search-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') showToast(`Searching for: ${e.target.value}`) });

    document.getElementById('mic-btn').addEventListener('click', () => showToast('Voice memo recording started...'));
    document.getElementById('at-btn').addEventListener('click', () => { msgInput.value += '@'; msgInput.focus(); });

    // Emoji Picker Logic
    emojiBtn.addEventListener('click', () => emojiPicker.classList.toggle('hidden'));
    emojiPicker.querySelectorAll('span').forEach(emoji => {
        emoji.addEventListener('click', () => {
            msgInput.value += emoji.innerText;
            emojiPicker.classList.add('hidden');
            msgInput.focus();
        });
    });

    // Core Interaction Listeners
    copyLinkBtn.addEventListener('click', () => {
        magicLinkInput.select();
        document.execCommand('copy');
        showToast('Magic Link Copied!');
    });

    connectBtn.addEventListener('click', () => connectToHost(targetIdInput.value.trim().toUpperCase()));
    sendMsgBtn.addEventListener('click', sendMessage);
    msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', sendFile);

    // Profile Name Editing Logic
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
            const oldName = myName;
            myName = newName;
            showToast(`Name updated to ${myName}`);

            // Re-render local members list to show my new name immediately
            if (isHost) syncPeerList();
            else {
                // Hack to just update the local UI before the Host syncs back
                membersList.querySelector('.member-item').title = myName;
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

// Run
init();
