require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const User = require('./models/User');
const Message = require('./models/message');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use((req, res, next) => {
    // Relax COOP to allow Google Auth popups to communicate back
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    next();
});
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Explicit MIME type mapping for uploads
const audioMimeTypes = {
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg',
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/mp4'
};

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (audioMimeTypes[ext]) {
            res.setHeader('Content-Type', audioMimeTypes[ext]);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
}));
app.use(express.json({ limit: '10mb' }));

// --- File Storage Setup (Local Management replace Firebase) ---
const multer = require('multer');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        res.json({
            url: fileUrl,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype
        });
    } catch (err) {
        console.error('Local Upload Error:', err);
        res.status(500).json({ error: 'Failed to upload file to local server' });
    }
});

// Favicon fallback
app.get('/favicon.ico', (req, res) => res.status(204).end());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/social-media-chat', {})
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.log('MongoDB Error:', err));

// --- Routes ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));

// --- Mock AI Summarize Endpoint ---
app.post('/api/summarize', async (req, res) => {
    try {
        const { messages } = req.body;
        if (!messages || messages.length === 0) {
            return res.json({ summary: 'No messages to summarize.', keyPoints: [] });
        }

        // Mock AI: Extract key points from messages
        const textMessages = messages.filter(m => m.type === 'text' && m.message).map(m => m.message);
        const mediaCount = messages.filter(m => m.type !== 'text').length;
        const totalMessages = messages.length;
        const participants = [...new Set(messages.map(m => m.from))];
        
        // Generate mock bullet points
        const keyPoints = [];
        keyPoints.push(`📊 Total messages exchanged: ${totalMessages}`);
        keyPoints.push(`👥 Participants: ${participants.join(', ')}`);
        if (mediaCount > 0) keyPoints.push(`📎 ${mediaCount} media file(s) shared (images, videos, documents, voice)`);
        
        // Extract "important" messages (longer ones or ones with keywords)
        const importantWords = ['meeting', 'tomorrow', 'today', 'important', 'urgent', 'deadline', 'please', 'help', 'thanks', 'sorry', 'project', 'update', 'done', 'complete', 'call', 'schedule'];
        const highlighted = textMessages.filter(t => importantWords.some(w => t.toLowerCase().includes(w)));
        if (highlighted.length > 0) {
            keyPoints.push(`Key topics discussed:`);
            highlighted.slice(0, 5).forEach(h => keyPoints.push(`   • "${h.substring(0, 80)}${h.length > 80 ? '...' : ''}"`));
        }
        
        // Topic detection
        const allText = textMessages.join(' ').toLowerCase();
        const topics = [];
        if (allText.includes('work') || allText.includes('project') || allText.includes('task')) topics.push('Work/Projects');
        if (allText.includes('plan') || allText.includes('schedule') || allText.includes('meeting')) topics.push('Planning');
        if (allText.includes('hi') || allText.includes('hello') || allText.includes('hey')) topics.push('Greetings');
        if (allText.includes('food') || allText.includes('eat') || allText.includes('lunch') || allText.includes('dinner')) topics.push('Food');
        if (topics.length > 0) keyPoints.push(`💬 Topics: ${topics.join(', ')}`);
        
        // Generate summary
        let summary = '';
        if (messages.length === 1) {
            const m = messages[0];
            const content = m.message || '';
            const isCode = /[{}[\]();]/.test(content) && (content.includes('class') || content.includes('function') || content.includes('import') || content.includes('pubic') || content.includes('var') || content.includes('let') || content.includes('const'));

            if (isCode) {
                const lang = content.includes('java') ? 'Java' : content.includes('def ') ? 'Python' : 'JavaScript/Technical';
                summary = `This is a ${lang} code snippet. It appears to define logic for ${content.includes('minimumDistance') ? 'calculating minimum distance' : 'a specific algorithm'}. The code follows structured programming patterns with clear ${content.includes('Map') ? 'data structures (Map/List)' : 'logic flows'}.`;
            } else if (m.type === 'text') {
                const words = content.trim().split(/\s+/).length;
                summary = `This is a ${words}-word message from ${m.from}. The core message focuses on: "${content.substring(0, 60)}${content.length > 60 ? '...' : ''}"`;
            } else {
                summary = `This is a ${m.type} shared by ${m.from}. ${(m.fileName) ? `File: ${m.fileName}` : 'It contains visual/audio content for the conversation.'}`;
            }
        } else {
            summary = `This dialogue between ${participants.join(' and ')} spans ${totalMessages} messages. Highlights include ${mediaCount} shared media items and focused discussion on ${topics.join(', ') || 'general updates'}.`;
        }

        res.json({ summary, keyPoints });
    } catch(err) {
        console.error('Summarize error:', err);
        res.status(500).json({ error: 'Failed to summarize' });
    }
});

// --- Get Message Info ---
app.get('/api/message/:id', async (req, res) => {
    try {
        const msg = await Message.findById(req.params.id);
        if (!msg) return res.status(404).json({ error: 'Message not found' });
        res.json({
            id: msg._id,
            sender: msg.sender,
            receiver: msg.receiver,
            type: msg.type,
            status: msg.status,
            createdAt: msg.createdAt,
            deliveredAt: msg.deliveredAt,
            readAt: msg.readAt
        });
    } catch(err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Call History ---
app.get('/api/messages/call-history', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token' });
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const username = decoded.username;

        const calls = await Message.find({
            type: 'call_log',
            $or: [{ sender: username }, { receiver: username }]
        })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

        res.json(calls);
    } catch (err) {
        console.error('Call History error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Starred Messages ---
app.get('/api/starred', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token' });
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const username = decoded.username;
        const msgs = await Message.find({ starred: username })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        res.json(msgs.map(m => ({
            id: m._id,
            from: m.sender,
            to: m.receiver,
            message: m.textContent,
            type: m.type,
            url: m.contentUrl,
            timestamp: m.createdAt.toLocaleTimeString(),
            date: m.createdAt
        })));
    } catch(err) {
        res.status(500).json({ error: 'Server error' });
    }
});

require('./socket/index')(io);

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
        locationData: msg.locationData,
        deliveredAt: msg.deliveredAt,
        readAt: msg.readAt
    };
}

// --- Scheduled Message Cron ---
const cron = require('node-cron');

mongoose.connection.once('open', () => {
    console.log('📅 Starting Scheduled Message Cron...');
    cron.schedule('*/30 * * * * *', async () => {
        try {
            const now = new Date();
            const scheduledMsgs = await Message.find({
                isScheduled: true,
                scheduledFor: { $lte: now }
            });

            for (const msg of scheduledMsgs) {
                msg.isScheduled = false;
                msg.status = 'sent';
                // Use the intended schedule time as the creation time for the UI
                msg.createdAt = msg.scheduledFor; 
                await msg.save();

                const messageData = formatMessage(msg);
                io.to(msg.conversationId).emit('new_message', messageData);
                console.log(`📬 Scheduled message delivered: ${msg._id} to ${msg.receiver}`);
            }
        } catch (err) {
            console.error('Scheduled message cron error:', err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Advanced Messaging App running on http://localhost:${PORT}`);
});