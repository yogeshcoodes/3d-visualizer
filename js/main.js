import * as THREE from 'three';
import { ThreeViewer } from './threeViewer.js';
import { AudioEngine } from './audioEngine.js';

// Setup global DOM elements
const app = document.getElementById("app");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("error");
const toast = document.getElementById("toast");
const ui = document.getElementById("ui");

// Persistent video element
const videoPlayer = document.createElement("video");
videoPlayer.playsInline = true;
videoPlayer.loop = false;
videoPlayer.muted = true;
videoPlayer.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
document.body.appendChild(videoPlayer);

// Initialize engines
let idleTimer = null, fullscreenIdleTimer = null;
const wakeUI = () => {
    ui.classList.remove("idle");
    app.classList.remove("fullscreen-idle");
    clearTimeout(idleTimer);
    clearTimeout(fullscreenIdleTimer);
    if (document.fullscreenElement) fullscreenIdleTimer = setTimeout(() => app.classList.add("fullscreen-idle"), 2200);
    else idleTimer = setTimeout(() => ui.classList.add("idle"), 3500);
};

const viewer = new ThreeViewer(document.getElementById("viewer"), wakeUI);
const audio = new AudioEngine(videoPlayer);

// UI State
let insideView = true;
let mediaMode = "image";
let videoURLs = [];
let currentVideoIndex = 0;

// Utility functions
let toastTimer, loadingTimer;
const showToast = (msg, ms = 3000) => {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), ms);
};

const showLoading = (msg = "Loading...") => {
    clearTimeout(loadingTimer);
    loading.textContent = msg;
    loading.style.display = "flex";
    loading.classList.remove("hidden");
    loadingTimer = setTimeout(() => hideLoading(), 10000);
};

const hideLoading = () => {
    clearTimeout(loadingTimer);
    loading.classList.add("hidden");
    setTimeout(() => loading.style.display = "none", 230);
};

// ========================================================
// CONTROLS & BINDINGS
// ========================================================
document.addEventListener("pointerdown", () => audio.resume(), { passive: true });
document.addEventListener("keydown", () => audio.resume(), { passive: true });

// Bind 2-finger swipe changes from viewer back to UI sliders
viewer.onImageRotationChange = (rx, ry) => {
    document.getElementById("rotationXSlider").value = Math.round(rx);
    document.getElementById("rotationXValue").textContent = `${Math.round(rx)}°`;
    document.getElementById("rotationYSlider").value = Math.round(ry);
    document.getElementById("rotationYValue").textContent = `${Math.round(ry)}°`;
};

// Mouse Wheel for Space Distance
document.getElementById("viewer").addEventListener("wheel", e => {
    if (!insideView || !e.deltaY) return;
    e.preventDefault();
    wakeUI();
    const slider = document.getElementById("distanceSlider");
    const currentDist = Number(slider.value);
    const nextDist = Math.max(Number(slider.min), Math.min(Number(slider.max), currentDist - Math.sign(e.deltaY)));
    slider.value = nextDist;
    document.getElementById("distanceValue").textContent = nextDist;
    viewer.updateInsideDistance(nextDist);
}, { passive: false });

document.getElementById("distanceSlider").addEventListener("input", e => {
    document.getElementById("distanceValue").textContent = e.target.value;
    viewer.updateInsideDistance(e.target.value);
    wakeUI();
});

document.getElementById("frameStretchSlider").addEventListener("input", e => {
    document.getElementById("frameStretchValue").textContent = `${Math.max(0, Math.min(100, e.target.value))}%`;
    viewer.updateFrameStretch(e.target.value);
    wakeUI();
});

document.getElementById("rotationXSlider").addEventListener("input", e => {
    document.getElementById("rotationXValue").textContent = `${e.target.value}°`;
    viewer.applyImageRotation(e.target.value, document.getElementById("rotationYSlider").value);
    wakeUI();
});

document.getElementById("rotationYSlider").addEventListener("input", e => {
    document.getElementById("rotationYValue").textContent = `${e.target.value}°`;
    viewer.applyImageRotation(document.getElementById("rotationXSlider").value, e.target.value);
    wakeUI();
});

document.getElementById("viewToggleBtn").addEventListener("click", e => {
    insideView = !insideView;
    viewer.updateViewMode(insideView);
    document.getElementById("viewStatus").textContent = insideView ? "INSIDE VIEW" : "OUTSIDE • REAL 3D SPHERE";
    e.target.textContent = insideView ? "Switch to Outside" : "Switch to Inside";
    document.getElementById("distanceOnly").style.display = insideView ? "flex" : "none";
    document.getElementById("frameStretchOnly").style.display = insideView ? "flex" : "none";
    wakeUI();
});

