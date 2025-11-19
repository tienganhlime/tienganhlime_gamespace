import React, { useState, useEffect, useRef, useCallback} from 'react';
import { Play, Users, Plus, Trash2, Save, FolderOpen, History, Loader2 } from 'lucide-react';
import { database, ref, set, onValue, push, get, remove } from './firebase.js';
import confetti from 'canvas-confetti';

const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;

// ==================== AI CHẤM BÀI CHUẨN 100% Ý BẠN ====================
const gradeWithGroqAPI = async (question, teacherPrompt, studentLines) => {
  if (!GROQ_API_KEY) {
    alert("THIẾU GROQ API KEY!\n\nVui lòng thêm vào file .env:\nREACT_APP_GROQ_API_KEY=your_key_here");
    return studentLines.map(text => ({
      text: text.trim(),
      score: 0,
      feedback: "Thiếu API key – Cô chưa chấm được nha em!"
    }));
  }

  const numberedLines = studentLines.map((l, i) => `${i + 1}. "${l.trim()}"`).join('\n');

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-70b-versatile',
        temperature: 0,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `Bạn là AI chấm bài cho trung tâm tiếng Anh LIME.
Nhiệm vụ: Chấm bài của học sinh theo prompt giáo viên đưa ra.
Mỗi câu hỏi sẽ có 1 prompt riêng nên bạn cần đọc kỹ prompt đi kèm mỗi câu hỏi để chấm cho đúng nhé.
Lưu ý là với các câu trả lời bằng tiếng Anh thì KHÔNG CHẤP NHẬN ĐÁP ÁN SAI CHÍNH TẢ hoặc SAI NGỮ PHÁP nhé.  

QUAN TRỌNG: Với mỗi dòng đáp án, bạn PHẢI trả về đúng format JSON sau, KHÔNG thêm chữ nào khác:

{
  "results": [
    { "line": 1, "score": số_điểm_nguyên, "feedback": "Nhận xét ngắn gọn, động viên, bắt đầu bằng lời khen, có emoji" },
    { "line": 2, "score": ..., "feedback": "..." }
  ]
}

Lưu ý:
- Feedback vui vẻ, động viên
- Luôn bắt đầu bằng lời khen
- Dùng emoji để tạo năng lượng tích cực
- Đáp án giống nhau phải cho điểm giống nhau` },
          { role: "user", content: `Câu hỏi: ${question}

Prompt chấm của giáo viên (tuân thủ 100%):
${teacherPrompt}

Các đáp án (mỗi dòng 1 đáp án):
${numberedLines}

Chỉ trả về JSON thôi nhé!` }
        ]
      })
    });

    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content.trim());
    const results = parsed.results || [];

    return studentLines.map((text, i) => {
      const r = results.find(x => x.line === i + 1) || {};
      return {
        text: text.trim(),
        score: Number(r.score) || 0,
        feedback: r.feedback || "Tuyệt vời lắm em ơi!"
      };
    });
  } catch (e) {
    console.error(e);
    return studentLines.map(text => ({ text, score: 1, feedback: "Cô bị lỗi tí, nhưng em vẫn giỏi lắm!" }));
  }
};

