import React, { useEffect, useMemo, useState } from "react";
import { databaseService } from "../../services/database";
import { DailyGoal, PlaybackRecord, Language } from "../../types/database";
import { formatDuration } from "../../utils/time";
import Calendar from "../Calendar";
import "./History.css";
import { DEFAULT_DAILY_GOAL } from "../../utils/constants";

interface HistoryProps {
    onBack: () => void;
}

const LANGUAGES = [
    { key: "cantonese", label: "Cantonese", color: "#f97316" },
    { key: "english", label: "English", color: "#2563eb" },
    { key: "japanese", label: "Japanese", color: "#16a34a" },
    { key: "spanish", label: "Spanish", color: "#dc2626" },
];

const DEFAULT_LANGUAGE_VISIBILITY = LANGUAGES.reduce(
    (acc, lang) => ({ ...acc, [lang.key]: true }),
    {} as Record<string, boolean>
);

type TimelineSegment = { start: number; end: number };

type DisplayRecord = PlaybackRecord & {
    mergedSessionIds: string[];
    totalDuration: number;
    startDate: string;
    isMerged: boolean;
    spanStart: number;
    spanEnd: number;
    segments: TimelineSegment[];
};

const normalizeVideoUrl = (url?: string) => {
    if (!url) return "";
    try {
        const parsed = new URL(url);
        const params = new URLSearchParams(parsed.search);
        const removableParams = [
            "t",
            "time_continue",
            "start",
            "si",
            "pp",
            "feature",
            "ab_channel",
            "spm_id_from",
            "list",
            "index",
            "vclid",
            "utm_source",
            "utm_medium",
            "utm_campaign",
        ];
        removableParams.forEach((param) => params.delete(param));
        const normalizedSearch = params.toString();
        return `${parsed.origin}${parsed.pathname}${
            normalizedSearch ? `?${normalizedSearch}` : ""
        }`;
    } catch {
        return url;
    }
};

const getVideoKey = (record: PlaybackRecord) => {
    const channelKey = (record.channelName || "").trim().toLowerCase();
    const titleKey = (record.title || "").trim().toLowerCase();
    return `${channelKey}::${titleKey}::${record.language}`;
};

const normalizeVisibility = (
    visibility?: Record<string, boolean>
): Record<Language, boolean> => ({
    cantonese: visibility?.cantonese ?? true,
    english: visibility?.english ?? true,
    japanese: visibility?.japanese ?? true,
    spanish: visibility?.spanish ?? true,
});

