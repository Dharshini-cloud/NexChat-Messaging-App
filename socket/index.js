const jwt = require('jsonwebtoken');
const Message = require('../models/message');

module.exports = function(io) {
// Socket Auth Middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        socket.user = decoded;
        next();
    } catch (err) {
        next(new Error('Authentication error'));
    }
});

const activeUsers = new Map();     // socketId -> username
const lastSeen = new Map();        // username -> Date

function getConversationId(user1, user2) {
    return [user1, user2].sort().join('_');
}

// Helper to format a message doc for client
function formatMessage(msg) {
    return {
        id: msg._id,
        from: msg.sender,
        to: msg.receiver,
        message: msg.textContent,
        type: msg.type,
        url: msg.contentUrl,
        fileName: msg.fileName,
        timestamp: msg.createdAt.toLocaleTimeString(),
        date: msg.createdAt,
        status: msg.status,
        reactions: msg.reactions,
        replyTo: msg.replyTo,
        pollData: msg.pollData,
        gameData: msg.gameData,
        rpsData: msg.rpsData,       // Rock-Paper-Scissors state
        guessData: msg.guessData,   // Guess-the-Number state
        locationData: msg.locationData,
        callData: msg.callData,
        deliveredAt: msg.deliveredAt,
        readAt: msg.readAt,
        starred: msg.starred || [],
        forwardedFrom: msg.forwardedFrom || null,
        pinned: msg.pinned || false,
        conversationId: msg.conversationId
    };
}

