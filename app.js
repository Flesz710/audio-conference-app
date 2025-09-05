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
            
            // Скрываем секцию подключения и показываем конференцию
            const roomSection = document.querySelector('.room-section');
            roomSection.style.display = 'none';
            this.conferenceSection.style.display = 'block';
            this.conferenceSection.classList.add('fade-in');
            this.updateStatus('connected', `В комнате: ${data.roomId}`);
            
            // Создаем offer для всех существующих участников
            data.participants.forEach(participant => {
                if (participant.id !== this.socket.id) {
                    this.createOfferForParticipant(participant.id);
                }
            });
        });

        this.socket.on('room-participants', (participants) => {
            this.updateParticipants(participants);
        });

        this.socket.on('user-joined', (user) => {
            this.addParticipant(user);
            // НЕ создаем peer connection здесь - это будет сделано при получении offer
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
            // Получаем доступ к микрофону с улучшенными настройками
            console.log('Запрашиваем доступ к микрофону...');
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1,
                    latency: 0.01
                }
            });

            console.log('Микрофон получен:', this.localStream);
            console.log('Аудио треки:', this.localStream.getAudioTracks());

            // Проверяем, что микрофон работает
            const audioTracks = this.localStream.getAudioTracks();
            if (audioTracks.length === 0) {
                throw new Error('Микрофон не найден');
            }

            // Присоединяемся к комнате
            this.socket.emit('join-room', { roomId, userName });
            this.updateStatus('connected', 'Микрофон подключен');
            
        } catch (error) {
            console.error('Ошибка доступа к микрофону:', error);
            this.updateStatus('disconnected', 'Ошибка доступа к микрофону');
            
            let errorMessage = 'Не удалось получить доступ к микрофону. ';
            if (error.name === 'NotAllowedError') {
                errorMessage += 'Разрешите доступ к микрофону в настройках браузера.';
            } else if (error.name === 'NotFoundError') {
                errorMessage += 'Микрофон не найден.';
            } else {
                errorMessage += 'Проверьте настройки микрофона.';
            }
            
            alert(errorMessage);
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
            console.log('Получен удаленный поток от:', userId);
            const [remoteStream] = event.streams;
            console.log('Удаленный поток:', remoteStream);
            this.updateParticipantAudio(userId, remoteStream);
        };

        // Обработка ICE кандидатов
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Отправляем ICE кандидат для:', userId);
                this.socket.emit('ice-candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            } else {
                console.log('ICE gathering завершен для:', userId);
            }
        };

        // Отслеживание состояний соединения
        peerConnection.onconnectionstatechange = () => {
            console.log('Состояние соединения для', userId, ':', peerConnection.connectionState);
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE состояние для', userId, ':', peerConnection.iceConnectionState);
        };

        // НЕ создаем offer здесь - это будет сделано в handleOffer
        console.log('Peer connection создан для:', userId);
    }

    async createOfferForParticipant(userId) {
        console.log('Создаем offer для участника:', userId);
        await this.createPeerConnection(userId);
        const peerConnection = this.peerConnections.get(userId);
        
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            this.socket.emit('offer', {
                target: userId,
                offer: offer
            });
            console.log('Отправлен offer для:', userId);
        } catch (error) {
            console.error('Ошибка создания offer для:', userId, error);
        }
    }

    async handleOffer(offer, senderId) {
        console.log('Обрабатываем offer от:', senderId);
        let peerConnection = this.peerConnections.get(senderId);
        
        if (!peerConnection) {
            console.log('Создаем новое peer connection для:', senderId);
            await this.createPeerConnection(senderId);
            peerConnection = this.peerConnections.get(senderId);
        }

        try {
            console.log('Устанавливаем remote description для:', senderId);
            await peerConnection.setRemoteDescription(offer);

            // Добавляем отложенные ICE кандидаты
            if (peerConnection.pendingIceCandidates) {
                console.log('Добавляем отложенные ICE кандидаты для:', senderId);
                for (const candidate of peerConnection.pendingIceCandidates) {
                    try {
                        await peerConnection.addIceCandidate(candidate);
                    } catch (error) {
                        console.error('Ошибка добавления отложенного ICE кандидата:', error);
                    }
                }
                peerConnection.pendingIceCandidates = [];
            }

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.socket.emit('answer', {
                target: senderId,
                answer: answer
            });
            console.log('Отправлен answer для:', senderId);
        } catch (error) {
            console.error('Ошибка обработки offer:', error);
        }
    }

    async handleAnswer(answer, senderId) {
        console.log('Обрабатываем answer от:', senderId);
        const peerConnection = this.peerConnections.get(senderId);
        if (peerConnection) {
            try {
                console.log('Устанавливаем remote answer для:', senderId);
                await peerConnection.setRemoteDescription(answer);
            } catch (error) {
                console.error('Ошибка обработки answer:', error);
            }
        }
    }

    async handleIceCandidate(candidate, senderId) {
        console.log('Обрабатываем ICE кандидат от:', senderId);
        const peerConnection = this.peerConnections.get(senderId);
        if (peerConnection) {
            try {
                // Проверяем, что remote description установлен
                if (peerConnection.remoteDescription) {
                    console.log('Добавляем ICE кандидат для:', senderId);
                    await peerConnection.addIceCandidate(candidate);
                } else {
                    console.log('Откладываем ICE кандидат - remote description не установлен для:', senderId);
                    // Сохраняем кандидат для последующего добавления
                    if (!peerConnection.pendingIceCandidates) {
                        peerConnection.pendingIceCandidates = [];
                    }
                    peerConnection.pendingIceCandidates.push(candidate);
                }
            } catch (error) {
                console.error('Ошибка добавления ICE кандидата:', error);
            }
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
        console.log('Обновляем аудио для участника:', userId);
        const audioElement = document.getElementById(`audio-${userId}`);
        if (audioElement) {
            audioElement.srcObject = stream;
            audioElement.volume = 1.0; // Устанавливаем максимальную громкость
            
            // Настройка для автоматического переключения на наушники
            audioElement.setSinkId = audioElement.setSinkId || audioElement.webkitSetSinkId;
            if (audioElement.setSinkId) {
                // Пытаемся переключиться на наушники если доступны
                this.setupAudioSink(audioElement);
            }
            
            // Настройка для обнаружения речи и предотвращения эха
            this.setupAudioDetection(audioElement, userId);
            
            console.log('Аудио элемент обновлен:', audioElement);
            
            // Добавляем обработчики для отладки
            audioElement.onloadedmetadata = () => {
                console.log('Метаданные аудио загружены для:', userId);
                // Принудительно запускаем воспроизведение
                audioElement.play().catch(error => {
                    console.log('Автовоспроизведение заблокировано для:', userId, error);
                });
            };
            
            audioElement.oncanplay = () => {
                console.log('Аудио готово к воспроизведению для:', userId);
                // Пытаемся запустить воспроизведение
                audioElement.play().catch(error => {
                    console.log('Не удалось запустить воспроизведение для:', userId, error);
                });
            };
            
            audioElement.onerror = (error) => {
                console.error('Ошибка воспроизведения аудио для:', userId, error);
            };

            // Принудительно запускаем воспроизведение
            setTimeout(() => {
                audioElement.play().catch(error => {
                    console.log('Отложенное воспроизведение не удалось для:', userId, error);
                });
            }, 1000);
        } else {
            console.error('Аудио элемент не найден для участника:', userId);
        }
    }

    setupAudioDetection(audioElement, userId) {
        try {
            // Создаем AudioContext для анализа звука
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaElementSource(audioElement);
            const analyser = audioContext.createAnalyser();
            
            analyser.fftSize = 256;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            
            // Функция для обнаружения речи
            const detectSpeech = () => {
                analyser.getByteFrequencyData(dataArray);
                
                // Вычисляем средний уровень звука
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                const average = sum / bufferLength;
                
                // Если звук достаточно громкий, считаем что кто-то говорит
                if (average > 30) {
                    this.handleRemoteSpeech(userId);
                }
                
                requestAnimationFrame(detectSpeech);
            };
            
            detectSpeech();
        } catch (error) {
            console.log('Не удалось настроить обнаружение речи:', error);
        }
    }

    handleRemoteSpeech(speakingUserId) {
        // Если кто-то другой говорит, временно приглушаем наш микрофон
        if (speakingUserId !== this.socket.id && this.localStream && !this.isMuted) {
            const audioTracks = this.localStream.getAudioTracks();
            audioTracks.forEach(track => {
                // Временно снижаем громкость для предотвращения эха
                if (track.applyConstraints) {
                    track.applyConstraints({ volume: 0.3 });
                }
            });
            
            // Восстанавливаем громкость через 2 секунды
            setTimeout(() => {
                if (this.localStream && !this.isMuted) {
                    const audioTracks = this.localStream.getAudioTracks();
                    audioTracks.forEach(track => {
                        if (track.applyConstraints) {
                            track.applyConstraints({ volume: 1.0 });
                        }
                    });
                }
            }, 2000);
        }
    }

    async setupAudioSink(audioElement) {
        try {
            // Получаем список доступных аудио устройств
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
            
            // Ищем наушники или гарнитуру
            const headphones = audioOutputs.find(device => 
                device.label.toLowerCase().includes('headphone') ||
                device.label.toLowerCase().includes('headset') ||
                device.label.toLowerCase().includes('earphone')
            );
            
            if (headphones && audioElement.setSinkId) {
                await audioElement.setSinkId(headphones.deviceId);
                console.log('Переключились на наушники:', headphones.label);
            }
        } catch (error) {
            console.log('Не удалось переключиться на наушники:', error);
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
            
            // Показываем секцию подключения и скрываем конференцию
            const roomSection = document.querySelector('.room-section');
            roomSection.style.display = 'block';
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
