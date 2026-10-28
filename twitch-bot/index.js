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
