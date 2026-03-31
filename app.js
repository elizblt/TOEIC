// ==================== STATE ====================
let state = {
    currentPage: 'home',
    quiz: null,
    theme: localStorage.getItem('theme') || 'light',
    streak: 0,
    lastActive: null,
    dailyCount: 0,
    dailyGoal: 20,
    history: [],
    wrongQuestions: [],
    partScores: {}
};

// ==================== INIT ====================
function init() {
    loadState();
    applyTheme();
    updateStreak();
    updateHome();
    registerSW();
}

function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

function loadState() {
    try {
        const saved = localStorage.getItem('toeic_state');
        if (saved) {
            const s = JSON.parse(saved);
            state.streak = s.streak || 0;
            state.lastActive = s.lastActive || null;
            state.dailyCount = s.dailyCount || 0;
            state.history = s.history || [];
            state.wrongQuestions = s.wrongQuestions || [];
            state.partScores = s.partScores || {};
            state.theme = s.theme || 'light';
        }
    } catch(e) {}
}

function saveState() {
    localStorage.setItem('toeic_state', JSON.stringify({
        streak: state.streak,
        lastActive: state.lastActive,
        dailyCount: state.dailyCount,
        history: state.history.slice(-500),
        wrongQuestions: state.wrongQuestions.slice(-200),
        partScores: state.partScores,
        theme: state.theme
    }));
}

// ==================== THEME ====================
function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = state.theme === 'dark' ? '☀️' : '🌙';
}

function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveState();
}

// ==================== STREAK ====================
function updateStreak() {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (state.lastActive === today) return;
    if (state.lastActive === yesterday) {
        state.streak++;
    } else if (state.lastActive !== today) {
        state.streak = state.lastActive ? 0 : 0;
    }
    if (state.lastActive !== today) {
        state.dailyCount = 0;
    }
    state.lastActive = today;
    saveState();
    document.getElementById('streak-count').textContent = state.streak;
}

function recordActivity() {
    const today = new Date().toDateString();
    if (state.lastActive !== today) {
        if (state.lastActive === new Date(Date.now() - 86400000).toDateString()) {
            state.streak++;
        } else {
            state.streak = 1;
        }
        state.dailyCount = 0;
        state.lastActive = today;
    }
    state.dailyCount++;
    document.getElementById('streak-count').textContent = state.streak;
    saveState();
}

// ==================== NAVIGATION ====================
function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    state.currentPage = page;

    const backBtn = document.getElementById('btn-back');
    const title = document.getElementById('header-title');
    backBtn.classList.toggle('hidden', page === 'home');

    const titles = { home: 'TOEIC 850+', quiz: 'Quiz', results: 'Résultats', review: 'Revue', stats: 'Statistiques' };
    title.textContent = titles[page] || 'TOEIC 850+';

    document.querySelectorAll('.nav-btn').forEach((b, i) => {
        b.classList.toggle('active', (page === 'home' && i === 0) || (page === 'stats' && i === 2));
    });

    if (page === 'home') updateHome();
    if (page === 'stats') updateStats();
}

function goBack() {
    if (state.currentPage === 'quiz') {
        if (state.quiz && !state.quiz.finished) {
            if (!confirm('Quitter le quiz en cours ?')) return;
        }
        stopSpeech();
        clearInterval(questionTimer);
        showPage('home');
    } else {
        showPage('home');
    }
}

// ==================== HOME ====================
function updateHome() {
    const scores = calculatePredictedScore();
    document.getElementById('predicted-score').textContent = scores.total;
    document.getElementById('listening-score').textContent = scores.listening;
    document.getElementById('reading-score').textContent = scores.reading;
    document.getElementById('score-progress').style.width = (scores.total / 990 * 100) + '%';

    const dailyPct = Math.min(100, (state.dailyCount / state.dailyGoal) * 100);
    document.getElementById('daily-progress').style.width = dailyPct + '%';
    document.getElementById('daily-progress-text').textContent = state.dailyCount + '/' + state.dailyGoal + ' questions';

    for (let p = 1; p <= 7; p++) {
        const el = document.getElementById('part' + p + '-score');
        const ps = state.partScores[p];
        if (ps && ps.total > 0) {
            const pct = Math.round(ps.correct / ps.total * 100);
            el.textContent = pct + '% (' + ps.total + ' Q)';
            el.style.color = pct >= 80 ? 'var(--accent)' : pct >= 60 ? 'var(--warning)' : 'var(--danger)';
        } else {
            el.textContent = 'Pas encore joué';
            el.style.color = '';
        }
    }
}

