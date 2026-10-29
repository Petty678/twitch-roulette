const tmi = require('tmi.js');
const { Client } = require('pg');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const activeClients = {}; 
const settings = {}; 

const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

db.connect()
    .then(() => {
        console.log('База данных успешно подключена.');
        return db.query('CREATE TABLE IF NOT EXISTS participants (id SERIAL PRIMARY KEY, room_id TEXT, username TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(room_id, username))');
    })
    .catch(err => console.error('Ошибка конфигурации БД:', err.message));

function connectToTwitch(channelName) {
    const channel = channelName.toLowerCase().trim();
    if (activeClients[channel]) return;

    if (!settings[channel]) settings[channel] = {};

    const client = new tmi.Client({ channels: [channel] });
    client.connect()
        .then(() => console.log('Бот успешно подключился к чату: ' + channel))
        .catch(console.error);
        
    activeClients[channel] = client;

    client.on('message', (ch, tags, message, self) => {
        if (self) return;
        const targetChannel = ch.replace('#', '');
        const channelSettings = settings[targetChannel];
        const currentCommand = channelSettings?.command || 'розыгрыш';

        if (message.trim().toLowerCase() === currentCommand.toLowerCase()) {
            const username = tags['display-name'] || tags.username;
            
            Object.keys(channelSettings).forEach(roomKey => {
                if (roomKey !== 'command' && roomKey !== 'spinTime' && channelSettings[roomKey] === true) {
                    db.query(
                        'INSERT INTO participants (room_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING', 
                        [roomKey, username]
                    ).catch(() => {});
                }
            });
        }
    });
}
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Twitch Розыгрыши</title>
            <meta charset="utf-8">
            <style>
                body { font-family: "Segoe UI", Arial, sans-serif; background: #09090b; color: #efeff1; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .login-box { background: #111115; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 0 25px rgba(145, 70, 255, 0.15); width: 100%; max-width: 440px; border-top: 4px solid #a970ff; }
                h1 { margin-bottom: 10px; font-size: 26px; color: #a970ff; text-shadow: 0 0 10px rgba(169, 112, 255, 0.3); }
                input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 8px; border: 2px solid #2a2a35; background: #181820; color: white; font-size: 16px; box-sizing: border-box; transition: 0.2s; }
                input:focus { border-color: #a970ff; outline: none; box-shadow: 0 0 10px rgba(169, 112, 255, 0.4); }
                button { width: 100%; background: #a970ff; color: white; border: none; padding: 12px; font-size: 16px; font-weight: bold; border-radius: 8px; cursor: pointer; transition: 0.2s; margin-top: 10px; box-shadow: 0 4px 15px rgba(169, 112, 255, 0.3); }
                button:hover { background: #bd85ff; transform: translateY(-1px); }
                p { color: #adadb8; font-size: 14px; margin-bottom: 25px; line-height: 1.5; }
            </style>
        </head>
        <body>
            <div class="login-box">
                <h1>Twitch Розыгрыши 24/7</h1>
                <p>Введите ваш ник на Твиче и придумайте имя комнаты. Участники сохраняются вечно в базе данных!</p>
                <form action="/login" method="POST">
                    <input type="text" name="twitch_username" placeholder="Никнейм стримера (например: strict)" required autocomplete="off">
                    <input type="text" name="room_name" placeholder="Название комнаты (например: main)" required autocomplete="off"><button type="submit">Открыть / Создать комнату</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const channel = req.body.twitch_username.toLowerCase().trim();
    const roomName = req.body.room_name.toLowerCase().replace(/[^a-z0-9_-]/g, '').trim();
    if (!channel || !roomName) return res.redirect('/');
    const uniqueRoom = channel + '_' + roomName;
    res.redirect('/streamer/' + channel + '?room=' + uniqueRoom);
});

app.get('/streamer/:channel', (req, res) => {
    const channel = req.params.channel.toLowerCase().trim();
    const room = req.query.room || (channel + '_main');
    const displayRoomName = room.replace(channel + '_', '');
    connectToTwitch(channel);

    if (!settings[channel]) settings[channel] = {};
    if (!settings[channel].command) settings[channel].command = 'розыгрыш';
    if (settings[channel].spinTime === undefined) settings[channel].spinTime = 5;
    if (settings[channel][room] === undefined) settings[channel][room] = false;

    const currentKeyword = settings[channel].command;
    const currentSpinTime = settings[channel].spinTime;
    const isCollecting = settings[channel][room];

    db.query('SELECT username, timestamp FROM participants WHERE room_id = $1 ORDER BY id DESC', [room])
        .then(result => {
            const rows = result.rows;
            const participantsNames = rows.map(r => r.username);

            let tableRows = rows.map((row, index) => 
                '<tr><td>' + (index + 1) + '</td><td>' + row.username + '</td><td>' + new Date(row.timestamp).toLocaleTimeString() + '</td></tr>'
            ).join('');

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Панель управления розыгрышем</title>
                    <meta charset="utf-8">
                    <style>
                        body { font-family: "Segoe UI", Arial, sans-serif; background: #070709; color: #efeff1; padding: 15px; margin: 0; box-sizing: border-box; }
                        .dashboard { display: grid; grid-template-columns: 330px 1fr 340px; gap: 15px; max-width: 100%; margin: 0 auto; height: calc(100vh - 30px); }
                        .panel-box { background: #111115; border: 1px solid #1c1c24; border-radius: 14px; padding: 20px; display: flex; flex-direction: column; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
                        .panel-title { font-size: 15px; font-weight: bold; color: #a970ff; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #1c1c24; padding-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
                        .form-group { text-align: left; margin-bottom: 15px; }
                        .form-group label { display: block; font-size: 12px; color: #adadb8; margin-bottom: 6px; font-weight: 500; }
                        .form-group input, .form-group select { width: 100%; background: #16161e; border: 1px solid #2a2a35; color: white; padding: 10px; border-radius: 8px; font-size: 14px; box-sizing: border-box; transition: 0.2s; }
                        .form-group input:focus, .form-group select:focus { border-color: #a970ff; outline: none; box-shadow: 0 0 8px rgba(169,112,255,0.3); }
                        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 15px; }
                        .stat-card { background: #16161e; border: 1px solid #22222d; padding: 12px 8px; border-radius: 10px; text-align: center; box-shadow: inset 0 0 10px rgba(0,0,0,0.2); }
                        .stat-value { font-size: 18px; font-weight: bold; color: #00ff7f; text-shadow: 0 0 8px rgba(0,255,127,0.3); }
                        .stat-label { font-size: 11px; color: #adadb8; margin-top: 3px; }
                        #wheelTimeGroup { display: none; margin-top: 10px; }
                        .actions { display: flex; flex-direction: column; gap: 10px; margin-top: auto; }
                        button.btn { font-size: 14px; font-weight: bold; padding: 12px; border: none; border-radius: 8px; cursor: pointer; transition: 0.2s; width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
                        button.btn:hover { transform: translateY(-1px); }
                        .btn-start { background: #00ff7f; color: #070709; }
                        .btn-start:hover { background: #26ff93; box-shadow: 0 0 15px rgba(0,255,127,0.4); }
                        .btn-stop { background: #ff4a4a; color: white; }
                        .btn-stop:hover { background: #ff6666; box-shadow: 0 0 15px rgba(255,74,74,0.4); }
                        .btn-spin { background: #a970ff; color: white; }
                        .btn-spin:hover { background: #bd85ff; box-shadow: 0 0 15px rgba(169,112,255,0.4); }
                        .btn-clear { background: #22222d; color: #adadb8; border: 1px solid #2d2d3d !important; }
                        .btn-clear:hover { background: #ff3b30; color: white; border-color: #ff3b30 !important; box-shadow: 0 0 15px rgba(255,59,48,0.3); }
                        .roulette-container { background: #13131a; border: 1px solid #1c1c26; padding: 25px 10px; margin: 15px auto; border-radius: 14px; width: 100%; max-width: 530px; position: relative; overflow: hidden; box-shadow: inset 0 0 20px rgba(0,0,0,0.6); }
                        .roulette-wrapper { width: 100%; overflow: hidden; position: relative; height: 130px; display: flex; align-items: center; }
                        .roulette-line { display: flex; position: absolute; left: 0; top: 0; height: 100%; will-change: transform; }
                        .user-card { width: 110px; min-width: 110px; height: 120px; margin: 0 5px; background: #16161e; border: 1px solid #22222d; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: 0.2s; }
                        .user-avatar { width: 45px; height: 45px; border-radius: 50%; background: #a970ff; color: white; font-size: 20px; font-weight: bold; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; box-shadow: 0 0 8px rgba(169,112,255,0.4); text-transform: uppercase; }
                        .user-name { font-size: 13px; color: #efeff1; max-width: 95px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                        .roulette-pointer { position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 12px solid transparent; border-right: 12px solid transparent; border-top: 18px solid #ffd700; z-index: 10; filter: drop-shadow(0 0 6px rgba(255,213,0,0.6)); }
                        .wheel-zone { display: none; position: relative; width: 450px; height: 450px; margin: 15px auto; }
                        canvas { border-radius: 50%; box-shadow: 0 0 30px rgba(0,0,0,0.8), 0 0 15px rgba(169,112,255,0.1); }
                        .pointer { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 18px solid transparent; border-right: 18px solid transparent; border-top: 30px solid #a970ff; z-index: 10; filter: drop-shadow(0 0 8px rgba(169,112,255,0.6)); }
                        .winner-box { background: #13131a; border: 2px solid #22222d; padding: 20px; margin: 15px auto; border-radius: 12px; width: 100%; max-width: 530px; font-size: 18px; font-weight: bold; color: #adadb8; transition: 0.3s; box-shadow: 0 4px 15px rgba(0,0,0,0.3); box-sizing: border-box; }
                        .winner-box.active { border-color: #a970ff; color: white; box-shadow: 0 0 20px rgba(169,112,255,0.2); }
                        .winner-box span { color: #00ff7f; font-size: 34px; display: block; margin-top: 8px; text-shadow: 0 0 12px rgba(0,255,127,0.5); font-family: 'Segoe UI Black', Arial, sans-serif; }
                        table { width: 100%; border-collapse: collapse; background: #13131a; border-radius: 10px; overflow: hidden; font-size: 13px; }
                        th, td { padding: 12px 10px; border-bottom: 1px solid #1c1c24; text-align: left; }
                        th { background: #16161e; color: #adadb8; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
                        td { color: #efeff1; }
                        tr:hover td { background: rgba(169,112,255,0.04); }
                        .chat-placeholder { margin: auto; color: #53535f; font-size: 14px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
                        .chat-placeholder svg { width: 48px; height: 48px; fill: #32323e; }
                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        .new-participant-row { animation: fadeInRow 0.6s ease-out forwards; }
                        @keyframes fadeInRow { from { opacity: 0; transform: translateY(-8px); background: rgba(169,112,255,0.15); } to { opacity: 1; transform: translateY(0); background: transparent; } }
                        #count { transition: transform 0.2s ease; display: inline-block; }
                        .count-bump { transform: scale(1.3); color: #00ff7f; }
                    </style>
                </head>
                <body>
                    <div class="dashboard">
                        <div class="panel-box">
                            <div class="panel-title">⚙️ УПРАВЛЕНИЕ РОЗЫГРЫШЕМ</div>
                            <form action="/update-settings/` + channel + `?room=` + room + `" method="POST">
                                <div class="form-group">
                                    <label>Никнейм стримера</label>
                                    <input type="text" value="@` + channel + `" disabled style="opacity: 0.6; background: #0c0c10;">
                                </div>
                                <div class="form-group">
                                    <label>Ключевое слово для участия</label>
                                    <input type="text" name="command" value="` + currentKeyword + `" required autocomplete="off">
                                </div>
                                <div class="form-group">
                                    <label>Вариант розыгрыша</label>
                                    <select id="drawMode" onchange="toggleDrawMode()">
                                        <option value="classic">📼 Розыгрыш — Рулетка (10 сек)</option>
                                        <option value="wheel_single">🎡 Колесо удачи (Один прокрут)</option>
                                        <option value="wheel_elimination">🎡 Колесо удачи (На выбывание)</option>
                                    </select>
                                </div>
                                <div class="form-group" id="wheelTimeGroup">
                                    <label>Время прокрутки колеса (сек)</label>
                                    <input type="number" name="spinTime" value="` + currentSpinTime + `" min="2" max="30" required>
                                </div>
                                <button type="submit" class="btn btn-spin" style="background: #16161e; border: 1px solid #2a2a35; box-shadow: none; margin-bottom: 20px;">Сохранить настройки</button>
                            </form>
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <div class="stat-value" id="countTop">` + rows.length + `</div>
                                    <div class="stat-label">УЧАСТНИКОВ</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-value" style="color: #a970ff; text-shadow: 0 0 8px rgba(169,112,255,0.3);">#` + currentKeyword + `</div>
                                    <div class="stat-label">КЛЮЧ ЧАТА</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-value" style="color: ` + (isCollecting ? '#00ff7f' : '#ff4a4a') + `; text-shadow: 0 0 8px ` + (isCollecting ? 'rgba(0,255,127,0.3)' : 'rgba(255,74,74,0.3)') + `;">` + (isCollecting ? 'АКТИВЕН' : 'СТОП') + `</div>
                                    <div class="stat-label">СТАТУС БОТА</div>
                                </div>
                            </div>
                            <div class="actions">
                                <form action="/toggle-collection/` + channel + `?room=` + room + `" method="POST" style="display:contents;">
                                    <button type="submit" class="btn ` + (isCollecting ? 'btn-stop' : 'btn-start') + `">` + (isCollecting ? '🛑 ОСТАНОВИТЬ ОТБОР' : '🚀 НАЧАТЬ ОТБОР') + `</button>
                                </form>
                                <button class="btn btn-spin" id="mainActionBtn" onclick="runDraw()">🎰 ЗАПУСТИТЬ РОЗЫГРЫШ</button>
                                <button class="btn btn-spin" id="reDrawBtn" onclick="resetAndReDraw()" style="display:none; background: #ffd700; color: #070709; box-shadow: 0 4px 12px rgba(255,215,0,0.3);">🔄 ПЕРЕИГРАТЬ</button>
                                <form action="/clear/` + channel + `?room=` + room + `" method="POST" onsubmit="return confirm('Очистить комнату?')" style="display:contents;">
                                    <button type="submit" class="btn btn-clear">Очистить комнату</button>
                                </form>
                            </div>
                        </div>
                        <div class="panel-box" style="justify-content: center; min-height: 500px;">
                            <div class="panel-title">🎬 АНИМАЦИЯ РОЗЫГРЫША</div>
                            <div class="winner-box" id="winnerOutput">Победитель еще не выбран</div>
                            <div class="roulette-container" id="rouletteZone">
                                <div class="roulette-pointer"></div>
                                <div class="roulette-wrapper">
                                    <div class="roulette-line" id="rouletteLine"></div>
                                </div>
                            </div>
                            <div class="wheel-zone" id="wheelZone">
                                <div class="pointer"></div>
                                <canvas id="wheelCanvas" width="450" height="450"></canvas>
                            </div>
                        </div>
                        <div class="panel-box">
                            <div class="panel-title">👥 УЧАСТНИКИ РОЗЫГРЫШA (<span id="count">` + rows.length + `</span>)</div>
                            <div style="overflow-y: auto; flex: 1;">
                                <table id="participantsTable">
                                    <thead>
                                        <tr><th style="width: 50px;">#</th><th>НИКНЕЙМ</th><th>ВРЕМЯ</th></tr>
                                    </thead>
                                    <tbody>
                                        ` + tableRows + `
                                    </tbody>
                                </table>
                                <div class="chat-placeholder" id="emptyPlaceholder" style="display: ` + (rows.length === 0 ? 'flex' : 'none') + `; padding-top: 60px;">
                                    <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                                    <div>Участники появятся здесь после написания ключевого слова в чате</div>
                                </div>
                            </div>
                            <br>
                            <a href="/" style="color: #adadb8; text-decoration: none; font-size: 13px; font-weight: 500;">← Сменить комнату</a>
                        </div>
                    </div>
                    <script>
                        let participants = ` + JSON.stringify(participantsNames) + `;
                        const room = "` + room + `";
                        const spinTimeSeconds = ` + currentSpinTime + `;
                        const canvas = document.getElementById("wheelCanvas");
                        const ctx = canvas.getContext("2d");
                        let currentAngle = 0;

                        function toggleDrawMode() {
                            const mode = document.getElementById("drawMode").value;
                            const wheelZone = document.getElementById("wheelZone");
                            const rouletteZone = document.getElementById("rouletteZone");
                            const wheelTimeGroup = document.getElementById("wheelTimeGroup");
                            const btn = document.getElementById("mainActionBtn");
                            if (mode === "classic") {
                                rouletteZone.style.display = "block";
                                wheelZone.style.display = "none";
                                wheelTimeGroup.style.display = "none";
                                btn.innerText = "🎰 ЗАПУСТИТЬ РОЗЫГРЫШ";
                                buildRouletteLine();
                            } else {
                                rouletteZone.style.display = "none";
                                wheelZone.style.display = "block";
                                wheelTimeGroup.style.display = "block";
                                btn.innerText = "🎡 ЗАПУСТИТЬ РОЗЫГРЫШ";
                                drawWheel();
                            }
                        }

                        function buildRouletteLine() {
                            const line = document.getElementById("rouletteLine");
                            line.innerHTML = "";
                            line.style.transition = "none";
                            line.style.transform = "translateX(0px)";
                            if (participants.length === 0) {
                                line.innerHTML = '<div style="padding: 50px; color:#adadb8; width:100%; text-align:center;">Лента пуста, ждем участников...</div>';
                                return;
                            }
                            let list = [...participants];
                            while(list.length < 180) { list = list.concat(participants); }
                            list.forEach(name => {
                                const card = document.createElement("div");
                                card.className = "user-card";
                                const letter = name.charAt(0);
                                card.innerHTML = '<div class="user-avatar">' + letter + '</div><div class="user-name">' + name + '</div>';
                                line.appendChild(card);
                            });
                        }

                        function drawWheel() {
                            const len = participants.length;
                            ctx.clearRect(0,0,450,450);
                            if(len === 0) {
                                ctx.fillStyle = "#16161e";
                                ctx.beginPath(); ctx.arc(225, 225, 225, 0, 2*Math.PI); ctx.fill();
                                ctx.fillStyle = "#adadb8"; ctx.font = "16px Segoe UI"; ctx.textAlign = "center";
                                ctx.fillText("Колесо пустое", 225, 225);
                                return;
                            }
                            const arc = (2 * Math.PI) / len;
                            for(let i=0; i<len; i++) {
                                const angle = currentAngle + i * arc;
                                ctx.fillStyle = i % 2 === 0 ? "#16161e" : "#a970ff";
                                if (i % 2 !== 0) ctx.fillStyle = "#823fff";
                                ctx.beginPath(); ctx.moveTo(225,225); ctx.arc(225,225,225, angle, angle + arc); ctx.lineTo(225,225); ctx.fill();
                                ctx.save(); ctx.fillStyle = "white"; ctx.translate(225,225); ctx.rotate(angle + arc/2); ctx.font = "bold 13px Segoe UI"; ctx.textAlign = "right";
                                let text = participants[i]; if(text.length > 16) text = text.substring(0,14) + "...";
                                ctx.fillText(text, 210, 4); ctx.restore();
                            }
                        }

                        function resetAndReDraw() {
                            const line = document.getElementById("rouletteLine");
                            const winnerBox = document.getElementById("winnerOutput");
                            const reBtn = document.getElementById("reDrawBtn");
                            const mainBtn = document.getElementById("mainActionBtn");
                            line.style.transition = "none";
                            line.style.transform = "translateX(0px)";
                            winnerBox.className = "winner-box";
                            winnerBox.innerText = "Переигровка запущенна...";
                            reBtn.style.display = "none";
                            mainBtn.style.display = "block";
                            setTimeout(() => { runDraw(); }, 1200);
                        }
                        function runDraw() {
                            if (participants.length === 0) return alert("Участников ещё нет!");
                            const mode = document.getElementById("drawMode").value;
                            const winnerBox = document.getElementById("winnerOutput");
                            const mainBtn = document.getElementById("mainActionBtn");
                            const reBtn = document.getElementById("reDrawBtn");
                            mainBtn.disabled = true;

                            if (mode === "classic") {
                                const rouletteSpinTime = 10000; 
                                const line = document.getElementById("rouletteLine");
                                const cardWidth = 120;
                                const centerOffset = 265; 
                                const winnerIndex = Math.floor(Math.random() * participants.length);
                                const winner = participants[winnerIndex];
                                const cardTargetIndex = participants.length * 15 + winnerIndex; 
                                const finalTranslate = -(cardTargetIndex * cardWidth - centerOffset + cardWidth / 2);
                                line.style.transition = "transform 10s cubic-bezier(0.05, 0.9, 0.05, 1)";
                                line.style.transform = "translateX(" + finalTranslate + "px)";
                                setTimeout(() => {
                                    mainBtn.disabled = false;
                                    mainBtn.style.display = "none";
                                    reBtn.style.display = "block"; 
                                    winnerBox.className = "winner-box active";
                                    winnerBox.innerHTML = "🎉 ПОБЕДИТЕЛЬ: <span>" + winner + "</span> 🎉";
                                }, rouletteSpinTime);
                            } else {
                                const wheelSpinTime = spinTimeSeconds * 1000;
                                let startTime = null;
                                const totalRotation = Math.PI * 2 * (4 + Math.random() * 4);
                                function animate(timestamp) {
                                    if (!startTime) startTime = timestamp;
                                    const progress = timestamp - startTime;
                                    const durationProgress = Math.min(progress / wheelSpinTime, 1);
                                    const easeOut = 1 - Math.pow(1 - durationProgress, 4);
                                    currentAngle = easeOut * totalRotation;
                                    drawWheel();
                                    if (progress < wheelSpinTime) {
                                        requestAnimationFrame(animate);
                                    } else {
                                        mainBtn.disabled = false;
                                        mainBtn.style.display = "none";
                                        reBtn.style.display = "block"; 
                                        const arc = (2 * Math.PI) / participants.length;
                                        let normalizedAngle = (1.5 * Math.PI - currentAngle) % (2 * Math.PI);
                                        if (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
                                        const winnerIndex = Math.floor(normalizedAngle / arc) % participants.length;
                                        const winner = participants[winnerIndex];
                                        winnerBox.className = "winner-box active";
                                        if (mode === "wheel_elimination" && participants.length > 1) {
                                            winnerBox.innerHTML = "❌ ВЫБЫЛ ИЗ КОЛЕСА: <span>" + winner + "</span>";
                                            participants.splice(winnerIndex, 1);
                                            document.getElementById("count").innerText = participants.length;
                                            document.getElementById("countTop").innerText = participants.length;
                                            setTimeout(() => drawWheel(), 1500);
                                        } else {
                                            winnerBox.innerHTML = "🎉 ПОБЕДИТЕЛЬ: <span>" + winner + "</span> 🎉";
                                            if (mode === "wheel_elimination") {
                                                winnerBox.innerHTML = "🏆 ФИНАЛЬНЫЙ ЧЕМПИОН: <span>" + winner + "</span> 🏆";
                                            }
                                        }
                                    }
                                }
                                requestAnimationFrame(animate);
                            }
                        }

                        setInterval(() => {
                            const mode = document.getElementById("drawMode").value;
                            if (mode === 'wheel_elimination') return;
                            fetch("/api/participants/" + room).then(res => res.json()).then(data => {
                                if (data.length !== participants.length) {
                                    const isNewAdded = data.length > participants.length;
                                    participants = data;
                                    const countEl = document.getElementById("count");
                                    const countTopEl = document.getElementById("countTop");
                                    const placeholder = document.getElementById("emptyPlaceholder");
                                    countEl.innerText = participants.length;
                                    countTopEl.innerText = participants.length;
                                    if(participants.length > 0) placeholder.style.display = "none";
                                    else placeholder.style.display = "flex";
                                    countEl.classList.add("count-bump");
                                    countTopEl.classList.add("count-bump");
                                    setTimeout(() => {
                                        countEl.classList.remove("count-bump");
                                        countTopEl.classList.remove("count-bump");
                                    }, 200);
                                    const tbody = document.querySelector("#participantsTable tbody");
                                    tbody.innerHTML = "";
                                    fetch("/api/participants-full/" + room).then(r => r.json()).then(fullList => {
                                        fullList.forEach((row, index) => {
                                            const tr = document.createElement("tr");
                                            if (isNewAdded && index < (data.length - participants.length)) {
                                                tr.className = "new-participant-row";
                                            }
                                            tr.innerHTML = "<td>" + (index + 1) + "</td><td>" + row.username + "</td><td>" + new Date(row.timestamp).toLocaleTimeString() + "</td>";
                                            tbody.appendChild(tr);
                                        });
                                    });
                                    if (mode === "classic") buildRouletteLine();
                                    if (mode.startsWith("wheel")) drawWheel();
                                }
                            });
                        }, 1000);
                        setTimeout(() => toggleDrawMode(), 200);
                    </script>
                </body>
                </html>
            `);
        })
        .catch(err => res.status(500).send(err.message));
});

app.get('/api/participants/:room', (req, res) => {
    const room = req.params.room;
    db.query('SELECT username FROM participants WHERE room_id = $1 ORDER BY id DESC', [room])
        .then(result => res.json(result.rows.map(r => r.username)))
        .catch(() => res.json([]));
});

app.get('/api/participants-full/:room', (req, res) => {
    const room = req.params.room;
    db.query('SELECT username, timestamp FROM participants WHERE room_id = $1 ORDER BY id DESC', [room])
        .then(result => res.json(result.rows))
        .catch(() => res.json([]));
});

app.post('/toggle-collection/:channel', (req, res) => {
    const channel = req.params.channel.toLowerCase().trim();
    const room = req.query.room;
    if (!settings[channel]) settings[channel] = {};
    settings[channel][room] = !settings[channel][room];
    res.redirect('/streamer/' + channel + '?room=' + room);
});

app.post('/update-settings/:channel', (req, res) => {
    const channel = req.params.channel.toLowerCase().trim();
    const room = req.query.room;
    if (!settings[channel]) settings[channel] = {};
    if (req.body.command) settings[channel].command = req.body.command.trim();
    if (req.body.spinTime) settings[channel].spinTime = parseInt(req.body.spinTime) || 5;
    res.redirect('/streamer/' + channel + '?room=' + room);
});

app.post('/clear/:channel', (req, res) => {
    const channel = req.params.channel.toLowerCase().trim();
    const room = req.query.room;
    db.query('DELETE FROM participants WHERE room_id = $1', [room])
        .then(() => res.redirect('/streamer/' + channel + '?room=' + room))
        .catch(() => res.redirect('/streamer/' + channel + '?room=' + room));
});

app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
