/**
 * chordEngine.ts — Music theory engine for chord progressions.
 * Generates genre/mood-aware chord progressions for the songwriting app.
 */

import { ChordInfo, MelodyNote, SectionArrangement, SongArrangement, SongGenre, SongMood, SongLine } from '../types';

// ── Note & Frequency Tables ──

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_MAP: Record<string, string> = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };

/** Convert note name to index (0 = C). */
function noteIndex(name: string): number {
    const n = FLAT_MAP[name] || name;
    const idx = NOTE_NAMES.indexOf(n);
    return idx >= 0 ? idx : 0; // default C
}

/** MIDI note number for a note in octave 4 (middle C = 60). */
function midiForNote(name: string): number {
    return 60 + noteIndex(name);
}

// ── Chord Quality Definitions (intervals in semitones) ──

const CHORD_INTERVALS: Record<string, number[]> = {
    'maj':  [0, 4, 7],
    'min':  [0, 3, 7],
    '7':    [0, 4, 7, 10],
    'maj7': [0, 4, 7, 11],
    'min7': [0, 3, 7, 10],
    'sus2': [0, 2, 7],
    'sus4': [0, 5, 7],
    'dim':  [0, 3, 6],
    'aug':  [0, 4, 8],
};

// ── Scale Definitions ──

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

// Natural chord qualities for each degree of major / minor scale
const MAJOR_QUALITIES = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
const MINOR_QUALITIES = ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'];

/** Build a ChordInfo from a root index and quality. */
function makeChord(rootIdx: number, quality: string): ChordInfo {
    const root = NOTE_NAMES[rootIdx % 12];
    const q = quality === 'maj' ? '' : quality === 'min' ? 'm' : quality;
    return {
        root,
        quality,
        display: `${root}${q}`,
        midi: 60 + (rootIdx % 12),
    };
}

/** Get the diatonic chord for a given scale degree (1-based). */
function diatonicChord(rootNote: string, scale: 'major' | 'minor', degree: number): ChordInfo {
    const rootIdx = noteIndex(rootNote);
    const intervals = scale === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
    const qualities = scale === 'major' ? MAJOR_QUALITIES : MINOR_QUALITIES;
    const d = ((degree - 1) % 7 + 7) % 7;
    const chordRoot = (rootIdx + intervals[d]) % 12;
    return makeChord(chordRoot, qualities[d]);
}

// ── Progression Templates ──
// Each template is an array of scale degrees (1-based).
// Multiple options per genre/section combo; one is picked randomly.

type ProgressionTemplate = number[];

interface GenreProgressions {
    verse: ProgressionTemplate[];
    chorus: ProgressionTemplate[];
    bridge: ProgressionTemplate[];
    prechorus: ProgressionTemplate[];
    intro: ProgressionTemplate[];
    outro: ProgressionTemplate[];
}

