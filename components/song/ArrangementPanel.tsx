/**
 * ArrangementPanel.tsx — Professional DAW-inspired arrangement editor.
 * Dark theme with interactive piano-roll editor, mixer controls, and transport bar.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { SongSheet, SongArrangement, ChordInfo, SongLine, MelodyNote } from '../../types';
import { generateArrangement, getChordAlternatives, getAllRoots, getScaleTones } from '../../utils/chordEngine';
import { getPlayer, PlaybackState } from '../../utils/audioEngine';
import { SECTION_LABELS } from '../../utils/songPrompts';

interface ArrangementPanelProps {
    song: SongSheet;
    onUpdateArrangement: (arrangement: SongArrangement) => void;
    onRequestAIArrange?: () => Promise<void>;
    isAILoading?: boolean;
    onClose: () => void;
}

// --- MIDI helpers ---
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToName(midi: number): string {
    const name = NOTE_NAMES[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${name}${octave}`;
}

// --- Section pitch ranges (match chordEngine) ---
function sectionRange(section: string): [number, number] {
    switch (section) {
        case 'chorus': return [64, 79];
        case 'bridge': return [62, 81];
        case 'intro': case 'outro': return [57, 72];
        default: return [60, 76];
    }
}

// --- Section accent colors for dark theme ---
const SECTION_ACCENTS: Record<string, { border: string; bg: string; text: string; glow: string }> = {
    'intro':      { border: 'border-l-purple-400', bg: 'bg-purple-400/10', text: 'text-purple-300', glow: 'shadow-purple-500/20' },
    'verse':      { border: 'border-l-blue-400',   bg: 'bg-blue-400/10',   text: 'text-blue-300',   glow: 'shadow-blue-500/20' },
    'pre-chorus': { border: 'border-l-cyan-400',   bg: 'bg-cyan-400/10',   text: 'text-cyan-300',   glow: 'shadow-cyan-500/20' },
    'chorus':     { border: 'border-l-rose-400',   bg: 'bg-rose-400/10',   text: 'text-rose-300',   glow: 'shadow-rose-500/20' },
    'bridge':     { border: 'border-l-amber-400',  bg: 'bg-amber-400/10',  text: 'text-amber-300',  glow: 'shadow-amber-500/20' },
    'outro':      { border: 'border-l-slate-400',  bg: 'bg-slate-400/10',  text: 'text-slate-300',  glow: 'shadow-slate-500/20' },
    'free':       { border: 'border-l-emerald-400', bg: 'bg-emerald-400/10', text: 'text-emerald-300', glow: 'shadow-emerald-500/20' },
};

const DEFAULT_ACCENT = { border: 'border-l-slate-500', bg: 'bg-slate-500/10', text: 'text-slate-400', glow: 'shadow-slate-500/20' };

// --- Mini Piano Roll (read-only thumbnail) ---
const MiniPianoRoll: React.FC<{ notes: MelodyNote[]; accentColor: string; isActive: boolean }> = ({ notes, accentColor, isActive }) => {
    if (!notes || notes.length === 0) return null;

    const minMidi = Math.min(...notes.map(n => n.midi));
    const maxMidi = Math.max(...notes.map(n => n.midi));
    const range = Math.max(maxMidi - minMidi, 1);
    const totalBeats = notes.reduce((sum, n) => sum + n.duration, 0);

    const fillMap: Record<string, string> = {
        'text-purple-300': isActive ? '#c084fc' : '#a78bfa80',
        'text-blue-300':   isActive ? '#93c5fd' : '#93c5fd80',
        'text-cyan-300':   isActive ? '#67e8f9' : '#67e8f980',
        'text-rose-300':   isActive ? '#fda4af' : '#fda4af80',
        'text-amber-300':  isActive ? '#fcd34d' : '#fcd34d80',
        'text-slate-300':  isActive ? '#cbd5e1' : '#cbd5e180',
        'text-emerald-300': isActive ? '#6ee7b7' : '#6ee7b780',
    };
    const fill = fillMap[accentColor] || (isActive ? '#67e8f9' : '#67e8f980');

    let beatOffset = 0;
    return (
        <svg className="w-full h-full" viewBox={`0 0 ${totalBeats * 20} ${range * 4 + 8}`} preserveAspectRatio="none">
            {Array.from({ length: Math.ceil(totalBeats) }, (_, i) => (
                <line key={`g${i}`} x1={i * 20} y1={0} x2={i * 20} y2={range * 4 + 8} stroke="#334155" strokeWidth={0.5} />
            ))}
            {notes.map((note, i) => {
                const x = beatOffset * 20;
                const y = (maxMidi - note.midi) * 4 + 2;
                const w = Math.max(note.duration * 20 - 1.5, 2);
                beatOffset += note.duration;
                return <rect key={i} x={x + 0.75} y={y} width={w} height={3.5} rx={1} fill={fill} />;
            })}
        </svg>
    );
};

// --- Interactive Piano Roll Editor ---
// Step-sequencer style: 8 columns (eighth notes), rows = scale pitches
const STEPS = 8;
const STEP_DURATION = 0.5; // each step = half a beat

interface PianoRollEditorProps {
    melody: MelodyNote[];
    sectionName: string;
    rootNote: string;
    scale: 'major' | 'minor';
    accentColor: string;
    onChange: (newMelody: MelodyNote[]) => void;
    onClose: () => void;
}

// Convert MelodyNote[] to a grid: grid[step] = midi | null
function melodyToGrid(notes: MelodyNote[], pitches: number[]): (number | null)[] {
    const grid: (number | null)[] = new Array(STEPS).fill(null);
    let beatPos = 0;
    for (const note of notes) {
        // How many steps does this note span?
        const noteSteps = Math.max(1, Math.round(note.duration / STEP_DURATION));
        const startStep = Math.round(beatPos / STEP_DURATION);
        for (let s = 0; s < noteSteps && startStep + s < STEPS; s++) {
            grid[startStep + s] = note.midi;
        }
        beatPos += note.duration;
    }
    return grid;
}

// Convert grid back to MelodyNote[]
function gridToMelody(grid: (number | null)[]): MelodyNote[] {
    const notes: MelodyNote[] = [];
    let i = 0;
    while (i < grid.length) {
        if (grid[i] !== null) {
            const midi = grid[i]!;
            let duration = STEP_DURATION;
            let j = i + 1;
            // Merge consecutive same-pitch steps
            while (j < grid.length && grid[j] === midi) {
                duration += STEP_DURATION;
                j++;
            }
            notes.push({ midi, duration, vowel: 0 });
            i = j;
        } else {
            i++;
        }
    }
    return notes;
}

const PianoRollEditor: React.FC<PianoRollEditorProps> = ({ melody, sectionName, rootNote, scale, accentColor, onChange, onClose }) => {
    const [lowMidi, highMidi] = sectionRange(sectionName);
    const pitches = useMemo(() => {
        const tones = getScaleTones(rootNote, scale, lowMidi, highMidi);
        return [...tones].reverse(); // high to low for display
    }, [rootNote, scale, lowMidi, highMidi]);

    const [grid, setGrid] = useState<(number | null)[]>(() => melodyToGrid(melody, pitches));

    const handleCellTap = useCallback((step: number, midi: number) => {
        setGrid(prev => {
            const next = [...prev];
            if (next[step] === midi) {
                // Toggle off
                next[step] = null;
            } else {
                // Set this pitch (monophonic — one note per step)
                next[step] = midi;
            }
            return next;
        });
    }, []);

    const handleSave = useCallback(() => {
        const newMelody = gridToMelody(grid);
        onChange(newMelody);
        onClose();
    }, [grid, onChange, onClose]);

    const handleClear = useCallback(() => {
        setGrid(new Array(STEPS).fill(null));
    }, []);

    // Color for filled cells based on accent
    const cellColorMap: Record<string, string> = {
        'text-purple-300': 'bg-purple-400',
        'text-blue-300':   'bg-blue-400',
        'text-cyan-300':   'bg-cyan-400',
        'text-rose-300':   'bg-rose-400',
        'text-amber-300':  'bg-amber-400',
        'text-slate-300':  'bg-slate-400',
        'text-emerald-300': 'bg-emerald-400',
    };
    const cellColor = cellColorMap[accentColor] || 'bg-cyan-400';

    return (
        <div className="bg-slate-900 border border-slate-700 rounded-lg mx-2 mb-2 overflow-hidden">
            {/* Editor header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700">
                <span className="text-[9px] font-bold text-slate-300 tracking-wider">MELODY EDITOR</span>
                <div className="flex gap-1.5">
                    <button onClick={handleClear} className="text-[8px] font-bold px-2 py-0.5 rounded bg-slate-700 text-slate-400 hover:text-white active:scale-95 transition-all">
                        CLEAR
                    </button>
                    <button onClick={handleSave} className="text-[8px] font-bold px-2 py-0.5 rounded bg-cyan-600 text-white active:scale-95 transition-all">
                        SAVE
                    </button>
                    <button onClick={onClose} className="text-[8px] font-bold px-2 py-0.5 rounded bg-slate-700 text-slate-400 hover:text-white active:scale-95 transition-all">
                        X
                    </button>
                </div>
            </div>

            {/* Beat markers */}
            <div className="flex pl-10">
                {Array.from({ length: STEPS }, (_, s) => (
                    <div key={s} className={`flex-1 text-center text-[7px] py-0.5 border-r border-slate-800 ${
                        s % 2 === 0 ? 'text-slate-400 font-bold' : 'text-slate-600'
                    }`}>
                        {s % 2 === 0 ? Math.floor(s / 2) + 1 : '.'}
                    </div>
                ))}
            </div>

            {/* Grid */}
            <div className="max-h-48 overflow-y-auto no-scrollbar">
                {pitches.map((midi) => {
                    const name = midiToName(midi);
                    const isC = midi % 12 === 0;
                    const isRoot = NOTE_NAMES[midi % 12] === rootNote;
                    return (
                        <div key={midi} className={`flex items-stretch ${isC ? 'border-t border-slate-600' : ''}`}>
                            {/* Pitch label */}
                            <div className={`w-10 shrink-0 flex items-center justify-end pr-1.5 text-[8px] tabular-nums ${
                                isRoot ? 'text-cyan-400 font-bold' : isC ? 'text-slate-300' : 'text-slate-600'
                            }`}>
                                {name}
                            </div>
                            {/* Step cells */}
                            {Array.from({ length: STEPS }, (_, s) => {
                                const filled = grid[s] === midi;
                                const hasNote = grid[s] !== null;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => handleCellTap(s, midi)}
                                        className={`flex-1 h-5 border-r border-b transition-all ${
                                            s % 2 === 0 ? 'border-r-slate-700/50 border-b-slate-800/50' : 'border-r-slate-800/30 border-b-slate-800/30'
                                        } ${
                                            filled
                                                ? `${cellColor} opacity-90`
                                                : s % 4 < 2
                                                    ? 'bg-slate-850 hover:bg-slate-800'
                                                    : 'bg-slate-900 hover:bg-slate-800'
                                        }`}
                                    />
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- LED indicator ---
const LedIndicator: React.FC<{ active: boolean; color?: string }> = ({ active, color = 'bg-emerald-400' }) => (
    <div className={`w-1.5 h-1.5 rounded-full transition-all ${active ? `${color} shadow-sm shadow-emerald-400/50` : 'bg-slate-600'}`} />
);

const ArrangementPanel: React.FC<ArrangementPanelProps> = ({ song, onUpdateArrangement, onRequestAIArrange, isAILoading, onClose }) => {
    const [arrangement, setArrangement] = useState<SongArrangement | null>(song.arrangement || null);
    const [playbackState, setPlaybackState] = useState<PlaybackState>({ isPlaying: false, currentSection: 0, currentLine: 0, progress: 0 });
    const [editingChord, setEditingChord] = useState<{ sectionIdx: number; chordIdx: number } | null>(null);
    const [editingMelody, setEditingMelody] = useState<{ sectionIdx: number; lineIdx: number } | null>(null);
    const player = useRef(getPlayer());
    const activeLineRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (playbackState.isPlaying && activeLineRef.current) {
            activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [playbackState.currentSection, playbackState.currentLine, playbackState.isPlaying]);

    useEffect(() => {
        return () => { player.current.stop(); };
    }, []);

    useEffect(() => {
        if (song.arrangement) setArrangement(song.arrangement);
    }, [song.arrangement]);

    const handleGenerate = useCallback(() => {
        if (song.lines.length === 0) return;
        const arr = generateArrangement(song.lines, song.genre, song.mood, song.key, song.bpm);
        setArrangement(arr);
        onUpdateArrangement(arr);
    }, [song, onUpdateArrangement]);

    useEffect(() => {
        if (!arrangement && song.lines.length > 0) handleGenerate();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handlePlayStop = useCallback(() => {
        if (!arrangement) return;
        if (player.current.isPlaying) {
            player.current.stop();
            setPlaybackState({ isPlaying: false, currentSection: 0, currentLine: 0, progress: 0 });
        } else {
            player.current.play(arrangement, setPlaybackState);
        }
    }, [arrangement]);

    const toggleInstrument = useCallback((key: 'piano' | 'bass' | 'drums' | 'melody') => {
        if (!arrangement) return;
        const updated = { ...arrangement, instruments: { ...arrangement.instruments, [key]: !arrangement.instruments[key] } };
        setArrangement(updated);
        onUpdateArrangement(updated);
    }, [arrangement, onUpdateArrangement]);

    const changeBpm = useCallback((delta: number) => {
        if (!arrangement) return;
        const newBpm = Math.max(40, Math.min(200, arrangement.bpm + delta));
        const updated = { ...arrangement, bpm: newBpm };
        setArrangement(updated);
        onUpdateArrangement(updated);
    }, [arrangement, onUpdateArrangement]);

    const cycleDrumPattern = useCallback(() => {
        if (!arrangement) return;
        const patterns: SongArrangement['drumPattern'][] = ['basic', 'upbeat', 'halftime', 'shuffle'];
        const idx = patterns.indexOf(arrangement.drumPattern);
        const next = patterns[(idx + 1) % patterns.length];
        const updated = { ...arrangement, drumPattern: next };
        setArrangement(updated);
        onUpdateArrangement(updated);
    }, [arrangement, onUpdateArrangement]);

    const replaceChord = useCallback((sectionIdx: number, chordIdx: number, newChord: ChordInfo) => {
        if (!arrangement) return;
        const newSections = arrangement.sections.map((sec, si) => {
            if (si !== sectionIdx) return sec;
            const newChords = sec.chords.map((c, ci) => ci === chordIdx ? newChord : c);
            return { ...sec, chords: newChords };
        });
        const updated = { ...arrangement, sections: newSections };
        setArrangement(updated);
        onUpdateArrangement(updated);
        setEditingChord(null);
    }, [arrangement, onUpdateArrangement]);

    // Update melody for a specific line
    const updateMelody = useCallback((sectionIdx: number, lineIdx: number, newMelody: MelodyNote[]) => {
        if (!arrangement) return;
        const newSections = arrangement.sections.map((sec, si) => {
            if (si !== sectionIdx) return sec;
            const newMelodies = [...(sec.melodies || [])];
            newMelodies[lineIdx] = newMelody;
            return { ...sec, melodies: newMelodies };
        });
        const updated = { ...arrangement, sections: newSections };
        setArrangement(updated);
        onUpdateArrangement(updated);
    }, [arrangement, onUpdateArrangement]);

    // Build flat line list
    const flatLines = useMemo(() => {
        const result: { line: SongLine; sectionIdx: number; lineIdx: number; chord: ChordInfo | null; melody: MelodyNote[] | null; sectionName: string; isFirstInSection: boolean; measureNumber: number }[] = [];
        if (!arrangement) return result;

        const sectionLines: Record<string, SongLine[]> = {};
        for (const line of song.lines) {
            if (!sectionLines[line.section]) sectionLines[line.section] = [];
            sectionLines[line.section].push(line);
        }

        let measure = 1;
        for (let si = 0; si < arrangement.sections.length; si++) {
            const sec = arrangement.sections[si];
            const secLines = sectionLines[sec.section] || [];
            for (let li = 0; li < secLines.length; li++) {
                result.push({
                    line: secLines[li],
                    sectionIdx: si,
                    lineIdx: li,
                    chord: sec.chords[li] || null,
                    melody: sec.melodies?.[li] || null,
                    sectionName: sec.section,
                    isFirstInSection: li === 0,
                    measureNumber: measure,
                });
                measure++;
            }
        }
        return result;
    }, [arrangement, song.lines]);

    const estimatedDuration = useMemo(() => {
        if (!arrangement) return '--:--';
        const totalBeats = flatLines.length * 4;
        const totalSeconds = Math.round((totalBeats / arrangement.bpm) * 60);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }, [arrangement, flatLines.length]);

    const currentTime = useMemo(() => {
        if (!arrangement || !playbackState.isPlaying) return '0:00';
        const totalSeconds = Math.round(playbackState.progress * flatLines.length * 4 / arrangement.bpm * 60);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }, [arrangement, playbackState.progress, playbackState.isPlaying, flatLines.length]);

    const drumPatternLabels: Record<string, { label: string; short: string }> = {
        basic:    { label: 'Basic',   short: 'BSC' },
        upbeat:   { label: 'Upbeat',  short: 'UPB' },
        halftime: { label: 'Half',    short: 'HLF' },
        shuffle:  { label: 'Shuffle', short: 'SHF' },
    };

    const instrumentConfig: { key: 'piano' | 'bass' | 'drums' | 'melody'; label: string; color: string; activeColor: string }[] = [
        { key: 'melody', label: 'LEAD',  color: 'bg-emerald-400', activeColor: 'text-emerald-400' },
        { key: 'piano',  label: 'KEYS',  color: 'bg-cyan-400',    activeColor: 'text-cyan-400' },
        { key: 'bass',   label: 'BASS',  color: 'bg-amber-400',   activeColor: 'text-amber-400' },
        { key: 'drums',  label: 'DRUMS', color: 'bg-rose-400',    activeColor: 'text-rose-400' },
    ];

    return (
        <div className="h-full w-full bg-slate-950 flex flex-col font-mono selection:bg-cyan-500/30">
            {/* ═══ Header Bar ═══ */}
            <div className="bg-slate-900 border-b border-slate-700/50 shrink-0">
                <div className="h-11 flex items-center justify-between px-3">
                    <button onClick={onClose} className="p-1.5 -ml-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/50 active:scale-95 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>

                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-300 tracking-widest uppercase">Arrange</span>
                        <span className="text-slate-600">|</span>
                        <span className="text-[10px] text-slate-500 max-w-[120px] truncate">{song.title}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                        {arrangement && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 border border-slate-700">
                                {arrangement.rootNote}{arrangement.scale === 'minor' ? 'm' : ''}
                            </span>
                        )}
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            4/4
                        </span>
                        <button onClick={handleGenerate} className="p-1.5 rounded-md text-slate-400 hover:text-cyan-400 hover:bg-slate-700/50 active:scale-95 transition-all" title="Regenerate">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" /></svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* ═══ Transport Bar ═══ */}
            <div className="bg-slate-900/80 border-b border-slate-800 shrink-0 px-3 py-2">
                <div className="flex items-center gap-2.5">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => { player.current.stop(); setPlaybackState({ isPlaying: false, currentSection: 0, currentLine: 0, progress: 0 }); }}
                            className="w-7 h-7 rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 flex items-center justify-center active:scale-95 transition-all"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>
                        </button>
                        <button
                            onClick={handlePlayStop}
                            disabled={!arrangement || song.lines.length === 0}
                            className={`w-8 h-7 rounded border flex items-center justify-center active:scale-95 transition-all disabled:opacity-30 ${
                                playbackState.isPlaying
                                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600'
                            }`}
                        >
                            {playbackState.isPlaying ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25Z" clipRule="evenodd" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" clipRule="evenodd" /></svg>
                            )}
                        </button>
                    </div>

                    <div className="flex items-center gap-1 min-w-[72px]">
                        <span className={`text-sm font-bold tabular-nums ${playbackState.isPlaying ? 'text-cyan-400' : 'text-slate-300'}`}>
                            {currentTime}
                        </span>
                        <span className="text-[9px] text-slate-600">/</span>
                        <span className="text-[10px] text-slate-500 tabular-nums">{estimatedDuration}</span>
                    </div>

                    <div className="flex-1 group cursor-pointer">
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                            <div
                                className={`h-full rounded-full transition-all duration-100 ${playbackState.isPlaying ? 'bg-gradient-to-r from-cyan-500 to-cyan-400' : 'bg-slate-600'}`}
                                style={{ width: `${playbackState.progress * 100}%` }}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-0">
                        <button onClick={() => changeBpm(-5)} className="w-5 h-6 rounded-l bg-slate-800 border border-slate-700 text-slate-400 hover:text-white text-[10px] font-bold flex items-center justify-center active:scale-95">-</button>
                        <div className="h-6 px-2 bg-slate-850 border-y border-slate-700 flex items-center">
                            <span className="text-[10px] font-bold text-amber-400 tabular-nums">{arrangement?.bpm || '--'}</span>
                            <span className="text-[8px] text-slate-500 ml-0.5">BPM</span>
                        </div>
                        <button onClick={() => changeBpm(5)} className="w-5 h-6 rounded-r bg-slate-800 border border-slate-700 text-slate-400 hover:text-white text-[10px] font-bold flex items-center justify-center active:scale-95">+</button>
                    </div>
                </div>
            </div>

            {/* ═══ Mixer Strip ═══ */}
            {arrangement && (
                <div className="bg-slate-900/60 border-b border-slate-800 px-3 py-2 shrink-0">
                    <div className="flex items-center gap-2">
                        {instrumentConfig.map(inst => {
                            const melodyDefault = inst.key === 'melody' && arrangement.instruments.melody === undefined;
                            const active = melodyDefault ? true : arrangement.instruments[inst.key];
                            return (
                                <button
                                    key={inst.key}
                                    onClick={() => toggleInstrument(inst.key)}
                                    className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-all active:scale-95 ${
                                        active
                                            ? `bg-slate-800/80 border-slate-600 ${inst.activeColor}`
                                            : 'bg-slate-900 border-slate-800 text-slate-600'
                                    }`}
                                >
                                    <LedIndicator active={active} color={inst.color} />
                                    <span className="text-[9px] font-bold tracking-wider">{inst.label}</span>
                                </button>
                            );
                        })}

                        <div className="w-px h-5 bg-slate-800" />

                        <button
                            onClick={cycleDrumPattern}
                            className="flex items-center gap-1.5 px-2 py-1 rounded border border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600 active:scale-95 transition-all"
                        >
                            <span className="text-[8px] text-slate-500 tracking-wider">PTN</span>
                            <span className="text-[9px] font-bold text-amber-400 tracking-wider">{drumPatternLabels[arrangement.drumPattern]?.short || 'BSC'}</span>
                        </button>

                        <div className="flex-1" />

                        <div className="flex items-center gap-2 text-[9px] text-slate-500">
                            <span>{arrangement.sections.length} SEC</span>
                            <span className="text-slate-700">|</span>
                            <span>{flatLines.length} BAR</span>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ Main Arrangement View ═══ */}
            <div className="flex-1 overflow-y-auto no-scrollbar pb-24">
                {!arrangement && song.lines.length === 0 && (
                    <div className="text-center py-20 text-slate-500">
                        <div className="text-4xl mb-4 opacity-30">///</div>
                        <p className="text-xs font-bold tracking-wider uppercase">No Tracks</p>
                        <p className="text-[10px] mt-2 text-slate-600">Write some lyrics first, then arrangement will be auto-generated</p>
                    </div>
                )}

                {flatLines.map((item, idx) => {
                    const isActive = playbackState.isPlaying && playbackState.currentSection === item.sectionIdx && playbackState.currentLine === item.lineIdx;
                    const secInfo = SECTION_LABELS[item.sectionName];
                    const accent = SECTION_ACCENTS[item.sectionName] || DEFAULT_ACCENT;
                    const isEditingThisMelody = editingMelody?.sectionIdx === item.sectionIdx && editingMelody?.lineIdx === item.lineIdx;

                    return (
                        <div key={item.line.id}>
                            {/* Section header */}
                            {item.isFirstInSection && (
                                <div className="flex items-center gap-2 px-3 pt-4 pb-1.5">
                                    <div className={`w-1 h-3 rounded-full ${accent.border.replace('border-l-', 'bg-')}`} />
                                    <span className={`text-[9px] font-bold tracking-widest uppercase ${accent.text}`}>
                                        {secInfo?.label || item.sectionName}
                                    </span>
                                    <div className="flex-1 border-t border-slate-800/80" />
                                    {item.chord && (
                                        <span className="text-[8px] text-slate-600 tracking-wider">
                                            {arrangement?.sections[item.sectionIdx]?.chords.length || 0} chords
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Track line */}
                            <div
                                ref={isActive ? activeLineRef : null}
                                className={`mx-2 mb-0.5 rounded-md border-l-2 transition-all ${accent.border} ${
                                    isActive
                                        ? `bg-slate-800/80 shadow-lg ${accent.glow}`
                                        : 'bg-slate-900/40 hover:bg-slate-800/40'
                                }`}
                            >
                                <div className="flex items-stretch">
                                    {/* Measure number */}
                                    <div className={`w-8 shrink-0 flex items-center justify-center text-[9px] tabular-nums ${isActive ? 'text-slate-300' : 'text-slate-600'}`}>
                                        {item.measureNumber}
                                    </div>

                                    {/* Chord badge */}
                                    <div className="w-14 shrink-0 flex items-center justify-center py-1.5">
                                        {item.chord && (
                                            <button
                                                onClick={() => {
                                                    setEditingMelody(null);
                                                    setEditingChord(
                                                        editingChord?.sectionIdx === item.sectionIdx && editingChord?.chordIdx === item.lineIdx
                                                            ? null
                                                            : { sectionIdx: item.sectionIdx, chordIdx: item.lineIdx }
                                                    );
                                                }}
                                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-all ${
                                                    isActive
                                                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                                        : 'text-cyan-500/70 hover:text-cyan-400 hover:bg-slate-800'
                                                }`}
                                            >
                                                {item.chord.display}
                                            </button>
                                        )}
                                    </div>

                                    {/* Mini piano roll (tap to open editor) */}
                                    <button
                                        className="w-20 shrink-0 py-1 px-0.5 flex items-center"
                                        onClick={() => {
                                            setEditingChord(null);
                                            setEditingMelody(isEditingThisMelody ? null : { sectionIdx: item.sectionIdx, lineIdx: item.lineIdx });
                                        }}
                                    >
                                        {item.melody && item.melody.length > 0 ? (
                                            <div className={`w-full h-5 rounded-sm bg-slate-800/60 overflow-hidden border transition-all ${
                                                isEditingThisMelody ? 'border-emerald-500/60 shadow-sm shadow-emerald-500/20' : 'border-slate-700/30 hover:border-slate-600/50'
                                            }`}>
                                                <MiniPianoRoll notes={item.melody} accentColor={accent.text} isActive={isActive} />
                                            </div>
                                        ) : (
                                            <div className={`w-full h-5 rounded-sm border flex items-center justify-center transition-all ${
                                                isEditingThisMelody ? 'bg-slate-800/60 border-emerald-500/60' : 'bg-slate-800/30 border-slate-800/50 hover:border-slate-700/50'
                                            }`}>
                                                <span className="text-[7px] text-slate-600">+ EDIT</span>
                                            </div>
                                        )}
                                    </button>

                                    {/* Lyric */}
                                    <div className="flex-1 flex items-center py-2 px-2 min-w-0">
                                        <p className={`text-xs leading-relaxed font-sans truncate ${
                                            isActive ? 'text-white font-medium' : 'text-slate-400'
                                        }`}>
                                            {item.line.content}
                                        </p>
                                    </div>
                                </div>

                                {/* Chord picker dropdown */}
                                {editingChord?.sectionIdx === item.sectionIdx && editingChord?.chordIdx === item.lineIdx && item.chord && (
                                    <div className="mx-2 mb-2 p-2 bg-slate-800 rounded-md border border-slate-700 max-h-48 overflow-y-auto no-scrollbar">
                                        <div className="flex flex-wrap gap-0.5">
                                            {getAllRoots().map(root => {
                                                const alts = getChordAlternatives(root);
                                                const shortAlts = alts.filter(a => ['maj', 'min', '7', 'maj7', 'min7', 'dim', 'sus4'].includes(a.quality));
                                                return shortAlts.map(alt => (
                                                    <button
                                                        key={alt.display}
                                                        onClick={() => replaceChord(item.sectionIdx, item.lineIdx, alt)}
                                                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold transition-all ${
                                                            alt.display === item.chord?.display
                                                                ? 'bg-cyan-500 text-slate-950'
                                                                : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-cyan-400 border border-slate-700/50'
                                                        }`}
                                                    >
                                                        {alt.display}
                                                    </button>
                                                ));
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Piano Roll Editor (expanded below the track line) */}
                            {isEditingThisMelody && arrangement && (
                                <PianoRollEditor
                                    melody={item.melody || []}
                                    sectionName={item.sectionName}
                                    rootNote={arrangement.rootNote}
                                    scale={arrangement.scale}
                                    accentColor={accent.text}
                                    onChange={(newMelody) => updateMelody(item.sectionIdx, item.lineIdx, newMelody)}
                                    onClose={() => setEditingMelody(null)}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ═══ Bottom Action Bar ═══ */}
            {arrangement && (
                <div className="bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-3 py-2.5 shrink-0 pb-safe">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[9px] text-slate-500 tabular-nums">
                            <span className="text-slate-400 font-bold">{arrangement.rootNote}{arrangement.scale === 'minor' ? 'm' : ''}</span>
                            <span className="text-slate-700">|</span>
                            <span>{arrangement.bpm} BPM</span>
                            <span className="text-slate-700">|</span>
                            <span>{estimatedDuration}</span>
                        </div>
                        <div className="flex gap-1.5">
                            {onRequestAIArrange && (
                                <button
                                    onClick={onRequestAIArrange}
                                    disabled={isAILoading || song.lines.length === 0}
                                    className="px-3 py-1.5 rounded text-[9px] font-bold tracking-wider bg-gradient-to-r from-violet-600 to-blue-600 text-white/90 active:scale-95 transition-transform disabled:opacity-30 border border-violet-500/30"
                                >
                                    {isAILoading ? 'AI...' : 'AI ARRANGE'}
                                </button>
                            )}
                            <button
                                onClick={handleGenerate}
                                className="px-3 py-1.5 rounded text-[9px] font-bold tracking-wider bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-600 active:scale-95 transition-all"
                            >
                                RANDOM
                            </button>
                            <button
                                onClick={handlePlayStop}
                                disabled={song.lines.length === 0}
                                className={`px-4 py-1.5 rounded text-[9px] font-bold tracking-wider active:scale-95 transition-all disabled:opacity-30 ${
                                    playbackState.isPlaying
                                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                                        : 'bg-cyan-600 text-white border border-cyan-500/50'
                                }`}
                            >
                                {playbackState.isPlaying ? 'STOP' : 'PLAY'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ArrangementPanel;
