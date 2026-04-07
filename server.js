// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const crypto = require('crypto'); // Used to generate unique IDs

app.use(express.json({ limit: '50mb' }));

// 1. Generate a unique Room ID for a new presenter
app.get('/api/room/create', (req, res) => {
    // Generates a 6-character random hex string (e.g., "8F2A9C")
    const roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
    res.json({ roomId: roomId });
});

// 2. Receive slide updates for a SPECIFIC room
app.post('/api/slide/update/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    const { status, slideImage } = req.body;
    
    // Broadcast ONLY to viewers in this specific room
    io.to(roomId).emit('slide_changed', { status, slideImage });
    
    res.status(200).send('Broadcasted to room ' + roomId);
});

// 3. The Viewer Page (Dynamic URL based on Room ID)
app.get('/view/:roomId', (req, res) => {
    const roomId = req.params.roomId;
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Live Presentation - Room ${roomId}</title>
            <style>
                body { background: #111; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; color: white; font-family: sans-serif; }
                img { max-width: 95%; max-height: 95vh; box-shadow: 0 0 20px rgba(0,0,0,0.8); border-radius: 8px; }
                #status { font-size: 24px; color: #888; }
            </style>
        </head>
        <body>
            <div id="status">Waiting for presenter in Room <b>${roomId}</b> to start...</div>
            <img id="currentSlide" src="" style="display:none;" />
            
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                const roomId = "${roomId}";
                const statusDiv = document.getElementById('status');
                const img = document.getElementById('currentSlide');

                // Tell the server this viewer wants to join this specific room
                socket.emit('join_room', roomId);

                // Listen for slide updates in this room
                socket.on('slide_changed', (data) => {
                    if(data.status === "active") {
                        statusDiv.style.display = 'none';
                        img.src = data.slideImage;
                        img.style.display = 'block';
                    } else if (data.status === "ended") {
                        statusDiv.innerText = "Presentation Ended.";
                        statusDiv.style.display = 'block';
                        img.style.display = 'none';
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// 4. Socket.io Logic to handle joining rooms
io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`A viewer joined room: ${roomId}`);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});