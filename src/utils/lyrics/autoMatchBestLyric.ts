import { LyricData } from '../../types';
import { neteaseApi } from '../../services/netease';
import { processNeteaseLyrics } from './neteaseProcessing';
import { searchQQLyrics, fetchQQLyrics } from './providers/qqLyricProvider';
import { searchKugouLyrics, fetchKugouLyrics } from './providers/kugouLyricProvider';

// src/utils/lyrics/autoMatchBestLyric.ts
// Utility module for automatically matching the best word-by-word lyrics across multiple sources.

function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s\u4e00-\u9fa5]/g, '') // Remove punctuation except Chinese characters
        .replace(/\s+/g, ''); // Remove all whitespace
}

function isTitleMatch(localTitle: string, searchTitle: string): boolean {
    const normalizedLocal = normalizeTitle(localTitle);
    const normalizedSearch = normalizeTitle(searchTitle);

    if (normalizedLocal === normalizedSearch) {
        return true;
    }

    if (normalizedLocal.includes(normalizedSearch) || normalizedSearch.includes(normalizedLocal)) {
        const minLength = Math.min(normalizedLocal.length, normalizedSearch.length);
        const maxLength = Math.max(normalizedLocal.length, normalizedSearch.length);
        if (minLength / maxLength >= 0.5) {
            return true;
        }
    }

    return false;
}

/**
 * Searches and matches the best word-by-word lyric across NetEase, QQ Music, and Kugou Music.
 * Priority: NetEase > QQ Music > Kugou Music.
 * A match is considered perfect if duration difference is <= 3s and title is matched.
 * Returns the parsed lyrics and matching details, or null if no perfect match is found.
 */
export async function autoMatchBestLyric(
    title: string,
    artist: string,
    durationMs: number
): Promise<{
    lyrics: LyricData;
    source: 'netease' | 'qq' | 'kugou';
    id: number | string;
    qqMid?: string;
    kgHash?: string;
} | null> {
    const searchQuery = artist ? `${artist} ${title}` : title;
    console.log(`[autoMatchBestLyric] Initiating best lyric auto-match for "${searchQuery}" (Duration: ${durationMs}ms)`);

    // 1. NetEase Music
    try {
        const neteaseSearchRes = await neteaseApi.cloudSearch(searchQuery);
        const neteaseSongs = neteaseSearchRes.result?.songs || [];
        // Filter top 5 results
        const candidateSongs = neteaseSongs.slice(0, 5).filter((s: any) => {
            const songDuration = s.dt || s.duration || 0;
            return Math.abs(songDuration - durationMs) <= 3000 && isTitleMatch(title, s.name);
        });

        for (const song of candidateSongs) {
            console.log(`[autoMatchBestLyric] Checking NetEase candidate: "${song.name}" by "${song.ar?.map((a: any) => a.name).join(', ')}"`);
            const lyricRes = await neteaseApi.getLyric(song.id);
            const processed = await processNeteaseLyrics(
                {
                    type: 'netease',
                    ...lyricRes
                },
                { songId: song.id }
            );

            if (processed.lyrics && processed.lyrics.isWordByWord) {
                console.log(`[autoMatchBestLyric] Found perfect NetEase word-by-word lyric match!`);
                return {
                    lyrics: processed.lyrics,
                    source: 'netease',
                    id: song.id
                };
            }
        }
    } catch (error) {
        console.error(`[autoMatchBestLyric] NetEase search/fetch failed:`, error);
    }

    // 2. QQ Music
    try {
        const qqSongs = await searchQQLyrics(searchQuery);
        // Filter top 5 results
        const candidateSongs = qqSongs.slice(0, 5).filter((s: any) => {
            const songDuration = s.duration || 0;
            return Math.abs(songDuration - durationMs) <= 3000 && isTitleMatch(title, s.name);
        });

        for (const song of candidateSongs) {
            console.log(`[autoMatchBestLyric] Checking QQ candidate: "${song.name}" by "${song.artists?.map((a: any) => a.name).join(', ')}"`);
            const parsedLyrics = await fetchQQLyrics(song);
            if (parsedLyrics && parsedLyrics.isWordByWord) {
                console.log(`[autoMatchBestLyric] Found perfect QQ word-by-word lyric match!`);
                return {
                    lyrics: parsedLyrics,
                    source: 'qq',
                    id: song.id,
                    qqMid: song.qqMid
                };
            }
        }
    } catch (error) {
        console.error(`[autoMatchBestLyric] QQ search/fetch failed:`, error);
    }

    // 3. Kugou Music
    try {
        const kugouSongs = await searchKugouLyrics(searchQuery);
        // Filter top 5 results
        const candidateSongs = kugouSongs.slice(0, 5).filter((s: any) => {
            const songDuration = s.duration || 0;
            return Math.abs(songDuration - durationMs) <= 3000 && isTitleMatch(title, s.name);
        });

        for (const song of candidateSongs) {
            console.log(`[autoMatchBestLyric] Checking Kugou candidate: "${song.name}" by "${song.artists?.map((a: any) => a.name).join(', ')}"`);
            const parsedLyrics = await fetchKugouLyrics(song);
            if (parsedLyrics && parsedLyrics.isWordByWord) {
                console.log(`[autoMatchBestLyric] Found perfect Kugou word-by-word lyric match!`);
                return {
                    lyrics: parsedLyrics,
                    source: 'kugou',
                    id: song.id,
                    kgHash: song.kgHash
                };
            }
        }
    } catch (error) {
        console.error(`[autoMatchBestLyric] Kugou search/fetch failed:`, error);
    }

    console.log(`[autoMatchBestLyric] No perfect word-by-word lyric match found across any source.`);
    return null;
}
