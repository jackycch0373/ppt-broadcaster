const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" }, cookie: false });
const { v4: uuidv4 } = require('uuid'); 
const fs = require('fs');
const path = require('path');

app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

// Memory store for active rooms
const activeRooms = {};

// read HTML files
const getTemplate = (name) => {
    const filePath = path.resolve(__dirname, 'view', name);
    if (!fs.existsSync(filePath)) {
        console.error(`File missing: ${filePath}`);
        return `<h1>Error: File ${name} not found</h1>`;
    }
    return fs.readFileSync(filePath, 'utf8');
};

// 1. Initialize a Room 
app.post('/api/init', (req, res) => {
    const roomId = uuidv4().substring(0, 16); // Generate short unique ID
    activeRooms[roomId] = { lastImage: null, history: {}, status: 'active',  currentVisibleIndex: null, lastUpdate: Date.now() };
    res.json({ roomId: roomId, url: `https://${req.get('host')}/room/${roomId}` });
});

// 2. Update Slide (Called by VBA Event)
app.post('/api/update', (req, res) => {
    const { roomId, slideImage, slideIndex, elements } = req.body; 
    console.log(`Update received for Room: ${roomId}, Slide Index: ${slideIndex}`);
    if (activeRooms[roomId]) {
        activeRooms[roomId].lastUpdate = Date.now();
        activeRooms[roomId].history[slideIndex] = { 
            image: slideImage, 
            elements: elements || [] // Store elements array
        };
        activeRooms[roomId].currentVisibleIndex = slideIndex;
        activeRooms[roomId].lastUpdate = Date.now();
        io.to(roomId).emit('slide_update', {
            image: slideImage,
            index: slideIndex,
            elements: elements || []
        });
        res.sendStatus(200);
    } else {
        res.status(404).send('Room not found');
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
    } else res.status(404).send('Room not found.');
});

// Root Page (The "/" Route) ---
app.get('/', (req, res) => {
    res.send(getTemplate('root.html'));
});

app.get('/guide', (req, res) => {
    res.send(getTemplate('guide.html'));
});
        
// 4. Viewer Page (The Frontend)
app.get('/room/:id', (req, res) => {
    const roomId = req.params.id;

    // If room doesn't exist in memory, redirect to root 
    if (!activeRooms[roomId]) return res.redirect('/');

    let html = getTemplate('room.html');
    // Inject the real Room ID into the placeholder
    html = html.replace(/{{ROOM_ID}}/g, roomId);
    res.send(html);

});

app.get('/room/:id/elements', (req, res) => {
    const roomId = req.params.id;
    if (!activeRooms[roomId]) return res.redirect('/');
    
    let html = getTemplate('elements.html');
    html = html.replace(/{{ROOM_ID}}/g, roomId);
    res.send(html);
});

setInterval(() => {
    const now = Date.now();
    for (const id in activeRooms) {
        // If room hasn't been updated in 1 hour, delete it
        if (now - activeRooms[id].lastUpdate > 3600000) {
            delete activeRooms[id];
        }
    }
}, 600000); // Check every 5 mins

// Socket.io Room Logic
io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        if (activeRooms[roomId]) {
            socket.emit('init_history', {
                history: activeRooms[roomId].history,
                currentIndex: activeRooms[roomId].currentVisibleIndex
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server running on port ' + PORT));
