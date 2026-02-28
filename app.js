// زادت حجم القطعة لسرعة أكبر (512KB)
const CHUNK_SIZE = 524288; // 512KB

let peer = null;

// بنية الشبكة (Star Topology)
let isHost = true;
let hostConnection = null;
let clientConnections = {};

let myId = '';
let myName = 'Brandon Franci';
const myAvatar = `https://i.pravatar.cc/150?img=11`;

// حالة واجهة المستخدم وسجل الدردشة
let currentChannel = 'General';
let channelHistories = {
    'General': [],
    'Social Media Thread': [],
    'Meme': [],
    'Awokwokwk': [],
    '3D General': []
};

// عناصر DOM
const myIdEls = document.getElementById('my-id');
const magicLinkInput = document.getElementById('magic-link');
const copyLinkBtn = document.getElementById('copy-link-btn');
const targetIdInput = document.getElementById('target-id');
const connectBtn = document.getElementById('connect-btn');
const statusEl = document.getElementById('connection-status');
const setupScreen = document.getElementById('setup-screen');
const mainApp = document.getElementById('main-app');

const chatBox = document.getElementById('chat-box');
const msgInput = document.getElementById('message-input');
const sendMsgBtn = document.getElementById('send-msg-btn');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const searchInput = document.querySelector('.search-box input'); // شريط البحث

// عناصر شريط التقدم
const transferContainer = document.getElementById('transfer-container');
const transferFilename = document.getElementById('transfer-filename');
const transferPercentage = document.getElementById('transfer-percentage');
const transferProgress = document.getElementById('transfer-progress');

const downloadsList = document.getElementById('downloads');
const membersList = document.getElementById('members-list');
const toaster = document.getElementById('toaster');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const channelTitle = document.getElementById('current-channel-title');
const breadcrumbActive = document.getElementById('breadcrumb-active');

let incomingFiles = {};
let transferItems = {}; // { id: {container, filenameEl, percentEl, fillEl} }

function setTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    }
}

function updateDarkModeButton() {
    const sel = document.getElementById('theme-selector');
    if (!sel) return;
    sel.value = document.documentElement.getAttribute('data-theme') || 'light';
}

function generateId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 3; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

