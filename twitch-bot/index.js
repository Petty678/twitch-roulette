const tmi = require('tmi.js');
const { Client } = require('pg');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json());

const activeClients = {}; 
const settings = {}; 

// ИНИЦИАЛИЗАЦИЯ ОБЛАЧНОЙ БАЗЫ ДАННЫХ POSTGRES
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

db.connect()
    .then(() => {
        console.log('БД успешно подключена');
        return db.query(`CREATE TABLE IF NOT EXISTS participants (
            id SERIAL PRIMARY KEY,
            streamer_channel TEXT,
            username TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(streamer_channel, username)
        )`);
    })
    .catch(err => console.error('Ошибка подключения к БД:', err.message));

function connectToTwitch(channelName) {
    const channel = channelName.toLowerCase().trim();
    if (activeClients[channel]) return;

    if (!settings[channel]) {
        settings[channel] = { command: '+' };
    }

    const client = new tmi.Client({ channels: [channel] });
    client.connect().catch(console.error);
    activeClients[channel] = client;

    client.on('message', (ch, tags, message, self) => {
        if (self) return;
        const targetChannel = ch.replace('#', '');
        const currentCommand = settings[targetChannel]?.command || '+';

        if (message.trim() === currentCommand) {
            const username = tags['display-name'] || tags.username;
            db.query(
                `INSERT INTO participants (streamer_channel, username) VALUES ($1, $2) ON CONFLICT DO NOTHING`, 
                [targetChannel, username]
            ).catch(err => console.error(err.message));
        }
    });
}

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Twitch Розыгрыши Комбайн</title>
            <meta charset="utf-8">
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; background: #0b0f0c; color: #e1e6e2; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .login-box { background: #141a16; padding: 40px; border-radius: 12px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.7); width: 100%; max-width: 400px; border-top: 4px solid #1db954; }
                h1 { margin-bottom: 20px; font-size: 24px; color: #1db954; }
                input { width: 100%; padding: 12px; margin: 15px 0; border-radius: 6px; border: 2px solid #222c25; background: #0b0f0c; color: white; font-size: 16px; box-sizing: border-box; }
                input:focus { border-color: #1db954; outline: none; }
                button { width: 100%; background: #1db954; color: #0b0f0c; border: none; padding: 12px; font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; transition: 0.2s; }
                button:hover { background: #1ed760; }
            </style>
        </head>
        <body>
            <div class="login-box">
                <h1>Twitch Giveaways Pro</h1>
                <form action="/login" method="POST">
                    <input type="text" name="twitch_username" placeholder="Никнейм канала (например: welghardi)" required autocomplete="off">
                    <button type="submit">Войти в комбайн</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    const channel = req.body.twitch_username.toLowerCase().trim();
    if (!channel) return res.redirect('/');
    res.redirect(`/streamer/${channel}`);
});

app.get('/streamer/:channel', (req, res) => {
    const channel = req.params.channel.toLowerCase().trim();
    connectToTwitch(channel);

    if (!settings[channel]) settings[channel] = { command: '+' };

    db.query(`SELECT username, timestamp FROM participants WHERE streamer_channel = $1 ORDER BY id DESC`, [channel])
        .then(result => {
            const participantsData = result.rows.map(r => ({ name: r.username, time: new Date(r.timestamp).toLocaleString() }));
            const participantsNames = participantsData.map(p => p.name);

            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Комбайн: ${channel}</title>
                    <meta charset="utf-8">
                    <style>
                        body { font-family: 'Segoe UI', Arial, sans-serif; background: #0b0f0c; color: #e1e6e2; margin: 0; padding: 20px; display: flex; gap: 20px; height: 95vh; box-sizing: border-box; }
                        .column { background: #141a16; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; border: 1px solid #222c25; box-sizing: border-box; }
                        
                        .col-left { flex: 1; max-width: 300px; }
                        .col-main { flex: 2; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; }
                        .col-right { flex: 1; max-width: 320px; }

                        h2 { color: #1db954; margin-top: 0; font-size: 20px; border-bottom: 1px solid #222c25; padding-bottom: 10px; width: 100%; }
                        input, select, textarea { background: #0b0f0c; border: 1px solid #222c25; color: white; padding: 10px; border-radius: 6px; width: 100%; box-sizing: border-box; margin-bottom: 15px; }
                        input:focus, select:focus { border-color: #1db954; outline: none; }
                        
                        button { background: #1db954; color: #0b0f0c; border: none; padding: 12px; font-weight: bold; border-radius: 6px; cursor: pointer; width: 100%; transition: 0.2s; margin-bottom: 10px; }
                        button:hover { background: #1ed760; }
                        .btn-danger { background: #eb0400; color: white; }
                        .btn-danger:hover { background: #ff3b30; }

                        .list-container { flex: 1; overflow-y: auto; background: #0b0f0c; border-radius: 6px; padding: 10px; margin-bottom: 15px; width: 100%; box-sizing: border-box; }
                        .user-item { padding: 8px; border-bottom: 1px solid #222c25; cursor: pointer; }
                        .user-item:hover { background: #141a16; color: #1db954; }

                        .timer-box { font-size: 48px; font-weight: bold; color: #eb0400; margin: 15px 0; text-shadow: 0 0 10px rgba(235,4,0,0.3); }
                        .winner-display { font-size: 32px; font-weight: bold; color: #1db954; margin: 15px 0; text-align: center; }

                        .canvas-container { position: relative; width: 350px; height: 350px; margin-bottom: 20px; }
                        canvas { border-radius: 50%; box-shadow: 0 0 20px rgba(0,0,0,0.6); }
                        .pointer { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 15px solid transparent; border-right: 15px solid transparent; border-top: 25px solid #1db954; z-index: 10; }
                    </style>
                </head>
                <body>
                    <!-- ЛЕВАЯ КОЛОНКА -->
                    <div class="column col-left">
                        <h2>Настройки</h2>
                        <form action="/update-settings/${channel}" method="POST">
                            <label>Ключевое слово для чата:</label>
                            <input type="text" name="command" value="${settings[channel].command}" required>
                            <button type="submit">Применить ключ</button>
                        </form>
                        
                        <label>Режим рулетки:</label>
                        <select id="wheelMode">
                            <option value="single">С первой прокрутки (Один победитель)</option>
                            <option value="elimination">На выбывание (До последнего)</option>
                        </select>

                        <label>Время прокрутки (сек):</label>
                        <input type="number" id="spinTime" value="5" min="2" max="20">

                        <label>Ручной импорт (.txt список):</label>
                        <textarea id="txtImport" rows="4" placeholder="Вставьте ники, каждый с новой строки..."></textarea>
                        <button onclick="importUsers()">Загрузить из текста</button>

                        <form action="/clear/${channel}" method="POST" onsubmit="return confirm('Вы уверены, что хотите очистить всю базу данных?')">
                            <button type="submit" class="btn-danger">Очистить базу данных</button>
                        </form>
                    </div>

                    <!-- СРЕДНЯЯ КОЛОНКА -->
                    <div class="column col-main">
                        <h2>Розыгрыш и Верификация</h2>
                        <div class="winner-display" id="winnerOutput">Готовы к старту</div>
                        
                        <div style="text-align: center; width: 100%;">
                            <label>Время на ответ победителя (сек):</label>
                            <input type="number" id="timerSetup" value="30" style="width: 80px; margin-bottom:0; text-align:center;">
                            <button onclick="startVerificationTimer()" style="width: auto; padding: 10px 20px; margin-left: 10px;">⏱ Запустить таймер</button>
                            <div class="timer-box" id="timerDisplay">00:00</div>
                        </div>

                        <div class="canvas-container">
                            <div class="pointer"></div>
                            <canvas id="wheelCanvas" width="350" height="350"></canvas>
                        </div>
                    <div class="column col-right">
                        <h2>Участники (<span id="count">0</span>)</h2>
                        <div class="list-container" id="userList"></div>
                        
                        <h2>Карточка участника</h2>
                        <div id="infoPanel" style="background: #0b0f0c; padding: 15px; border-radius: 6px; font-size: 14px; flex: 1; border: 1px solid #222c25;">
                            Кликните на любой ник в списке выше, чтобы увидеть подробную информацию.
                        </div>
                    </div>

                    <script>
                        let fullData = ${JSON.stringify(participantsData)};
                        let participants = ${JSON.stringify(participantsNames)};
                        const channel = "${channel}";

                        function initList() {
                            const list = document.getElementById('userList');
                            list.innerHTML = '';
                            document.getElementById('count').innerText = participants.length;
                            
                            participants.forEach(user => {
                                const div = document.createElement('div');
                                div.className = 'user-item';
                                div.innerText = user;
                                div.onclick = () => showInfo(user);
                                list.appendChild(div);
                            });
                            drawWheel();
                        }

                        function importUsers() {
                            const text = document.getElementById('txtImport').value;
                            if(!text.trim()) return alert('Текстовое поле пустое');
                            const newUsers = text.split('\n').map(u => u.trim()).filter(u => u.length > 0);
                            
                            newUsers.forEach(username => {
                                if(!participants.includes(username)) {
                                    participants.push(username);
                                    fullData.push({ name: username, time: 'Импортирован вручную (' + new Date().toLocaleTimeString() + ')' });
                                }
                            });
                            initList();
                            document.getElementById('txtImport').value = '';
                        }

                        function showInfo(username) {
                            const panel = document.getElementById('infoPanel');
                            const found = fullData.find(p => p.name === username);
                            const regTime = found ? found.time : 'Неизвестно';
                            
                            panel.innerHTML = `
                                <strong style="color:#1db954; font-size:16px;">${username}</strong><br><br>
                                <strong>Записался в рулетку:</strong><br> ${regTime}<br><br>
                                <strong>Быстрые ссылки:</strong><br>
                                • <a href="https://twitch.tv{username}" target="_blank" style="color:#1db954; text-decoration:none;">Перейти на Твич канальчик</a><br>
                                • <a href="https://twitch.tv{channel}/chat?popout=" target="_blank" style="color:#adadb8; text-decoration:none;">Открыть чат стрима</a>
                            `;
                        }

                        const canvas = document.getElementById('wheelCanvas');
                        const ctx = canvas.getContext('2d');
                        let currentAngle = 0;

                        function drawWheel() {
                            const len = participants.length;
                            ctx.clearRect(0,0,350,350);
                            if(len === 0) {
                                ctx.fillStyle = '#222c25';
                                ctx.beginPath(); ctx.arc(175, 175, 175, 0, 2*Math.PI); ctx.fill();
                                ctx.fillStyle = '#adadb8'; ctx.font = '16px Segoe UI'; ctx.textAlign = 'center';
                                ctx.fillText('Колесо пустое', 175, 175);
                                return;
                            }
                            const arc = (2 * Math.PI) / len;
                            for(let i=0; i<len; i++) {
                                const angle = currentAngle + i * arc;
                                ctx.fillStyle = i % 2 === 0 ? '#18221b' : '#1db954';
                                if (i % 2 !== 0) ctx.fillStyle = '#179c45';
                                ctx.beginPath();
                                ctx.moveTo(175,175);
                                ctx.arc(175,175,175, angle, angle + arc);
                                ctx.lineTo(175,175);
                                ctx.fill();

                                ctx.save();
                                ctx.fillStyle = 'white';
                                ctx.translate(175,175);
                                ctx.rotate(angle + arc/2);
                                ctx.font = 'bold 12px Segoe UI';
                                ctx.textAlign = 'right';
                                let text = participants[i];
                                if(text.length > 12) text = text.substring(0,10) + '...';
                                ctx.fillText(text, 160, 4);
                                ctx.restore();
                            }
                        }

                        function spinWheel() {
                            if(participants.length === 0) return alert('Участников нет!');
                            const mode = document.getElementById('wheelMode').value;
                            const spinTime = parseFloat(document.getElementById('spinTime').value) * 1000;
                            const btn = document.getElementById('spinBtn');
                            btn.disabled = true;

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

                                    if(mode === 'elimination' && participants.length > 1) {
                                        document.getElementById('winnerOutput').innerHTML = '❌ ВЫБЫЛ ИЗ КОЛЕСА: <span style="color:#eb0400;">' + winner + '</span>';
                                        participants.splice(winnerIndex, 1);
                                        setTimeout(() => initList(), 1500);
                                    } else {
                                        document.getElementById('winnerOutput').innerHTML = '🎉 ПОБЕДИТЕЛЬ: <span style="color:#1db954;">' + winner + '</span> 🎉';
                                        showInfo(winner);
                                        if(mode === 'elimination') {
                                            document.getElementById('winnerOutput').innerHTML = '🏆 ФИНАЛЬНЫЙ ЧЕМПИОН: <span style="color:#1db954;">' + winner + '</span> 🏆';
                                        }
                                    }
                                }
                            }
                            requestAnimationFrame(animate);
                        }

                        let timerInterval = null;
                        function startVerificationTimer() {
                            clearInterval(timerInterval);
                            let timeLeft = parseInt(document.getElementById('timerSetup').value);
                            const display = document.getElementById('timerDisplay');
                            
                            timerInterval = setInterval(() => {
                                let minutes = Math.floor(timeLeft / 60);
                                let seconds = timeLeft % 60;
                                minutes = minutes < 10 ? '0' + minutes : minutes;
                                seconds = seconds < 10 ? '0' + seconds : seconds;
                                display.innerText = minutes + ':' + seconds;

                                if (--timeLeft < 0) {
                                    clearInterval(timerInterval);
                                    display.innerText = 'ВРЕМЯ ВЫШЛО!';
                                }
                            }, 1000);
                        }

                        setInterval(() => {
                            fetch(`/api/participants/${channel}`)
                                .then(res => res.json())
                                .then(data => {
