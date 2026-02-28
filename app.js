// رفعنا حجم القطعة لـ 256KB لتقليل وقت المعالجة وزيادة السرعة
const CHUNK_SIZE = 262144;
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

function generateId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 3; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

function init() {
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
}

function showMainApp() {
    setupScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
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
    
    // رفع مساحة الاستيعاب إلى 8 ميجابايت (8 * 1024 * 1024)
    // وتقليل وقت الانتظار إلى 5 ملي ثانية للسرعة
    while (conn.dataChannel.bufferedAmount > 8 * 1024 * 1024) {
        await new Promise(r => setTimeout(r, 5));
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
        saveMessageToHistory(data.channel, data.text, data.senderName, data.senderAvatar, new Date(data.timestamp));
        if (currentChannel === data.channel) renderChatHistory();
        else showToast(`New message in # ${data.channel}`);
        // تشغيل صوت التنبيه
        if (data.senderId !== myId) new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(() => { });

    } else if (data.type === 'system') {
        systemNotice(data.text, data.channel || 'General');

    } else if (data.type === 'peer-list' && !isHost) {
        updateMembersList(data.list);

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
        incomingFiles[data.senderId] = { meta: data.meta, chunks: [], receivedBytes: 0, senderName: data.senderName, channel: data.channel };
        showTransferProgress(`Downloading ${data.meta.name}...`, 0);

    } else if (data.type === 'file-chunk') {
        const fileState = incomingFiles[data.senderId];
        if (!fileState) return;
        fileState.chunks.push(data.chunk);
        fileState.receivedBytes += data.chunk.byteLength;

        // تحديث شريط التقدم بذكاء (لتوفير موارد المعالج)
        const progress = Math.round((fileState.receivedBytes / fileState.meta.size) * 100);
        if (progress % 5 === 0 || progress === 100) updateTransferProgress(progress);

        if (fileState.receivedBytes === fileState.meta.size) {
            setTimeout(() => hideTransferProgress(), 500);
            assembleFile(data.senderId);
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
        <div><i class="fa-solid fa-file me-2"></i><strong>${fileState.meta.name}</strong> <br><small class="text-muted">From ${fileState.senderName} • ${formatSize(fileState.meta.size)}</small></div>
        <a href="${url}" download="${fileState.meta.name}"><i class="fa-solid fa-download"></i></a>
    `;
    if (downloadsList) downloadsList.prepend(downloadItem);

    saveMessageToHistory(fileState.channel, `Shared a file: <strong><a href="${url}" download="${fileState.meta.name}">${fileState.meta.name}</a></strong>`, fileState.senderName, '', new Date());
    if (currentChannel === fileState.channel) renderChatHistory();
    delete incomingFiles[senderId];
}

async function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    const msgData = { type: 'chat', channel: currentChannel, senderId: myId, senderName: myName, senderAvatar: myAvatar, text: text, timestamp: Date.now() };
    saveMessageToHistory(currentChannel, text, myName, myAvatar, new Date());
    renderChatHistory();

    if (isHost) await broadcast(msgData);
    else await safeSend(hostConnection, msgData);

    msgInput.value = '';
}

// 🚀 نظام إرسال الملفات الخارق
async function sendFile() {
    const file = fileInput.files[0];
    if (!file) return;

    const metaData = { type: 'file-meta', channel: currentChannel, senderId: myId, senderName: myName, meta: { name: file.name, size: file.size, type: file.type } };

    if (isHost) await broadcast(metaData);
    else await safeSend(hostConnection, metaData);

    saveMessageToHistory(currentChannel, `Sending file: <strong>${file.name}</strong>`, myName, myAvatar, new Date());
    renderChatHistory();

    const arrayBuffer = await file.arrayBuffer();
    let offset = 0;
    showTransferProgress(`Uploading ${file.name}...`, 0);

    while (offset < arrayBuffer.byteLength) {
        const chunk = arrayBuffer.slice(offset, offset + CHUNK_SIZE);
        const chunkData = { type: 'file-chunk', senderId: myId, chunk: chunk };

        if (isHost) await broadcast(chunkData);
        else await safeSend(hostConnection, chunkData);

        offset += CHUNK_SIZE;
        const progress = Math.round((offset / arrayBuffer.byteLength) * 100);
        if (progress % 2 === 0 || progress >= 100) updateTransferProgress(Math.min(progress, 100)); // تحديث ذكي للواجهة
    }

    setTimeout(() => hideTransferProgress(), 500);
    fileInput.value = '';
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
            chatBox.innerHTML += `
            <div class="message-group">
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

function showTransferProgress(text, percentage) {
    if (transferFilename) transferFilename.innerText = text;
    updateTransferProgress(percentage);
    if (transferContainer) transferContainer.classList.remove('hidden');
}

function updateTransferProgress(percentage) {
    if (transferPercentage) transferPercentage.innerText = `${percentage}%`;
    if (transferProgress) transferProgress.style.width = `${percentage}%`;
}

function hideTransferProgress() {
    if (transferContainer) transferContainer.classList.add('hidden');
    if (transferProgress) transferProgress.style.width = '0%';
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
            <div class="member-item">
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
// ----------------- UI BUTTON WIRING -----------------
function setupUIInteractions() {
    // 1. تفعيل التنقل بين القنوات
    document.querySelectorAll('.chat-channel').forEach(btn => {
        btn.addEventListener('click', (e) => { e.preventDefault(); switchChannel(btn.dataset.channel); });
    });

    // 2. تفعيل وظيفة إنشاء قناة جديدة
    document.querySelectorAll('.add-channel-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const channelName = prompt("Enter new channel name:");
            if (channelName && channelName.trim() !== '') {
                const name = channelName.trim();
                if (!channelHistories[name]) channelHistories[name] = [];
                addChannelToUI(name, 'UX & UI Team');
                switchChannel(name); 

                const data = { type: 'new-channel', name: name };
                if (isHost) broadcast(data);
                else safeSend(hostConnection, data);
            }
        });
    });

    // 3. تفعيل شريط البحث (Search Filter)
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const messages = chatBox.querySelectorAll('.message-group, .system-message');
            messages.forEach(msg => {
                msg.style.display = msg.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
            });
        });
    }

    // 4. تأثيرات القائمة اليسرى (Home, Search...)
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (item.getAttribute('href') === '#') e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // 5. Emoji Picker
    if (emojiBtn && emojiPicker) {
        emojiBtn.addEventListener('click', () => emojiPicker.classList.toggle('hidden'));
        emojiPicker.querySelectorAll('span').forEach(emoji => {
            emoji.addEventListener('click', () => { msgInput.value += emoji.innerText; emojiPicker.classList.add('hidden'); msgInput.focus(); });
        });
    }

    // 6. الأزرار الأساسية للشاشة الافتتاحية والإرسال
    if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => { magicLinkInput.select(); document.execCommand('copy'); showToast('Link copied!'); });
    if (connectBtn) connectBtn.addEventListener('click', () => connectToHost(targetIdInput.value.trim().toUpperCase()));
    if (sendMsgBtn) sendMsgBtn.addEventListener('click', sendMessage);
    if (msgInput) msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
    if (attachBtn) attachBtn.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', sendFile);

    // ==========================================
    // 7. تفعيل باقي الأزرار في الواجهة (الجديد)
    // ==========================================

    // زر الميكروفون (الزر الأول في قائمة icon-btn)
    const micBtn = document.querySelectorAll('.icon-btn')[0];
    if (micBtn) micBtn.addEventListener('click', () => showToast('Voice messages coming soon! 🎤'));

    // زر المنشن @ (الزر الثالث في القائمة)
    const atBtn = document.querySelectorAll('.icon-btn')[2];
    if (atBtn) {
        atBtn.addEventListener('click', () => {
            msgInput.value += '@';
            msgInput.focus(); // إعادة التركيز على حقل الإدخال
        });
    }

    // زر تسجيل الفيديو (القائمة اليسرى بالأسفل)
    const recordBtn = document.querySelector('.record-btn');
    if (recordBtn) recordBtn.addEventListener('click', () => showToast('Video recording requires media server 🎥'));

    // أيقونة التثبيت (Pin) بجانب اسم القناة
    const pinIcon = document.querySelector('.pin-icon');
    if (pinIcon) {
        pinIcon.addEventListener('click', () => {
            pinIcon.style.color = pinIcon.style.color === 'var(--accent-blue)' ? 'var(--text-secondary)' : 'var(--accent-blue)';
            showToast('Channel Pin Toggled! 📌');
        });
    }

    // أيقونة المشاركة (Share Nodes) في الأعلى
    const shareIcon = document.querySelector('.action-icon');
    if (shareIcon) shareIcon.addEventListener('click', () => showToast('Share options opened! 🔗'));

    // زر المحادثات الجانبية (Thread)
    const threadBtn = document.querySelector('.btn-thread');
    if (threadBtn) threadBtn.addEventListener('click', () => showToast('Threads panel activated! 🧵'));

    // أيقونة طي القائمة اليسرى
    const collapseIcon = document.querySelector('.collapse-icon');
    if (collapseIcon) collapseIcon.addEventListener('click', () => showToast('Sidebar collapse coming soon! ⏪'));

    // أيقونة إضافة قسم جديد (+)
    const addIcon = document.querySelector('.add-icon');
    if (addIcon) addIcon.addEventListener('click', () => showToast('Create new group! ➕'));

    // خيارات الأعضاء الجانبية (...)
    const rightEllipsis = document.querySelector('.members-header .fa-ellipsis');
    if (rightEllipsis) rightEllipsis.addEventListener('click', () => showToast('Member settings opened! ⚙️'));
}

    // تفعيل شريط البحث (Search Filter)
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const messages = chatBox.querySelectorAll('.message-group, .system-message');
            messages.forEach(msg => {
                msg.style.display = msg.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
            });
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