// ==================== FIREBASE HELPER ====================
const firebaseHelper = {
  createGameSession: async (pin, questions, timeLimit) => {
    await set(ref(database, `games/${pin}`), {
      pin, questions, currentQuestionIndex: 0, timeLimit,
      isActive: true, createdAt: Date.now(), currentQuestionStartTime: Date.now(), students: {}
    });
  },
  joinGame: async (pin, name) => {
    const snap = await get(ref(database, `games/${pin}`));
    if (!snap.exists()) return false;
    await set(ref(database, `games/${pin}/students/${name}`), { name, totalScore: 0, joinedAt: Date.now() });
    return true;
  },
  submitAnswer: async (pin, name, qIdx, gradedLines) => {
    let added = 0;
    for (const item of gradedLines) {
      if (item.score > 0) {
        const newRef = push(ref(database, `games/${pin}/students/${name}/answers`));
        await set(newRef, { questionIndex: qIdx, text: item.text, score: item.score, feedback: item.feedback, timestamp: Date.now() });
        added += item.score;
      }
    }
    if (added > 0) {
      const totalRef = ref(database, `games/${pin}/students/${name}/totalScore`);
      const snap = await get(totalRef);
      await set(totalRef, (snap.val() || 0) + added);
    }
  },
  nextQuestion: async (pin) => {
    const idxRef = ref(database, `games/${pin}/currentQuestionIndex`);
    const timeRef = ref(database, `games/${pin}/currentQuestionStartTime`);
    const snap = await get(idxRef);
    await set(idxRef, (snap.val() || 0) + 1);
    await set(timeRef, Date.now());
  },
  archiveGame: async (pin, gameData, questions, timeLimit) => {
    const today = new Date().toISOString().slice(0,10);
    await set(ref(database, `pastGames/${today}_${pin}`), {
      date: today, pin, timeLimit, questions, students: gameData.students,
      createdAt: gameData.createdAt, endedAt: Date.now()
    });
    await remove(ref(database, `games/${pin}`));
  },
  listenToGame: (pin, cb) => onValue(ref(database, `games/${pin}`), s => cb(s.val())),
  saveQuestionSet: async (name, questions, timeLimit) => {
    const newRef = push(ref(database, 'questionSets'));
    await set(newRef, { name, questions, timeLimit, createdAt: Date.now() });
  },
  getAllQuestionSets: async () => {
    const snap = await get(ref(database, 'questionSets'));
    return snap.val() || {};
  }
};

// ==================== APP ====================
function App() {
  const [mode, setMode] = useState(null);
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50">
      {!mode ? (
        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-12 max-w-lg w-full text-center border-4 border-green-400">
            <div className="w-48 h-48 mx-auto mb-6 flex items-center justify-center">
  <img 
    src="https://gofirst.pro/images/uploads/62/baseimg/logo_16541442053.png" 
    alt="LIME English Center"
    className="w-full h-full object-contain drop-shadow-2xl"
  />
</div>
            <h1 className="text-5xl font-bold text-green-700 mb-8"> LIME GAME SPACE v4</h1>
            <div className="space-y-6">
              <button onClick={() => setMode('teacher')} className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-6 rounded-2xl text-2xl font-bold flex items-center justify-center gap-4 hover:scale-105 transition">
                <Users size={36} /> Teacher Panel
              </button>
              <button onClick={() => setMode('student')} className="w-full bg-gradient-to-r from-teal-500 to-cyan-500 text-white py-6 rounded-2xl text-2xl font-bold flex items-center justify-center gap-4 hover:scale-105 transition">
                <Play size={36} /> Join Game
              </button>
            </div>
          </div>
        </div>
      ) : mode === 'teacher' ? <TeacherPanel onBack={() => setMode(null)} /> : <StudentPanel onBack={() => setMode(null)} />}
    </div>
  );
}