function calculatePredictedScore() {
    const listeningParts = [1, 2, 3, 4];
    const readingParts = [5, 6, 7];

    let lCorrect = 0, lTotal = 0, rCorrect = 0, rTotal = 0;
    for (const p of listeningParts) {
        if (state.partScores[p]) { lCorrect += state.partScores[p].correct; lTotal += state.partScores[p].total; }
    }
    for (const p of readingParts) {
        if (state.partScores[p]) { rCorrect += state.partScores[p].correct; rTotal += state.partScores[p].total; }
    }

    let listening = 265, reading = 345;
    if (lTotal >= 10) listening = Math.round(5 + (lCorrect / lTotal) * 490);
    if (rTotal >= 10) reading = Math.round(5 + (rCorrect / rTotal) * 490);

    return { listening, reading, total: listening + reading };
}

// ==================== QUIZ ENGINE ====================
function startPractice(part) {
    const questions = getQuestionsForPart(part);
    if (!questions || questions.length === 0) { alert('Pas de questions pour cette partie.'); return; }

    const shuffled = shuffle([...questions]).slice(0, 10);
    state.quiz = {
        questions: shuffled,
        current: 0,
        answers: [],
        startTime: Date.now(),
        part: part,
        mode: 'practice',
        finished: false
    };
    showPage('quiz');
    showQuestion();
}

function startExam() {
    let allQ = [];
    const partCounts = { 1: 6, 2: 8, 3: 8, 4: 8, 5: 10, 6: 5, 7: 5 };

    for (let p = 1; p <= 7; p++) {
        const pq = getQuestionsForPart(p);
        const selected = shuffle([...pq]).slice(0, partCounts[p]);
        allQ = allQ.concat(selected);
    }

    state.quiz = {
        questions: allQ,
        current: 0,
        answers: [],
        startTime: Date.now(),
        part: 'exam',
        mode: 'exam',
        finished: false
    };
    showPage('quiz');
    showQuestion();
}

function startWeakAreas() {
    let weakParts = [];
    for (let p = 1; p <= 7; p++) {
        const ps = state.partScores[p];
        if (!ps || ps.total === 0) { weakParts.push({ part: p, score: 0 }); }
        else { weakParts.push({ part: p, score: ps.correct / ps.total }); }
    }
    weakParts.sort((a, b) => a.score - b.score);
    const targetParts = weakParts.slice(0, 3).map(w => w.part);

    let questions = [];
    // Prioritize previously wrong questions
    const wrongIds = new Set(state.wrongQuestions);
    for (const p of targetParts) {
        const pq = getQuestionsForPart(p);
        const wrongOnes = pq.filter(q => wrongIds.has(q.id));
        const others = pq.filter(q => !wrongIds.has(q.id));
        questions = questions.concat(wrongOnes.slice(0, 5), shuffle(others).slice(0, 3));
    }

    if (questions.length === 0) {
        alert('Commence par faire quelques exercices !');
        return;
    }

    questions = shuffle(questions).slice(0, 15);
    state.quiz = {
        questions,
        current: 0,
        answers: [],
        startTime: Date.now(),
        part: 'weak',
        mode: 'weak',
        finished: false
    };
    showPage('quiz');
    showQuestion();
}

function getQuestionsForPart(part) {
    return (window.TOEIC_QUESTIONS || []).filter(q => q.part === part);
}

let questionTimer = null;