const buildDisplayRecords = (
    records: PlaybackRecord[],
    mergeConsecutive: boolean
): DisplayRecord[] => {
    if (!mergeConsecutive) {
        return records.map((record) => {
            const startMs = new Date(record.date).getTime();
            const endMs = startMs + record.duration * 1000;
            return {
                ...record,
                mergedSessionIds: [record.sessionId],
                totalDuration: record.duration,
                startDate: record.date,
                isMerged: false,
                spanStart: startMs,
                spanEnd: endMs,
                segments: [{ start: startMs, end: endMs }],
            };
        });
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
        const startMs = new Date(record.date).getTime();
        const endMs = startMs + record.duration * 1000;

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
                    startMs < new Date(current.startDate).getTime()
                        ? record.date
                        : current.startDate;
                current.mergedSessionIds.push(record.sessionId);
                current.spanStart = Math.min(current.spanStart, startMs);
                current.spanEnd = Math.max(current.spanEnd, endMs);
                current.segments.push({ start: startMs, end: endMs });
                lastMergedDate = record.date;
                if (!current.channelLogo)
                    current.channelLogo = record.channelLogo;
                if (!current.channelName)
                    current.channelName = record.channelName;
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
            spanStart: startMs,
            spanEnd: endMs,
            segments: [{ start: startMs, end: endMs }],
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
    const [selectedMonth] = useState<string>(
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
    const [languageVisibility, setLanguageVisibility] = useState<
        Record<string, boolean>
    >(DEFAULT_LANGUAGE_VISIBILITY);
    const [activeTab, setActiveTab] = useState<"records" | "settings">(
        "records"
    );

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
            const vis = normalizeVisibility(
                dailyGoal.visibility || languageVisibility
            );
            setLanguageVisibility(vis);
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
            const filteredRecords = allRecords.filter((record) => {
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
    const visibleLanguages = LANGUAGES.filter(
        (lang) => languageVisibility[lang.key]
    );
    const languageOptions = [
        { value: "all", label: "All Languages" },
        ...visibleLanguages.map((lang) => ({
            value: lang.key,
            label: lang.label,
        })),
    ];
    const filteredDisplayRecords = displayRecords.filter(
        (record) => languageVisibility[record.language]
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

            if (!data.version || !data.records || !Array.isArray(data.records)) {
                throw new Error("Invalid data format");
            }

            for (const record of data.records) {
                await databaseService.saveRecord(record);
            }

            await loadRecords();
            alert("Data imported successfully");
        } catch (error) {
            console.error("Error importing data:", error);
            alert("Failed to import data, please ensure file format is correct");
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
            duration:
                durationMinutes === originalDurationMinutes
                    ? editingRecord.duration
                    : durationMinutes * 60,
            language: language as any,
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
            const baseVisibility = normalizeVisibility(
                existingDailyGoal?.visibility ?? languageVisibility
            );
            const visibility: Record<Language, boolean> = {
                ...baseVisibility,
                [language as Language]: languageVisibility[language],
            };
            await databaseService.saveDailyGoal({
                date: today,
                goals,
                visibility,
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

    // Toggle language visibility in UI
    const toggleLanguageVisibility = (language: string) => {
        setLanguageVisibility((prev) => {
            const next = { ...prev, [language]: !prev[language] };
            if (!next[language] && languageFilter === language) {
                setLanguageFilter("all");
            }
            // Persist visibility with todays goal snapshot
            const persist = async () => {
                const today = new Date().toISOString().split("T")[0];
                const existingDailyGoal = await databaseService.getDailyGoal(today);
                const goals = existingDailyGoal?.goals || goalInputs;
                const normalizedVisibility = normalizeVisibility(next);
                await databaseService.saveDailyGoal({
                    date: today,
                    goals,
                    visibility: normalizedVisibility,
                    updatedAt: new Date().toISOString(),
                });
            };
            persist();
            return next;
        });
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
                <div className="header-left">
                    <button className="back-button" onClick={onBack}>
                        ← Back
                    </button>
                    <h2>History</h2>
                </div>
                <div className="tab-switch">
                    <button
                        className={activeTab === "records" ? "tab active" : "tab"}
                        onClick={() => setActiveTab("records")}
                    >
                        Records
                    </button>
                    <button
                        className={activeTab === "settings" ? "tab active" : "tab"}
                        onClick={() => setActiveTab("settings")}
                    >
                        Settings
                    </button>
                </div>
            </div>

            {activeTab === "settings" ? (
                <div className="settings-panel">
                    <div className="goals-section">
                        <h3>Learning Goals & Visibility</h3>
                        <div className="goals-container">
                            {LANGUAGES.map((lang) => (
                                <div className="goal-item" key={lang.key}>
                                    <div className="goal-language">
                                        <span
                                            className="language-dot"
                                            style={{ backgroundColor: lang.color }}
                                        />
                                        <span className="language-label">{lang.label}</span>
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={goalInputs[lang.key] || 0}
                                        onChange={(e) =>
                                            handleGoalInputChange(lang.key, e.target.value)
                                        }
                                    />
                                    <label className="visibility-toggle">
                                        <input
                                            type="checkbox"
                                            checked={languageVisibility[lang.key]}
                                            onChange={() => toggleLanguageVisibility(lang.key)}
                                        />
                                        <span>Show</span>
                                    </label>
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
                    </div>
                </div>
            ) : (
                <>
                    <div className="layout-grid">
                        <div className="left-column">
                            <div className="stats-summary">
                                <div className="panel-header">
                                    <h3>Statistics Summary</h3>
                                </div>
                                {visibleLanguages.length === 0 ? (
                                    <div className="no-records">All languages are hidden.</div>
                                ) : (
                                    <div className="stats-grid">
                                        {visibleLanguages.map((lang) => (
                                            <div className="stat-item" key={lang.key}>
                                                <div className="stat-label">
                                                    <span
                                                        className="language-dot"
                                                        style={{ backgroundColor: lang.color }}
                                                    />
                                                    {lang.label}
                                                </div>
                                                <span className="stat-value">
                                                    {formatDuration(
                                                        languageStats[
                                                            lang.key as keyof typeof languageStats
                                                        ] || 0
                                                    )}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <Calendar
                                languageFilter={languageFilter}
                                goalInputs={goalInputs}
                            />
                        </div>

                        <div className="right-column">
                            <div className="records-list">
                                <div className="records-list-header">
                                    <h3>Detailed Records</h3>
                                    <div className="list-header-actions">
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
                                        {selectedRecords.length > 0 && (
                                            <button
                                                onClick={batchDelete}
                                                className="action-btn delete-btn"
                                            >
                                                Batch Delete ({selectedRecords.length})
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="filters compact">
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
                                            {languageOptions.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                {filteredDisplayRecords.length === 0 ? (
                                    <div className="no-records">No records</div>
                                ) : (
                                    <div className="records-grid">
                                        {filteredDisplayRecords.map((record) => {
                                            const languageMeta = LANGUAGES.find(
                                                (lang) => lang.key === record.language
                                            );
                                            const langColor =
                                                languageMeta?.color || "#6b7280";
                                            const orderedSegments = [...record.segments].sort(
                                                (a, b) => a.start - b.start
                                            );
                                            const spanDuration = Math.max(
                                                record.spanEnd - record.spanStart,
                                                1
                                            );
                                            const logoLetter =
                                                (languageMeta?.label || "L").charAt(0);

                                            const isSelected = record.mergedSessionIds.every((id) =>
                                                selectedRecords.includes(id)
                                            );

                                            return (
                                                <div
                                                    key={record.mergedSessionIds.join("|")}
                                                    className={`record-item ${isSelected ? "selected" : ""}`}
                                                    onClick={() =>
                                                        toggleRecordSelection(record.mergedSessionIds)
                                                    }
                                                >
                                                    <div className="record-topline">
                                                        <div className="record-row">
                                                            <div
                                                                className="record-logo-large"
                                                                style={{
                                                                    backgroundColor: `${langColor}1a`,
                                                                    borderColor: `${langColor}33`,
                                                                }}
                                                            >
                                                                {record.channelLogo ? (
                                                                    <img
                                                                        src={record.channelLogo}
                                                                        alt="logo"
                                                                        className="record-logo-img"
                                                                    />
                                                                ) : (
                                                                    <span>{logoLetter}</span>
                                                                )}
                                                            </div>
                                                            <div className="record-main">
                                                                <div className="record-meta">
                                                                    <div className="record-channel-name">
                                                                        <span
                                                                            className="language-dot"
                                                                            style={{
                                                                                backgroundColor: langColor,
                                                                            }}
                                                                        />
                                                                        <span>
                                                                            {record.channelName ||
                                                                                languageMeta?.label ||
                                                                                "Unknown"}
                                                                        </span>
                                                                    </div>
                                                                    <div className="record-duration-strong big">
                                                                        {formatDuration(record.totalDuration)}
                                                                    </div>
                                                                </div>
                                                                <div className="record-title muted">
                                                                    {record.title}
                                                                </div>

                                                                <div className="timeline-wrapper">
                                                                    <div className="timeline-bar thin">
                                                                        <div className="timeline-track subtle" />
                                                                        {orderedSegments.map((segment, index) => {
                                                                            const left =
                                                                                ((segment.start - record.spanStart) /
                                                                                    spanDuration) *
                                                                                100;
                                                                            const width =
                                                                                ((segment.end - segment.start) /
                                                                                    spanDuration) *
                                                                                100;
                                                                            return (
                                                                                <div
                                                                                    key={`${segment.start}-${index}`}
                                                                                    className="timeline-segment soft"
                                                                                    style={{
                                                                                        left: `${left}%`,
                                                                                        width: `${Math.max(width, 1)}%`,
                                                                                        backgroundColor: langColor,
                                                                                        opacity: 0.55,
                                                                                    }}
                                                                                />
                                                                            );
                                                                        })}
                                                                        <div className="timeline-end">
                                                                            {new Date(
                                                                                record.spanEnd
                                                                            ).toLocaleTimeString("zh-CN", {
                                                                                hour: "2-digit",
                                                                                minute: "2-digit",
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <div className="record-secondary">
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
                                                                    <div className="record-actions">
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                editRecord(record);
                                                                            }}
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
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                deleteRecordGroup(
                                                                                    record.mergedSessionIds
                                                                                );
                                                                            }}
                                                                            className="delete-btn"
                                                                        >
                                                                            {record.isMerged
                                                                                ? "Delete All Segments"
                                                                                : "Delete"}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}

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
                                <label htmlFor="entryUrl">URL (optional):</label>
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
        </div>
    );
};

export default History;
