import { DatabaseService, PlaybackRecord, DailyGoal } from "../types/database";
import { DB_NAME, DB_VERSION, STORE_NAME } from "../utils/constants";

export class IndexedDBService implements DatabaseService {
    private db: IDBDatabase | null = null;

    async initDB(): Promise<IDBDatabase> {
        if (this.db) {
            console.log("[CI] Using existing database connection");
            return this.db;
        }

        return new Promise((resolve, reject) => {
            console.log("[CI] Opening database connection...");
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error("[CI] Database error:", request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                console.log("[CI] Database connection successful");
                this.db = request.result;

                this.db.onclose = () => {
                    console.log("[CI] Database connection closed");
                    this.db = null;
                };

                this.db.onversionchange = (event) => {
                    console.log(
                        "[CI] Database version changed:",
                        event.newVersion
                    );
                    this.db?.close();
                    this.db = null;
                };

                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                console.log(
                    "[CI] Database upgrade needed, old version:",
                    event.oldVersion,
                    "new version:",
                    event.newVersion
                );
                const db = request.result;

                // Create playback record storage
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    console.log("[CI] Creating object store:", STORE_NAME);
                    const store = db.createObjectStore(STORE_NAME, {
                        keyPath: "sessionId",
                    });

                    store.createIndex("date", "date", { unique: false });
                    store.createIndex("title", "title", { unique: false });
                    store.createIndex("url", "url", { unique: false });
                    store.createIndex("language", "language", {
                        unique: false,
                    });
                    store.createIndex("duration", "duration", {
                        unique: false,
                    });
                    store.createIndex("channelName", "channelName", {
                        unique: false,
                    });
                    store.createIndex("channelLogo", "channelLogo", {
                        unique: false,
                    });

                    console.log("[CI] Object store and indexes created");
                }

                // Create daily goals storage
                if (!db.objectStoreNames.contains("dailyGoals")) {
                    console.log("[CI] Creating daily goals object store");
                    const dailyGoalsStore = db.createObjectStore("dailyGoals", {
                        keyPath: "date",
                    });
                    dailyGoalsStore.createIndex("date", "date", {
                        unique: true,
                    });
                    console.log("[CI] Daily goals object store created");
                }
            };
        });
    }

    private async getDB(): Promise<IDBDatabase> {
        if (!this.db) {
            await this.initDB();
        }
        return this.db!;
    }

    async saveRecord(record: PlaybackRecord): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);

            const completeRecord = {
                sessionId: record.sessionId,
                title: record.title,
                url: record.url,
                language: record.language,
                duration: record.duration,
                date: record.date,
                channelName: record.channelName || null,
                channelLogo: record.channelLogo || null,
            };

            const request = store.put(completeRecord);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getTodayRecords(): Promise<PlaybackRecord[]> {
        const db = await this.getDB();
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            console.log("[CI] Fetching records between:", {
                today: today.toISOString(),
                tomorrow: tomorrow.toISOString(),
            });

            const transaction = db.transaction([STORE_NAME], "readonly");
            const store = transaction.objectStore(STORE_NAME);
            const index = store.index("date");
            const range = IDBKeyRange.bound(
                today.toISOString(),
                tomorrow.toISOString()
            );
            const request = index.getAll(range);

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    console.log("[CI] Found records:", request.result.length);
                    resolve(request.result);
                };
                request.onerror = () => {
                    console.error("[CI] Error getting records:", request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error("[CI] Error in getTodayRecords:", error);
            return [];
        }
    }

    async getAllRecords(): Promise<PlaybackRecord[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], "readonly");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async deleteRecord(sessionId: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(sessionId);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async saveDailyGoal(dailyGoal: DailyGoal): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["dailyGoals"], "readwrite");
            const store = transaction.objectStore("dailyGoals");

            const completeDailyGoal = {
                date: dailyGoal.date,
                goals: dailyGoal.goals,
                visibility: dailyGoal.visibility,
                updatedAt: new Date().toISOString(),
            };

            const request = store.put(completeDailyGoal);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getDailyGoal(date: string): Promise<DailyGoal | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["dailyGoals"], "readonly");
            const store = transaction.objectStore("dailyGoals");
            const request = store.getAll();

            request.onsuccess = () => {
                const allGoals = request.result || [];

                if (allGoals.length === 0) {
                    resolve(null);
                    return;
                }

                // Sort by date, find the closest goal before the specified date
                const sortedGoals = allGoals.sort(
                    (a, b) =>
                        new Date(b.date).getTime() - new Date(a.date).getTime()
                );

                const targetDate = new Date(date);
                let closestGoal: DailyGoal | null = null;

                for (const goal of sortedGoals) {
                    const goalDate = new Date(goal.date);
                    if (goalDate <= targetDate) {
                        closestGoal = goal;
                        break;
                    }
                }

                resolve(closestGoal);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async getAllDailyGoals(): Promise<DailyGoal[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(["dailyGoals"], "readonly");
            const store = transaction.objectStore("dailyGoals");
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result || []);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }
}

// Create singleton instance
export const databaseService = new IndexedDBService();
