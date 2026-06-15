import { SongResult } from '../../types';

// src/utils/lyrics/matchScore.ts

/**
 * Calculates Jaccard character similarity between two normalized strings.
 */
function stringSimilarity(s1: string, s2: string): number {
    const n1 = s1.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, '').trim();
    const n2 = s2.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, '').trim();
    if (!n1 || !n2) return 0;
    if (n1 === n2) return 1.0;
    
    const set1 = new Set(n1);
    const set2 = new Set(n2);
    let intersection = 0;
    for (const char of set1) {
        if (set2.has(char)) {
            intersection++;
        }
    }
    const union = new Set([...set1, ...set2]).size;
    return union > 0 ? intersection / union : 0;
}

/**
 * Calculates a match score between 0% and 100% for a search result compared to the target song.
 * Factors in title similarity (40%), artist similarity (30%), and duration difference (30%).
 */
export function calculateMatchScore(
    song: { title: string; artist: string; durationMs: number },
    result: SongResult
): number {
    const searchTitle = result.name || '';
    const searchArtist = result.ar?.map(a => a.name).join(', ') || result.artists?.map(a => a.name).join(', ') || '';
    const searchDurationMs = result.dt || result.duration || 0;

    // 1. Title Similarity (40% weight)
    const tSim = stringSimilarity(song.title, searchTitle);
    const titleScore = tSim * 40;

    // 2. Artist Similarity (30% weight)
    const aSim = stringSimilarity(song.artist, searchArtist);
    const artistScore = aSim * 30;

    // 3. Duration match (30% weight)
    let durationScore = 0;
    if (song.durationMs > 0 && searchDurationMs > 0) {
        const diff = Math.abs(song.durationMs - searchDurationMs);
        if (diff <= 1000) {
            durationScore = 30; // within 1 second
        } else if (diff <= 3000) {
            durationScore = 20; // within 3 seconds
        } else if (diff <= 5000) {
            durationScore = 10; // within 5 seconds
        }
    } else {
        durationScore = 15; // default if duration is missing
    }

    return Math.min(100, Math.max(0, Math.round(titleScore + artistScore + durationScore)));
}
