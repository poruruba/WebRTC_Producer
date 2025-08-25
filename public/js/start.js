'use strict';

//const vConsole = new VConsole();
//const remoteConsole = new RemoteConsole("http://[remote server]/logio-post");
//window.datgui = new dat.GUI();

const SIGNALING_URL = "wss://【立ち上げたサーバのホスト名】/signaling";
const WEBRTC_CHANNEL_ID = "WebRTC_Channel";
const WEBRTC_CLIENT_ID = "WebRTC_Client";
const WEBRTC_CHANNEL_PASSWORD = "password";
const BACKGROUND_IMAGE_URL = "./image/onepiece01_luffy2.png";

var g_webrtcDirect = null;
var g_stream = null;

var vue_options = {
    el: "#top",
    mixins: [mixins_bootstrap],
    store: vue_store,
    router: vue_router,
    data: {
        remoteClientId: null,
        signalingUrl: SIGNALING_URL,
        config: {},
        facing_mode: "environment",
        is_webrtc: false,
        is_signaling: false,
        message: "",
        received_datetime: 0,
        received_message: "",
        received_remoteClientId: "",
    },
    computed: {
    },
    methods: {
        show_url_qrcode: function(){
            var qrcode = new QRCode(document.querySelector("#qrcode"), {
                text: location.href,
                correctLevel: QRCode.CorrectLevel.H
            });
            this.dialog_open('#qrcode_dialog');
        },
        show_qrcode: function(){
            var qrcode = new QRCode(document.querySelector("#qrcode"), {
                text: this.received_message,
                correctLevel: QRCode.CorrectLevel.H
            });
            this.dialog_open('#qrcode_dialog');
        },

        stop_webrtc: async function(){
            await g_webrtcDirect.stop();
            this.is_webrtc = false;
        },

        start_webrtc: async function () {
            try {
                await g_webrtcDirect.start(this.config);
                localStorage.setItem("webrtc_config", JSON.stringify(this.config));
                this.is_signaling = true;
            } catch (error) {
                console.error(error);
                this.toast_show(error);
            }
        },

        attach_default: async function(){
            g_webrtcDirect.replaceTrack(null);

            const video = document.querySelector('#localcamera_view');
            video.src = null;
            video.srcObject = null;
            this.video_ended = false;
        },
        attach_display: async function(){
            try{
                if( !navigator.mediaDevices || navigator.mediaDevices.getDisplayMedia )
                    throw new Error("not display stream");

                var stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                const video = document.querySelector('#localcamera_view');
                video.src = null;
                video.srcObject = stream;
                this.video_ended = false;

                g_webrtcDirect.replaceTrack(stream);
            }catch(error){
                console.error(error);
                alert(error);
            }
        },
        attach_camera: async function(){
            try{
                if( !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia )
                    throw new Error("not media stream");

                const constraints = {
                    video: { facingMode: this.facing_mode },
                    audio: { echoCancellation: true, noiseSuppression: true },
                };
                var stream = await navigator.mediaDevices.getUserMedia(constraints);
                const video = document.querySelector('#localcamera_view');
                video.src = null;
                video.srcObject = stream;
                this.video_ended = false;

                g_webrtcDirect.replaceTrack(stream);
            }catch(error){
                console.error(error);
                alert(error);
            }
        },

        change_videoFile: async function(files){
            if( files.length == 0 )
                return;

            try{
                var file = files[0];
                const video = document.querySelector('#localcamera_view');
                const url = URL.createObjectURL(file);
                video.srcObject = null;
                video.src = url;
                this.video_ended = true;
                await video.play();
            }catch(error){
                console.error(error);
                alert(error);
            }
        },

        video_playing: async function(){
            if( this.video_ended ){
                this.video_ended = false;
                const video = document.querySelector('#localcamera_view');
                const stream = video.captureStream();
                g_webrtcDirect.replaceTrack(stream);
            }
        },

        video_end: async function(){
            this.video_ended = true;
        },

        send_file: async function(files){
            if( files.length == 0 )
                return;

            var file = files[0];
            var buffer = await file.arrayBuffer();
            g_webrtcDirect.sendBinary(buffer, file.name, file.type);
        },

        send_message: async function(){
            await g_webrtcDirect.sendMessage(this.message);
            this.message = "";
        },

        goto_fullscreen() {
            const video = document.querySelector('#remotecamera_view');
            if (video.requestFullscreen) {
                video.requestFullscreen();
            } else if (video.webkitRequestFullscreen) {
                video.webkitRequestFullscreen(); // Safari
            } else if (video.msRequestFullscreen) {
                video.msRequestFullscreen(); // IE/Edge
            }
        },

        onWebrtcCallback: function(module, result){
            console.log(module, result);
            if (module == "peer") {
                if (result.type == "sdpOffering1" || result.type == "sdpOffering2" ) {
                    var remoteView = document.querySelector('#remotecamera_view');
                    remoteView.srcObject = null;
                    remoteView.src = null;
                    g_stream = new MediaStream();
                } else
                if (result.type == "track") {
                    if (result.kind == "audio" || result.kind == "video") {
                        if( result.track ){
                            var remoteView = document.querySelector('#remotecamera_view');
                            g_stream.addTrack(result.track);
                            remoteView.srcObject = g_stream;
                        }
                    }
                }else
                if( result.type == "connectionstatechange") {
                    if( result.connectionState == "connected"){
                        this.remoteClientId = g_webrtcDirect.remoteClientId;
                        this.is_webrtc = true;
                        this.toast_show("WebRTCが接続されました。");
                    }
                    if( result.connectionState == "disconnected"){
                        this.is_webrtc = false;
                        this.remoteClientId = null;
                        g_webrtcDirect.stopStream(g_stream);
                        this.toast_show("WebRTCが切断されました。");
                    }
                }
            } else if (module == "signaling") {
                if (result.type == "ready") {
                    if( result.remoteClientList.length > 0)
                        g_webrtcDirect.connect(result.remoteClientList[0].clientId);
                }else if( result.type == "closed" ){
                    this.toast_show("Signalingが切断されました。");
                    this.is_signaling = false;
                }else if( result.type == "error"){
                    this.toast_show(result.message);
                    this.is_signaling = false;
                }
            }else if( module == "data" ){
                var info = result.info;
                if( info.type == "message"){
                    this.received_datetime = new Date().getTime();
                    this.received_message = info.message;
                    this.received_remoteClientId = result.remoteClientId;
                    this.toast_show(info.message, result.remoteClientId);
                    console.log(`message:[${result.remoteClientId}] ${info.message}`);
                }else
                if( info.type == "binary"){
                    if( !info.array ){
                        this.toast_show("ファイル受信中...");
                        return;
                    }
                    var blob = new Blob([info.array], { type: info.mime_type });
                    var url = window.URL.createObjectURL(blob);
                    var a = document.createElement("a");
                    a.href = url;
                    a.target = '_blank';
                    a.download = info.fname;
                    a.click();
                    window.URL.revokeObjectURL(url);
                }
            }
        },
    },
    created: function(){
    },
    mounted: async function(){
        proc_load();

        var config = localStorage.getItem("webrtc_config");
        if( config ){
            this.config = JSON.parse(config);
        }else{
            this.config = {
                channelId: WEBRTC_CHANNEL_ID,
                clientId: WEBRTC_CLIENT_ID,
                password: WEBRTC_CHANNEL_PASSWORD,
            };
        }

        g_webrtcDirect = new WebrtcDirect(this.signalingUrl, this.onWebrtcCallback, BACKGROUND_IMAGE_URL);
    }
};
vue_add_data(vue_options, { progress_title: '' }); // for progress-dialog
vue_add_global_components(components_bootstrap);
vue_add_global_components(components_utils);

/* add additional components */
  
window.vue = new Vue( vue_options );