const PROGRESSIONS: Record<string, GenreProgressions> = {
    pop: {
        verse:     [[1, 5, 6, 4], [6, 4, 1, 5], [1, 4, 6, 5]],
        chorus:    [[1, 5, 6, 4], [4, 1, 5, 6], [1, 4, 5, 4]],
        bridge:    [[6, 4, 1, 5], [4, 5, 6, 4]],
        prechorus: [[4, 5, 3, 6], [2, 5, 1, 4]],
        intro:     [[1, 5, 6, 4]],
        outro:     [[1, 4, 1, 5], [4, 5, 1, 1]],
    },
    rock: {
        verse:     [[1, 4, 5, 4], [1, 7, 4, 1], [1, 5, 7, 4]],
        chorus:    [[1, 4, 5, 5], [1, 5, 4, 4], [4, 5, 1, 1]],
        bridge:    [[6, 4, 5, 1], [4, 5, 6, 7]],
        prechorus: [[4, 5, 4, 5]],
        intro:     [[1, 5, 4, 4]],
        outro:     [[1, 4, 5, 1]],
    },
    ballad: {
        verse:     [[1, 6, 4, 5], [1, 3, 6, 4], [1, 5, 6, 4]],
        chorus:    [[1, 6, 4, 5], [4, 5, 1, 6], [1, 4, 5, 6]],
        bridge:    [[4, 5, 3, 6], [6, 5, 4, 5]],
        prechorus: [[2, 5, 1, 6]],
        intro:     [[1, 6, 4, 5]],
        outro:     [[1, 4, 1, 1]],
    },
    rap: {
        verse:     [[1, 4, 6, 5], [6, 4, 1, 5], [1, 6, 4, 5]],
        chorus:    [[1, 5, 6, 4], [6, 7, 1, 5]],
        bridge:    [[4, 5, 6, 1]],
        prechorus: [[4, 5, 4, 5]],
        intro:     [[1, 6, 4, 5]],
        outro:     [[1, 4, 1, 1]],
    },
    folk: {
        verse:     [[1, 4, 5, 1], [1, 5, 4, 1], [1, 4, 1, 5]],
        chorus:    [[1, 4, 5, 4], [1, 5, 6, 4]],
        bridge:    [[4, 5, 1, 6]],
        prechorus: [[4, 5, 4, 5]],
        intro:     [[1, 4, 5, 1]],
        outro:     [[1, 4, 1, 1]],
    },
    electronic: {
        verse:     [[1, 6, 3, 7], [6, 4, 1, 5], [1, 5, 6, 4]],
        chorus:    [[1, 5, 6, 4], [6, 4, 1, 5]],
        bridge:    [[4, 5, 6, 1], [6, 7, 1, 4]],
        prechorus: [[4, 5, 3, 6]],
        intro:     [[1, 5, 6, 4]],
        outro:     [[1, 6, 4, 5]],
    },
    jazz: {
        verse:     [[2, 5, 1, 6], [1, 6, 2, 5], [3, 6, 2, 5]],
        chorus:    [[1, 6, 2, 5], [2, 5, 1, 4]],
        bridge:    [[4, 7, 3, 6], [2, 5, 3, 6]],
        prechorus: [[2, 5, 1, 6]],
        intro:     [[2, 5, 1, 6]],
        outro:     [[2, 5, 1, 1]],
    },
    rnb: {
        verse:     [[1, 3, 6, 4], [1, 6, 4, 5], [1, 4, 6, 5]],
        chorus:    [[1, 5, 6, 4], [4, 5, 1, 6]],
        bridge:    [[4, 5, 3, 6]],
        prechorus: [[2, 5, 1, 4]],
        intro:     [[1, 6, 4, 5]],
        outro:     [[1, 4, 1, 1]],
    },
    free: {
        verse:     [[1, 5, 6, 4], [1, 4, 5, 1]],
        chorus:    [[1, 5, 6, 4]],
        bridge:    [[4, 5, 6, 1]],
        prechorus: [[4, 5, 4, 5]],
        intro:     [[1, 5, 6, 4]],
        outro:     [[1, 4, 1, 1]],
    },
};

/** Map section names to progression keys. */
function sectionKey(section: string): keyof GenreProgressions {
    switch (section) {
        case 'verse': return 'verse';
        case 'chorus': return 'chorus';
        case 'bridge': return 'bridge';
        case 'pre-chorus': return 'prechorus';
        case 'intro': return 'intro';
        case 'outro': return 'outro';
        default: return 'verse';
    }
}

// ── Mood-based Chord Enhancement ──

