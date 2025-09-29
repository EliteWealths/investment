const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve HTML files
app.use('/uploads', express.static('uploads')); // Serve uploaded images

// Create uploads directory
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// File storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// Store active data
const activeInvestors = new Map();
const uploadedFiles = new Map();
const chatMessages = new Map();

// Socket.io Real-time Communication
io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id);

    // Investor joins the system
    socket.on('investor-join', (data) => {
        const investorId = data.investorId || 'inv_' + Date.now();
        
        activeInvestors.set(investorId, {
            id: investorId,
            socketId: socket.id,
            joinTime: new Date(),
            ip: socket.handshake.address,
            userAgent: socket.handshake.headers['user-agent'],
            status: 'active'
        });

        // Initialize chat for this investor
        if (!chatMessages.has(investorId)) {
            chatMessages.set(investorId, []);
        }

        socket.investorId = investorId;
        
        // Notify all admin panels
        io.emit('new-investor', {
            investorId: investorId,
            joinTime: new Date().toLocaleString(),
            ip: socket.handshake.address
        });

        console.log('🎯 New investor joined:', investorId);
    });

    // Investor sends message
    socket.on('investor-message', (data) => {
        const investorId = socket.investorId;
        if (investorId && chatMessages.has(investorId)) {
            const messageData = {
                id: 'msg_' + Date.now(),
                type: 'investor',
                content: data.message,
                timestamp: new Date(),
                investorId: investorId
            };

            chatMessages.get(investorId).push(messageData);

            // Notify admin panels
            io.emit('new-message', messageData);
            console.log('💬 Investor message:', data.message);
        }
    });

    // Admin sends message to investor
    socket.on('admin-message', (data) => {
        const investorId = data.investorId;
        if (investorId && chatMessages.has(investorId)) {
            const messageData = {
                id: 'msg_' + Date.now(),
                type: 'admin',
                content: data.message,
                timestamp: new Date(),
                investorId: investorId
            };

            chatMessages.get(investorId).push(messageData);

            // Send to specific investor
            io.to(activeInvestors.get(investorId)?.socketId).emit('admin-message', messageData);
            io.emit('new-message', messageData); // Also notify admin panels
            
            console.log('👨‍💼 Admin message to', investorId, ':', data.message);
        }
    });

    // File upload notifications
    socket.on('file-upload-start', (data) => {
        io.emit('file-upload-start', data);
    });

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
        if (socket.investorId) {
            const investor = activeInvestors.get(socket.investorId);
            if (investor) {
                investor.status = 'inactive';
            }
            io.emit('investor-left', { investorId: socket.investorId });
        }
    });
});

// File upload endpoint
app.post('/upload', upload.single('paymentProof'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileInfo = {
        id: 'file_' + Date.now(),
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        uploadTime: new Date(),
        ip: req.ip,
        investorId: req.body.investorId || 'unknown'
    };

    // Store file info
    uploadedFiles.set(fileInfo.id, fileInfo);

    // Notify all connected clients via socket
    io.emit('file-uploaded', fileInfo);

    console.log('📸 FILE UPLOADED:', fileInfo.originalName, 'by', fileInfo.investorId);

    res.json({ 
        success: true, 
        file: fileInfo,
        url: `/uploads/${fileInfo.filename}`
    });
});

// API endpoints
app.get('/api/uploads', (req, res) => {
    const files = Array.from(uploadedFiles.values());
    res.json(files);
});

app.get('/api/investors', (req, res) => {
    const investors = Array.from(activeInvestors.values());
    res.json(investors);
});

app.get('/api/chat/:investorId', (req, res) => {
    const messages = chatMessages.get(req.params.investorId) || [];
    res.json(messages);
});

app.get('/api/stats', (req, res) => {
    res.json({
        totalInvestors: activeInvestors.size,
        totalFiles: uploadedFiles.size,
        onlineInvestors: Array.from(activeInvestors.values()).filter(inv => inv.status === 'active').length
    });
});

server.listen(PORT, () => {
    console.log(`🔥 EliteWealth Server running on port ${PORT}`);
    console.log(`📸 File uploads enabled - storing to /uploads/`);
    console.log(`🔌 Real-time communication active`);
});
