const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { v4: uuidv4 } = require('uuid');
const io = require('socket.io')(http, {
    cors: { origin: "*" },
    // DISBALE cookies to prevent multiple tabs from conflicting
    cookie: false, 
    // Allow both methods for better compatibility
    transports: ['polling', 'websocket'] 
});

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

// Receive status updates (active/paused)
app.post('/api/status', (req, res) => {
    const { roomId, status } = req.body;
    if (activeRooms[roomId]) {
        activeRooms[roomId].status = status;
        io.to(roomId).emit('status_change', status);
        res.sendStatus(200);
    }
});

// 3. Stop Presentation (Called by VBA Stop)
app.post('/api/stop', (req, res) => {
    const { roomId } = req.body;
    if (activeRooms[roomId]) {
        io.to(roomId).emit('status_update', 'This presentation has ended and will close in 30 seconds.');
        
        // 30 second elimination timer
        setTimeout(() => {
            delete activeRooms[roomId];
            console.log(`Room ${roomId} eliminated.`);
        }, 30000);

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
                    
                    #overlay {
                        position: fixed; 
                        top: 20px; 
                        left: 50%; 
                        transform: translateX(-50%);
                        background: rgba(255, 0, 0, 0.8);
                        color: white; 
                        padding: 10px 20px;
                        border-radius: 5px; 
                        display: none; 
                        z-index: 100; 
                        font-weight: bold;
                    }
                    
                </style>
            </head>
            <body>
                <div id="overlay"></div>
                <div class="content-wrapper">
                    <div id="msg">Waiting for the presenter to start...</div>
                    <img id="slide" alt="Current Slide" />
                </div>
                <script src="/socket.io/socket.io.js"></script>
                <script>
                    // Force a brand new connection for this tab only
                    const socket = io({
                        forceNew: true,
                        reconnectionAttempts: 3,
                        timeout: 10000,
                        transports: ['polling', 'websocket']
                    });
                
                    const roomId = "${req.params.id}";
                
                    // Ensure we join the room as soon as the connection is established
                    socket.on('connect', () => {
                        console.log("Connected with ID: " + socket.id);
                        socket.emit('join_room', roomId);
                    });
                
                    socket.on('slide_update', (imgData) => {
                        if(!imgData) return;
                        document.getElementById('msg').style.display = 'none';
                        const img = document.getElementById('slide');
                        img.src = imgData;
                        img.style.display = 'block';
                    });
                
                    // If the server disconnects, try to reconnect automatically
                    socket.on('disconnect', () => {
                        document.getElementById('msg').style.display = 'block';
                        document.getElementById('msg').innerText = "Reconnecting...";
                    });
                </script>
                <script>
                    const socket = io({ forceNew: true });
                    const roomId = "${req.params.id}";
                    const overlay = document.getElementById('overlay');
            
                    socket.on('connect', () => { socket.emit('join_room', roomId); });
            
                    // Handle active/paused status
                    socket.on('status_change', (status) => {
                        if (status === 'paused') {
                            overlay.innerText = "Presenter has left the slideshow mode.";
                            overlay.style.display = 'block';
                            overlay.style.background = "rgba(255, 165, 0, 0.8)"; // Orange
                        } else {
                            overlay.style.display = 'none';
                        }
                    });
            
                    // Handle room closing (30s timer)
                    socket.on('room_closing', (seconds) => {
                        let timeLeft = seconds;
                        overlay.style.display = 'block';
                        overlay.style.background = "rgba(255, 0, 0, 0.9)"; // Red
                        
                        const timer = setInterval(() => {
                            overlay.innerText = "Presentation Ended. Redirecting to home in " + timeLeft + "s...";
                            timeLeft--;
                            if (timeLeft < 0) {
                                clearInterval(timer);
                                window.location.href = '/'; // REDIRECT TO ROOT
                            }
                        }, 1000);
                    });
            
                    socket.on('slide_update', (imgData) => {
                        document.getElementById('msg').style.display = 'none';
                        document.getElementById('slide').src = imgData;
                        document.getElementById('slide').style.display = 'block';
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
