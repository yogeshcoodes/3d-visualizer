import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export class ThreeViewer {
    constructor(container, wakeCb) {
        this.container = container;
        this.wakeCb = wakeCb;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10000);
        this.camera.position.set(0, 0, 0.01);

        // VR Stereo Setup
        this.vrEnabled = false;
        this.stereoCamera = new THREE.StereoCamera();

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;

        this.container.appendChild(this.renderer.domElement);

        this.insideView = true;
        this.currentRadius = 512;
        this.imageRotationX = 0;
        this.imageRotationY = 0;
        this.frameStretch = 100;
        this.sourceAspect = 2.0;

        this.insideSphere = null;
        this.outsideSphere = null;
        this.currentTexture = null;

        this.yaw = 0;
        this.pitch = 0;
        this.orbitYaw = 0;
        this.orbitPitch = 0;
        this.outsideZoom = 1;

        this.isDragging = false;
        this.isPinching = false;
        this.activePointers = new Map();
        this.lastPointerX = 0;
        this.lastPointerY = 0;
        this.pinchStartDistance = 0;
        this.pinchStartZoom = 1;

        this.sensorEnabled = false;
        this.sensorInitialized = false;
        this.gyroSensitivity = 50;
        this.sensorQuaternion = new THREE.Quaternion();
        this.sensorReference = new THREE.Quaternion();
        this.smoothedSensorQuaternion = new THREE.Quaternion();
        this.hasSmoothedSensor = false;
        this.screenAngle = 0;

        this.bindEvents();
        this.animate();
    }

    setVRMode(enabled) {
        this.vrEnabled = enabled;
        window.dispatchEvent(new Event('resize'));
    }

    setGyroSensitivity(val) {
        this.gyroSensitivity = val;
    }

    enableSensor() {
        this.sensorEnabled = true;
        this.sensorInitialized = false;
        this.hasSmoothedSensor = false;
    }

    disableSensor() {
        this.sensorEnabled = false;
        this.sensorInitialized = false;
        this.hasSmoothedSensor = false;
        this.applyInsideCamera();
    }

    createSpaceSphere(texture) {
        if (!texture) return;
        if (this.insideSphere) {
            this.scene.remove(this.insideSphere);
            this.insideSphere.geometry.dispose();
            this.insideSphere.material.dispose();
        }
        if (this.outsideSphere) {
            this.scene.remove(this.outsideSphere);
            this.outsideSphere.geometry.dispose();
            this.outsideSphere.material.dispose();
        }

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;

        if (texture.image && texture.image.width > 0 && texture.image.height > 0) {
            this.sourceAspect = texture.image.width / texture.image.height;
        } else {
            this.sourceAspect = 2.0;
        }
        this.currentTexture = texture;

        const insideGeo = new THREE.SphereGeometry(1, 192, 96);
        insideGeo.scale(-1, 1, 1);
        const insideMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide, toneMapped: false });
        this.insideSphere = new THREE.Mesh(insideGeo, insideMat);
        this.insideSphere.scale.setScalar(this.currentRadius);
        this.scene.add(this.insideSphere);

        const outsideGeo = new THREE.SphereGeometry(1, 256, 128);
        const outsideMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide, toneMapped: false });
        this.outsideSphere = new THREE.Mesh(outsideGeo, outsideMat);
        this.outsideSphere.scale.setScalar(this.currentRadius);
        this.scene.add(this.outsideSphere);

        this.setupFrameStretchShader(insideMat);
        this.setupFrameStretchShader(outsideMat);
        this.applyImageRotation(this.imageRotationX, this.imageRotationY);
        this.updateFrameStretch(this.frameStretch);
        this.updateViewMode(this.insideView);
    }

    updateInsideDistance(val) {
        if (!this.insideView) return;
        const t = val / 100;
        this.camera.fov = THREE.MathUtils.lerp(45, 115, t);
        this.camera.updateProjectionMatrix();
        this.currentRadius = THREE.MathUtils.lerp(25, 1000, t);
        if (this.insideSphere) this.insideSphere.scale.setScalar(this.currentRadius);
        if (this.outsideSphere) this.outsideSphere.scale.setScalar(this.currentRadius);
        this.applyImageRotation(this.imageRotationX, this.imageRotationY);
    }

    updateFrameStretch(val) {
        this.frameStretch = val;
        this.updateAllFrameStretchMaterials();
    }

    applyImageRotation(x, y) {
        this.imageRotationX = x;
        this.imageRotationY = y;
        const rx = THREE.MathUtils.degToRad(x);
        const ry = THREE.MathUtils.degToRad(y);
        if (this.insideSphere) {
            this.insideSphere.rotation.x = rx;
            this.insideSphere.rotation.y = ry + Math.PI;
        }
        if (this.outsideSphere) {
            this.outsideSphere.rotation.x = rx;
            this.outsideSphere.rotation.y = ry + Math.PI;
        }
    }

    updateViewMode(isInside) {
        this.insideView = isInside;
        if (!this.insideSphere || !this.outsideSphere) return;

        if (this.insideView) {
            this.insideSphere.visible = true;
            this.outsideSphere.visible = false;
            if (this.sensorEnabled && this.sensorInitialized) {
                this.applySensorCamera();
            } else {
                this.applyInsideCamera();
            }
        } else {
            this.insideSphere.visible = false;
            this.outsideSphere.visible = true;
            this.camera.fov = 55;
            this.camera.updateProjectionMatrix();
            this.applyOutsideCamera();
        }
        this.applyImageRotation(this.imageRotationX, this.imageRotationY);
        this.updateAllFrameStretchMaterials();
    }

    applyInsideCamera() {
        this.camera.position.set(0, 0, 0.01);
        this.camera.rotation.order = "YXZ";
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
    }

    applyOutsideCamera() {
        if (!this.outsideSphere) return;
        const distance = Math.max(this.currentRadius, 1) * 3.4 * this.outsideZoom;
        const cp = Math.cos(this.orbitPitch);
        const sp = Math.sin(this.orbitPitch);
        const sy = Math.sin(this.orbitYaw);
        const cy = Math.cos(this.orbitYaw);
        this.camera.position.set(distance * cp * sy, distance * sp, distance * cp * cy);
        this.camera.lookAt(0, 0, 0);
    }

    applySensorCamera() {
        if (!this.sensorEnabled || !this.sensorInitialized || !this.insideView || this.isDragging) return;
        this.camera.position.set(0, 0, 0.01);
        const target = this.sensorReference.clone().multiply(this.sensorQuaternion);
        if (!this.hasSmoothedSensor) {
            this.smoothedSensorQuaternion.copy(target);
            this.hasSmoothedSensor = true;
        } else {
            this.smoothedSensorQuaternion.slerp(target, 0.16 * (this.gyroSensitivity / 50));
        }
        this.camera.quaternion.copy(this.smoothedSensorQuaternion);
    }

    setupFrameStretchShader(material) {
        material.onBeforeCompile = shader => {
            shader.uniforms.frameStretch = { value: this.frameStretch / 100 };
            shader.uniforms.sourceAspect = { value: this.sourceAspect };
            shader.uniforms.viewportAspect = { value: window.innerWidth / window.innerHeight };
            shader.uniforms.viewportHeight = { value: window.innerHeight };
            shader.uniforms.flatFrame = { value: this.insideView ? 1 : 0 };
            material.userData.frameShader = shader;

            shader.fragmentShader = `
      uniform float frameStretch;
      uniform float sourceAspect;
      uniform float viewportAspect;
      uniform float viewportHeight;
      uniform float flatFrame;
      ${shader.fragmentShader}`.replace(
                "#include <map_fragment>",
                `
        vec2 customUv = vMapUv;
        float stretch = min(frameStretch, 1.0);
        
        if (stretch < 0.9999) {
            float targetAspect = sourceAspect / viewportAspect;
            float containScaleX = 1.0;
            float containScaleY = 1.0;
            
            if (targetAspect > 1.0) containScaleY = 1.0 / targetAspect;
            else containScaleX = targetAspect;
            
            float originalFrameScale = 0.50;
            containScaleX *= originalFrameScale;
            containScaleY *= originalFrameScale;
            
            float scaleX = mix(containScaleX, 1.0, stretch);
            float frozenHeightScale = mix(containScaleY, 1.0, -0.12);
            float scaleY = stretch <= -0.1195 ? frozenHeightScale : mix(containScaleY, 1.0, stretch);
            
            vec2 centeredUV = (vMapUv - 0.5);
            customUv = centeredUV / vec2(scaleX, scaleY) + 0.5;
            
            bool insideFrame = customUv.x >= 0.0 && customUv.x <= 1.0 && customUv.y >= 0.0 && customUv.y <= 1.0;
            if (!insideFrame) discard;
        }

        #define vMapUv customUv
        #include <map_fragment>
        #undef vMapUv
        `
            );
        };
        material.needsUpdate = true;
    }

    updateAllFrameStretchMaterials() {
        [this.insideSphere, this.outsideSphere].forEach(sphere => {
            if (!sphere || !sphere.material.userData.frameShader) return;
            const uniforms = sphere.material.userData.frameShader.uniforms;
            uniforms.frameStretch.value = this.frameStretch / 100;
            uniforms.sourceAspect.value = this.sourceAspect;
            uniforms.viewportAspect.value = window.innerWidth / window.innerHeight;
            uniforms.viewportHeight.value = window.innerHeight;
            uniforms.flatFrame.value = this.insideView ? 1 : 0;
        });
    }

    getPinchDistance() {
        const touches = Array.from(this.activePointers.values()).filter(p => p.type === "touch");
        if (touches.length < 2) return 0;
        return Math.hypot(touches[1].x - touches[0].x, touches[1].y - touches[0].y);
    }

    stopDragging() {
        this.isDragging = false;
        this.isPinching = false;
        this.container.classList.remove("dragging");
        if (document.pointerLockElement === this.container) {
            try { document.exitPointerLock(); } catch (_) { }
        }
    }

    bindEvents() {
        window.addEventListener("resize", () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.updateAllFrameStretchMaterials();
        });

        this.container.addEventListener("pointerdown", async e => {
            if (this.wakeCb) this.wakeCb();
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.preventDefault();
            this.activePointers.set(e.pointerId, { type: e.pointerType, x: e.clientX, y: e.clientY });

            if (e.pointerType === "touch") {
                try { this.container.setPointerCapture(e.pointerId); } catch (_) { }
                const touches = Array.from(this.activePointers.values()).filter(p => p.type === "touch");
                if (touches.length >= 2 && !this.insideView) {
                    this.isPinching = true;
                    this.isDragging = false;
                    this.pinchStartDistance = this.getPinchDistance();
                    this.pinchStartZoom = this.outsideZoom;
                    return;
                }
                if (touches.length === 1) {
                    this.isDragging = true;
                    this.lastPointerX = e.clientX;
                    this.lastPointerY = e.clientY;
                }
                return;
            }

            this.isDragging = true;
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;
            try {
                if (document.pointerLockElement !== this.container) await this.container.requestPointerLock();
            } catch (_) { }
        });

        this.container.addEventListener("pointermove", e => {
            if (this.wakeCb) this.wakeCb();
            if (this.activePointers.has(e.pointerId)) {
                this.activePointers.set(e.pointerId, { type: e.pointerType, x: e.clientX, y: e.clientY });
            }

            if (e.pointerType === "touch" && this.isPinching && !this.insideView) {
                const distance = this.getPinchDistance();
                if (this.pinchStartDistance > 0) {
                    const ratio = distance / this.pinchStartDistance;
                    this.outsideZoom = THREE.MathUtils.clamp(this.pinchStartZoom / ratio, 0.45, 2.8);
                    this.applyOutsideCamera();
                }
                return;
            }

            if (!this.isDragging) return;
            let dx = 0, dy = 0;
            if (document.pointerLockElement === this.container) {
                dx = e.movementX; dy = e.movementY;
            } else {
                dx = e.clientX - this.lastPointerX; dy = e.clientY - this.lastPointerY;
                this.lastPointerX = e.clientX; this.lastPointerY = e.clientY;
            }

            const sens = 0.0025;
            if (this.insideView) {
                this.yaw -= dx * sens;
                this.pitch -= dy * sens;

                // FIX: Clamp pitch to prevent the camera from rotating past the vertical poles
                // This stops the world from flipping upside down when looking up.
                const maxPitch = Math.PI / 2 - 0.01;
                this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

                this.yaw %= Math.PI * 2;
                this.applyInsideCamera();
            } else {
                this.orbitYaw -= dx * sens;
                this.orbitPitch += dy * sens;
                const limit = Math.PI / 2 - 0.02;
                this.orbitPitch = Math.max(-limit, Math.min(limit, this.orbitPitch));
                this.applyOutsideCamera();
            }
        });

        this.container.addEventListener("pointerup", e => {
            if (this.wakeCb) this.wakeCb();
            this.activePointers.delete(e.pointerId);
            if (e.pointerType === "touch") {
                const touches = Array.from(this.activePointers.values()).filter(p => p.type === "touch");
                if (touches.length < 2) this.isPinching = false;
                if (touches.length === 0) this.isDragging = false;
                return;
            }
            this.stopDragging();
        });

        this.container.addEventListener("pointercancel", e => {
            this.activePointers.delete(e.pointerId);
            this.isPinching = false;
            this.isDragging = false;
        });
        window.addEventListener("mouseup", e => { if (e.button === 0) this.stopDragging(); });
        window.addEventListener("blur", () => { this.stopDragging(); this.activePointers.clear(); });
        document.addEventListener("pointerlockchange", () => { if (document.pointerLockElement !== this.container) this.container.classList.remove("dragging"); });
        this.container.addEventListener("contextmenu", e => e.preventDefault());

        const updateOrientation = () => {
            this.screenAngle = (screen.orientation && typeof screen.orientation.angle === "number") ? THREE.MathUtils.degToRad(screen.orientation.angle) : 0;
        };
        if (screen.orientation) screen.orientation.addEventListener("change", updateOrientation);
        window.addEventListener("orientationchange", updateOrientation);

        window.addEventListener("deviceorientation", e => {
            if (!this.sensorEnabled || e.alpha === null) return;
            updateOrientation();
            const alpha = THREE.MathUtils.degToRad(e.alpha);
            const beta = THREE.MathUtils.degToRad(e.beta);
            const gamma = THREE.MathUtils.degToRad(e.gamma);

            const deviceEuler = new THREE.Euler(beta, alpha, -gamma, "YXZ");
            const rawDeviceQ = new THREE.Quaternion().setFromEuler(deviceEuler);
            const screenQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -this.screenAngle);
            rawDeviceQ.multiply(screenQ);
            const correctionQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
            rawDeviceQ.multiply(correctionQ);

            this.sensorQuaternion.copy(rawDeviceQ);

            if (!this.sensorInitialized) {
                this.sensorReference.copy(this.sensorQuaternion).invert();
                this.sensorInitialized = true;
                this.hasSmoothedSensor = false;
                if (window.onSensorCalibrated) window.onSensorCalibrated();
            }
        }, { passive: true });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (this.sensorEnabled && this.sensorInitialized && this.insideView && !this.isDragging) {
            this.applySensorCamera();
        }

        // VR Stereoscopic Split Screen Render
        if (this.vrEnabled && this.insideView) {
            this.renderer.setScissorTest(true);

            this.stereoCamera.update(this.camera);
            const size = new THREE.Vector2();
            this.renderer.getSize(size);

            // Render Left Eye
            this.renderer.setViewport(0, 0, size.width / 2, size.height);
            this.renderer.setScissor(0, 0, size.width / 2, size.height);
            this.renderer.render(this.scene, this.stereoCamera.cameraL);

            // Render Right Eye
            this.renderer.setViewport(size.width / 2, 0, size.width / 2, size.height);
            this.renderer.setScissor(size.width / 2, 0, size.width / 2, size.height);
            this.renderer.render(this.scene, this.stereoCamera.cameraR);

            this.renderer.setScissorTest(false);
        } else {
            // Standard Single Viewport Render
            this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
            this.renderer.render(this.scene, this.camera);
        }
    }

    async exportGLB(mediaMode, videoElement = null) {
        let exportTexture = this.currentTexture;

        if (mediaMode === "video" && videoElement && videoElement.readyState >= 2) {
            const canvas = document.createElement("canvas");
            canvas.width = videoElement.videoWidth || 2048;
            canvas.height = videoElement.videoHeight || 1024;
            canvas.getContext("2d").drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            exportTexture = new THREE.CanvasTexture(canvas);
            exportTexture.colorSpace = THREE.SRGBColorSpace;
            exportTexture.minFilter = THREE.LinearFilter;
            exportTexture.magFilter = THREE.LinearFilter;
            exportTexture.generateMipmaps = false;
        }

        const geometry = new THREE.SphereGeometry(this.currentRadius, 256, 128);
        const material = new THREE.MeshBasicMaterial({ map: exportTexture, side: THREE.FrontSide, toneMapped: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = THREE.MathUtils.degToRad(this.imageRotationX);
        mesh.rotation.y = THREE.MathUtils.degToRad(this.imageRotationY);

        const exportScene = new THREE.Scene();
        exportScene.add(mesh);

        const exporter = new GLTFExporter();
        const result = await new Promise((resolve, reject) => {
            exporter.parse(exportScene, resolve, reject, { binary: true, embedImages: true, onlyVisible: true, maxTextureSize: 8192 });
        });

        const blob = new Blob([result], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = mediaMode === "video" ? "space-sphere-video-frame.glb" : "space-sphere.glb";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        geometry.dispose();
        material.dispose();
        if (exportTexture !== this.currentTexture) exportTexture.dispose();
    }
}