function enhanceChordForMood(chord: ChordInfo, mood: SongMood, degree: number): ChordInfo {
    // Add color tones based on mood
    switch (mood) {
        case 'romantic':
        case 'dreamy':
            // Use maj7 for major chords, min7 for minor
            if (chord.quality === 'maj' && Math.random() > 0.4) {
                return { ...chord, quality: 'maj7', display: `${chord.root}maj7` };
            }
            if (chord.quality === 'min' && Math.random() > 0.5) {
                return { ...chord, quality: 'min7', display: `${chord.root}m7` };
            }
            break;
        case 'chill':
            // Add sus chords occasionally
            if (chord.quality === 'maj' && Math.random() > 0.6) {
                const sus = Math.random() > 0.5 ? 'sus2' : 'sus4';
                return { ...chord, quality: sus, display: `${chord.root}${sus}` };
            }
            break;
        case 'angry':
        case 'epic':
            // Use power-chord-like display (5th)
            if (Math.random() > 0.5) {
                return { ...chord, display: `${chord.root}5` };
            }
            break;
        default:
            break;
    }
    return chord;
}

// ── Mood → Scale Preference ──

function preferredScale(mood: SongMood): 'major' | 'minor' | null {
    switch (mood) {
        case 'happy': case 'epic': return 'major';
        case 'sad': case 'angry': case 'nostalgic': return 'minor';
        default: return null;
    }
}

// ── Mood → Drum Pattern ──

function drumPatternForGenre(genre: SongGenre, mood: SongMood): SongArrangement['drumPattern'] {
    if (mood === 'chill' || mood === 'dreamy') return 'halftime';
    switch (genre) {
        case 'rock': case 'electronic': return 'upbeat';
        case 'jazz': case 'rnb': return 'shuffle';
        case 'ballad': case 'folk': return 'halftime';
        default: return 'basic';
    }
}

// ── Default BPM ──

function defaultBpm(genre: SongGenre, mood: SongMood): number {
    const base: Record<string, number> = {
        pop: 120, rock: 130, ballad: 72, rap: 90, folk: 100,
        electronic: 128, jazz: 110, rnb: 85, free: 110,
    };
    let bpm = base[genre] || 110;
    if (mood === 'chill' || mood === 'dreamy' || mood === 'sad') bpm -= 15;
    if (mood === 'angry' || mood === 'epic') bpm += 15;
    return bpm;
}

// ── Parse Key String ──

