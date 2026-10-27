const tmi = require('tmi.js');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));

// Хранилище активных подключений к Твичу, чтобы не подключаться по сто раз к одному каналу
const activeClients = {}; 
const TRIGGER_COMMAND = '+';

// ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
const db = new sqlite3.Database('./giveaway_v2.db', (err) => {
    if (err) console.error('Ошибка БД:', err.message);
    else console.log('База данных успешно подключена.');
});

// Создаем общую таблицу. Теперь у каждого участника есть привязка к стримеру (streamer_channel)
db.run(`CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    streamer_channel TEXT,
    username TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(streamer_channel, username)
)`);

// Переменная для хранения победителей (для каждого стримера свой)
const currentWinners = {};

// Функция для запуска Твич-клиента для конкретного стримера
function connectToTwitch(channelName) {
    const channel = channelName.toLowerCase().trim();
    if (activeClients[channel]) return; // Если уже подключен, ничего не делаем

    const client = new tmi.Client({
        options: { debug: false },
        channels: [channel]
    });

    client.connect().then(() => {
        console.log(`[Twitch] Успешно подключились к каналу: ${channel}`);
        activeClients[channel] = client;
    }).catch(err => {
        console.error(`[Twitch] Ошибка подключения к ${channel}:`, err);
    });

    client.on('message', (ch, tags, message, self) => {
        if (self) return;

        if (message.trim() === TRIGGER_COMMAND) {
            const username = tags['display-name'] || tags.username;
            const targetChannel = ch.replace('#', ''); // убираем решетку из имени канала

            db.run(
                `INSERT OR IGNORE INTO participants (streamer_channel, username) VALUES (?, ?)`, 
                [targetChannel, username], 
                function(err) {
                    if (err) console.error(err.message);
                }
            );
        }
    });
}

