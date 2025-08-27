class WebrtcDirect {
    constructor(signalingUrl, callback, imgsrc) {
        this.DEFAULT_DATA_LABEL = "defaultDataLabel";
        this.DEFAULT_CHUNK_SIZE = 16 * 1024;
        this.callback = callback;
        this.peerConnection = null;
        this.dataChannel = null;
        this.remoteClientId = null;
        this.image = new Image();

        this.signalingClient = new WebrtcSignalingClient("direct", signalingUrl);

        this.signalingClient.on('open', async () => {
            if (this.callback) this.callback('signaling', { type: 'opened' });
        });

        this.signalingClient.on('close', async () => {
            if (this.callback) this.callback('signaling', { type: 'closed' });
        });

        this.signalingClient.on('error', async (message) => {
            if (this.callback) this.callback('signaling', { type: 'error', message: message });
        });

        this.signalingClient.on('ready', async (remoteClientList) => {
            if (this.callback) this.callback('signaling', { type: 'ready', remoteClientList: remoteClientList });
        });

        this.signalingClient.on('sdpAnswer', async (remoteClientId, answer) => {
            await this.resolveAnswer(remoteClientId, answer);
        });

        this.signalingClient.on('iceCandidate', async (remoteClientId, candidate) => {
//            console.log("signalingClient.on 'iceCandidate'");
            if( this.remoteClientId != remoteClientId )
                return;

            if (candidate) {
                await this.peerConnection.addIceCandidate(candidate);
            }
        });

        var options = {
            imageSrc: imgsrc,
            message: 'WebRTC接続中...'
        };
        this.prepareDefaultStream(options);
    }

    changeImageFile(file){
        if( file )
            this.image.src = URL.createObjectURL(file);
        else
            this.image.src = null;
    }

    prepareDefaultStream(options = {}) {
        const {
            width = 640,
            height = 480,
            backgroundColor = 'black',
            textColor = 'white',
            font = '16px sans-serif',
            message = 'WebRTC接続中',
            imageSrc = null,
            interval = 3000,
            imageFitMode = 'contain' // 'contain' | 'cover' | 'stretch'
        } = options;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false });

        const img = imageSrc ? new Image() : null;

        const drawLoop = () => {
            if (this.image.src){
                if(this.image.complete && this.image.naturalWidth > 0) {
                    if( canvas.width != this.image.naturalWidth || canvas.height != this.image.naturalHeight){
                        canvas.width = this.image.naturalWidth;
                        canvas.height = this.image.naturalHeight;
                    }
                    ctx.drawImage(this.image, 0, 0);
                }else{
                    ctx.fillStyle = backgroundColor;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            }else{
                if( canvas.width != width || canvas.height != height){
                    canvas.width = width;
                    canvas.height = height;
                }
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                if (img && img.complete && img.naturalWidth > 0) {
                    this.drawImageFit(ctx, img, canvas, imageFitMode);
                } else {
                    ctx.fillStyle = textColor;
                    ctx.font = font;
                    ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
                }
            }
        }

        if (img)
            img.src = imageSrc;
        drawLoop();
        setInterval(drawLoop, interval);

        this.defaultVideoStream = canvas.captureStream();

        const audioCtx = new AudioContext();
        const dst = audioCtx.createMediaStreamDestination();
        this.defaultAudioStream = dst.stream;
    }

    // params: channelId, password, clientId
    async start(params = {}) {
        const {
            channelId = "WebRTC_Channel",
            password = "password",
            clientId = "WebRTC_Client"
        } = params;

        this.signalingClient.on('sdpOffer1', async (remoteClientId, offer) => {
            this.disconnect();

            this.createPeerConnection(this.DEFAULT_DATA_LABEL);

            let streams = [
                this.defaultVideoStream,
                this.defaultAudioStream
            ];
            await this.processOffer(remoteClientId, offer, streams);

            this.signalingClient.on('sdpAnswer', async (remoteClientId2, answer) => {
                if( remoteClientId != remoteClientId2 )
                    return;
                await this.resolveAnswer(remoteClientId2, answer);
            });
            await this.startOffering2(remoteClientId);
        });
        
        await this.signalingClient.open(channelId, password, clientId);
        if (this.callback) this.callback('signaling', { type: 'opening' });
    }

    async connect(remoteClientId){
      this.disconnect();

      this.signalingClient.on('sdpOffer2', async (remoteClientId, offer) => {
        if( this.remoteClientId != remoteClientId )
          return;

        let streams = [
          this.defaultVideoStream,
          this.defaultAudioStream
        ];
        await this.processOffer(remoteClientId, offer, streams);
      });
      this.createPeerConnection(this.DEFAULT_DATA_LABEL);

      await this.startOffering(remoteClientId);
    }

    disconnect(){
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
            this.remoteClientId = null;
        }
    }

    createPeerConnection(dataLabel){
        const iceServers = [];
        iceServers.push({ urls: `stun:stun.l.google.com:19302` });
        const configuration = {
            iceServers,
            iceTransportPolicy: 'all',
        };
        this.peerConnection = new RTCPeerConnection(configuration);

        this.dataChannel = this.peerConnection.createDataChannel(dataLabel);
        this.dataChannel.addEventListener("bufferedamountlow", (e) =>{
            this.sendContinue();
        });
        this.peerConnection.addEventListener("datachannel", event => {
            event.channel.addEventListener("message", async (e) => {
              var info = await this.receiveData(e.data);
              if( info )
                  if (this.callback) this.callback("data", { remoteClientId: this.remoteClientId, label: e.target.label, info: info });
            });
        });

        this.peerConnection.addEventListener('icecandidate', async ({ candidate }) => {
            console.log("sendIceCandidate 'iceCandidate'");
            this.signalingClient.sendIceCandidate(this.remoteClientId, candidate);
        });

        this.peerConnection.addEventListener('track', event => {
            if (this.callback) this.callback('peer', { type: 'track', kind: event.track.kind, streams: event.streams, track: event.track });
        });

        this.peerConnection.addEventListener('connectionstatechange', (event) => {
            if (this.callback) this.callback('peer', { type: 'connectionstatechange', connectionState: event.target.connectionState });
        });
        this.peerConnection.addEventListener('negotiationneeded', (event) => {
            if (this.callback) this.callback('peer', { type: 'negotiationneeded' });
        });
        this.peerConnection.addEventListener('icegatheringstatechange', (event) => {
            if (this.callback) this.callback('peer', { type: 'icegatheringstatechange', iceGatheringState: event.target.iceGatheringState });
        });
        this.peerConnection.addEventListener('iceconnectionstatechange', (event) => {
            if (this.callback) this.callback('peer', { type: 'iceconnectionstatechange', iceConnectionState: event.target.iceConnectionState });
        });
        this.peerConnection.addEventListener('icecandidateerror', (event) => {
            if (this.callback) this.callback('peer', { type: 'icecandidateerror', errorCode: event.errorCode, errorText: event.errorText });
        });
        this.peerConnection.addEventListener('signalingstatechange', (event) => {
            if (this.callback) this.callback('peer', { type: 'signalingstatechange', signalingState: event.target.signalingState });
        });
    }

    async startOffering(remoteClientId){
        this.remoteClientId = remoteClientId;

        var offer = await this.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
        });
        await this.peerConnection.setLocalDescription(offer);

        this.signalingClient.sendSdpOffer1(this.remoteClientId, offer);
        if (this.callback) this.callback('peer', { type: 'sdpOffering1', remoteClientId: this.remoteClientId });
    }

    async startOffering2(remoteClientId){
        this.remoteClientId = remoteClientId;

        var offer = await this.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
        });
        await this.peerConnection.setLocalDescription(offer);

        this.signalingClient.sendSdpOffer2(this.remoteClientId, offer);
        if (this.callback) this.callback('peer', { type: 'sdpOffering2', remoteClientId: this.remoteClientId });
    }

    async resolveAnswer(remoteClientId, answer){
        if( this.remoteClientId != remoteClientId )
            return;

        await this.peerConnection.setRemoteDescription(answer);
        if (this.callback) this.callback('peer', { type: 'sdpAnswered', remoteClientId: this.remoteClientId });
    }

    stopStream(stream){
        if (!stream)
            return;
        stream.getTracks().forEach(track => track.stop());
    }

    async replaceTrack(stream){
        if( stream )
            console.log(stream.getTracks());
        if( !this.peerConnection )
            return;

        const senders = this.peerConnection.getSenders();

        const videoSender = senders.find(s => s.track?.kind === "video");
        const defaultVideoTrack = this.defaultVideoStream.getVideoTracks()[0];
        const newVideoTrack = stream?.getVideoTracks()[0] || defaultVideoTrack;

        if (videoSender?.track && videoSender.track !== defaultVideoTrack)
            videoSender.track.stop();

        await videoSender.replaceTrack(newVideoTrack);

        const audioSender = senders.find(s => s.track?.kind === "audio");
        const defaultAudioTrack = this.defaultAudioStream.getAudioTracks()[0];
        const newAudioTrack = stream?.getAudioTracks()[0] || defaultAudioTrack;

        if (audioSender?.track && audioSender.track !== defaultAudioTrack)
            audioSender.track.stop();

        await audioSender.replaceTrack(newAudioTrack);
    }

    async processOffer(remoteClientId, offer, streams){
        await this.peerConnection.setRemoteDescription(offer);
        if (this.callback) this.callback('peer', { type: 'sdpOffered', remoteClientId: remoteClientId });

        console.log(this.peerConnection.getSenders());
        for( let stream of streams ){
            console.log(stream.getTracks());
            stream.getTracks().forEach(track => this.peerConnection.addTrack(track, stream));
        }

        var answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        this.signalingClient.sendSdpAnswer(remoteClientId, answer);
        if (this.callback) this.callback('peer', { type: 'sdpAnswering', remoteClientId: remoteClientId });
    }

    stop() {
        this.disconnect();
        this.signalingClient.close();
    }

    sendData(data) {
        if (!this.dataChannel || this.dataChannel.readyState != "open")
            throw new Error("client not ready");

        this.dataChannel.send(data);
    }

    sendMessage(message) {
        var data = {
          type: "message",
          message: message
        };
        this.sendData(JSON.stringify(data));
    }

    sendContinue(){
        console.log("sendContinue");
        if( !this.sendArray )
            return;

        const chunk = this.sendArray.slice(this.sendOffset, this.sendOffset + this.DEFAULT_CHUNK_SIZE);
        this.sendData(chunk);
        this.sendOffset += chunk.byteLength;
        if( this.sendOffset >= this.sendArray.byteLength ){
            this.sendData(JSON.stringify({ type: "binary", done: true }));
            this.sendArray = null;
            this.sendOffset = 0;   
        }
    }

    async sendBinary(array, fname, mime_type){
        console.log("sendBinary");
        var hash = await this.hashUint8Array(array);
        this.sendArray = array;
        this.sendOffset = 0;
        var data = {
            type: "binary",
            length: this.sendArray.byteLength,
            fname: fname || "notitled.bin",
            mime_type: mime_type || "application/octet-stream",
            hash: hash
        };
        this.sendData(JSON.stringify(data));
    }

    async receiveData(data){
        console.log("receiveData");
        if( data instanceof ArrayBuffer ){
            if( this.recvChunks ){
                const view = new Uint8Array(data);
                this.recvChunks.push(view);
                this.recvOffset += view.length;
            }
            return null;
        }else{
            var info = JSON.parse(data);
            if( info.type == "message" ){
                return info;
            }else if( info.type == 'binary'){
                if( !info.done ){
                    this.recvChunks = [];
                    this.recvOffset = 0;
                    this.recvInfo = info;
                    return info;
                }else{
                    var info = this.recvInfo;
                    var array = new Uint8Array(this.recvOffset);
                    let offset = 0;
                    for(let chunk of this.recvChunks) {
                        array.set(chunk, offset);
                        offset += chunk.length;
                    }
//                    console.log(array);
                    this.recvChunks = null;

                    var hash = await this.hashUint8Array(array)
                    if( info.length != this.recvOffset || hash != info.hash ){
                        console.error("check mismatch");
                        alert("ファイル受信失敗");
                        return null;
                    }
                    info.array = array;
                    return info;
                }
            }
        }
    }

    async hashUint8Array(uint8) {
        const digest = await crypto.subtle.digest("SHA-256", uint8);
        const hex = Array.from(new Uint8Array(digest))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
        return hex;
    }

    drawImageFit(ctx, img, canvas, mode){
        if (mode === 'stretch') {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }else{
            const imgRatio = img.width / img.height;
            const canvasRatio = canvas.width / canvas.height;

            let drawWidth, drawHeight;
            if ((mode == 'contain' && imgRatio > canvasRatio) || (mode == 'cover' && imgRatio < canvasRatio)) {
                drawWidth = canvas.width;
                drawHeight = canvas.width / imgRatio;
            } else {
                drawHeight = canvas.height;
                drawWidth = canvas.height * imgRatio;
            }

            const offsetX = (canvas.width - drawWidth) / 2;
            const offsetY = (canvas.height - drawHeight) / 2;

            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        }
    }
}

