const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Статические файлы
app.use(express.static(path.join(__dirname)));

// Хранилище комнат и участников
const rooms = new Map();

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Обработка WebSocket соединений
io.on('connection', (socket) => {
    console.log(`Пользователь подключился: ${socket.id}`);

    // Присоединение к комнате
    socket.on('join-room', (data) => {
        const { roomId, userName } = data;
        
        // Покидаем предыдущую комнату если есть
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
            removeUserFromRoom(socket.currentRoom, socket.id);
        }

        // Присоединяемся к новой комнате
        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.userName = userName;

        // Добавляем пользователя в комнату
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
        }
        
        const room = rooms.get(roomId);
        room.set(socket.id, {
            id: socket.id,
            name: userName,
            isMuted: false
        });

        console.log(`Пользователь ${userName} присоединился к комнате ${roomId}`);

        // Уведомляем всех в комнате о новом участнике
        socket.to(roomId).emit('user-joined', {
            id: socket.id,
            name: userName,
            isMuted: false
        });

        // Отправляем список участников новому пользователю
        const participants = Array.from(room.values());
        socket.emit('room-participants', participants);

        // Уведомляем о присоединении
        socket.emit('joined-room', { roomId, participants });
    });

    // Обработка WebRTC сигналов
    socket.on('offer', (data) => {
        socket.to(data.target).emit('offer', {
            offer: data.offer,
            sender: socket.id
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.target).emit('answer', {
            answer: data.answer,
            sender: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            sender: socket.id
        });
    });

    // Переключение микрофона
    socket.on('toggle-mute', (isMuted) => {
        if (socket.currentRoom) {
            const room = rooms.get(socket.currentRoom);
            if (room && room.has(socket.id)) {
                room.get(socket.id).isMuted = isMuted;
                
                // Уведомляем всех в комнате
                socket.to(socket.currentRoom).emit('user-muted', {
                    id: socket.id,
                    isMuted: isMuted
                });
            }
        }
    });

    // Отключение от комнаты
    socket.on('leave-room', () => {
        if (socket.currentRoom) {
            removeUserFromRoom(socket.currentRoom, socket.id);
            socket.to(socket.currentRoom).emit('user-left', socket.id);
            socket.leave(socket.currentRoom);
            socket.currentRoom = null;
        }
    });

    // Отключение клиента
    socket.on('disconnect', () => {
        console.log(`Пользователь отключился: ${socket.id}`);
        
        if (socket.currentRoom) {
            removeUserFromRoom(socket.currentRoom, socket.id);
            socket.to(socket.currentRoom).emit('user-left', socket.id);
        }
    });
});

// Функция для удаления пользователя из комнаты
function removeUserFromRoom(roomId, userId) {
    if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        room.delete(userId);
        
        // Удаляем комнату если она пустая
        if (room.size === 0) {
            rooms.delete(roomId);
        }
    }
}

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌍 Режим: ${NODE_ENV}`);
    if (NODE_ENV === 'development') {
        console.log(`📱 Локально: http://localhost:${PORT}`);
    } else {
        console.log(`🌐 Готов к использованию из любой точки мира!`);
    }
    console.log(`🎤 Готов к аудио конференциям!`);
});

// Обработка ошибок
process.on('uncaughtException', (err) => {
    console.error('Необработанная ошибка:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Необработанное отклонение Promise:', reason);
});