// ========================================================
// SETTINGS PANEL & AUDIO CONTROLS
// ========================================================
document.getElementById("settingsBtn").addEventListener("click", e => {
    e.stopPropagation();
    document.getElementById("settingsPanel").classList.toggle("open");
    wakeUI();
});
document.addEventListener("click", () => document.getElementById("settingsPanel").classList.remove("open"));
document.getElementById("settingsPanel").addEventListener("click", e => e.stopPropagation());

document.getElementById("gyroSensitivitySlider").addEventListener("input", e => {
    document.getElementById("gyroSensitivityValue").textContent = `${e.target.value}%`;
    viewer.setGyroSensitivity(e.target.value);
    wakeUI();
});

// VR Split Screen Toggle
document.getElementById("vrToggle").addEventListener("click", e => {
    const isVR = !viewer.vrEnabled;
    viewer.setVRMode(isVR);
    e.target.classList.toggle("active-toggle", isVR);
    e.target.textContent = `VR Split Screen: ${isVR ? "ON" : "OFF"}`;

    if (isVR) {
        const prompt = document.getElementById("vrLandscapePrompt");
        prompt.classList.add("show");
        setTimeout(() => prompt.classList.remove("show"), 4000);

        if (!document.fullscreenElement) {
            toggleFullscreen();
        }
        try { screen.orientation.lock("landscape").catch(() => { }); } catch (err) { }
    } else {
        try { screen.orientation.unlock(); } catch (err) { }
    }
    wakeUI();
});

// Custom Reverb Dropdown Logic
const dropdownHeader = document.getElementById("reverbDropdownHeader");
const dropdownList = document.getElementById("reverbDropdownList");
const dropdownItems = document.querySelectorAll(".dropdown-item");

dropdownHeader.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownList.classList.toggle("open");
    wakeUI();
});

dropdownItems.forEach(item => {
    item.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdownItems.forEach(i => i.classList.remove("active"));
        item.classList.add("active");
        dropdownHeader.innerHTML = `${item.textContent} <span style="opacity: 0.5;">▼</span>`;
        dropdownList.classList.remove("open");

        audio.init();
        audio.setEnvironment(item.dataset.value);
        audio.resume();
        wakeUI();
    });
});
document.addEventListener("click", () => dropdownList.classList.remove("open"));

// Reverb ON/OFF Toggle
document.getElementById("reverbToggle").addEventListener("click", e => {
    audio.init();
    const isOn = !audio.reverbEnabled;
    audio.setReverb(isOn);
    e.target.classList.toggle("active-toggle", isOn);
    e.target.textContent = `Reverb: ${isOn ? "ON" : "OFF"}`;
    audio.resume();
    wakeUI();
});

// Master Mute
document.getElementById("muteAudioToggle").addEventListener("click", e => {
    audio.setMute(!audio.mute);
    e.target.textContent = `Mute Audio: ${audio.mute ? "ON" : "OFF"}`;
    audio.resume();
    wakeUI();
});

// ========================================================
// SENSOR & FULLSCREEN
// ========================================================
const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
        try {
            await document.documentElement.requestFullscreen({ navigationUI: "hide" });
            if (screen.orientation && screen.orientation.lock) await screen.orientation.lock(screen.orientation.type).catch(() => { });
        } catch (e) { }
    } else {
        await document.exitFullscreen().catch(() => { });
    }
};

window.onSensorCalibrated = () => showToast("Motion controls calibrated");
document.getElementById("sensorBtn").addEventListener("click", async () => {
    if (!viewer.sensorEnabled && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            if (await DeviceOrientationEvent.requestPermission() !== "granted") return showToast("Motion permission denied.");
        } catch (e) { return showToast("Could not access motion sensors."); }
    }
    if (!viewer.sensorEnabled) {
        viewer.enableSensor();
        document.getElementById("sensorStatus").style.display = "block";
        document.getElementById("sensorBtn").textContent = "Motion Enabled ✓";
        showToast("Motion ON — rotate your phone to look around.");
    } else {
        viewer.disableSensor();
        document.getElementById("sensorStatus").style.display = "none";
        document.getElementById("sensorBtn").textContent = "Enable Motion";
        showToast("Motion OFF — touch/mouse controls active.");
    }
    wakeUI();
});