// 1. ГЛАВНАЯ СТРАНИЦА — ВХОД ДЛЯ СТРИМЕРА
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Twitch Рулетка 24/7</title>
            <meta charset="utf-8">
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; background: #0e0e10; color: #efeff1; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .login-box { background: #1f1f23; padding: 40px; border-radius: 12px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.5); width: 100%; max-width: 400px; border-top: 4px solid #9146ff; }
                h1 { margin-bottom: 20px; font-size: 24px; color: #9146ff; }
                input { width: 100%; padding: 12px; margin: 15px 0; border-radius: 6px; border: 2px solid #3a3a3c; background: #18181b; color: white; font-size: 16px; box-sizing: border-box; }
                input:focus { border-color: #9146ff; outline: none; }
                button { width: 100%; background: #9146ff; color: white; border: none; padding: 12px; font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; transition: 0.2s; }
                button:hover { background: #772ce8; }
                p { color: #adadb8; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="login-box">
                <h1>Twitch Розыгрыши 24/7</h1>
                <p>Введите ваш ник на Твиче, чтобы запустить сбор участников и открыть рулетку</p>
                <form action="/login" method="POST">
                    <input type="text" name="twitch_username" placeholder="Ваш никнейм (например: welghardi)" required autocomplete="off">
                    <button type="submit">Войти в панель</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// Обработка ввода ника и перенаправление на личную страницу
app.post('/login', (req, res) => {
    const channel = req.body.twitch_username.toLowerCase().trim();
    if (!channel) return res.redirect('/');
    res.redirect(`/streamer/${channel}`);
});

// 2. ЛИЧНАЯ ПАНЕЛЬ УПРАВЛЕНИЯ ДЛЯ СТРИМЕРА
app.get('/streamer/:channel', (req, res) => {
    const channel = req.params.channel.toLowerCase().trim();
    
    // Автоматически подключаем бота к этому каналу, если он еще не там
    connectToTwitch(channel);

    // Достаем участников только для этого стримера
    db.all(`SELECT username, timestamp FROM participants WHERE streamer_channel = ? ORDER BY id DESC`, [channel], (err, rows) => {
        if (err) return res.status(500).send(err.message);

        let tableRows = rows.map((row, index) => 
            `<tr><td>${index + 1}</td><td>${row.username}</td><td>${new Date(row.timestamp).toLocaleString()}</td></tr>`
        ).join('');

        let winner = currentWinners[channel];
        let winnerBlock = winner 
            ? `<div class="winner-box">🎉 ПОБЕДИТЕЛЬ: <span>${winner}</span> 🎉</div>` 
            : `<div class="winner-box no-winner">Победитель еще не выбран</div>`;

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Панель: ${channel}</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: 'Segoe UI', Arial, sans-serif; background: #141416; color: #efeff1; padding: 20px; text-align: center; }
                    .container { max-width: 800px; margin: 0 auto; }
                    h1 { color: #9146ff; }
                    .winner-box { background: #1f1f23; border: 3px solid #9146ff; padding: 20px; margin: 20px auto; border-radius: 12px; max-width: 500px; font-size: 24px; font-weight: bold; box-shadow: 0 0 15px rgba(145, 70, 255, 0.4); }
                    .winner-box span { color: #00ff7f; font-size: 36px; display: block; margin-top: 10px; text-shadow: 0 0 10px rgba(0,255,127,0.5); }
                    .no-winner { border-color: #3a3a3c; color: #adadb8; font-size: 18px; }
                    .actions { margin: 30px 0; display: flex; justify-content: center; gap: 15px; }
                    button { font-size: 16px; font-weight: bold; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; transition: 0.2s; }
                    .btn-spin { background: #9146ff; color: white; }
                    .btn-spin:hover { background: #772ce8; }
                    .btn-clear { background: #eb0400; color: white; }
                    .btn-clear:hover { background: #ff3b30; }
                    table { margin: 20px auto; border-collapse: collapse; width: 100%; background: #1f1f23; border-radius: 8px; overflow: hidden; }
                    th, td { padding: 12px; border: 1px solid #26262c; text-align: left; }
                    th { background: #26262c; color: #adadb8; }
                </style>
                <script>
                    // Автоматически обновлять страницу каждые 6 секунд, чтобы видеть новых участников чата
                    setInterval(() => {
                        // Обновляем только если юзер не крутит рулетку прямо сейчас
                        if(!window.location.search.includes('spinning')) {
                            location.reload();
                        }
                    }, 6000);
                </script>
            </head>
            <body>
                <div class="container">
                    <h1>Круглосуточный розыгрыш Твич</h1>
                    <p>Вы вошли как канал: <strong style="color: #9146ff;">${channel}</strong> | Участников в базе: <strong>${rows.length}</strong></p>
                    <p style="font-size: 13px; color: #adadb8;">Зрителям нужно написать в чат <strong style="color: #00ff7f;">+</strong> для участия</p>
                    
                    ${winnerBlock}

                    <div class="actions">
                        <form action="/spin/${channel}" method="POST">
                            <button type="submit" class="btn-spin">🎰 КРУТИТЬ РУЛЕТКУ</button>
                        </form>
                        <form action="/clear/${channel}" method="POST" onsubmit="return confirm('Очистить список участников ТОЛЬКО для вашего канала?')">
                            <button type="submit" class="btn-clear">Очистить мой список</button>
                        </form>
                    </div>

                    <table>
                        <tr><th style="width: 50px;">#</th><th>Никнейм зрителя</th><th>Время записи</th></tr>
                        ${tableRows}
                    </table>
                    <br>
                    <a href="/" style="color: #adadb8; text-decoration: none; font-size: 14px;">← Сменить стримера / Выйти</a>
                </div>
            </body>
            </html>
        `);
    });
});

// КРУТИТЬ РУЛЕТКУ ДЛЯ КОНКРЕТНОГО СТРИМЕРА
app.post('/spin/:channel', (req, res) => {
    const channel = req.params.channel.toLowerCase().trim();
    db.all(`SELECT username FROM participants WHERE streamer_channel = ?`, [channel], (err, rows) => {
        if (err || rows.length === 0) {
            currentWinners[channel] = "Нет участников!";
        } else {
            const randomIndex = Math.floor(Math.random() * rows.length);
            currentWinners[channel] = rows[randomIndex].username;
        }
        res.redirect(`/streamer/${channel}?spinning=true`);
    });
});

// СБРОС ТАБЛИЦЫ ДЛЯ КОНКРЕТНОГО СТРИМЕРА
app.post('/clear/:channel', (req, res) => {
    const channel = req.params.channel.toLowerCase().trim();
    db.run(`DELETE FROM participants WHERE streamer_channel = ?`, [channel], (err) => {
        if (err) console.error(err.message);
        currentWinners[channel] = null;
        res.redirect(`/streamer/${channel}`);
    });
});
