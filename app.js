class AudioConference {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peerConnections = new Map();
        this.currentRoom = null;
        this.userName = '';
        this.isMuted = false;
        
        this.initializeElements();
        this.setupEventListeners();
        this.connectToServer();
    }

    initializeElements() {
        this.roomIdInput = document.getElementById('roomId');
        this.userNameInput = document.getElementById('userName');
        this.joinRoomBtn = document.getElementById('joinRoom');
        this.conferenceSection = document.getElementById('conferenceSection');
        this.currentRoomSpan = document.getElementById('currentRoom');
        this.participantsDiv = document.getElementById('participants');
        this.muteBtn = document.getElementById('muteBtn');
        this.leaveBtn = document.getElementById('leaveBtn');
        this.statusIndicator = document.querySelector('.status-indicator');
        this.statusText = document.querySelector('.status-text');
    }

    setupEventListeners() {
        this.joinRoomBtn.addEventListener('click', () => this.joinRoom());
        this.muteBtn.addEventListener('click', () => this.toggleMute());
        this.leaveBtn.addEventListener('click', () => this.leaveRoom());

        // Enter для присоединения к комнате
        this.roomIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        this.userNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
    }

    connectToServer() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.updateStatus('connected', 'Подключено к серверу');
        });

        this.socket.on('disconnect', () => {
            this.updateStatus('disconnected', 'Отключено от сервера');
        });

        this.socket.on('joined-room', (data) => {
            this.currentRoom = data.roomId;
            this.currentRoomSpan.textContent = data.roomId;
            this.conferenceSection.style.display = 'block';
            this.conferenceSection.classList.add('fade-in');
            this.updateStatus('connected', `В комнате: ${data.roomId}`);
        });

        this.socket.on('room-participants', (participants) => {
            this.updateParticipants(participants);
        });

        this.socket.on('user-joined', (user) => {
            this.addParticipant(user);
            this.createPeerConnection(user.id);
        });

        this.socket.on('user-left', (userId) => {
            this.removeParticipant(userId);
            this.closePeerConnection(userId);
        });

        this.socket.on('user-muted', (data) => {
            this.updateParticipantMute(data.id, data.isMuted);
        });

        // WebRTC сигналы
        this.socket.on('offer', async (data) => {
            await this.handleOffer(data.offer, data.sender);
        });

        this.socket.on('answer', async (data) => {
            await this.handleAnswer(data.answer, data.sender);
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data.candidate, data.sender);
        });
    }

    async joinRoom() {
        const roomId = this.roomIdInput.value.trim();
        const userName = this.userNameInput.value.trim();

        if (!roomId || !userName) {
            alert('Пожалуйста, введите ID комнаты и ваше имя');
            return;
        }

        this.userName = userName;
        this.updateStatus('connecting', 'Подключение к комнате...');

        try {
            // Получаем доступ к микрофону
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Присоединяемся к комнате
            this.socket.emit('join-room', { roomId, userName });
            
        } catch (error) {
            console.error('Ошибка доступа к микрофону:', error);
            this.updateStatus('disconnected', 'Ошибка доступа к микрофону');
            alert('Не удалось получить доступ к микрофону. Проверьте разрешения.');
        }
    }

    async createPeerConnection(userId) {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        const peerConnection = new RTCPeerConnection(configuration);
        this.peerConnections.set(userId, peerConnection);

        // Добавляем локальный поток
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
        }

        // Обработка входящих потоков
        peerConnection.ontrack = (event) => {
            const [remoteStream] = event.streams;
            this.updateParticipantAudio(userId, remoteStream);
        };

        // Обработка ICE кандидатов
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            }
        };

        // Создаем offer для нового пользователя
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            this.socket.emit('offer', {
                target: userId,
                offer: offer
            });
        } catch (error) {
            console.error('Ошибка создания offer:', error);
        }
    }

    async handleOffer(offer, senderId) {
        const peerConnection = this.peerConnections.get(senderId);
        if (!peerConnection) {
            await this.createPeerConnection(senderId);
        }

        const pc = this.peerConnections.get(senderId);
        await pc.setRemoteDescription(offer);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.socket.emit('answer', {
            target: senderId,
            answer: answer
        });
    }

    async handleAnswer(answer, senderId) {
        const peerConnection = this.peerConnections.get(senderId);
        if (peerConnection) {
            await peerConnection.setRemoteDescription(answer);
        }
    }

    async handleIceCandidate(candidate, senderId) {
        const peerConnection = this.peerConnections.get(senderId);
        if (peerConnection) {
            await peerConnection.addIceCandidate(candidate);
        }
    }

    closePeerConnection(userId) {
        const peerConnection = this.peerConnections.get(userId);
        if (peerConnection) {
            peerConnection.close();
            this.peerConnections.delete(userId);
        }
    }

    updateParticipants(participants) {
        this.participantsDiv.innerHTML = '';
        participants.forEach(participant => {
            this.addParticipant(participant);
        });
    }

    addParticipant(participant) {
        const participantDiv = document.createElement('div');
        participantDiv.className = 'participant slide-in';
        participantDiv.id = `participant-${participant.id}`;
        
        participantDiv.innerHTML = `
            <div class="participant-name">${participant.name}</div>
            <div class="participant-status">
                <span class="status-indicator ${participant.isMuted ? 'disconnected' : ''}"></span>
                <span>${participant.isMuted ? 'Микрофон выключен' : 'Говорит'}</span>
            </div>
            <audio id="audio-${participant.id}" autoplay></audio>
        `;

        this.participantsDiv.appendChild(participantDiv);
    }

    removeParticipant(userId) {
        const participantDiv = document.getElementById(`participant-${userId}`);
        if (participantDiv) {
            participantDiv.remove();
        }
    }

    updateParticipantMute(userId, isMuted) {
        const participantDiv = document.getElementById(`participant-${userId}`);
        if (participantDiv) {
            const statusIndicator = participantDiv.querySelector('.status-indicator');
            const statusText = participantDiv.querySelector('.participant-status span:last-child');
            
            if (isMuted) {
                statusIndicator.classList.add('disconnected');
                statusText.textContent = 'Микрофон выключен';
            } else {
                statusIndicator.classList.remove('disconnected');
                statusText.textContent = 'Говорит';
            }
        }
    }

    updateParticipantAudio(userId, stream) {
        const audioElement = document.getElementById(`audio-${userId}`);
        if (audioElement) {
            audioElement.srcObject = stream;
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !this.isMuted;
            });
        }

        // Обновляем UI
        const icon = this.muteBtn.querySelector('.icon');
        const text = this.muteBtn.querySelector('.text');
        
        if (this.isMuted) {
            icon.textContent = '🔇';
            text.textContent = 'Включить микрофон';
            this.muteBtn.classList.add('muted');
        } else {
            icon.textContent = '🎤';
            text.textContent = 'Выключить микрофон';
            this.muteBtn.classList.remove('muted');
        }

        // Уведомляем сервер
        this.socket.emit('toggle-mute', this.isMuted);
    }

    leaveRoom() {
        if (this.currentRoom) {
            // Закрываем все peer connections
            this.peerConnections.forEach((pc, userId) => {
                pc.close();
            });
            this.peerConnections.clear();

            // Останавливаем локальный поток
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }

            // Покидаем комнату
            this.socket.emit('leave-room');
            
            // Скрываем интерфейс конференции
            this.conferenceSection.style.display = 'none';
            this.currentRoom = null;
            
            this.updateStatus('connected', 'Готов к подключению');
        }
    }

    updateStatus(status, message) {
        this.statusIndicator.className = `status-indicator ${status}`;
        this.statusText.textContent = message;
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new AudioConference();
});
