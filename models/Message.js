const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: String,
        required: true
    },
    receiver: {
        type: String,
        // Optional, if you add group chat later
        required: true
    },
    conversationId: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['text', 'image', 'video', 'voice', 'document', 'poll', 'tictactoe', 'rock_paper_scissors', 'guess_number', 'location', 'call_log'],
        default: 'text'
    },
    callData: {
        callType: { type: String, enum: ['audio', 'video', 'voice'], default: 'audio' },
        callStatus: { type: String, enum: ['missed', 'incoming', 'outgoing', 'completed'], default: 'missed' },
        callDuration: { type: Number, default: 0 } // duration in seconds
    },
    textContent: {
        type: String,
        default: ''
    },
    contentUrl: {
        type: String, // URL/Path to the file or base64 (depending on usage)
        default: ''
    },
    fileName: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
        default: 'sent'
    },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    reactions: [{
        emoji: String,
        by: String
    }],
    replyTo: {
        id: String,
        text: String,
        sender: String,
        msgType: String
    },
    // Scheduled / Future message
    isScheduled: { type: Boolean, default: false },
    scheduledFor: { type: Date, default: null },
    // Poll data
    pollData: {
        question: { type: String, default: '' },
        options: [{
            text: String,
            votes: [String] // usernames who voted
        }]
    },
    // Tic-Tac-Toe game state
    gameData: {
        board: { type: [String], default: ['','','','','','','','',''] },
        playerX: { type: String, default: '' },
        playerO: { type: String, default: '' },
        currentTurn: { type: String, default: 'X' },
        winner: { type: String, default: '' },  // 'X', 'O', 'draw', or ''
        isActive: { type: Boolean, default: true }
    },
    // Rock Paper Scissors data
    rpsData: {
        player1: String,
        player2: String,
        move1: { type: String, default: '' }, // 'rock', 'paper', 'scissors'
        move2: { type: String, default: '' },
        winner: String,
        isActive: { type: Boolean, default: true }
    },
    // Guess the Number data
    guessData: {
        target: Number,
        player1: String,
        player2: String,
        attempts: [{
            by: String,
            val: Number,
            result: String // 'high', 'low', 'correct'
        }],
        winner: String,
        isActive: { type: Boolean, default: true }
    },

    // Location data
    locationData: {
        lat: { type: Number, default: 0 },
        lng: { type: Number, default: 0 },
        label: { type: String, default: '' }
    },

    // WhatsApp-style features
    starred: [{ type: String }],        // array of usernames who starred this msg
    forwardedFrom: { type: String, default: null }, // original sender username if forwarded
    pinned: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },       // disappearing message timer
    deletedForUsers: [{ type: String }]             // "delete for me" tracking

}, { timestamps: true });

// TTL index for disappearing messages
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

module.exports = mongoose.model('message', messageSchema);