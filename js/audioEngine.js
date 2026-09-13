export class AudioEngine {
    constructor(videoElement) {
        this.video = videoElement;
        this.context = null;
        this.mute = false;

        // Independent states
        this.reverbEnabled = false; // Default OFF
        this.currentEnv = 'hall';
        this.wetLevel = 0.55;

        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.context = new (window.AudioContext || window.webkitAudioContext)();

        // Create source from the persistent video element
        this.source = this.context.createMediaElementSource(this.video);
        this.masterGain = this.context.createGain();

        // Reverb graph
        this.convolver = this.context.createConvolver();
        this.reverbWet = this.context.createGain();
        this.reverbWet.gain.value = 0;

        // Surround graph (Haas Effect stereo widening)
        this.delayL = this.context.createDelay(0.14);
        this.delayR = this.context.createDelay(0.14);
        this.panL = this.context.createStereoPanner();
        this.panR = this.context.createStereoPanner();
        this.panL.pan.value = -1.0;
        this.panR.pan.value = 1.0;

        this.surroundGainL = this.context.createGain();
        this.surroundGainR = this.context.createGain();
        this.surroundGainL.gain.value = 0;
        this.surroundGainR.gain.value = 0;

        // Direct routing
        this.source.connect(this.masterGain);

        // Reverb routing
        this.source.connect(this.convolver);
        this.convolver.connect(this.reverbWet);
        this.reverbWet.connect(this.masterGain);

        // Surround routing
        this.source.connect(this.delayL);
        this.source.connect(this.delayR);
        this.delayL.connect(this.panL);
        this.delayR.connect(this.panR);
        this.panL.connect(this.surroundGainL);
        this.panR.connect(this.surroundGainR);
        this.surroundGainL.connect(this.masterGain);
        this.surroundGainR.connect(this.masterGain);

        this.masterGain.connect(this.context.destination);

        this.initialized = true;
        this.setEnvironment(this.currentEnv);
        this.updateRouting();
    }

    // Algorithmic Impulse Response Generator
    generateIR(duration, decayFactor, isCave = false) {
        if (!this.context) return null;
        const rate = this.context.sampleRate;
        const length = Math.floor(rate * duration);
        const impulse = this.context.createBuffer(2, length, rate);

        for (let c = 0; c < 2; c++) {
            const data = impulse.getChannelData(c);
            let lastVal = 0;
            for (let i = 0; i < length; i++) {
                const t = i / rate;

                // Exponential decay curve
                const decay = Math.pow(1 - t / duration, decayFactor);
                const early = i < rate * 0.16 ? Math.exp(-t * 17) : 0;

                // White noise base
                let noise = ((Math.random() * 2 - 1) * 0.72 * decay) + ((Math.random() * 2 - 1) * 0.28 * early);

                // Lowpass filter for air absorption
                const filterCoeff = isCave ? 0.92 : 0.65;
                noise = (lastVal * filterCoeff) + (noise * (1 - filterCoeff));
                lastVal = noise;

                data[i] = noise;
            }
        }
        return impulse;
    }

    setEnvironment(type) {
        this.currentEnv = type;
        if (!this.context) return;

        let duration, decay, delayTimeL, delayTimeR, isCave = false;

        // Acoustic parameters map
        switch (type) {
            case 'room':
                duration = 1.5; decay = 2.5; this.wetLevel = 0.35;
                delayTimeL = 0.012; delayTimeR = 0.017;
                break;
            case 'hall':
                duration = 3.2; decay = 2.35; this.wetLevel = 0.55;
                delayTimeL = 0.026; delayTimeR = 0.041;
                break;
            case 'arena':
                duration = 5.0; decay = 1.8; this.wetLevel = 0.65;
                delayTimeL = 0.045; delayTimeR = 0.065;
                break;
            case 'cave':
                duration = 6.0; decay = 1.2; this.wetLevel = 0.68;
                delayTimeL = 0.035; delayTimeR = 0.055;
                isCave = true;
                break;
        }

        this.convolver.buffer = this.generateIR(duration, decay, isCave);

        // Dynamically adjust Haas delays based on room size
        this.delayL.delayTime.value = delayTimeL;
        this.delayR.delayTime.value = delayTimeR;

        this.updateRouting();
    }

    setReverb(enabled) {
        this.reverbEnabled = enabled;
        this.updateRouting();
    }

    setMute(isMuted) {
        this.mute = isMuted;
        this.updateRouting();
    }

    updateRouting() {
        if (!this.masterGain || !this.context) return;
        const now = this.context.currentTime;

        // Smooth transition anchoring
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
        this.masterGain.gain.linearRampToValueAtTime(this.mute ? 0 : 1, now + 0.05);

        // Reverb Wet (Force true 0.0 when off)
        this.reverbWet.gain.cancelScheduledValues(now);
        this.reverbWet.gain.setValueAtTime(this.reverbWet.gain.value, now);
        this.reverbWet.gain.linearRampToValueAtTime(this.reverbEnabled && !this.mute ? this.wetLevel : 0, now + 0.05);

        // Surround Width (Now kills completely when Reverb is OFF to ensure a 100% dry signal)
        this.surroundGainL.gain.cancelScheduledValues(now);
        this.surroundGainL.gain.setValueAtTime(this.surroundGainL.gain.value, now);
        this.surroundGainL.gain.linearRampToValueAtTime(this.reverbEnabled && !this.mute ? 0.38 : 0, now + 0.05);

        this.surroundGainR.gain.cancelScheduledValues(now);
        this.surroundGainR.gain.setValueAtTime(this.surroundGainR.gain.value, now);
        this.surroundGainR.gain.linearRampToValueAtTime(this.reverbEnabled && !this.mute ? 0.38 : 0, now + 0.05);
    }

    async resume() {
        if (this.context && this.context.state === "suspended") {
            try {
                await this.context.resume();
            } catch (e) {
                console.warn("Audio resume error:", e);
            }
        }
    }
}