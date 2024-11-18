const WebSocket = require('ws');
const { RTCPeerConnection } = require('wrtc');
const { exec } = require('child_process');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    const peerConnection = new RTCPeerConnection();
    
    peerConnection.ontrack = (event) => {
        console.log('Stream received:', event.streams[0]);
    };

    peerConnection.addTransceiver('video', { direction: 'recvonly' });

    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        if (data.sdp) {
            await peerConnection.setRemoteDescription(data.sdp);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            ws.send(JSON.stringify({ sdp: peerConnection.localDescription }));
        } else if (data.ice) {
            await peerConnection.addIceCandidate(data.ice);
        } else if (data.command === 'launch') {
            exec(`./xpra-control.sh ${data.app}`);
        }
    });
});
