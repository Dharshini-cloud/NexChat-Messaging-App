const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        // Not required for Google sign-in users
    },
    avatarUrl: {
        type: String,
        default: ''
    },
    about: {
        type: String,
        default: 'Hey there! I am using NexChat.'
    },
    authProvider: {
        type: String,
        enum: ['local', 'google'],
        default: 'local'
    },
    favorites: {
        type: [String],
        default: []
    },
    blockedUsers: {
        type: [String],
        default: []
    },
    lastSeen: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);