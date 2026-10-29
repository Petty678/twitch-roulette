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
                body { font-family: "Segoe UI", Arial, sans-serif; background: #0e0e10; color: #efeff1; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .login-box { background: #1f1f23; padding: 40px; border-radius: 12px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 100%; max-width: 440px; border-top: 4px solid #9146ff; }
                h1 { margin-bottom: 10px; font-size: 26px; color: #9146ff; }
                input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 6px; border: 2px solid #3a3a3c; background: #18181b; color: white; font-size: 16px; box-sizing: border-box; }
                input:focus { border-color: #9146ff; outline: none; }
                button { width: 100%; background: #9146ff; color: white; border: none; padding: 12px; font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; transition: 0.2s; margin-top: 10px; }
                button:hover { background: #772ce8; }
                p { color: #adadb8; font-size: 14px; margin-bottom: 25px; line-height: 1.5; }
            </style>
        </head>
        <body>
            <div class="login-box">
                <h1>Twitch Розыгрыши 24/7</h1>
                <p>Введите ваш ник на Твиче и придумайте имя комнаты. Участники внутри комнаты сохраняются неделями!</p>
                <form action="/login" method="POST">
                    <input type="text" name="twitch_username" placeholder="Никнейм стримера (например: strict)" required autocomplete="off">
                    <input type="text" name="room_name" placeholder="Название комнаты (например: sub_giveaway)" required autocomplete="off"><button type="submit">Открыть / Создать комнату</button>
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
    if (settings[channel].spinTime === undefined) settings[channel].spinTime = 5; // Время прокрутки по умолчанию 5 сек
    if (settings[channel][room] === undefined) settings[channel][room] = false;

    const currentKeyword = settings[channel].command;
    const currentSpinTime = settings[channel].spinTime;
    const isCollecting = settings[channel][room];

    db.query('SELECT username, timestamp FROM participants WHERE room_id = $1 ORDER BY id DESC', [room])
        .then(result => {
            const rows = result.rows;
            const participantsNames = rows.map(r => r.username);

            let tableRows = rows.map((row, index) => 
                '<tr><td>' + (index + 1) + '</td><td>' + row.username + '</td><td>' + new Date(row.timestamp).toLocaleString() + '</td></tr>'
            ).join('');

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Розыгрыш: \${channel} (\${displayRoomName})</title>
                    <meta charset="utf-8">
                    <style>
                        body { font-family: "Segoe UI", Arial, sans-serif; background: #141416; color: #efeff1; padding: 20px; text-align: center; }
                        .container { max-width: 950px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; }
                        h1 { color: #9146ff; margin-bottom: 5px; font-size: 28px; }
                        .room-info { color: #adadb8; margin-bottom: 20px; font-size: 15px; }
                        
                        /* ГОРИЗОНТАЛЬНАЯ РУЛЕТКА ЛЕНТОЙ */
                        .roulette-container { display: block; background: #1f1f23; border: 1px solid #2d2d30; padding: 30px 10px; margin: 20px auto; border-radius: 12px; width: 100%; max-width: 650px; position: relative; box-shadow: 0 4px 20px rgba(0,0,0,0.5); overflow: hidden; box-sizing: border-box; }
                        .roulette-wrapper { width: 100%; overflow: hidden; position: relative; height: 130px; display: flex; align-items: center; }
                        .roulette-line { display: flex; position: absolute; left: 0; top: 0; height: 100%; will-change: transform; }
                        
                        /* КАРТОЧКА С АВАТАРКОЙ В ЛЕНТЕ */
                        .user-card { width: 110px; min-width: 110px; height: 120px; margin: 0 5px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-sizing: border-box; }
                        .user-avatar { width: 50px; height: 50px; border-radius: 50%; background: #9146ff; color: white; font-size: 22px; font-weight: bold; display: flex; align-items: center; justify-content: center; margin-bottom: 10px; box-shadow: 0 0 10px rgba(145, 70, 255, 0.4); text-transform: uppercase; }
                        .user-name { font-size: 13px; color: #efeff1; max-width: 95px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
                        
                        /* СТРЕЛКА ПО ЦЕНТРУ ЛЕНТЫ */
                        .roulette-pointer { position: absolute; top: 5px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 12px solid transparent; border-right: 12px solid transparent; border-top: 18px solid #ffd700; z-index: 10; filter: drop-shadow(0 0 5px rgba(255,215,0,0.5)); }
                        
                        .winner-box { background: #1f1f23; border: 3px solid #9146ff; padding: 25px; margin: 15px auto; border-radius: 12px; width: 100%; max-width: 550px; font-size: 24px; font-weight: bold; box-shadow: 0 0 15px rgba(145, 70, 255, 0.4); box-sizing: border-box; }
                        .winner-box span { color: #00ff7f; font-size: 38px; display: block; margin-top: 10px; text-shadow: 0 0 10px rgba(0,255,127,0.5); }
                        .no-winner { border-color: #3a3a3c; color: #adadb8; font-size: 18px; }
                        .setup-panel { background: #1f1f23; padding: 15px; border-radius: 8px; margin-bottom: 25px; display: flex; gap: 15px; align-items: center; justify-content: center; flex-wrap: wrap; border: 1px solid #2d2d30; width: 100%; max-width: 750px; box-sizing: border-box; }
                        .setup-panel input, .setup-panel select { background: #141416; border: 1px solid #3a3a3c; color: white; padding: 8px 12px; border-radius: 4px; font-size: 14px; }
                        .actions { margin: 15px 0; display: flex; justify-content: center; gap: 15px; width: 100%; max-width: 650px; }
                        button { font-size: 16px; font-weight: bold; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; transition: 0.2s; flex: 1; }
                        .btn-spin { background: #9146ff; color: white; }
                        .btn-spin:hover { background: #772ce8; }
                        .btn-clear { background: #eb0400; color: white; max-width: 150px; }
                        .btn-clear:hover { background: #ff3b30; }
                        .btn-start { background: #00ff7f; color: #141416; max-width: 200px; }
                        .btn-start:hover { background: #00cc66; }
                        .btn-stop { background: #ffaa00; color: #141416; max-width: 200px; }
                        .btn-stop:hover { background: #cc8800; }
                        .status-badge { padding: 5px 10px; border-radius: 4px; font-weight: bold; font-size: 14px; margin-left: 10px; }
                        .status-on { background: rgba(0, 255, 127, 0.2); color: #00ff7f; border: 1px solid #00ff7f; }
                        .status-off { background: rgba(255, 170, 0, 0.2); color: #ffaa00; border: 1px solid #ffaa00; }
                        
                        /* УВЕЛИЧЕННОЕ КОЛЕСО УДАЧИ (450px) */
                        .wheel-zone { display: none; position: relative; width: 450px; height: 450px; margin: 25px auto; }
                        canvas { border-radius: 50%; box-shadow: 0 0 25px rgba(0,0,0,0.7); }
                        .pointer { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 18px solid transparent; border-right: 18px solid transparent; border-top: 30px solid #9146ff; z-index: 10; filter: drop-shadow(0 0 5px rgba(145,70,255,0.5)); }
                        
                        table { margin: 25px auto; border-collapse: collapse; width: 100%; max-width: 750px; background: #1f1f23; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
                        th, td { padding: 14px; border: 1px solid #26262c; text-align: left; }
                        th { background: #26262c; color: #adadb8; }
                        
                        @keyframes fadeInRow {
                            from { opacity: 0; transform: translateY(-10px); background: rgba(145, 70, 255, 0.15); }
                            to { opacity: 1; transform: translateY(0); background: transparent; }
                        }
                        .new-participant-row { animation: fadeInRow 0.6s ease-out forwards; }
                <body>
                    <div class="container">
                        <h1>Twitch Розыгрыши</h1>
                        <div class="room-info">
                            Канал: <strong style="color: #9146ff;">${channel}</strong> | 
                            Комната: <strong style="color: #00ff7f;">${displayRoomName}</strong> | 
                            Статус: <span class="status-badge ${isCollecting ? 'status-on' : 'status-off'}">${isCollecting ? '🔴 ИДЕТ СБОР' : '⚪ СБОР ОСТАНОВЛЕН'}</span> | 
                            Участников: <strong id="count">${rows.length}</strong>
                        </div>
                        
                        <div class="setup-panel">
                            <!-- КЛЮЧ ЧАТА -->
                            <form action="/update-settings/${channel}?room=${room}" method="POST" style="display:inline-flex; align-items:center; gap:8px;">
                                <label>Ключ чата:</label>
                                <input type="text" name="command" value="${currentKeyword}" style="width:100px; text-align:center;" required>
                                
                                <!-- ВРЕМЯ ПРОКРУТКИ -->
                                <label style="margin-left:10px;">Время (сек):</label>
                                <input type="number" name="spinTime" value="${currentSpinTime}" min="2" max="30" style="width:55px; text-align:center;" required>
                                
                                <button type="submit" style="padding:8px 12px; font-size:13px; background:#2d2d30; color:white; border-radius:4px; border:none; cursor:pointer;">Применить</button>
                            </form>
                            
                            <label style="margin-left:15px;">Вариант розыгрыша:</label>
                            <select id="drawMode" onchange="toggleDrawMode()">
                                <option value="classic">📼 Горизонтальная лента</option>
                                <option value="wheel_single">🎡 Колесо удачи (Один прокрут)</option>
                                <option value="wheel_elimination">🎡 Колесо удачи (На выбывание)</option>
                            </select>
                        </div>

                        <div class="winner-box no-winner" id="winnerOutput">Победитель еще не выбран</div>

                        <!-- ГОРИЗОНТАЛЬНАЯ ЛЕНТА -->
                        <div class="roulette-container" id="rouletteZone">
                            <div class="roulette-pointer"></div>
                            <div class="roulette-wrapper">
                                <div class="roulette-line" id="rouletteLine"></div>
                            </div>
                        </div>

                        <!-- УВЕЛИЧЕННОЕ КОЛЕСО -->
                        <div class="wheel-zone" id="wheelZone">
                            <div class="pointer"></div>
                            <canvas id="wheelCanvas" width="450" height="450"></canvas>
                        </div>

                        <div class="actions">
                            <form action="/toggle-collection/${channel}?room=${room}" method="POST" style="display:contents;">
                                <button type="submit" class="${isCollecting ? 'btn-stop' : 'btn-start'}">${isCollecting ? '🛑 ОСТАНОВИТЬ СБОР' : '▶ ЗАПУСТИТЬ СБОР'}</button>
                            </form>

                            <button class="btn-spin" id="mainActionBtn" onclick="runDraw()">🎰 ЗАПУСТИТЬ РОЗЫГРЫШ</button>
                            
                            <form action="/clear/${channel}?room=${room}" method="POST" onsubmit="return confirm('Вы уверены, что хотите полностью очистить эту комнату?')" style="display:contents;">
                                <button type="submit" class="btn-clear">Очистить</button>
                            </form>
                        </div>

                        <table id="participantsTable">
                            <thead>
                                <tr><th style="width: 50px;">#</th><th>Никнейм зрителя</th><th>Время записи</th></tr>
                            </thead>
                            <tbody>
                                ${tableRows}
                            </tbody>
                        </table>
                        <br>
                        <a href="/" style="color: #adadb8; text-decoration: none; font-size: 14px;">← Вернуться на главную (Сменить комнату)</a>
                    </div>
                    <script>
                        let participants = ${JSON.stringify(participantsNames)};
                        const room = "${room}";
                        const spinTimeSeconds = ' + currentSpinTime + '; // Динамическое время из настроек стримера
                        const canvas = document.getElementById("wheelCanvas");
                        const ctx = canvas.getContext("2d");
                        let currentAngle = 0;

                        function toggleDrawMode() {
                            const mode = document.getElementById("drawMode").value;
                            const wheelZone = document.getElementById("wheelZone");
                            const rouletteZone = document.getElementById("rouletteZone");
                            const btn = document.getElementById("mainActionBtn");
                            
                            if (mode === "classic") {
                                rouletteZone.style.display = "block";
                                wheelZone.style.display = "none";
                                btn.innerText = "🎰 ЗАПУСТИТЬ РОЗЫГРЫШ";
                                buildRouletteLine();
                            } else {
                                rouletteZone.style.display = "none";
                                wheelZone.style.display = "block";
                                btn.innerText = "🎡 ЗАПУСТИТЬ РОЗЫГРЫШ";
                                drawWheel();
                            }
                        }

                        function buildRouletteLine() {
                            const line = document.getElementById("rouletteLine");
                            line.innerHTML = "";
                            line.style.transform = "translateX(0px)";
                            
                            if (participants.length === 0) {
                                line.innerHTML = '<div style="padding: 50px; color:#adadb8; width:600px;">Лента пуста, ждем участников...</div>';
                                return;
                            }
                            
                            let list = [...participants];
                            while(list.length < 150) { // Генерируем с запасом под любое время прокрутки
                                list = list.concat(participants);
                            }
                            
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
                                ctx.fillStyle = "#2b2b2f";
                                ctx.beginPath(); ctx.arc(225, 225, 225, 0, 2*Math.PI); ctx.fill();
                                ctx.fillStyle = "#adadb8"; ctx.font = "18px Segoe UI"; ctx.textAlign = "center";
                                ctx.fillText("Колесо пустое", 225, 225);
                                return;
                            }
                            const arc = (2 * Math.PI) / len;
                            for(let i=0; i<len; i++) {
                                const angle = currentAngle + i * arc;
                                ctx.fillStyle = i % 2 === 0 ? "#1f1f23" : "#9146ff";
                                if (i % 2 !== 0) ctx.fillStyle = "#772ce8";
                                ctx.beginPath(); ctx.moveTo(225,225); ctx.arc(225,225,225, angle, angle + arc); ctx.lineTo(225,225); ctx.fill();
                                ctx.save(); ctx.fillStyle = "white"; ctx.translate(225,225); ctx.rotate(angle + arc/2); ctx.font = "bold 13px Segoe UI"; ctx.textAlign = "right";
                                let text = participants[i]; if(text.length > 16) text = text.substring(0,14) + "...";
                                ctx.fillText(text, 210, 4); ctx.restore();
                            }
                        }

                        setTimeout(() => toggleDrawMode(), 200);
                        function runDraw() {
                            if (participants.length === 0) return alert("Участников ещё нет!");
                            const mode = document.getElementById("drawMode").value;
                            const winnerBox = document.getElementById("winnerOutput");
                            const spinTime = spinTimeSeconds * 1000; // Переводим секунды стримера в миллисекунды
                            
                            const btn = document.getElementById("mainActionBtn");
                            btn.disabled = true;

                            if (mode === "classic") {
                                const line = document.getElementById("rouletteLine");
                                const cardWidth = 120; // 110px карточка + 10px отступы
                                const centerOffset = 325; // Центр контейнера (650px / 2)
                                
                                // Выбираем случайного победителя из базы
                                const winnerIndex = Math.floor(Math.random() * participants.length);
                                const winner = participants[winnerIndex];
                                
                                // Находим карточку победителя ближе к концу ленты (например, в 4-м повторении списка)
                                const cardTargetIndex = participants.length * 3 + winnerIndex;
                                
                                // Считаем точную координату остановки: ставим карточку ровно по центру стрелки
                                const finalTranslate = -(cardTargetIndex * cardWidth - centerOffset + cardWidth / 2);
                                
                                // Включаем плавное замедление прокрутки на выбранное время
                                line.style.transition = `transform ${spinTimeSeconds}s cubic-bezier(0.1, 0.8, 0.1, 1)`;
                                line.style.transform = `translateX(${finalTranslate}px)`;
                                
                                setTimeout(() => {
                                    btn.disabled = false;
                                    winnerBox.className = "winner-box";
                                    winnerBox.innerHTML = `🎉 ПОБЕДИТЕЛЬ: <span>${winner}</span> 🎉`;
                                }, spinTime);
                            } else {
                                let startTime = null;
                                const totalRotation = Math.PI * 2 * (4 + Math.random() * 4);
                                
                                function animate(timestamp) {
                                    if (!startTime) startTime = timestamp;
                                    const progress = timestamp - startTime;
                                    const durationProgress = Math.min(progress / spinTime, 1);
                                    const easeOut = 1 - Math.pow(1 - durationProgress, 4);
                                    currentAngle = easeOut * totalRotation;
                                    drawWheel();
                                    
                                    if (progress < spinTime) {
                                        requestAnimationFrame(animate);
                                    } else {
                                        btn.disabled = false;
                                        const arc = (2 * Math.PI) / participants.length;
                                        let normalizedAngle = (1.5 * Math.PI - currentAngle) % (2 * Math.PI);
                                        if (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
                                        const winnerIndex = Math.floor(normalizedAngle / arc) % participants.length;
                                        const winner = participants[winnerIndex];
                                        winnerBox.className = "winner-box";
                                        
                                        if (mode === "wheel_elimination" && participants.length > 1) {
                                            winnerBox.innerHTML = `❌ ВЫБЫЛ ИЗ КОЛЕСА: <span>${winner}</span>`;
                                            participants.splice(winnerIndex, 1);
                                            
                                            const countEl = document.getElementById("count");
                                            countEl.innerText = participants.length;
                                            countEl.classList.add("count-bump");
                                            setTimeout(() => countEl.classList.remove("count-bump"), 200);
                                            setTimeout(() => drawWheel(), 1500);
                                        } else {
                                            winnerBox.innerHTML = `🎉 ПОБЕДИТЕЛЬ: <span>${winner}</span> 🎉`;
                                            if (mode === "wheel_elimination") {
                                                winnerBox.innerHTML = `🏆 ФИНАЛЬНЫЙ ЧЕМПИОН: <span>${winner}</span> 🏆`;
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
                                    countEl.innerText = participants.length;
                                    countEl.classList.add("count-bump");
                                    setTimeout(() => countEl.classList.remove("count-bump"), 200);

                                    const tbody = document.querySelector("#participantsTable tbody");
                                    tbody.innerHTML = "";
                                    fetch("/api/participants-full/" + room).then(r => r.json()).then(fullList => {
                                        fullList.forEach((row, index) => {
                                            const tr = document.createElement("tr");
                                            if (isNewAdded && index < (data.length - participants.length)) {
                                                tr.className = "new-participant-row";
                                            }
                                            tr.innerHTML = "<td>" + (index + 1) + "</td><td>" + row.username + "</td><td>" + new Date(row.timestamp).toLocaleString() + "</td>";
                                            tbody.appendChild(tr);
                                        });
                                    });
                                    if (mode === "classic") buildRouletteLine();
                                    if (mode.startsWith("wheel")) drawWheel();
                                }
                            });
                        }, 1000);
                    </script>
                </body>
                </html>
            \`);
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
    
    // Сохраняем и команду, и время прокрутки, отправленные из формы
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