function parseKey(keyStr?: string): { root: string; scale: 'major' | 'minor' } {
    if (!keyStr) return { root: 'C', scale: 'major' };
    const k = keyStr.trim();
    // Match patterns like "C major", "Am", "A minor", "C#m", "Bb major"
    const m = k.match(/^([A-G][b#]?)\s*(major|minor|maj|min|m)?$/i);
    if (m) {
        const root = m[1].charAt(0).toUpperCase() + m[1].slice(1);
        const q = (m[2] || '').toLowerCase();
        const scale = (q === 'minor' || q === 'min' || q === 'm') ? 'minor' : 'major';
        return { root: FLAT_MAP[root] || root, scale };
    }
    return { root: 'C', scale: 'major' };
}

// ── Main: Generate Arrangement ──

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function generateArrangement(
    lines: SongLine[],
    genre: SongGenre,
    mood: SongMood,
    keyStr?: string,
    bpmOverride?: number,
): SongArrangement {
    const parsed = parseKey(keyStr);
    const moodScale = preferredScale(mood);
    const scale = moodScale || parsed.scale;
    const rootNote = parsed.root;
    const bpm = bpmOverride || defaultBpm(genre, mood);

    const genreProgs = PROGRESSIONS[genre] || PROGRESSIONS.pop;

    // Group lines by section
    const sectionOrder: string[] = [];
    const sectionLines: Record<string, SongLine[]> = {};
    for (const line of lines) {
        if (!sectionLines[line.section]) {
            sectionLines[line.section] = [];
            sectionOrder.push(line.section);
        }
        sectionLines[line.section].push(line);
    }

    const sections: SectionArrangement[] = sectionOrder.map(sec => {
        const linesInSec = sectionLines[sec];
        const progKey = sectionKey(sec);
        const template = pick(genreProgs[progKey] || genreProgs.verse);

        // Assign one chord per line, cycling through the progression
        const chords: ChordInfo[] = linesInSec.map((_, i) => {
            const degree = template[i % template.length];
            let chord = diatonicChord(rootNote, scale, degree);
            chord = enhanceChordForMood(chord, mood, degree);
            return chord;
        });

        // Generate melodies for each line
        const melodies = linesInSec.map((line, i) =>
            generateLineMelody(line.content, chords[i], rootNote, scale, sec, i)
        );

        return { section: sec, chords, melodies };
    });

    return {
        rootNote,
        scale,
        bpm,
        sections,
        instruments: { piano: true, bass: true, drums: true, melody: true },
        drumPattern: drumPatternForGenre(genre, mood),
    };
}

/** Get all possible chord alternatives for a given root (for chord editing). */
export function getChordAlternatives(rootNote: string): ChordInfo[] {
    const rootIdx = noteIndex(rootNote);
    return ['maj', 'min', '7', 'maj7', 'min7', 'sus2', 'sus4'].map(q => makeChord(rootIdx, q));
}

/** Get available root notes for chord editing. */
export function getAllRoots(): string[] {
    return [...NOTE_NAMES];
}

/** Get chord intervals for audio engine. */
export function getChordFrequencies(chord: ChordInfo, octave: number = 4): number[] {
    const intervals = CHORD_INTERVALS[chord.quality] || CHORD_INTERVALS.maj;
    const baseFreq = 440 * Math.pow(2, (chord.midi - 69 + (octave - 4) * 12) / 12);
    return intervals.map(semi => baseFreq * Math.pow(2, semi / 12));
}

/** Get bass frequency for a chord (root note, one octave below). */
export function getBassFrequency(chord: ChordInfo): number {
    return 440 * Math.pow(2, (chord.midi - 69 - 12) / 12);
}

// ── Melody Generation ──

/** Get scale tones as MIDI notes in a given octave range. */
export function getScaleTones(rootNote: string, scale: 'major' | 'minor', lowMidi: number, highMidi: number): number[] {
    const rootIdx = noteIndex(rootNote);
    const intervals = scale === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS;
    const tones: number[] = [];
    for (let octave = 2; octave <= 6; octave++) {
        for (const interval of intervals) {
            const midi = (octave * 12) + rootIdx + interval;
            if (midi >= lowMidi && midi <= highMidi) tones.push(midi);
        }
    }
    return tones;
}

/** Get chord tones as MIDI notes in range. */
function getChordTones(chord: ChordInfo, lowMidi: number, highMidi: number): number[] {
    const intervals = CHORD_INTERVALS[chord.quality] || CHORD_INTERVALS.maj;
    const tones: number[] = [];
    for (let octave = 2; octave <= 6; octave++) {
        for (const semi of intervals) {
            const midi = (octave * 12) + noteIndex(chord.root) + semi;
            if (midi >= lowMidi && midi <= highMidi) tones.push(midi);
        }
    }
    return tones;
}

/** Map a Chinese character to a vowel index (0=a,1=o,2=e,3=i,4=u). Simplified heuristic. */
function charToVowel(ch: string): number {
    // Simple mapping based on common Chinese phonetic patterns
    const code = ch.charCodeAt(0);
    if (code < 0x4e00 || code > 0x9fff) return 0; // non-CJK → 'a'
    return code % 5;
}

/** Section → pitch range (MIDI). */
function sectionRange(section: string): [number, number] {
    switch (section) {
        case 'chorus': return [64, 79];  // E4-G5 (higher for emotional peak)
        case 'bridge': return [62, 81];  // D4-A5 (wide range for contrast)
        case 'intro': case 'outro': return [57, 72]; // A3-C5 (gentle)
        default: return [60, 76]; // C4-E5 (verse / default)
    }
}

// ── Rhythm Patterns (beats, each array sums to 4) ──

const RHYTHM_PATTERNS: Record<number, number[][]> = {
    1: [[4]],
    2: [[2.5, 1.5], [1.5, 2.5], [3, 1]],
    3: [[1.5, 1, 1.5], [2, 1, 1], [1, 1, 2], [1, 2, 1]],
    4: [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 1, 1.5, 0.5], [1, 0.5, 0.5, 2]],
    5: [[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 1, 1], [1, 1, 0.5, 0.5, 1], [0.5, 1, 0.5, 1, 1]],
    6: [[0.5, 0.5, 1, 0.5, 0.5, 1], [1, 0.5, 0.5, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5, 1, 1], [1, 0.5, 0.5, 0.5, 0.5, 1]],
    7: [[0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.5], [1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.5]],
    8: [[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], [0.75, 0.25, 0.5, 0.5, 0.75, 0.25, 0.5, 0.5]],
    9: [[0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.25, 0.25], [0.5, 0.5, 0.5, 0.25, 0.25, 0.5, 0.5, 0.25, 0.25]],
    10: [[0.5, 0.5, 0.5, 0.5, 0.25, 0.25, 0.5, 0.25, 0.25, 0.5], [0.5, 0.25, 0.25, 0.5, 0.5, 0.5, 0.25, 0.25, 0.25, 0.25]],
};

/** Generate a musical rhythm pattern for n syllables summing to 4 beats. */
function generateRhythm(numNotes: number): number[] {
    const patterns = RHYTHM_PATTERNS[numNotes];
    if (patterns) return [...pick(patterns)];

    // Algorithmic fallback for larger syllable counts:
    // Group syllables into sub-phrases (2s and 3s), lengthen phrase-final notes.
    const base = 4 / numNotes;
    const durations = new Array(numNotes).fill(base);
    let idx = 0;
    while (idx < numNotes) {
        const remaining = numNotes - idx;
        const groupLen = remaining >= 5
            ? (Math.random() > 0.5 ? 3 : 2)
            : remaining >= 3 && Math.random() > 0.4 ? 3
            : remaining >= 2 ? 2 : 1;
        if (groupLen >= 2) {
            const steal = base * 0.35;
            for (let j = 0; j < groupLen - 1; j++) durations[idx + j] -= steal / (groupLen - 1);
            durations[idx + groupLen - 1] += steal;
        }
        idx += groupLen;
    }
    // Normalize to exactly 4 beats
    const sum = durations.reduce((a, b) => a + b, 0);
    return durations.map(d => Math.max(0.125, d * (4 / sum)));
}

// ── Melodic Contour ──

type MelodicContour = 'arch' | 'descent' | 'ascent' | 'wave' | 'valley';

/** Get contour shape at position (0→1), returns 0→1 (bottom→top of range). */
function contourValue(contour: MelodicContour, pos: number): number {
    switch (contour) {
        case 'arch':    return Math.sin(pos * Math.PI);
        case 'descent': return 1 - pos;
        case 'ascent':  return pos;
        case 'wave':    return 0.5 + 0.45 * Math.sin(pos * Math.PI * 2);
        case 'valley':  return 1 - Math.sin(pos * Math.PI);
    }
}

/** Pick a contour appropriate for the section and line index. */
const SECTION_CONTOURS: Record<string, MelodicContour[]> = {
    'verse':      ['descent', 'wave', 'arch'],
    'chorus':     ['arch', 'ascent', 'arch'],
    'bridge':     ['ascent', 'wave', 'valley'],
    'pre-chorus': ['ascent', 'wave'],
    'intro':      ['ascent', 'arch'],
    'outro':      ['descent', 'valley'],
};

/** Find the nearest tone in the given set to a target MIDI value. */
function nearest(tones: number[], target: number): number {
    return tones.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
}

/** Generate a melody for one line of lyrics over a given chord. */
function generateLineMelody(
    text: string,
    chord: ChordInfo,
    rootNote: string,
    scale: 'major' | 'minor',
    section: string,
    lineIndex: number = 0,
): MelodyNote[] {
    const chars = text.replace(/\s+/g, '').split('');
    const numNotes = Math.max(1, Math.min(chars.length, 16));

    const [lowMidi, highMidi] = sectionRange(section);
    const scaleTones = getScaleTones(rootNote, scale, lowMidi, highMidi);
    const chordTones = getChordTones(chord, lowMidi, highMidi);

    if (scaleTones.length === 0 || chordTones.length === 0) {
        return [{ midi: chord.midi, duration: 4, vowel: 0 }];
    }

    // 1. Varied rhythm
    const rhythm = generateRhythm(numNotes);

    // 2. Pick melodic contour (varies by section and line)
    const contours = SECTION_CONTOURS[section] || SECTION_CONTOURS['verse'];
    const contour = contours[(lineIndex + Math.floor(Math.random() * 2)) % contours.length];

    // 3. Determine starting pitch from contour + line offset for variety
    const range = highMidi - lowMidi;
    const startTarget = lowMidi + contourValue(contour, 0) * range + ((lineIndex * 3) % 7) - 3;
    let current = nearest(chordTones, startTarget);

    const notes: MelodyNote[] = [];
    let leapCompensate = 0; // after a leap, step back in opposite direction

    for (let i = 0; i < numNotes; i++) {
        const pos = numNotes > 1 ? i / (numNotes - 1) : 0.5;
        const isFirst = i === 0;
        const isLast = i === numNotes - 1;
        // Strong beats: first note, middle of phrase, and last note
        const isStrong = isFirst || isLast || i === Math.floor(numNotes / 2);

        // Contour target for this position
        const target = lowMidi + contourValue(contour, pos) * range;

        let next: number;

        if (isFirst) {
            next = current;
        } else if (isLast) {
            // Resolve to a chord tone close to current, biased toward contour end
            const reachable = chordTones.filter(t => Math.abs(t - current) <= 7);
            next = nearest(reachable.length > 0 ? reachable : chordTones, target);
        } else if (leapCompensate !== 0) {
            // After a leap (>4 semitones), step back in opposite direction
            const stepDir = leapCompensate;
            const candidates = stepDir > 0
                ? scaleTones.filter(t => t > current)
                : scaleTones.filter(t => t < current);
            next = candidates.length > 0
                ? (stepDir > 0 ? candidates[0] : candidates[candidates.length - 1])
                : current;
            leapCompensate = 0;
        } else if (isStrong) {
            // Strong beat → chord tone near contour target within reach
            const reachable = chordTones.filter(t => Math.abs(t - current) <= 7);
            next = nearest(reachable.length > 0 ? reachable : chordTones, target);
        } else {
            // Weak beat → primarily stepwise, guided by contour direction
            const direction = target > current ? 1 : target < current ? -1 : (Math.random() > 0.5 ? 1 : -1);
            const r = Math.random();

            if (r < 0.50) {
                // Stepwise motion toward contour target
                const step = direction > 0
                    ? scaleTones.filter(t => t > current)
                    : scaleTones.filter(t => t < current);
                next = step.length > 0
                    ? (direction > 0 ? step[0] : step[step.length - 1])
                    : current;
            } else if (r < 0.70) {
                // Skip to a nearby chord tone (small leap, contour-biased)
                const nearby = chordTones.filter(t => Math.abs(t - current) <= 7 && t !== current);
                next = nearby.length > 0 ? nearest(nearby, target) : current;
            } else if (r < 0.82) {
                // Larger leap (4th or 5th) toward target — followed by step-back
                const leap = direction > 0 ? pick([5, 7]) : pick([-5, -7]);
                const raw = current + leap;
                next = nearest(scaleTones, Math.max(lowMidi, Math.min(highMidi, raw)));
                if (Math.abs(next - current) > 4) {
                    leapCompensate = next > current ? -1 : 1; // step back next time
                }
            } else if (r < 0.92) {
                // Neighbor tone (tension → resolution)
                const neighborDir = -(direction || 1);
                const neighbors = scaleTones.filter(t =>
                    neighborDir > 0 ? (t > current && t <= current + 3) : (t < current && t >= current - 3)
                );
                next = neighbors.length > 0 ? neighbors[0] : current;
            } else {
                // Repeated note (rhythmic emphasis)
                next = current;
            }
        }

        // Clamp and snap to scale
        next = Math.max(lowMidi, Math.min(highMidi, next));
        next = nearest(scaleTones, next);

        notes.push({
            midi: next,
            duration: rhythm[i],
            vowel: charToVowel(chars[i] || ''),
        });
        current = next;
    }

    return notes;
}

// ── Parse Chord Name from string (for AI output) ──

/** Parse a chord name like "Am", "G7", "Fmaj7", "C#m7", "Bb" into ChordInfo. */
export function parseChordName(name: string): ChordInfo | null {
    const m = name.trim().match(/^([A-G][b#]?)(m7|maj7|min7|dim|aug|sus2|sus4|m|7|5)?$/);
    if (!m) return null;
    const rootStr = m[1];
    const qualityStr = m[2] || '';

    const qualityMap: Record<string, string> = {
        '': 'maj', 'm': 'min', '7': '7', 'maj7': 'maj7', 'min7': 'min7',
        'm7': 'min7', 'dim': 'dim', 'aug': 'aug', 'sus2': 'sus2', 'sus4': 'sus4', '5': 'maj',
    };
    const quality = qualityMap[qualityStr] ?? 'maj';
    const root = FLAT_MAP[rootStr] || rootStr;
    const rootIdx = noteIndex(root);

    return makeChord(rootIdx, quality);
}

/** Build a full arrangement from AI-provided chord names. */
export function buildArrangementFromAIChords(
    aiSections: { section: string; chords: string[] }[],
    lines: SongLine[],
    genre: SongGenre,
    mood: SongMood,
    keyStr?: string,
    bpmOverride?: number,
): SongArrangement {
    const parsed = parseKey(keyStr);
    const moodScale = preferredScale(mood);
    const scale = moodScale || parsed.scale;
    const rootNote = parsed.root;
    const bpm = bpmOverride || defaultBpm(genre, mood);

    // Group lines by section
    const sectionLines: Record<string, SongLine[]> = {};
    for (const line of lines) {
        if (!sectionLines[line.section]) sectionLines[line.section] = [];
        sectionLines[line.section].push(line);
    }

    const sections: SectionArrangement[] = aiSections.map(aiSec => {
        const linesInSec = sectionLines[aiSec.section] || [];
        const chords: ChordInfo[] = aiSec.chords.map(name => {
            const ch = parseChordName(name);
            return ch || makeChord(noteIndex(rootNote), 'maj'); // fallback
        });

        // Ensure we have enough chords for all lines (cycle if AI gave fewer)
        while (chords.length < linesInSec.length) {
            chords.push(chords[chords.length % Math.max(1, aiSec.chords.length)] || makeChord(noteIndex(rootNote), 'maj'));
        }

        const melodies = linesInSec.map((line, i) =>
            generateLineMelody(line.content, chords[i], rootNote, scale, aiSec.section, i)
        );

        return { section: aiSec.section, chords: chords.slice(0, linesInSec.length), melodies };
    });

    return {
        rootNote,
        scale,
        bpm,
        sections,
        instruments: { piano: true, bass: true, drums: true, melody: true },
        drumPattern: drumPatternForGenre(genre, mood),
    };
}

/** Regenerate melodies for an existing arrangement (e.g. after chord edits). */
export function regenerateMelodies(
    arrangement: SongArrangement,
    lines: SongLine[],
): SongArrangement {
    const sectionLines: Record<string, SongLine[]> = {};
    for (const line of lines) {
        if (!sectionLines[line.section]) sectionLines[line.section] = [];
        sectionLines[line.section].push(line);
    }

    const sections = arrangement.sections.map(sec => {
        const linesInSec = sectionLines[sec.section] || [];
        const melodies = linesInSec.map((line, i) =>
            generateLineMelody(line.content, sec.chords[i] || sec.chords[0], arrangement.rootNote, arrangement.scale, sec.section, i)
        );
        return { ...sec, melodies };
    });

    return { ...arrangement, sections };
}
