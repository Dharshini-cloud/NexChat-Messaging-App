const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Get all users with last message interaction time
router.get('/', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        let requesterName = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
                requesterName = decoded.username;
            } catch (e) {}
        }

        const users = await User.find({}, 'username avatarUrl about favorites blockedUsers').lean();
        const Message = require('../models/message');

        // Enhance users with last message timestamp if requester is known
        const enhancedUsers = await Promise.all(users.map(async (u) => {
            if (!requesterName || u.username === requesterName) {
                return { ...u, lastMessageAt: 0 };
            }

            const lastMsg = await Message.findOne({
                $or: [
                    { sender: requesterName, receiver: u.username },
                    { sender: u.username, receiver: requesterName }
                ]
            }).sort({ createdAt: -1 }).select('createdAt').lean();

            return {
                ...u,
                lastMessageAt: lastMsg ? lastMsg.createdAt : 0
            };
        }));

        // Sort by last message time descending
        enhancedUsers.sort((a, b) => {
            const dateA = new Date(a.lastMessageAt).getTime();
            const dateB = new Date(b.lastMessageAt).getTime();
            return dateB - dateA;
        });

        res.json(enhancedUsers);
    } catch(err) {
        console.error('Fetch Users Error:', err);
        res.status(500).json({ error: 'Server error fetching users' });
    }
});

// Update profile
router.post('/update', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        
        const { username, about, avatarUrl } = req.body;
        
        // Validation
        if (username && username.length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            decoded.userId,
            { username, about, avatarUrl },
            { new: true, runValidators: true }
        );

        if (!updatedUser) return res.status(404).json({ error: 'User not found' });

        res.json({
            username: updatedUser.username,
            email: updatedUser.email,
            avatarUrl: updatedUser.avatarUrl,
            about: updatedUser.about
        });
    } catch (err) {
        console.error('Update Profile Error:', err);
        if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
        res.status(500).json({ error: 'Failed to update user profile' });
    }
});

// Toggle Favorite Contact
router.post('/toggle-favorite', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        
        const { contactUsername } = req.body;
        if (!contactUsername) return res.status(400).json({ error: 'Missing contact username' });

        const user = await User.findById(decoded.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isFavorite = user.favorites.includes(contactUsername);
        
        if (isFavorite) {
            // Remove from favorites
            user.favorites = user.favorites.filter(u => u !== contactUsername);
        } else {
            // Add to favorites
            user.favorites.push(contactUsername);
        }

        await user.save();
        res.json({ favorites: user.favorites });
    } catch (err) {
        console.error('Toggle Favorite Error:', err);
        res.status(500).json({ error: 'Failed to toggle favorite' });
    }
});

// Toggle Block User
router.post('/toggle-block', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        
        const { contactUsername } = req.body;
        if (!contactUsername) return res.status(400).json({ error: 'Missing contact username' });

        const user = await User.findById(decoded.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const isBlocked = user.blockedUsers.includes(contactUsername);
        
        if (isBlocked) {
            await User.findByIdAndUpdate(decoded.userId, { $pull: { blockedUsers: contactUsername } });
        } else {
            await User.findByIdAndUpdate(decoded.userId, { $addToSet: { blockedUsers: contactUsername } });
        }

        const updatedUser = await User.findById(decoded.userId);
        res.json({ blockedUsers: updatedUser.blockedUsers });
    } catch (err) {
        console.error('Toggle Block Error:', err);
        res.status(500).json({ error: 'Failed to toggle block' });
    }
});

module.exports = router;
