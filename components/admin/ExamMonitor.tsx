import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ExamSession, Quiz, Result, PublishedResult, Grade, User, ClassRoom } from '../../types';
import { 
  getExamSessions, getResults, getQuizzesMetadata, savePublishedResult, 
  deleteExamSession, getPublishedResults, deletePublishedResult, 
  clearAllSessions, isDatabaseConnected, getUsers, getClasses 
} from '../../services/storage';
import { 
  ShieldAlert, RefreshCw, Eraser, Medal, History, Trophy, 
  Search, UserCheck, UserX, Wifi, WifiOff, XCircle, CheckSquare, 
  Square, Calendar, Filter, GraduationCap, X, Check 
} from 'lucide-react';
import { format, differenceInSeconds } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentAcademicYear } from '../../services/academicUtils';

interface ExamMonitorProps {
    currentUser?: User;
    initialQuizzes?: Quiz[];
    initialClasses?: ClassRoom[];
    initialUsers?: User[];
    initialTeachers?: User[];
}

export default function ExamMonitor({ 
    currentUser, 
    initialQuizzes = [], 
    initialClasses = [], 
    initialUsers = [], 
    initialTeachers = [] 
}: ExamMonitorProps) {
    const isSuperAdmin = currentUser?.role === 'superadmin';

    const [sessions, setSessions] = useState<ExamSession[]>([]);
    const [results, setResults] = useState<Result[]>([]);
    const [quizzes, setQuizzes] = useState<Quiz[]>(initialQuizzes);
    const [users, setUsers] = useState<User[]>(initialUsers);
    const [classes, setClasses] = useState<ClassRoom[]>(initialClasses);
    const [publishedHistory, setPublishedHistory] = useState<PublishedResult[]>([]);
    
    // Mặc định: Năm hiện hành & Khối 12
    const [filterAcademicYear, setFilterAcademicYear] = useState<string>(() => getCurrentAcademicYear());
    const [filterGrade, setFilterGrade] = useState<Grade | 'all'>('12');
    // Mặc định: Đề & Lớp của tôi (với GV) hoặc Tất cả (với SuperAdmin)
    const [filterScope, setFilterScope] = useState<'mine' | 'all'>(() => isSuperAdmin ? 'all' : 'mine');
    const [selectedQuizId, setSelectedQuizId] = useState<string>('all');
    
    const [searchCode, setSearchCode] = useState('');
    const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set());
    const [now, setNow] = useState(new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const dbStatus = isDatabaseConnected();

    // 1. Initial data loader (lightweight fetch)
    const loadFullData = useCallback(async (silent = false) => {
        if (!silent) setIsRefreshing(true);
        try {
            const [s, r, q, p, u, cls] = await Promise.all([
                getExamSessions(selectedQuizId), 
                selectedQuizId !== 'all' ? getResults(selectedQuizId, 100) : Promise.resolve([]), 
                quizzes.length > 0 ? Promise.resolve(quizzes) : getQuizzesMetadata(),
                getPublishedResults(),
                users.length > 0 ? Promise.resolve(users) : getUsers(),
                classes.length > 0 ? Promise.resolve(classes) : getClasses()
            ]);
            setSessions(s);
            if (r.length > 0 || selectedQuizId !== 'all') {
                setResults(r);
            }
            if (q.length > 0) setQuizzes(q);
            setPublishedHistory(p.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()));
            if (u.length > 0) setUsers(u);
            if (cls.length > 0) setClasses(cls);
        } catch (error) {
            console.error("Lỗi nạp dữ liệu giám sát:", error);
        } finally {
            if (!silent) setIsRefreshing(false);
        }
    }, [selectedQuizId, quizzes.length, users.length, classes.length]);

    // 2. Định kỳ cập nhật phiên thi đang diễn ra (chỉ đọc sessions để tối ưu băng thông)
    const pollActiveSessions = useCallback(async () => {
        try {
            const s = await getExamSessions(selectedQuizId);
            setSessions(s);
            setNow(new Date());
        } catch (e) {
            console.warn("Lỗi poll phiên thi:", e);
        }
    }, [selectedQuizId]);

    useEffect(() => {
        loadFullData();
        const interval = setInterval(() => {
            pollActiveSessions();
        }, 30000); 
        return () => clearInterval(interval);
    }, [loadFullData, pollActiveSessions]);

    // Khi đổi đề thi được chọn, nạp kết quả của riêng đề thi đó để vinh danh
    useEffect(() => {
        if (selectedQuizId !== 'all') {
            getResults(selectedQuizId, 150).then(r => setResults(r));
        }
    }, [selectedQuizId]);

    const refreshData = async (silent = false) => {
        await loadFullData(silent);
    };

    const handleHardReset = async () => {
        if (!confirm("CẢNH BÁO: Xóa sạch toàn bộ phiên thi ảo để giải cứu phòng thi bị treo?")) return;
        setIsRefreshing(true);
        await clearAllSessions();
        refreshData();
    };

    // Danh sách niên khóa trích xuất từ dữ liệu
    const availableAcademicYears = useMemo(() => {
        const years = new Set<string>();
        const currYear = getCurrentAcademicYear();
        if (currYear) years.add(currYear);

        classes.forEach(c => {
            if (c.academicYear) years.add(c.academicYear.trim());
        });
        quizzes.forEach(q => {
            if (q.academicYear) years.add(q.academicYear.trim());
        });
        return Array.from(years).sort().reverse();
    }, [classes, quizzes]);

    // Tập hợp các lớp mà Giáo viên có quyền (Lớp do mình tạo, phân công hoặc chia sẻ)
    const accessibleClassIds = useMemo(() => {
        if (isSuperAdmin) return new Set<string>();
        const myClasses = classes.filter(c => 
            (c.createdBy && c.createdBy === currentUser?.id) || 
            (currentUser?.fullName && c.teacherName === currentUser.fullName) ||
            Boolean(c.isSharedWithTeachers)
        );
        return new Set(myClasses.map(c => c.id));
    }, [classes, isSuperAdmin, currentUser?.id, currentUser?.fullName]);

    const accessibleClassNames = useMemo(() => {
        if (isSuperAdmin) return new Set<string>();
        const myClasses = classes.filter(c => 
            (c.createdBy && c.createdBy === currentUser?.id) || 
            (currentUser?.fullName && c.teacherName === currentUser.fullName) ||
            Boolean(c.isSharedWithTeachers)
        );
        return new Set(myClasses.map(c => c.name.trim().toLowerCase()));
    }, [classes, isSuperAdmin, currentUser?.id, currentUser?.fullName]);

    // Phân quyền học sinh:
    // SuperAdmin: Xem toàn trường
    // Giáo viên: Học sinh thuộc lớp mình tạo/phụ trách, hoặc học sinh do mình tạo, hoặc thí sinh thi đề do mình tạo
    const isStudentAccessible = useMemo(() => {
        if (isSuperAdmin) return () => true;

        const studentMapById = new Map<string, User>();
        const studentMapByCode = new Map<string, User>();
        users.filter(u => u.role === 'student').forEach(st => {
            if (st.id) studentMapById.set(st.id, st);
            if (st.studentCode) studentMapByCode.set(st.studentCode.trim().toUpperCase(), st);
        });

        return (studentId: string, studentCode?: string, quizCreatorId?: string) => {
            // Đề do GV này tạo -> GV được quyền xem & giám sát
            if (quizCreatorId && quizCreatorId === currentUser?.id) return true;

            const student = (studentId && studentMapById.get(studentId)) || 
                            (studentCode && studentMapByCode.get(studentCode.trim().toUpperCase()));
            
            if (!student) {
                return quizCreatorId === currentUser?.id;
            }

            if (student.classId && accessibleClassIds.has(student.classId)) return true;
            if (student.className && accessibleClassNames.has(student.className.trim().toLowerCase())) return true;
            if (student.createdById && student.createdById === currentUser?.id) return true;

            return false;
        };
    }, [isSuperAdmin, users, accessibleClassIds, accessibleClassNames, currentUser?.id]);

    // Danh sách đề thi được phép giám sát (Lọc theo Niên khóa, Khối, và Quyền quản lý)
    const filteredQuizzes = useMemo(() => {
        return quizzes.filter(q => {
            if (!q.isPublished) return false;
            
            // 1. Lọc theo Khối (Mặc định Khối 12)
            if (filterGrade !== 'all' && q.grade !== filterGrade) return false;

            // 2. Lọc theo Niên khóa (Mặc định Năm hiện hành)
            if (filterAcademicYear !== 'all') {
                if (q.academicYear && q.academicYear !== filterAcademicYear) return false;
            }

            // 3. Lọc theo Phân quyền quản lý (Mặc định: 'mine' - Đề của tôi hoặc đề chia sẻ / giao cho lớp tôi)
            if (filterScope === 'mine' && !isSuperAdmin) {
                const isMyQuiz = q.createdBy === currentUser?.id;
                const isShared = Boolean(q.isSharedWithTeachers);
                const isAssignedToMyClass = q.assignedClassIds && q.assignedClassIds.some(id => accessibleClassIds.has(id));
                if (!isMyQuiz && !isShared && !isAssignedToMyClass) return false;
            }

            return true;
        });
    }, [quizzes, filterGrade, filterAcademicYear, filterScope, isSuperAdmin, currentUser?.id, accessibleClassIds]);

    // Tự động kiểm tra tính hợp lệ của selectedQuizId khi danh sách đề thay đổi
    useEffect(() => {
        if (selectedQuizId !== 'all') {
            const isStillValid = filteredQuizzes.some(q => q.id === selectedQuizId);
            if (!isStillValid) {
                setSelectedQuizId('all');
            }
        }
    }, [filteredQuizzes, selectedQuizId]);

    // Danh sách thí sinh đang trực tiếp làm bài thi trong phòng thi
    const activeSessions = useMemo(() => {
        const allowedQuizIds = new Set(filteredQuizzes.map(q => q.id));
        return sessions.filter(s => {
            if (!allowedQuizIds.has(s.quizId)) return false;
            const quiz = quizzes.find(q => q.id === s.quizId);
            if (!quiz) return false;
            
            const matchGrade = filterGrade === 'all' || quiz.grade === filterGrade;
            const matchQuiz = selectedQuizId === 'all' || s.quizId === selectedQuizId;
            if (!matchGrade || !matchQuiz) return false;

            // Phân quyền giám sát: Chỉ giám sát học sinh trong quyền hạn của GV
            if (!isSuperAdmin) {
                const canMonitor = isStudentAccessible(s.studentId, s.studentCode, quiz.createdBy);
                if (!canMonitor) return false;
            }

            return true;
        });
    }, [sessions, quizzes, filteredQuizzes, filterGrade, selectedQuizId, isSuperAdmin, isStudentAccessible]);

    // Lấy tất cả MAHS đã được vinh danh trong đề này
    const honoredStudentCodes = useMemo(() => {
        const codes = new Set<string>();
        publishedHistory
            .filter(p => p.quizId === selectedQuizId)
            .forEach(p => p.studentCodes.forEach(c => codes.add(c.toUpperCase())));
        return codes;
    }, [publishedHistory, selectedQuizId]);

    // Danh sách điểm cao nhất của các học sinh thuộc phạm vi quản lý để chọn vinh danh
    const bestResultsForBoard = useMemo(() => {
        if (selectedQuizId === 'all') return [];
        const currentQuiz = quizzes.find(q => q.id === selectedQuizId);
        const grouped: Record<string, Result> = {};
        
        results.forEach(r => {
            if (!isSuperAdmin) {
                const canView = isStudentAccessible(r.studentId, r.studentCode, currentQuiz?.createdBy);
                if (!canView) return;
            }

            const code = r.studentCode?.toUpperCase() || `ID_${r.studentId}`;
            if (!grouped[code] || r.score > grouped[code].score) {
                grouped[code] = r;
            }
        });

        return Object.values(grouped)
            .filter(r => {
                const matchCode = !searchCode || 
                    (r.studentCode && r.studentCode.toUpperCase().includes(searchCode.toUpperCase())) ||
                    (r.studentName && r.studentName.toLowerCase().includes(searchCode.toLowerCase()));
                const notHonored = !honoredStudentCodes.has(r.studentCode?.toUpperCase() || '');
                return matchCode && notHonored;
            })
            .sort((a, b) => b.score - a.score);
    }, [results, selectedQuizId, searchCode, honoredStudentCodes, isSuperAdmin, isStudentAccessible, quizzes]);

    const handlePublish = async () => {
        if (selectedQuizId === 'all') return;
        const resultsToPublish = bestResultsForBoard.filter(r => selectedResultIds.has(r.id));
        if (resultsToPublish.length === 0) return alert("Vui lòng chọn ít nhất 1 học sinh.");

        const quiz = quizzes.find(q => q.id === selectedQuizId);
        const pub: PublishedResult = {
            id: uuidv4(), 
            quizId: selectedQuizId, 
            quizTitle: quiz?.title || '',
            publishedAt: new Date().toISOString(),
            studentCodes: resultsToPublish.map(r => r.studentCode || ''),
            results: resultsToPublish
        };
        await savePublishedResult(pub);
        setSelectedResultIds(new Set());
        alert("Đã công bố Bảng Vàng vinh danh thành công!");
        refreshData();
    };

    const handleRevokeHonors = async (pubId: string) => {
        if (confirm("Bạn có chắc chắn muốn thu hồi gói vinh danh này?")) {
            await deletePublishedResult(pubId);
            refreshData();
        }
    };

    const isFilteredFromDefaults = filterAcademicYear !== getCurrentAcademicYear() || filterGrade !== '12' || filterScope !== (isSuperAdmin ? 'all' : 'mine') || selectedQuizId !== 'all';

    return (
        <div className="space-y-8 pb-32 animate-fade-in">
            {/* Header & Thanh công cụ giám sát phòng thi */}
            <div className="bg-white p-8 rounded-[3rem] border shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-red-600 text-white rounded-2xl shadow-lg">
                            <ShieldAlert size={24}/>
                        </div>
                        <div>
                            <h2 className="text-xl font-black uppercase tracking-tight leading-none">Giám sát phòng thi trực tuyến</h2>
                            <div className="flex items-center gap-2 mt-2">
                                <div className={`w-2 h-2 rounded-full ${dbStatus ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
                                <span className="text-[10px] font-black uppercase text-slate-400">
                                    Hệ thống: {dbStatus ? 'Trực tuyến' : 'Ngoại tuyến'} • Đang thi: <strong className="text-emerald-600">{activeSessions.length}</strong> thí sinh
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <button 
                            onClick={handleHardReset} 
                            className="px-5 py-3 bg-red-50 text-red-600 rounded-2xl hover:bg-red-600 hover:text-white transition-all text-[10px] font-black uppercase border border-red-100 flex items-center gap-2 shadow-xs"
                            title="Xóa các phiên thi ảo bị mất kết nối"
                        >
                            <Eraser size={14}/> Giải cứu treo
                        </button>
                        <button 
                            onClick={() => refreshData()} 
                            className="p-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-all shadow-sm"
                            title="Làm mới dữ liệu phòng thi"
                        >
                            <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''}/>
                        </button>
                    </div>
                </div>

                {/* Bộ lọc thông minh: Quản lý GV, Niên khóa hiện hành, Khối 12, Đề thi */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    {/* 1. Phạm vi quản lý */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-black text-blue-600 uppercase ml-2 flex items-center gap-1">
                            <UserCheck size={10}/> 1. Phạm vi đề & Lớp
                        </label>
                        <select 
                            className="w-full bg-blue-50/70 border border-blue-200 text-blue-950 rounded-2xl p-4 text-xs font-black uppercase outline-none focus:border-blue-400 cursor-pointer shadow-xs" 
                            value={filterScope} 
                            onChange={e => setFilterScope(e.target.value as 'mine' | 'all')}
                        >
                            <option value="mine">👤 ĐỀ & LỚP CỦA TÔI</option>
                            <option value="all">🌐 TẤT CẢ ĐỀ THI</option>
                        </select>
                    </div>

                    {/* 2. Niên khóa (Mặc định: Năm hiện hành) */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-2 flex items-center gap-1">
                            <Calendar size={10}/> 2. Niên khóa
                        </label>
                        <select 
                            className="w-full bg-slate-50 border rounded-2xl p-4 text-xs font-black uppercase outline-none focus:border-blue-400 cursor-pointer" 
                            value={filterAcademicYear} 
                            onChange={e => setFilterAcademicYear(e.target.value)}
                        >
                            <option value="all">TẤT CẢ NIÊN KHÓA</option>
                            {availableAcademicYears.map(yr => (
                                <option key={yr} value={yr}>
                                    NIÊN KHÓA {yr} {yr === getCurrentAcademicYear() ? '★ (Hiện hành)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* 3. Khối lớp (Mặc định: Khối 12) */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-2 flex items-center gap-1">
                            <Filter size={10}/> 3. Khối lớp
                        </label>
                        <select 
                            className="w-full bg-slate-50 border rounded-2xl p-4 text-xs font-black uppercase outline-none focus:border-blue-400 cursor-pointer" 
                            value={filterGrade} 
                            onChange={e => {
                                setFilterGrade(e.target.value as any);
                                setSelectedQuizId('all');
                            }}
                        >
                            <option value="all">TẤT CẢ KHỐI</option>
                            <option value="12">KHỐI 12 (Mặc định)</option>
                            <option value="11">KHỐI 11</option>
                            <option value="10">KHỐI 10</option>
                        </select>
                    </div>

                    {/* 4. Chọn Đề thi */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase ml-2 flex items-center gap-1">
                            <GraduationCap size={10}/> 4. Chọn Đề thi ({filteredQuizzes.length})
                        </label>
                        <select 
                            className="w-full bg-slate-50 border rounded-2xl p-4 text-xs font-black uppercase outline-none focus:border-blue-400 cursor-pointer truncate" 
                            value={selectedQuizId} 
                            onChange={e => setSelectedQuizId(e.target.value)}
                        >
                            <option value="all">-- TẤT CẢ ĐỀ THI ĐANG GIÁM SÁT --</option>
                            {filteredQuizzes.map(q => (
                                <option key={q.id} value={q.id}>
                                    [{q.grade}] {q.title} {q.subject ? `(${q.subject})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Nút Đặt lại bộ lọc */}
                {isFilteredFromDefaults && (
                    <div className="flex justify-end pt-2 border-t border-slate-100">
                        <button 
                            onClick={() => {
                                setFilterAcademicYear(getCurrentAcademicYear());
                                setFilterGrade('12');
                                setFilterScope(isSuperAdmin ? 'all' : 'mine');
                                setSelectedQuizId('all');
                            }}
                            className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-all flex items-center gap-1.5 shadow-xs"
                            title="Khôi phục bộ lọc mặc định (Năm hiện hành + Khối 12 + Của tôi)"
                        >
                            <X size={12}/> Khôi phục bộ lọc mặc định
                        </button>
                    </div>
                )}
            </div>

            {/* BẢNG THÍ SINH ĐANG LÀM BÀI TRỰC TIẾP */}
            <div className="bg-white rounded-[2.5rem] border shadow-sm overflow-hidden">
                <div className="p-6 border-b bg-slate-50 flex items-center justify-between">
                    <h3 className="text-[11px] font-black uppercase text-slate-600 flex items-center gap-2">
                        <Wifi size={16} className="text-emerald-500"/> 
                        Thí sinh đang thi trực tiếp ({activeSessions.length})
                    </h3>
                    <span className="text-[9px] font-bold text-slate-400 uppercase">
                        Tự động đồng bộ mỗi 30 giây
                    </span>
                </div>
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-white border-b text-[10px] font-black uppercase text-slate-400">
                            <th className="p-6">Thí sinh</th>
                            <th className="p-6">Đề thi</th>
                            <th className="p-6 text-center">Vi phạm</th>
                            <th className="p-6 text-center">Kết nối</th>
                            <th className="p-6 text-center">Thao tác</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {activeSessions.map((s) => {
                            const isDisconnected = differenceInSeconds(now, new Date(s.lastUpdate)) > 60;

                            return (
                                <tr key={s.id} className="hover:bg-slate-50/80 transition-all">
                                    <td className="p-6">
                                        <p className="font-black uppercase text-xs text-slate-800">{s.studentName}</p>
                                        <p className="text-[10px] text-blue-600 font-black tracking-wider uppercase mt-0.5">
                                            MAHS: {s.studentCode || 'N/A'}
                                        </p>
                                    </td>
                                    <td className="p-6">
                                        <p className="font-black uppercase text-xs text-slate-700 truncate max-w-[220px]">
                                            {s.quizTitle || 'Đề thi'}
                                        </p>
                                    </td>
                                    <td className="p-6 text-center">
                                        <span className={`px-3 py-1 rounded-lg text-[10px] font-black ${s.violationCount > 0 ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-slate-50 text-slate-400'}`}>
                                            {s.violationCount}/3
                                        </span>
                                    </td>
                                    <td className="p-6 text-center">
                                        {isDisconnected ? (
                                            <div className="inline-flex items-center gap-1.5 text-red-500 bg-red-50 px-2.5 py-1 rounded-lg text-[10px] font-bold">
                                                <WifiOff size={14}/> Mất mạng
                                            </div>
                                        ) : (
                                            <div className="inline-flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg text-[10px] font-bold">
                                                <Wifi size={14} className="animate-pulse"/> Ổn định
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-6 text-center">
                                        <button 
                                            onClick={() => deleteExamSession(s.id).then(() => refreshData())} 
                                            className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors" 
                                            title="Buộc dừng phiên thi"
                                        >
                                            <XCircle size={18}/>
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {activeSessions.length === 0 && (
                    <div className="p-14 text-center text-slate-400 font-bold uppercase text-xs space-y-1">
                        <WifiOff className="mx-auto text-slate-300 mb-1" size={28}/>
                        <p>Hiện không có thí sinh nào đang làm bài trong phạm vi đã chọn</p>
                        <p className="text-[10px] text-slate-400 normal-case">
                            Khi học sinh bắt đầu làm bài thi thuộc khối và đề của bạn, danh sách trực tuyến sẽ hiển thị tại đây.
                        </p>
                    </div>
                )}
            </div>

            {/* BẢNG VÀNG ĐỀ THI & LỊCH SỬ VINH DANH (Khi đã chọn 1 đề thi cụ thể) */}
            {selectedQuizId !== 'all' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* CỘT 1: CHỌN VINH DANH MỚI */}
                    <div className="bg-slate-900 p-8 rounded-[3.5rem] shadow-2xl space-y-6 h-fit">
                        <div className="flex justify-between items-center text-white border-b border-white/10 pb-4">
                            <div className="flex items-center gap-3">
                                <Trophy size={26} className="text-yellow-400 drop-shadow-lg"/>
                                <div>
                                    <h3 className="text-base font-black uppercase italic tracking-tight text-white">Bảng Vàng Đề Thi</h3>
                                    <p className="text-[10px] text-slate-400 font-bold">Chọn các học sinh đạt điểm cao để công bố vinh danh</p>
                                </div>
                            </div>
                        </div>

                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16}/>
                            <input 
                                className="w-full bg-slate-800 border-none rounded-2xl p-3.5 pl-11 text-xs font-bold text-white outline-none focus:ring-2 focus:ring-yellow-500 transition-all placeholder:text-slate-500" 
                                placeholder="Tìm theo Tên hoặc MAHS..." 
                                value={searchCode}
                                onChange={e => setSearchCode(e.target.value)}
                            />
                        </div>

                        <div className="bg-slate-800/40 rounded-[2rem] overflow-hidden max-h-[460px] overflow-y-auto custom-scrollbar border border-white/5">
                            <table className="w-full text-left text-white">
                                <thead>
                                    <tr className="text-[9px] uppercase text-slate-400 border-b border-white/10 bg-black/20 font-black">
                                        <th className="p-4 pl-6">Thí sinh</th>
                                        <th className="p-4 text-center">Điểm số</th>
                                        <th className="p-4 pr-6 text-center">Chọn</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5 font-medium">
                                    {bestResultsForBoard.map((r) => {
                                        const isSelected = selectedResultIds.has(r.id);
                                        return (
                                            <tr 
                                                key={r.id} 
                                                onClick={() => { 
                                                    const s = new Set(selectedResultIds); 
                                                    isSelected ? s.delete(r.id) : s.add(r.id); 
                                                    setSelectedResultIds(s); 
                                                }} 
                                                className="cursor-pointer hover:bg-white/5 transition-colors group"
                                            >
                                                <td className="p-4 pl-6">
                                                    <p className="font-black uppercase text-xs group-hover:text-yellow-400 transition-colors">{r.studentName}</p>
                                                    <p className="text-[9px] font-mono text-slate-400 mt-0.5">MAHS: {r.studentCode || 'N/A'}</p>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className="text-base font-black text-yellow-400">{r.score.toFixed(2)}</span>
                                                </td>
                                                <td className="p-4 pr-6 text-center">
                                                    {isSelected ? (
                                                        <CheckSquare className="mx-auto text-yellow-400 scale-110" size={18} />
                                                    ) : (
                                                        <Square className="mx-auto text-slate-600" size={18} />
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {bestResultsForBoard.length === 0 && (
                                <div className="p-10 text-center text-slate-500 font-bold uppercase text-[10px]">
                                    Không có kết quả nào chưa được vinh danh
                                </div>
                            )}
                        </div>

                        <button 
                            onClick={handlePublish} 
                            disabled={selectedResultIds.size === 0} 
                            className="w-full py-4 bg-yellow-500 text-slate-950 rounded-[2rem] font-black text-xs uppercase shadow-lg hover:bg-white transition-all disabled:opacity-20 flex items-center justify-center gap-2"
                        >
                            <Medal size={18}/> CÔNG BỐ VINH DANH ({selectedResultIds.size})
                        </button>
                    </div>

                    {/* CỘT 2: DANH SÁCH ĐÃ VINH DANH */}
                    <div className="bg-white p-8 rounded-[3.5rem] border shadow-sm space-y-6 flex flex-col">
                        <div className="flex items-center gap-3 border-b pb-4">
                            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl shadow-sm">
                                <UserCheck size={22}/>
                            </div>
                            <div>
                                <h3 className="text-base font-black uppercase tracking-tight text-slate-800 leading-none">Lịch sử Vinh danh</h3>
                                <p className="text-[10px] text-slate-400 font-bold mt-1">Các gói vinh danh đã công bố cho đề thi này</p>
                            </div>
                        </div>

                        <div className="flex-1 space-y-4 max-h-[550px] overflow-y-auto pr-2 custom-scrollbar">
                            {publishedHistory.filter(p => p.quizId === selectedQuizId).map((pub) => (
                                <div key={pub.id} className="bg-slate-50 rounded-[2rem] p-5 border-2 border-transparent hover:border-emerald-100 transition-all space-y-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                                {format(new Date(pub.publishedAt), 'HH:mm • dd/MM/yyyy')}
                                            </p>
                                            <h4 className="font-black text-emerald-700 text-xs uppercase mt-0.5">
                                                Gói vinh danh ({pub.results.length} học sinh)
                                            </h4>
                                        </div>
                                        <button 
                                            onClick={() => handleRevokeHonors(pub.id)} 
                                            className="p-2.5 bg-white text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all shadow-xs"
                                            title="Thu hồi vinh danh"
                                        >
                                            <UserX size={15}/>
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {pub.results.map(r => (
                                            <div key={r.id} className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80 flex items-center gap-1.5 shadow-xs">
                                                <span className="text-[10px] font-black text-slate-800 uppercase">{r.studentName}</span>
                                                <span className="text-[10px] font-black text-emerald-600 font-mono">{r.score.toFixed(1)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            {publishedHistory.filter(p => p.quizId === selectedQuizId).length === 0 && (
                                <div className="py-20 text-center space-y-3">
                                    <History size={40} className="mx-auto text-slate-200"/>
                                    <p className="text-slate-400 font-bold uppercase text-[10px]">Chưa có học sinh nào được vinh danh trong đề này</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
