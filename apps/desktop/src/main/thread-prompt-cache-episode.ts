const EPISODE_WINDOW_MS = 30 * 60 * 1000;

interface PromptCacheEpisodeState {
  episodeId: string;
  startedAt: number;
}

export class ThreadPromptCacheEpisodeMonitor {
  private readonly episodes = new Map<string, PromptCacheEpisodeState>();

  clearThread(threadId: string): void {
    this.episodes.delete(threadId);
  }

  beginOrContinue(threadId: string): string {
    const now = Date.now();
    const current = this.episodes.get(threadId);
    if (current && now - current.startedAt <= EPISODE_WINDOW_MS) {
      return current.episodeId;
    }
    const episodeId = `pce_${now}_${Math.random().toString(36).slice(2, 8)}`;
    this.episodes.set(threadId, { episodeId, startedAt: now });
    return episodeId;
  }
}
