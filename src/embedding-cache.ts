/**
 * EmbeddingCache: IndexedDB-backed cache for ML embeddings
 * 
 * Caches high-dimensional embeddings to avoid re-computing the same
 * semantic similarity multiple times during multi-page crawls.
 * 
 * Expected impact:
 * - 70-80% reduction in embedding computations
 * - 2-3x faster multi-page crawls
 * - ~5MB IndexedDB storage per session
 * 
 * Example:
 * ```typescript
 * const cache = new EmbeddingCache();
 * await cache.init();
 * 
 * // Check cache first
 * let embedding = await cache.getEmbedding("delete button");
 * 
 * if (!embedding) {
 *   // Compute if not cached
 *   embedding = await model.compute("delete button");
 *   // Store for next time
 *   await cache.setEmbedding("delete button", embedding);
 * }
 * 
 * // Later, same text reuses cached embedding
 * const cached = await cache.getEmbedding("delete button"); // instant!
 * ```
 */

export class EmbeddingCache {
  private dbName = 'webmcp_embeddings';
  private storeName = 'embeddings';
  private db: IDBDatabase | null = null;
  private cacheStats = { hits: 0, misses: 0 };

  /**
   * Initialize IndexedDB connection
   * Safe to call multiple times (idempotent)
   */
  async init(): Promise<void> {
    if (this.db) {
      console.log('[embedding-cache] Already initialized');
      return;
    }

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);

      req.onerror = () => {
        console.error('[embedding-cache] Failed to open IndexedDB:', req.error);
        reject(req.error);
      };

      req.onsuccess = () => {
        this.db = req.result;
        console.log('[embedding-cache] ✓ IndexedDB initialized');
        resolve();
      };

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, {
            keyPath: 'textHash'
          });

          // Index for LRU cleanup (clear old entries)
          store.createIndex('timestamp', 'timestamp', { unique: false });

          console.log('[embedding-cache] Created IndexedDB store');
        }
      };
    });
  }

  /**
   * Retrieve cached embedding by text
   * @param text The text to look up (e.g., "delete button", "submit form")
   * @returns Embedding array or null if not cached
   */
  async getEmbedding(text: string): Promise<number[] | null> {
    if (!this.db) {
      console.warn('[embedding-cache] Not initialized, skipping cache lookup');
      return null;
    }

    try {
      const hash = this.hashText(text);
      const cached = await this.queryStore(this.storeName, hash);

      if (cached) {
        this.cacheStats.hits++;
        console.log(
          `[embedding-cache] HIT: "${text}" (hash: ${hash})`
        );
        // Convert Float32Array back to number[]
        return Array.from(cached.embedding as Float32Array);
      }

      this.cacheStats.misses++;
      return null;
    } catch (err) {
      console.error('[embedding-cache] Error fetching embedding:', err);
      return null;
    }
  }

  /**
   * Store embedding in cache with timestamp
   * @param text The source text
   * @param embedding The computed embedding vector
   */
  async setEmbedding(text: string, embedding: number[] | Float32Array): Promise<void> {
    if (!this.db) {
      console.warn('[embedding-cache] Not initialized, skipping cache store');
      return;
    }

    try {
      const record = {
        textHash: this.hashText(text),
        text,
        embedding: embedding instanceof Float32Array ? embedding : new Float32Array(embedding),
        timestamp: Date.now()
      };

      await this.storeInDb(this.storeName, record);
      console.log(
        `[embedding-cache] STORED: "${text}" (${embedding.length}D vector)`
      );
    } catch (err) {
      console.error('[embedding-cache] Error storing embedding:', err);
    }
  }

  /**
   * Clear expired cache entries (older than ttlMs)
   * Call this periodically to manage storage
   * @param ttlMs Time-to-live in milliseconds (default: 1 hour)
   */
  async clearExpired(ttlMs: number = 3600000): Promise<void> {
    if (!this.db) {
      console.warn('[embedding-cache] Not initialized, skipping cleanup');
      return;
    }

    try {
      const now = Date.now();
      const expireThreshold = now - ttlMs;

      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const index = store.index('timestamp');

        // Find all entries older than threshold
        const range = IDBKeyRange.upperBound(expireThreshold);
        let deletedCount = 0;

        const delReq = index.openCursor(range);

        delReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest).result;
          if (cursor) {
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            console.log(`[embedding-cache] Cleared ${deletedCount} expired entries`);
            resolve();
          }
        };

        delReq.onerror = () => {
          console.error('[embedding-cache] Error during cleanup:', delReq.error);
          reject(delReq.error);
        };

        tx.onerror = () => {
          reject(tx.error);
        };
      });
    } catch (err) {
      console.error('[embedding-cache] Error clearing expired:', err);
    }
  }

  /**
   * Get cache statistics for monitoring
   * @returns Hit rate, total hits, misses
   */
  getStats(): {
    hits: number;
    misses: number;
    hitRate: string;
    total: number;
  } {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    const hitRate =
      total > 0
        ? ((this.cacheStats.hits / total) * 100).toFixed(1)
        : '0.0';

    return {
      ...this.cacheStats,
      hitRate: `${hitRate}%`,
      total
    };
  }

  /**
   * Clear all cache entries
   * Use when starting a new session
   */
  async clear(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      return new Promise((resolve, reject) => {
        const tx = this.db!.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const req = store.clear();

        req.onsuccess = () => {
          console.log('[embedding-cache] Cache cleared');
          this.cacheStats = { hits: 0, misses: 0 };
          resolve();
        };

        req.onerror = () => {
          reject(req.error);
        };
      });
    } catch (err) {
      console.error('[embedding-cache] Error clearing cache:', err);
    }
  }

  /**
   * Close IndexedDB connection
   * Call when shutting down the analyzer
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[embedding-cache] Connection closed');
    }
  }

  // ========================================================================
  // Private helpers
  // ========================================================================

  /**
   * Simple hash function for text (good enough for cache keys)
   * In production, could use crypto.subtle.digest for cryptographic hash
   */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `emb_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Query a single record from the store
   */
  private async queryStore<T = any>(
    storeName: string,
    key: string
  ): Promise<T | null> {
    return new Promise((resolve) => {
      if (!this.db) {
        resolve(null);
        return;
      }

      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);

        req.onsuccess = () => {
          resolve(req.result || null);
        };

        req.onerror = () => {
          console.error('[embedding-cache] Query error:', req.error);
          resolve(null);
        };
      } catch (err) {
        console.error('[embedding-cache] Exception in queryStore:', err);
        resolve(null);
      }
    });
  }

  /**
   * Store a single record in the database
   */
  private async storeInDb<T = any>(
    storeName: string,
    record: T
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      try {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(record);

        req.onsuccess = () => {
          resolve();
        };

        req.onerror = () => {
          reject(req.error);
        };

        tx.onerror = () => {
          reject(tx.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }
}
