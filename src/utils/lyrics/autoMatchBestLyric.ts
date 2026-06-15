import { LyricData, SongResult } from '../../types';
import { neteaseApi } from '../../services/netease';
import { processNeteaseLyrics } from './neteaseProcessing';
import type { NeteaseChorusRange } from './chorusEffects';
import { searchQQLyrics, fetchQQLyrics } from './providers/qqLyricProvider';
import { searchKugouLyrics, fetchKugouLyrics } from './providers/kugouLyricProvider';
import { normalizeLyricMatchDurationMs } from './duration';
import { calculateMatchScore } from './matchScore';

// src/utils/lyrics/autoMatchBestLyric.ts
// Utility module for automatically matching the best word-by-word lyrics across multiple sources.

const PROVIDER_SEARCH_TIMEOUT_MS = 3500;
const PROVIDER_LYRIC_TIMEOUT_MS = 5000;
const AUTO_MATCH_SEARCH_LIMIT = 10;
const AUTO_MATCH_MIN_SCORE = 75;

export interface AutoMatchBestLyricOptions {
    album?: string;
    neteaseCandidate?: {
        id: number | string;
        lyrics: LyricData | null;
        chorusRanges?: NeteaseChorusRange[];
    };
}

function buildSearchQuery(title: string, artist: string, album?: string): string {
    return [title, artist, album]
        .map(part => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(' - ');
}

function selectBestCandidate(
    source: 'netease' | 'qq' | 'kugou',
    songs: SongResult[],
    target: { title: string; artist: string; durationMs: number }
): SongResult | null {
    const scored = songs
        .slice(0, AUTO_MATCH_SEARCH_LIMIT)
        .map(song => ({
            song,
            score: calculateMatchScore(target, song)
        }))
        .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best) {
        return null;
    }

    console.log(`[autoMatchBestLyric] Best ${source} candidate: "${best.song.name}" score=${best.score}`);
    if (best.score < AUTO_MATCH_MIN_SCORE) {
        console.log(`[autoMatchBestLyric] Skipping ${source} candidate because score ${best.score} is below ${AUTO_MATCH_MIN_SCORE}`);
        return null;
    }

    return best.song;
}

// Bounds slow remote providers so one source cannot block the whole automatic match.
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
                timer = setTimeout(() => {
                    console.warn(`[autoMatchBestLyric] ${label} timed out after ${timeoutMs}ms`);
                    resolve(fallback);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
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
    durationMs: number,
    options: AutoMatchBestLyricOptions = {}
): Promise<{
    lyrics: LyricData;
    source: 'netease' | 'qq' | 'kugou';
    id: number | string;
    qqMid?: string;
    kgHash?: string;
} | null> {
    const searchQuery = buildSearchQuery(title, artist, options.album);
    const normalizedDurationMs = normalizeLyricMatchDurationMs(durationMs);
    console.log(`[autoMatchBestLyric] Initiating best lyric auto-match for "${searchQuery}" (Duration: ${normalizedDurationMs}ms)`);
    const targetSong = { title, artist, durationMs: normalizedDurationMs };
    let neteaseChorusRanges: NeteaseChorusRange[] = options.neteaseCandidate?.chorusRanges ?? [];

    // 1. NetEase Music
    try {
        let candidateSongs: any[];
        if (options.neteaseCandidate) {
            candidateSongs = [{ id: options.neteaseCandidate.id, name: title, ar: artist ? [{ name: artist }] : [] }];
        } else {
            const neteaseSearchRes = await withTimeout(
                neteaseApi.cloudSearch(searchQuery, AUTO_MATCH_SEARCH_LIMIT),
                PROVIDER_SEARCH_TIMEOUT_MS,
                'NetEase search',
                { result: { songs: [] } }
            );
            const neteaseSongs = neteaseSearchRes.result?.songs || [];
            const bestCandidate = selectBestCandidate('netease', neteaseSongs, targetSong);
            candidateSongs = bestCandidate ? [bestCandidate] : [];
        }

        for (const song of candidateSongs) {
            console.log(`[autoMatchBestLyric] Checking NetEase candidate: "${song.name}" by "${song.ar?.map((a: any) => a.name).join(', ')}"`);
            const processed = String(options.neteaseCandidate?.id) === String(song.id)
                ? {
                    lyrics: options.neteaseCandidate.lyrics,
                    chorusRanges: options.neteaseCandidate.chorusRanges ?? []
                }
                : await withTimeout(
                    (async () => {
                        const lyricRes = await neteaseApi.getLyric(song.id);
                        return processNeteaseLyrics(
                            {
                                type: 'netease',
                                ...lyricRes
                            },
                            { songId: song.id }
                        );
                    })(),
                    PROVIDER_LYRIC_TIMEOUT_MS,
                    `NetEase lyric fetch for ${song.id}`,
                    null
                );

            if (!processed) {
                continue;
            }

            if (processed.chorusRanges && processed.chorusRanges.length > 0) {
                neteaseChorusRanges = processed.chorusRanges;
            }

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
        const qqSongs = await withTimeout(
            searchQQLyrics(searchQuery, 1, AUTO_MATCH_SEARCH_LIMIT),
            PROVIDER_SEARCH_TIMEOUT_MS,
            'QQ search',
            []
        );
        const bestCandidate = selectBestCandidate('qq', qqSongs, targetSong);
        const candidateSongs = bestCandidate ? [bestCandidate] : [];

        for (const song of candidateSongs) {
            console.log(`[autoMatchBestLyric] Checking QQ candidate: "${song.name}" by "${song.artists?.map((a: any) => a.name).join(', ')}"`);
            const parsedLyrics = await withTimeout(
                fetchQQLyrics(song, { chorusRanges: neteaseChorusRanges }),
                PROVIDER_LYRIC_TIMEOUT_MS,
                `QQ lyric fetch for ${song.id}`,
                null
            );
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
        const kugouSongs = await withTimeout(
            searchKugouLyrics(searchQuery, 1, AUTO_MATCH_SEARCH_LIMIT),
            PROVIDER_SEARCH_TIMEOUT_MS,
            'Kugou search',
            []
        );
        const bestCandidate = selectBestCandidate('kugou', kugouSongs, targetSong);
        const candidateSongs = bestCandidate ? [bestCandidate] : [];

        for (const song of candidateSongs) {
            console.log(`[autoMatchBestLyric] Checking Kugou candidate: "${song.name}" by "${song.artists?.map((a: any) => a.name).join(', ')}"`);
            const parsedLyrics = await withTimeout(
                fetchKugouLyrics(song, { chorusRanges: neteaseChorusRanges }),
                PROVIDER_LYRIC_TIMEOUT_MS,
                `Kugou lyric fetch for ${song.id}`,
                null
            );
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
