const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');

app.use(express.json({ limit: '20mb' }));

// Memory store for active rooms
const activeRooms = {};

// --- NEW: Landing Page (The "/" Route) ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>PPT Live Streamer - Welcome</title>
            <style>
                body, html {
                    margin: 0; padding: 0; width: 100%; height: 100%;
                    background: linear-gradient(135deg, #1a1a1a 0%, #2c3e50 100%);
                    color: white; font-family: 'Segoe UI', Arial, sans-serif;
                    display: flex; justify-content: center; align-items: center;
                }
                .container {
                    text-align: center;
                    padding: 40px;
                    background: rgba(0, 0, 0, 0.3);
                    border-radius: 20px;
                    backdrop-filter: blur(10px);
                    box-shadow: 0 15px 35px rgba(0,0,0,0.5);
                    max-width: 600px;
                    width: 90%;
                }
                h1 { font-size: 2.5rem; margin-bottom: 10px; color: #00d2ff; }
                p { font-size: 1.1rem; line-height: 1.6; color: #ccc; }
                .status-badge {
                    display: inline-block;
                    padding: 8px 20px;
                    background: #27ae60;
                    color: white;
                    border-radius: 50px;
                    font-weight: bold;
                    margin-top: 20px;
                    font-size: 0.9rem;
                }
                .footer { margin-top: 30px; font-size: 0.8rem; color: #777; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>PPT Live Streamer</h1>
                <p>Welcome! This is a real-time PowerPoint slide publication service.</p>
                <p>To view a live presentation, please scan the <strong>QR Code</strong> shown on the presenter's screen or use the <strong>Unique URL</strong> provided to you.</p>
                
                <div class="status-badge">● Server is Active</div>
                
                <div class="footer">
                    VBA Plug-in Extension | Room Architecture v2.0
                </div>
            </div>
        </body>
        </html>
    `);
});

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
                <title>Live Presentation - Room ${req.params.id}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>  
                    /* 1. Reset and Center everything using Flexbox */
                    body, html {
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        height: 100%;
                        background-color: #1a1a1a; /* Dark background */
                        color: #ffffff;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        display: flex;
                        justify-content: center; /* Horizontal Center */
                        align-items: center;     /* Vertical Center */
                        overflow: hidden;        /* Prevent scrollbars */
                    }
    
                    /* 2. Main Content Container */
                    .content-wrapper {
                        text-align: center;
                        width: 95%;
                        max-width: 1200px;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                    }
    
                    /* 3. Slide Image Styling */
                    #slide {
                        max-width: 100%;
                        max-height: 90vh; /* Scaled to fit screen height */
                        box-shadow: 0 10px 50px rgba(0,0,0,0.8);
                        border-radius: 8px;
                        display: none; /* Hidden until first slide loads */
                        transition: opacity 0.5s ease-in-out;
                    }
    
                    /* 4. Waiting Message Styling */
                    #msg {
                        font-size: 1.5rem;
                        font-weight: 300;
                        padding: 20px;
                        border: 1px solid #444;
                        border-radius: 10px;
                        background: rgba(255,255,255,0.05);
                    }
                </style>
            </head>
            <body>
                <div class="content-wrapper">
                    <div id="msg">Waiting for the presenter to start...</div>
                    <img id="slide" alt="Current Slide" />
                </div>
                <script src="/socket.io/socket.io.js"></script>
                <script>
                    const socket = io();
                    const roomId = "${req.params.id}";
                    socket.emit('join_room', roomId);
                    socket.on('slide_update', (imgData) => {
                        if (!imgData) return; // Ignore empty data
                        const msg = document.getElementById('msg');
                        const img = document.getElementById('slide');
                        msg.style.display = 'none';  // Hide the "Waiting" text
                        img.src = imgData;           // Set the Base64 image
                        img.style.display = 'block'; // Make the image visible
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
