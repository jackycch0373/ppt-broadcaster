const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid'); 

app.use(express.json({ limit: '20mb' }));

// Memory store for active rooms
const activeRooms = {};

// 1. Initialize a Room 
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
    const { roomId, slideImage, elements } = req.body;
    if (activeRooms[roomId]) {
        // Store both the image and the interactive elements
        activeRooms[roomId].lastImage = slideImage;
        activeRooms[roomId].elements = elements || [];
        
        io.to(roomId).emit('slide_update', { 
            image: slideImage, 
            elements: elements 
        });
        res.sendStatus(200);
    }
});

// 3. Stop Presentation (Called by VBA Stop)
app.post('/api/stop', (req, res) => {
    const { roomId } = req.body;
    if (activeRooms[roomId]) {
        activeRooms[roomId].status = 'ending';
        
        // 1. Tell all current viewers that it's ending
        io.to(roomId).emit('status_update', 'The presenter has stopped the live. Redirecting to homepage in 1 minute...');
        
        // 2. Set the 60-second timer
        setTimeout(() => {
            // Send the final redirect command to all clients in the room
            io.to(roomId).emit('redirect_home');
            
            // 3. ABORT: Completely wipe the room from server memory
            delete activeRooms[roomId]; 
            console.log(`Room ${roomId} has been purged and aborted.`);
        }, 60000); 
        
        res.status(200).send('Shutdown sequence initiated.');
    } else {
        res.status(404).send('Room not found.');
    }
});

// Root Page (The "/" Route) ---
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
  
// 4. Viewer Page (The Frontend)
app.get('/room/:id', (req, res) => {

    const roomId = req.params.id;

    // ABORT CHECK: If room doesn't exist in memory, kick them to root immediately
    if (!activeRooms[roomId]) {
        return res.redirect('/');
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>Live Presentation - Room ${req.params.id}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body, html {
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        height: 100%;
                        background-color: #1a1a1a;
                        color: #ffffff;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        overflow: hidden; 
                    }

                    /* Main Content Container */
                    .content-wrapper {
                        text-align: center;
                        width: 95%;
                        max-width: 1200px;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                    }

                    /* Slide Image Styling */
                    #slide {
                        max-width: 100%;
                        max-height: 90vh; /* Scaled to fit screen height */
                        box-shadow: 0 10px 50px rgba(0,0,0,0.8);
                        border-radius: 8px;
                        display: none; /* Hidden until first slide loads */
                        transition: opacity 0.5s ease-in-out;
                    }

                    /* Waiting Message Styling */
                    #msg {
                        font-size: 1.5rem;
                        font-weight: 300;
                        padding: 20px;
                        border: 1px solid #444;
                        border-radius: 10px;
                        background: rgba(255,255,255,0.05);
                    }
                    img {
                        max-width:100%; 
                        max-height:100%;
                    }
                    .slide-container {
                        position: relative; /* Base for absolute elements */
                        display: inline-block;
                        max-width: 100%;
                        max-height: 90vh;
                    }
                    #slide { width: 100%; height: auto; display: block; }
                    
                    .interactive-element {
                        position: absolute;
                        cursor: pointer;
                        border: 1px dashed transparent; /* Hide by default */
                        transition: background 0.2s;
                    }
                    .interactive-element:hover {
                        background: rgba(255, 255, 255, 0.2);
                        border: 1px dashed white;
                    }
                    .video-placeholder {
                        background: rgba(0,0,0,0.5);
                        display: flex; justify-content: center; align-items: center;
                        color: white; font-size: 10px;
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

                    socket.on('slide_update', (data) => {
                        document.getElementById('msg').style.display = 'none';
                        const container = document.getElementById('container');
                        const img = document.getElementById('slide');
                        
                        // Hide message and show image
                        msg.style.display = 'none';
                        img.src = imgData;
                        img.style.display = 'block';
                        img.style.opacity = 1;

                         // 1. Update Image
                        img.src = data.image;
                        
                        // 2. Clear old links
                        const oldElements = document.querySelectorAll('.interactive-element');
                        oldElements.forEach(el => el.remove());

                        const oldElements = document.querySelectorAll('.interactive-element');
                        oldElements.forEach(el => el.remove());

                        // 3. Inject new Interactive Zones
                        data.elements.forEach(el => {
                            const div = document.createElement('div');
                            div.className = 'interactive-element';
                            if(el.type === 'video') div.className += ' video-placeholder';
                            
                            div.style.left = el.left + '%';
                            div.style.top = el.top + '%';
                            div.style.width = el.width + '%';
                            div.style.height = el.height + '%';
                            
                            div.onclick = () => {
                                if(el.url) window.open(el.url, '_blank');
                                else alert("This is a video element. Due to PPT restrictions, please view it on the presenter's shared screen.");
                            };
                            container.appendChild(div);
                        });
                    });

                    socket.on('status_update', (msg) => {
                        // Show a message overlay or alert
                        const msgDiv = document.getElementById('msg');
                        msgDiv.innerText = msg;
                        msgDiv.style.display = 'block';
                        document.getElementById('slide').style.opacity = '0.3';
                    });

                    socket.on('redirect_home', () => {
                        window.location.href = '/'; // Kick user back to the welcome page
                    });

                </script>
            </body>
        </html>
    `);
});

setInterval(() => {
    const now = Date.now();
    for (const id in activeRooms) {
        // If room hasn't been updated in 1 hour, delete it
        if (now - activeRooms[id].lastUpdate > 3600000) {
            delete activeRooms[id];
        }
    }
}, 600000); // Check every 10 mins

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

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server running on port ' + PORT));
