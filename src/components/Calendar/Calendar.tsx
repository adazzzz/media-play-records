import React, { useState, useEffect } from "react";
import { databaseService } from "../../services/database";
import { PlaybackRecord } from "../../types/database";
import "./Calendar.css";

interface CalendarProps {
    languageFilter: string;
    goalInputs: Record<string, number>;
}

interface CalendarDay {
    date: Date;
    dateStr?: string;
    isCurrentMonth: boolean;
    isToday: boolean;
    duration?: Record<string, number>;
    isPlaceholder?: boolean;
}

const LANG_COLORS: Record<string, string> = {
    cantonese: "#f97316",
    english: "#2563eb",
    japanese: "#16a34a",
    spanish: "#dc2626",
};

const Calendar: React.FC<CalendarProps> = ({ languageFilter, goalInputs }) => {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [dailyDurations, setDailyDurations] = useState<
        Map<string, Record<string, number>>
    >(new Map());

    useEffect(() => {
        updateDailyDurations();
    }, [languageFilter, goalInputs]);

    // Update daily duration data
    const updateDailyDurations = async () => {
        try {
            const allRecords = await databaseService.getAllRecords();
            const durations = new Map<string, Record<string, number>>();

            allRecords.forEach((record) => {
                const date = new Date(record.date);
                const dateStr = `${date.getFullYear()}-${String(
                    date.getMonth() + 1
                ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

                let dayRecord = durations.get(dateStr) || {
                    cantonese: 0,
                    english: 0,
                    japanese: 0,
                    spanish: 0,
                };

                dayRecord[record.language] =
                    (dayRecord[record.language] || 0) + record.duration;
                durations.set(dateStr, dayRecord);
            });

            setDailyDurations(durations);
        } catch (error) {
            console.error("Error updating daily durations:", error);
        }
    };

    // Generate calendar data
    const generateCalendarDays = (): CalendarDay[] => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const firstDayWeekday = firstDay.getDay();
        const daysInMonth = lastDay.getDate();

        const days: CalendarDay[] = [];

        // Add empty placeholders to align first weekday
        for (let i = 0; i < firstDayWeekday; i++) {
            days.push({
                date: new Date(),
                isCurrentMonth: false,
                isToday: false,
                isPlaceholder: true,
            });
        }

        // Add current month's dates
        for (let i = 1; i <= daysInMonth; i++) {
            const date = new Date(year, month, i);
            const dateStr = `${year}-${String(month + 1).padStart(
                2,
                "0"
            )}-${String(i).padStart(2, "0")}`;
            const today = new Date();
            const isToday = date.toDateString() === today.toDateString();

            days.push({
                date,
                dateStr,
                isCurrentMonth: true,
                isToday,
                duration: dailyDurations.get(dateStr),
            });
        }

        return days;
    };

    // Change month
    const changeMonth = (direction: "prev" | "next") => {
        setCurrentMonth((prev) => {
            const newMonth = new Date(prev);
            if (direction === "prev") {
                newMonth.setMonth(newMonth.getMonth() - 1);
            } else {
                newMonth.setMonth(newMonth.getMonth() + 1);
            }
            return newMonth;
        });
    };

    return (
        <div className="calendar-view">
            <h3>Calendar</h3>
            <div className="calendar-header">
                <button
                    onClick={() => changeMonth("prev")}
                    className="calendar-nav-btn"
                >
                    &lt;
                </button>
                <h4>
                    {currentMonth.getFullYear()}/{currentMonth.getMonth() + 1}
                </h4>
                <button
                    onClick={() => changeMonth("next")}
                    className="calendar-nav-btn"
                >
                    &gt;
                </button>
            </div>
            <div className="calendar-grid">
                <div className="calendar-weekdays">
                    <div>Sun</div>
                    <div>Mon</div>
                    <div>Tue</div>
                    <div>Wed</div>
                    <div>Thu</div>
                    <div>Fri</div>
                    <div>Sat</div>
                </div>
                <div className="calendar-days">
                    {generateCalendarDays().map((day, index) => (
                        <div
                            key={index}
                            className={`calendar-day ${
                                day.isPlaceholder ? "placeholder" : ""
                            } ${day.isToday ? "today" : ""}`}
                        >
                            {!day.isPlaceholder && (
                                <>
                                    <span className="day-number">
                                        {day.date.getDate()}
                                    </span>
                                    {day.isCurrentMonth && day.duration && (
                                        <div className="day-duration">
                                            {(languageFilter === "all"
                                                ? Object.entries(day.duration)
                                                : [
                                                      [
                                                          languageFilter,
                                                          day.duration[
                                                              languageFilter
                                                          ],
                                                      ],
                                                  ]
                                            ).map(([lang, duration]) => {
                                                const numericDuration =
                                                    typeof duration === "number"
                                                        ? duration
                                                        : 0;
                                                if (numericDuration <= 0) return null;
                                                const goal = goalInputs[lang] || 0;
                                                const achieved =
                                                    goal > 0 &&
                                                    Math.floor(numericDuration / 60) >= goal;
                                                const color = LANG_COLORS[lang] || "#475569";
                                                const bgOpacity = achieved ? 0.7 : 0.35;
                                                const textColor = achieved ? "#ffffff" : "#0f172a";
                                                return (
                                                    <div
                                                        key={lang}
                                                        className="lang-duration"
                                                        style={{
                                                            backgroundColor: color,
                                                            opacity: bgOpacity,
                                                            color: textColor,
                                                        }}
                                                    >
                                                        {Math.floor(numericDuration / 60)}m
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Calendar;
