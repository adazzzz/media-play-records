import React, { useEffect, useMemo, useState } from "react";
import { databaseService } from "../../services/database";
import { DailyGoal, PlaybackRecord } from "../../types/database";
import { formatDuration } from "../../utils/time";
import Calendar from "../Calendar";
import "./History.css";
import { DEFAULT_DAILY_GOAL } from "../../utils/constants";

interface HistoryProps {
    onBack: () => void;
}

const LANGUAGES = [
    { key: "cantonese", label: "Cantonese" },
    { key: "english", label: "English" },
    { key: "japanese", label: "Japanese" },
    { key: "spanish", label: "Spanish" },
];

type DisplayRecord = PlaybackRecord & {
    mergedSessionIds: string[];
    totalDuration: number;
    startDate: string;
    isMerged: boolean;
};

const getVideoKey = (record: PlaybackRecord) =>
    `${record.url || record.title}-${record.language}`;

const buildDisplayRecords = (
    records: PlaybackRecord[],
    mergeConsecutive: boolean
): DisplayRecord[] => {
    if (!mergeConsecutive) {
        return records.map((record) => ({
            ...record,
            mergedSessionIds: [record.sessionId],
            totalDuration: record.duration,
            startDate: record.date,
            isMerged: false,
        }));
    }

    const merged: DisplayRecord[] = [];
    let current: DisplayRecord | null = null;
    let lastMergedDate: string | null = null;
    const pushCurrent = (record: DisplayRecord | null) => {
        if (!record) return;
        merged.push({
            ...record,
            isMerged: record.mergedSessionIds.length > 1,
        });
    };

    records.forEach((record) => {
        const videoKey = getVideoKey(record);
        if (current) {
            const prevDate = lastMergedDate
                ? new Date(lastMergedDate)
                : new Date(current.startDate);
            const currentDate = new Date(record.date);
            const gapHours =
                Math.abs(prevDate.getTime() - currentDate.getTime()) /
                (1000 * 60 * 60);
            const crossesDay =
                prevDate.getFullYear() !== currentDate.getFullYear() ||
                prevDate.getMonth() !== currentDate.getMonth() ||
                prevDate.getDate() !== currentDate.getDate();

            const shouldMerge =
                getVideoKey(current) === videoKey &&
                !(crossesDay && gapHours > 2);

            if (shouldMerge) {
                current.totalDuration += record.duration;
                current.startDate =
                    new Date(record.date).getTime() <
                    new Date(current.startDate).getTime()
                        ? record.date
                        : current.startDate;
                current.mergedSessionIds.push(record.sessionId);
                lastMergedDate = record.date;
                if (!current.channelLogo) current.channelLogo = record.channelLogo;
                if (!current.channelName) current.channelName = record.channelName;
                return;
            }

            pushCurrent(current);
        } else {
            lastMergedDate = null;
        }

        current = {
            ...record,
            mergedSessionIds: [record.sessionId],
            totalDuration: record.duration,
            startDate: record.date,
            isMerged: false,
        };
        lastMergedDate = record.date;
    });

    pushCurrent(current);

    return merged;
};