function showQuestion() {
    const quiz = state.quiz;
    if (!quiz || quiz.current >= quiz.questions.length) { finishQuiz(); return; }

    const q = quiz.questions[quiz.current];
    const total = quiz.questions.length;
    const isListening = q.part <= 4;

    document.getElementById('quiz-part-label').textContent =
        quiz.mode === 'exam' ? 'Examen - Part ' + q.part :
        quiz.mode === 'weak' ? 'Points faibles' :
        'Part ' + q.part;
    document.getElementById('quiz-counter').textContent = (quiz.current + 1) + '/' + total;
    document.getElementById('quiz-progress').style.width = (quiz.current / total * 100) + '%';
    document.getElementById('quiz-feedback').classList.add('hidden');

    stopSpeech();
    audioPlayed = false;
    currentAudioText = isListening ? getAudioText(q) : '';

    const content = document.getElementById('quiz-content');
    let html = '';

    if (isListening) {
        html += '<div class="audio-player">';
        html += '<button class="audio-play-btn" id="btn-play-audio" onclick="playQuestionAudio()">';
        html += '&#9654; Écouter';
        html += '</button>';
        html += '<div class="audio-hint">' + escapeHtml(getAudioHint(q.part)) + '</div>';
        html += '</div>';
    }

    if (q.context) {
        if (isListening && (q.part === 3 || q.part === 4)) {
            // Show transcript collapsed for parts 3&4 (conversation/monologue visible)
            html += '<details class="question-context transcript-details"><summary>Voir la transcription</summary>' + escapeHtml(q.context) + '</details>';
        } else if (isListening && q.part === 1) {
            // Part 1: context = photo description, always show it
            html += '<div class="question-context">' + escapeHtml(q.context) + '</div>';
        } else {
            html += '<div class="question-context">' + escapeHtml(q.context) + '</div>';
        }
    }

    html += '<div class="question-text">' + escapeHtml(q.question) + '</div>';

    const letters = ['A', 'B', 'C', 'D'];
    q.options.forEach((opt, i) => {
        html += '<button class="option-btn" onclick="selectAnswer(' + i + ')">';
        html += '<span class="option-letter">' + letters[i] + '</span> ';
        html += escapeHtml(opt);
        html += '</button>';
    });

    content.innerHTML = html;

    // Timer
    clearInterval(questionTimer);
    if (isListening) {
        // Show waiting indicator; timer starts after audio
        document.getElementById('quiz-timer').textContent = '🔊';
        // Try auto-play (works on Android/Desktop; on iOS user must tap)
        setTimeout(() => playQuestionAudio(), 300);
    } else {
        let timeLeft = 45;
        updateTimer(timeLeft);
        questionTimer = setInterval(() => {
            timeLeft--;
            updateTimer(timeLeft);
            if (timeLeft <= 0) {
                clearInterval(questionTimer);
                selectAnswer(-1);
            }
        }, 1000);
    }
}

function updateTimer(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const el = document.getElementById('quiz-timer');
    el.textContent = '⏱ ' + m + ':' + (s < 10 ? '0' : '') + s;
    el.style.color = seconds <= 5 ? 'var(--danger)' : '';
}

function selectAnswer(index) {
    clearInterval(questionTimer);
    stopSpeech();
    const quiz = state.quiz;
    const q = quiz.questions[quiz.current];
    const correct = q.correct;
    const isCorrect = index === correct;

    quiz.answers.push({ questionId: q.id, selected: index, correct: correct, isCorrect });

    // Update UI
    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach((btn, i) => {
        btn.classList.add('disabled');
        if (i === correct) btn.classList.add('correct');
        if (i === index && !isCorrect) btn.classList.add('wrong');
    });

    // Show feedback
    const feedback = document.getElementById('quiz-feedback');
    feedback.classList.remove('hidden');
    document.getElementById('feedback-icon').textContent = isCorrect ? '✅' : (index === -1 ? '⏰' : '❌');
    document.getElementById('feedback-text').textContent =
        isCorrect ? 'Bonne réponse !' : (index === -1 ? 'Temps écoulé !' : 'Mauvaise réponse');
    document.getElementById('feedback-explanation').textContent = q.explanation || '';

    // Track
    recordActivity();
    if (!state.partScores[q.part]) state.partScores[q.part] = { correct: 0, total: 0 };
    state.partScores[q.part].total++;
    if (isCorrect) state.partScores[q.part].correct++;

    state.history.push({
        id: q.id, part: q.part, correct: isCorrect,
        date: new Date().toISOString()
    });

    if (!isCorrect) {
        if (!state.wrongQuestions.includes(q.id)) state.wrongQuestions.push(q.id);
    } else {
        state.wrongQuestions = state.wrongQuestions.filter(id => id !== q.id);
    }

    saveState();
}

function nextQuestion() {
    state.quiz.current++;
    if (state.quiz.current >= state.quiz.questions.length) {
        finishQuiz();
    } else {
        showQuestion();
    }
}

