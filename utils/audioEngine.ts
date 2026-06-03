/**
 * audioEngine.ts — Web Audio API synthesizer for songwriting arrangement playback.
 * Provides piano, bass, drum, and melody lead voices with accurate scheduling.
 */

import { ChordInfo, MelodyNote, SongArrangement } from '../types';
import { getChordFrequencies, getBassFrequency } from './chordEngine';

// ── Audio Context Singleton ──

let _ctx: AudioContext | null = null;
function getCtx(): AudioContext {
    if (!_ctx) _ctx = new AudioContext();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
}

// ── MIDI to Frequency ──

function midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── ADSR Envelope Helper ──

function applyEnvelope(
    gain: GainNode,
    time: number,
    attack: number,
    decay: number,
    sustain: number,
    release: number,
    duration: number,
) {
    const g = gain.gain;
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(1, time + attack);
    g.linearRampToValueAtTime(sustain, time + attack + decay);
    g.setValueAtTime(sustain, time + duration - release);
    g.linearRampToValueAtTime(0, time + duration);
}

// ── Piano Voice ──

function playPianoChord(ctx: AudioContext, dest: AudioNode, chord: ChordInfo, time: number, duration: number, volume: number) {
    const freqs = getChordFrequencies(chord, 4);
    const perNote = volume / freqs.length;

    for (const freq of freqs) {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(freq, time);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2.01, time); // slight detune for warmth
        osc2.detune.setValueAtTime(3, time);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(dest);

        applyEnvelope(gain, time, 0.01, 0.15, 0.3 * perNote, 0.3, duration);

        osc1.start(time);
        osc1.stop(time + duration + 0.1);
        osc2.start(time);
        osc2.stop(time + duration + 0.1);
    }
}

// ── Bass Voice ──

function playBass(ctx: AudioContext, dest: AudioNode, chord: ChordInfo, time: number, duration: number, volume: number) {
    const freq = getBassFrequency(chord);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, time);
    filter.Q.setValueAtTime(2, time);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    applyEnvelope(gain, time, 0.02, 0.1, 0.6 * volume, 0.15, duration);

    osc.start(time);
    osc.stop(time + duration + 0.2);
}

// ── Melody Lead Voice ──
// Rich lead synth: sine + saw (detuned) + subtle vibrato via LFO

function playMelodyNote(ctx: AudioContext, dest: AudioNode, midi: number, time: number, duration: number, volume: number) {
    const freq = midiToFreq(midi);

    // Primary oscillator — sine for purity
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, time);

    // Secondary oscillator — triangle one octave up, detuned for shimmer
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq, time);
    osc2.detune.setValueAtTime(7, time); // 7 cents detune for chorus effect

    // Subtle vibrato LFO
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(5, time); // 5 Hz vibrato
    lfoGain.gain.setValueAtTime(0, time);
    // Vibrato fades in after the attack phase
    lfoGain.gain.linearRampToValueAtTime(0, time + 0.08);
    lfoGain.gain.linearRampToValueAtTime(3, time + duration * 0.4); // 3 cents depth
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.detune);
    lfoGain.connect(osc2.detune);

    // Gain envelope
    const gain = ctx.createGain();

    // Slight lowpass filter for warmth
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 4, 8000), time);
    filter.Q.setValueAtTime(0.7, time);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    // ADSR: quick attack, smooth sustain, gentle release
    const attack = 0.015;
    const decay = 0.08;
    const sustain = volume * 0.7;
    const release = Math.min(0.15, duration * 0.3);
    applyEnvelope(gain, time, attack, decay, sustain, release, duration);

    lfo.start(time);
    lfo.stop(time + duration + 0.2);
    osc1.start(time);
    osc1.stop(time + duration + 0.2);
    osc2.start(time);
    osc2.stop(time + duration + 0.2);
}

// ── Drum Voices ──