document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);
document.getElementById("fullscreenCornerBtn").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
    const active = Boolean(document.fullscreenElement);
    document.documentElement.classList.toggle("fullscreen-mode", active);
    app.classList.toggle("fullscreen-active", active);
    document.getElementById("fullscreenCornerBtn").style.display = active ? "flex" : "none";
    document.getElementById("fullscreenBtn").textContent = active ? "Exit Fullscreen" : "Fullscreen";
    wakeUI();
});

// ========================================================
// EXPORT & MEDIA HANDLING
// ========================================================
document.getElementById("downloadBtn").addEventListener("click", async e => {
    if (!viewer.currentTexture) return showToast("Load media first.");
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "Creating GLB...";
    if (mediaMode === "video") showToast("Standard GLB cannot preserve live video. Saving current frame.", 5000);
    await viewer.exportGLB(mediaMode, videoPlayer);
    btn.textContent = "GLB Downloaded ✓";
    setTimeout(() => btn.textContent = "Download GLB", 2200);
    btn.disabled = false;
    if (mediaMode === "video") showToast("3D GLB saved with the current video frame.");
    else showToast("3D Space GLB saved.");
    wakeUI();
});

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");

const loadLocalImage = (file) => {
    stopVideo();
    mediaMode = "image";
    showLoading("Loading space image...");
    const url = URL.createObjectURL(file);
    textureLoader.load(url, tex => {
        viewer.createSpaceSphere(tex);
        hideLoading();
        URL.revokeObjectURL(url);
        showToast("Space image loaded.");
    });
};

document.getElementById("imageBtn").addEventListener("click", () => document.getElementById("imageInput").click());
document.getElementById("imageInput").addEventListener("change", e => {
    if (e.target.files[0]) loadLocalImage(e.target.files[0]);
});

let videoTexture = null;
const stopVideo = () => {
    videoPlayer.pause();
    videoURLs.forEach(url => URL.revokeObjectURL(url));
    videoURLs = [];
};

const playVideo = async (index) => {
    videoPlayer.src = videoURLs[index];
    currentVideoIndex = index;

    if (!videoTexture) {
        videoTexture = new THREE.VideoTexture(videoPlayer);
        videoTexture.colorSpace = THREE.SRGBColorSpace;
    }

    videoTexture.flipY = true;
    videoTexture.needsUpdate = true;

    audio.init();
    viewer.createSpaceSphere(videoTexture);

    try {
        videoPlayer.muted = audio.mute;
        await videoPlayer.play();
    } catch (e) {
        videoPlayer.muted = true;
        await videoPlayer.play();
        showToast("Tap once to enable video audio.", 3500);
    }
};

videoPlayer.addEventListener("ended", () => {
    if (mediaMode !== "video" || !videoURLs.length) return;
    playVideo((currentVideoIndex + 1) % videoURLs.length);
});

document.getElementById("videoBtn").addEventListener("click", () => document.getElementById("videoInput").click());
document.getElementById("videoInput").addEventListener("change", async e => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith("video/"));
    if (!files.length) return showToast("Choose valid videos.");

    stopVideo();
    mediaMode = "video";
    videoURLs = files.map(f => URL.createObjectURL(f));
    showLoading(files.length === 1 ? "Loading space video..." : `Loading ${files.length} videos...`);

    await playVideo(0);
    hideLoading();
    document.getElementById("videoBtn").textContent = files.length === 1 ? "Change Video" : `${files.length} Videos Loaded`;
    showToast(`${files.length} video(s) looping endlessly.`);
});

// Gallery Navigation (Assets Folder Only)
const galleryImages = [
    "assets/Space.jpg",
    "assets/Forest.jpg",
    "assets/Day.jpg",
    "assets/Hall.jpg",
    "assets/Snow.jpg",
    "assets/Space-2.jpg"
];
let currentGalleryIndex = 0;

const loadGalleryImage = (index) => {
    currentGalleryIndex = (index + galleryImages.length) % galleryImages.length;
    const filePath = galleryImages[currentGalleryIndex];

    stopVideo();
    mediaMode = "image";
    showLoading("Loading image...");

    textureLoader.load(filePath, tex => {
        viewer.createSpaceSphere(tex);
        hideLoading();
    }, undefined, err => {
        console.warn("Gallery load failed:", err);
        hideLoading();
        showToast("Ensure images are inside the 'assets/' folder.");
    });
};

document.getElementById("previousImageBtn").addEventListener("click", () => { wakeUI(); loadGalleryImage(currentGalleryIndex - 1); });
document.getElementById("nextImageBtn").addEventListener("click", () => { wakeUI(); loadGalleryImage(currentGalleryIndex + 1); });

// Initial Load
wakeUI();
loadGalleryImage(0);