const History: React.FC<HistoryProps> = ({ onBack }) => {
    const [goals, setGoals] = useState<DailyGoal[]>([]);
    const [records, setRecords] = useState<PlaybackRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState<string>(
        new Date().toISOString().slice(0, 7) // YYYY-MM format
    );
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [showEditEntry, setShowEditEntry] = useState(false);
    const [editingRecord, setEditingRecord] = useState<PlaybackRecord | null>(
        null
    );
    const [dateFilter, setDateFilter] = useState("all");
    const [languageFilter, setLanguageFilter] = useState("all");
    const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
    const [goalInputs, setGoalInputs] =
        useState<Record<string, number>>(DEFAULT_DAILY_GOAL);
    const [mergeDisplay, setMergeDisplay] = useState(true);

    useEffect(() => {
        loadGoals();
        loadRecords();
    }, [selectedMonth, dateFilter, languageFilter]);

    // Load today's or recent goals and populate input fields
    const loadGoals = async () => {
        try {
            setLoading(true);
            const today = new Date().toISOString().split("T")[0];
            let dailyGoal = await databaseService.getDailyGoal(today);
            if (!dailyGoal) {
                dailyGoal = {
                    date: today,
                    goals: DEFAULT_DAILY_GOAL,
                    updatedAt: new Date().toISOString(),
                };
            }
            setGoalInputs(dailyGoal.goals);
            let allGoals = await databaseService.getAllDailyGoals();
            // Filter goals for selected month
            const filteredGoals = allGoals.filter((goal) =>
                goal.date.startsWith(selectedMonth)
            );
            setGoals(filteredGoals);
        } catch (error) {
            console.error("Failed to load goals:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadRecords = async () => {
        try {
            const allRecords = await databaseService.getAllRecords();

            // Filter records
            let filteredRecords = allRecords.filter((record) => {
                // Language filter
                if (
                    languageFilter !== "all" &&
                    record.language !== languageFilter
                ) {
                    return false;
                }

                // Date filter
                const recordDate = new Date(record.date);
                const now = new Date();
                const today = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate()
                );
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - today.getDay());
                const monthStart = new Date(
                    today.getFullYear(),
                    today.getMonth(),
                    1
                );

                switch (dateFilter) {
                    case "today":
                        return recordDate >= today;
                    case "week":
                        return recordDate >= weekStart;
                    case "month":
                        return recordDate >= monthStart;
                    default:
                        return true;
                }
            });

            // Sort by date
            filteredRecords.sort(
                (a, b) =>
                    new Date(b.date).getTime() - new Date(a.date).getTime()
            );
            setRecords(filteredRecords);
        } catch (error) {
            console.error("Failed to load records:", error);
        }
    };

    const getLanguageStats = () => {
        const stats = {
            cantonese: 0,
            english: 0,
            japanese: 0,
            spanish: 0,
        };
        console.log("records", records);
        // Count actual study time, not goal time
        records.forEach((record) => {
            if (record.language in stats) {
                stats[record.language as keyof typeof stats] += record.duration;
            }
        });

        return stats;
    };

    const languageStats = getLanguageStats();
    const displayRecords = useMemo(
        () => buildDisplayRecords(records, mergeDisplay),
        [records, mergeDisplay]
    );

    // Data management functions
    const exportData = async () => {
        try {
            const data = {
                version: "1.0",
                exportDate: new Date().toISOString(),
                records: records,
                goals: goals,
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `video-history-${
                new Date().toISOString().split("T")[0]
            }.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Error exporting data:", error);
            alert("Failed to export data, please try again");
        }
    };

    const importData = async (file: File) => {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (
                !data.version ||
                !data.records ||
                !Array.isArray(data.records)
            ) {
                throw new Error("Invalid data format");
            }

            for (const record of data.records) {
                await databaseService.saveRecord(record);
            }

            await loadRecords();
            alert("Data imported successfully");
        } catch (error) {
            console.error("Error importing data:", error);
            alert(
                "Failed to import data, please ensure file format is correct"
            );
        }
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            importData(file);
        }
    };

    const generateSessionId = () => {
        return (
            "manual_session_" +
            Date.now() +
            "_" +
            Math.random().toString(36).substr(2, 9)
        );
    };

    const handleManualEntry = async (
        event: React.FormEvent<HTMLFormElement>
    ) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);

        const date = formData.get("date") as string;
        const title = formData.get("title") as string;
        const url = formData.get("url") as string;
        const durationMinutes = parseInt(formData.get("duration") as string);
        const language = formData.get("language") as string;

        if (!date || !title || !durationMinutes || !language) {
            alert("Please fill in all required fields");
            return;
        }

        const record: PlaybackRecord = {
            sessionId: generateSessionId(),
            duration: durationMinutes * 60,
            title: title,
            language: language as any,
            date: new Date(date).toISOString(),
            url: url || "manual-entry",
        };

        try {
            await databaseService.saveRecord(record);
            setShowManualEntry(false);
            await loadRecords();
            alert("Record added successfully");
        } catch (error) {
            console.error("Error adding manual entry:", error);
            alert("Failed to add record, please try again");
        }
    };

    const deleteRecordGroup = async (sessionIds: string[]) => {
        if (sessionIds.length === 0) return;
        const uniqueIds = Array.from(new Set(sessionIds));
        const message =
            uniqueIds.length === 1
                ? "Are you sure you want to delete this record?"
                : `Delete this merged record? This will remove ${uniqueIds.length} segments.`;
        if (confirm(message)) {
            try {
                for (const sessionId of uniqueIds) {
                    await databaseService.deleteRecord(sessionId);
                }
                setSelectedRecords((prev) =>
                    prev.filter((id) => !uniqueIds.includes(id))
                );
                await loadRecords();
            } catch (error) {
                console.error("Error deleting record:", error);
                alert("Delete failed, please try again");
            }
        }
    };

    const editRecord = (record: PlaybackRecord) => {
        setEditingRecord(record);
        setShowEditEntry(true);
    };

    const handleEditEntry = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!editingRecord) return;

        const formData = new FormData(event.currentTarget);

        const title = formData.get("title") as string;
        const url = formData.get("url") as string;
        const durationMinutes = parseInt(formData.get("duration") as string);
        const language = formData.get("language") as string;
        const date = formData.get("date") as string;

        if (!title || !durationMinutes || !language || !date) {
            alert("Please fill in all required fields");
            return;
        }

        // Check if there are actual changes
        const originalDurationMinutes = Math.floor(editingRecord.duration / 60);
        const originalDate = new Date(editingRecord.date)
            .toISOString()
            .split("T")[0];
        const inputDate = new Date(date).toISOString().split("T")[0];

        const updatedRecord: PlaybackRecord = {
            ...editingRecord,
            title: title,
            url: url || editingRecord.url,
            // If duration hasn't changed, keep the original duration
            duration:
                durationMinutes === originalDurationMinutes
                    ? editingRecord.duration
                    : durationMinutes * 60,
            language: language as any,
            // If date hasn't changed, keep the original date
            date:
                inputDate === originalDate
                    ? editingRecord.date
                    : new Date(date).toISOString(),
        };

        try {
            await databaseService.saveRecord(updatedRecord);
            setShowEditEntry(false);
            setEditingRecord(null);
            await loadRecords();
            alert("Record updated successfully");
        } catch (error) {
            console.error("Error updating record:", error);
            alert("Failed to update record, please try again");
        }
    };

    const batchDelete = async () => {
        if (selectedRecords.length === 0) return;

        if (
            confirm(
                `Are you sure you want to delete the selected ${selectedRecords.length} records?`
            )
        ) {
            try {
                const uniqueIds = Array.from(new Set(selectedRecords));
                for (const sessionId of uniqueIds) {
                    await databaseService.deleteRecord(sessionId);
                }
                setSelectedRecords([]);
                await loadRecords();
                alert("Batch delete successful");
            } catch (error) {
                console.error("Error batch deleting records:", error);
                alert("Batch delete failed, please try again");
            }
        }
    };

    const toggleRecordSelection = (sessionIds: string | string[]) => {
        const ids = Array.isArray(sessionIds) ? sessionIds : [sessionIds];
        setSelectedRecords((prev) => {
            const next = new Set(prev);
            const allSelected = ids.every((id) => next.has(id));
            if (allSelected) {
                ids.forEach((id) => next.delete(id));
            } else {
                ids.forEach((id) => next.add(id));
            }
            return Array.from(next);
        });
    };

    // Save goal
    const saveGoal = async (language: string) => {
        try {
            const today = new Date().toISOString().split("T")[0];
            const existingDailyGoal = await databaseService.getDailyGoal(today);
            // Ensure goals object has all languages
            const goals: Record<string, number> = {
                cantonese: 0,
                english: 0,
                japanese: 0,
                spanish: 0,
                ...(existingDailyGoal ? existingDailyGoal.goals : {}),
            };
            goals[language] = goalInputs[language] || 0;
            await databaseService.saveDailyGoal({
                date: today,
                goals,
                updatedAt: new Date().toISOString(),
            });
            alert("Goal saved successfully");
            await loadGoals();
        } catch (error) {
            console.error("Error saving goal:", error);
            alert("Failed to save goal, please try again");
        }
    };

    // Goal input change
    const handleGoalInputChange = (language: string, value: string) => {
        setGoalInputs((prev) => ({ ...prev, [language]: Number(value) }));
    };

    if (loading) {
        return (
            <div className="history-container">
                <div className="history-header">
                    <button className="back-button" onClick={onBack}>
                        ← Back
                    </button>
                    <h2>History Records</h2>
                </div>
                <div className="loading">Loading...</div>
            </div>
        );
    }

    return (
        <div className="history-container">
            <div className="history-header">
                <button className="back-button" onClick={onBack}>
                    ← Back
                </button>
                <h2>History Records</h2>
            </div>
            {/* Goal setting section */}
            <div className="goals-section">
                <h3>Learning Goal Settings</h3>
                <div className="goals-container">
                    {LANGUAGES.map((lang) => (
                        <div className="goal-item" key={lang.key}>
                            <label>{lang.label} Goal (minutes/day):</label>
                            <input
                                type="number"
                                min="0"
                                step="1"
                                value={goalInputs[lang.key] || 0}
                                onChange={(e) =>
                                    handleGoalInputChange(
                                        lang.key,
                                        e.target.value
                                    )
                                }
                            />
                            <button
                                onClick={() => saveGoal(lang.key)}
                                className="save-goal-btn"
                            >
                                Save
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Data management buttons */}
            <div className="data-management">
                <button onClick={exportData} className="action-btn">
                    Export Data
                </button>
                <label htmlFor="importBtn" className="action-btn">
                    Import Data
                </label>
                <input
                    type="file"
                    id="importBtn"
                    accept=".json"
                    style={{ display: "none" }}
                    onChange={handleFileSelect}
                />
                <button
                    onClick={() => setShowManualEntry(true)}
                    className="action-btn"
                >
                    Add Record
                </button>
                {selectedRecords.length > 0 && (
                    <button
                        onClick={batchDelete}
                        className="action-btn delete-btn"
                    >
                        Batch Delete ({selectedRecords.length})
                    </button>
                )}
            </div>

            {/* Filters */}
            <div className="filters">
                <div className="filter-group">
                    <label htmlFor="dateFilter">Time:</label>
                    <select
                        id="dateFilter"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                    >
                        <option value="all">All Time</option>
                        <option value="today">Today</option>
                        <option value="week">This Week</option>
                        <option value="month">This Month</option>
                    </select>
                </div>
                <div className="filter-group">
                    <label htmlFor="languageFilter">Language:</label>
                    <select
                        id="languageFilter"
                        value={languageFilter}
                        onChange={(e) => setLanguageFilter(e.target.value)}
                    >
                        <option value="all">All Languages</option>
                        <option value="cantonese">Cantonese</option>
                        <option value="english">English</option>
                        <option value="japanese">Japanese</option>
                        <option value="spanish">Spanish</option>
                    </select>
                </div>
            </div>

            {/* Manual entry modal */}
            {showManualEntry && (
                <div
                    className="modal-overlay"
                    onClick={() => setShowManualEntry(false)}
                >
                    <div
                        className="modal-content"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header">
                            <h3>Manual Add Record</h3>
                            <button
                                className="close-btn"
                                onClick={() => setShowManualEntry(false)}
                            >
                                &times;
                            </button>
                        </div>
                        <form onSubmit={handleManualEntry}>
                            <div className="form-group">
                                <label htmlFor="entryDate">Date:</label>
                                <input
                                    type="date"
                                    name="date"
                                    id="entryDate"
                                    defaultValue={
                                        new Date().toISOString().split("T")[0]
                                    }
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="entryTitle">Title:</label>
                                <input
                                    type="text"
                                    name="title"
                                    id="entryTitle"
                                    placeholder="Enter video title"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="entryUrl">
                                    URL (optional):
                                </label>
                                <input
                                    type="url"
                                    name="url"
                                    id="entryUrl"
                                    placeholder="Enter video link"
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="entryDuration">
                                    Duration (minutes):
                                </label>
                                <input
                                    type="number"
                                    name="duration"
                                    id="entryDuration"
                                    min="1"
                                    step="1"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="entryLanguage">Language:</label>
                                <select
                                    name="language"
                                    id="entryLanguage"
                                    required
                                >
                                    <option value="cantonese">Cantonese</option>
                                    <option value="english">English</option>
                                    <option value="japanese">Japanese</option>
                                    <option value="spanish">Spanish</option>
                                </select>
                            </div>
                            <div className="button-group">
                                <button type="submit" className="submit-btn">
                                    Add Record
                                </button>
                                <button
                                    type="button"
                                    className="cancel-btn"
                                    onClick={() => setShowManualEntry(false)}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit record modal */}
            {showEditEntry && editingRecord && (
                <div
                    className="modal-overlay"
                    onClick={() => {
                        setShowEditEntry(false);
                        setEditingRecord(null);
                    }}
                >
                    <div
                        className="modal-content"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header">
                            <h3>Edit Record</h3>
                            <button
                                className="close-btn"
                                onClick={() => {
                                    setShowEditEntry(false);
                                    setEditingRecord(null);
                                }}
                            >
                                &times;
                            </button>
                        </div>
                        <form onSubmit={handleEditEntry}>
                            <div className="form-group">
                                <label htmlFor="editDate">Date:</label>
                                <input
                                    type="date"
                                    name="date"
                                    id="editDate"
                                    defaultValue={
                                        new Date(editingRecord.date)
                                            .toISOString()
                                            .split("T")[0]
                                    }
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="editTitle">Title:</label>
                                <input
                                    type="text"
                                    name="title"
                                    id="editTitle"
                                    defaultValue={editingRecord.title}
                                    placeholder="Enter video title"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="editUrl">URL (optional):</label>
                                <input
                                    type="url"
                                    name="url"
                                    id="editUrl"
                                    defaultValue={editingRecord.url}
                                    placeholder="Enter video link"
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="editDuration">
                                    Duration (minutes):
                                </label>
                                <input
                                    type="number"
                                    name="duration"
                                    id="editDuration"
                                    min="1"
                                    step="1"
                                    defaultValue={Math.floor(
                                        editingRecord.duration / 60
                                    )}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="editLanguage">Language:</label>
                                <select
                                    name="language"
                                    id="editLanguage"
                                    defaultValue={editingRecord.language}
                                    required
                                >
                                    <option value="cantonese">Cantonese</option>
                                    <option value="english">English</option>
                                    <option value="japanese">Japanese</option>
                                    <option value="spanish">Spanish</option>
                                </select>
                            </div>
                            <div className="button-group">
                                <button type="submit" className="submit-btn">
                                    Update Record
                                </button>
                                <button
                                    type="button"
                                    className="cancel-btn"
                                    onClick={() => {
                                        setShowEditEntry(false);
                                        setEditingRecord(null);
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Statistics summary */}
            <div className="stats-summary">
                <h3>Statistics Summary</h3>
                <div className="stats-grid">
                    <div className="stat-item">
                        <span className="stat-label">Cantonese</span>
                        <span className="stat-value">
                            {formatDuration(languageStats.cantonese)}
                        </span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">English</span>
                        <span className="stat-value">
                            {formatDuration(languageStats.english)}
                        </span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Japanese</span>
                        <span className="stat-value">
                            {formatDuration(languageStats.japanese)}
                        </span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Spanish</span>
                        <span className="stat-value">
                            {formatDuration(languageStats.spanish)}
                        </span>
                    </div>
                </div>
            </div>

            {/* Calendar view */}
            <Calendar languageFilter={languageFilter} goalInputs={goalInputs} />

            {/* Records list */}
            <div className="records-list">
                <div className="records-list-header">
                    <h3>Detailed Records</h3>
                    <label className="merge-toggle">
                        <input
                            type="checkbox"
                            checked={mergeDisplay}
                            onChange={(e) =>
                                setMergeDisplay(e.target.checked)
                            }
                        />
                        <span>Merge consecutive plays</span>
                    </label>
                </div>
                {displayRecords.length === 0 ? (
                    <div className="no-records">No records</div>
                ) : (
                    <div className="records-grid">
                        {displayRecords.map((record) => (
                            <div
                                key={record.mergedSessionIds.join("|")}
                                className="record-item"
                            >
                                <div className="record-header">
                                    <input
                                        type="checkbox"
                                        checked={record.mergedSessionIds.every(
                                            (id) => selectedRecords.includes(id)
                                        )}
                                        onChange={() =>
                                            toggleRecordSelection(
                                                record.mergedSessionIds
                                            )
                                        }
                                        className="record-checkbox"
                                    />
                                    <span className="record-date">
                                        {new Date(
                                            record.startDate
                                        ).toLocaleString("zh-CN", {
                                            year: "numeric",
                                            month: "2-digit",
                                            day: "2-digit",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </span>
                                </div>
                                <div className="record-content">
                                    <div className="record-title">
                                        {record.title}
                                    </div>
                                    <div className="record-details">
                                        <span className="record-duration">
                                            {formatDuration(
                                                record.totalDuration
                                            )}
                                        </span>
                                        <span className="record-language">
                                            {{
                                                cantonese: "Cantonese",
                                                english: "English",
                                                japanese: "Japanese",
                                                spanish: "Spanish",
                                            }[record.language] || "Unknown"}
                                        </span>
                                    </div>
                                    {record.channelName && (
                                        <div className="record-channel">
                                            {record.channelLogo && (
                                                <img
                                                    src={record.channelLogo}
                                                    alt="logo"
                                                    className="channel-logo"
                                                />
                                            )}
                                            <span>{record.channelName}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="record-actions">
                                    <button
                                        onClick={() => editRecord(record)}
                                        disabled={record.isMerged}
                                        title={
                                            record.isMerged
                                                ? "Disable merge view to edit individual segments"
                                                : ""
                                        }
                                        className="edit-btn"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        onClick={() =>
                                            deleteRecordGroup(
                                                record.mergedSessionIds
                                            )
                                        }
                                        className="delete-btn"
                                    >
                                        {record.isMerged ? "Delete All Segments" : "Delete"}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default History;
