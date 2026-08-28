/**
 * Vector Store API Polyfill, by Kenji Baheux and contributors.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vendored unmodified from
 * https://github.com/KenjiBaheux/Vector-Store-Polyfill (see LICENSE in this
 * directory). Not published to npm, so it is checked in rather than installed.
 */

/**
 * Vector Store API Polyfill
 * Built on top of the experimental Semantic Embedder API (EmbeddingGemma-300m).
 *
 * Implements:
 * - Static methods: availability(), params(), create(), retrieve(), list(), delete()
 * - Store methods: insert(), findNearest(), listContents(), updateContent(), deleteContent(), close()
 * - Intelligent sentence/token-aware chunking
 * - Strict detection of the experimental Semantic Embedder API with setup instructions when disabled
 */

(function (global) {
  'use strict';

  const DB_NAME = 'VectorStorePolyfillDB';
  const DB_VERSION = 1;

  // ---------------------------------------------------------------------------
  // 1. IndexedDB Storage Layer
  // ---------------------------------------------------------------------------
  class VectorStoreDB {
    static async getDB() {
      if (this.dbInstance) return this.dbInstance;
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this.dbInstance = request.result;
          resolve(this.dbInstance);
        };
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('stores')) {
            db.createObjectStore('stores', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('contents')) {
            const store = db.createObjectStore('contents', { keyPath: 'id' });
            store.createIndex('vector_store_id', 'vector_store_id', { unique: false });
          }
          if (!db.objectStoreNames.contains('chunks')) {
            const store = db.createObjectStore('chunks', { keyPath: 'chunkId' });
            store.createIndex('vector_store_id', 'vector_store_id', { unique: false });
            store.createIndex('content_id', 'content_id', { unique: false });
          }
        };
      });
    }

    static async getStoreMetadata(id) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('stores', 'readonly');
        const req = tx.objectStore('stores').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    static async saveStoreMetadata(storeMeta) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('stores', 'readwrite');
        const req = tx.objectStore('stores').put(storeMeta);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    static async listStores() {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('stores', 'readonly');
        const req = tx.objectStore('stores').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    static async deleteStore(id) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['stores', 'contents', 'chunks'], 'readwrite');
        tx.objectStore('stores').delete(id);

        // Delete all contents for this vector_store_id
        const contentIndex = tx.objectStore('contents').index('vector_store_id');
        const reqContents = contentIndex.openKeyCursor(IDBKeyRange.only(id));
        reqContents.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            tx.objectStore('contents').delete(cursor.primaryKey);
            cursor.continue();
          }
        };

        // Delete all chunks for this vector_store_id
        const chunkIndex = tx.objectStore('chunks').index('vector_store_id');
        const reqChunks = chunkIndex.openKeyCursor(IDBKeyRange.only(id));
        reqChunks.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            tx.objectStore('chunks').delete(cursor.primaryKey);
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    static async saveContentItem(contentItem) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('contents', 'readwrite');
        const req = tx.objectStore('contents').put(contentItem);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    static async getContentItem(id) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('contents', 'readonly');
        const req = tx.objectStore('contents').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    static async listContentsByStore(storeId) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('contents', 'readonly');
        const idx = tx.objectStore('contents').index('vector_store_id');
        const req = idx.getAll(IDBKeyRange.only(storeId));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    static async deleteContentItem(storeId, contentId) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['contents', 'chunks'], 'readwrite');
        tx.objectStore('contents').delete(contentId);

        // Delete associated chunks
        const chunkIndex = tx.objectStore('chunks').index('content_id');
        const reqChunks = chunkIndex.openKeyCursor(IDBKeyRange.only(contentId));
        reqChunks.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            tx.objectStore('chunks').delete(cursor.primaryKey);
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    static async saveChunks(chunksArray) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('chunks', 'readwrite');
        chunksArray.forEach((c) => tx.objectStore('chunks').put(c));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    static async getChunksByStore(storeId) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('chunks', 'readonly');
        const idx = tx.objectStore('chunks').index('vector_store_id');
        const req = idx.getAll(IDBKeyRange.only(storeId));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    static async deleteChunksByContent(contentId) {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('chunks', 'readwrite');
        const idx = tx.objectStore('chunks').index('content_id');
        const req = idx.openKeyCursor(IDBKeyRange.only(contentId));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            tx.objectStore('chunks').delete(cursor.primaryKey);
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Intelligent Text Chunking Strategy
  // ---------------------------------------------------------------------------
  class TextChunker {
    /**
     * Approximate token counter (~1.3 tokens per English word, or ~4 chars per token)
     */
    static estimateTokens(text) {
      if (!text) return 0;
      const words = text.trim().split(/\s+/).filter(Boolean);
      return Math.max(1, Math.ceil(words.length * 1.3));
    }

    /**
     * Chunks text into smaller segments according to maxChunkSizeTokens & chunkOverlapTokens.
     * Respects sentence boundaries where possible.
     */
    static chunkText(text, maxTokens = 400, overlapTokens = 50) {
      if (!text || typeof text !== 'string') return [];
      const trimmed = text.trim();
      if (!trimmed) return [];

      // If text fits within a single chunk, return immediately
      if (this.estimateTokens(trimmed) <= maxTokens) {
        return [trimmed];
      }

      // Split text into sentence-like segments
      const sentences = trimmed.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [trimmed];
      const chunks = [];
      let currentWords = [];
      let currentTokens = 0;

      const targetWords = Math.floor(maxTokens / 1.3);
      const overlapWords = Math.floor(overlapTokens / 1.3);

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i].trim();
        if (!sentence) continue;
        const sentWords = sentence.split(/\s+/);
        const sentTokens = Math.ceil(sentWords.length * 1.3);

        if (currentTokens + sentTokens <= maxTokens) {
          currentWords.push(...sentWords);
          currentTokens += sentTokens;
        } else {
          // Push current chunk if it has content
          if (currentWords.length > 0) {
            chunks.push(currentWords.join(' '));
            // Keep overlap words for the next chunk
            const preserved = currentWords.slice(-overlapWords);
            currentWords = [...preserved, ...sentWords];
            currentTokens = Math.ceil(currentWords.length * 1.3);
          } else {
            // Sentence itself is larger than max chunk size; split by words
            for (let j = 0; j < sentWords.length; j += (targetWords - overlapWords)) {
              const slice = sentWords.slice(j, j + targetWords);
              chunks.push(slice.join(' '));
              if (j + targetWords >= sentWords.length) break;
            }
            currentWords = [];
            currentTokens = 0;
          }
        }
      }

      if (currentWords.length > 0) {
        const remainingText = currentWords.join(' ');
        // Avoid adding a duplicate trailing chunk
        if (chunks.length === 0 || chunks[chunks.length - 1] !== remainingText) {
          chunks.push(remainingText);
        }
      }

      return chunks;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Distance Metrics & Similarity Calculator
  // ---------------------------------------------------------------------------
  class SimilarityCalculator {
    static compute(vecA, vecB, distanceType = 'Cosine') {
      if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

      const type = (distanceType || 'Cosine').toLowerCase();
      if (type === 'dotproduct') {
        let dot = 0;
        for (let i = 0; i < vecA.length; i++) {
          dot += vecA[i] * vecB[i];
        }
        return dot;
      } else if (type === 'euclidean') {
        let sumSq = 0;
        for (let i = 0; i < vecA.length; i++) {
          const diff = vecA[i] - vecB[i];
          sumSq += diff * diff;
        }
        const dist = Math.sqrt(sumSq);
        return 1 / (1 + dist);
      } else {
        // Default: Cosine Similarity
        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < vecA.length; i++) {
          dotProduct += vecA[i] * vecB[i];
          normA += vecA[i] * vecA[i];
          normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Vector Store Instance
  // ---------------------------------------------------------------------------
  class VectorStoreInstance {
    constructor(metadata, embedder, isNative) {
      this._metadata = metadata;
      this.semanticEmbedder = embedder;
      this.isNative = isNative;
    }

    get metadata() {
      return {
        id: this._metadata.id,
        createdAt: this._metadata.createdAt,
        lastModified: this._metadata.lastModified,
        itemCount: this._metadata.itemCount,
        configuration: {
          maxChunkSizeTokens: this._metadata.configuration.maxChunkSizeTokens,
          chunkOverlapTokens: this._metadata.configuration.chunkOverlapTokens
        },
        distance_type: this._metadata.distance_type || 'Cosine'
      };
    }

    get id() {
      return this._metadata.id;
    }

    /**
     * Insert raw text strings into the VectorStore.
     * Automatically chunks text, generates embeddings with taskType: 'retrieval-document',
     * and persists records in IndexedDB.
     */
    async insert(items) {
      if (!Array.isArray(items)) {
        throw new TypeError('vectorStore.insert() expects an array of content objects.');
      }

      const contentIds = [];
      const newContents = [];
      const newChunks = [];

      const maxTokens = this._metadata.configuration.maxChunkSizeTokens || 400;
      const overlapTokens = this._metadata.configuration.chunkOverlapTokens || 50;

      for (const item of items) {
        if (!item || typeof item.content !== 'string') {
          continue;
        }

        const contentId = item.id ? String(item.id) : ('note_' + crypto.randomUUID());
        contentIds.push(contentId);

        const now = Date.now();
        const contentRecord = {
          id: contentId,
          vector_store_id: this.id,
          content: item.content,
          createdAt: now,
          lastModified: now,
          ...item
        };
        newContents.push(contentRecord);

        // Chunk text
        const chunkTexts = TextChunker.chunkText(item.content, maxTokens, overlapTokens);

        // Generate embeddings for each chunk using taskType: 'retrieval-document'
        for (let i = 0; i < chunkTexts.length; i++) {
          const chunkText = chunkTexts[i];
          const embedResult = await this.semanticEmbedder.embed(chunkText, {
            taskType: 'retrieval-document'
          });
          const vectorValues = embedResult.embeddings[0].values; // Float32Array

          newChunks.push({
            chunkId: `${this.id}_${contentId}_chunk_${i}_${crypto.randomUUID().slice(0, 8)}`,
            content_id: contentId,
            vector_store_id: this.id,
            chunkText: chunkText,
            chunkIndex: i,
            embedding: Array.from(vectorValues), // Serialize for IndexedDB storage
            createdAt: now
          });
        }
      }

      // Save to IndexedDB
      for (const contentItem of newContents) {
        await VectorStoreDB.saveContentItem(contentItem);
      }
      if (newChunks.length > 0) {
        await VectorStoreDB.saveChunks(newChunks);
      }

      // Update store metadata
      this._metadata.itemCount += newContents.length;
      this._metadata.lastModified = Date.now();
      await VectorStoreDB.saveStoreMetadata(this._metadata);

      return {
        allResponses: [],
        hasErrors: false,
        contentIds: contentIds,
        insertedCount: contentIds.length
      };
    }

    /**
     * Perform semantic search using query text.
     * Embeds query with taskType: 'retrieval-query' and calculates similarity scores.
     */
    async findNearest(queryText, options = {}) {
      if (typeof queryText !== 'string' || !queryText.trim()) {
        return [];
      }

      const maxNumResults = typeof options.max_num_results === 'number' ? options.max_num_results : 10;
      const scoreThreshold = typeof options.score_threshold === 'number' ? options.score_threshold : 0;
      const distanceType = this._metadata.distance_type || 'Cosine';

      // 1. Embed query with taskType: 'retrieval-query'
      const embedResult = await this.semanticEmbedder.embed(queryText, {
        taskType: 'retrieval-query'
      });
      const queryVector = embedResult.embeddings[0].values;

      // 2. Fetch all stored chunks for this vector store
      const storedChunks = await VectorStoreDB.getChunksByStore(this.id);

      // 3. Compute similarity scores
      const scoredResults = storedChunks.map((chunk) => {
        const score = SimilarityCalculator.compute(queryVector, chunk.embedding, distanceType);
        return {
          score: score,
          content: chunk.chunkText, // Matching chunk text as in spec example
          id: chunk.content_id,     // Parent content ID (e.g. note_123)
          chunkId: chunk.chunkId,
          chunkIndex: chunk.chunkIndex,
          vector_store_id: chunk.vector_store_id
        };
      });

      // 4. Filter by score threshold & sort descending
      const filtered = scoredResults
        .filter((item) => item.score >= scoreThreshold)
        .sort((a, b) => b.score - a.score);

      // 5. Return top max_num_results
      return filtered.slice(0, maxNumResults);
    }

    /**
     * List all contents inside this vector store.
     */
    async listContents() {
      const records = await VectorStoreDB.listContentsByStore(this.id);
      return records.map((r) => ({
        ...r
      }));
    }

    /**
     * Update an existing content item by ID.
     * Deletes existing chunks and re-embeds the new text.
     */
    async updateContent(contentId, newContentString) {
      if (!contentId || typeof newContentString !== 'string') {
        throw new Error('updateContent requires a valid contentId and newContent string.');
      }

      const existing = await VectorStoreDB.getContentItem(contentId);
      if (!existing || existing.vector_store_id !== this.id) {
        throw new Error(`Content item '${contentId}' not found in store '${this.id}'.`);
      }

      // 1. Remove old chunks
      await VectorStoreDB.deleteChunksByContent(contentId);

      // 2. Update content record
      const now = Date.now();
      existing.content = newContentString;
      existing.lastModified = now;
      await VectorStoreDB.saveContentItem(existing);

      // 3. Re-chunk and embed with taskType: 'retrieval-document'
      const maxTokens = this._metadata.configuration.maxChunkSizeTokens || 400;
      const overlapTokens = this._metadata.configuration.chunkOverlapTokens || 50;
      const chunkTexts = TextChunker.chunkText(newContentString, maxTokens, overlapTokens);

      const newChunks = [];
      for (let i = 0; i < chunkTexts.length; i++) {
        const chunkText = chunkTexts[i];
        const embedResult = await this.semanticEmbedder.embed(chunkText, {
          taskType: 'retrieval-document'
        });
        const vectorValues = embedResult.embeddings[0].values;

        newChunks.push({
          chunkId: `${this.id}_${contentId}_chunk_${i}_${crypto.randomUUID().slice(0, 8)}`,
          content_id: contentId,
          vector_store_id: this.id,
          chunkText: chunkText,
          chunkIndex: i,
          embedding: Array.from(vectorValues),
          createdAt: now
        });
      }

      if (newChunks.length > 0) {
        await VectorStoreDB.saveChunks(newChunks);
      }

      // 4. Update store timestamp
      this._metadata.lastModified = now;
      await VectorStoreDB.saveStoreMetadata(this._metadata);

      return true;
    }

    /**
     * Delete a content item and its chunks.
     */
    async deleteContent(contentId) {
      if (!contentId) return false;
      const existing = await VectorStoreDB.getContentItem(contentId);
      if (!existing || existing.vector_store_id !== this.id) {
        return false;
      }

      await VectorStoreDB.deleteContentItem(this.id, contentId);
      this._metadata.itemCount = Math.max(0, this._metadata.itemCount - 1);
      this._metadata.lastModified = Date.now();
      await VectorStoreDB.saveStoreMetadata(this._metadata);
      return true;
    }

    /**
     * Proactively close connection to release resources.
     */
    close() {
      if (this.semanticEmbedder && typeof this.semanticEmbedder.destroy === 'function') {
        this.semanticEmbedder.destroy();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Main VectorStore API Interface
  // ---------------------------------------------------------------------------
  class VectorStore {
    static get SETUP_INSTRUCTIONS() {
      return {
        title: 'Initial Setup and Configuration',
        prerequisite: 'To begin testing, ensure you are using the latest version of Chrome Canary ie, it should be greater than 153.0.7979.0.',
        flagInstruction: 'You must manually enable the following experimental flag to access the Semantic Embedder API:\nSemantic Embedder API: Enable chrome://flags/#semantic-embedder-api',
        about: 'Semantic Embedder API\nThe Semantic Embedder API enables the generation of text embeddings on-device. This allows for privacy-preserving semantic understanding, low-latency applications, and avoids server-side costs.\nThe API is currently supported only on desktops (Linux, Mac and Windows).',
        url: 'chrome://flags/#semantic-embedder-api'
      };
    }

    /**
     * Check availability of the Vector Store API (via SemanticEmbedder).
     * Returns: 'available', 'readily', 'after-download', or 'unavailable'.
     */
    static async availability() {
      if (typeof global.SemanticEmbedder !== 'undefined' && global.SemanticEmbedder.availability) {
        try {
          const avail = await global.SemanticEmbedder.availability();
          if (avail === 'available' || avail === 'readily' || avail === 'after-download') {
            return avail;
          }
          return avail;
        } catch (e) {
          console.warn('Error checking SemanticEmbedder.availability():', e);
          return 'unavailable';
        }
      }
      return 'unavailable';
    }

    /**
     * Return model capability parameters and default chunking strategy.
     */
    static async params() {
      const avail = await this.availability();
      const isAvailable = avail !== 'unavailable' && avail !== 'no';
      return {
        maxChunkSizeTokens: 400,
        chunkOverlapTokens: 50,
        supportedDistanceTypes: ['Cosine', 'DotProduct', 'Euclidean'],
        model: isAvailable
          ? 'Native Semantic Embedder API (embeddinggemma-300m)'
          : 'Unavailable (Semantic Embedder API not enabled)'
      };
    }

    /**
     * Create a new VectorStore instance with specified configuration.
     */
    static async create(config = {}) {
      const avail = await this.availability();
      if (avail === 'unavailable' || avail === 'no') {
        const error = new Error('Semantic Embedder API is not enabled. Please enable chrome://flags/#semantic-embedder-api in Chrome Canary (>153.0.7979.0) on Desktop (Linux, Mac, or Windows).');
        error.code = 'ERR_SEMANTIC_EMBEDDER_UNAVAILABLE';
        error.instructions = this.SETUP_INSTRUCTIONS;
        throw error;
      }

      const storeId = config.id ? String(config.id) : ('store_' + crypto.randomUUID());
      const maxChunkSizeTokens = config.chunkingStrategy && typeof config.chunkingStrategy.maxChunkSizeTokens === 'number'
        ? config.chunkingStrategy.maxChunkSizeTokens
        : 400;
      const chunkOverlapTokens = config.chunkingStrategy && typeof config.chunkingStrategy.chunkOverlapTokens === 'number'
        ? config.chunkingStrategy.chunkOverlapTokens
        : 50;
      const distanceType = config.distance_type || 'Cosine';

      let embedder;
      try {
        embedder = await global.SemanticEmbedder.create({
          monitor: config.monitor
        });
        console.info('[VectorStore Polyfill] Using Native SemanticEmbedder (embeddinggemma-300m).');
      } catch (err) {
        const error = new Error('Native SemanticEmbedder.create() failed: ' + err.message);
        error.code = 'ERR_SEMANTIC_EMBEDDER_UNAVAILABLE';
        error.instructions = this.SETUP_INSTRUCTIONS;
        throw error;
      }

      const now = Date.now();
      const storeMetadata = {
        id: storeId,
        createdAt: now,
        lastModified: now,
        itemCount: 0,
        configuration: {
          maxChunkSizeTokens,
          chunkOverlapTokens
        },
        distance_type: distanceType
      };

      await VectorStoreDB.saveStoreMetadata(storeMetadata);
      return new VectorStoreInstance(storeMetadata, embedder, true);
    }

    /**
     * List all available VectorStores on this origin.
     */
    static async list() {
      const allStores = await VectorStoreDB.listStores();
      return allStores.map((meta) => ({
        id: meta.id,
        createdAt: meta.createdAt,
        lastModified: meta.lastModified,
        itemCount: meta.itemCount,
        configuration: {
          maxChunkSizeTokens: meta.configuration.maxChunkSizeTokens,
          chunkOverlapTokens: meta.configuration.chunkOverlapTokens
        },
        distance_type: meta.distance_type || 'Cosine'
      }));
    }

    /**
     * Retrieve an existing VectorStore by ID without redefining config or re-ingesting documents.
     */
    static async retrieve(storeId) {
      if (!storeId) {
        throw new Error('VectorStore.retrieve() requires a valid store ID.');
      }

      const avail = await this.availability();
      if (avail === 'unavailable' || avail === 'no') {
        const error = new Error('Semantic Embedder API is not enabled. Please enable chrome://flags/#semantic-embedder-api in Chrome Canary (>153.0.7979.0) on Desktop (Linux, Mac, or Windows).');
        error.code = 'ERR_SEMANTIC_EMBEDDER_UNAVAILABLE';
        error.instructions = this.SETUP_INSTRUCTIONS;
        throw error;
      }

      const existingMeta = await VectorStoreDB.getStoreMetadata(storeId);
      if (!existingMeta) {
        throw new Error(`VectorStore with ID '${storeId}' does not exist.`);
      }

      let embedder;
      try {
        embedder = await global.SemanticEmbedder.create();
      } catch (err) {
        const error = new Error('Native SemanticEmbedder.create() failed: ' + err.message);
        error.code = 'ERR_SEMANTIC_EMBEDDER_UNAVAILABLE';
        error.instructions = this.SETUP_INSTRUCTIONS;
        throw error;
      }

      return new VectorStoreInstance(existingMeta, embedder, true);
    }

    /**
     * Delete a VectorStore and all its contents/chunks from disk.
     */
    static async delete(storeId) {
      if (!storeId) return false;
      return await VectorStoreDB.deleteStore(storeId);
    }
  }

  // Export to global object
  global.VectorStore = VectorStore;

  // Also support module environments if present
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = VectorStore;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