function init() {
    // apply saved theme before rendering
    const saved = localStorage.getItem('theme');
    if (saved) setTheme(saved);

    myId = generateId();
    if (myIdEls) myIdEls.innerText = myId;

    const magicLink = `${window.location.origin}${window.location.pathname}#${myId}`;
    if (magicLinkInput) magicLinkInput.value = magicLink;

    // خوادم جوجل لضمان الاتصال عبر الإنترنت
    peer = new Peer(myId, {
        config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    peer.on('open', (id) => {
        if (statusEl) statusEl.innerText = 'Ready for connection.';
        updateMembersList([{ id: myId, name: myName + ' (Me)', avatar: myAvatar, role: 'Host' }]);
        checkHashForAutoConnect();
    });

    peer.on('connection', (connection) => {
        isHost = true;
        handleHostConnection(connection);
        if (!setupScreen.classList.contains('hidden')) showMainApp();
    });

    peer.on('error', (err) => {
        console.error(err);
        if (statusEl) statusEl.innerText = `Error: ${err.type}`;
        showToast(`Error: ${err.type}`);
    });

    renderChatHistory();
    setupUIInteractions();
    updateDarkModeButton();
}

function showMainApp() {
    setupScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    // update displayed name if changed before showing the UI
    const userNameSpan = document.getElementById('user-name');
    if (userNameSpan) userNameSpan.innerText = myName;
    // also update dark mode button icon state
    updateDarkModeButton();
}

function checkHashForAutoConnect() {
    if (window.location.hash) {
        let targetId = window.location.hash.substring(1).toUpperCase();
        if (targetId.length === 3 && targetId !== myId) connectToHost(targetId);
    }
}

function connectToHost(targetId) {
    if (!targetId || targetId === myId) return;
    if (statusEl) statusEl.innerText = `Joining room ${targetId}...`;

    isHost = false;
    const connection = peer.connect(targetId, { reliable: true });

    connection.on('open', () => {
        hostConnection = connection;
        showMainApp();
        safeSend(connection, { type: 'join', senderId: myId, senderName: myName, senderAvatar: myAvatar });
        systemNotice(`Joined room <strong>${targetId}</strong>`, 'General');
    });

    connection.on('data', (data) => handleData(data, connection.peer));

    connection.on('close', () => {
        systemNotice('Host disconnected. Room closed.', currentChannel);
        showToast('Host disconnected.');
        hostConnection = null;
    });
}

function handleHostConnection(connection) {
    connection.on('open', () => {
        clientConnections[connection.peer] = { conn: connection, name: 'Unknown', avatar: '' };
    });

    connection.on('data', (data) => {
        if (data.type === 'join') {
            clientConnections[connection.peer].name = data.senderName;
            clientConnections[connection.peer].avatar = data.senderAvatar;

            // 💡 تحديث خطير: المضيف يرسل للمستخدم الجديد كل تاريخ المحادثات والقنوات!
            safeSend(connection, { type: 'sync-state', histories: channelHistories });

            systemNotice(`<strong>${data.senderName}</strong> joined.`, 'General');
            broadcast({ type: 'system', text: `<strong>${data.senderName}</strong> joined.`, channel: 'General' }, connection.peer);
            syncPeerList();
        } else if (data.type === 'name-change') {
            // أحد العملاء طلب تغيير اسمه
            const { peerId, oldName, newName } = data;
            if (clientConnections[peerId]) {
                clientConnections[peerId].name = newName;
                // نرسل إشعاراً للجميع
                systemNotice(`<strong>${oldName}</strong> changed name to <strong>${newName}</strong>.`, currentChannel);
                // نشر التغيير حتى يرى جميع العملاء
                broadcast({ type: 'name-change', peerId, oldName, newName });
                syncPeerList();
            }
        } else {
            handleData(data, connection.peer);
            broadcast(data, connection.peer); // المضيف يعيد توجيه الرسائل والملفات للجميع
        }
    });

    connection.on('close', () => {
        const peerName = clientConnections[connection.peer]?.name || connection.peer;
        delete clientConnections[connection.peer];
        systemNotice(`<strong>${peerName}</strong> left.`, currentChannel);
        broadcast({ type: 'system', text: `<strong>${peerName}</strong> left.`, channel: currentChannel }, connection.peer);
        syncPeerList();
    });
}

// 🚀 خوارزمية الإرسال الآمن (تم تعديلها لأقصى سرعة)
async function safeSend(conn, data) {
    if (!conn || !conn.open || !conn.dataChannel) return;
    
    // رفع مساحة الاستيعاب إلى 16 ميجابايت (16 * 1024 * 1024)
    // وتقليل وقت الانتظار إلى 1 ملي ثانية للحد من التأخير
    while (conn.dataChannel.bufferedAmount > 16 * 1024 * 1024) {
        await new Promise(r => setTimeout(r, 1));
    }
    conn.send(data);
}

async function broadcast(data, excludePeerId = null) {
    for (let peerId of Object.keys(clientConnections)) {
        if (peerId !== excludePeerId) {
            await safeSend(clientConnections[peerId].conn, data);
        }
    }
}

function syncPeerList() {
    const list = [{ id: myId, name: myName + ' (Host)', avatar: myAvatar, role: 'Host' }];
    Object.keys(clientConnections).forEach(pid => {
        list.push({ id: pid, name: clientConnections[pid].name, avatar: clientConnections[pid].avatar, role: 'Member' });
    });
    updateMembersList(list);
    broadcast({ type: 'peer-list', list: list });
}

function handleData(data, senderPeerId) {
    if (data.type === 'chat') {
        saveMessageToHistory(data.channel, data.text, data.senderName, data.senderAvatar, new Date(data.timestamp), data.senderId);
        if (currentChannel === data.channel) renderChatHistory();
        else showToast(`New message in # ${data.channel}`);
        // تشغيل صوت التنبيه
        if (data.senderId !== myId) new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(() => { });

    } else if (data.type === 'system') {
        systemNotice(data.text, data.channel || 'General');

    } else if (data.type === 'peer-list' && !isHost) {
        updateMembersList(data.list);

    } else if (data.type === 'name-change') {
        if (!isHost) {
            // update member entry immediately in case peer-list hasn't arrived yet
            const item = membersList?.querySelector(`[data-peer-id="${data.peerId}"] .member-name`);
            if (item) item.innerText = data.newName;
            systemNotice(`<strong>${data.oldName}</strong> changed name to <strong>${data.newName}</strong>.`, currentChannel);
        }
    } else if (data.type === 'sync-state' && !isHost) {
        // استلام تاريخ المحادثات والقنوات الجديدة عند الدخول
        channelHistories = data.histories;
        Object.keys(channelHistories).forEach(ch => { if (!document.querySelector(`[data-channel="${ch}"]`)) addChannelToUI(ch, 'UX & UI Team'); });
        renderChatHistory();

    } else if (data.type === 'new-channel') {
        if (!channelHistories[data.name]) channelHistories[data.name] = [];
        addChannelToUI(data.name, 'UX & UI Team');
        showToast(`New channel #${data.name} created!`);

    } else if (data.type === 'file-meta') {
        const fid = data.fileId || `${data.senderId}-unknown`;
        incomingFiles[fid] = { meta: data.meta, chunks: [], receivedBytes: 0, senderName: data.senderName, senderId: data.senderId, channel: data.channel };
        createTransferBar(fid, `Downloading ${data.meta.name}...`);

    } else if (data.type === 'file-chunk') {
        const fid = data.fileId;
        const fileState = incomingFiles[fid];
        if (!fileState) return;
        fileState.chunks.push(data.chunk);
        fileState.receivedBytes += data.chunk.byteLength;

        const progress = Math.round((fileState.receivedBytes / fileState.meta.size) * 100);
        if (progress % 5 === 0 || progress === 100) updateTransferBar(fid, progress);

        if (fileState.receivedBytes === fileState.meta.size) {
            setTimeout(() => removeTransferBar(fid), 500);
            assembleFile(fid);
        }
    }
}

// helper to create preview markup for common file types
function getPreviewHtml(meta, url) {
    if (meta.type.startsWith('image/')) {
        return `<br><img src="${url}" class="file-preview">`;
    } else if (meta.type.startsWith('video/')) {
        return `<br><video src="${url}" class="file-preview" controls></video>`;
    } else if (meta.type === 'application/pdf') {
        return `<br><embed src="${url}" type="application/pdf" width="100%" height="200px">`;
    }
    return '';
}

function assembleFile(fileId) {
    const fileState = incomingFiles[fileId];
    if (!fileState) return;
    const blob = new Blob(fileState.chunks, { type: fileState.meta.type });
    const url = URL.createObjectURL(blob);

    const downloadItem = document.createElement('div');
    downloadItem.className = 'download-item';
    downloadItem.innerHTML = `
        <div><i class="fa-solid fa-file me-2"></i><strong>${fileState.meta.name}</strong> <br><small class="text-muted">From ${fileState.senderName} • ${formatSize(fileState.meta.size)}</small></div>
        <a href="${url}" download="${fileState.meta.name}"><i class="fa-solid fa-download"></i></a>
    `;
    if (downloadsList) downloadsList.prepend(downloadItem);

    const preview = getPreviewHtml(fileState.meta, url);
    saveMessageToHistory(fileState.channel,
        `Shared a file: <strong><a href="${url}" download="${fileState.meta.name}">${fileState.meta.name}</a></strong>${preview}`,
        fileState.senderName, '', new Date(), fileState.senderId);
    if (currentChannel === fileState.channel) renderChatHistory();
    delete incomingFiles[fileId];
}

async function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    const msgData = { type: 'chat', channel: currentChannel, senderId: myId, senderName: myName, senderAvatar: myAvatar, text: text, timestamp: Date.now() };
    saveMessageToHistory(currentChannel, text, myName, myAvatar, new Date(), myId);
    renderChatHistory();

    if (isHost) await broadcast(msgData);
    else await safeSend(hostConnection, msgData);

    msgInput.value = '';
}

// 🚀 نظام إرسال الملفات الخارق
async function sendFile() {
    const files = fileInput.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileId = `${myId}-${Date.now()}-${Math.random().toString(36).substr(2,4)}`;
        const metaData = { type: 'file-meta', channel: currentChannel, senderId: myId, senderName: myName, fileId, meta: { name: file.name, size: file.size, type: file.type } };

        if (isHost) await broadcast(metaData);
        else await safeSend(hostConnection, metaData);

        const localUrl = URL.createObjectURL(file);
        const previewOut = getPreviewHtml(file, localUrl);
        saveMessageToHistory(currentChannel, `Sending file: <strong>${file.name}</strong>${previewOut}`, myName, myAvatar, new Date(), myId);
        renderChatHistory();

        const arrayBuffer = await file.arrayBuffer();
        let offset = 0;
        createTransferBar(fileId, `${file.name} (${i+1}/${files.length})`);

        while (offset < arrayBuffer.byteLength) {
            const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
            const chunkData = { type: 'file-chunk', senderId: myId, fileId, chunk: chunk };

            if (isHost) await broadcast(chunkData);
            else await safeSend(hostConnection, chunkData);

            offset += CHUNK_SIZE;
            const progress = Math.round((offset / arrayBuffer.byteLength) * 100);
            if (progress % 2 === 0 || progress >= 100) updateTransferBar(fileId, Math.min(progress, 100));
        }

        await new Promise(r => setTimeout(r, 300));
        removeTransferBar(fileId);
    }

    fileInput.value = '';
}

