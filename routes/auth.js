const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Register
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        // Check if exists
        const existing = await User.findOne({ $or: [{email}, {username}] });
        if (existing) return res.status(400).json({ error: 'Username or Email already taken' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, email, password: hashedPassword });
        await user.save();

        const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET || 'secret');
        res.json({ token, username: user.username, email: user.email, avatarUrl: user.avatarUrl, about: user.about, favorites: user.favorites || [] });
    } catch(err) {
        console.error('❌ Registration error:', err);
        res.status(500).json({ error: 'Server error while registering' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || user.authProvider === 'google') return res.status(400).json({ error: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET || 'secret');
        res.json({ token, username: user.username, email: user.email, avatarUrl: user.avatarUrl, about: user.about, favorites: user.favorites || [] });
    } catch(err) {
        console.error('❌ Login error:', err);
        res.status(500).json({ error: 'Server error while logging in' });
    }
});

// Google Login
router.post('/google', async (req, res) => {
    try {
        const { email, displayName, photoURL } = req.body;
        console.log(`📩 Google Login Request: ${email} (${displayName})`);
        
        // Simple trust based on client payload (for production: use firebase-admin to verify idToken)
        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ 
                username: displayName.replace(/\s+/g, '') + Math.floor(Math.random()*1000), 
                email, 
                authProvider: 'google',
                avatarUrl: photoURL 
            });
            await user.save();
        }
        
        const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET || 'secret');
        res.json({ token, username: user.username, email: user.email, avatarUrl: user.avatarUrl, about: user.about, favorites: user.favorites || [] });
    } catch(err) {
        console.error('❌ Google Login error:', err);
        res.status(500).json({ error: 'Server error with Google Login' });
    }
});

// Forgot Password (Mock Implementation)
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) {
            // For security, don't reveal if email exists, but here we can be helpful for dev
            return res.status(404).json({ error: 'No account found with this email' });
        }

        // Generate a mock token
        const resetToken = jwt.sign({ userId: user._id, email: user.email, type: 'reset' }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
        
        console.log('--------------------------------------------------');
        console.log(`🔑 PASSWORD RESET REQUEST FOR: ${email}`);
        console.log(`🔗 MOCK RESET LINK: http://localhost:3000/reset?token=${resetToken}`);
        console.log('--------------------------------------------------');

        res.json({ message: 'Success! A reset link has been simulated in the server console.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to process forgot password request' });
    }
});

module.exports = router;
