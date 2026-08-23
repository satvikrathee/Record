import React, { useState, useEffect, useRef } from 'react';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? ''
    : 'https://record-if3q.onrender.com';

// Date utility functions (local timezone safe)
function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getLocalMonthString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    const options = { day: 'numeric', month: 'short', weekday: 'short' };
    return date.toLocaleDateString('en-IN', options); // e.g. "Sun, 23 Aug"
}

export default function App() {
    const todayStr = getLocalDateString();
    
    // --- State Hooks ---
    const [selectedMonth, setSelectedMonth] = useState(getLocalMonthString());
    const [monthsDropdown, setMonthsDropdown] = useState([]);
    const [entries, setEntries] = useState([]); // [{ _id, date, morning, evening }]
    const [monthlyRate, setMonthlyRate] = useState('');
    const [monthlyNotes, setMonthlyNotes] = useState('');
    
    // Form Inputs
    const [formDate, setFormDate] = useState(todayStr);
    const [formShift, setFormShift] = useState('morning');
    const [formQty, setFormQty] = useState('');
    const [isSavingEntry, setIsSavingEntry] = useState(false);
    
    // Status Indicators
    const [notesStatus, setNotesStatus] = useState('Auto-saved');
    const [rateStatus, setRateStatus] = useState('Auto-saves on change');
    
    // Reminders & Notifications
    const [activeBannerShift, setActiveBannerShift] = useState(null);
    const [bannerText, setBannerText] = useState('');
    const [dismissedReminders, setDismissedReminders] = useState(() => {
        const local = localStorage.getItem('satvik_dairy_track_dismissed_v2');
        return local ? JSON.parse(local) : {};
    });
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [notificationPermission, setNotificationPermission] = useState('default');

    // Multi-Person States
    const [persons, setPersons] = useState([]);
    const [activePersonId, setActivePersonId] = useState('1');
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [modalNames, setModalNames] = useState({});
    const [activeTab, setActiveTab] = useState('log'); // 'log' or 'history'

    // Edit Modal State
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editDate, setEditDate] = useState('');
    const [editMorningQty, setEditMorningQty] = useState('');
    const [editEveningQty, setEditEveningQty] = useState('');

    // Refs for debouncing notes auto-save
    const notesTimeoutRef = useRef(null);

    // --- Initialization & Month Dropdown Setup ---
    useEffect(() => {
        const now = new Date();
        const list = [];
        for (let i = -12; i <= 2; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const val = getLocalMonthString(d);
            const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            list.push({ val, label });
        }
        setMonthsDropdown(list);
        
        // Push notification permission check
        checkBrowserNotificationPermission();

        // Fetch persons list
        fetchPersons();

        // Listen for PWA installation prompt
        const savePrompt = (e) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };
        window.addEventListener('beforeinstallprompt', savePrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', savePrompt);
        };
    }, []);

    // Save dismissed alerts locally
    useEffect(() => {
        localStorage.setItem('satvik_dairy_track_dismissed_v2', JSON.stringify(dismissedReminders));
    }, [dismissedReminders]);

    // Fetch data whenever selectedMonth or activePersonId changes
    useEffect(() => {
        if (activePersonId) {
            fetchMonthData();
        }
    }, [selectedMonth, activePersonId]);

    // Background timer to check reminders every 30 seconds
    useEffect(() => {
        checkReminders();
        const interval = setInterval(checkReminders, 30000);
        return () => clearInterval(interval);
    }, [entries, dismissedReminders]);

    // --- API Calls ---
    const fetchPersons = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/persons`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setPersons(data);
                const namesMap = {};
                data.forEach(p => {
                    namesMap[p.personId] = p.name;
                });
                setModalNames(namesMap);
            }
        } catch (err) {
            console.error('Error fetching persons list:', err);
        }
    };

    const handleSaveAllNames = async (e) => {
        e.preventDefault();
        try {
            for (const [id, name] of Object.entries(modalNames)) {
                const current = persons.find(p => p.personId === id);
                if (current && current.name !== name) {
                    await fetch(`${API_BASE}/api/persons/rename`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ personId: id, name })
                    });
                }
            }
            await fetchPersons();
            setIsManageModalOpen(false);
        } catch (err) {
            console.error('Error saving names:', err);
            alert('Names save karne me error aayi.');
        }
    };

    const fetchMonthData = async () => {
        try {
            // 1. Fetch entries
            const entriesRes = await fetch(`${API_BASE}/api/entries/${selectedMonth}?personId=${activePersonId}`);
            const entriesData = await entriesRes.json();
            if (Array.isArray(entriesData)) {
                setEntries(entriesData);
            }

            // 2. Fetch rate & notes configuration
            const configRes = await fetch(`${API_BASE}/api/month-config/${selectedMonth}?personId=${activePersonId}`);
            const configData = await configRes.json();
            setMonthlyRate(configData.rate > 0 ? configData.rate : '');
            setMonthlyNotes(configData.notes || '');
        } catch (err) {
            console.error('Error fetching data from server:', err);
        }
    };

    // --- Form & Action Handlers ---



    // Handle Log entry form submit
    const handleLogEntrySubmit = async (e) => {
        e.preventDefault();
        const qty = parseFloat(formQty);
        if (isNaN(qty) || qty < 0) {
            alert('Please enter a valid quantity.');
            return;
        }

        setIsSavingEntry(true);
        try {
            const res = await fetch(`${API_BASE}/api/entries`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: formDate,
                    shift: formShift,
                    quantity: qty,
                    personId: activePersonId
                })
            });
            const data = await res.json();
            
            // If data is saved successfully, fetch latest month data
            if (res.ok) {
                setFormQty('');
                await fetchMonthData();
            } else {
                alert(data.error || 'Failed to save record.');
            }
        } catch (err) {
            console.error('Error logging entry:', err);
            alert('Server connects nahi ho paya.');
        } finally {
            setIsSavingEntry(false);
        }
    };

    // Handle inline rate saving on change
    const handleRateChange = async (newRate) => {
        setMonthlyRate(newRate);
        const parsedRate = parseFloat(newRate) || 0;
        setRateStatus('Saving...');
        try {
            await fetch(`${API_BASE}/api/month-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    month: selectedMonth,
                    rate: parsedRate,
                    personId: activePersonId
                })
            });
            setRateStatus('Saved ✓');
            await fetchMonthData();
            setTimeout(() => setRateStatus('Auto-saves on change'), 2000);
        } catch (err) {
            console.error('Error saving rate:', err);
            setRateStatus('Error saving');
        }
    };

    // Handle monthly notes change (debounced auto-save)
    const handleNotesChange = (val) => {
        setMonthlyNotes(val);
        setNotesStatus('Saving...');
        
        if (notesTimeoutRef.current) {
            clearTimeout(notesTimeoutRef.current);
        }

        notesTimeoutRef.current = setTimeout(async () => {
            try {
                await fetch(`${API_BASE}/api/month-config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        month: selectedMonth,
                        notes: val,
                        personId: activePersonId
                    })
                });
                setNotesStatus('Auto-saved');
            } catch (err) {
                console.error('Error auto-saving notes:', err);
                setNotesStatus('Error saving');
            }
        }, 1000);
    };

    // Delete single entry
    const handleDeleteEntry = async (date) => {
        if (window.confirm(`Kya aap ${formatDisplayDate(date)} ka milk record delete karna chahte hain?`)) {
            try {
                await fetch(`${API_BASE}/api/entries/${date}?personId=${activePersonId}`, { method: 'DELETE' });
                await fetchMonthData();
            } catch (err) {
                console.error('Error deleting entry:', err);
            }
        }
    };

    // Open Edit Modal
    const handleOpenEditModal = (dateStr) => {
        const found = entries.find(e => e.date === dateStr) || { morning: 0, evening: 0 };
        setEditDate(dateStr);
        setEditMorningQty(found.morning > 0 ? found.morning.toString() : '');
        setEditEveningQty(found.evening > 0 ? found.evening.toString() : '');
        setEditModalOpen(true);
    };

    // Save edited modal changes
    const handleEditFormSubmit = async (e) => {
        e.preventDefault();
        try {
            await fetch(`${API_BASE}/api/entries/edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: editDate,
                    morning: parseFloat(editMorningQty) || 0,
                    evening: parseFloat(editEveningQty) || 0,
                    personId: activePersonId
                })
            });
            setEditModalOpen(false);
            await fetchMonthData();
        } catch (err) {
            console.error('Error saving edited shifts:', err);
        }
    };

    // --- CSV Download Handler ---
    const handleDownloadCSV = () => {
        // Simple download action: open the browser endpoint in a new tab/window
        window.open(`${API_BASE}/api/export/${selectedMonth}?personId=${activePersonId}`, '_blank');
    };

    // --- Notifications & Reminders Engine ---

    const checkBrowserNotificationPermission = () => {
        if ('Notification' in window) {
            setNotificationPermission(Notification.permission);
        } else {
            setNotificationPermission('unsupported');
        }
    };

    const handleEnableBrowserNotifications = () => {
        if ('Notification' in window) {
            Notification.requestPermission().then(permission => {
                setNotificationPermission(permission);
                if (permission === 'granted') {
                    try {
                        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                            navigator.serviceWorker.ready.then(registration => {
                                registration.showNotification('Satvik Dairy Track', {
                                    body: 'Shukriya! Notifications enable ho chuke hain.',
                                    icon: '/favicon.svg'
                                });
                            }).catch(() => {
                                new Notification('Satvik Dairy Track', {
                                    body: 'Shukriya! Notifications enable ho chuke hain.'
                                });
                            });
                        } else {
                            new Notification('Satvik Dairy Track', {
                                body: 'Shukriya! Notifications enable ho chuke hain.'
                            });
                        }
                    } catch (e) {
                        console.warn('Native notification failed, using backup:', e);
                    }
                }
            });
        }
    };

    const handleInstallApp = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User PWA installation outcome: ${outcome}`);
        setDeferredPrompt(null);
    };

    const checkReminders = () => {
        const now = new Date();
        const localDateStr = getLocalDateString(now);
        const currentHour = now.getHours();

        // Retrieve today's entry from state list
        const todayEntry = entries.find(e => e.date === localDateStr) || { morning: 0, evening: 0 };
        const dismissed = dismissedReminders[localDateStr] || { morning: false, evening: false };

        // 1. Morning check (after 11:00 AM)
        if (currentHour >= 11) {
            const hasMorning = todayEntry.morning > 0;
            if (!hasMorning && !dismissed.morning) {
                triggerNotificationBanner('morning', 'Aapne aaj ka Morning milk record fill nahi kiya hai!');
                return;
            }
        }

        // 2. Evening check (after 9:00 PM / 21:00)
        if (currentHour >= 21) {
            const hasEvening = todayEntry.evening > 0;
            if (!hasEvening && !dismissed.evening) {
                triggerNotificationBanner('evening', 'Aapne aaj ka Evening milk record fill nahi kiya hai!');
                return;
            }
        }

        // Auto-dismiss banner if entries are now logged
        if (activeBannerShift) {
            const isFilled = (activeBannerShift === 'morning' && todayEntry.morning > 0) ||
                             (activeBannerShift === 'evening' && todayEntry.evening > 0);
            if (isFilled) {
                setActiveBannerShift(null);
            }
        }
    };

    const triggerNotificationBanner = (shift, msg) => {
        setActiveBannerShift(shift);
        setBannerText(msg);

        // Push desktop notification if possible
        if (Notification.permission === 'granted') {
            try {
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.ready.then(registration => {
                        registration.showNotification('Satvik Dairy Track Reminder', {
                            body: msg,
                            icon: '/favicon.svg'
                        });
                    }).catch(() => {
                        new Notification('Satvik Dairy Track Reminder', {
                            body: msg
                        });
                    });
                } else {
                    new Notification('Satvik Dairy Track Reminder', {
                        body: msg
                    });
                }
            } catch (e) {
                console.warn('Native notification failed:', e);
            }
        }
    };

    const handleDismissBanner = () => {
        if (activeBannerShift) {
            setDismissedReminders(prev => ({
                ...prev,
                [todayStr]: {
                    ...prev[todayStr],
                    [activeBannerShift]: true
                }
            }));
            setActiveBannerShift(null);
        }
    };

    // --- Mathematics / Calculations ---
    const totalLitres = entries.reduce((sum, e) => {
        return sum + ((e.morning || 0) + (e.evening || 0));
    }, 0);

    const rateNumeric = parseFloat(monthlyRate) || 0;
    const totalAmount = totalLitres * rateNumeric;
    const totalDaysCount = entries.filter(e => (e.morning > 0 || e.evening > 0)).length;

    // Sort entries descending (newest dates at top)
    const sortedEntries = [...entries].sort((a, b) => b.date.localeCompare(a.date));

    return (
        <>
            {/* Top notification reminder banner */}
            <div id="notification-banner" className={`notification-banner ${activeBannerShift ? '' : 'hidden'}`}>
                <div className="banner-content">
                    <span className="banner-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                        </svg>
                    </span>
                    <span id="banner-text">{bannerText}</span>
                </div>
                <button onClick={handleDismissBanner} className="banner-close-btn">&times;</button>
            </div>

            <div className="app-container">
                {/* Header */}
                <header className="app-header">
                    <div className="logo-area">
                        <div className="logo-icon">
                            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22a7 7 0 0 0 7-7c0-4.3-7-13-7-13S5 11 5 15a7 7 0 0 0 7 7z" />
                            </svg>
                        </div>
                        <div>
                            <h1>Satvik Dairy Track</h1>
                            <p className="subtitle">Daily Milk Tracker</p>
                        </div>
                    </div>
                                       <div className="header-controls">
                        {/* Install App PWA Trigger */}
                        {deferredPrompt && (
                            <button onClick={handleInstallApp} className="btn btn-secondary btn-sm" title="Install Mobile App">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                Install App
                            </button>
                        )}

                        {/* Alerts Status Badge/Toggler */}
                        {notificationPermission === 'default' && (
                            <button onClick={handleEnableBrowserNotifications} className="btn btn-secondary btn-sm" title="Enable Daily Reminders (11:00 AM & 9:00 PM)">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path>
                                </svg>
                                Enable Alerts
                            </button>
                        )}
                        {notificationPermission === 'granted' && (
                            <span className="btn btn-sm btn-outline active" style={{ cursor: 'default' }} title="Daily reminders will alert you if entries are missing">
                                🔔 Alerts: Active
                            </span>
                        )}
                        {notificationPermission === 'denied' && (
                            <span className="btn btn-sm btn-outline" style={{ cursor: 'default', color: '#e74c3c', borderColor: 'rgba(231, 76, 60, 0.2)' }} title="Notifications blocked. Reset permission in browser settings.">
                                🔕 Alerts: Blocked
                            </span>
                        )}

                        {/* Person Selection Dropdown */}
                        <div className="month-selector-wrapper">
                            <select 
                                value={activePersonId} 
                                onChange={(e) => setActivePersonId(e.target.value)} 
                                className="month-select person-select"
                                title="Select a family member's record"
                            >
                                {persons.map(p => (
                                    <option key={p.personId} value={p.personId}>{p.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Manage Names Button */}
                        <button onClick={() => setIsManageModalOpen(true)} className="btn btn-export btn-sm" title="Manage names of all 10 profiles">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            Manage Names
                        </button>

                        {/* Excel Export Button */}
                        <button onClick={handleDownloadCSV} className="btn btn-export btn-sm" title="Download Monthly CSV Report">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            Download Report
                        </button>

                        {/* Month dropdown */}
                        <div className="month-selector-wrapper">
                            <select 
                                value={selectedMonth} 
                                onChange={(e) => setSelectedMonth(e.target.value)} 
                                className="month-select"
                            >
                                {monthsDropdown.map(m => (
                                    <option key={m.val} value={m.val}>{m.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </header>

                {/* Tab Navigation selectors */}
                <div className="tab-navigation">
                    <button 
                        className={`tab-btn ${activeTab === 'log' ? 'active' : ''}`}
                        onClick={() => setActiveTab('log')}
                    >
                        ✍️ Log &amp; Summary
                    </button>
                    <button 
                        className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
                        onClick={() => setActiveTab('history')}
                    >
                        📅 Daily Logs ({entries.length})
                    </button>
                </div>

                <main className="app-grid single-column">
                    {/* Left Panel */}
                    <section className={`left-panel ${activeTab === 'log' ? '' : 'hidden-panel'}`}>
                        
                        {/* Month Summary metrics */}
                        <div className="summary-section">
                            <h2 className="section-title">Month Summary</h2>
                            <div className="summary-cards">
                                
                                {/* Total Litres */}
                                <div className="card summary-card milk-card">
                                    <div className="card-header">
                                        <span>Total Quantity</span>
                                        <div className="card-icon blue-icon">
                                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M12 22a7 7 0 0 0 7-7c0-4.3-7-13-7-13S5 11 5 15a7 7 0 0 0 7 7z" />
                                            </svg>
                                        </div>
                                    </div>
                                    <div className="card-body">
                                        <span className="metric-value">{totalLitres.toFixed(1)}</span>
                                        <span className="metric-unit">Litres</span>
                                    </div>
                                </div>

                                {/* Monthly Rate */}
                                <div className="card summary-card rate-card">
                                    <div className="card-header">
                                        <span>Monthly Rate</span>
                                        <div className="card-icon green-icon">
                                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="12" y1="1" x2="12" y2="23"></line>
                                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                            </svg>
                                        </div>
                                    </div>
                                    <div className="card-body editable-rate">
                                        <span className="currency-symbol">₹</span>
                                        <input 
                                            type="number" 
                                            value={monthlyRate} 
                                            onChange={(e) => handleRateChange(e.target.value)}
                                            className="rate-input" 
                                            placeholder="0" 
                                            min="0" 
                                            step="0.5"
                                        />
                                        <span className="metric-unit">/ Litre</span>
                                    </div>
                                    <div className="card-footer">
                                        <span className="status-msg">{rateStatus}</span>
                                    </div>
                                </div>

                                {/* Total Amount */}
                                <div className="card summary-card amount-card">
                                    <div className="card-header">
                                        <span>Total Amount</span>
                                        <div className="card-icon gold-icon">
                                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                                                <circle cx="12" cy="12" r="10"></circle>
                                                <line x1="12" y1="8" x2="12" y2="16"></line>
                                                <line x1="8" y1="12" x2="16" y2="12"></line>
                                            </svg>
                                        </div>
                                    </div>
                                    <div className="card-body">
                                        <span className="currency-symbol">₹</span>
                                        <span className="metric-value">{Math.round(totalAmount).toLocaleString('en-IN')}</span>
                                    </div>
                                </div>

                            </div>
                        </div>

                        {/* Add Daily Entry Form */}
                        <div className="card entry-card">
                            <h2 className="card-title">Log Daily Entry</h2>
                            <p className="card-subtitle">
                                {formDate === todayStr ? 'Today: ' : 'Selected: '} 
                                <strong>{formatDisplayDate(formDate)}</strong>
                            </p>
                            
                            <form onSubmit={handleLogEntrySubmit}>
                                {/* Date */}
                                <div className="form-group">
                                    <label htmlFor="entry-date" className="form-label">Date</label>
                                    <input 
                                        type="date" 
                                        id="entry-date" 
                                        className="form-control" 
                                        value={formDate}
                                        onChange={(e) => setFormDate(e.target.value)}
                                        max={todayStr}
                                        required 
                                    />
                                </div>

                                {/* Shift Radio selection */}
                                <div className="form-group">
                                    <label className="form-label">Shift</label>
                                    <div className="shift-selector">
                                        <input 
                                            type="radio" 
                                            id="shift-morning" 
                                            name="shift" 
                                            value="morning" 
                                            checked={formShift === 'morning'}
                                            onChange={() => setFormShift('morning')}
                                        />
                                        <label htmlFor="shift-morning" className="shift-label morning">
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                                                <circle cx="12" cy="12" r="5"></circle>
                                                <line x1="12" y1="1" x2="12" y2="3"></line>
                                                <line x1="12" y1="21" x2="12" y2="23"></line>
                                                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                                                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                                                <line x1="1" y1="12" x2="3" y2="12"></line>
                                                <line x1="21" y1="12" x2="23" y2="12"></line>
                                            </svg>
                                            Morning
                                        </label>

                                        <input 
                                            type="radio" 
                                            id="shift-evening" 
                                            name="shift" 
                                            value="evening"
                                            checked={formShift === 'evening'}
                                            onChange={() => setFormShift('evening')}
                                        />
                                        <label htmlFor="shift-evening" className="shift-label evening">
                                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                                            </svg>
                                            Evening
                                        </label>
                                    </div>
                                </div>

                                {/* Quantity input */}
                                <div className="form-group">
                                    <label htmlFor="entry-quantity" className="form-label">Quantity (Litres)</label>
                                    <div className="custom-qty-wrapper">
                                        <input 
                                            type="number" 
                                            id="entry-quantity" 
                                            className="form-control qty-input" 
                                            placeholder="Enter quantity (e.g. 1.25)" 
                                            min="0" 
                                            step="0.05" 
                                            value={formQty}
                                            onChange={(e) => setFormQty(e.target.value)}
                                            required 
                                        />
                                        <span className="input-suffix">Litres</span>
                                    </div>
                                </div>

                                <button type="submit" className="btn btn-primary btn-block" disabled={isSavingEntry}>
                                    {isSavingEntry ? 'Saving...' : 'Save Record'}
                                </button>
                            </form>
                        </div>

                        {/* Notes Area */}
                        <div className="card notes-card">
                            <div className="card-header no-border">
                                <h2 className="card-title">Monthly Notes</h2>
                                <span className={`note-save-indicator ${notesStatus === 'Saving...' ? 'saving' : ''}`}>
                                    {notesStatus}
                                </span>
                            </div>
                            <textarea 
                                value={monthlyNotes}
                                onChange={(e) => handleNotesChange(e.target.value)}
                                className="notes-textarea" 
                                placeholder="Is mahine ke extra notes yahan likhein... (e.g., 'is mahine 2 din doodh nahi aaya', 'rate change hua')"
                            />
                        </div>

                    </section>

                    {/* Right Panel / Timelines */}
                    <section className={`right-panel ${activeTab === 'history' ? '' : 'hidden-panel'}`}>
                        <div className="timeline-container">
                            <div className="timeline-header">
                                <h2 className="section-title">Daily Logs</h2>
                                <div className="timeline-meta">
                                    {totalDaysCount} entry ({totalLitres.toFixed(1)} L)
                                </div>
                            </div>

                            <div className="timeline-list">
                                {sortedEntries.length === 0 ? (
                                    <div className="empty-state">
                                        <div className="empty-state-icon">
                                            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                                <line x1="3" y1="10" x2="21" y2="10"></line>
                                            </svg>
                                        </div>
                                        <h3>No records found</h3>
                                        <p>Select another month or log a daily entry on the left to get started!</p>
                                    </div>
                                ) : (
                                    sortedEntries.map(entry => {
                                        const total = (entry.morning || 0) + (entry.evening || 0);
                                        const dateParts = entry.date.split('-');
                                        const dateNum = dateParts[2];
                                        const dObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
                                        const dayOfWeekStr = dObj.toLocaleDateString('en-IN', { weekday: 'short' });

                                        return (
                                            <div className="log-row" key={entry.date}>
                                                <div className="log-date-badge">
                                                    <span className="log-date-num">{dateNum}</span>
                                                    <span className="log-date-day">{dayOfWeekStr}</span>
                                                </div>
                                                
                                                <div className="log-shifts">
                                                    {/* Morning */}
                                                    <div className="shift-qty-badge morning" title="Morning Entry">
                                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                            <circle cx="12" cy="12" r="5"></circle>
                                                            <line x1="12" y1="1" x2="12" y2="3"></line>
                                                            <line x1="12" y1="21" x2="12" y2="23"></line>
                                                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                                                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                                                            <line x1="1" y1="12" x2="3" y2="12"></line>
                                                            <line x1="21" y1="12" x2="23" y2="12"></line>
                                                        </svg>
                                                        <span>Morning: <strong className="qty-val">{entry.morning > 0 ? `${entry.morning} L` : '-'}</strong></span>
                                                    </div>

                                                    {/* Evening */}
                                                    <div className="shift-qty-badge evening" title="Evening Entry">
                                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                                                        </svg>
                                                        <span>Evening: <strong className="qty-val">{entry.evening > 0 ? `${entry.evening} L` : '-'}</strong></span>
                                                    </div>
                                                </div>

                                                <div className="log-day-total">
                                                    <span className="total-label">Day Total</span>
                                                    <span className="total-val">{total.toFixed(1)} L</span>
                                                </div>

                                                {/* Actions */}
                                                <div className="log-actions">
                                                    <button onClick={() => handleOpenEditModal(entry.date)} className="action-btn edit-btn" title="Edit Day Record">
                                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                                            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                                        </svg>
                                                    </button>
                                                    <button onClick={() => handleDeleteEntry(entry.date)} className="action-btn delete-btn" title="Delete Day Record">
                                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="3 6 5 6 21 6"></polyline>
                                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                            <line x1="10" y1="11" x2="10" y2="17"></line>
                                                            <line x1="14" y1="11" x2="14" y2="17"></line>
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </section>
                </main>

                <footer className="app-footer">
                    <p>Satvik Dairy Track &copy; 2026. Made by Satvik Rathee.</p>
                </footer>
            </div>

            {/* Edit Entry Modal Dialog */}
            <div className={`modal ${editModalOpen ? 'open' : ''}`}>
                <div className="modal-content">
                    <div className="modal-header">
                        <h2 className="modal-title">Edit Entry</h2>
                        <button className="modal-close" onClick={() => setEditModalOpen(false)}>&times;</button>
                    </div>
                    <div className="modal-body">
                        <form onSubmit={handleEditFormSubmit}>
                            <p className="edit-modal-date-text">Date: <strong>{formatDisplayDate(editDate)}</strong></p>
                            
                            <div className="form-group">
                                <label htmlFor="edit-morning-quantity" className="form-label">Morning - Litres</label>
                                <input 
                                    type="number" 
                                    id="edit-morning-quantity" 
                                    className="form-control" 
                                    min="0" 
                                    step="0.05" 
                                    placeholder="0.0"
                                    value={editMorningQty}
                                    onChange={(e) => setEditMorningQty(e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="edit-evening-quantity" className="form-label">Evening - Litres</label>
                                <input 
                                    type="number" 
                                    id="edit-evening-quantity" 
                                    className="form-control" 
                                    min="0" 
                                    step="0.05" 
                                    placeholder="0.0"
                                    value={editEveningQty}
                                    onChange={(e) => setEditEveningQty(e.target.value)}
                                />
                            </div>

                            <div className="modal-footer-actions">
                                <button type="button" className="btn btn-outline" onClick={() => setEditModalOpen(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            {/* Manage Family Members Names Modal Dialog */}
            <div className={`modal ${isManageModalOpen ? 'open' : ''}`}>
                <div className="modal-content large">
                    <div className="modal-header">
                        <h2 className="modal-title">Manage Family Members</h2>
                        <button className="modal-close" onClick={() => setIsManageModalOpen(false)}>&times;</button>
                    </div>
                    <div className="modal-body">
                        <form onSubmit={handleSaveAllNames}>
                            <p className="help-text">Aap yahan sabhi 10 persons ke name customize kar sakte hain:</p>
                            <div className="rename-grid">
                                {persons.map(p => (
                                    <div key={p.personId} className="rename-field-row">
                                        <label className="person-number-label">Person {p.personId}</label>
                                        <input 
                                            type="text" 
                                            value={modalNames[p.personId] || ''} 
                                            onChange={(e) => setModalNames({ ...modalNames, [p.personId]: e.target.value })}
                                            className="rename-input"
                                            required
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="modal-footer-actions">
                                <button type="button" className="btn btn-outline" onClick={() => setIsManageModalOpen(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save All Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </>
    );
}