// ==================== TEACHER PANEL HOÀN CHỈNH ====================
function TeacherPanel({ onBack }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [step, setStep] = useState('prepare');
  const [pin, setPin] = useState('');
  const [timeLimit, setTimeLimit] = useState(5);
  const [questions, setQuestions] = useState([]);
  const [currentEdit, setCurrentEdit] = useState({ question: '', criteria: '' });
  const [gameData, setGameData] = useState(null);
  const [savedSets, setSavedSets] = useState({});
  const [pastGames, setPastGames] = useState({});
  const [setNameInput, setSetNameInput] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      firebaseHelper.getAllQuestionSets().then(setSavedSets);
      onValue(ref(database, 'pastGames'), s => setPastGames(s.val() || {}));
    }
  }, [isAuthenticated]);

  const login = (e) => { e.preventDefault(); if (password === 'lime2024') setIsAuthenticated(true); else alert('Sai mật khẩu!'); };
  const generatePIN = () => Math.floor(1000 + Math.random() * 9000).toString();
  const addQuestion = () => {
    if (!currentEdit.question.trim() || !currentEdit.criteria.trim()) return alert('Nhập đủ cả 2 ô nha thầy!');
    setQuestions(p => [...p, { ...currentEdit }]);
    setCurrentEdit({ question: '', criteria: '' });
  };
  const removeQuestion = i => setQuestions(p => p.filter((_, idx) => idx !== i));
  const startGame = async () => {
    if (questions.length === 0) return alert('Chưa có câu hỏi!');
    const newPin = generatePIN();
    setPin(newPin);
    await firebaseHelper.createGameSession(newPin, questions, timeLimit);
    firebaseHelper.listenToGame(newPin, setGameData);
    setStep('live');
  };
  const nextQ = () => firebaseHelper.nextQuestion(pin);
  const endGame = () => {
    firebaseHelper.archiveGame(pin, gameData, questions, timeLimit);
    alert('Đã lưu lịch sử thành công!');
    setStep('prepare'); setGameData(null); setQuestions([]); setPin('');
  };
  const saveSet = async () => {
    if (!setNameInput.trim()) return alert('Đặt tên bộ đi thầy!');
    await firebaseHelper.saveQuestionSet(setNameInput, questions, timeLimit);
    alert('Đã lưu bộ thành công!');
    setNameInput('');
    firebaseHelper.getAllQuestionSets().then(setSavedSets);
  };
  const loadSet = (key) => {
    const s = savedSets[key];
    setQuestions(s.questions || []);
    setTimeLimit(s.timeLimit || 5);
    alert(`Đã load bộ "${s.name}"`);
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-12 w-96 border-4 border-green-400">
          <button onClick={onBack} className="mb-6 text-green-700 font-bold">← Back</button>
          <h2 className="text-4xl font-bold text-center mb-8">Teacher Login</h2>
          <form onSubmit={login}>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mật khẩu" className="w-full p-4 border-2 border-green-400 rounded-xl text-center text-xl" autoFocus />
            <button type="submit" className="w-full mt-6 bg-green-600 text-white py-4 rounded-xl font-bold text-xl">Đăng nhập</button>
          </form>
        </div>
      </div>
    );
  }

  if (step === 'prepare') {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <button onClick={onBack} className="mb-6 text-green-700 font-bold text-xl">← Back</button>
        <div className="bg-white rounded-3xl shadow-2xl p-10 border-4 border-green-400">

          {/* LƯU BỘ */}
          <div className="mb-8 p-6 bg-purple-50 rounded-2xl border-4 border-purple-400">
            <h3 className="text-2xl font-bold mb-4"><Save size={32} className="inline" /> Lưu bộ câu hỏi</h3>
            <div className="flex gap-4">
              <input value={setNameInput} onChange={e => setSetNameInput(e.target.value)} placeholder="Tên bộ (VD: Family Vocabulary)" className="flex-1 p-4 border-2 border-purple-400 rounded-xl" />
              <button onClick={saveSet} className="bg-purple-600 text-white px-8 py-4 rounded-xl font-bold">Lưu</button>
            </div>
          </div>

          {/* LOAD BỘ CŨ */}
          {Object.keys(savedSets).length > 0 && (
            <div className="mb-8 p-6 bg-indigo-50 rounded-2xl border-4 border-indigo-400">
              <h3 className="text-2xl font-bold mb-4"><FolderOpen size={32} className="inline" /> Bộ đã lưu</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(savedSets).map(([k, s]) => (
                  <button key={k} onClick={() => loadSet(k)} className="p-4 bg-white rounded-xl border-2 border-indigo-300 hover:border-indigo-600 text-left">
                    <div className="font-bold">{s.name}</div>
                    <div className="text-sm text-gray-600">{s.questions?.length} câu • {s.timeLimit} phút</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* DANH SÁCH + THÊM CÂU HỎI */}
          <div className="mb-8">
            <label className="text-xl font-bold">Thời gian mỗi câu (phút):</label>
            <input type="number" min="1" value={timeLimit} onChange={e => setTimeLimit(+e.target.value)} className="w-24 p-2 border-2 border-green-400 rounded mx-4 text-2xl text-center" />
          </div>

          {questions.length > 0 && (
            <div className="mb-8 space-y-4">
              <h3 className="text-2xl font-bold">Danh sách câu hỏi ({questions.length})</h3>
              {questions.map((q, i) => (
                <div key={i} className="p-4 bg-green-50 rounded-xl border-2 border-green-400 flex justify-between items-center">
                  <div>
                    <p className="font-bold">Câu {i+1}: {q.question}</p>
                    <p className="text-xs text-gray-600">Tiêu chí: {q.criteria.substring(0,100)}...</p>
                  </div>
                  <button onClick={() => removeQuestion(i)} className="text-red-600"><Trash2 /></button>
                </div>
              ))}
            </div>
          )}

          <div className="p-6 bg-yellow-50 rounded-2xl border-4 border-yellow-400">
            <h3 className="text-2xl font-bold mb-4">Thêm câu hỏi mới</h3>
            <textarea rows={3} placeholder="Câu hỏi..." value={currentEdit.question} onChange={e => setCurrentEdit({ ...currentEdit, question: e.target.value })} className="w-full p-4 border-2 border-yellow-400 rounded-xl mb-4" />
            <textarea rows={10} placeholder="Prompt chấm chi tiết (dán nguyên từ thầy cô)..." value={currentEdit.criteria} onChange={e => setCurrentEdit({ ...currentEdit, criteria: e.target.value })} className="w-full p-4 border-2 border-yellow-400 rounded-xl font-mono text-sm" />
            <button onClick={addQuestion} className="mt-4 w-full bg-yellow-500 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2">
              <Plus size={28} /> Thêm vào bộ
            </button>
          </div>

          <button onClick={startGame} disabled={questions.length===0} className="mt-12 w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-8 rounded-3xl text-4xl font-bold shadow-2xl disabled:opacity-50">
            BẮT ĐẦU GAME ({questions.length} câu)
          </button>
        </div>

        {/* LỊCH SỬ GAME */}
        <div className="mt-12 p-8 bg-pink-50 rounded-3xl border-4 border-pink-500">
          <h2 className="text-3xl font-bold text-pink-800 mb-6"><History size={40} className="inline" /> LỊCH SỬ CÁC GAME</h2>
          {Object.keys(pastGames).length === 0 ? <p className="text-center py-12 text-xl">Chưa có game nào kết thúc</p> :
            Object.entries(pastGames)
              .sort(([a],[b]) => b.localeCompare(a))
              .map(([key, g]) => (
                <details key={key} className="mb-6 bg-white rounded-2xl shadow-lg border-2 border-pink-400">
                  <summary className="p-6 cursor-pointer font-bold text-xl text-pink-700">{g.date} • PIN {g.pin} • {Object.keys(g.students || {}).length} học sinh</summary>
                  <div className="p-6 bg-gray-50">
                    {Object.entries(g.students || {}).map(([name, data]) => (
                      <details key={name} className="mb-4 bg-white rounded-xl p-4 border">
                        <summary className="font-bold cursor-pointer">{name} – {data.totalScore || 0} điểm</summary>
                        <div className="mt-4 space-y-3">
                          {Object.values(data.answers || {}).sort((a,b) => a.questionIndex - b.questionIndex).map((a,i) => (
                            <div key={i} className="p-3 bg-green-50 rounded border border-green-400">
                              <p>Câu {a.questionIndex+1}: <span className="font-medium">{a.text}</span></p>
                              <p className="text-green-700 font-bold">+{a.score} điểm → {a.feedback}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
        </div>
      </div>
    );
  }

  // LIVE GAME VIEW
  const currentQ = questions[gameData?.currentQuestionIndex || 0];
  const students = Object.values(gameData?.students || {}).sort((a,b) => (b.totalScore||0) - (a.totalScore||0));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="bg-white rounded-3xl shadow-2xl p-10 border-4 border-green-400">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-5xl font-bold text-green-700">Game đang diễn ra</h2>
            <p className="text-3xl">Câu {gameData?.currentQuestionIndex + 1}/{questions.length}</p>
          </div>
          <div className="text-7xl font-bold text-white bg-gradient-to-r from-green-500 to-emerald-600 px-16 py-8 rounded-3xl">PIN: {pin}</div>
        </div>

        <div className="p-10 bg-blue-100 rounded-3xl text-center mb-8 border-4 border-blue-400">
          <p className="text-4xl font-bold text-blue-900">{currentQ?.question}</p>
        </div>

        <h3 className="text-4xl font-bold mb-6">Bảng xếp hạng ({students.length} em)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {students.map((s, i) => (
            <div key={s.name} className={`p-8 rounded-3xl text-center border-4 ${i===0?'bg-yellow-200 border-yellow-600':i===1?'bg-gray-200 border-gray-600':i===2?'bg-orange-200 border-orange-600':'bg-green-100 border-green-500'}`}>
              <div className="text-6xl mb-2">{i===0?'First':i===1?'Second':i===2?'Third':'Star'}</div>
              <p className="text-3xl font-bold">{s.name}</p>
              <p className="text-5xl font-bold text-green-700 mt-4">{s.totalScore || 0}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-8 mt-12">
          <button onClick={nextQ} className="flex-1 bg-blue-600 text-white py-8 rounded-3xl text-4xl font-bold">CÂU TIẾP THEO</button>
          <button onClick={endGame} className="bg-red-600 text-white px-16 py-8 rounded-3xl text-4xl font-bold">KẾT THÚC & LƯU</button>
        </div>
      </div>
    </div>
  );
}
// ==================== STUDENT PANEL – HOÀN CHỈNH 100% ====================
function StudentPanel({ onBack }) {
  const [step, setStep] = useState('join');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [gameData, setGameData] = useState(null);
  const [answer, setAnswer] = useState('');
  const [remainingTime, setRemainingTime] = useState(null);
  const [isNewQuestion, setIsNewQuestion] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const timerRef = useRef(null);

  // AUTO RECONNECT khi F5
  useEffect(() => {
    const savedPin = localStorage.getItem('lime_pin');
    const savedName = localStorage.getItem('lime_name');
    if (savedPin && savedName) {
      setPin(savedPin);
      setName(savedName);
      firebaseHelper.joinGame(savedPin, savedName).then(ok => {
        if (ok) setStep('playing');
      });
    }
  }, []);

  const joinGame = async () => {
    if (!name.trim() || pin.length !== 4) return;
    const ok = await firebaseHelper.joinGame(pin, name);
    if (ok) {
      localStorage.setItem('lime_pin', pin);
      localStorage.setItem('lime_name', name);
      setStep('playing');
    } else {
      alert('PIN sai hoặc game đã kết thúc!');
    }
  };

  // Listen game data
  useEffect(() => {
    if (step === 'playing' && pin) {
      const unsub = firebaseHelper.listenToGame(pin, data => {
        setGameData(data);
        // Phát hiện câu mới → hiệu ứng
        if (data && gameData && data.currentQuestionIndex > gameData.currentQuestionIndex) {
          setIsNewQuestion(true);
          confetti({ particleCount: 180, spread: 90, origin: { y: 0.6 } });
          setTimeout(() => setIsNewQuestion(false), 3500);
        }
      });
      return unsub;
    }
  }, [step, pin, gameData?.currentQuestionIndex, gameData]);

  // TIMER ĐỒNG BỘ
  const handleSubmit = useCallback(async () => {
    if (isSubmitting || !answer.trim() || remainingTime <= 0) return;
    setIsSubmitting(true);

    const lines = answer.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    if (lines.length === 0) {
      setIsSubmitting(false);
      return;
    }

    const q = gameData.questions[gameData.currentQuestionIndex];
    const results = await gradeWithGroqAPI(q.question, q.criteria, lines);

    // Kiểm tra trùng đáp án
    const existing = new Set(
      Object.values(gameData.students?.[name]?.answers || {})
        .filter(a => a.questionIndex === gameData.currentQuestionIndex)
        .map(a => a.text.trim().toLowerCase())
    );
    const newLines = results.filter(r => !existing.has(r.text.toLowerCase()));

    if (newLines.length === 0) {
      alert('Các đáp án này em đã gửi rồi nha! Thử cách khác đi nào!');
      setAnswer('');
      setIsSubmitting(false);
      return;
    }

    if (newLines.length < lines.length) {
      alert(`Có ${lines.length - newLines.length} dòng trùng, chỉ chấm ${newLines.length} dòng mới thôi nha em!`);
    }

    await firebaseHelper.submitAnswer(pin, name, gameData.currentQuestionIndex, newLines);
    setAnswer('');
    setIsSubmitting(false);
    confetti({ particleCount: 100 });
  }, [isSubmitting, answer, remainingTime, gameData, pin, name]);

  useEffect(() => {
    if (!gameData?.currentQuestionStartTime || !gameData?.timeLimit) return;
    clearInterval(timerRef.current);
    const start = gameData.currentQuestionStartTime;
    const limitSec = gameData.timeLimit * 60;

    timerRef.current = setInterval(() => {
      const left = Math.max(0, limitSec - (Date.now() - start) / 1000);
      setRemainingTime(Math.ceil(left));
      if (left <= 0 && answer.trim() && !isSubmitting) {
        handleSubmit();
      }
    }, 500);

    return () => clearInterval(timerRef.current);
  }, [gameData?.currentQuestionIndex, gameData?.currentQuestionStartTime, gameData?.timeLimit, answer, isSubmitting, handleSubmit]);

  

  // Dữ liệu hiện tại
  const currentQ = gameData?.questions?.[gameData.currentQuestionIndex];
  const myScore = gameData?.students?.[name]?.totalScore || 0;
  const progress = gameData ? ((gameData.currentQuestionIndex + 1) / gameData.questions.length) * 100 : 0;
  const currentAnswers = Object.values(gameData?.students?.[name]?.answers || {})
    .filter(a => a.questionIndex === gameData?.currentQuestionIndex)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (step === 'join') {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-12 max-w-md w-full text-center border-8 border-teal-500">
          <button onClick={onBack} className="mb-6 text-teal-700 font-bold text-xl">← Back</button>
          <div className="w-40 h-40 mx-auto mb-8 flex items-center justify-center">
  <img 
    src="https://gofirst.pro/images/uploads/62/baseimg/logo_16541442053.png" 
    alt="LIME English Center"
    className="w-full h-full object-contain drop-shadow-2xl"
  />
</div>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Tên em là gì?" className="w-full p-5 border-4 border-teal-400 rounded-xl text-xl mb-4 text-center" />
          <input type="text" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0,4))} placeholder="PIN" className="w-full p-6 border-4 border-teal-400 rounded-xl text-6xl font-bold text-center tracking-widest mb-8" maxLength={4} />
          <button onClick={joinGame} disabled={!name.trim() || pin.length !== 4} className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 text-white py-6 rounded-2xl text-3xl font-bold disabled:opacity-50">
            VÀO CHƠI THÔI NÀO!
          </button>
        </div>
      </div>
    );
  }

  if (!gameData?.questions) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="bg-white rounded-3xl shadow-2xl p-16 text-center border-8 border-green-500">
          <Loader2 className="animate-spin mx-auto mb-8" size={100} />
          <p className="text-4xl font-bold text-green-700">Chờ cô bắt đầu game nha...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-all duration-1000 ${isNewQuestion ? 'bg-yellow-300' : 'bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50'}`}>
      {/* HIỆU ỨNG CÂU MỚI */}
      {isNewQuestion && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <h1 className="text-9xl font-bold text-yellow-600 animate-bounce drop-shadow-2xl">CÂU MỚI!!!</h1>
        </div>
      )}

      <div className="p-6 max-w-5xl mx-auto">
        <div className="bg-white rounded-3xl shadow-2xl p-10 border-8 border-green-500 relative overflow-hidden">

          {/* TIMER KHỦNG */}
          <div className={`text-center text-9xl font-bold mb-8 ${remainingTime <= 60 ? 'text-red-600 animate-pulse' : 'text-green-700'}`}>
            {remainingTime !== null && `${String(Math.floor(remainingTime / 60)).padStart(2,'0')}:${String(remainingTime % 60).padStart(2,'0')}`}
          </div>

          {/* PROGRESS BAR */}
          <div className="mb-8 w-full bg-gray-300 rounded-full h-8 overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 h-full transition-all duration-1000" style={{ width: `${progress}%` }} />
          </div>

          {/* INFO */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-5xl font-bold text-green-700">Hi {name}!</h2>
            <div className="text-right">
              <p className="text-2xl text-gray-600">Tổng điểm</p>
              <p className="text-8xl font-bold text-green-700 bg-green-100 px-12 py-4 rounded-3xl border-8 border-green-500">{myScore}</p>
            </div>
          </div>

          {/* CÂU HỎI */}
          <div className="p-10 bg-gradient-to-r from-blue-100 to-cyan-100 rounded-3xl text-center mb-8 border-8 border-blue-400">
            <p className="text-4xl font-bold text-blue-900">Câu {gameData.currentQuestionIndex + 1}: {currentQ?.question}</p>
          </div>

          {/* ĐÁP ÁN ĐÃ GỬI */}
          {currentAnswers.length > 0 && (
            <div className="mb-8">
              <h3 className="text-3xl font-bold text-center mb-6">Đáp án của em (câu này)</h3>
              <div className="space-y-4">
                {currentAnswers.map((a, i) => (
                  <div key={i} className="p-6 bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl border-4 border-green-400">
                    <p className="text-xl font-medium mb-2">{a.text}</p>
                    <p className="text-3xl font-bold text-green-700">+{a.score} điểm → {a.feedback}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TEXTAREA + NÚT GỬI */}
          <textarea
            rows={8}
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="Gửi nhiều dòng cùng lúc nhé! Enter xuống dòng = 1 đáp án mới"
            className="w-full p-8 border-8 border-green-400 rounded-3xl text-2xl resize-none focus:border-green-600 focus:outline-none"
            disabled={isSubmitting || remainingTime <= 0}
          />

          <button
            onClick={handleSubmit}
            disabled={isSubmitting || remainingTime <= 0 || !answer.trim()}
            className="w-full mt-8 bg-gradient-to-r from-green-600 to-emerald-600 text-white py-8 rounded-3xl text-4xl font-bold flex items-center justify-center gap-6 disabled:opacity-50 shadow-2xl hover:shadow-green-500/50 transition"
          >
            {isSubmitting ? (
              <>Đang chấm...</>
            ) : (
              <>GỬI NGAY!</>
            )}
          </button>

          {remainingTime <= 0 && (
            <div className="text-center text-7xl font-bold text-red-600 mt-10 animate-pulse">
              HẾT GIỜ RỒI!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;