// ----------------- NAME CHANGE SUPPORT -----------------

function changeName() {
    const oldName = myName;
    const newName = prompt('Enter your display name:', myName);
    if (!newName || newName.trim() === '' || newName === oldName) return;
    myName = newName.trim();
    // update UI
    const userNameSpan = document.getElementById('user-name');
    if (userNameSpan) userNameSpan.innerText = myName;
    showToast('Name updated');

    if (isHost) {
        // notify local history and others
        systemNotice(`<strong>${oldName}</strong> changed name to <strong>${myName}</strong>.`, currentChannel);
        syncPeerList();
    } else if (hostConnection && hostConnection.open) {
        safeSend(hostConnection, { type: 'name-change', peerId: myId, oldName, newName: myName });
        // update own entry in members list immediately
        const myItem = membersList?.querySelector(`[data-peer-id="${myId}"] .member-name`);
        if (myItem) myItem.innerText = myName;
        // show local notice immediately
        systemNotice(`<strong>You</strong> changed name to <strong>${myName}</strong>.`, currentChannel);
    }
}

// ----------------- UI / CHANNEL LOGIC -----------------
function switchChannel(channelName) {
    currentChannel = channelName;
    const titleText = channelName === 'General' ? '🌍 General' : `# ${channelName}`;
    if (channelTitle) channelTitle.innerHTML = titleText;
    if (breadcrumbActive) breadcrumbActive.innerHTML = titleText;

    document.querySelectorAll('.chat-channel').forEach(btn => {
        if (btn.dataset.channel === channelName) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    renderChatHistory();
}

function addChannelToUI(channelName, teamName) {
    const channelList = document.querySelector('.team-group .channel-list'); // إضافة لأول فريق كافتراضي
    const newBtn = document.createElement('a');
    newBtn.href = "#"; newBtn.className = "chat-channel"; newBtn.dataset.channel = channelName;
    newBtn.innerHTML = `<span class="channel-icon">#</span> ${channelName}`;
    newBtn.addEventListener('click', (e) => { e.preventDefault(); switchChannel(channelName); });

    // إدخال القناة قبل زر "Add channels"
    channelList.insertBefore(newBtn, channelList.lastElementChild);
}

function saveMessageToHistory(channel, text, sender, avatarUrl, date, senderId = null) {
    if (!channelHistories[channel]) channelHistories[channel] = [];
    channelHistories[channel].push({ text, sender, avatarUrl, date, type: 'chat', senderId });
}

function systemNotice(text, channel) {
    if (!channelHistories[channel]) channelHistories[channel] = [];
    channelHistories[channel].push({ text, type: 'system' });
    if (channel === currentChannel) renderChatHistory();
}

function renderChatHistory() {
    if (!chatBox) return;
    chatBox.innerHTML = '<div class="date-divider"><span>Today</span></div>';
    const history = channelHistories[currentChannel] || [];

    if (history.length === 0) chatBox.innerHTML += `<div class="system-message msg-text text-center mt-3">Beginning of <strong>${currentChannel}</strong> history.</div>`;

    history.forEach(msg => {
        if (msg.type === 'system') {
            chatBox.innerHTML += `<div class="system-message msg-text text-center my-2 text-muted">${msg.text}</div>`;
        } else {
            const timeStr = msg.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const safeAvatar = msg.avatarUrl || `https://ui-avatars.com/api/?name=${msg.sender}&background=random&color=fff`;
            const mineClass = msg.senderId === myId ? ' mine' : '';
            chatBox.innerHTML += `
            <div class="message-group${mineClass}">
                <img src="${safeAvatar}" class="msg-avatar">
                <div class="msg-content">
                    <div class="msg-header"><span class="sender-name">${msg.sender}</span><span class="msg-time">${timeStr}</span></div>
                    <div class="msg-text">${msg.text}</div>
                </div>
            </div>`;
        }
    });
    chatBox.scrollTop = chatBox.scrollHeight;
}

function renderSearchResults(term) {
    if (!chatBox) return;
    const history = channelHistories[currentChannel] || [];
    const lowered = term.toLowerCase();
    const matches = history.filter(m => m.type === 'chat' && m.text.toLowerCase().includes(lowered));
    chatBox.innerHTML = `<div class="search-result-count">${matches.length} result(s) for "${term}"</div>`;
    matches.forEach(msg => {
        const timeStr = msg.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const safeAvatar = msg.avatarUrl || `https://ui-avatars.com/api/?name=${msg.sender}&background=random&color=fff`;
        const mineClass = msg.senderId === myId ? ' mine' : '';
        const highlighted = msg.text.replace(new RegExp(term, 'ig'), match => `<mark>${match}</mark>`);
        chatBox.innerHTML += `
        <div class="message-group${mineClass}">
            <img src="${safeAvatar}" class="msg-avatar">
            <div class="msg-content">
                <div class="msg-header"><span class="sender-name">${msg.sender}</span><span class="msg-time">${timeStr}</span></div>
                <div class="msg-text">${highlighted}</div>
            </div>
        </div>`;
    });
    chatBox.scrollTop = 0;
}

// utility for managing multiple transfer bars
function createTransferBar(id, text) {
    if (!transferContainer) return null;
    const item = document.createElement('div');
    item.className = 'transfer-status';
    item.dataset.transferId = id;
    item.innerHTML = `
        <div class="transfer-info">
            <i class="fa-solid fa-file-arrow-up"></i>
            <span class="transfer-filename">${text}</span>
            <span class="transfer-percentage">0%</span>
        </div>
        <div class="progress-track">
            <div class="progress-fill" style="width:0%"></div>
        </div>
    `;
    transferContainer.appendChild(item);
    transferContainer.classList.remove('hidden');
    const filenameEl = item.querySelector('.transfer-filename');
    const percentEl = item.querySelector('.transfer-percentage');
    const fillEl = item.querySelector('.progress-fill');
    transferItems[id] = { item, filenameEl, percentEl, fillEl };
    return transferItems[id];
}

function updateTransferBar(id, percentage) {
    const t = transferItems[id];
    if (!t) return;
    if (t.percentEl) t.percentEl.innerText = `${percentage}%`;
    if (t.fillEl) t.fillEl.style.width = `${percentage}%`;
}

function removeTransferBar(id) {
    const t = transferItems[id];
    if (!t) return;
    if (t.item && transferContainer) transferContainer.removeChild(t.item);
    delete transferItems[id];
    if (Object.keys(transferItems).length === 0 && transferContainer) {
        transferContainer.classList.add('hidden');
    }
}

function showToast(message) {
    if (toaster) { toaster.innerText = message; toaster.classList.add('show'); setTimeout(() => toaster.classList.remove('show'), 2500); }
}

function updateMembersList(list) {
    if (!membersList) return;
    membersList.innerHTML = '';
    list.forEach(member => {
        const safeAvatar = member.avatar || `https://ui-avatars.com/api/?name=${member.name}&background=random&color=fff`;
        membersList.innerHTML += `
            <div class="member-item" data-peer-id="${member.id}">
                <div class="avatar-wrapper"><img src="${safeAvatar}" class="member-avatar"><span class="status-dot green"></span></div>
                <div class="member-info"><span class="member-name">${member.name}</span><span class="member-role">${member.role}</span></div>
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
    // تفعيل التنقل بين القنوات
    document.querySelectorAll('.chat-channel').forEach(btn => {
        btn.addEventListener('click', (e) => { e.preventDefault(); switchChannel(btn.dataset.channel); });
    });

    // collapse/toggle sidebar
    const collapseIcon = document.querySelector('.collapse-icon');
    if (collapseIcon) {
        collapseIcon.addEventListener('click', () => {
            const left = document.querySelector('.sidebar-left');
            if (left) left.classList.toggle('collapsed');
        });
    }

    // mobile menu toggle (double-click workspace header)
    const workspaceHeader = document.querySelector('.workspace-header');
    if (workspaceHeader) {
        workspaceHeader.addEventListener('dblclick', () => {
            const left = document.querySelector('.sidebar-left');
            if (left) left.classList.toggle('open');
        });
    }

    // theme selector
    const themeSelector = document.getElementById('theme-selector');
    if (themeSelector) {
        // set initial value
        const saved = document.documentElement.getAttribute('data-theme') || 'light';
        themeSelector.value = saved;
        themeSelector.addEventListener('change', () => {
            setTheme(themeSelector.value);
            updateDarkModeButton();
        });
    }

    // إمكانية تعديل الإسم بعد دخول الغرفة
    const userNameSpan = document.getElementById('user-name');
    const editNameIcon = document.getElementById('edit-name-icon');
    if (userNameSpan) {
        const openRename = () => changeName();
        userNameSpan.addEventListener('click', openRename);
        if (editNameIcon) editNameIcon.addEventListener('click', openRename);
    }

    // تفعيل وظيفة إنشاء قناة جديدة
    document.querySelectorAll('.add-channel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const channelName = prompt("Enter new channel name:");
            if (channelName && channelName.trim() !== '') {
                const name = channelName.trim();
                if (!channelHistories[name]) channelHistories[name] = [];
                addChannelToUI(name, 'UX & UI Team');
                switchChannel(name); // الانتقال للقناة الجديدة

                const data = { type: 'new-channel', name: name };
                if (isHost) broadcast(data);
                else safeSend(hostConnection, data);
            }
        });
    });

    // تفعيل شريط البحث (Search Filter and full history search)
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            if (!term) {
                renderChatHistory();
                return;
            }
            const messages = chatBox.querySelectorAll('.message-group, .system-message');
            messages.forEach(msg => {
                msg.style.display = msg.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
            });
        });
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const term = e.target.value.trim();
                if (term === '') {
                    renderChatHistory();
                } else {
                    renderSearchResults(term);
                }
            }
        });
        // escape to clear results
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                renderChatHistory();
            }
        });
    }

    // تأثيرات القائمة اليسرى (Home, Search...)
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (item.getAttribute('href') === '#') e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // Emoji Picker
    if (emojiBtn && emojiPicker) {
        emojiBtn.addEventListener('click', () => emojiPicker.classList.toggle('hidden'));
        emojiPicker.querySelectorAll('span').forEach(emoji => {
            emoji.addEventListener('click', () => { msgInput.value += emoji.innerText; emojiPicker.classList.add('hidden'); msgInput.focus(); });
        });
    }

    if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => { magicLinkInput.select(); document.execCommand('copy'); showToast('Link copied!'); });
    if (connectBtn) connectBtn.addEventListener('click', () => connectToHost(targetIdInput.value.trim().toUpperCase()));
    if (sendMsgBtn) sendMsgBtn.addEventListener('click', sendMessage);
    if (msgInput) msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    if (attachBtn) attachBtn.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', sendFile);
}

// بدء التطبيق
init();

// تسجيل Service Worker لدعم PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}
