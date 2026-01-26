// Sound utility using Web Audio API - no external files needed

type SoundType = 'sent' | 'received' | 'error';

class SoundManager {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Play a pleasant "sent" sound - ascending tone
  playSent() {
    if (!this.enabled) return;
    this.playTone([523.25, 659.25, 783.99], 0.15, 'sine', 0.3); // C5, E5, G5
  }

  // Play a notification sound for new email - two-tone chime
  playReceived() {
    if (!this.enabled) return;
    this.playTone([880, 1108.73], 0.2, 'sine', 0.25); // A5, C#6
  }

  // Play an error sound - descending dissonant tone
  playError() {
    if (!this.enabled) return;
    this.playTone([440, 349.23, 293.66], 0.2, 'sawtooth', 0.2); // A4, F4, D4
  }

  play(type: SoundType) {
    switch (type) {
      case 'sent':
        this.playSent();
        break;
      case 'received':
        this.playReceived();
        break;
      case 'error':
        this.playError();
        break;
    }
  }

  private playTone(frequencies: number[], duration: number, type: OscillatorType, volume: number) {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      frequencies.forEach((freq, index) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(freq, now);

        // Envelope: quick attack, sustain, quick release
        const startTime = now + index * duration * 0.8;
        const endTime = startTime + duration;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.02);
        gainNode.gain.setValueAtTime(volume, endTime - 0.05);
        gainNode.gain.linearRampToValueAtTime(0, endTime);

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.start(startTime);
        oscillator.stop(endTime + 0.1);
      });
    } catch (e) {
      console.error('Failed to play sound:', e);
    }
  }
}

// Singleton instance
export const soundManager = new SoundManager();

// Convenience functions
export const playSound = (type: SoundType) => soundManager.play(type);
export const playSentSound = () => soundManager.playSent();
export const playReceivedSound = () => soundManager.playReceived();
export const playErrorSound = () => soundManager.playError();
export const setSoundEnabled = (enabled: boolean) => soundManager.setEnabled(enabled);
export const isSoundEnabled = () => soundManager.isEnabled();
