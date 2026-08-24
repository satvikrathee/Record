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
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [modalNames, setModalNames] = useState({});
    const [activeTab, setActiveTab] = useState('log'); // 'log', 'history', or 'cows'

    // Sidebar State
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    // Cow Section Specific States
    const [selectedCowId, setSelectedCowId] = useState('');
    const [cowNotes, setCowNotes] = useState('');
    const [cowNotesStatus, setCowNotesStatus] = useState('Saved');
    const [newCowName, setNewCowName] = useState('');
    const [isAddingCow, setIsAddingCow] = useState(false);
    const [selectedRenameId, setSelectedRenameId] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const pendingCowNotesRef = useRef({ cowId: '', val: '', timeoutId: null });

    // Edit Modal State
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editDate, setEditDate] = useState('');
    const [editMorningQty, setEditMorningQty] = useState('');
    const [editEveningQty, setEditEveningQty] = useState('');

    // Expenditure States
    const [expenditures, setExpenditures] = useState([]);
    const [expTitle, setExpTitle] = useState('');
    const [expAmount, setExpAmount] = useState('');
    const [expDate, setExpDate] = useState(todayStr);
    const [isExpModalOpen, setIsExpModalOpen] = useState(false);

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

    // Fetch data whenever selectedMonth changes
    useEffect(() => {
        fetchMonthData();

        // Auto re-fetch whenever the user returns to this browser tab
        const handleFocus = () => {
            fetchMonthData();
        };

        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [selectedMonth]);

    // Fetch cow notes when active cow or selected month changes
    useEffect(() => {
        if (selectedCowId) {
            fetchCowNotes(selectedCowId);
        }
    }, [selectedCowId, selectedMonth]);

    // Fetch all cow notes when selectedMonth or persons change
    useEffect(() => {
        fetchAllCowNotes();
    }, [selectedMonth, persons]);

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
                if (data.length > 0 && !selectedCowId) {
                    setSelectedCowId(data[0].personId);
                }
            }
        } catch (err) {
            console.error('Error fetching persons list:', err);
        }
    };

    const [allCowNotes, setAllCowNotes] = useState({});

    const fetchAllCowNotes = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/month-configs-all/${selectedMonth}`);
            if (res.ok) {
                const data = await res.json();
                const notesMap = {};
                data.forEach(c => {
                    notesMap[c.personId] = c.notes;
                });
                setAllCowNotes(notesMap);
            }
        } catch (err) {
            console.error('Error fetching all cow notes:', err);
        }
    };

    const fetchCowNotes = async (cowId) => {
        if (!cowId) return;
        try {
            const res = await fetch(`${API_BASE}/api/month-config/${selectedMonth}?personId=${cowId}`);
            const data = await res.json();
            setCowNotes(data.notes || '');
            setCowNotesStatus('Saved');
        } catch (err) {
            console.error('Error loading cow notes:', err);
        }
    };

    const saveCowNotes = async (cowId, val) => {
        if (!cowId) return;
        try {
            setCowNotesStatus('Saving...');
            await fetch(`${API_BASE}/api/month-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    month: selectedMonth,
                    notes: val,
                    personId: cowId
                })
            });
            setCowNotesStatus('Saved');
            await fetchAllCowNotes();
        } catch (err) {
            console.error('Error saving cow notes:', err);
            setCowNotesStatus('Error saving');
        }
    };

    const handleCowNotesChange = (val) => {
        setCowNotes(val);
        setCowNotesStatus('Unsaved changes');
    };

    const handleCowSelect = async (cowId) => {
        if (cowId === selectedCowId) return;
        setSelectedCowId(cowId);
    };

    const handleAddCowSubmit = async (e) => {
        e.preventDefault();
        if (!newCowName.trim()) return;
        setIsAddingCow(true);
        try {
            const res = await fetch(`${API_BASE}/api/persons`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newCowName.trim() })
            });
            if (res.ok) {
                const newCow = await res.json();
                setNewCowName('');
                await fetchPersons();
                setSelectedCowId(newCow.personId);
            }
        } catch (err) {
            console.error('Error adding new cow:', err);
        } finally {
            setIsAddingCow(false);
        }
    };

    const handleRenameSave = async (cowId) => {
        if (!renameValue.trim()) {
            setSelectedRenameId(null);
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/persons/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personId: cowId, name: renameValue.trim() })
            });
            if (res.ok) {
                setPersons(prev => prev.map(p => p.personId === cowId ? { ...p, name: renameValue.trim() } : p));
                setSelectedRenameId(null);
            }
        } catch (err) {
            console.error('Error renaming cow:', err);
        }
    };

    const handleDeleteCow = async (cowId, cowName) => {
        if (window.confirm(`Kya aap cow "${cowName}" ko delete karna chahte hain? Isse unke sabhi purane notes aur records bhi delete ho jayenge.`)) {
            try {
                const res = await fetch(`${API_BASE}/api/persons/${cowId}`, {
                    method: 'DELETE'
                });
                if (res.ok) {
                    await fetchPersons();
                    if (selectedCowId === cowId) {
                        setSelectedCowId('');
                        setCowNotes('');
                    }
                }
            } catch (err) {
                console.error('Error deleting cow:', err);
            }
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
            const entriesRes = await fetch(`${API_BASE}/api/entries/${selectedMonth}?personId=household`);
            const entriesData = await entriesRes.json();
            if (Array.isArray(entriesData)) {
                setEntries(entriesData);
            }

            // 2. Fetch rate & notes configuration
            const configRes = await fetch(`${API_BASE}/api/month-config/${selectedMonth}?personId=household`);
            const configData = await configRes.json();
            setMonthlyRate(configData.rate > 0 ? configData.rate : '');
            setMonthlyNotes(configData.notes || '');

            // Fetch expenditures
            await fetchExpenditures();
        } catch (err) {
            console.error('Error fetching data from server:', err);
        }
    };

    const fetchExpenditures = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/expenditures/${selectedMonth}`);
            if (res.ok) {
                const data = await res.json();
                setExpenditures(data);
            }
        } catch (err) {
            console.error('Error fetching expenditures:', err);
        }
    };

    const handleAddExpenditure = async (e) => {
        e.preventDefault();
        if (!expTitle.trim() || !expAmount) return;
        try {
            const res = await fetch(`${API_BASE}/api/expenditures`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    month: selectedMonth,
                    title: expTitle.trim(),
                    amount: parseFloat(expAmount),
                    date: expDate
                })
            });
            if (res.ok) {
                setExpTitle('');
                setExpAmount('');
                setExpDate(todayStr);
                setIsExpModalOpen(false);
                await fetchExpenditures();
            }
        } catch (err) {
            console.error('Error adding expenditure:', err);
        }
    };

    const handleDeleteExpenditure = async (id) => {
        if (window.confirm('Kya aap is expenditure ko delete karna chahte hain?')) {
            try {
                const res = await fetch(`${API_BASE}/api/expenditures/${id}`, {
                    method: 'DELETE'
                });
                if (res.ok) {
                    await fetchExpenditures();
                }
            } catch (err) {
                console.error('Error deleting expenditure:', err);
            }
        }
    };

    const handleCowImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Compress image client side
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxDim = 300;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxDim) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    }
                } else {
                    if (height > maxDim) {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Compress and convert to Base64 data URL
                const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                uploadCowImage(selectedCowId, dataUrl);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    const uploadCowImage = async (cowId, dataUrl) => {
        try {
            setCowNotesStatus('Saving Image...');
            const res = await fetch(`${API_BASE}/api/persons/image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personId: cowId, image: dataUrl })
            });
            if (res.ok) {
                setCowNotesStatus('Image Saved');
                // Refresh persons list to reflect new image thumbnail
                await fetchPersons();
            } else {
                setCowNotesStatus('Image Error');
            }
        } catch (err) {
            console.error('Error uploading cow image:', err);
            setCowNotesStatus('Image Error');
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
                    personId: 'household'
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
                    personId: 'household'
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
                        personId: 'household'
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
                await fetch(`${API_BASE}/api/entries/${date}?personId=household`, { method: 'DELETE' });
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
                    personId: 'household'
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
        window.open(`${API_BASE}/api/export/${selectedMonth}?personId=household`, '_blank');
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

            <div className="app-layout">
                {/* Mobile Header Bar */}
                <div className="mobile-header">
                    <button className="menu-toggle-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                        ☰
                    </button>
                    <span className="mobile-app-title">Satvik Dairy Track</span>
                    <div className="mobile-header-spacer"></div>
                </div>

                {/* Sidebar Drawer */}
                <aside className={`app-sidebar ${isSidebarOpen ? 'open' : ''}`}>
                    <div className="sidebar-header">
                        <div className="logo-icon">💧</div>
                        <div>
                            <h2>Satvik Dairy Track</h2>
                            <p className="subtitle">Daily Milk Tracker</p>
                        </div>
                        <button className="close-sidebar-btn" onClick={() => setIsSidebarOpen(false)}>&times;</button>
                    </div>

                    {/* Navigation Tab Selector */}
                    <nav className="sidebar-nav">
                        <button 
                            className={`nav-item ${activeTab === 'log' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('log');
                                setIsSidebarOpen(false);
                            }}
                        >
                            ✍️ Log &amp; Summary
                        </button>
                        <button 
                            className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('history');
                                setIsSidebarOpen(false);
                            }}
                        >
                            📅 Daily Logs ({entries.length})
                        </button>
                        <button 
                            className={`nav-item ${activeTab === 'expenditures' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('expenditures');
                                setIsSidebarOpen(false);
                            }}
                        >
                            💰 Expenditures
                        </button>
                        <button 
                            className={`nav-item ${activeTab === 'cows' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('cows');
                                setIsSidebarOpen(false);
                            }}
                        >
                            🐄 Cows Section
                        </button>
                    </nav>

                    <div className="sidebar-divider"></div>

                    {/* Quick Tools */}
                    <div className="sidebar-section">
                        <span className="sidebar-section-title">Quick Actions</span>
                        
                        <button onClick={handleDownloadCSV} className="sidebar-link-btn" title="Download Report">
                            📥 Download Report
                        </button>

                        {/* Alerts Status */}
                        {notificationPermission === 'default' && (
                            <button onClick={handleEnableBrowserNotifications} className="sidebar-link-btn" title="Enable Alerts">
                                🔔 Enable Alerts
                            </button>
                        )}
                        {notificationPermission === 'granted' && (
                            <div className="sidebar-status-badge active" title="Reminders active">
                                🔔 Alerts: Active
                            </div>
                        )}
                        {notificationPermission === 'denied' && (
                            <div className="sidebar-status-badge blocked" title="Notifications blocked">
                                🔕 Alerts: Blocked
                            </div>
                        )}

                        {/* PWA Install Button */}
                        {deferredPrompt && (
                            <button onClick={handleInstallApp} className="sidebar-link-btn primary" title="Install App">
                                📱 Install Mobile App
                            </button>
                        )}
                    </div>

                    <div className="sidebar-footer">
                        <p>© 2026 Satvik Dairy Track</p>
                        <p className="made-by">Made by Satvik Rathee</p>
                    </div>
                </aside>

                {/* Sidebar Backdrop Overlay on Mobile */}
                {isSidebarOpen && <div className="sidebar-overlay-backdrop" onClick={() => setIsSidebarOpen(false)}></div>}

                {/* Main Content Area */}
                <div className="app-main-content">
                    <header className="app-header-bar">
                        {/* Month Picker dropdown in top right */}
                        <div className="month-picker-container">
                            <span className="calendar-icon">📅</span>
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
                    </header>

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

                    {/* Expenditures Manager Panel */}
                    <section className={`left-panel ${activeTab === 'expenditures' ? '' : 'hidden-panel'}`} style={{ maxWidth: '100%' }}>
                        <div className="summary-section">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                                <h2 className="section-title" style={{ margin: 0 }}>💰 Monthly Income &amp; Expenditures</h2>
                                <button 
                                    onClick={() => {
                                        setExpTitle('');
                                        setExpAmount('');
                                        setExpDate(todayStr);
                                        setIsExpModalOpen(true);
                                    }} 
                                    className="btn btn-primary"
                                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '12px', fontWeight: '600' }}
                                >
                                    ➕ Add Expenditure
                                </button>
                            </div>
                            
                            {/* Summary Metrics Row */}
                            <div className="summary-cards" style={{ marginBottom: '30px' }}>
                                {/* Income Card */}
                                <div className="card summary-card milk-card">
                                    <div className="card-header">
                                        <span>Total Income (Main Home)</span>
                                        <div className="card-icon blue-icon">💰</div>
                                    </div>
                                    <div className="card-body">
                                        <span className="currency-symbol">₹</span>
                                        <span className="metric-value">{Math.round(totalAmount).toLocaleString('en-IN')}</span>
                                    </div>
                                </div>

                                {/* Total Expenditures Card */}
                                <div className="card summary-card rate-card">
                                    <div className="card-header">
                                        <span>Total Expenditures</span>
                                        <div className="card-icon red-icon" style={{ color: '#e74c3c' }}>📉</div>
                                    </div>
                                    <div className="card-body">
                                        <span className="currency-symbol">₹</span>
                                        <span className="metric-value">
                                            {Math.round(expenditures.reduce((sum, e) => sum + (e.amount || 0), 0)).toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                </div>

                                {/* Net Profit Card */}
                                <div className="card summary-card amount-card">
                                    <div className="card-header">
                                        <span>Net Balance</span>
                                        <div className="card-icon gold-icon">📈</div>
                                    </div>
                                    <div className="card-body">
                                        <span className="currency-symbol">₹</span>
                                        <span className="metric-value">
                                            {Math.round(totalAmount - expenditures.reduce((sum, e) => sum + (e.amount || 0), 0)).toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Expenditures Timeline List */}
                            <div className="card timeline-container" style={{ padding: '24px' }}>
                                <h3 className="card-title" style={{ marginBottom: '16px' }}>Expenditure Records</h3>
                                <div className="timeline-list">
                                    {expenditures.length === 0 ? (
                                        <div className="empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
                                            <div className="empty-state-icon" style={{ fontSize: '2.5rem', marginBottom: '10px' }}>💸</div>
                                            <h3>No expenditures recorded</h3>
                                            <p>Click the "+ Add Expenditure" button above to log feeds, medicine, or other cow care costs.</p>
                                        </div>
                                    ) : (
                                        expenditures.map(exp => (
                                            <div className="log-row" key={exp.id || exp._id} style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
                                                    <strong style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{exp.title}</strong>
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDisplayDate(exp.date)}</span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                    <span style={{ fontSize: '1.1rem', fontWeight: '700', color: '#e74c3c' }}>- ₹{exp.amount}</span>
                                                    <button 
                                                        onClick={() => handleDeleteExpenditure(exp.id || exp._id)} 
                                                        className="action-btn delete-btn" 
                                                        title="Delete Record"
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                                                    >
                                                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="3 6 5 6 21 6"></polyline>
                                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Cows Manager Panel */}
                    <section className={`left-panel ${activeTab === 'cows' ? '' : 'hidden-panel'}`} style={{ maxWidth: '100%' }}>
                        <div className="summary-section">
                            <h2 className="section-title">🐄 Cows Manager &amp; Individual Notes</h2>
                            
                            <div className="cows-container-layout">
                                {/* Left Column: Cow List & Sidebar */}
                                <div className="cows-sidebar-panel">
                                    {/* Add Cow Card */}
                                    <div className="card cow-sidebar-card">
                                        <h3 className="card-title" style={{ fontSize: '1rem', marginBottom: '10px' }}>➕ Add New Cow</h3>
                                        <form onSubmit={handleAddCowSubmit} className="add-cow-sidebar-form">
                                            <input 
                                                type="text" 
                                                placeholder="Cow Name (e.g. Cow 11)" 
                                                value={newCowName}
                                                onChange={(e) => setNewCowName(e.target.value)}
                                                className="form-control add-cow-input-sidebar"
                                                disabled={isAddingCow}
                                            />
                                            <button type="submit" className="btn btn-primary add-cow-btn-sidebar" style={{ padding: '8px 12px', borderRadius: '10px' }} disabled={isAddingCow}>
                                                {isAddingCow ? '...' : 'Add'}
                                            </button>
                                        </form>
                                    </div>

                                    {/* Cows Scroll List */}
                                    <div className="cows-scroll-list">
                                        {persons.map(cow => {
                                            const cowNote = allCowNotes[cow.personId] || '';
                                            const isSelected = selectedCowId === cow.personId;
                                            return (
                                                <div 
                                                    key={cow.personId} 
                                                    className={`cow-list-card ${isSelected ? 'active' : ''}`}
                                                    onClick={() => handleCowSelect(cow.personId)}
                                                >
                                                    <div className="cow-card-header">
                                                        {cow.image ? (
                                                            <img src={cow.image} alt={cow.name} className="cow-card-thumbnail" style={{ width: '30px', height: '30px', borderRadius: '50%', objectFit: 'cover' }} />
                                                        ) : (
                                                            <span className="cow-card-icon">🐄</span>
                                                        )}
                                                        <span className="cow-card-name">{cow.name}</span>
                                                    </div>
                                                    <div className="cow-card-notes-preview">
                                                        {cowNote.trim() ? (
                                                            cowNote
                                                        ) : (
                                                            <span className="no-notes-placeholder">No notes for this month</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Right Column: Cow Editor */}
                                <div className="cow-editor-panel">
                                    {selectedCowId ? (
                                        <div className="card cow-details-editor-card">
                                            <div className="cow-editor-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '16px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                    {/* Cow Profile Photo Avatar */}
                                                    <div 
                                                        className="cow-profile-avatar-wrapper" 
                                                        onClick={() => document.getElementById('cow-photo-upload-input').click()}
                                                        title="Click to Upload Cow Photo"
                                                    >
                                                        {persons.find(p => p.personId === selectedCowId)?.image ? (
                                                            <img src={persons.find(p => p.personId === selectedCowId)?.image} alt="Cow Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        ) : (
                                                            <span style={{ fontSize: '1.8rem' }}>🐄</span>
                                                        )}
                                                        <div className="avatar-hover-overlay">
                                                            <span>📷</span>
                                                        </div>
                                                    </div>
                                                    <input 
                                                        type="file" 
                                                        id="cow-photo-upload-input" 
                                                        style={{ display: 'none' }} 
                                                        accept="image/*"
                                                        onChange={handleCowImageUpload}
                                                    />
                                                    
                                                    <div className="cow-editor-title-group">
                                                        <h2 className="cow-editor-title">🐄 {persons.find(p => p.personId === selectedCowId)?.name}</h2>
                                                        <p className="cow-editor-subtitle">ID: {selectedCowId} | Month: {selectedMonth}</p>
                                                    </div>
                                                </div>
                                                
                                                <div className="cow-editor-actions">
                                                    {selectedRenameId === selectedCowId ? (
                                                        <div className="inline-rename-container">
                                                            <input 
                                                                type="text"
                                                                value={renameValue}
                                                                onChange={(e) => setRenameValue(e.target.value)}
                                                                className="form-control rename-input-inline"
                                                                placeholder="Enter Name"
                                                                autoFocus
                                                            />
                                                            <button onClick={() => handleRenameSave(selectedCowId)} className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.85rem', borderRadius: '8px', marginRight: '4px' }}>Save</button>
                                                            <button onClick={() => setSelectedRenameId(null)} className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.85rem', borderRadius: '8px' }}>Cancel</button>
                                                        </div>
                                                    ) : (
                                                        <div className="action-buttons-group">
                                                            <button 
                                                                onClick={() => {
                                                                    setSelectedRenameId(selectedCowId);
                                                                    setRenameValue(persons.find(p => p.personId === selectedCowId)?.name || '');
                                                                }} 
                                                                className="btn btn-outline"
                                                                style={{ padding: '6px 12px', fontSize: '0.85rem', borderRadius: '8px', marginRight: '4px' }}
                                                            >
                                                                ✏️ Rename
                                                            </button>
                                                            <button 
                                                                onClick={() => handleDeleteCow(selectedCowId, persons.find(p => p.personId === selectedCowId)?.name || '')} 
                                                                className="btn-danger"
                                                                style={{ padding: '6px 12px', fontSize: '0.85rem', borderRadius: '8px' }}
                                                            >
                                                                🗑️ Delete
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <hr className="editor-divider" style={{ border: 'none', borderBottom: '1px solid var(--border)', margin: '16px 0' }} />

                                            <div className="cow-notes-editor-section">
                                                <div className="notes-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                    <label className="field-label" style={{ margin: 0 }}>📝 Notes</label>
                                                    <div className="notes-status-badge" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
                                                        <span className={`status-dot ${cowNotesStatus === 'Saved' ? 'saved' : cowNotesStatus === 'Saving...' ? 'saving' : cowNotesStatus === 'Saving Image...' ? 'saving' : 'unsaved'}`}></span>
                                                        <span className="status-text">{cowNotesStatus}</span>
                                                    </div>
                                                </div>
                                                <textarea
                                                    className="form-control cow-notes-textarea-small"
                                                    placeholder={`Write details for ${persons.find(p => p.personId === selectedCowId)?.name || 'this cow'} in ${selectedMonth}...`}
                                                    value={cowNotes}
                                                    onChange={(e) => handleCowNotesChange(e.target.value)}
                                                />
                                                <div className="notes-save-action-row" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                                                    <button 
                                                        onClick={() => saveCowNotes(selectedCowId, cowNotes)}
                                                        className="btn btn-primary save-notes-btn"
                                                        style={{ padding: '10px 20px', borderRadius: '12px', fontWeight: '600' }}
                                                    >
                                                        💾 Save Notes
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="card select-cow-placeholder-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', minHeight: '300px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                            <div className="placeholder-icon" style={{ fontSize: '3rem', marginBottom: '15px' }}>🐄</div>
                                            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '8px', color: 'var(--text-main)' }}>No Cow Selected</h3>
                                            <p style={{ fontSize: '0.9rem', maxWidth: '300px' }}>Select a cow from the left panel to view and manage details &amp; notes.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                </main>

                </div> {/* Closes app-main-content */}
            </div> {/* Closes app-layout */}

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

            {/* Add Expenditure Modal Dialog */}
            <div className={`modal ${isExpModalOpen ? 'open' : ''}`}>
                <div className="modal-content">
                    <div className="modal-header">
                        <h2 className="modal-title">Add Expenditure</h2>
                        <button className="modal-close" onClick={() => setIsExpModalOpen(false)}>&times;</button>
                    </div>
                    <div className="modal-body">
                        <form onSubmit={handleAddExpenditure}>
                            <div className="form-group">
                                <label htmlFor="exp-title" className="form-label">Description / Title</label>
                                <input 
                                    type="text" 
                                    id="exp-title" 
                                    className="form-control" 
                                    placeholder="e.g. Feeds, Medicine, Worker Salary"
                                    value={expTitle}
                                    onChange={(e) => setExpTitle(e.target.value)}
                                    required 
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="exp-amount" className="form-label">Amount (₹)</label>
                                <input 
                                    type="number" 
                                    id="exp-amount" 
                                    className="form-control" 
                                    placeholder="e.g. 1500" 
                                    min="0" 
                                    value={expAmount}
                                    onChange={(e) => setExpAmount(e.target.value)}
                                    required 
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="exp-date" className="form-label">Date</label>
                                <input 
                                    type="date" 
                                    id="exp-date" 
                                    className="form-control" 
                                    value={expDate}
                                    onChange={(e) => setExpDate(e.target.value)}
                                    required 
                                />
                            </div>

                            <div className="modal-footer-actions">
                                <button type="button" className="btn btn-outline" onClick={() => setIsExpModalOpen(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Add Record</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            {/* Manage Cows modal is no longer needed since it's fully managed inline in the tab */}
        </>
    );
}
