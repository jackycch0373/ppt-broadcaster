const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid'); // Install this: npm install uuid

app.use(express.json({ limit: '10mb' }));

// Memory store for active rooms
const activeRooms = {};

// 1. Initialize a Room (Called by VBA Start)
app.post('/api/init', (req, res) => {
    const roomId = uuidv4().substring(0, 16); // Generate short unique ID
    activeRooms[roomId] = {
        lastImage: null,
        status: 'active',
        expiryTimer: null
    };
    
    // Remote URL for this presentation
    const presentationUrl = `https://${req.get('host')}/room/${roomId}`;
    res.json({ roomId: roomId, url: presentationUrl });
});

// 2. Update Slide (Called by VBA Event)
app.post('/api/update', (req, res) => {
    const { roomId, slideImage } = req.body;
    if (activeRooms[roomId]) {
        activeRooms[roomId].lastImage = slideImage;
        // Broadcast only to people in this specific room
        io.to(roomId).emit('slide_update', slideImage);
        res.sendStatus(200);
    } else {
        res.status(404).send('Room not found');
    }
});

// 3. Stop Presentation (Called by VBA Stop)
app.post('/api/stop', (req, res) => {
    const { roomId } = req.body;
    if (activeRooms[roomId]) {
        // Set a timer to delete room in 60 seconds
        activeRooms[roomId].expiryTimer = setTimeout(() => {
            delete activeRooms[roomId];
            console.log(`Room ${roomId} deleted after 1 minute.`);
        }, 60000);
        
        io.to(roomId).emit('status_update', 'This presentation has ended and will close soon.');
        res.send('Room scheduled for deletion.');
    }
});

// 4. Viewer Page (The Frontend)
app.get('/room/:id', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Live Room ${req.params.id}</title>
                <style>body{background:#111; color:white; display:flex; justify:center; align-items:center; height:100vh; margin:0;} img{max-width:100%; max-height:100%;}</style>
            </head>
            <body>
                <div id="msg">Waiting for slide...</div>
                <img id="slide" />
                <script src="/socket.io/socket.io.js"></script>
                <script>
                    const socket = io();
                    const roomId = "${req.params.id}";
                    socket.emit('join_room', roomId);
                    socket.on('slide_update', (imgData) => {
                        document.getElementById('msg').style.display = 'none';
                        document.getElementById('slide').src = imgData;
                    });
                    socket.on('status_update', (msg) => {
                        alert(msg);
                    });
                </script>
            </body>
        </html>
    `);
});

// Socket.io Room Logic
io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        // If room exists, send current image immediately
        if (activeRooms[roomId] && activeRooms[roomId].lastImage) {
            socket.emit('slide_update', activeRooms[roomId].lastImage);
        }
    });
});

setInterval(() => {
    const now = Date.now();
    for (const id in activeRooms) {
        // If room hasn't been updated in 2 hours, delete it
        if (now - activeRooms[id].lastUpdate > 7200000) {
            delete activeRooms[id];
        }
    }
}, 600000); // Check every 10 mins

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server running on port ' + PORT));
