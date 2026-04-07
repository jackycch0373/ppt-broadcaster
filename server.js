// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Increase JSON limit to handle large Base64 images from PowerPoint
app.use(express.json({ limit: '50mb' }));

// --- WEB API ENDPOINT (For the PowerPoint VBA Plug-in) ---
app.post('/api/slide/update', (req, res) => {
    try {
        const { status, slideImage } = req.body;
        
        console.log(`Received slide update. Status: ${status}`);
        
        // Broadcast the update to all connected web viewers instantly
        io.emit('slide_changed', { status, slideImage });
        
        res.status(200).json({ message: 'Slide broadcasted successfully' });
    } catch (error) {
        console.error("Error processing slide update:", error);
        res.status(500).send("Internal Server Error");
    }
});

// --- FRONTEND WEBSITE (For the Viewers) ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Live Presentation</title>
            <style>
                body { 
                    background: #111; display: flex; justify-content: center; 
                    align-items: center; height: 100vh; margin: 0; 
                    color: white; font-family: sans-serif;
                }
                img { 
                    max-width: 95%; max-height: 95vh; 
                    box-shadow: 0 0 20px rgba(0,0,0,0.8); 
                    border-radius: 8px;
                }
                #status { font-size: 24px; color: #888; }
            </style>
        </head>
        <body>
            <div id="status">Waiting for presenter to start...</div>
            <img id="currentSlide" src="" style="display:none;" />
            
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                const statusDiv = document.getElementById('status');
                const img = document.getElementById('currentSlide');

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

// Start the server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