function finishQuiz() {
    state.quiz.finished = true;
    const quiz = state.quiz;
    const total = quiz.answers.length;
    const correct = quiz.answers.filter(a => a.isCorrect).length;
    const pct = total > 0 ? Math.round(correct / total * 100) : 0;
    const elapsed = Math.round((Date.now() - quiz.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;

    document.getElementById('results-score').textContent = pct + '%';
    document.getElementById('results-score').style.color =
        pct >= 80 ? 'var(--accent)' : pct >= 60 ? 'var(--warning)' : 'var(--danger)';

    let details = correct + ' / ' + total + ' bonnes réponses\n';
    if (quiz.mode === 'exam') {
        const scores = calculatePredictedScore();
        details += '\nScore estimé : ' + scores.total + ' / 990';
        details += '\n🎧 Listening : ' + scores.listening + ' / 495';
        details += '\n📖 Reading : ' + scores.reading + ' / 495';
    }
    document.getElementById('results-details').textContent = details;
    document.getElementById('results-time').textContent = 'Temps : ' + mins + 'min ' + secs + 's';

    showPage('results');
}

function reviewErrors() {
    const quiz = state.quiz;
    if (!quiz) return;

    const errors = quiz.answers.filter(a => !a.isCorrect);
    const content = document.getElementById('review-content');
    const letters = ['A', 'B', 'C', 'D'];

    if (errors.length === 0) {
        content.innerHTML = '<div class="stat-card"><p>Aucune erreur ! Bravo ! 🎉</p></div>';
        showPage('review');
        return;
    }

    let html = '';
    errors.forEach(err => {
        const q = quiz.questions.find(qq => qq.id === err.questionId);
        if (!q) return;
        html += '<div class="review-item">';
        html += '<div class="review-q">' + escapeHtml(q.question) + '</div>';
        if (err.selected >= 0) {
            html += '<div class="review-your">Ta réponse : ' + letters[err.selected] + '. ' + escapeHtml(q.options[err.selected]) + '</div>';
        } else {
            html += '<div class="review-your">⏰ Temps écoulé</div>';
        }
        html += '<div class="review-correct">Bonne réponse : ' + letters[q.correct] + '. ' + escapeHtml(q.options[q.correct]) + '</div>';
        if (q.explanation) {
            html += '<div class="review-explain">' + escapeHtml(q.explanation) + '</div>';
        }
        html += '</div>';
    });

    content.innerHTML = html;
    showPage('review');
}

// ==================== STATS ====================
function updateStats() {
    const content = document.getElementById('stats-content');
    const scores = calculatePredictedScore();
    const totalQ = state.history.length;
    const totalCorrect = state.history.filter(h => h.correct).length;
    const globalPct = totalQ > 0 ? Math.round(totalCorrect / totalQ * 100) : 0;

    let html = '';

    // Overview
    html += '<div class="stat-card">';
    html += '<h3>Vue d\'ensemble</h3>';
    html += '<div class="stat-value">' + scores.total + ' <small style="font-size:0.5em">/ 990</small></div>';
    html += '<div class="stat-sub">' + totalQ + ' questions répondues - ' + globalPct + '% de réussite</div>';
    html += '<div class="stat-sub">Série en cours : ' + state.streak + ' jour(s)</div>';
    html += '</div>';

    // Per part
    html += '<div class="stat-card"><h3>Score par partie</h3><div class="stat-bar-container">';
    const partNames = {
        1: 'Part 1 - Photos', 2: 'Part 2 - Q&R', 3: 'Part 3 - Conversations',
        4: 'Part 4 - Monologues', 5: 'Part 5 - Phrases', 6: 'Part 6 - Textes',
        7: 'Part 7 - Compréhension'
    };
    for (let p = 1; p <= 7; p++) {
        const ps = state.partScores[p];
        const pct = ps && ps.total > 0 ? Math.round(ps.correct / ps.total * 100) : 0;
        const total = ps ? ps.total : 0;
        const cls = pct >= 80 ? 'good' : pct >= 60 ? 'medium' : 'bad';
        html += '<div class="stat-bar-label"><span>' + partNames[p] + '</span><span>' + pct + '% (' + total + ')</span></div>';
        html += '<div class="stat-bar"><div class="stat-bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>';
    }
    html += '</div></div>';

    // Recent activity
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toDateString();
        const dayH = state.history.filter(h => new Date(h.date).toDateString() === d);
        last7.push({ day: d, count: dayH.length, correct: dayH.filter(h => h.correct).length });
    }

    html += '<div class="stat-card"><h3>7 derniers jours</h3>';
    last7.forEach(day => {
        const pct = day.count > 0 ? Math.round(day.correct / day.count * 100) : 0;
        const label = new Date(day.day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
        const cls = pct >= 80 ? 'good' : pct >= 60 ? 'medium' : 'bad';
        html += '<div class="stat-bar-label"><span>' + label + '</span><span>' + day.count + ' Q - ' + pct + '%</span></div>';
        html += '<div class="stat-bar"><div class="stat-bar-fill ' + cls + '" style="width:' + Math.min(100, day.count * 5) + '%"></div></div>';
    });
    html += '</div>';

    // Tips
    let weakest = null, weakScore = 100;
    for (let p = 1; p <= 7; p++) {
        const ps = state.partScores[p];
        const pct = ps && ps.total > 0 ? (ps.correct / ps.total * 100) : 0;
        if (pct < weakScore && ps && ps.total >= 3) { weakScore = pct; weakest = p; }
    }

    html += '<div class="stat-card"><h3>💡 Conseil</h3>';
    if (weakest) {
        html += '<div class="stat-sub">Ta partie la plus faible est la <strong>' + partNames[weakest] + '</strong> (' + Math.round(weakScore) + '%). Concentre-toi dessus !</div>';
    } else {
        html += '<div class="stat-sub">Continue à t\'entraîner régulièrement. Objectif : 20 questions par jour minimum !</div>';
    }
    html += '</div>';

    // Reset
    html += '<div class="stat-card" style="text-align:center">';
    html += '<button class="btn btn-secondary" onclick="resetStats()" style="font-size:0.85rem">🗑 Réinitialiser les stats</button>';
    html += '</div>';

    content.innerHTML = html;
}

function resetStats() {
    if (!confirm('Réinitialiser toutes les statistiques ?')) return;
    state.history = [];
    state.wrongQuestions = [];
    state.partScores = {};
    state.dailyCount = 0;
    saveState();
    updateStats();
    updateHome();
}

// ==================== UTILS ====================
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== TEXT-TO-SPEECH ====================
let currentAudioText = '';
let audioPlayed = false;

function getAudioText(q) {
    const letters = ['A', 'B', 'C', 'D'];
    if (q.part === 1) {
        // Read options as in real TOEIC (user looks at context, listens to options)
        return q.options.map((opt, i) => letters[i] + '. ' + opt).join('. ');
    } else if (q.part === 2) {
        // Read question then 3 responses
        return q.question + '. ' + q.options.map((opt, i) => letters[i] + '. ' + opt).join('. ');
    } else if (q.part === 3 || q.part === 4) {
        // Read the dialogue/monologue then the question
        return (q.context ? q.context + '. ' : '') + 'Question: ' + q.question;
    }
    return '';
}

function getAudioHint(part) {
    const hints = {
        1: 'Regardez le contexte et choisissez la phrase correcte',
        2: 'Écoutez la question et choisissez la meilleure réponse',
        3: 'Écoutez la conversation et répondez',
        4: 'Écoutez le monologue et répondez'
    };
    return hints[part] || '';
}

function speakText(text, onEnd) {
    if (!window.speechSynthesis) {
        if (onEnd) onEnd();
        return;
    }
    window.speechSynthesis.cancel();
    currentAudioText = text;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    utterance.pitch = 1;

    // Pick an English voice if available
    const setVoiceAndSpeak = () => {
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find(v => v.lang === 'en-US' && v.localService)
                   || voices.find(v => v.lang.startsWith('en-'));
        if (voice) utterance.voice = voice;

        utterance.onstart = () => setAudioBadge(true);
        utterance.onend = () => { setAudioBadge(false); if (onEnd) onEnd(); };
        utterance.onerror = () => { setAudioBadge(false); if (onEnd) onEnd(); };

        window.speechSynthesis.speak(utterance);
    };

    // Voices may not be loaded yet
    if (window.speechSynthesis.getVoices().length > 0) {
        setVoiceAndSpeak();
    } else {
        window.speechSynthesis.onvoiceschanged = setVoiceAndSpeak;
    }
}

function stopSpeech() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setAudioBadge(false);
}

function setAudioBadge(active) {
    const badge = document.getElementById('audio-badge');
    if (!badge) return;
    if (active) {
        badge.classList.remove('hidden');
        document.getElementById('audio-badge-text').textContent = 'En écoute...';
    } else {
        badge.classList.add('hidden');
    }
}

function playQuestionAudio() {
    const btn = document.getElementById('btn-play-audio');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '&#9646;&#9646; En cours...';
    }
    speakText(currentAudioText, () => {
        audioPlayed = true;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '&#8635; Réécouter';
        }
        // Start timer now that audio has finished
        startListeningTimer(state.quiz.questions[state.quiz.current]);
    });
}

function startListeningTimer(q) {
    clearInterval(questionTimer);
    let timeLeft = q.part <= 2 ? 20 : 35;
    updateTimer(timeLeft);
    questionTimer = setInterval(() => {
        timeLeft--;
        updateTimer(timeLeft);
        if (timeLeft <= 0) {
            clearInterval(questionTimer);
            selectAnswer(-1);
        }
    }, 1000);
}

// ==================== START ====================
document.addEventListener('DOMContentLoaded', init);