function playKick(ctx: AudioContext, dest: AudioNode, time: number, volume: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    osc.connect(gain);
    gain.connect(dest);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc.start(time);
    osc.stop(time + 0.35);
}

function playSnare(ctx: AudioContext, dest: AudioNode, time: number, volume: number) {
    // Noise burst
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2000, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    noise.start(time);
    noise.stop(time + 0.15);

    // Tonal body
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, time);
    osc.connect(oscGain);
    oscGain.connect(dest);
    oscGain.gain.setValueAtTime(volume * 0.3, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    osc.start(time);
    osc.stop(time + 0.1);
}

function playHihat(ctx: AudioContext, dest: AudioNode, time: number, volume: number, open: boolean = false) {
    const bufferSize = ctx.sampleRate * (open ? 0.15 : 0.04);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(8000, time);

    const gain = ctx.createGain();
    const dur = open ? 0.2 : 0.06;
    gain.gain.setValueAtTime(volume * 0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    noise.start(time);
    noise.stop(time + dur + 0.05);
}

// ── Drum Pattern Definitions ──
// Each pattern is an array of 8 eighth-note steps per measure.
// K = kick, S = snare, H = hihat, O = open hihat, . = rest

type DrumStep = { kick?: boolean; snare?: boolean; hihat?: boolean; openHat?: boolean };

function getDrumPattern(type: SongArrangement['drumPattern']): DrumStep[] {
    switch (type) {
        case 'basic': return [
            { kick: true, hihat: true }, { hihat: true }, { snare: true, hihat: true }, { hihat: true },
            { kick: true, hihat: true }, { hihat: true }, { snare: true, hihat: true }, { hihat: true },
        ];
        case 'upbeat': return [
            { kick: true, hihat: true }, { hihat: true }, { snare: true, hihat: true }, { kick: true, hihat: true },
            { hihat: true }, { kick: true, hihat: true }, { snare: true, hihat: true }, { hihat: true },
        ];
        case 'halftime': return [
            { kick: true, hihat: true }, { hihat: true }, { hihat: true }, { hihat: true },
            { snare: true, hihat: true }, { hihat: true }, { hihat: true }, { openHat: true },
        ];
        case 'shuffle': return [
            { kick: true, hihat: true }, {}, { hihat: true }, { kick: true },
            { snare: true, hihat: true }, {}, { hihat: true }, {},
        ];
        default: return getDrumPattern('basic');
    }
}

// ── Playback Engine ──

export interface PlaybackState {
    isPlaying: boolean;
    currentSection: number;
    currentLine: number;
    progress: number; // 0-1
}

type PlaybackCallback = (state: PlaybackState) => void;

export class ArrangementPlayer {
    private scheduledSources: AudioScheduledSourceNode[] = [];
    private _isPlaying = false;
    private _timerId: number | null = null;
    private _startTime = 0;
    private _totalDuration = 0;
    private _arrangement: SongArrangement | null = null;
    private _onUpdate: PlaybackCallback | null = null;

    get isPlaying() { return this._isPlaying; }

    /** Schedule and play the full arrangement. */
    play(arrangement: SongArrangement, onUpdate?: PlaybackCallback) {
        this.stop();
        this._arrangement = arrangement;
        this._onUpdate = onUpdate || null;
        this._isPlaying = true;

        const ctx = getCtx();
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.7, ctx.currentTime);
        masterGain.connect(ctx.destination);

        const beatDur = 60 / arrangement.bpm; // duration of one beat (quarter note)
        const eighthDur = beatDur / 2;
        const measureDur = beatDur * 4; // 4/4 time

        let time = ctx.currentTime + 0.1; // small offset to avoid clicks
        this._startTime = time;
        this._totalDuration = 0;

        const drumPattern = getDrumPattern(arrangement.drumPattern);
        const drumVol = 0.4;
        const melodyEnabled = arrangement.instruments.melody !== false; // default true for backward compat

        // Calculate total line count for progress
        const totalLines = arrangement.sections.reduce((sum, s) => sum + s.chords.length, 0);
        let lineIndex = 0;

        for (let si = 0; si < arrangement.sections.length; si++) {
            const sec = arrangement.sections[si];
            for (let li = 0; li < sec.chords.length; li++) {
                const chord = sec.chords[li];

                // Piano: play chord at start of measure
                if (arrangement.instruments.piano) {
                    playPianoChord(ctx, masterGain, chord, time, measureDur * 0.9, 0.35);
                }

                // Bass: play on beats 1 and 3
                if (arrangement.instruments.bass) {
                    playBass(ctx, masterGain, chord, time, beatDur * 1.8, 0.5);
                    playBass(ctx, masterGain, chord, time + beatDur * 2, beatDur * 1.8, 0.4);
                }

                // Drums: 8 eighth-note steps per measure
                if (arrangement.instruments.drums) {
                    for (let step = 0; step < 8; step++) {
                        const t = time + step * eighthDur;
                        const d = drumPattern[step];
                        if (d.kick) playKick(ctx, masterGain, t, drumVol);
                        if (d.snare) playSnare(ctx, masterGain, t, drumVol);
                        if (d.hihat) playHihat(ctx, masterGain, t, drumVol);
                        if (d.openHat) playHihat(ctx, masterGain, t, drumVol, true);
                    }
                }

                // Melody: schedule each note in the melody line
                if (melodyEnabled && sec.melodies && sec.melodies[li]) {
                    const melodyNotes: MelodyNote[] = sec.melodies[li];
                    let noteTime = time;
                    for (const note of melodyNotes) {
                        const noteDur = note.duration * beatDur;
                        playMelodyNote(ctx, masterGain, note.midi, noteTime, noteDur * 0.9, 0.45);
                        noteTime += noteDur;
                    }
                }

                time += measureDur;
                lineIndex++;
            }
        }

        this._totalDuration = time - this._startTime;

        // Progress update timer
        if (this._onUpdate) {
            const update = () => {
                if (!this._isPlaying) return;
                const elapsed = getCtx().currentTime - this._startTime;
                const progress = Math.min(elapsed / this._totalDuration, 1);

                // Determine current section/line from elapsed time
                let accTime = 0;
                let curSection = 0;
                let curLine = 0;
                const mDur = measureDur;
                outer:
                for (let si = 0; si < arrangement.sections.length; si++) {
                    for (let li = 0; li < arrangement.sections[si].chords.length; li++) {
                        if (accTime + mDur > elapsed) {
                            curSection = si;
                            curLine = li;
                            break outer;
                        }
                        accTime += mDur;
                    }
                }

                this._onUpdate?.({ isPlaying: true, currentSection: curSection, currentLine: curLine, progress });

                if (progress >= 1) {
                    this._isPlaying = false;
                    this._onUpdate?.({ isPlaying: false, currentSection: 0, currentLine: 0, progress: 1 });
                    return;
                }
                this._timerId = window.requestAnimationFrame(update);
            };
            this._timerId = window.requestAnimationFrame(update);
        }

        // Auto-stop after playback ends
        setTimeout(() => {
            if (this._isPlaying && this._arrangement === arrangement) {
                this.stop();
                this._onUpdate?.({ isPlaying: false, currentSection: 0, currentLine: 0, progress: 0 });
            }
        }, this._totalDuration * 1000 + 500);
    }

    /** Stop playback immediately. */
    stop() {
        this._isPlaying = false;
        if (this._timerId !== null) {
            window.cancelAnimationFrame(this._timerId);
            this._timerId = null;
        }
        // Closing and recreating context is the cleanest way to stop all scheduled audio
        if (_ctx && _ctx.state !== 'closed') {
            try { _ctx.close(); } catch {}
        }
        _ctx = null;
    }
}

// Singleton player
let _player: ArrangementPlayer | null = null;
export function getPlayer(): ArrangementPlayer {
    if (!_player) _player = new ArrangementPlayer();
    return _player;
}