io.on('connection', (socket) => {
    const username = socket.user.username;
    activeUsers.set(socket.id, username);
    lastSeen.delete(username); // Clear last-seen when online
    
    // Broadcast active users list with last-seen info
    io.emit('active_users', buildUserList());

    // Mark any undelivered messages for this user as delivered
    (async () => {
        try {
            const pending = await Message.updateMany(
                { receiver: username, status: 'sent' },
                { $set: { status: 'delivered', deliveredAt: new Date() } }
            );
            if (pending.modifiedCount > 0) {
                // Notify senders about delivery
                io.emit('bulk_delivered', { receiver: username });
            }
        } catch (e) { console.error('Delivery update error:', e); }
    })();

    // Broadcast active users
    io.emit('active_users', buildUserList());

    socket.on('update_profile', (data) => {
        const { username: newName, avatarUrl } = data;
        const oldName = activeUsers.get(socket.id);
        
        // Update the cached username and socket identity
        activeUsers.set(socket.id, newName);
        socket.user.username = newName;
        socket.user.avatarUrl = avatarUrl;
        
        // Broadcast the updated users list and the specific profile update
        io.emit('active_users', buildUserList());
        io.emit('profile_updated', { oldName, username: newName, avatarUrl });
        console.log(`👤 Profile Updated: ${oldName} -> ${newName}`);
    });

    socket.on('start_conversation', async (data) => {
        // handle both string and object for backward compatibility
        const targetUser = typeof data === 'string' ? data : data.targetUser;
        const limit = data.limit || 50;
        
        const conversationId = getConversationId(username, targetUser);
        socket.join(conversationId);
        
        // Fetch history with pagination (latest messages)
        try {
            const messages = await Message.find({ 
                conversationId, 
                deletedForUsers: { $ne: username },
                $or: [{ isScheduled: false }, { isScheduled: { $exists: false } }] 
            }).sort({ createdAt: -1 }).limit(limit).lean();
            
            // Reverse to display chronologically
            messages.reverse();
            
            const formattedMessages = messages.map(msg => formatMessage(msg));

            socket.emit('conversation_started', {
                conversationId,
                targetUser,
                messages: formattedMessages,
                hasMore: messages.length === limit
            });
        } catch (error) {
            console.error('Error fetching messages:', error);
        }
    });

    socket.on('fetch_more_messages', async (data) => {
        const { targetUser, beforeDate, limit = 50 } = data;
        const conversationId = getConversationId(username, targetUser);
        
        try {
            const messages = await Message.find({ 
                conversationId, 
                deletedForUsers: { $ne: username },
                createdAt: { $lt: new Date(beforeDate) },
                $or: [{ isScheduled: false }, { isScheduled: { $exists: false } }] 
            }).sort({ createdAt: -1 }).limit(limit).lean();
            
            messages.reverse();
            const formattedMessages = messages.map(msg => formatMessage(msg));

            socket.emit('more_messages_loaded', {
                conversationId,
                messages: formattedMessages,
                hasMore: messages.length === limit
            });
        } catch (error) {
            console.error('Error fetching more messages:', error);
        }
    });

    socket.on('mark_read', async (data) => {
        const { conversationId, targetUser } = data;
        try {
            await Message.updateMany(
                { conversationId, sender: targetUser, status: { $ne: 'read' } },
                { $set: { status: 'read', readAt: new Date() } }
            );
            socket.to(conversationId).emit('messages_read', { conversationId, reader: username });
        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    });

    socket.on('add_reaction', async (data) => {
        const { messageId, emoji, conversationId } = data;
        try {
            const msg = await Message.findById(messageId);
            if (msg) {
                const existingIndex = msg.reactions.findIndex(r => r.by === username);
                if (existingIndex > -1) {
                    if (msg.reactions[existingIndex].emoji === emoji) {
                        // Unsend reaction
                        msg.reactions.splice(existingIndex, 1);
                    } else {
                        // Change reaction
                        msg.reactions[existingIndex].emoji = emoji;
                    }
                } else {
                    // Add new reaction
                    msg.reactions.push({ emoji, by: username });
                }
                await msg.save();
                io.to(conversationId).emit('reaction_added', { messageId, reactions: msg.reactions });
            }
        } catch (error) {
            console.error('Error handling reaction:', error);
        }
    });

    socket.on('send_message', async (data) => {
        const { conversationId, message, targetUser, type, url, fileName, replyTo,
                pollData, gameData, rpsData, guessData, locationData, callData, scheduledFor } = data;

        try {
            const isScheduled = !!scheduledFor && new Date(scheduledFor) > new Date();
            
            const newMsg = new Message({
                sender: username,
                receiver: targetUser,
                conversationId,
                type: type || 'text',
                textContent: message || '',
                contentUrl: url || '',
                fileName: fileName || '',
                status: 'sent',
                replyTo: replyTo || null,
                pollData: pollData || undefined,
                gameData: gameData || undefined,
                rpsData: rpsData || undefined,
                guessData: guessData || undefined,
                locationData: locationData || undefined,
                callData: callData || undefined,
                isScheduled: isScheduled,
                scheduledFor: scheduledFor ? new Date(scheduledFor) : null
            });
            await newMsg.save();

            // Check if recipient is online — upgrade to 'delivered' immediately 
            const receiverOnline = Array.from(activeUsers.values()).includes(targetUser);
            if (receiverOnline && !isScheduled) {
                newMsg.status = 'delivered';
                newMsg.deliveredAt = new Date();
                await newMsg.save();
            }

            if (isScheduled) {
                // Only notify sender that message is scheduled
                socket.emit('message_scheduled', { 
                    id: newMsg._id, 
                    scheduledFor: newMsg.scheduledFor,
                    to: targetUser 
                });
            } else {
                const formatted = formatMessage(newMsg);
                io.to(conversationId).emit('new_message', formatted);
                
                // If it's a call log, trigger a history refresh for both parties
                if (type === 'call_log') {
                    const calls = await Message.find({
                        $or: [{ sender: username }, { receiver: username }, { sender: targetUser }, { receiver: targetUser }],
                        type: 'call_log'
                    }).sort({ createdAt: -1 }).limit(100).lean();
                    const history = calls.map(c => formatMessage(c));
                    
                    // Emit to both parties
                    socket.emit('call_history', history);
                    for (let [id, name] of activeUsers.entries()) {
                        if (name === targetUser) {
                            io.to(id).emit('call_history', history);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error saving message:', error);
        }
    });

    socket.on('delete_message', async (data) => {
        const { messageId, conversationId, mode } = data; // mode: 'forMe' or 'forEveryone'
        try {
            const msg = await Message.findById(messageId);
            if (!msg) return;

            if (mode === 'forEveryone') {
                if (msg.sender !== username) return; // Only sender can delete for everyone
                await Message.findByIdAndDelete(messageId);
                io.to(conversationId).emit('message_deleted', { messageId, mode: 'forEveryone' });
            } else {
                // For 'forMe' we usually would need a more complex 'deletedBy' array in the DB
                // For simplicity in this mock-app, we'll just delete it from DB if it's for everyone
                // or just notify the client to hide it if for self.
                socket.emit('message_deleted', { messageId, mode: 'forMe' });
            }
        } catch (error) {
            console.error('Delete error:', error);
        }
    });

    // --- Poll Voting ---
    socket.on('vote_poll', async (data) => {
        const { messageId, optionIndex, conversationId } = data;
        try {
            const msg = await Message.findById(messageId);
            if (!msg || msg.type !== 'poll') return;

            // Remove any existing vote by this user
            msg.pollData.options.forEach(opt => {
                opt.votes = opt.votes.filter(v => v !== username);
            });
            // Add vote to selected option
            if (msg.pollData.options[optionIndex]) {
                msg.pollData.options[optionIndex].votes.push(username);
            }
            await msg.save();
            io.to(conversationId).emit('poll_updated', { messageId, pollData: msg.pollData });
        } catch (error) {
            console.error('Error voting poll:', error);
        }
    });

    // --- Tic-Tac-Toe Move ---
    socket.on('ttt_move', async (data) => {
        const { messageId, cellIndex, conversationId } = data;
        try {
            const msg = await Message.findById(messageId);
            if (!msg || msg.type !== 'tictactoe' || !msg.gameData.isActive) return;
            
            const game = msg.gameData;
            // Determine player symbol
            let playerSymbol;
            if (game.playerX === username) playerSymbol = 'X';
            else if (game.playerO === username) playerSymbol = 'O';
            else if (!game.playerO) {
                // Second player joining
                game.playerO = username;
                playerSymbol = 'O';
            } else return; // Not a participant

            if (game.currentTurn !== playerSymbol) return; // Not your turn
            if (game.board[cellIndex] !== '') return; // Cell taken

            game.board[cellIndex] = playerSymbol;
            
            // Check winner
            const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
            for (const [a,b,c] of wins) {
                if (game.board[a] && game.board[a] === game.board[b] && game.board[a] === game.board[c]) {
                    game.winner = game.board[a];
                    game.isActive = false;
                    break;
                }
            }
            if (!game.winner && game.board.every(c => c !== '')) {
                game.winner = 'draw';
                game.isActive = false;
            }
            
            game.currentTurn = playerSymbol === 'X' ? 'O' : 'X';
            msg.gameData = game;
            msg.markModified('gameData');
            await msg.save();
            io.to(conversationId).emit('ttt_updated', { messageId, gameData: msg.gameData });
        } catch (error) {
            console.error('Error processing TTT move:', error);
        }
    });

    socket.on('typing_start', (data) => {
        const { conversationId } = data;
        socket.to(conversationId).emit('user_typing', { username, isTyping: true });
    });

    socket.on('typing_stop', (data) => {
        const { conversationId } = data;
        socket.to(conversationId).emit('user_typing', { username, isTyping: false });
    });

    socket.on('rps_move', async (data) => {
        try {
            const { messageId, move, conversationId } = data;
            const msg = await Message.findById(messageId);
            if (!msg || !msg.rpsData || !msg.rpsData.isActive) return;

            const game = msg.rpsData;
            if (username === game.player1 && !game.move1) {
                game.move1 = move;
            } else if (username === game.player2 && !game.move2) {
                game.move2 = move;
            } else {
                return; // Already moved or not a player
            }

            // check if both moved
            if (game.move1 && game.move2) {
                const m1 = game.move1;
                const m2 = game.move2;
                if (m1 === m2) game.winner = 'draw';
                else if ((m1 === 'rock' && m2 === 'scissors') || 
                         (m1 === 'paper' && m2 === 'rock') || 
                         (m1 === 'scissors' && m2 === 'paper')) {
                    game.winner = 'player1';
                } else {
                    game.winner = 'player2';
                }
                game.isActive = false;
            }

            msg.markModified('rpsData');
            await msg.save();
            io.to(conversationId).emit('rps_updated', { messageId, rpsData: msg.rpsData });
        } catch (error) {
            console.error('RPS error:', error);
        }
    });

    socket.on('guess_attempt', async (data) => {
        try {
            const { messageId, val, conversationId } = data;
            const msg = await Message.findById(messageId);
            if (!msg || !msg.guessData || !msg.guessData.isActive) return;

            const game = msg.guessData;
            let result = '';
            if (val > game.target) result = 'higher';
            else if (val < game.target) result = 'lower';
            else {
                result = 'correct';
                game.winner = username;
                game.isActive = false;
            }

            game.attempts.push({ by: username, val, result });
            msg.markModified('guessData');
            await msg.save();
            io.to(conversationId).emit('guess_updated', { messageId, guessData: msg.guessData });
        } catch (error) {
            console.error('Guess error:', error);
        }
    });

    socket.on('disconnect', () => {
        activeUsers.delete(socket.id);
        // Only record last-seen if no other socket for this user
        const stillOnline = Array.from(activeUsers.values()).includes(username);
        if (!stillOnline) {
            lastSeen.set(username, new Date());
        }
        io.emit('active_users', buildUserList());
    });

    socket.on('get_last_seen', (data) => {
        const ts = lastSeen.get(data.username);
        socket.emit('last_seen_result', { username: data.username, lastSeen: ts || null });
    });

    // --- Star / Unstar Message ---
    socket.on('star_message', async (data) => {
        const { messageId } = data;
        try {
            const msg = await Message.findById(messageId);
            if (!msg) return;
            const idx = msg.starred.indexOf(username);
            if (idx === -1) {
                msg.starred.push(username);
            } else {
                msg.starred.splice(idx, 1);
            }
            await msg.save();
            socket.emit('message_starred', { messageId, starred: msg.starred });
        } catch (e) { console.error('Star error:', e); }
    });

    // --- Forward Message ---
    socket.on('forward_message', async (data) => {
        const { messageId, to } = data;
        const toUser = to; 
        console.log(`[Socket] Forwarding ${messageId} from ${username} to ${to}`);
        try {
            const orig = await Message.findById(messageId);
            if (!orig) return;
            const convId = getConversationId(username, toUser);
            const receiverOnline = Array.from(activeUsers.values()).includes(toUser);
            const fwd = new Message({
                sender: username,
                receiver: toUser,
                conversationId: convId,
                type: orig.type,
                textContent: orig.textContent,
                contentUrl: orig.contentUrl,
                fileName: orig.fileName,
                locationData: orig.locationData,
                pollData: orig.pollData,
                gameData: orig.gameData,
                rpsData: orig.rpsData,
                guessData: orig.guessData,
                callData: orig.callData,
                forwardedFrom: orig.sender,
                status: receiverOnline ? 'delivered' : 'sent',
                deliveredAt: receiverOnline ? new Date() : null
            });
            await fwd.save();
            const formattedMsg = formatMessage(fwd);
            io.to(convId).emit('new_message', formattedMsg);
            
            // Also explicitly emit to the specific sockets of the sender and receiver
            // to ensure UI updates even if they don't have this specific chat open
            for (let [id, name] of activeUsers.entries()) {
                if (name === toUser || name === username) {
                    io.to(id).emit('new_message', formattedMsg);
                }
            }

            socket.emit('forward_success', { toUser });
        } catch (e) { console.error('Forward error:', e); }
    });

    // --- Call History ---
    socket.on('get_call_history', async () => {
        try {
            const calls = await Message.find({
                $or: [{ sender: username }, { receiver: username }],
                type: 'call_log'
            }).sort({ createdAt: -1 }).limit(100).lean();
            
            socket.emit('call_history', calls.map(c => formatMessage(c)));
        } catch (e) {
            console.error('Fetch calls error:', e);
        }
    });

    // --- Pin Message ---
    socket.on('pin_message', async (data) => {
        const { messageId, conversationId } = data;
        try {
            const msg = await Message.findById(messageId);
            if (!msg) return;
            msg.pinned = !msg.pinned;
            await msg.save();
            io.to(conversationId).emit('message_pinned', { messageId, pinned: msg.pinned, text: msg.textContent });
        } catch (e) { console.error('Pin error:', e); }
    });

    socket.on('clear_chat', async (data) => {
        const { conversationId } = data;
        try {
            await Message.updateMany(
                { conversationId },
                { $addToSet: { deletedForUsers: username } }
            );
            socket.emit('chat_cleared', { conversationId });
        } catch (e) { console.error('Clear chat error:', e); }
    });

    // --- WebRTC Signaling for Calls ---
    socket.on('call_user', (data) => {
        const { to, offer, type } = data;
        // Find all sockets for the target user and send the offer
        for (let [id, name] of activeUsers.entries()) {
            if (name === to && id !== socket.id) {
                io.to(id).emit('incoming_call', { from: username, offer, type });
            }
        }
    });

    socket.on('answer_call', (data) => {
        const { to, answer } = data;
        for (let [id, name] of activeUsers.entries()) {
            if (name === to && id !== socket.id) {
                io.to(id).emit('call_answered', { from: username, answer });
            }
        }
    });

    socket.on('ice_candidate', (data) => {
        const { to, candidate } = data;
        for (let [id, name] of activeUsers.entries()) {
            if (name === to && id !== socket.id) {
                io.to(id).emit('ice_candidate', { from: username, candidate });
            }
        }
    });

    socket.on('reject_call', (data) => {
        const { to } = data;
        for (let [id, name] of activeUsers.entries()) {
            if (name === to && id !== socket.id) {
                io.to(id).emit('call_rejected', { from: username });
            }
        }
    });

    socket.on('end_call', (data) => {
        const { to } = data;
        for (let [id, name] of activeUsers.entries()) {
            if (name === to && id !== socket.id) {
                io.to(id).emit('call_ended', { from: username });
            }
        }
    });
});

function buildUserList() {
    const onlineSet = new Set(activeUsers.values());
    const result = [];
    onlineSet.forEach(name => result.push({ username: name, online: true }));
    lastSeen.forEach((ts, name) => {
        if (!onlineSet.has(name)) result.push({ username: name, online: false, lastSeen: ts });
    });
    return result;
}

};
